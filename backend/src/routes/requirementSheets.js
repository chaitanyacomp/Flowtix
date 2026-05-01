const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { DocType } = require("@prisma/client");
const { allocateDocNo } = require("../services/docNoService");
const { computeZone } = require("../services/planningThresholds");
const {
  netDispatchedByItemId,
  DISPATCH_ALLOC_MODE,
  remainingDispatchCapacityForSoItem,
} = require("../services/salesOrderDispatchAllocation");
const { repairNoQtyCycleIntegrity } = require("../services/noQtyCycleLifecycle");
const { logActivity } = require("../services/activityLogService");
const { usableStockDisplayQty } = require("../services/stockService");
const { buildQcAcceptedMap } = require("../services/dispatchQcCap");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displayRequirementSheetNo, displaySalesOrderNo } = require("../utils/docNoLabels");

const requirementSheetsRouter = express.Router();

function friendly400(message) {
  return { error: { message } };
}

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round2(v) {
  return Math.round(n(v) * 100) / 100;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function computeGapPercent(req, stock) {
  const r = n(req);
  if (!(r > 0)) return null;
  return round2(((r - n(stock)) / r) * 100);
}

function computeSuggestedWo(req, stock) {
  const sug = n(req) - n(stock);
  return sug > 0 ? round3(sug) : 0;
}

async function stockByItemIdUsable() {
  const stockRows = await prisma.stockTransaction.groupBy({
    by: ["itemId"],
    // Stock math must include reversed originals; reversal rows offset them.
    where: { stockBucket: "USABLE" },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return new Map(stockRows.map((r) => [r.itemId, n(r._sum.qtyIn) - n(r._sum.qtyOut)]));
}

const EPS = 1e-6;

/**
 * Planning: compute FREE usable FG stock (not reserved for dispatch).
 *
 * reservedQty (per FG item) is the sum of remaining dispatch demand across:
 * - NO_QTY sales orders: max(0, QC accepted total for SO+item − operational net dispatched for SO+item)
 * - NORMAL / REPLACEMENT sales orders: remaining dispatch capacity on SO lines (FIFO), operational mode
 *
 * Then:
 * freeUsableStock = max(0, totalUsableFGStock − reservedQty)
 */
async function freeUsableFgStockByItemForNoQtyPlanning(args) {
  const soId = Number(args?.salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return new Map();

  const totalUsableByItem = await stockByItemIdUsable();

  // 1) Load all OPEN sales orders (reserve stock for any pending dispatch demand).
  const openSos = await prisma.salesOrder.findMany({
    where: { internalStatus: { notIn: ["COMPLETED", "CLOSED"] } },
    select: {
      id: true,
      orderType: true,
      customerReturnId: true,
      currentCycleId: true,
      currentCycle: { select: { id: true, status: true } },
      lines: { select: { id: true, itemId: true, qty: true, customerPoQty: true } },
    },
  });
  const openSoIds = openSos.map((s) => Number(s.id)).filter((x) => Number.isFinite(x) && x > 0);
  if (!openSoIds.length) return new Map([...totalUsableByItem.entries()].map(([k, v]) => [k, Math.max(0, v)]));

  const dispatchRows = await prisma.dispatch.findMany({
    where: { soId: { in: openSoIds } },
    select: { soId: true, itemId: true, cycleId: true, dispatchedQty: true, reversalOfId: true, workflowStatus: true },
  });
  const dispatchBySoId = new Map();
  for (const d of dispatchRows) {
    const id = Number(d.soId);
    if (!dispatchBySoId.has(id)) dispatchBySoId.set(id, []);
    dispatchBySoId.get(id).push(d);
  }

  // 2) QC accepted totals for NO_QTY reservations (ACTIVE cycle only).
  // Key: `${soId}:${itemId}`.
  const qcAcceptedMap = new Map();

  // 3) APPROVED produced totals for NO_QTY reservations (covers flows where usable FG is posted on production approval).
  const openNoQtySoIds = openSos
    .filter((s) => String(s.orderType ?? "") === "NO_QTY")
    .map((s) => Number(s.id))
    .filter((x) => Number.isFinite(x) && x > 0);
  const activeCycleIds = openSos
    .filter((s) => String(s.orderType ?? "") === "NO_QTY")
    .map((s) => {
      const cycId = s.currentCycle?.id ?? s.currentCycleId ?? null;
      const st = String(s.currentCycle?.status ?? "");
      return cycId != null && Number.isFinite(Number(cycId)) && Number(cycId) > 0 && st === "ACTIVE"
        ? Number(cycId)
        : null;
    })
    .filter((x) => x != null);

  /** @type {Map<string, number>} key `${soId}:${itemId}` -> approved produced qty */
  const approvedProducedBySoItemKey = new Map();
  if (openNoQtySoIds.length) {
    const woLines = await prisma.workOrderLine.findMany({
      where: {
        workOrder: {
          salesOrderId: { in: openNoQtySoIds },
          cycleId: { in: activeCycleIds },
          status: { not: "REJECTED" },
        },
      },
      select: { id: true, fgItemId: true, workOrder: { select: { salesOrderId: true } } },
    });
    const wolIds = woLines.map((l) => Number(l.id)).filter((x) => Number.isFinite(x) && x > 0);
    const wolMeta = new Map(
      woLines.map((l) => [Number(l.id), { soId: Number(l.workOrder?.salesOrderId), itemId: Number(l.fgItemId) }]),
    );
    if (wolIds.length) {
      const prodAgg = await prisma.productionEntry.groupBy({
        by: ["workOrderLineId"],
        where: { workOrderLineId: { in: wolIds }, workflowStatus: "APPROVED" },
        _sum: { producedQty: true },
      });
      for (const r of prodAgg) {
        const wolId = Number(r.workOrderLineId);
        const meta = wolMeta.get(wolId);
        if (!meta || !meta.soId || !meta.itemId) continue;
        const k = `${meta.soId}:${meta.itemId}`;
        approvedProducedBySoItemKey.set(k, (approvedProducedBySoItemKey.get(k) ?? 0) + n(r._sum.producedQty));
      }
    }
  }

  if (openNoQtySoIds.length && activeCycleIds.length) {
    // QC accepted in ACTIVE cycle only (exclude CLOSED cycles from reservation).
    const qcRows = await prisma.qcEntry.findMany({
      where: {
        reversedAt: null,
        production: {
          workOrderLine: {
            workOrder: {
              salesOrderId: { in: openNoQtySoIds },
              cycleId: { in: activeCycleIds },
            },
          },
        },
      },
      select: {
        acceptedQty: true,
        production: { select: { workOrderLine: { select: { fgItemId: true, workOrder: { select: { salesOrderId: true } } } } } },
      },
    });
    for (const r of qcRows) {
      const soId = Number(r.production?.workOrderLine?.workOrder?.salesOrderId);
      const itemId = Number(r.production?.workOrderLine?.fgItemId);
      if (!soId || !itemId) continue;
      const k = `${soId}:${itemId}`;
      qcAcceptedMap.set(k, (qcAcceptedMap.get(k) ?? 0) + n(r.acceptedQty));
    }
  }

  /** @type {Map<number, number>} itemId -> reserved qty */
  const reservedByItem = new Map();

  for (const so of openSos) {
    const id = Number(so.id);
    const orderType = String(so.orderType ?? "");
    const disp = dispatchBySoId.get(id) ?? [];
    const activeCycleId = so.currentCycle?.id ?? so.currentCycleId ?? null;
    const activeCycleOk =
      orderType === "NO_QTY" && activeCycleId != null && Number.isFinite(Number(activeCycleId)) && Number(activeCycleId) > 0 && so.currentCycle?.status === "ACTIVE";
    const dispScoped = activeCycleOk ? disp.filter((d) => Number(d.cycleId) === Number(activeCycleId)) : disp;
    const netOpByItem = netDispatchedByItemId(dispScoped, DISPATCH_ALLOC_MODE.OPERATIONAL);

    if (orderType === "NO_QTY") {
      // Scope reservation strictly to ACTIVE cycle only (exclude CLOSED cycles completely).
      if (!activeCycleOk) continue;
      // Special rule: QC-passed stock generated within the SAME SO (any cycle) is reserved by default
      // until dispatched (operational). This prevents it from reducing next RS planning.
      for (const [itemId, netOp] of netOpByItem.entries()) {
        const key = `${id}:${itemId}`;
        const qcAccepted = n(qcAcceptedMap.get(key) ?? 0);
        const approvedProduced = n(approvedProducedBySoItemKey.get(key) ?? 0);
        const reservedBase = Math.max(qcAccepted, approvedProduced);
        const reserved = Math.max(0, reservedBase - n(netOp));
        if (reserved > EPS) reservedByItem.set(itemId, (reservedByItem.get(itemId) ?? 0) + reserved);
      }
      // Also cover items with QC but no dispatch rows yet.
      for (const [k, qc] of qcAcceptedMap.entries()) {
        const [kSoId, kItemId] = String(k).split(":");
        if (Number(kSoId) !== id) continue;
        const itemId = Number(kItemId);
        const netOp = n(netOpByItem.get(itemId) ?? 0);
        const approvedProduced = n(approvedProducedBySoItemKey.get(k) ?? 0);
        const reservedBase = Math.max(n(qc), approvedProduced);
        const reserved = Math.max(0, reservedBase - netOp);
        if (reserved > EPS) reservedByItem.set(itemId, (reservedByItem.get(itemId) ?? 0) + reserved);
      }
      // Also cover items with production approval but no QC/dispatch rows yet.
      for (const [k, produced] of approvedProducedBySoItemKey.entries()) {
        const [kSoId, kItemId] = String(k).split(":");
        if (Number(kSoId) !== id) continue;
        const itemId = Number(kItemId);
        const netOp = n(netOpByItem.get(itemId) ?? 0);
        const qcAccepted = n(qcAcceptedMap.get(k) ?? 0);
        const reservedBase = Math.max(qcAccepted, n(produced));
        const reserved = Math.max(0, reservedBase - netOp);
        if (reserved > EPS) reservedByItem.set(itemId, (reservedByItem.get(itemId) ?? 0) + reserved);
      }
      continue;
    }

    // NORMAL / REPLACEMENT: reserve remaining dispatch capacity on SO lines (FIFO).
    const lineInputs = (so.lines || []).map((l) => ({
      id: Number(l.id),
      itemId: Number(l.itemId),
      qty: n(l.qty ?? l.customerPoQty),
    }));
    const seenItems = new Set(lineInputs.map((l) => l.itemId).filter((x) => Number.isFinite(x) && x > 0));
    for (const itemId of seenItems) {
      const rem = remainingDispatchCapacityForSoItem(lineInputs, disp, itemId);
      if (rem > EPS) reservedByItem.set(itemId, (reservedByItem.get(itemId) ?? 0) + rem);
    }
  }

  const out = new Map();
  for (const [itemId, total] of totalUsableByItem.entries()) {
    const reserved = n(reservedByItem.get(itemId) ?? 0);
    out.set(itemId, Math.max(0, n(total) - reserved));
  }
  return out;
}

/**
 * NO_QTY only: Requirement Sheets and Work Orders must attach to the ACTIVE {@link SalesOrderCycle}
 * (highest `cycleNo` among ACTIVE rows). Versioning is scoped by `(salesOrderId, cycleId, periodKey)` — not across cycles.
 *
 * Order: {@link repairNoQtyCycleIntegrity} → resolve sole ACTIVE cycle → align `SalesOrder.currentCycleId` →
 * create a new ACTIVE cycle only if none exists (edge case: all historical cycles CLOSED).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} salesOrderId
 * @returns {Promise<number>}
 */
async function resolveNoQtyActiveCycleIdForPlanning(tx, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    const err = new Error("Invalid sales order.");
    err.statusCode = 400;
    throw err;
  }

  await repairNoQtyCycleIntegrity(tx, soId);

  let active = await tx.salesOrderCycle.findFirst({
    where: { salesOrderId: soId, status: "ACTIVE" },
    orderBy: { cycleNo: "desc" },
    select: { id: true, cycleNo: true },
  });

  if (!active) {
    const last = await tx.salesOrderCycle.aggregate({
      where: { salesOrderId: soId },
      _max: { cycleNo: true },
    });
    const nextNo = Math.max(1, Number(last._max.cycleNo ?? 0) + 1);
    active = await tx.salesOrderCycle.create({
      data: { salesOrderId: soId, cycleNo: nextNo, status: "ACTIVE" },
      select: { id: true, cycleNo: true },
    });
  }

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { internalStatus: true, currentCycleId: true },
  });
  if (!so) {
    const err = new Error("Sales order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (so.internalStatus !== "COMPLETED" && Number(so.currentCycleId) !== Number(active.id)) {
    await tx.salesOrder.update({ where: { id: soId }, data: { currentCycleId: active.id } });
  }

  return active.id;
}

/**
 * Per FG item: max(0, SUM(plannedQty on non-REJECTED WOs in these cycles − confirmed net dispatch in those cycles).
 *
 * @param {number} soId
 * @param {number[]} cycleIds
 * @returns {Promise<Map<number, { rawShortfall: number; dispatched: number; planned: number }>>}
 */
async function plannedMinusConfirmedDispatchByItemForCycles(soId, cycleIds) {
  const ids = (cycleIds || []).filter((x) => Number.isFinite(x) && x > 0);
  if (!ids.length) return new Map();

  // Legacy helper kept for compatibility with older reasoning, but it was not suitable for NO_QTY shortage carry-forward
  // (dispatch may be pending while production/QC already finalized). Use QC-based shortfall below instead.
  return new Map();
}

function mergeShortfallMaps(a, b) {
  const out = new Map(a);
  for (const [itemId, v] of b) {
    const prev = out.get(itemId);
    if (!prev) {
      out.set(itemId, { ...v });
      continue;
    }
    out.set(itemId, {
      rawShortfall: prev.rawShortfall + v.rawShortfall,
      dispatched: prev.dispatched + v.dispatched,
      planned: prev.planned + v.planned,
    });
  }
  return out;
}

/**
 * Unresolved NO_QTY shortfall (per FG item) shown on draft requirement sheets:
 * (1) Prior **closed** sales-order cycles: planned − confirmed dispatch (inter-cycle carry).
 * (2) **Current** active cycle: same formula for the same cycleId — required when cycleNo === 1
 *     (otherwise v2/v3 drafts in the same period as v1 LOCKED never see WO vs dispatch balance).
 *
 * (1) and (2) are disjoint by cycleId and are summed per item.
 *
 * @param {{ salesOrderId: number; currentCycleId: number | null }} input
 * @returns {Promise<Map<number, { rawShortfall: number; dispatched: number; planned: number }>>}
 */
async function loadNoQtyCarryForwardShortfallByItem(input) {
  const soId = Number(input?.salesOrderId);
  const currentCycleId = input?.currentCycleId != null ? Number(input.currentCycleId) : null;
  if (!Number.isFinite(soId) || soId <= 0) return new Map();
  if (!currentCycleId || !Number.isFinite(currentCycleId) || currentCycleId <= 0) return new Map();

  const current = await prisma.salesOrderCycle.findUnique({
    where: { id: currentCycleId },
    select: { id: true, salesOrderId: true, cycleNo: true },
  });
  if (!current || current.salesOrderId !== soId) return new Map();

  // NO_QTY business rule: shortage nets across the SO lifecycle.
  // Compute item-level cumulative planned vs produced across included cycles, then apply max(0, planned - produced) once.
  const includeCycleIds = [];
  if (Number(current.cycleNo) > 1) {
    const prevCycles = await prisma.salesOrderCycle.findMany({
      where: { salesOrderId: soId, cycleNo: { lt: current.cycleNo }, status: "CLOSED" },
      select: { id: true },
    });
    for (const c of prevCycles) {
      const id = Number(c.id);
      if (Number.isFinite(id) && id > 0) includeCycleIds.push(id);
    }
  }
  includeCycleIds.push(current.id);

  const totalsByItem = await plannedNewRequirementAndApprovedProducedTotalsByItemForCycles(soId, includeCycleIds);
  const out = new Map();
  for (const [itemId, v] of totalsByItem) {
    const planned = v.planned;
    const produced = v.produced;
    const rawShortfall = Math.max(0, planned - produced);
    if (rawShortfall > EPS) out.set(itemId, { rawShortfall, planned, produced });
  }
  if (soId === 14) {
    // eslint-disable-next-line no-console
    console.info("[NO_QTY_CARRY_FORWARD_NET]", {
      soId,
      currentCycleId: current.id,
      includedCycleIds: includeCycleIds,
      byItem: [...out.entries()].map(([itemId, v]) => ({ itemId, ...v })),
    });
  }
  return out;
}

/**
 * Per FG item: running NO_QTY shortfall for planning (unproduced planning balance):
 *   rawShortfall = max(0, SUM(plannedQty on non-REJECTED WOs in these cycles) − SUM(APPROVED producedQty recorded so far))
 *
 * Key semantics:
 * - Does NOT wait for WO completion; this is operational "not yet produced" qty.
 * - Does NOT use dispatch; dispatch is downstream and often lags QC/production.
 * - QC acceptance/rejection does NOT change this shortfall; this is carry-forward for next Requirement Sheet.
 *
 * @param {number} soId
 * @param {number[]} cycleIds
 * @returns {Promise<Map<number, { rawShortfall: number; planned: number; produced: number }>>}
 */
async function plannedMinusApprovedProducedByItemForCycles(soId, cycleIds) {
  const ids = (cycleIds || []).filter((x) => Number.isFinite(x) && x > 0);
  if (!ids.length) return new Map();

  const woLines = await prisma.workOrderLine.findMany({
    where: {
      workOrder: {
        salesOrderId: soId,
        cycleId: { in: ids },
        status: { not: "REJECTED" },
      },
    },
    select: { id: true, fgItemId: true, plannedQty: true, qty: true },
  });
  if (!woLines.length) return new Map();

  const lineIds = woLines.map((l) => l.id);
  const plannedByItem = new Map();
  for (const l of woLines) {
    const planned = n(l.plannedQty ?? l.qty);
    plannedByItem.set(l.fgItemId, (plannedByItem.get(l.fgItemId) || 0) + planned);
  }

  const lineIdToItemId = new Map(woLines.map((l) => [l.id, l.fgItemId]));

  const prodAgg = await prisma.productionEntry.groupBy({
    by: ["workOrderLineId"],
    where: { workOrderLineId: { in: lineIds }, workflowStatus: "APPROVED" },
    _sum: { producedQty: true },
  });

  /** @type {Map<number, number>} */
  const producedByLineId = new Map();
  for (const r of prodAgg) {
    const lineId = Number(r.workOrderLineId);
    if (!lineId) continue;
    producedByLineId.set(lineId, n(r._sum.producedQty));
  }

  const producedByItem = new Map();
  for (const [lineId, produced] of producedByLineId) {
    const itemId = lineIdToItemId.get(lineId);
    if (!itemId) continue;
    producedByItem.set(itemId, (producedByItem.get(itemId) || 0) + produced);
  }

  const out = new Map();
  for (const [itemId, planned] of plannedByItem) {
    const produced = producedByItem.get(itemId) || 0;
    const rawShortfall = Math.max(0, planned - produced);
    if (rawShortfall > EPS) out.set(itemId, { rawShortfall, planned, produced });
  }
  return out;
}

/**
 * Per FG item: cumulative totals used for net carry-forward.
 * Returns totals (planned, produced) without applying max() at intermediate boundaries.
 *
 * @param {number} soId
 * @param {number[]} cycleIds
 * @returns {Promise<Map<number, { planned: number; produced: number }>>}
 */
async function plannedNewRequirementAndApprovedProducedTotalsByItemForCycles(soId, cycleIds) {
  const ids = (cycleIds || []).filter((x) => Number.isFinite(x) && x > 0);
  if (!ids.length) return new Map();

  // Planned = NEW requirement only from LOCKED requirement sheets in these cycles (does not include carried shortage).
  const lockedLines = await prisma.requirementSheetLine.findMany({
    where: {
      sheet: {
        salesOrderId: soId,
        status: "LOCKED",
        cycleId: { in: ids },
      },
    },
    select: { itemId: true, requirementQty: true, shortfallQtySnapshot: true },
  });
  if (!lockedLines.length) return new Map();

  const plannedByItem = new Map();
  for (const l of lockedLines) {
    // Historical compatibility:
    // - Older LOCKED rows persisted `requirementQty` as fulfillment (shortfall + new).
    // - New semantics persist `requirementQty` as NEW requirement only.
    // We normalize planned NEW requirement as: max(0, requirementQty - shortfallSnapshot).
    const req = n(l.requirementQty);
    const sf = l.shortfallQtySnapshot != null ? n(l.shortfallQtySnapshot) : 0;
    const plannedNew = Math.max(0, round3(req - sf));
    plannedByItem.set(l.itemId, (plannedByItem.get(l.itemId) || 0) + plannedNew);
  }

  // Produced = APPROVED production quantities linked to WOs in these cycles (regardless of QC).
  const woLines = await prisma.workOrderLine.findMany({
    where: {
      workOrder: {
        salesOrderId: soId,
        cycleId: { in: ids },
        status: { not: "REJECTED" },
      },
    },
    select: { id: true, fgItemId: true },
  });
  const lineIds = woLines.map((l) => l.id);
  const lineIdToItemId = new Map(woLines.map((l) => [l.id, l.fgItemId]));

  const prodAgg = await prisma.productionEntry.groupBy({
    by: ["workOrderLineId"],
    where: { workOrderLineId: { in: lineIds }, workflowStatus: "APPROVED" },
    _sum: { producedQty: true },
  });
  const producedByItem = new Map();
  for (const r of prodAgg) {
    const lineId = Number(r.workOrderLineId);
    if (!lineId) continue;
    const itemId = lineIdToItemId.get(lineId);
    if (!itemId) continue;
    producedByItem.set(itemId, (producedByItem.get(itemId) || 0) + n(r._sum.producedQty));
  }

  const out = new Map();
  for (const [itemId, planned] of plannedByItem) {
    const produced = producedByItem.get(itemId) || 0;
    out.set(itemId, { planned, produced });
  }
  return out;
}

async function assertSoNoQtyOrThrow(tx, soId) {
  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    include: { customer: true, po: { include: { customer: true } }, lines: { include: { item: true } } },
  });
  if (!so) {
    const err = new Error("Sales order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (so.orderType !== "NO_QTY") {
    const err = new Error("Requirement sheet is allowed only for No Qty sales orders.");
    err.statusCode = 409;
    throw err;
  }
  if (so.internalStatus === "CLOSED") {
    const err = new Error("This sales order is closed. Requirement Sheet is view-only.");
    err.statusCode = 409;
    throw err;
  }
  return so;
}

async function mapSheetDetail(sheet) {
  const customerName = sheet?.salesOrder?.customer?.name ?? sheet?.salesOrder?.po?.customer?.name ?? sheet?.customerNameSnapshot ?? null;

  const existingWo = await prisma.workOrder.findFirst({
    where: { requirementSheetId: sheet.id },
    select: { id: true },
  });

  const stockMap = await stockByItemIdUsable();
  // For NO_QTY draft planning clarity: compute pending-dispatch reserve for THIS sales order
  // (separate from the global free-stock computation which reserves across all OPEN SOs).
  /** @type {Map<number, { reservedDemand: number; reservedApplied: number; usableTotal: number }>} */
  const noQtyReserveForThisSoByItem = new Map();
  if (sheet?.salesOrder?.orderType === "NO_QTY") {
    const soId = Number(sheet.salesOrderId);
    if (Number.isFinite(soId) && soId > 0) {
      const dispRows = await prisma.dispatch.findMany({
        where: { soId, reversalOfId: null },
        select: { itemId: true, dispatchedQty: true },
      });
      const revRows = await prisma.dispatch.findMany({
        where: { soId, reversalOfId: { not: null } },
        select: { itemId: true, dispatchedQty: true },
      });
      const netOpByItem = new Map();
      for (const d of dispRows) {
        const itemId = Number(d.itemId);
        if (!itemId) continue;
        netOpByItem.set(itemId, (netOpByItem.get(itemId) ?? 0) + n(d.dispatchedQty));
      }
      for (const d of revRows) {
        const itemId = Number(d.itemId);
        if (!itemId) continue;
        netOpByItem.set(itemId, (netOpByItem.get(itemId) ?? 0) - n(d.dispatchedQty));
      }

      const qcAcceptedMap = await buildQcAcceptedMap(prisma);

      // APPROVED produced totals per item for this SO (any cycle).
      const woLines = await prisma.workOrderLine.findMany({
        where: { workOrder: { salesOrderId: soId, status: { not: "REJECTED" } } },
        select: { id: true, fgItemId: true, workOrder: { select: { salesOrderId: true } } },
      });
      const wolIds = woLines.map((l) => Number(l.id)).filter((x) => Number.isFinite(x) && x > 0);
      const wolMeta = new Map(woLines.map((l) => [Number(l.id), Number(l.fgItemId)]));
      const approvedProducedByItem = new Map();
      if (wolIds.length) {
        const prodAgg = await prisma.productionEntry.groupBy({
          by: ["workOrderLineId"],
          where: { workOrderLineId: { in: wolIds }, workflowStatus: "APPROVED" },
          _sum: { producedQty: true },
        });
        for (const r of prodAgg) {
          const itemId = wolMeta.get(Number(r.workOrderLineId));
          if (!itemId) continue;
          approvedProducedByItem.set(itemId, (approvedProducedByItem.get(itemId) ?? 0) + n(r._sum.producedQty));
        }
      }

      for (const [itemId, totalUsable] of stockMap.entries()) {
        const key = `${soId}:${itemId}`;
        const qcAccepted = n(qcAcceptedMap.get(key) ?? 0);
        const approvedProduced = n(approvedProducedByItem.get(itemId) ?? 0);
        const netOp = n(netOpByItem.get(itemId) ?? 0);
        const reservedBase = Math.max(qcAccepted, approvedProduced);
        const reservedDemand = Math.max(0, reservedBase - netOp);
        const reservedApplied = Math.min(Math.max(0, n(totalUsable)), reservedDemand);
        noQtyReserveForThisSoByItem.set(itemId, {
          reservedDemand: round3(reservedDemand),
          reservedApplied: round3(reservedApplied),
          usableTotal: round3(usableStockDisplayQty(n(totalUsable))),
        });
      }
    }
  }
  const freeNoQtyStockMap =
    sheet?.salesOrder?.orderType === "NO_QTY" && sheet.status !== "LOCKED"
      ? await freeUsableFgStockByItemForNoQtyPlanning({
          salesOrderId: sheet.salesOrderId,
          activeCycleId: sheet.cycleId ?? sheet.salesOrder?.currentCycleId ?? null,
        })
      : null;
  const shortfallByItem = await loadNoQtyCarryForwardShortfallByItem({
    salesOrderId: sheet.salesOrderId,
    currentCycleId: sheet.cycleId ?? sheet.salesOrder?.currentCycleId ?? null,
  });

  const lines = (sheet.lines || []).map((ln) => {
    const item = ln.item;
    const greenTh = item?.planningGapGreenThresholdPercent ?? null;
    const yellowTh = item?.planningGapYellowThresholdPercent ?? null;
    const newWoQty = n(ln.requirementQty);

    let availableStockQty = null;
    let gapPercent = null;
    let totalWoQty = null;
    let zone = null;
    let shortfallQty = null;
    let stockCoveredNote = false;
    let qcStockNote = null;
    let fulfillmentQty = null;
    let coveredFromStockQty = null;
    let productionRequiredQty = null;
    /** System recommendation: total to produce = max(0, carry-forward + new requirement − free usable stock). */
    let suggestedNetWoQty = 0;
    /** DRAFT only: QC-usable stock used for suggested WO (same source as `availableStockQty` on the line). */
    let draftUsableStockForSuggest = 0;

    if (sheet.status === "LOCKED") {
      const rawSnapStock = ln.availableStockQtySnapshot != null ? n(ln.availableStockQtySnapshot) : null;
      // Operational display: match Stock Summary / dashboard (floor at 0); do not treat negative ledger as cover.
      availableStockQty = rawSnapStock != null ? usableStockDisplayQty(rawSnapStock) : null;
      shortfallQty = ln.shortfallQtySnapshot != null ? n(ln.shortfallQtySnapshot) : 0;
      // LOCKED semantics (NO_QTY): `requirementQty` remains NEW requirement only.
      // Fulfillment for this cycle = shortfall snapshot + new requirement.
      fulfillmentQty = round3(round3(shortfallQty) + round3(newWoQty));
      coveredFromStockQty =
        availableStockQty != null ? round3(Math.min(fulfillmentQty, availableStockQty)) : null;
      productionRequiredQty =
        availableStockQty != null
          ? round3(Math.max(0, fulfillmentQty - availableStockQty))
          : ln.suggestedWoQtySnapshot != null
            ? round3(n(ln.suggestedWoQtySnapshot))
            : null;
      gapPercent = computeGapPercent(fulfillmentQty, availableStockQty ?? 0);
      zone = computeZone(gapPercent, greenTh, yellowTh);
      totalWoQty = productionRequiredQty;
      if (gapPercent != null && gapPercent < 0) {
        zone = "EXCESS";
        totalWoQty = 0;
      }
      if (totalWoQty != null && totalWoQty < 0) totalWoQty = 0;
    } else {
      const rawTotal = stockMap.get(ln.itemId) ?? 0;
      const rawFree =
        freeNoQtyStockMap?.get(ln.itemId) ??
        (sheet?.salesOrder?.orderType === "NO_QTY" ? 0 : null) ??
        (stockMap.get(ln.itemId) ?? 0);
      const rawStock = rawFree;
      const stock = usableStockDisplayQty(rawStock);
      draftUsableStockForSuggest = round3(stock);
      availableStockQty = draftUsableStockForSuggest;
      const rawShortfall = shortfallByItem.get(ln.itemId)?.rawShortfall ?? 0;
      // Show gross carry-forward from prior cycles in Shortfall; net production need uses stock once below.
      shortfallQty = round3(rawShortfall);
      // Draft semantics (NO_QTY): user input is the new cycle fulfillment intent (may be 0 until entered).
      // Fulfillment includes carry-forward shortfall, because dispatch cap is defined by total fulfillment per cycle.
      const grossFulfillment = round3(round3(rawShortfall) + round3(newWoQty));
      fulfillmentQty = grossFulfillment;
      coveredFromStockQty = round3(Math.min(grossFulfillment, stock));
      productionRequiredQty = round3(Math.max(0, grossFulfillment - stock));
      gapPercent = computeGapPercent(grossFulfillment, stock);
      zone = computeZone(gapPercent, greenTh, yellowTh);
      stockCoveredNote = grossFulfillment > EPS && stock > EPS;
      totalWoQty = productionRequiredQty;

      if (
        sheet?.salesOrder?.orderType === "NO_QTY" &&
        usableStockDisplayQty(rawTotal) > EPS &&
        usableStockDisplayQty(rawFree) <= EPS
      ) {
        stockCoveredNote = false;
        qcStockNote = "Stock reserved for dispatch – not available for planning";
      } else if (stockCoveredNote) {
        qcStockNote = "QC passed stock is available";
      }
    }

    // enforce excess semantics
    if (gapPercent != null && gapPercent < 0) {
      zone = "EXCESS";
      totalWoQty = 0;
    }
    if (totalWoQty != null && totalWoQty < 0) totalWoQty = 0;

    if (sheet.status === "LOCKED") {
      const ful = fulfillmentQty != null ? round3(n(fulfillmentQty)) : 0;
      const sf = round3(n(shortfallQty ?? 0));
      const newPortion = round3(Math.max(0, ful - sf));
      const stockForSug = round3(n(availableStockQty ?? 0));
      suggestedNetWoQty = newPortion <= EPS ? 0 : round3(Math.max(0, newPortion - stockForSug));
    } else {
      // NO_QTY: suggested == total to produce for this cycle (carry-forward + new requirement − free usable stock)
      const sf = round3(n(shortfallQty ?? 0));
      suggestedNetWoQty = round3(Math.max(0, round3(sf) + round3(newWoQty) - round3(draftUsableStockForSuggest)));
    }
    if (zone === "EXCESS") suggestedNetWoQty = 0;

    return {
      id: ln.id,
      itemId: ln.itemId,
      itemName: item?.itemName ?? `Item #${ln.itemId}`,
      shortfallQty,
      qcStockNote,
      ...(sheet?.salesOrder?.orderType === "NO_QTY" && sheet.status !== "LOCKED"
        ? (() => {
            const r = noQtyReserveForThisSoByItem.get(ln.itemId) ?? null;
            return r
              ? {
                  usableTotalQty: r.usableTotal,
                  reservedPendingDispatchQty: r.reservedDemand,
                  reservedPendingDispatchAppliedQty: r.reservedApplied,
                }
              : { usableTotalQty: null, reservedPendingDispatchQty: null, reservedPendingDispatchAppliedQty: null };
          })()
        : {}),
      newWoQty: String(round3(newWoQty)),
      /** NO_QTY: total fulfillment qty in this cycle (carry-forward + new). */
      fulfillmentQty: fulfillmentQty != null ? round3(fulfillmentQty) : null,
      /** NO_QTY: portion of fulfillment covered from usable stock (snapshot in LOCKED; live in DRAFT). */
      coveredFromStockQty: coveredFromStockQty != null ? round3(coveredFromStockQty) : null,
      /** NO_QTY: production-required portion (snapshot in LOCKED; live in DRAFT). */
      productionRequiredQty: productionRequiredQty != null ? round3(productionRequiredQty) : null,
      totalWoQty,
      // Backward compatibility for existing frontend draft-save payloads.
      requirementQty: String(round3(newWoQty)),
      availableStockQty,
      gapPercent,
      suggestedWoQty: suggestedNetWoQty,
      yellowThreshold: yellowTh != null ? n(yellowTh) : null,
      greenThreshold: greenTh != null ? n(greenTh) : null,
      colorZone: zone,
    };
  });

  return {
    id: sheet.id,
    docNo: sheet.docNo ?? null,
    salesOrderId: sheet.salesOrderId,
    salesOrderDocNo: sheet.salesOrder?.docNo ?? null,
    cycleId: sheet.cycleId ?? null,
    status: sheet.status,
    periodKey: sheet.periodKey,
    version: sheet.version,
    workOrderId: existingWo?.id ?? null,
    sourceReference: null,
    remarks: sheet.remarks ?? null,
    customerName,
    lines,
  };
}

// GET /api/sales-orders/:id/requirement-sheets
requirementSheetsRouter.get(
  "/sales-orders/:id/requirement-sheets",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) return res.status(400).json(friendly400("Invalid sales order id."));
      await prisma.$transaction((tx) => assertSoNoQtyOrThrow(tx, soId));

      const rows = await prisma.requirementSheet.findMany({
        where: { salesOrderId: soId },
        orderBy: [{ periodKey: "desc" }, { version: "desc" }, { id: "desc" }],
        select: { id: true, periodKey: true, version: true, status: true, cycleId: true, createdAt: true },
      });
      return res.json(rows);
    } catch (e) {
      return next(e);
    }
  },
);

