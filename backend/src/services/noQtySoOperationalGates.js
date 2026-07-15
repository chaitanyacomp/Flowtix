const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const {
  getProductionBatchQcPendingQty,
  getWoLineRemainingProductionQty,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("./reportMetrics");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("./salesOrderDispatchAllocation");
const { getEffectiveProductionPendingQty } = require("./productionExecutionService");

const EPS = 1e-6;

/** @type {import("@prisma/client").QcRejectedDispositionStatus[]} */
const OPEN_QC_REJECTED_DISPOSITION_STATUSES = [
  "REWORK_PENDING_SUPERVISOR",
  "REWORK_APPROVED_PENDING_EXECUTION",
  "REWORK_READY_FOR_QC",
  "HOLD",
];

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Execution-aware production / QC / disposition summary for an SO.
 * Production pending uses shop-floor execution status (COMPLETED → 0 remaining).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} tx
 * @returns {Promise<{
 *   pending: boolean,
 *   reason: string | null,
 *   productionPendingWoCount: number,
 *   qcPendingWoCount: number,
 *   shortfallPendingWoCount: number,
 *   openQcDispositionCount: number,
 * }>}
 */
async function summarizeNoQtyProductionQcPending(tx, salesOrderId, opts = {}) {
  const workOrderWhere = { salesOrderId, status: { not: "REJECTED" } };
  if (opts.orderType === "NO_QTY") {
    workOrderWhere.cycle = { status: "ACTIVE" };
  }
  const workOrders = await tx.workOrder.findMany({
    where: workOrderWhere,
    select: {
      id: true,
      status: true,
      productionExecution: { select: { executionStatus: true } },
      lines: { select: { id: true, qty: true } },
    },
  });
  const lineIds = workOrders.flatMap((wo) => (wo.lines || []).map((l) => l.id));

  let productionPendingWoCount = 0;
  let shortfallPendingWoCount = 0;

  if (lineIds.length > 0) {
    const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(tx, lineIds);
    for (const wo of workOrders) {
      if (wo.status === "CLOSED_WITH_SHORTFALL") continue;
      const execStatus = wo.productionExecution?.executionStatus ?? null;
      if (execStatus === "SHORTFALL_PENDING") {
        shortfallPendingWoCount += 1;
        continue;
      }
      let woProductionPending = false;
      for (const line of wo.lines || []) {
        const produced = producedByLineId.get(line.id) || 0;
        const pendingQty =
          opts.useExecutionAware === false
            ? getWoLineRemainingProductionQty(line.qty, produced)
            : getEffectiveProductionPendingQty(line.qty, produced, execStatus);
        if (pendingQty > EPS) {
          woProductionPending = true;
          break;
        }
      }
      if (woProductionPending) productionPendingWoCount += 1;
    }
  }

  /** @type {Set<number>} */
  const qcPendingWoIds = new Set();
  const prodEntries = lineIds.length
    ? await tx.productionEntry.findMany({
        where: { workOrderLineId: { in: lineIds }, workflowStatus: "APPROVED" },
        include: {
          qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
          workOrderLine: { select: { workOrderId: true } },
        },
      })
    : [];
  for (const pe of prodEntries) {
    const producedQty = Number(pe.producedQty ?? 0);
    const accepted = sumActiveQcAcceptedQty(pe.qcEntries || []);
    const rejected = sumActiveQcRejectedQty(pe.qcEntries || []);
    if (getProductionBatchQcPendingQty(producedQty, accepted, rejected) > EPS) {
      const woId = Number(pe.workOrderLine?.workOrderId);
      if (woId > 0) qcPendingWoIds.add(woId);
    }
  }
  const qcPendingWoCount = qcPendingWoIds.size;

  let openQcDispositionCount = 0;
  if (workOrders.length > 0) {
    openQcDispositionCount = await tx.qcRejectedDisposition.count({
      where: {
        workOrderId: { in: workOrders.map((wo) => wo.id) },
        status: { in: OPEN_QC_REJECTED_DISPOSITION_STATUSES },
        remainingQty: { gt: 0 },
        voidedAt: null,
      },
    });
  }

  let reason = null;
  if (shortfallPendingWoCount > 0) reason = "SHORTFALL_PENDING";
  else if (productionPendingWoCount > 0) reason = "PENDING_PRODUCTION";
  else if (qcPendingWoCount > 0) reason = "PENDING_QC";
  else if (openQcDispositionCount > 0) reason = "PENDING_QC_DISPOSITION";

  return {
    pending: reason != null,
    reason,
    productionPendingWoCount,
    qcPendingWoCount,
    shortfallPendingWoCount,
    openQcDispositionCount,
  };
}

