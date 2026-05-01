/**
 * Work order vs sales order validation.
 *
 * Commercial fields on sales order lines (e.g. isFree, quotation pricing) are intentionally ignored here;
 * only quantities and operational caps matter.
 *
 * Remaining quantity rule (WO / production planning):
 *   remainingQty = FG_SO_QTY
 *                - confirmedNetDispatched (LOCKED forwards + reversal rows via {@link DISPATCH_ALLOC_MODE.CONFIRMED})
 *                - woPlannedQty (other reserving work orders for same SO + FG item)
 *
 * Does **not** use operational / draft / UNLOCKED dispatch — those are excluded by CONFIRMED filtering.
 *
 * Other WO planned qty:
 * - Creating / validating without excludeWorkOrderId: all reserving WO lines on the SO for that item.
 * - Editing (excludeWorkOrderId set): only lines *not* on the WO under edit.
 *
 * Approved production does **not** reduce remaining for planning (dispatch fulfillment drives the cap).
 * Open WO commitments that still consume “remaining qty” for **new** WO planning:
 * {@link WORK_ORDER_STATUSES_BLOCKING_REMAINING_WO_PLAN} (PENDING + IN_PROGRESS only).
 * COMPLETED work orders do not reduce that headroom — fulfillment vs the SO is reflected in
 * confirmed dispatch and production metrics instead.
 *
 * REJECTED (and any future CANCELLED/CLOSED-style statuses) are excluded everywhere below.
 */