// POST /api/sales-orders/:id/requirement-sheets
requirementSheetsRouter.post(
  "/sales-orders/:id/requirement-sheets",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) return res.status(400).json(friendly400("Invalid sales order id."));
      const body = z
        .object({
          periodKey: z.string().min(1).max(16),
          remarks: z.string().optional().nullable(),
          /**
           * NO_QTY planning must be explicit per cycle.
           * Do not auto-include all FG items from the sales order into every cycle.
           */
          itemIds: z.array(z.number().int().positive()).min(1),
        })
        .parse(req.body);
      const periodKey = body.periodKey.trim();

      const created = await prisma.$transaction(async (tx) => {
        const so = await assertSoNoQtyOrThrow(tx, soId);
        const cycleId = await resolveNoQtyActiveCycleIdForPlanning(tx, soId);

        const maxV = await tx.requirementSheet.aggregate({
          where: { salesOrderId: soId, cycleId, periodKey },
          _max: { version: true },
        });
        const nextVersion = Math.max(1, Number(maxV._max.version || 0) + 1);

        const fgLines = (so.lines || []).filter((l) => l.item?.itemType === "FG");
        const allowedFgItemIds = new Set(fgLines.map((l) => l.itemId));
        const requested = [...new Set((body.itemIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))];
        const selectedItemIds = requested.filter((id) => allowedFgItemIds.has(id));

        if (!fgLines.length) {
          const err = new Error("No FG items found on this sales order.");
          err.statusCode = 409;
          throw err;
        }
        if (!selectedItemIds.length) {
          const err = new Error("Select at least one FG item for this cycle.");
          err.statusCode = 400;
          throw err;
        }
        if (selectedItemIds.length !== requested.length) {
          const err = new Error("One or more selected items are not valid FG items for this sales order.");
          err.statusCode = 400;
          throw err;
        }

        const sheet = await tx.requirementSheet.create({
          data: {
            docNo: await allocateDocNo(tx, { docType: DocType.REQUIREMENT_SHEET, date: new Date() }),
            salesOrderId: soId,
            cycleId,
            periodKey,
            version: nextVersion,
            status: "DRAFT",
            remarks: body.remarks?.trim() || null,
            lines: {
              create: selectedItemIds.map((itemId) => ({
                itemId,
                requirementQty: 0,
              })),
            },
          },
          select: { id: true },
        });
        return sheet;
      });

      return res.status(201).json({ id: created.id });
    } catch (e) {
      return next(e);
    }
  },
);