/**
 * Pending production / QC / disposition on non-rejected WOs (NO_QTY: ACTIVE cycle only).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} tx
 */
async function hasPendingProductionOrQc(tx, salesOrderId, opts = {}) {
  const summary = await summarizeNoQtyProductionQcPending(tx, salesOrderId, {
    ...opts,
    useExecutionAware: opts.useExecutionAware !== false,
  });
  return {
    pending: summary.pending,
    reason: summary.reason,
    productionPendingWoCount: summary.productionPendingWoCount,
    qcPendingWoCount: summary.qcPendingWoCount,
    shortfallPendingWoCount: summary.shortfallPendingWoCount,
    openQcDispositionCount: summary.openQcDispositionCount,
  };
}

/**
 * Read-only: whether LOCKED forward dispatch on a cycle covers the locked RS cap (same rules as cycle auto-close).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} tx
 * @param {{ soId: number; cycleId: number }} input
 * @returns {Promise<{
 *   complete: boolean,
 *   reason: string | null,
 *   sheetId: number | null,
 *   sheetDocNo: string | null,
 *   cycleId: number,
 *   pendingItemId: number | null,
 *   pendingItemName: string | null,
 *   pendingQty: number,
 *   capQty: number,
 *   dispatchedQty: number,
 * }>}
 */
async function assessNoQtyCycleDispatchCapMet(tx, { soId, cycleId }) {
  const empty = {
    complete: true,
    reason: null,
    sheetId: null,
    sheetDocNo: null,
    cycleId: Number(cycleId),
    pendingItemId: null,
    pendingItemName: null,
    pendingQty: 0,
    capQty: 0,
    dispatchedQty: 0,
  };

  const cycleDispatch = await tx.dispatch.findMany({
    where: { soId, cycleId, workflowStatus: "LOCKED" },
    select: {
      id: true,
      docNo: true,
      itemId: true,
      dispatchedQty: true,
      reversalOfId: true,
      workflowStatus: true,
    },
  });

  const sheet = await tx.requirementSheet.findFirst({
    where: { salesOrderId: soId, cycleId, status: "LOCKED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      lines: {
        include: { item: { select: { id: true, itemName: true } } },
      },
    },
  });
  if (!sheet) {
    return { ...empty, reason: "NO_LOCKED_RS" };
  }

  const sheetMeta = {
    sheetId: Number(sheet.id),
    sheetDocNo: sheet.docNo ?? null,
  };

  const capByItemId = new Map();
  /** @type {Map<number, string | null>} */
  const itemNameById = new Map();
  for (const ln of sheet.lines || []) {
    const cap = Math.max(num(ln.suggestedWoQtySnapshot ?? 0), num(ln.requirementQty ?? 0));
    if (!(cap > EPS)) continue;
    capByItemId.set(ln.itemId, cap);
    itemNameById.set(ln.itemId, ln.item?.itemName ?? null);
  }
  if (!capByItemId.size) {
    return { ...empty, ...sheetMeta, reason: "EMPTY_CYCLE_CAP" };
  }

  const forwardLocked = cycleDispatch.filter((d) => d.reversalOfId == null && num(d.dispatchedQty) > EPS);
  if (!forwardLocked.length) {
    return {
      ...empty,
      ...sheetMeta,
      complete: false,
      reason: "NO_DISPATCHES",
      capQty: [...capByItemId.values()].reduce((a, b) => a + b, 0),
    };
  }

  const netConfirmed = netDispatchedByItemId(cycleDispatch, DISPATCH_ALLOC_MODE.CONFIRMED);
  for (const [itemId, cap] of capByItemId.entries()) {
    const disp = num(netConfirmed.get(itemId) ?? 0);
    const pending = Math.max(0, cap - disp);
    if (pending > EPS) {
      return {
        ...empty,
        ...sheetMeta,
        complete: false,
        reason: "PENDING_DISPATCH_REMAINS",
        pendingItemId: itemId,
        pendingItemName: itemNameById.get(itemId) ?? null,
        pendingQty: pending,
        capQty: cap,
        dispatchedQty: disp,
      };
    }
  }

  return { ...empty, ...sheetMeta, reason: null };
}

module.exports = {
  EPS,
  OPEN_QC_REJECTED_DISPOSITION_STATUSES,
  hasPendingProductionOrQc,
  summarizeNoQtyProductionQcPending,
  assessNoQtyCycleDispatchCapMet,
};