const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { getUsableItemStockQty, getItemStockQty } = require("./stockService");
const { sumQcAcceptedForSoItem } = require("./dispatchQcCap");
const { remainingDispatchCapacityForSoItem, netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("./salesOrderDispatchAllocation");
const { mapSoLinesToDispatchFifoInputs } = require("./regularSoBufferQty");
const {
  getSoItemDispatchableReadyQty,
  getSoItemQcApprovedRemainingQty,
} = require("./reportMetrics");

const EPS = 1e-6;

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * These statuses still reserve SO+FG quantity against **new** work order planning
 * (same basis as {@link remainingOpenQtyForItem} / allocatedByItem).
 * @type {import("@prisma/client").SimpleStatus[]}
 */
const WORK_ORDER_STATUSES_BLOCKING_REMAINING_WO_PLAN = ["PENDING", "IN_PROGRESS"];

/**
 * Include COMPLETED when aggregating approved production on WO lines for this SO (UI / breakdown).
 * @type {import("@prisma/client").SimpleStatus[]}
 */
const WORK_ORDER_STATUSES_WITH_WO_LINE_METRICS = ["PENDING", "IN_PROGRESS", "COMPLETED"];

/**
 * Total QC accepted qty per FG item for one sales order (production QC only; non-reversed).
 *
 * totalAcceptedQty = SUM(QcEntry.acceptedQty) over all productions whose WO line belongs to this SO.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} salesOrderId
 * @param {number | null | undefined} excludeWorkOrderId
 * @returns {Promise<Map<number, number>>} key: fgItemId → totalAcceptedQty
 */
async function loadSoTotalAcceptedQtyByItem(db, salesOrderId, excludeWorkOrderId = null) {
  const woWhere = {
    salesOrderId,
    status: { in: ["PENDING", "IN_PROGRESS", "COMPLETED"] },
    ...(excludeWorkOrderId != null ? { id: { not: excludeWorkOrderId } } : {}),
  };

  const woLines = await db.workOrderLine.findMany({
    where: { workOrder: woWhere },
    select: { id: true, fgItemId: true },
  });
  if (!woLines.length) return new Map();

  const lineIdToItemId = new Map(woLines.map((l) => [l.id, l.fgItemId]));
  const productions = await db.productionEntry.findMany({
    where: { workOrderLineId: { in: woLines.map((l) => l.id) } },
    select: { id: true, workOrderLineId: true },
  });
  if (!productions.length) return new Map();

  const prodIdToItemId = new Map(productions.map((p) => [p.id, lineIdToItemId.get(p.workOrderLineId)]));
  const qcByProd = await db.qcEntry.groupBy({
    by: ["productionId"],
    where: { productionId: { in: productions.map((p) => p.id) }, reversedAt: null },
    _sum: { acceptedQty: true },
  });

  const acceptedByItem = new Map();
  for (const r of qcByProd) {
    const itemId = prodIdToItemId.get(r.productionId);
    if (!itemId) continue;
    acceptedByItem.set(itemId, (acceptedByItem.get(itemId) || 0) + n(r._sum.acceptedQty));
  }
  return acceptedByItem;
}

/**
 * Carry-forward shortfall for one SO + FG item, computed dynamically (no table).
 *
 * Net shortfall per item:
 *   carryForwardShortfall = max(0, SUM(plannedQty on COMPLETED WOs) - SUM(QC acceptedQty on those WOs))
 *
 * Notes:
 * - Only COMPLETED WOs are included to avoid double-counting: open WOs already reserve via allocatedByItem.
 * - QC accepted is summed from QcEntry.acceptedQty where reversedAt is null.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} salesOrderId
 * @param {number | null | undefined} excludeWorkOrderId
 * @returns {Promise<Map<number, number>>} key: fgItemId → carryForwardShortfallQty
 */
async function loadCarryForwardShortfallByItem(db, salesOrderId, excludeWorkOrderId = null) {
  const completedWoWhere = {
    salesOrderId,
    status: "COMPLETED",
    ...(excludeWorkOrderId != null ? { id: { not: excludeWorkOrderId } } : {}),
  };

  const completedWoLines = await db.workOrderLine.findMany({
    where: { workOrder: completedWoWhere },
    select: { id: true, fgItemId: true, plannedQty: true },
  });
  if (!completedWoLines.length) return new Map();

  const plannedByItem = new Map();
  for (const l of completedWoLines) {
    plannedByItem.set(l.fgItemId, (plannedByItem.get(l.fgItemId) || 0) + n(l.plannedQty));
  }

  const lineIds = completedWoLines.map((l) => l.id);
  const productions = await db.productionEntry.findMany({
    where: { workOrderLineId: { in: lineIds } },
    select: { id: true, workOrderLineId: true },
  });
  if (!productions.length) {
    // No QC possible without production; carry-forward is all planned for those completed WOs.
    const out = new Map();
    for (const [itemId, planned] of plannedByItem) out.set(itemId, Math.max(0, planned));
    return out;
  }

  const prodIdToLineId = new Map(productions.map((p) => [p.id, p.workOrderLineId]));
  const prodIds = productions.map((p) => p.id);

  const qcByProd = await db.qcEntry.groupBy({
    by: ["productionId"],
    where: { productionId: { in: prodIds }, reversedAt: null },
    _sum: { acceptedQty: true },
  });

  const acceptedByLineId = new Map();
  for (const r of qcByProd) {
    const lineId = prodIdToLineId.get(r.productionId);
    if (!lineId) continue;
    acceptedByLineId.set(lineId, (acceptedByLineId.get(lineId) || 0) + n(r._sum.acceptedQty));
  }

  const acceptedByItem = new Map();
  for (const l of completedWoLines) {
    const a = acceptedByLineId.get(l.id) || 0;
    acceptedByItem.set(l.fgItemId, (acceptedByItem.get(l.fgItemId) || 0) + a);
  }

  const out = new Map();
  for (const [itemId, planned] of plannedByItem) {
    const accepted = acceptedByItem.get(itemId) || 0;
    const shortfall = Math.max(0, planned - accepted);
    if (shortfall > EPS) out.set(itemId, shortfall);
  }
  return out;
}

/**
 * Loads ordered, dispatch (for reporting fields), produced-subtract, and other-WO-planned maps for a sales order.
 * Used by validation, FG balance API, and WO dropdown eligibility (single source of truth).
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} salesOrderId
 * @param {number | null | undefined} excludeWorkOrderId — exclude this WO's lines from "other WO" sums (edit mode)
 * @returns {Promise<null | {
 *   so: import('@prisma/client').SalesOrder & { lines: any[]; dispatch: any[] };
 *   orderQtyByItem: Map<number, number>;
 *   fgOrderQtyByItem: Map<number, number>;
 *   dispatchedByItem: Map<number, number>;
 *   producedTotalByItem: Map<number, number>;
 *   producedSubtractByItem: Map<number, number>;
 *   allocatedByItem: Map<number, number>;
 *   acceptedByItem: Map<number, number>;
 *   carryForwardShortfallByItem: Map<number, number>;
 * }>}
 */
async function loadWorkOrderQuantityContext(db, salesOrderId, excludeWorkOrderId = null) {
  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: { lines: { include: { item: true } }, dispatch: true },
  });
  if (!so) return null;

  const orderQtyByItem = new Map();
  /** Sum of SalesOrderLine.qty for FG lines only — must match {@link getEligibleSalesOrderIdsForWorkOrder} and dispatch confirmed backlog. */
  const fgOrderQtyByItem = new Map();
  for (const sl of so.lines) {
    orderQtyByItem.set(sl.itemId, (orderQtyByItem.get(sl.itemId) || 0) + Number(sl.qty));
    if (sl.item?.itemType === "FG") {
      fgOrderQtyByItem.set(sl.itemId, (fgOrderQtyByItem.get(sl.itemId) || 0) + Number(sl.qty));
    }
  }

  // NO_QTY: SalesOrderLine.qty may be 0/placeholder. Planning eligibility must use the current cycle cap
  // from the latest LOCKED Requirement Sheet for that cycle (suggestedWoQtySnapshot / requirementQty).
  if (so.orderType === "NO_QTY" && so.currentCycleId != null) {
    const cycleId = Number(so.currentCycleId);
    if (Number.isFinite(cycleId) && cycleId > 0) {
      const sheet = await db.requirementSheet.findFirst({
        where: { salesOrderId, cycleId, status: "LOCKED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { lines: true },
      });
      if (sheet?.lines?.length) {
        fgOrderQtyByItem.clear();
        for (const ln of sheet.lines) {
          const cap = Math.max(n(ln.suggestedWoQtySnapshot ?? 0), n(ln.requirementQty ?? 0));
          if (!(cap > 0)) continue;
          fgOrderQtyByItem.set(ln.itemId, (fgOrderQtyByItem.get(ln.itemId) || 0) + cap);
        }
      }
    }
  }

  /** Confirmed net dispatched per item (LOCKED forwards + reversals only; excludes UNLOCKED draft forwards). */
  const dispatchedByItem = new Map();
  for (const [itemId, v] of netDispatchedByItemId(so.dispatch || [], DISPATCH_ALLOC_MODE.CONFIRMED)) {
    dispatchedByItem.set(itemId, v);
  }

  const metricsWoWhere = { salesOrderId, status: { in: WORK_ORDER_STATUSES_WITH_WO_LINE_METRICS } };
  const allWoLinesForSo = await db.workOrderLine.findMany({
    where: { workOrder: metricsWoWhere },
  });
  const producedByLineId =
    allWoLinesForSo.length === 0
      ? new Map()
      : await getApprovedProducedQtyByWorkOrderLineIds(db, allWoLinesForSo.map((l) => l.id));

  /** Sum of APPROVED produced qty on all reserving WO lines for this SO + item (for UI breakdown). */
  const producedTotalByItem = new Map();
  for (const l of allWoLinesForSo) {
    const p = producedByLineId.get(l.id) ?? 0;
    producedTotalByItem.set(l.fgItemId, (producedTotalByItem.get(l.fgItemId) || 0) + p);
  }

  /** Approved produced on lines that count against SO capacity (excludes WO under edit). */
  const producedSubtractByItem = new Map();
  for (const l of allWoLinesForSo) {
    if (excludeWorkOrderId != null && l.workOrderId === excludeWorkOrderId) continue;
    const p = producedByLineId.get(l.id) ?? 0;
    producedSubtractByItem.set(l.fgItemId, (producedSubtractByItem.get(l.fgItemId) || 0) + p);
  }

  const blockingWoWhere = { salesOrderId, status: { in: WORK_ORDER_STATUSES_BLOCKING_REMAINING_WO_PLAN } };
  const otherWoWhere = {
    ...blockingWoWhere,
    ...(excludeWorkOrderId != null ? { id: { not: excludeWorkOrderId } } : {}),
  };

  const otherWoLines = await db.workOrderLine.findMany({
    where: { workOrder: otherWoWhere },
  });

  const allocatedByItem = new Map();
  for (const ol of otherWoLines) {
    allocatedByItem.set(ol.fgItemId, (allocatedByItem.get(ol.fgItemId) || 0) + Number(ol.qty));
  }

  const acceptedByItem = await loadSoTotalAcceptedQtyByItem(db, salesOrderId, excludeWorkOrderId);
  const carryForwardShortfallByItem = await loadCarryForwardShortfallByItem(
    db,
    salesOrderId,
    excludeWorkOrderId,
  );

  return {
    so,
    orderQtyByItem,
    fgOrderQtyByItem,
    dispatchedByItem,
    producedTotalByItem,
    producedSubtractByItem,
    allocatedByItem,
    acceptedByItem,
    carryForwardShortfallByItem,
  };
}