// GET /api/requirement-sheets/:id
requirementSheetsRouter.get(
  "/requirement-sheets/:id",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));

      const sheet = await prisma.requirementSheet.findUnique({
        where: { id },
        include: {
          salesOrder: { include: { customer: true, po: { include: { customer: true } } } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
        },
      });
      if (!sheet) return res.status(404).json(friendly400("Requirement sheet not found."));
      if (sheet.salesOrder?.orderType !== "NO_QTY") return res.status(409).json(friendly400("Requirement sheet is allowed only for No Qty sales orders."));

      return res.json(await mapSheetDetail(sheet));
    } catch (e) {
      return next(e);
    }
  },
);

const DELETE_DRAFT_RS_BLOCKED =
  "Cannot delete. This requirement is already used in downstream processes.";

/**
 * Draft requirement sheets may be deleted only when nothing references this sheet downstream.
 * Dispatch rows do not store requirementSheetId; linkage is enforced via Work Orders created from this sheet.
 */
async function assertDraftRequirementSheetDeletable(tx, sheetId) {
  const sheet = await tx.requirementSheet.findUnique({
    where: { id: sheetId },
    select: { id: true, status: true, salesOrderId: true, cycleId: true },
  });
  if (!sheet) {
    const err = new Error("Requirement sheet not found.");
    err.statusCode = 404;
    throw err;
  }
  if (sheet.status !== "DRAFT") {
    const err = new Error("Cannot delete. Only draft requirement sheets can be deleted.");
    err.statusCode = 409;
    throw err;
  }

  const so = await tx.salesOrder.findUnique({
    where: { id: sheet.salesOrderId },
    select: { id: true, orderType: true, internalStatus: true },
  });
  if (!so || so.orderType !== "NO_QTY") {
    const err = new Error("Requirement sheet is allowed only for No Qty sales orders.");
    err.statusCode = 409;
    throw err;
  }
  if (so.internalStatus === "CLOSED") {
    const err = new Error("This sales order is closed. Requirement Sheet is view-only.");
    err.statusCode = 409;
    throw err;
  }

  const woCount = await tx.workOrder.count({
    where: { requirementSheetId: sheetId },
  });
  if (woCount > 0) {
    const err = new Error(DELETE_DRAFT_RS_BLOCKED);
    err.statusCode = 409;
    throw err;
  }

  const prodCount = await tx.productionEntry.count({
    where: {
      workOrderLine: {
        workOrder: { requirementSheetId: sheetId },
      },
    },
  });
  if (prodCount > 0) {
    const err = new Error(DELETE_DRAFT_RS_BLOCKED);
    err.statusCode = 409;
    throw err;
  }

  const qcCount = await tx.qcEntry.count({
    where: {
      production: {
        workOrderLine: {
          workOrder: { requirementSheetId: sheetId },
        },
      },
    },
  });
  if (qcCount > 0) {
    const err = new Error(DELETE_DRAFT_RS_BLOCKED);
    err.statusCode = 409;
    throw err;
  }

  return sheet;
}

