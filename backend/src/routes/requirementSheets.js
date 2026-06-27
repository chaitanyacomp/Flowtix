const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { RS_WRITE_ROLES, RS_READ_ROLES } = require("../constants/erpRoles");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("../services/docNoService");
const { computeZone } = require("../services/planningThresholds");
const {
  netDispatchedByItemId,
  DISPATCH_ALLOC_MODE,
  remainingDispatchCapacityForSoItem,
} = require("../services/salesOrderDispatchAllocation");
const { repairNoQtyCycleIntegrity, advanceNoQtyCycleForNextRequirementSheetIfEligible } = require("../services/noQtyCycleLifecycle");
const { logActivity } = require("../services/activityLogService");
const { usableStockDisplayQty, loadStockByItemIdUsableMap } = require("../services/stockService");
const { buildQcAcceptedMap } = require("../services/dispatchQcCap");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displayRequirementSheetNo, displaySalesOrderNo } = require("../utils/docNoLabels");
const { normalizePositiveCycleId } = require("../utils/cycleIds");
const {
  assertNoLockedOrCancelledSheetForCyclePeriod,
  cancelLockedRequirementSheet,
  evaluateRequirementSheetCancellation,
  RequirementSheetLifecycleError,
  RS_LIFECYCLE_MESSAGES,
} = require("../services/requirementSheetLifecycleService");
const { QC_ENTRY_ACTIVE_WHERE } = require("../services/qcEntryConstants");
const {
  loadNoQtyPostCycleApprovalQtyByItem,
  loadNoQtyPendingQcDispositionQtyByItem,
} = require("../services/noQtyPostCycleApprovalService");
const {
  loadNoQtyCycleQcAcceptedMap,
  loadNoQtyCycleRecheckAcceptedMap,
  filterNoQtyDispatchRowsForActiveCycle,
  netNoQtyCycleDispatchedByItemId,
} = require("./dispatch");
const { loadEffectiveNoQtyCarryForwardShortfallByItem } = require("../services/noQtySoCloseSnapshotService");
const {
  consumeCarryForwardPendingForRequirementSheet,
  loadPendingCarryForwardQtyByItem,
} = require("../services/carryForwardPendingService");
const { assertNoQtyRequirementSheetPeriodReleased } = require("../services/noQtyExecutionBoundaryService");
const {
  createNoQtyWorkOrderFromLockedSheet,
  NO_QTY_WO_PLACED_COUNT_STATUSES,
} = require("../services/noQtyExecutionReleaseService");
const { ensureSubmittedProductionMaterialRequestForWorkOrder } = require("../services/productionMaterialRequestService");
const { resolveNoQtyWoExecutableQty } = require("../services/noQtyWoQtyService");
const { getRequirementSheetExecutionSummary } = require("../services/requirementSheetExecutionService");

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

function computeNoQtyOperatorCarryForwardQty(plannedQty, approvedProducedQty) {
  return round3(Math.max(0, round3(plannedQty) - round3(approvedProducedQty)));
}

/**
 * Sum execution surplus from the immediately prior NO_QTY cycle (reduces next RS production demand).
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function loadNoQtyProductionSurplusByItemForPriorCycle(db, salesOrderId, currentCycleId) {
  const current = await db.salesOrderCycle.findUnique({
    where: { id: currentCycleId },
    select: { salesOrderId: true, cycleNo: true },
  });
  if (!current || current.salesOrderId !== salesOrderId) return new Map();
  const prev = await db.salesOrderCycle.findFirst({
    where: { salesOrderId, cycleNo: { lt: current.cycleNo } },
    orderBy: { cycleNo: "desc" },
    select: { id: true },
  });
  if (!prev) return new Map();

  const lines = await db.workOrderLine.findMany({
    where: {
      workOrder: { salesOrderId, cycleId: prev.id },
      executionSurplusQty: { not: null },
    },
    select: { fgItemId: true, executionSurplusQty: true },
  });
  /** @type {Map<number, number>} */
  const out = new Map();
  for (const ln of lines) {
    const surplus = round3(n(ln.executionSurplusQty));
    if (surplus <= EPS) continue;
    out.set(ln.fgItemId, round3((out.get(ln.fgItemId) ?? 0) + surplus));
  }
  return out;
}

/**
 * Next-cycle RS demand qty: PENDING carry-forward pool first; waived/completed-without-CF → zero;
 * legacy cycles without production execution resolution fall back to operator shortfall.
 */
function resolveNoQtyCarryForwardDemandQty({
  cfPendingQty,
  operatorShortfall,
  executionCompleted,
  hadCarryForwardResolution,
}) {
  const cf = round3(n(cfPendingQty));
  const op = round3(n(operatorShortfall));
  if (cf > EPS) return cf;
  if (op <= EPS) return 0;
  if (executionCompleted && !hadCarryForwardResolution) return 0;
  return op;
}

/**
 * @returns {Promise<Map<number, { executionCompleted: boolean; hadCarryForwardResolution: boolean }>>}
 */
async function loadNoQtyExecutionResolutionByItemForCycle(db, salesOrderId, cycleId) {
  const cid = Number(cycleId);
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0 || !Number.isFinite(cid) || cid <= 0) return new Map();

  const wos = await db.workOrder.findMany({
    where: { salesOrderId: soId, cycleId: cid, status: { not: "REJECTED" } },
    include: {
      lines: { select: { fgItemId: true } },
      productionExecution: { select: { executionStatus: true, lastResolutionType: true } },
    },
  });

  /** @type {Map<number, { executionCompleted: boolean; hadCarryForwardResolution: boolean }>} */
  const out = new Map();
  for (const wo of wos) {
    const exec = wo.productionExecution;
    const completed = exec?.executionStatus === "COMPLETED";
    const hadCf = exec?.lastResolutionType === "CARRY_FORWARD";
    for (const line of wo.lines || []) {
      const itemId = Number(line.fgItemId);
      if (!Number.isFinite(itemId) || itemId <= 0) continue;
      const prev = out.get(itemId) ?? { executionCompleted: false, hadCarryForwardResolution: false };
      if (completed) prev.executionCompleted = true;
      if (hadCf) prev.hadCarryForwardResolution = true;
      out.set(itemId, prev);
    }
  }
  return out;
}

/**
 * P6B-1B: one terminal RS per NO_QTY cycle+period (LOCKED or CANCELLED). MPRS still dedupes
 * legacy multi-version LOCKED rows by highest version until data is migrated.
 * Tie-break: periodKey (desc), version (desc), createdAt (desc), id (desc).
 *
 * @param {{ id: number; periodKey: string | null; version: number | null; createdAt: Date }} a
 * @param {{ id: number; periodKey: string | null; version: number | null; createdAt: Date }} b
 */
/**
 * NO_QTY: QC (+ recheck + post-cycle approvals) still in the dispatch pool from the **prior** cycle
 * minus same-cycle operational dispatch — reduces fresh production on the current-cycle RS.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} salesOrderId
 * @param {number|null|undefined} currentCycleId — sheet / SO active cycle
 * @returns {Promise<Map<number, number>>} fg itemId → undispatched accepted qty
 */
