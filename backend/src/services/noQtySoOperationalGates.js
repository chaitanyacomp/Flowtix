const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const {
  getProductionBatchQcPendingQty,
  getWoLineRemainingProductionQty,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("./reportMetrics");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("./salesOrderDispatchAllocation");

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
 * Pending production / QC / disposition on non-rejected WOs (NO_QTY: ACTIVE cycle only).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} tx
 */
async function hasPendingProductionOrQc(tx, salesOrderId, opts = {}) {
  const workOrderWhere = { salesOrderId, status: { not: "REJECTED" } };
  if (opts.orderType === "NO_QTY") {
    workOrderWhere.cycle = { status: "ACTIVE" };
  }
  const workOrders = await tx.workOrder.findMany({
    where: workOrderWhere,
    select: { id: true, status: true, lines: { select: { id: true, qty: true } } },
  });
  const lineIds = workOrders.flatMap((wo) => (wo.lines || []).map((l) => l.id));

  if (lineIds.length > 0) {
    const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(tx, lineIds);
    for (const wo of workOrders) {
      if (wo.status === "CLOSED_WITH_SHORTFALL") continue;
      for (const line of wo.lines || []) {
        const produced = producedByLineId.get(line.id) || 0;
        if (getWoLineRemainingProductionQty(line.qty, produced) > EPS) {
          return { pending: true, reason: "PENDING_PRODUCTION" };
        }
      }
    }
  }

  const prodEntries = lineIds.length
    ? await tx.productionEntry.findMany({
        where: { workOrderLineId: { in: lineIds }, workflowStatus: "APPROVED" },
        include: { qcEntries: { where: QC_ENTRY_ACTIVE_WHERE } },
      })
    : [];
  for (const pe of prodEntries) {
    const producedQty = Number(pe.producedQty ?? 0);
    const accepted = sumActiveQcAcceptedQty(pe.qcEntries || []);
    const rejected = sumActiveQcRejectedQty(pe.qcEntries || []);
    if (getProductionBatchQcPendingQty(producedQty, accepted, rejected) > EPS) {
      return { pending: true, reason: "PENDING_QC" };
    }
  }

  if (workOrders.length > 0) {
    const openDispositionCount = await tx.qcRejectedDisposition.count({
      where: {
        workOrderId: { in: workOrders.map((wo) => wo.id) },
        status: { in: OPEN_QC_REJECTED_DISPOSITION_STATUSES },
        remainingQty: { gt: 0 },
        voidedAt: null,
      },
    });
    if (openDispositionCount > 0) {
      return { pending: true, reason: "PENDING_QC_DISPOSITION" };
    }
  }

  return { pending: false, reason: null };
}

/**
 * Read-only: whether LOCKED forward dispatch on a cycle covers the locked RS cap (same rules as cycle auto-close).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} tx
 * @param {{ soId: number; cycleId: number }} input
 * @returns {Promise<{ complete: boolean; reason: string | null }>}
 */
async function assessNoQtyCycleDispatchCapMet(tx, { soId, cycleId }) {
  const cycleDispatch = await tx.dispatch.findMany({
    where: { soId, cycleId, workflowStatus: "LOCKED" },
    select: { id: true, itemId: true, dispatchedQty: true, reversalOfId: true, workflowStatus: true },
  });

  const sheet = await tx.requirementSheet.findFirst({
    where: { salesOrderId: soId, cycleId, status: "LOCKED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { lines: true },
  });
  if (!sheet) {
    return { complete: true, reason: "NO_LOCKED_RS" };
  }

  const capByItemId = new Map();
  for (const ln of sheet.lines || []) {
    const cap = Math.max(num(ln.suggestedWoQtySnapshot ?? 0), num(ln.requirementQty ?? 0));
    if (!(cap > EPS)) continue;
    capByItemId.set(ln.itemId, cap);
  }
  if (!capByItemId.size) {
    return { complete: true, reason: "EMPTY_CYCLE_CAP" };
  }

  const forwardLocked = cycleDispatch.filter((d) => d.reversalOfId == null && num(d.dispatchedQty) > EPS);
  if (!forwardLocked.length) {
    return { complete: false, reason: "NO_DISPATCHES" };
  }

  const netConfirmed = netDispatchedByItemId(cycleDispatch, DISPATCH_ALLOC_MODE.CONFIRMED);
  for (const [itemId, cap] of capByItemId.entries()) {
    const disp = num(netConfirmed.get(itemId) ?? 0);
    const pending = Math.max(0, cap - disp);
    if (pending > EPS) {
      return { complete: false, reason: "PENDING_DISPATCH_REMAINS" };
    }
  }

  return { complete: true, reason: null };
}

module.exports = {
  EPS,
  OPEN_QC_REJECTED_DISPOSITION_STATUSES,
  hasPendingProductionOrQc,
  assessNoQtyCycleDispatchCapMet,
};