// DELETE /api/requirement-sheets/:id — draft only, no downstream rows
requirementSheetsRouter.delete(
  "/requirement-sheets/:id",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));

      await prisma.$transaction(async (tx) => {
        await assertDraftRequirementSheetDeletable(tx, id);
        await tx.requirementSheet.delete({ where: { id } });
      });

      return res.status(204).send();
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * DELETE /api/requirement-sheets/by-sales-order/:salesOrderId
 * NO_QTY repair: delete all Requirement Sheets for one Sales Order, only when no downstream rows exist.
 *
 * Idempotent: if no sheets exist, returns ok with empty deleted list.
 *
 * Safety invariants (must all be zero):
 * - WorkOrder where requirementSheetId in sheets
 * - ProductionEntry linked to those WOs
 * - QcEntry linked to those productions
 * - Dispatch rows for this SO in any of the sheet cycles
 * - SalesBill rows for those dispatches / cycles
 */
requirementSheetsRouter.delete(
  "/requirement-sheets/by-sales-order/:salesOrderId",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.salesOrderId);
      if (!Number.isFinite(soId) || soId <= 0) return res.status(400).json(friendly400("Invalid salesOrderId."));

      const result = await prisma.$transaction(async (tx) => {
        const so = await tx.salesOrder.findUnique({
          where: { id: soId },
          select: { id: true, orderType: true, internalStatus: true, docNo: true },
        });
        if (!so) {
          const err = new Error("Sales order not found.");
          err.statusCode = 404;
          throw err;
        }
        if (so.orderType !== "NO_QTY") {
          const err = new Error("This endpoint is allowed only for No Qty sales orders.");
          err.statusCode = 409;
          throw err;
        }

        const sheets = await tx.requirementSheet.findMany({
          where: { salesOrderId: soId },
          orderBy: [{ id: "asc" }],
          include: { lines: { select: { id: true } }, workOrders: { select: { id: true } } },
        });
        const sheetIds = sheets.map((s) => s.id);
        if (!sheetIds.length) {
          return {
            salesOrderId: soId,
            salesOrderDocNo: so.docNo ?? null,
            deletedRequirementSheetIds: [],
            deletedRequirementSheetLineCount: 0,
            message: "No requirement sheets found to delete.",
          };
        }

        const cycleIds = [
          ...new Set(
            sheets
              .map((s) => (s.cycleId != null ? Number(s.cycleId) : null))
              .filter((x) => Number.isFinite(x) && x > 0),
          ),
        ];

        // Downstream guards
        const woCount = await tx.workOrder.count({ where: { requirementSheetId: { in: sheetIds } } });
        if (woCount > 0) {
          const woIds = (
            await tx.workOrder.findMany({
              where: { requirementSheetId: { in: sheetIds } },
              select: { id: true, docNo: true, requirementSheetId: true },
              orderBy: { id: "asc" },
              take: 20,
            })
          ).map((w) => ({ id: w.id, docNo: w.docNo ?? null, requirementSheetId: w.requirementSheetId ?? null }));
          const err = new Error("Cannot delete requirement sheets: work order(s) exist.");
          err.statusCode = 409;
          err.details = { workOrdersFound: woIds, workOrderCount: woCount };
          throw err;
        }

        const prodCount = await tx.productionEntry.count({
          where: { workOrderLine: { workOrder: { requirementSheetId: { in: sheetIds } } } },
        });
        if (prodCount > 0) {
          const err = new Error("Cannot delete requirement sheets: production entry exists.");
          err.statusCode = 409;
          err.details = { productionEntryCount: prodCount };
          throw err;
        }

        const qcCount = await tx.qcEntry.count({
          where: { production: { workOrderLine: { workOrder: { requirementSheetId: { in: sheetIds } } } } },
        });
        if (qcCount > 0) {
          const err = new Error("Cannot delete requirement sheets: QC entry exists.");
          err.statusCode = 409;
          err.details = { qcEntryCount: qcCount };
          throw err;
        }

        const dispatchCount = cycleIds.length
          ? await tx.dispatch.count({ where: { soId: soId, cycleId: { in: cycleIds } } })
          : await tx.dispatch.count({ where: { soId: soId } });
        if (dispatchCount > 0) {
          const err = new Error("Cannot delete requirement sheets: dispatch record exists for this sales order/cycle.");
          err.statusCode = 409;
          err.details = { dispatchCount, cycleIds };
          throw err;
        }

        const salesBillCount = cycleIds.length
          ? await tx.salesBill.count({ where: { cycleId: { in: cycleIds }, dispatch: { soId: soId } } })
          : await tx.salesBill.count({ where: { dispatch: { soId: soId } } });
        if (salesBillCount > 0) {
          const err = new Error("Cannot delete requirement sheets: sales bill exists for this sales order/cycle.");
          err.statusCode = 409;
          err.details = { salesBillCount, cycleIds };
          throw err;
        }

        const lineCount = sheets.reduce((s, sh) => s + (sh.lines?.length ?? 0), 0);

        // Delete in correct order
        await tx.requirementSheetLine.deleteMany({ where: { sheetId: { in: sheetIds } } });
        await tx.requirementSheet.deleteMany({ where: { id: { in: sheetIds } } });

        return {
          salesOrderId: soId,
          salesOrderDocNo: so.docNo ?? null,
          deletedRequirementSheetIds: sheetIds,
          deletedRequirementSheetLineCount: lineCount,
          message: "Requirement sheets deleted successfully.",
        };
      });

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