/**
 * Remaining quantity for WO planning on one item — same formula as {@link assertWorkOrderLinesAgainstSalesOrder}
 * and {@link getEligibleSalesOrderIdsForWorkOrder}:
 *   max(0, FG_SO_QTY − totalAcceptedQty − woPlannedQty(open WOs only: PENDING + IN_PROGRESS)).
 *
 * @param {{ fgOrderQtyByItem: Map<number, number>; allocatedByItem: Map<number, number>; acceptedByItem: Map<number, number> }} ctx
 * @param {number} itemId
 */
function remainingOpenQtyForItem(ctx, itemId) {
  const fgQty = ctx.fgOrderQtyByItem.get(itemId) ?? 0;
  const accepted = ctx.acceptedByItem?.get(itemId) || 0;
  const woPlanned = ctx.allocatedByItem.get(itemId) || 0;
  return Math.max(0, fgQty - accepted - woPlanned);
}

function aggregateQtyByItem(lineRequests) {
  const m = new Map();
  for (const l of lineRequests) {
    const id = l.fgItemId;
    m.set(id, (m.get(id) || 0) + Number(l.qty));
  }
  return m;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ salesOrderId: number; lineRequests: { fgItemId: number; qty: number }[]; excludeWorkOrderId?: number | null }} params
 */