async function loadNoQtyPriorCycleUndispatchedAcceptedByItem(db, salesOrderId, currentCycleId) {
  const soId = Number(salesOrderId);
  const curCid = normalizePositiveCycleId(currentCycleId);
  if (!Number.isFinite(soId) || soId <= 0 || curCid == null) return new Map();

  const cur = await db.salesOrderCycle.findFirst({
    where: { id: curCid, salesOrderId: soId },
    select: { cycleNo: true },
  });
  if (!cur) return new Map();
  const curNo = Number(cur.cycleNo);
  if (!Number.isFinite(curNo) || curNo <= 1) return new Map();

  const prev = await db.salesOrderCycle.findFirst({
    where: { salesOrderId: soId, cycleNo: curNo - 1 },
    select: { id: true },
  });
  const prevId = prev?.id != null ? Number(prev.id) : null;
  if (!prevId || prevId <= 0) return new Map();

  const [qcMap, recheckMap, postByItem, dispRows] = await Promise.all([
    loadNoQtyCycleQcAcceptedMap(db, [{ id: soId, currentCycleId: prevId }]),
    loadNoQtyCycleRecheckAcceptedMap(db, [{ id: soId, currentCycleId: prevId }]),
    loadNoQtyPostCycleApprovalQtyByItem(db, soId, prevId),
    db.dispatch.findMany({
      where: { soId, reversalOfId: null },
      select: { itemId: true, dispatchedQty: true, cycleId: true, workflowStatus: true },
    }),
  ]);

  const cycleDisp = filterNoQtyDispatchRowsForActiveCycle(dispRows, prevId);
  const netByItem = netNoQtyCycleDispatchedByItemId(cycleDisp, DISPATCH_ALLOC_MODE.OPERATIONAL);

  /** @type {Set<number>} */
  const itemIds = new Set();
  const prefix = `${soId}:${prevId}:`;
  for (const k of qcMap.keys()) {
    if (!String(k).startsWith(prefix)) continue;
    const parts = String(k).split(":");
    const iid = Number(parts[2]);
    if (Number.isFinite(iid) && iid > 0) itemIds.add(iid);
  }
  for (const k of recheckMap.keys()) {
    if (!String(k).startsWith(prefix)) continue;
    const parts = String(k).split(":");
    const iid = Number(parts[2]);
    if (Number.isFinite(iid) && iid > 0) itemIds.add(iid);
  }
  for (const itemId of postByItem.keys()) {
    const iid = Number(itemId);
    if (Number.isFinite(iid) && iid > 0) itemIds.add(iid);
  }
  for (const itemId of netByItem.keys()) {
    const iid = Number(itemId);
    if (Number.isFinite(iid) && iid > 0) itemIds.add(iid);
  }

  /** @type {Map<number, number>} */
  const out = new Map();
  for (const itemId of itemIds) {
    const key = `${soId}:${prevId}:${itemId}`;
    const qcGross = n(qcMap.get(key) ?? 0) + n(recheckMap.get(key) ?? 0) + n(postByItem.get(itemId) ?? 0);
    const dispatched = n(netByItem.get(itemId) ?? 0);
    const und = round3(Math.max(0, qcGross - dispatched));
    if (und > EPS) out.set(itemId, und);
  }
  return out;
}

function pickWinningLockedRequirementSheet(a, b) {
  const pkA = String(a.periodKey ?? "");
  const pkB = String(b.periodKey ?? "");
  if (pkA !== pkB) return pkA > pkB ? a : b;
  const vA = Number(a.version ?? 0);
  const vB = Number(b.version ?? 0);
  if (vA !== vB) return vA >= vB ? a : b;
  const tA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
  const tB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
  if (tA !== tB) return tA >= tB ? a : b;
  return Number(a.id) >= Number(b.id) ? a : b;
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
  return loadStockByItemIdUsableMap(prisma);
}

const EPS = 1e-6;

const {
  computeNoQtyUsablePlanningBreakdownByItem,
} = require("../services/noQtyUsablePlanningService");

/**
 * Planning: compute FREE usable FG stock (not reserved for dispatch).
 *
 * reservedQty (per FG item) is the sum of remaining dispatch demand across:
 * - NORMAL / REPLACEMENT sales orders: remaining dispatch capacity on SO lines (FIFO), operational mode
 *
 * Then:
 * freeUsableStock = max(0, totalUsableFGStock − reservedQty)
 */