// PUT /api/requirement-sheets/:id (remarks only)
requirementSheetsRouter.put(
  "/requirement-sheets/:id",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));
      const body = z.object({ remarks: z.string().optional().nullable() }).parse(req.body);

      const sheet = await prisma.requirementSheet.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!sheet) return res.status(404).json(friendly400("Requirement sheet not found."));
      if (sheet.status !== "DRAFT") return res.status(409).json(friendly400("Locked sheets cannot be edited."));

      await prisma.requirementSheet.update({
        where: { id },
        data: { remarks: body.remarks?.trim() || null },
      });
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  },
);

// PUT /api/requirement-sheets/:id/lines
requirementSheetsRouter.put(
  "/requirement-sheets/:id/lines",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));
      const body = z
        .object({
          lines: z.array(z.object({ itemId: z.number().int().positive(), requirementQty: z.number().nonnegative() })).min(1),
        })
        .parse(req.body);

      await prisma.$transaction(async (tx) => {
        const sheet = await tx.requirementSheet.findUnique({
          where: { id },
          include: { salesOrder: true, lines: true },
        });
        if (!sheet) {
          const err = new Error("Requirement sheet not found.");
          err.statusCode = 404;
          throw err;
        }
        if (sheet.status !== "DRAFT") {
          const err = new Error("Locked sheets cannot be edited.");
          err.statusCode = 409;
          throw err;
        }
        if (sheet.salesOrder?.orderType !== "NO_QTY") {
          const err = new Error("Requirement sheet is allowed only for No Qty sales orders.");
          err.statusCode = 409;
          throw err;
        }

        const activeCycleId = await resolveNoQtyActiveCycleIdForPlanning(tx, sheet.salesOrderId);
        if (sheet.cycleId == null || Number(sheet.cycleId) !== Number(activeCycleId)) {
          await tx.requirementSheet.update({ where: { id }, data: { cycleId: activeCycleId } });
        }

        const allowed = new Set((sheet.lines || []).map((l) => l.itemId));
        for (const ln of body.lines) {
          if (!allowed.has(ln.itemId)) {
            const err = new Error("Invalid item in sheet lines.");
            err.statusCode = 400;
            throw err;
          }
        }

        for (const ln of body.lines) {
          await tx.requirementSheetLine.updateMany({
            where: { sheetId: id, itemId: ln.itemId },
            data: { requirementQty: ln.requirementQty },
          });
        }
      });

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  },
);