async function assertWorkOrderLinesAgainstSalesOrder(tx, { salesOrderId, lineRequests, excludeWorkOrderId }) {
  if (!lineRequests.length) {
    const err = new Error("Work order must include at least one line.");
    err.statusCode = 400;
    throw err;
  }

  const soLane = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { id: true, orderType: true, customerReturnId: true },
  });
  if (!soLane) {
    const err = new Error("Sales order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (soLane.orderType === "REPLACEMENT" || soLane.customerReturnId != null) {
    const err = new Error(
      "Work orders are not allowed on customer-return replacement sales orders. Use customer-return QC and replacement dispatch instead.",
    );
    err.statusCode = 409;
    err.code = "NO_WO_ON_CUSTOMER_RETURN_REPLACEMENT_SO";
    throw err;
  }

  const ctx = await loadWorkOrderQuantityContext(tx, salesOrderId, excludeWorkOrderId);
  if (!ctx) {
    const err = new Error("Sales order not found.");
    err.statusCode = 404;
    throw err;
  }
  const { so } = ctx;
  if (so.internalStatus !== "APPROVED") {
    const err = new Error("Work order can only be created from an approved sales order.");
    err.statusCode = 409;
    throw err;
  }

  const requested = aggregateQtyByItem(lineRequests);
  const itemIds = [...requested.keys()];
  const items = await tx.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, itemName: true, itemType: true },
  });
  const itemLabel = (id) => items.find((i) => i.id === id)?.itemName ?? `Item #${id}`;

  for (const [itemId, reqQty] of requested) {
    const orderedFg = ctx.fgOrderQtyByItem.get(itemId);
    if (orderedFg == null || orderedFg < EPS) {
      const err = new Error(
        "Each work order line must use an item that appears on the selected sales order.",
      );
      err.statusCode = 400;
      throw err;
    }

    const meta = items.find((i) => i.id === itemId);
    if (!meta || meta.itemType !== "FG") {
      const err = new Error(
        "Work order lines may only include finished goods that are listed on the selected sales order.",
      );
      err.statusCode = 400;
      throw err;
    }

    const allowed = remainingOpenQtyForItem(ctx, itemId);

    if (reqQty > allowed + EPS) {
      const maxShow = Math.max(0, allowed);
      const maxStr = Number.isInteger(maxShow) ? String(maxShow) : maxShow.toFixed(3);
      const err = new Error(
        `Work order quantity for "${itemLabel(itemId)}" exceeds the remaining open quantity for this sales order. Maximum allowed now: ${maxStr}.`,
      );
      err.statusCode = 409;
      throw err;
    }
  }
}