async function freeUsableFgStockByItemForNoQtyPlanning(args) {
  const soId = Number(args?.salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return new Map();

  const totalUsableByItem = await stockByItemIdUsable();

  /**
   * CONFIRMED RULES (NO_QTY):
   * - Pending dispatch is optional; remaining USABLE stock must reduce the next RS production requirement.
   * - Therefore, do NOT reserve USABLE stock away from planning due to NO_QTY dispatchability.
   *
   * We still reserve stock for NORMAL/REPLACEMENT open dispatch commitments so their pending dispatch doesn't
   * get double-planned into production.
   */
  const openSos = await prisma.salesOrder.findMany({
    where: {
      orderType: { not: "NO_QTY" },
      internalStatus: { notIn: ["COMPLETED", "CLOSED"] },
    },
    select: {
      id: true,
      orderType: true,
      customerReturnId: true,
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

  /** @type {Map<number, number>} itemId -> reserved qty */
  const reservedByItem = new Map();

  for (const so of openSos) {
    const id = Number(so.id);
    const disp = dispatchBySoId.get(id) ?? [];

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
 * Existing NORMAL/REPLACEMENT reserve semantics, extracted as "reserved qty" map.
 * reservedNormal = max(0, totalUsable - freeAfterNormalReservation).
 *
 * @param {number} salesOrderId
 * @returns {Promise<Map<number, number>>}
 */
async function reservedNormalDispatchQtyByItemForPlanning(salesOrderId) {
  const totalUsableByItem = await stockByItemIdUsable();
  const freeAfterNormal = await freeUsableFgStockByItemForNoQtyPlanning({ salesOrderId });
  const out = new Map();
  for (const [itemId, totalRaw] of totalUsableByItem.entries()) {
    const total = n(totalRaw);
    const free = n(freeAfterNormal.get(itemId) ?? 0);
    out.set(itemId, Math.max(0, total - free));
  }
  return out;
}

/**
 * UNLOCKED dispatch drafts reserve usable stock operationally (not yet posted to StockTransaction).
 * For RS planning, treat them as reserved so we don't double-count the same physical stock
 * as both "free usable" and "to produce".
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @returns {Promise<Map<number, number>>} itemId -> reserved draft qty
 */
async function reservedUnlockedDispatchDraftQtyByItemForPlanning(db) {
  const rows = await db.dispatch.groupBy({
    by: ["itemId"],
    where: { workflowStatus: "UNLOCKED", reversalOfId: null },
    _sum: { dispatchedQty: true },
  });
  return new Map(rows.map((r) => [Number(r.itemId), Math.max(0, n(r._sum.dispatchedQty))]));
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
 * Per **one** NO_QTY cycle: for each FG item, locked RS gross from the winning LOCKED sheet
 * (`shortfallQtySnapshot + requirementQty` per line, summed) vs APPROVED produced qty for operator planning.
 *
 * NO_QTY carry-forward is operator-first pending qty:
 * `max(0, planned RS/WO qty - approved produced qty)`.
 * QC/rework/post-cycle stock still affects dispatchable stock elsewhere, but must not reduce next-cycle production planning.
 *
 * Returned `qcAccepted` is a historical field name; it now carries approved produced qty for callers computing
 * `planned - qcAccepted` shortage.
 */
async function plannedNewRequirementAndQcAcceptedByItemForSingleCycle(soId, cycleId) {
  const sid = Number(soId);
  const cid = Number(cycleId);
  if (!Number.isFinite(sid) || sid <= 0 || !Number.isFinite(cid) || cid <= 0) return new Map();

  const lockedSheets = await prisma.requirementSheet.findMany({
    where: {
      salesOrderId: sid,
      status: "LOCKED",
      cycleId: cid,
    },
    select: { id: true, periodKey: true, version: true, createdAt: true },
  });

  let winning = null;
  for (const sh of lockedSheets) {
    winning = winning ? pickWinningLockedRequirementSheet(winning, sh) : sh;
  }

  /** @type {Map<number, number>} */
  const plannedByItem = new Map();
  if (winning) {
    const lockedLines = await prisma.requirementSheetLine.findMany({
      where: { sheetId: winning.id },
      select: { itemId: true, requirementQty: true, shortfallQtySnapshot: true },
    });
    for (const l of lockedLines) {
      const itemId = Number(l.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) continue;
      const req = n(l.requirementQty);
      const sf = l.shortfallQtySnapshot != null ? n(l.shortfallQtySnapshot) : 0;
      const grossRsLine = l.shortfallQtySnapshot == null ? round3(req) : round3(sf + req);
      plannedByItem.set(itemId, (plannedByItem.get(itemId) || 0) + grossRsLine);
    }
  }

  const productions = await prisma.productionEntry.findMany({
    where: {
      workflowStatus: "APPROVED",
      workOrderLine: {
        workOrder: {
          salesOrderId: sid,
          cycleId: cid,
          status: { not: "REJECTED" },
        },
      },
    },
    select: { id: true, producedQty: true, workOrderLine: { select: { fgItemId: true } } },
  });
  /** @type {Map<number, number>} */
  const producedQtyByItem = new Map();
  for (const p of productions) {
    const itemId = Number(p.workOrderLine?.fgItemId);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    producedQtyByItem.set(itemId, (producedQtyByItem.get(itemId) || 0) + n(p.producedQty));
  }
  /** @type {Map<number, { planned: number; qcAccepted: number }>} */
  const out = new Map();
  const itemIds = new Set([...plannedByItem.keys(), ...producedQtyByItem.keys()]);
  for (const itemId of itemIds) {
    const planned = plannedByItem.get(itemId) || 0;
    const approvedProducedQty = producedQtyByItem.get(itemId) || 0;
    out.set(itemId, {
      planned,
      qcAccepted: round3(approvedProducedQty),
    });
  }
  return out;
}

/**
 * Last shortage for one FG item in one cycle: {@code max(0, locked RS gross - approved produced qty)} for that cycle only
 * (same basis as {@link plannedNewRequirementAndQcAcceptedByItemForSingleCycle}).
 *
 * @param {number} salesOrderId
 * @param {number} cycleId
 * @param {number} itemId FG item id
 */
async function getNoQtyLastShortageQtyForCycleItem(salesOrderId, cycleId, itemId) {
  const m = await plannedNewRequirementAndQcAcceptedByItemForSingleCycle(salesOrderId, cycleId);
  const v = m.get(Number(itemId));
  if (!v) return 0;
  return computeNoQtyOperatorCarryForwardQty(v.planned, v.qcAccepted);
}

/**
 * Unresolved NO_QTY shortfall (per FG item) shown on draft requirement sheets.
 *
 * **Formula:** Take **only the latest closed cycle** before the current one (`cycleNo` \< currentCycleNo):
 * `rawShortfall = max(0, lockedRsGrossForThatCycle - approvedProducedQtyForThatCycle)` via
 * {@link plannedNewRequirementAndQcAcceptedByItemForSingleCycle}.
 * Summing shortages across *all* prior cycles double-counts, because later cycles’ RS gross already embeds
 * earlier shortages via `shortfallQtySnapshot`. The **current** cycle is excluded.
 *
 * **Breakdown:** `carryForwardBreakdownByItem` still lists **every** prior cycle (for debug); `rawShortfall`
 * uses **last prior cycle only**.
 *
 * @param {{ salesOrderId: number; currentCycleId: number | null }} input
 * @returns {Promise<{
 *   shortfallByItem: Map<number, { rawShortfall: number; planned: number; produced: number }>;
 *   carryForwardBreakdownByItem: Map<number, Array<{ cycleNo: number; cycleId: number; planned: number; produced: number; qc: number; shortage: number }>>;
 * }>}
 *   `planned` / `produced` are from the **latest previous** cycle only; breakdown arrays cover all prior cycles for diagnostics.
 */
async function loadNoQtyCarryForwardShortfallByItem(input) {
  const empty = () => ({
    shortfallByItem: new Map(),
    carryForwardBreakdownByItem: new Map(),
  });

  const soId = Number(input?.salesOrderId);
  const currentCycleId = input?.currentCycleId != null ? Number(input.currentCycleId) : null;
  if (!Number.isFinite(soId) || soId <= 0) return empty();
  if (!currentCycleId || !Number.isFinite(currentCycleId) || currentCycleId <= 0) return empty();

  const current = await prisma.salesOrderCycle.findUnique({
    where: { id: currentCycleId },
    select: { id: true, salesOrderId: true, cycleNo: true },
  });
  if (!current || current.salesOrderId !== soId) return empty();

  const currentCycleNo = Number(current.cycleNo);
  if (!Number.isFinite(currentCycleNo) || currentCycleNo <= 1) {
    return empty();
  }

  const prevCycleRows = await prisma.salesOrderCycle.findMany({
    where: { salesOrderId: soId, cycleNo: { lt: currentCycleNo } },
    select: { id: true, cycleNo: true },
    orderBy: { cycleNo: "asc" },
  });

  /** @type {Map<number, Array<{ cycleNo: number; cycleId: number; planned: number; produced: number; qc: number; shortage: number }>>} */
  const breakdownByItem = new Map();
  /** @type {Map<number, { planned: number; qcAccepted: number }> | null} */
  let lastCyclePerItem = null;

  for (const row of prevCycleRows) {
    const cycleRowId = Number(row.id);
    const cycleNo = Number(row.cycleNo);
    if (!Number.isFinite(cycleRowId) || cycleRowId <= 0 || !Number.isFinite(cycleNo)) continue;

    const perCycle = await plannedNewRequirementAndQcAcceptedByItemForSingleCycle(soId, cycleRowId);
    lastCyclePerItem = perCycle;

    for (const [itemId, v] of perCycle) {
      const planned = n(v.planned);
      const approvedProduced = n(v.qcAccepted);
      const cycleShortfall = computeNoQtyOperatorCarryForwardQty(planned, approvedProduced);

      const br = breakdownByItem.get(itemId) ?? [];
      br.push({
        cycleNo,
        cycleId: cycleRowId,
        planned: round3(planned),
        produced: round3(approvedProduced),
        qc: round3(approvedProduced),
        shortage: round3(cycleShortfall),
      });
      breakdownByItem.set(itemId, br);
    }
  }

  /** @type {Map<number, { rawShortfall: number; planned: number; produced: number }>} */
  const out = new Map();

  const lastPriorCycleId =
    prevCycleRows.length > 0 ? Number(prevCycleRows[prevCycleRows.length - 1].id) : null;
  const [pendingCfByItem, executionByItem] = await Promise.all([
    loadPendingCarryForwardQtyByItem(prisma, { salesOrderId: soId, currentCycleId }),
    lastPriorCycleId
      ? loadNoQtyExecutionResolutionByItemForCycle(prisma, soId, lastPriorCycleId)
      : Promise.resolve(new Map()),
  ]);

  const itemIds = new Set([
    ...(lastCyclePerItem ? [...lastCyclePerItem.keys()] : []),
    ...pendingCfByItem.keys(),
  ]);

  for (const itemId of itemIds) {
    const v = lastCyclePerItem?.get(itemId);
    const planned = n(v?.planned);
    const approvedProduced = n(v?.qcAccepted);
    const operatorShortfall = computeNoQtyOperatorCarryForwardQty(planned, approvedProduced);
    const exec = executionByItem.get(itemId);
    const rawShortfall = resolveNoQtyCarryForwardDemandQty({
      cfPendingQty: pendingCfByItem.get(itemId) ?? 0,
      operatorShortfall,
      executionCompleted: exec?.executionCompleted ?? false,
      hadCarryForwardResolution: exec?.hadCarryForwardResolution ?? false,
    });
    out.set(itemId, {
      rawShortfall,
      planned,
      produced: approvedProduced,
    });
  }

  const filtered = new Map();
  /** @type {Map<number, Array<{ cycleNo: number; cycleId: number; planned: number; qc: number; shortage: number }>>} */
  const filteredBreakdown = new Map();
  for (const [itemId, v] of out) {
    if (v.rawShortfall > EPS) {
      filtered.set(itemId, v);
      const bd = breakdownByItem.get(itemId);
      if (bd?.length) filteredBreakdown.set(itemId, bd);
    }
  }

  // eslint-disable-next-line no-console
  console.debug("[NO_QTY_CARRY_FORWARD_SHORTFALL]", {
    salesOrderId: soId,
    currentCycleId,
    currentCycleNo,
    breakdown: Object.fromEntries(filteredBreakdown),
  });

  return { shortfallByItem: filtered, carryForwardBreakdownByItem: filteredBreakdown };
}

/**
 * Legacy helper (unused): planned WO line qty minus APPROVED produced qty by FG item.
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
  if (so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED") {
    const err = new Error("This sales order is closed. Requirement Sheet is view-only.");
    err.statusCode = 409;
    throw err;
  }
  return so;
}

async function mapSheetDetail(sheet) {
  const customerName = sheet?.salesOrder?.customer?.name ?? sheet?.salesOrder?.po?.customer?.name ?? sheet?.customerNameSnapshot ?? null;

  const linkedWorkOrders = await prisma.workOrder.findMany({
    where: { requirementSheetId: sheet.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      docNo: true,
      status: true,
      createdAt: true,
      productionMaterialRequests: {
        orderBy: { id: "desc" },
        take: 1,
        select: { id: true, docNo: true, status: true },
      },
    },
  });
  const existingWo = linkedWorkOrders[0] ?? null;
  const openPmr = existingWo?.productionMaterialRequests?.[0] ?? null;
  const workOrders = linkedWorkOrders.map((wo) => {
    const pmr = wo.productionMaterialRequests?.[0] ?? null;
    return {
      id: wo.id,
      docNo: wo.docNo ?? null,
      status: wo.status,
      createdAt: wo.createdAt?.toISOString?.() ?? wo.createdAt ?? null,
      pmrId: pmr?.id ?? null,
      pmrDocNo: pmr?.docNo ?? null,
      pmrStatus: pmr?.status ?? null,
    };
  });

  const stockMap = await stockByItemIdUsable();
  const reservedUnlockedDraftByItem =
    sheet?.salesOrder?.orderType === "NO_QTY" ? await reservedUnlockedDispatchDraftQtyByItemForPlanning(prisma) : new Map();
  const freeAfterNormalByItem =
    sheet?.salesOrder?.orderType === "NO_QTY"
      ? await freeUsableFgStockByItemForNoQtyPlanning({ salesOrderId: sheet.salesOrderId })
      : new Map();
  const noQtyBreakdownByItem =
    sheet?.salesOrder?.orderType === "NO_QTY"
      ? await (async () => {
          const reservedNormalByItem = await reservedNormalDispatchQtyByItemForPlanning(sheet.salesOrderId);
          const excludeCycleId = sheet.cycleId ?? sheet.salesOrder?.currentCycleId ?? null;
          return computeNoQtyUsablePlanningBreakdownByItem(prisma, {
            salesOrderId: sheet.salesOrderId,
            reservedForNormalDispatchByItem: reservedNormalByItem,
            excludeCycleId,
            includeDebugRows: false,
          });
        })()
      : null;
  const effCycleIdForPost = sheet.cycleId ?? sheet.salesOrder?.currentCycleId ?? null;
  const { shortfallByItem } = await loadEffectiveNoQtyCarryForwardShortfallByItem(prisma, {
    salesOrderId: sheet.salesOrderId,
    currentCycleId: effCycleIdForPost,
  });
  const productionSurplusByItem =
    sheet?.salesOrder?.orderType === "NO_QTY" && effCycleIdForPost != null && Number(effCycleIdForPost) > 0
      ? await loadNoQtyProductionSurplusByItemForPriorCycle(prisma, sheet.salesOrderId, Number(effCycleIdForPost))
      : new Map();
  const postCycleByItem =
    sheet?.salesOrder?.orderType === "NO_QTY" && effCycleIdForPost != null && Number(effCycleIdForPost) > 0
      ? await loadNoQtyPostCycleApprovalQtyByItem(prisma, sheet.salesOrderId, Number(effCycleIdForPost))
      : new Map();
  const pendingDispositionByItem =
    sheet?.salesOrder?.orderType === "NO_QTY" && effCycleIdForPost != null && Number(effCycleIdForPost) > 0
      ? await loadNoQtyPendingQcDispositionQtyByItem(prisma, sheet.salesOrderId, Number(effCycleIdForPost))
      : new Map();
  const undispatchedPriorByItem =
    sheet?.salesOrder?.orderType === "NO_QTY" && effCycleIdForPost != null && Number(effCycleIdForPost) > 0
      ? await loadNoQtyPriorCycleUndispatchedAcceptedByItem(prisma, sheet.salesOrderId, Number(effCycleIdForPost))
      : new Map();

  const lines = (sheet.lines || []).map((ln) => {
    const item = ln.item;
    const greenTh = item?.planningGapGreenThresholdPercent ?? null;
    const yellowTh = item?.planningGapYellowThresholdPercent ?? null;
    const newWoQty = n(ln.requirementQty);
    // Used by NO_QTY response mapping as a safe fallback stock source.
    const rawTotal = stockMap.get(ln.itemId) ?? 0;

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
    /** System recommendation: REGULAR = fulfillment-based net; NO_QTY = max(0, confirmed last shortage + new requirement). */
    let suggestedNetWoQty = 0;
    /** DRAFT only: QC-usable stock used for suggested WO (same source as `availableStockQty` on the line). */
    let draftUsableStockForSuggest = 0;
    const postCycleQty =
      sheet?.salesOrder?.orderType === "NO_QTY" ? round3(n(postCycleByItem.get(ln.itemId) ?? 0)) : 0;
    const pendingDispositionQty =
      sheet?.salesOrder?.orderType === "NO_QTY" ? round3(n(pendingDispositionByItem.get(ln.itemId) ?? 0)) : 0;
    const undispatchedPriorQty =
      sheet?.salesOrder?.orderType === "NO_QTY" ? round3(n(undispatchedPriorByItem.get(ln.itemId) ?? 0)) : 0;

    if (sheet.status === "LOCKED" && sheet?.salesOrder?.orderType === "NO_QTY") {
      const rawSnapStock = ln.availableStockQtySnapshot != null ? n(ln.availableStockQtySnapshot) : 0;
      availableStockQty = usableStockDisplayQty(rawSnapStock);
      const snapCarry = ln.shortfallQtySnapshot != null ? n(ln.shortfallQtySnapshot) : 0;
      shortfallQty = round3(Math.max(0, snapCarry));
      fulfillmentQty = round3(round3(shortfallQty) + round3(newWoQty));
      /** Prior-cycle usable remains for dispatch; do not treat as RS “covered from stock” for production planning. */
      coveredFromStockQty = 0;
      const fromSnapshot =
        ln.suggestedWoQtySnapshot != null ? round3(n(ln.suggestedWoQtySnapshot)) : null;
      const recomputedDraftStyle = round3(Math.max(0, round3(shortfallQty) + round3(newWoQty)));
      productionRequiredQty = fromSnapshot != null ? fromSnapshot : recomputedDraftStyle;
      if (
        fromSnapshot != null &&
        Math.abs(fromSnapshot - recomputedDraftStyle) > EPS &&
        fulfillmentQty > EPS
      ) {
        console.warn("[NO_QTY_RS_DETAIL] Locked line suggestedWoQtySnapshot differs from last shortage + new requirement replay", {
          requirementSheetId: sheet.id,
          itemId: ln.itemId,
          suggestedWoQtySnapshot: fromSnapshot,
          recomputedLastShortagePlusNewReq: recomputedDraftStyle,
        });
      }
      gapPercent = computeGapPercent(fulfillmentQty, availableStockQty ?? 0);
      zone = computeZone(gapPercent, greenTh, yellowTh);
      totalWoQty = productionRequiredQty;
      qcStockNote =
        availableStockQty > EPS
          ? "Usable stock available for dispatch (informational only; not deducted from Total to Produce)."
          : null;
      if (totalWoQty != null && totalWoQty < 0) totalWoQty = 0;
    } else if (sheet.status === "LOCKED") {
      const rawSnapStock = ln.availableStockQtySnapshot != null ? n(ln.availableStockQtySnapshot) : null;
      availableStockQty = rawSnapStock != null ? usableStockDisplayQty(rawSnapStock) : null;
      const snapCarry = ln.shortfallQtySnapshot != null ? n(ln.shortfallQtySnapshot) : 0;
      shortfallQty = snapCarry;
      fulfillmentQty = round3(round3(snapCarry) + round3(newWoQty));
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
      const rawStock =
        sheet?.salesOrder?.orderType === "NO_QTY"
          ? Math.max(
              0,
              n(freeAfterNormalByItem.get(ln.itemId) ?? 0) - n(reservedUnlockedDraftByItem.get(ln.itemId) ?? 0),
            )
          : (stockMap.get(ln.itemId) ?? 0);
      const stock = usableStockDisplayQty(rawStock);
      draftUsableStockForSuggest = round3(stock);
      availableStockQty = draftUsableStockForSuggest;
      const rawCarryShortfall = shortfallByItem.get(ln.itemId)?.rawShortfall ?? 0;
      const poolCarrySnap = ln.shortfallQtySnapshot != null ? round3(n(ln.shortfallQtySnapshot)) : 0;
      // NO_QTY: API `shortfallQty` = last shortage from prior cycle (planned qty - approved produced qty); stock/QC fields are separate.
      shortfallQty =
        sheet?.salesOrder?.orderType === "NO_QTY"
          ? round3(Math.max(0, poolCarrySnap > EPS ? poolCarrySnap : rawCarryShortfall))
          : round3(rawCarryShortfall);
      // Draft: gross fulfillment uses raw carry + new (same-cycle messaging); NO_QTY Total to Produce = shortfallQty + new (usable surplus informational only).
      const grossFulfillment = round3(round3(rawCarryShortfall) + round3(newWoQty));
      fulfillmentQty = grossFulfillment;
      coveredFromStockQty =
        sheet?.salesOrder?.orderType === "NO_QTY" ? 0 : round3(Math.min(grossFulfillment, stock));
      productionRequiredQty =
        sheet?.salesOrder?.orderType === "NO_QTY"
          ? round3(
              Math.max(
                0,
                round3(shortfallQty) +
                  round3(newWoQty) -
                  round3(productionSurplusByItem.get(ln.itemId) ?? 0),
              ),
            )
          : round3(Math.max(0, grossFulfillment - postCycleQty - stock));
      gapPercent = computeGapPercent(grossFulfillment, stock);
      zone = computeZone(gapPercent, greenTh, yellowTh);
      stockCoveredNote = grossFulfillment > EPS && stock > EPS;
      totalWoQty = productionRequiredQty;

      if (sheet?.salesOrder?.orderType === "NO_QTY") {
        qcStockNote =
          stock > EPS
            ? "Usable stock available for dispatch (informational only; not deducted from Total to Produce)."
            : null;
        stockCoveredNote = false;
      } else if (stockCoveredNote) {
        qcStockNote = "QC passed stock is available";
      }
    }

    // enforce excess semantics (stock-backed only; NO_QTY cycle production is stock-isolated)
    if (gapPercent != null && gapPercent < 0) {
      zone = "EXCESS";
      if (sheet?.salesOrder?.orderType !== "NO_QTY") totalWoQty = 0;
    }
    if (totalWoQty != null && totalWoQty < 0) totalWoQty = 0;

    if (sheet.status === "LOCKED") {
      const ful = fulfillmentQty != null ? round3(n(fulfillmentQty)) : 0;
      const stockForSug = round3(n(availableStockQty ?? 0));
      if (sheet?.salesOrder?.orderType === "NO_QTY") {
        suggestedNetWoQty =
          productionRequiredQty != null ? round3(n(productionRequiredQty)) : round3(Math.max(0, round3(shortfallQty ?? 0) + round3(newWoQty)));
      } else {
        suggestedNetWoQty = ful <= EPS ? 0 : round3(Math.max(0, ful - postCycleQty - stockForSug));
      }
    } else {
      // NO_QTY: Total to Produce on draft = last shortage + new requirement (usable surplus is informational for dispatch).
      const rawSf =
        sheet?.salesOrder?.orderType === "NO_QTY"
          ? round3(n(shortfallQty ?? 0))
          : round3(n(shortfallByItem.get(ln.itemId)?.rawShortfall ?? 0));
      suggestedNetWoQty =
        sheet?.salesOrder?.orderType === "NO_QTY"
          ? productionRequiredQty != null
            ? round3(n(productionRequiredQty))
            : round3(Math.max(0, rawSf + round3(newWoQty)))
          : round3(
              Math.max(0, rawSf + round3(newWoQty) - postCycleQty - round3(draftUsableStockForSuggest)),
            );
    }
    if (zone === "EXCESS" && sheet?.salesOrder?.orderType !== "NO_QTY") suggestedNetWoQty = 0;

    return {
      id: ln.id,
      itemId: ln.itemId,
      itemName: item?.itemName ?? `Item #${ln.itemId}`,
      shortfallQty,
      qcStockNote,
      ...(sheet?.salesOrder?.orderType === "NO_QTY"
        ? {
            postCycleApprovalQty: postCycleQty > EPS ? postCycleQty : 0,
            pendingQcDispositionQty: pendingDispositionQty > EPS ? pendingDispositionQty : 0,
            previousCycleUndispatchedAcceptedQty: undispatchedPriorQty > EPS ? undispatchedPriorQty : 0,
            totalUsableQty: round3(n(noQtyBreakdownByItem?.get(ln.itemId)?.totalUsableQty ?? usableStockDisplayQty(rawTotal))),
            /** Pending confirmed dispatch vs locked RS commitment (FIFO; includes closed cycles until fulfilled). */
            reservedForActiveNoQtyDispatchQty: round3(n(noQtyBreakdownByItem?.get(ln.itemId)?.reservedForActiveNoQtyDispatchQty ?? 0)),
            freeSurplusUsableQty: round3(
              Math.max(
                0,
                n(freeAfterNormalByItem.get(ln.itemId) ?? n(noQtyBreakdownByItem?.get(ln.itemId)?.freeSurplusUsableQty ?? 0)) -
                  n(reservedUnlockedDraftByItem.get(ln.itemId) ?? 0),
              ),
            ),
            ...(sheet.status !== "LOCKED"
              ? (() => {
                  return { usableTotalQty: null, reservedPendingDispatchQty: null, reservedPendingDispatchAppliedQty: null };
                })()
              : {}),
          }
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
    cancelledAt: sheet.cancelledAt ?? null,
    cancellationReason: sheet.cancellationReason ?? null,
    // Legacy compatibility: first linked WO only. Multi-WO consumers must use `workOrders`.
    workOrderId: existingWo?.id ?? null,
    productionMaterialRequestId: openPmr?.id ?? null,
    pmrDocNo: openPmr?.docNo ?? null,
    pmrStatus: openPmr?.status ?? null,
    workOrders,
    workOrderIds: workOrders.map((wo) => wo.id),
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
  requireRole(RS_READ_ROLES),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) return res.status(400).json(friendly400("Invalid sales order id."));
      await prisma.$transaction((tx) => assertSoNoQtyOrThrow(tx, soId));

      const rows = await prisma.requirementSheet.findMany({
        where: { salesOrderId: soId },
        orderBy: [{ periodKey: "desc" }, { version: "desc" }, { id: "desc" }],
        select: {
          id: true,
          periodKey: true,
          version: true,
          status: true,
          cycleId: true,
          createdAt: true,
          cycle: { select: { cycleNo: true } },
        },
      });
      return res.json(
        rows.map((r) => ({
          id: r.id,
          periodKey: r.periodKey,
          version: r.version,
          status: r.status,
          cycleId: r.cycleId,
          createdAt: r.createdAt,
          cycleNo: r.cycle?.cycleNo != null ? Number(r.cycle.cycleNo) : null,
        })),
      );
    } catch (e) {
      return next(e);
    }
  },
);

// POST /api/sales-orders/:id/requirement-sheets
requirementSheetsRouter.post(
  "/sales-orders/:id/requirement-sheets",
  requireAuth,
  requireRole(RS_WRITE_ROLES),
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
        await advanceNoQtyCycleForNextRequirementSheetIfEligible(tx, soId, req.user?.userId ?? null);
        const cycleId = await resolveNoQtyActiveCycleIdForPlanning(tx, soId);

        await assertNoLockedOrCancelledSheetForCyclePeriod(tx, {
          salesOrderId: soId,
          cycleId,
          periodKey,
        });

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

        await consumeCarryForwardPendingForRequirementSheet(tx, {
          salesOrderId: soId,
          cycleId,
          requirementSheetId: sheet.id,
          itemIds: selectedItemIds,
          actorUserId: req.user?.userId ?? null,
          actorRole: req.user?.role,
        });

        return sheet;
      });

      return res.status(201).json({ id: created.id });
    } catch (e) {
      if (e instanceof RequirementSheetLifecycleError) {
        return res.status(e.statusCode).json({
          message: e.message,
          code: e.code,
          details: e.details ?? undefined,
        });
      }
      return next(e);
    }
  },
);

// GET /api/requirement-sheets/:id
requirementSheetsRouter.get(
  "/requirement-sheets/:id",
  requireAuth,
  requireRole(RS_READ_ROLES),
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
  if (so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED") {
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
  requireRole(RS_WRITE_ROLES),
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
  requireRole(RS_WRITE_ROLES),
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
      if (sheet.status !== "DRAFT") {
        const msg =
          sheet.status === "CANCELLED"
            ? "Cancelled requirement sheets cannot be edited."
            : "Locked sheets cannot be edited.";
        return res.status(409).json(friendly400(msg));
      }

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
  requireRole(RS_WRITE_ROLES),
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
          const err = new Error(
            sheet.status === "CANCELLED"
              ? "Cancelled requirement sheets cannot be edited."
              : "Locked sheets cannot be edited.",
          );
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
  requireRole(RS_WRITE_ROLES),
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
        const { shortfallByItem } = await loadEffectiveNoQtyCarryForwardShortfallByItem(prisma, {
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
  requireRole(RS_WRITE_ROLES),
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
          const err = new Error(
            existing.status === "CANCELLED"
              ? "Cancelled requirement sheets cannot be locked."
              : "Sheet is already locked.",
          );
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

        const { shortfallByItem } = await loadEffectiveNoQtyCarryForwardShortfallByItem(tx, {
          salesOrderId: existing.salesOrderId,
          currentCycleId: activeCycleId,
        });
        /** Diagnostic only: legacy lock math (post-cycle / prior undispatched). Must not change persisted Total to Produce. */
        const postCycleByItemLock = await loadNoQtyPostCycleApprovalQtyByItem(tx, existing.salesOrderId, activeCycleId);
        const undispatchedPriorByItemLock = await loadNoQtyPriorCycleUndispatchedAcceptedByItem(tx, existing.salesOrderId, activeCycleId);
        const reservedNormalByItemLock = await reservedNormalDispatchQtyByItemForPlanning(existing.salesOrderId);
        const freeAfterNormalByItemLock = await freeUsableFgStockByItemForNoQtyPlanning({ salesOrderId: existing.salesOrderId });
        const reservedUnlockedDraftByItemLock = await reservedUnlockedDispatchDraftQtyByItemForPlanning(tx);
        const noQtyBreakdownByItemLock = await computeNoQtyUsablePlanningBreakdownByItem(tx, {
          salesOrderId: existing.salesOrderId,
          reservedForNormalDispatchByItem: reservedNormalByItemLock,
          // Critical: do NOT self-reserve the cycle being locked.
          excludeCycleId: activeCycleId,
          includeDebugRows: false,
        });

        let anyPositiveFulfillment = false;
        for (const ln of existing.lines || []) {
          const item = ln.item;
          const newWoQty = n(ln.requirementQty);
          const rawShortfall = shortfallByItem.get(ln.itemId)?.rawShortfall ?? 0;
          /** Last shortage for carry = prior cycle planned qty - approved produced qty (same as draft). */
          const confirmedCarrySnapshot = round3(Math.max(0, rawShortfall));
          const rawFree = Math.max(
            0,
            n(freeAfterNormalByItemLock.get(ln.itemId) ?? n(noQtyBreakdownByItemLock.get(ln.itemId)?.freeSurplusUsableQty ?? 0)) -
              n(reservedUnlockedDraftByItemLock.get(ln.itemId) ?? 0),
          );
          const usableStockUsed = round3(usableStockDisplayQty(rawFree));
          const totalDemand = round3(round3(confirmedCarrySnapshot) + round3(newWoQty));
          /** Prior-cycle leftover usable stays available for dispatch; do not auto-deduct from next cycle Total to Produce. */
          const productionRequiredQty = round3(Math.max(0, totalDemand));

          const postPc = round3(n(postCycleByItemLock.get(ln.itemId) ?? 0));
          const undPrior = round3(n(undispatchedPriorByItemLock.get(ln.itemId) ?? 0));
          const legacyDemandMinusSurplus = round3(Math.max(0, totalDemand - usableStockUsed));
          const legacyLockTotalToProduce = round3(
            Math.max(0, confirmedCarrySnapshot + round3(newWoQty) - postPc - undPrior),
          );
          if (Math.abs(legacyDemandMinusSurplus - productionRequiredQty) > EPS) {
            console.warn(
              "[NO_QTY_RS_LOCK] Total to Produce = last shortage + new requirement (usable surplus informational only; not subtracted).",
              {
                salesOrderId: existing.salesOrderId,
                requirementSheetId: existing.id,
                itemId: ln.itemId,
                totalDemand,
                usableStockSurplusSnapshot: usableStockUsed,
                totalToProduce: productionRequiredQty,
                legacyDemandMinusSurplus,
                legacyPostCycleUndispatchedFormula: legacyLockTotalToProduce,
              },
            );
          }

          const gapPercent = computeGapPercent(totalDemand, usableStockUsed);
          const zone = computeZone(gapPercent, item?.planningGapGreenThresholdPercent, item?.planningGapYellowThresholdPercent);
          if (totalDemand > EPS) anyPositiveFulfillment = true;

          await tx.requirementSheetLine.update({
            where: { id: ln.id },
            data: {
              // NO_QTY: requirementQty = new requirement only; shortfall snapshot = last shortage;
              // suggestedWoQtySnapshot = max(0, lastShortage + newReq); availableStockQtySnapshot = informational usable surplus for dispatch.
              requirementQty: String(round3(newWoQty)),
              availableStockQtySnapshot: usableStockUsed,
              gapPercentSnapshot: gapPercent,
              shortfallQtySnapshot: confirmedCarrySnapshot,
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

        return { locked };
      });

      const lockedSheet = sheet.locked;
      const detail = await mapSheetDetail(lockedSheet);

      return res.json({
        ...detail,
        lockHandoff: {
          workOrderCreated: false,
          workOrderId: detail.workOrderId ?? null,
          workOrderDocNo: null,
          productionMaterialRequest: null,
          executionStartsAt: "MONTHLY_PLAN_RELEASE",
        },
      });
    } catch (e) {
      return next(e);
    }
  },
);

// GET /api/requirement-sheets/:id/cancel-eligibility
requirementSheetsRouter.get(
  "/requirement-sheets/:id/cancel-eligibility",
  requireAuth,
  requireRole(RS_READ_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));
      const evaluation = await evaluateRequirementSheetCancellation(prisma, id);
      return res.json(evaluation);
    } catch (e) {
      return next(e);
    }
  },
);

// POST /api/requirement-sheets/:id/cancel — retain audit trail (P6B-1B)
requirementSheetsRouter.post(
  "/requirement-sheets/:id/cancel",
  requireAuth,
  requireRole(RS_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));
      const body = z.object({ reason: z.string().optional().nullable() }).parse(req.body ?? {});

      const result = await prisma.$transaction(async (tx) => {
        const { sheet } = await cancelLockedRequirementSheet(tx, {
          sheetId: id,
          actorUserId: req.user?.userId ?? null,
          reason: body.reason ?? null,
        });

        const rsDoc = displayRequirementSheetNo(sheet.id, sheet.docNo);
        const soDoc = displaySalesOrderNo(sheet.salesOrder?.id ?? sheet.salesOrderId, sheet.salesOrder?.docNo);
        await logActivity({
          tx,
          user: req.user,
          module: ACTIVITY_MODULES.REQUIREMENT_SHEET,
          entityType: ACTIVITY_ENTITY_TYPES.REQUIREMENT_SHEET,
          entityId: sheet.id,
          docNo: rsDoc,
          action: ACTIVITY_ACTIONS.CANCELLED,
          message: `Requirement Sheet ${rsDoc} cancelled`,
          reason: body.reason?.trim() || null,
          metadata: {
            salesOrderId: sheet.salesOrderId,
            salesOrderDocNo: soDoc,
            cycleId: sheet.cycleId ?? undefined,
            cycleNo: sheet.cycle?.cycleNo ?? undefined,
            periodKey: sheet.periodKey,
          },
        });

        return sheet;
      });

      return res.json({
        ok: true,
        id: result.id,
        status: result.status,
        message: RS_LIFECYCLE_MESSAGES.CANCEL_SUCCESS,
      });
    } catch (e) {
      if (e instanceof RequirementSheetLifecycleError) {
        return res.status(e.statusCode).json({
          message: e.message,
          code: e.code,
          details: e.details ?? undefined,
        });
      }
      return next(e);
    }
  },
);