// POST /api/requirement-sheets/:id/recalculate
requirementSheetsRouter.post(
  "/requirement-sheets/:id/recalculate",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));

      const body = z
        .object({
          lines: z
            .array(
              z.object({
                itemId: z.number(),
                requirementQty: z.number(),
              }),
            )
            .optional()
            .nullable(),
        })
        .optional()
        .nullable()
        .parse(req.body ?? {});

      const before = await prisma.requirementSheet.findUnique({
        where: { id },
        include: { salesOrder: true, lines: { select: { itemId: true, requirementQty: true } } },
      });
      if (!before) return res.status(404).json(friendly400("Requirement sheet not found."));
      if (before.status !== "DRAFT") return res.status(409).json(friendly400("Locked sheets cannot be recalculated."));
      if (before.salesOrder?.orderType !== "NO_QTY") return res.status(409).json(friendly400("Requirement sheet is allowed only for No Qty sales orders."));

      await prisma.$transaction(async (tx) => {
        const activeCycleId = await resolveNoQtyActiveCycleIdForPlanning(tx, before.salesOrderId);
        if (before.cycleId == null || Number(before.cycleId) !== Number(activeCycleId)) {
          await tx.requirementSheet.update({ where: { id }, data: { cycleId: activeCycleId } });
        }

        // If the client sent draft line values, persist them first so recalc uses latest edits.
        const incomingLines = Array.isArray(body?.lines) ? body.lines : [];
        if (incomingLines.length) {
          for (const ln of incomingLines) {
            await tx.requirementSheetLine.updateMany({
              where: { sheetId: id, itemId: ln.itemId },
              data: { requirementQty: ln.requirementQty },
            });
          }
        }

        await tx.requirementSheet.update({ where: { id }, data: { recalculatedAt: new Date() } });
      });

      const sheet = await prisma.requirementSheet.findUnique({
        where: { id },
        include: { salesOrder: { include: { customer: true, po: { include: { customer: true } } } }, lines: { include: { item: true }, orderBy: { id: "asc" } } },
      });
      if (!sheet) return res.status(404).json(friendly400("Requirement sheet not found."));

      // TEMP defensive logging for NO_QTY recalc stale-value bugs.
      try {
        const incomingByItemId = new Map();
        for (const ln of Array.isArray(body?.lines) ? body.lines : []) incomingByItemId.set(Number(ln.itemId), Number(ln.requirementQty));

        const beforeByItemId = new Map();
        for (const ln of before.lines || []) beforeByItemId.set(Number(ln.itemId), Number(ln.requirementQty));

        const stockMap = await stockByItemIdUsable();
        const shortfallByItem = await loadNoQtyCarryForwardShortfallByItem({
          salesOrderId: sheet.salesOrderId,
          currentCycleId: sheet.cycleId,
        });

        // eslint-disable-next-line no-console
        console.debug("[NO_QTY_RS_RECALC]", {
          sheetId: sheet.id,
          salesOrderId: sheet.salesOrderId,
          cycleId: sheet.cycleId,
          incomingLineCount: incomingByItemId.size,
        });

        for (const ln of sheet.lines || []) {
          const usableStockQty = Number(stockMap.get(ln.itemId) ?? 0);
          const lastShortageQty = Number(shortfallByItem.get(ln.itemId)?.rawShortfall ?? 0);
          const persistedAfterReqQty = n(ln.requirementQty);
          const persistedBeforeReqQty = Number(beforeByItemId.get(Number(ln.itemId)) ?? 0);
          const incomingReqQty = incomingByItemId.has(Number(ln.itemId)) ? Number(incomingByItemId.get(Number(ln.itemId))) : null;
          const suggestedWoQty = round3(Math.max(0, round3(persistedAfterReqQty) - round3(usableStockQty)));
          // eslint-disable-next-line no-console
          console.debug("[NO_QTY_RS_RECALC_LINE]", {
            sheetId: sheet.id,
            itemId: ln.itemId,
            incomingRequirementQty: incomingReqQty,
            persistedRequirementQtyBefore: persistedBeforeReqQty,
            persistedRequirementQtyAfter: persistedAfterReqQty,
            usableStockQty,
            lastShortageQty,
            suggestedWoQty,
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.debug("[NO_QTY_RS_RECALC_LOG_FAILED]", e instanceof Error ? e.message : String(e));
      }

      return res.json(await mapSheetDetail(sheet));
    } catch (e) {
      return next(e);
    }
  },
);