/**
 * Read-only breakdown per FG item on a sales order — same quantity rules as
 * {@link assertWorkOrderLinesAgainstSalesOrder}.
 *
 * balanceQty = remainingQty = max(0, FG_SO_QTY − totalAcceptedQty − woPlanned(other open WOs)).
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ salesOrderId: number; excludeWorkOrderId?: number | null }} params
 * @returns {Promise<{ salesOrderId: number; items: Array<{ itemId: number; itemName: string; soOrderedQty: number; dispatchedQty: number; producedQty: number; plannedOnOtherWorkOrdersQty: number; totalAcceptedQty: number; carryForwardShortfallQty: number; balanceQty: number; pendingSoQty: number; stockAvailableQty: number; qcAcceptedGross: number; qcApprovedRemaining: number; dispatchableQty: number; shortageQty: number; suggestedWoQty: number }> }>}
 */
async function getSalesOrderFgWorkOrderBalances(db, { salesOrderId, excludeWorkOrderId = null }) {
  const ctx = await loadWorkOrderQuantityContext(db, salesOrderId, excludeWorkOrderId);
  if (!ctx) {
    const err = new Error("Sales order not found.");
    err.statusCode = 404;
    throw err;
  }
  const { so } = ctx;

  const lineInputsForDispatch = mapSoLinesToDispatchFifoInputs(so.lines, so.orderType);
  /** Operational / QC / dispatch UI only — not used for balanceQty / remainingQty. */
  const netByItemOp = netDispatchedByItemId(so.dispatch || [], DISPATCH_ALLOC_MODE.OPERATIONAL);

  /** NO_QTY: latest locked requirement sheet quantities for current cycle (balance + latest RS demand). */
  const noQtyRsByItemId = new Map();
  if (so.orderType === "NO_QTY" && so.currentCycleId != null) {
    const cycleId = Number(so.currentCycleId);
    if (Number.isFinite(cycleId) && cycleId > 0) {
      const locked = await db.requirementSheet.findFirst({
        where: { salesOrderId, cycleId, status: "LOCKED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { lines: true },
      });
      for (const ln of locked?.lines || []) {
        // Balance qty: carried shortfall snapshot at lock time.
        const balanceQty = n(ln.shortfallQtySnapshot ?? 0);
        // Latest RS qty: fresh manual requirement qty on the locked sheet.
        const latestRsQty = n(ln.requirementQty ?? 0);
        // Only FG items are relevant; filter later by fgNameByItem.
        noQtyRsByItemId.set(ln.itemId, { balanceQty, latestRsQty });
      }
    }
  }

  /** @type {Map<number, string>} */
  const fgNameByItem = new Map();
  for (const sl of so.lines) {
    if (sl.item.itemType === "FG") {
      if (!fgNameByItem.has(sl.itemId)) {
        fgNameByItem.set(sl.itemId, sl.item.itemName);
      }
    }
  }

  const items = [];
  for (const [itemId, itemName] of fgNameByItem) {
    const ordered = ctx.fgOrderQtyByItem.get(itemId) ?? 0;
    const disp = ctx.dispatchedByItem.get(itemId) ?? 0;
    const produced = ctx.producedTotalByItem.get(itemId) || 0;
    const planned = ctx.allocatedByItem.get(itemId) || 0;
    const totalAcceptedQty = ctx.acceptedByItem.get(itemId) || 0;
    const carryForwardShortfallQty = ctx.carryForwardShortfallByItem.get(itemId) || 0;
    const balanceQty = remainingOpenQtyForItem(ctx, itemId);
    const stockAvailableQty = await getUsableItemStockQty(itemId, db);
    const qcAcceptedGross = await sumQcAcceptedForSoItem(db, salesOrderId, itemId);
    const netOp = netByItemOp.get(itemId) ?? 0;
    const qcApprovedRemaining = getSoItemQcApprovedRemainingQty(qcAcceptedGross, netOp);
    const pendingSoQty = remainingDispatchCapacityForSoItem(lineInputsForDispatch, so.dispatch || [], itemId);
    const dispatchableQty = getSoItemDispatchableReadyQty({
      orderLineInputs: lineInputsForDispatch,
      dispatchRecords: so.dispatch || [],
      itemId,
      orderType: so.orderType,
      onHandQty: stockAvailableQty,
      qcAcceptedTotalForSoItem: qcAcceptedGross,
    });
    const shortageQty = Math.max(0, pendingSoQty - dispatchableQty);
    // NO_QTY next-WO planning standard:
    // Final WO Qty = Balance Qty + Latest RS Qty - QC Passed Stock available
    // ... then apply existing open-WO reservation (plannedOnOtherWorkOrdersQty) to avoid double-counting.
    const noQtyRs = noQtyRsByItemId.get(itemId) ?? null;
    const latestRsQty = noQtyRs ? n(noQtyRs.latestRsQty) : 0;
    const balanceCarry = noQtyRs ? n(noQtyRs.balanceQty) : 0;
    const qcPassedStockAvailable = n(stockAvailableQty);
    const finalWoQtyRaw = Math.max(0, balanceCarry + latestRsQty - qcPassedStockAvailable);
    const finalWoQty = Math.max(0, finalWoQtyRaw - n(planned));
    /** Prefill WO qty */
    const suggestedWoQty = so.orderType === "NO_QTY" ? finalWoQty : Math.max(0, balanceQty);
    items.push({
      itemId,
      itemName,
      soOrderedQty: ordered,
      dispatchedQty: disp,
      producedQty: produced,
      plannedOnOtherWorkOrdersQty: planned,
      totalAcceptedQty,
      carryForwardShortfallQty,
      balanceQty,
      ...(so.orderType === "NO_QTY"
        ? {
            noQtyBalanceQty: balanceCarry,
            noQtyLatestRsQty: latestRsQty,
            noQtyQcPassedStockQty: qcPassedStockAvailable,
            noQtyFinalWoQty: finalWoQty,
          }
        : {}),
      pendingSoQty,
      stockAvailableQty,
      qcAcceptedGross,
      qcApprovedRemaining,
      dispatchableQty,
      shortageQty,
      suggestedWoQty,
    });
  }
  items.sort((a, b) => a.itemId - b.itemId);
  return { salesOrderId, items };
}

/**
 * Approved sales orders that have at least one FG with remaining for planning &gt; EPS
 * (FG order qty − confirmed net dispatched − planned on other **open** WOs: PENDING + IN_PROGRESS).
 * Uses the same formula as {@link assertWorkOrderLinesAgainstSalesOrder} / {@link loadWorkOrderQuantityContext}.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ includeSalesOrderId?: number }} [opts]
 * @returns {Promise<number[]>} SO ids, descending
 */
async function getEligibleSalesOrderIdsForWorkOrder(db, opts = {}) {
  const { includeSalesOrderId } = opts;

  const approved = await db.salesOrder.findMany({
    where: { internalStatus: "APPROVED" },
    orderBy: { id: "desc" },
    include: { lines: { include: { item: true } }, dispatch: true },
  });

  if (!approved.length) {
    return includeSalesOrderId && Number.isFinite(includeSalesOrderId) && includeSalesOrderId > 0
      ? [includeSalesOrderId]
      : [];
  }

  const soIds = approved.map((s) => s.id);
  const woLines = await db.workOrderLine.findMany({
    where: {
      workOrder: {
        salesOrderId: { in: soIds },
        status: { in: WORK_ORDER_STATUSES_BLOCKING_REMAINING_WO_PLAN },
      },
    },
    include: { workOrder: true },
  });

  /** @type {Map<string, number>} key = `${soId}:${fgItemId}` */
  const plannedBySoItem = new Map();
  for (const l of woLines) {
    const soId = l.workOrder.salesOrderId;
    const key = `${soId}:${l.fgItemId}`;
    plannedBySoItem.set(key, (plannedBySoItem.get(key) || 0) + Number(l.qty));
  }

  const eligibleIds = new Set();

  /** totalAcceptedQty per soId:itemId (production QC only, non-reversed) */
  /** @type {Map<string, number>} */
  const acceptedBySoItem = new Map();
  if (soIds.length) {
    const woAll = await db.workOrderLine.findMany({
      where: { workOrder: { salesOrderId: { in: soIds }, status: { in: WORK_ORDER_STATUSES_WITH_WO_LINE_METRICS } } },
      select: { id: true, fgItemId: true, workOrder: { select: { salesOrderId: true } } },
    });
    if (woAll.length) {
      const lineIds = woAll.map((l) => l.id);
      const prods = await db.productionEntry.findMany({
        where: { workOrderLineId: { in: lineIds } },
        select: { id: true, workOrderLineId: true },
      });
      if (prods.length) {
        const prodIdToLineId = new Map(prods.map((p) => [p.id, p.workOrderLineId]));
        const lineMetaById = new Map(woAll.map((l) => [l.id, { fgItemId: l.fgItemId, soId: l.workOrder.salesOrderId }]));
        const qcByProd = await db.qcEntry.groupBy({
          by: ["productionId"],
          where: { productionId: { in: prods.map((p) => p.id) }, reversedAt: null },
          _sum: { acceptedQty: true },
        });
        for (const r of qcByProd) {
          const lineId = prodIdToLineId.get(r.productionId);
          if (!lineId) continue;
          const meta = lineMetaById.get(lineId);
          if (!meta) continue;
          const key = `${meta.soId}:${meta.fgItemId}`;
          acceptedBySoItem.set(key, (acceptedBySoItem.get(key) || 0) + n(r._sum.acceptedQty));
        }
      }
    }
  }

  for (const so of approved) {
    if (so.orderType === "REPLACEMENT" || so.customerReturnId != null) continue;
    const fgLines = (so.lines || []).filter((sl) => sl.item?.itemType === "FG");
    if (!fgLines.length) continue;

    let hasPositive = false;
    // Pending-only rule aligned with Production Planning "To produce" AND active planned WOs:
    // toProduce = max(0, orderedQty - current FG stock)
    // remainingAfterConfirmedDispatch = max(0, orderedQty - confirmedNetDispatched(CONFIRMED))
    // pending_for_wo = max(0, min(toProduce, remainingAfterConfirmedDispatch) - active_planned_wo_qty)
    // (active = PENDING + IN_PROGRESS)
    const orderedByItem = new Map();
    for (const sl of fgLines) orderedByItem.set(sl.itemId, (orderedByItem.get(sl.itemId) || 0) + Number(sl.qty));
    for (const [itemId, ordered] of orderedByItem) {
      const planned = plannedBySoItem.get(`${so.id}:${itemId}`) || 0;
      const accepted = acceptedBySoItem.get(`${so.id}:${itemId}`) || 0;
      const pendingForWo = Math.max(0, ordered - accepted - planned);
      if (pendingForWo > EPS) {
        hasPositive = true;
        break;
      }
    }
    if (hasPositive) eligibleIds.add(so.id);
  }

  if (includeSalesOrderId && Number.isFinite(includeSalesOrderId) && includeSalesOrderId > 0) {
    const inc = await db.salesOrder.findUnique({
      where: { id: includeSalesOrderId },
      select: { id: true, orderType: true, customerReturnId: true },
    });
    if (inc && inc.orderType !== "REPLACEMENT" && inc.customerReturnId == null) {
      eligibleIds.add(includeSalesOrderId);
    }
  }

  return [...eligibleIds].sort((a, b) => b - a);
}

module.exports = {
  assertWorkOrderLinesAgainstSalesOrder,
  loadWorkOrderQuantityContext,
  getSalesOrderFgWorkOrderBalances,
  getEligibleSalesOrderIdsForWorkOrder,
  EPS,
  WORK_ORDER_STATUSES_BLOCKING_REMAINING_WO_PLAN,
  WORK_ORDER_STATUSES_WITH_WO_LINE_METRICS,
};