// POST /api/requirement-sheets/:id/void
// Deprecated: diagnostic hard-delete only (ADMIN). Normal workflow uses POST /cancel.
requirementSheetsRouter.post(
  "/requirement-sheets/:id/void",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));
      const body = z
        .object({
          diagnosticDelete: z.boolean().optional(),
          confirm: z.boolean().optional(),
        })
        .parse(req.body ?? {});

      if (body.diagnosticDelete !== true || body.confirm !== true) {
        return res.status(410).json({
          message:
            "Void (hard delete) is deprecated. Use Cancel Requirement Sheet instead. Diagnostic delete requires diagnosticDelete and confirm flags.",
          code: "VOID_DEPRECATED",
        });
      }

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

        const activeWos = await tx.workOrder.findMany({
          where: { requirementSheetId: sheet.id, status: { in: [...NO_QTY_WO_PLACED_COUNT_STATUSES] } },
          select: { id: true },
        });

        if (activeWos.length) {
          const woIds = activeWos.map((wo) => wo.id);
          const prodCount = await tx.productionEntry.count({
            where: { workOrderLine: { workOrderId: { in: woIds } } },
          });
          if (prodCount > 0) {
            const err = new Error(
              "Cannot void this requirement sheet because production has already started on its work order.",
            );
            err.statusCode = 409;
            throw err;
          }
          const err = new Error("Cannot void this requirement sheet because active Work Orders already exist.");
          err.statusCode = 409;
          throw err;
        }

        await tx.requirementSheet.delete({ where: { id: sheet.id } });
        return { deletedRequirementSheetId: sheet.id, deletedWorkOrderId: null };
      });

      return res.status(200).json(result);
    } catch (e) {
      return next(e);
    }
  },
);