// POST /api/requirement-sheets/:id/lock
requirementSheetsRouter.post(
  "/requirement-sheets/:id/lock",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));

      const sheet = await prisma.$transaction(async (tx) => {
        const existing = await tx.requirementSheet.findUnique({
          where: { id },
          include: { salesOrder: { include: { customer: true, po: { include: { customer: true } } } }, lines: { include: { item: true }, orderBy: { id: "asc" } } },
        });
        if (!existing) {
          const err = new Error("Requirement sheet not found.");
          err.statusCode = 404;
          throw err;
        }
        if (existing.status !== "DRAFT") {
          const err = new Error("Sheet is already locked.");
          err.statusCode = 409;
          throw err;
        }
        if (existing.salesOrder?.orderType !== "NO_QTY") {
          const err = new Error("Requirement sheet is allowed only for No Qty sales orders.");
          err.statusCode = 409;
          throw err;
        }

        const activeCycleId = await resolveNoQtyActiveCycleIdForPlanning(tx, existing.salesOrderId);

        // Always move NO_QTY SO into IN_PROCESS once a requirement sheet is locked (workflow started).
        await tx.salesOrder.update({
          where: { id: existing.salesOrderId },
          data: { internalStatus: "IN_PROCESS", currentCycleId: activeCycleId },
        });
        if (!existing.cycleId || Number(existing.cycleId) !== Number(activeCycleId)) {
          await tx.requirementSheet.update({ where: { id }, data: { cycleId: activeCycleId } });
        }

        const stockMap = await stockByItemIdUsable();
        // NO_QTY planning: lock snapshots must use FREE usable stock (not QC-passed stock reserved for dispatch).
        // Otherwise the created WO is incorrectly reduced by reserved stock.
        const freeStockMap = await freeUsableFgStockByItemForNoQtyPlanning({
          salesOrderId: existing.salesOrderId,
          activeCycleId,
        });
        const shortfallByItem = await loadNoQtyCarryForwardShortfallByItem({
          salesOrderId: existing.salesOrderId,
          currentCycleId: activeCycleId,
        });

        let anyPositiveFulfillment = false;
        for (const ln of existing.lines || []) {
          const item = ln.item;
          const newWoQty = n(ln.requirementQty);
          const rawTotalStock = stockMap.get(ln.itemId) ?? 0;
          const rawFreeStock = freeStockMap.get(ln.itemId) ?? 0;
          const stock = usableStockDisplayQty(rawFreeStock);
          const rawShortfall = shortfallByItem.get(ln.itemId)?.rawShortfall ?? 0;
          const fulfillmentQty = round3(round3(rawShortfall) + round3(newWoQty));
          const coveredFromStockQty = Math.min(fulfillmentQty, stock);
          const productionRequiredQty = round3(Math.max(0, fulfillmentQty - stock));
          const gapPercent = computeGapPercent(fulfillmentQty, stock);
          const zone = computeZone(gapPercent, item?.planningGapGreenThresholdPercent, item?.planningGapYellowThresholdPercent);
          if (fulfillmentQty > EPS) anyPositiveFulfillment = true;

          await tx.requirementSheetLine.update({
            where: { id: ln.id },
            data: {
              // NO_QTY semantics:
              // - requirementQty stays as the user's NEW requirement only
              // - shortfallQtySnapshot captures carry-forward from previous cycles
              // - suggestedWoQtySnapshot captures production required this cycle (total to produce after free stock)
              requirementQty: String(round3(newWoQty)),
              availableStockQtySnapshot: round3(stock),
              gapPercentSnapshot: gapPercent,
              shortfallQtySnapshot: round3(rawShortfall),
              // Persist NO_QTY production-required qty only (not the fulfillment cap).
              suggestedWoQtySnapshot: productionRequiredQty,
              colorZoneSnapshot: zone,
            },
          });
        }

        if (!anyPositiveFulfillment) {
          const err = new Error(
            "Cannot lock requirement sheet with zero fulfillment quantity. Enter a positive fulfillment qty for at least one item (carry-forward shortfall may also apply).",
          );
          err.statusCode = 409;
          throw err;
        }

        const locked = await tx.requirementSheet.update({
          where: { id },
          data: { status: "LOCKED", recalculatedAt: new Date() },
          include: { salesOrder: { include: { customer: true, po: { include: { customer: true } } } }, lines: { include: { item: true }, orderBy: { id: "asc" } } },
        });

        // Auto-create Work Order for NO_QTY on lock (idempotent).
        // This is required for production to start immediately after locking the sheet.
        const already = await tx.workOrder.findFirst({
          where: { requirementSheetId: locked.id },
          select: { id: true, cycleId: true, salesOrderId: true },
        });
        if (already) {
          // Repair linkage for pre-existing WO created before cycle linkage was enforced.
          // (No extra cycles; just align the WO to the active cycle that the sheet was locked under.)
          const woCycleId = already.cycleId == null ? null : Number(already.cycleId);
          if (!woCycleId || woCycleId !== Number(activeCycleId)) {
            await tx.workOrder.update({
              where: { id: already.id },
              data: { cycleId: activeCycleId },
            });
          }
        } else {
          const soHead = locked.salesOrder;
          if (soHead?.orderType === "REPLACEMENT" || soHead?.customerReturnId != null) {
            const err = new Error(
              "Work orders cannot be created for customer-return replacement sales orders. Production does not apply to this order type.",
            );
            err.statusCode = 409;
            err.code = "NO_WO_ON_CUSTOMER_RETURN_REPLACEMENT_SO";
            throw err;
          }
          const soLines = await tx.salesOrderLine.findMany({
            where: { soId: locked.salesOrderId },
            select: { itemId: true, item: { select: { itemType: true } } },
          });
          const allowedFgItemIds = new Set((soLines || []).filter((l) => l.item?.itemType === "FG").map((l) => l.itemId));

          const lockedLines = await tx.requirementSheetLine.findMany({
            where: { sheetId: locked.id },
            select: { itemId: true, suggestedWoQtySnapshot: true, availableStockQtySnapshot: true },
            orderBy: { id: "asc" },
          });
          // WO should only be created for the portion that needs production.
          // In NO_QTY, we snapshot production-required qty into suggestedWoQtySnapshot at lock time.
          const positiveLines = (lockedLines || [])
            .map((ln) => {
              const toProduce = n(ln.suggestedWoQtySnapshot);
              return { fgItemId: ln.itemId, qty: round3(toProduce) };
            })
            .filter((x) => Number.isFinite(x.qty) && x.qty > 0);

          if (positiveLines.length) {
            // NO_QTY planning: do NOT block locking a new Requirement Sheet due to an existing active WO.
            // Each RS is a fresh planning cycle; any remaining from the previous WO is captured as shortfall.
            // Recommended behavior: auto-complete the previous active WO for this cycle (if any) before creating the new one.
            const activeWo = await tx.workOrder.findFirst({
              where: {
                salesOrderId: locked.salesOrderId,
                cycleId: activeCycleId,
                status: { in: ["PENDING", "IN_PROGRESS"] },
              },
              select: { id: true },
            });
            if (activeWo) {
              await tx.workOrder.update({
                where: { id: activeWo.id },
                data: { status: "COMPLETED" },
              });
            }

            for (const l of positiveLines) {
              if (!allowedFgItemIds.has(l.fgItemId)) {
                const err = new Error("Requirement sheet contains an item that is not a finished good on the sales order.");
                err.statusCode = 409;
                throw err;
              }
            }
            await tx.workOrder.create({
              data: {
                salesOrderId: locked.salesOrderId,
                requirementSheetId: locked.id,
                cycleId: activeCycleId,
                status: "PENDING",
                docNo: await allocateDocNo(tx, { docType: DocType.WORK_ORDER, date: new Date() }),
                lines: {
                  create: positiveLines.map((l) => ({
                    fgItemId: l.fgItemId,
                    qty: String(l.qty),
                    plannedQty: String(l.qty),
                  })),
                },
              },
              select: { id: true },
            });
          }
        }

        const cyc =
          locked.cycleId != null
            ? await tx.salesOrderCycle.findUnique({
                where: { id: Number(locked.cycleId) },
                select: { id: true, cycleNo: true },
              })
            : null;
        const soHead = locked.salesOrder;
        const rsDoc = displayRequirementSheetNo(locked.id, locked.docNo);
        const soDoc = displaySalesOrderNo(soHead?.id ?? locked.salesOrderId, soHead?.docNo);
        const lineCount = (locked.lines || []).length;
        const totalRequirementQty = (locked.lines || []).reduce(
          (s, ln) => s + n(ln.requirementQty) + n(ln.shortfallQtySnapshot ?? 0),
          0,
        );
        await logActivity({
          tx,
          user: req.user,
          module: ACTIVITY_MODULES.REQUIREMENT_SHEET,
          entityType: ACTIVITY_ENTITY_TYPES.REQUIREMENT_SHEET,
          entityId: locked.id,
          docNo: rsDoc,
          action: ACTIVITY_ACTIONS.LOCKED,
          message: cyc?.cycleNo != null ? `Requirement Sheet ${rsDoc} locked for Cycle ${cyc.cycleNo}` : `Requirement Sheet ${rsDoc} locked`,
          metadata: {
            salesOrderId: locked.salesOrderId,
            salesOrderDocNo: soDoc,
            cycleId: cyc?.id ?? (locked.cycleId != null ? Number(locked.cycleId) : undefined),
            cycleNo: cyc?.cycleNo ?? undefined,
            lineCount,
            totalRequirementQty: lineCount ? round3(totalRequirementQty) : undefined,
            source: "no_qty_so",
          },
        });

        return locked;
      });

      return res.json(await mapSheetDetail(sheet));
    } catch (e) {
      return next(e);
    }
  },
);

// POST /api/requirement-sheets/:id/void
// Admin-safe correction: delete a wrongly locked NO_QTY Requirement Sheet (and its WO) only if unused.
requirementSheetsRouter.post(
  "/requirement-sheets/:id/void",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));

      const result = await prisma.$transaction(async (tx) => {
        const sheet = await tx.requirementSheet.findUnique({
          where: { id },
          include: { salesOrder: true },
        });
        if (!sheet) {
          const err = new Error("Requirement sheet not found.");
          err.statusCode = 404;
          throw err;
        }
        if (sheet.salesOrder?.orderType !== "NO_QTY") {
          const err = new Error("Void action is allowed only for No Qty requirement sheets.");
          err.statusCode = 409;
          throw err;
        }
        if (sheet.status !== "LOCKED") {
          const err = new Error("Only locked requirement sheets can be voided.");
          err.statusCode = 409;
          throw err;
        }

        const wo = await tx.workOrder.findFirst({
          where: { requirementSheetId: sheet.id },
          select: { id: true },
        });

        if (wo) {
          const prodCount = await tx.productionEntry.count({
            where: { workOrderLine: { workOrderId: wo.id } },
          });
          if (prodCount > 0) {
            const err = new Error(
              "Cannot void this requirement sheet because production has already started on its work order.",
            );
            err.statusCode = 409;
            throw err;
          }
          await tx.workOrder.delete({ where: { id: wo.id } });
        }

        await tx.requirementSheet.delete({ where: { id: sheet.id } });
        return { deletedRequirementSheetId: sheet.id, deletedWorkOrderId: wo?.id ?? null };
      });

      return res.status(200).json(result);
    } catch (e) {
      return next(e);
    }
  },
);

// GET /api/requirement-sheets/:id/wo-prefill
requirementSheetsRouter.get(
  "/requirement-sheets/:id/wo-prefill",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));

      const sheet = await prisma.requirementSheet.findUnique({
        where: { id },
        include: { salesOrder: true, lines: { include: { item: true }, orderBy: { id: "asc" } } },
      });
      if (!sheet) return res.status(404).json(friendly400("Requirement sheet not found."));
      if (sheet.salesOrder?.orderType !== "NO_QTY") return res.status(409).json(friendly400("Requirement sheet is allowed only for No Qty sales orders."));

      const stockMap = await stockByItemIdUsable();

      const lines = (sheet.lines || [])
        .map((ln) => {
          if (sheet.status === "LOCKED") {
            const q = n(ln.suggestedWoQtySnapshot);
            return { fgItemId: ln.itemId, qty: q };
          }
          const req = n(ln.requirementQty);
          const stock = usableStockDisplayQty(stockMap.get(ln.itemId) ?? 0);
          const gap = computeGapPercent(req, stock);
          const zone = computeZone(gap, ln.item?.planningGapGreenThresholdPercent, ln.item?.planningGapYellowThresholdPercent);
          const suggested = zone === "EXCESS" ? 0 : computeSuggestedWo(req, stock);
          return { fgItemId: ln.itemId, qty: suggested };
        })
        .filter((x) => Number.isFinite(x.qty) && x.qty > 0);

      return res.json({ salesOrderId: sheet.salesOrderId, lines });
    } catch (e) {
      return next(e);
    }
  },
);

// POST /api/requirement-sheets/:id/create-wo
// One-click WO creation for NO_QTY sales orders from a LOCKED, latest requirement sheet version.
requirementSheetsRouter.post(
  "/requirement-sheets/:id/create-wo",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));

      const result = await prisma.$transaction(async (tx) => {
        const sheet = await tx.requirementSheet.findUnique({
          where: { id },
          include: {
            salesOrder: { include: { lines: { include: { item: true } } } },
            lines: { include: { item: true }, orderBy: { id: "asc" } },
          },
        });
        if (!sheet) {
          const err = new Error("Requirement sheet not found.");
          err.statusCode = 404;
          throw err;
        }
        if (sheet.salesOrder?.orderType !== "NO_QTY") {
          const err = new Error("Work Order creation from requirement sheet is allowed only for No Qty sales orders.");
          err.statusCode = 409;
          throw err;
        }
        if (sheet.status !== "LOCKED") {
          const err = new Error("Work Order can be created only from a locked requirement sheet.");
          err.statusCode = 409;
          throw err;
        }

        const activeCycleId = await resolveNoQtyActiveCycleIdForPlanning(tx, sheet.salesOrderId);
        if (!sheet.cycleId || Number(sheet.cycleId) !== Number(activeCycleId)) {
          await tx.requirementSheet.update({ where: { id: sheet.id }, data: { cycleId: activeCycleId } });
        }

        const periodKey = sheet.periodKey ?? null;
        const versionNum = Number(sheet.version ?? 1);
        if (!periodKey) {
          const err = new Error("Invalid requirement sheet period.");
          err.statusCode = 409;
          throw err;
        }

        const maxV = await tx.requirementSheet.aggregate({
          where: { salesOrderId: sheet.salesOrderId, periodKey, cycleId: activeCycleId },
          _max: { version: true },
        });
        const latest = Number(maxV._max.version ?? versionNum);
        if (versionNum < latest) {
          const err = new Error(
            "Work Order can be created only from the latest requirement sheet version for this period and active cycle.",
          );
          err.statusCode = 409;
          throw err;
        }

        const existing = await tx.workOrder.findFirst({
          where: { requirementSheetId: sheet.id },
          select: { id: true, cycleId: true, docNo: true },
        });
        if (existing) {
          const woCycleId = existing.cycleId == null ? null : Number(existing.cycleId);
          if (!woCycleId || woCycleId !== Number(activeCycleId)) {
            await tx.workOrder.update({ where: { id: existing.id }, data: { cycleId: activeCycleId } });
          }
          const woLabel = existing.docNo?.trim() || `WO-${existing.id}`;
          const err = new Error(`Work Order ${woLabel} was already created from this requirement sheet.`);
          err.statusCode = 409;
          throw err;
        }

        // Manual WO creation is a repair/fallback action. Mirror lock behavior:
        // create WO only for the production-required qty snapshot (not the fulfillment cap).
        const positiveLines = (sheet.lines || [])
          .map((ln) => {
            const toProduce = n(ln.suggestedWoQtySnapshot);
            return { fgItemId: ln.itemId, qty: round3(toProduce) };
          })
          .filter((x) => Number.isFinite(x.qty) && x.qty > 0);

        if (!positiveLines.length) {
          const err = new Error("No production-required lines found (usable stock covers the cycle cap).");
          err.statusCode = 409;
          throw err;
        }

        // NO_QTY planning: do NOT block WO creation due to an existing active WO.
        // Mirror lock behavior: auto-complete the existing active WO for this cycle, then create a new one.
        const activeWo = await tx.workOrder.findFirst({
          where: { salesOrderId: sheet.salesOrderId, cycleId: activeCycleId, status: { in: ["PENDING", "IN_PROGRESS"] } },
          select: { id: true },
        });
        if (activeWo) {
          await tx.workOrder.update({ where: { id: activeWo.id }, data: { status: "COMPLETED" } });
        }

        // Strict validation: ensure each fgItemId exists on the SO as an FG item.
        const allowedFgItemIds = new Set(
          (sheet.salesOrder?.lines || [])
            .filter((sl) => sl.item?.itemType === "FG")
            .map((sl) => sl.itemId),
        );
        for (const l of positiveLines) {
          if (!allowedFgItemIds.has(l.fgItemId)) {
            const err = new Error("Requirement sheet contains an item that is not a finished good on the sales order.");
            err.statusCode = 409;
            throw err;
          }
        }

        const wo = await tx.workOrder.create({
          data: {
            salesOrderId: sheet.salesOrderId,
            requirementSheetId: sheet.id,
            cycleId: activeCycleId,
            status: "PENDING",
            docNo: await allocateDocNo(tx, { docType: DocType.WORK_ORDER, date: new Date() }),
            lines: {
              create: positiveLines.map((l) => ({
                fgItemId: l.fgItemId,
                qty: String(l.qty),
                plannedQty: String(l.qty),
              })),
            },
          },
          select: { id: true, salesOrderId: true },
        });
        return wo;
      });

      return res.status(201).json({ workOrderId: result.id, salesOrderId: result.salesOrderId });
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { requirementSheetsRouter };