// GET /api/requirement-sheets/:id/execution — read-only RS execution workspace (P10-A2A)
requirementSheetsRouter.get(
  "/requirement-sheets/:id/execution",
  requireAuth,
  requireRole(RS_READ_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));
      const data = await getRequirementSheetExecutionSummary(prisma, id);
      return res.json(data);
    } catch (e) {
      if (e.statusCode === 404) return res.status(404).json(friendly400(e.message));
      if (e.statusCode === 409) return res.status(409).json(friendly400(e.message));
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
            const q = resolveNoQtyWoExecutableQty(ln);
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

async function ensurePmrsForCreatedWorkOrders(tx, { createdWorkOrders, actor = {}, ensurePmr = ensureSubmittedProductionMaterialRequestForWorkOrder }) {
  const pmrs = [];
  for (const wo of createdWorkOrders ?? []) {
    const pmr = await ensurePmr(
      wo.workOrderId,
      {
        userId: actor.userId,
        role: actor.role,
      },
      tx,
    );
    pmrs.push({
      workOrderId: wo.workOrderId,
      pmrId: pmr?.id ?? null,
      pmrDocNo: pmr?.docNo ?? null,
      status: pmr?.status ?? null,
    });
  }
  return pmrs;
}

// POST /api/requirement-sheets/:id/create-wo
// One-click WO creation for NO_QTY sales orders from a LOCKED, latest requirement sheet version.
requirementSheetsRouter.post(
  "/requirement-sheets/:id/create-wo",
  requireAuth,
  requireRole(RS_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid requirement sheet id."));
      const body = z
        .object({
          lines: z
            .array(
              z.object({
                itemId: z.coerce.number().int().positive(),
                qty: z.coerce.number(),
              }),
            )
            .optional()
            .nullable(),
        })
        .parse(req.body ?? {});

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

        const sheetCycleId = sheet.cycleId != null ? Number(sheet.cycleId) : null;
        if (!sheetCycleId || !Number.isFinite(sheetCycleId) || sheetCycleId <= 0) {
          const err = new Error("Requirement sheet is not linked to a planning cycle.");
          err.statusCode = 409;
          throw err;
        }

        const periodKey = sheet.periodKey ?? null;
        const versionNum = Number(sheet.version ?? 1);
        if (!periodKey) {
          const err = new Error("Invalid requirement sheet period.");
          err.statusCode = 409;
          throw err;
        }

        const maxV = await tx.requirementSheet.aggregate({
          where: { salesOrderId: sheet.salesOrderId, periodKey, cycleId: sheetCycleId },
          _max: { version: true },
        });
        const latest = Number(maxV._max.version ?? versionNum);
        if (versionNum < latest) {
          const err = new Error(
            "Work Order can be created only from the latest requirement sheet version for this period and cycle.",
          );
          err.statusCode = 409;
          throw err;
        }

        await assertNoQtyRequirementSheetPeriodReleased(tx, sheet);

        const woResult = await createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
          requestedLines: Array.isArray(body.lines) ? body.lines : undefined,
        });
        if (!woResult.workOrderId) {
          const err = new Error(
            woResult.skippedReason === "ZERO_EXECUTABLE_QTY"
              ? "No RS Balance remains for Work Order creation on this requirement sheet."
              : "Work order could not be created from this requirement sheet.",
          );
          err.statusCode = 409;
          throw err;
        }

        const createdWorkOrders = Array.isArray(woResult.workOrders) && woResult.workOrders.length > 0
          ? woResult.workOrders
          : [{ workOrderId: woResult.workOrderId, workOrderDocNo: woResult.workOrderDocNo ?? null }];
        const pmrs = await ensurePmrsForCreatedWorkOrders(tx, {
          createdWorkOrders,
          actor: { userId: req.user?.userId, role: req.user?.role },
        });

        return {
          id: woResult.workOrderId,
          workOrderId: woResult.workOrderId,
          workOrderDocNo: woResult.workOrderDocNo ?? null,
          workOrderIds: createdWorkOrders.map((wo) => wo.workOrderId),
          workOrders: createdWorkOrders,
          pmrs,
          salesOrderId: sheet.salesOrderId,
        };
      });

      return res.status(201).json({
        workOrderId: result.workOrderId,
        workOrderDocNo: result.workOrderDocNo ?? null,
        workOrderIds: result.workOrderIds ?? [result.workOrderId].filter(Boolean),
        workOrders: result.workOrders ?? [],
        pmrs: result.pmrs ?? [],
        salesOrderId: result.salesOrderId,
      });
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = {
  requirementSheetsRouter,
  ensurePmrsForCreatedWorkOrders,
  loadNoQtyCarryForwardShortfallByItem,
  plannedNewRequirementAndQcAcceptedByItemForSingleCycle,
  loadEffectiveNoQtyCarryForwardShortfallByItem,
  getNoQtyLastShortageQtyForCycleItem,
  loadNoQtyPriorCycleUndispatchedAcceptedByItem,
  computeNoQtyOperatorCarryForwardQty,
  loadNoQtyProductionSurplusByItemForPriorCycle,
  resolveNoQtyCarryForwardDemandQty,
  loadNoQtyExecutionResolutionByItemForCycle,
};
