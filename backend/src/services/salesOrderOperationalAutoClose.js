const auditLog = require("./auditLog");
const { computeSalesOrderDispatchLineStats } = require("./reportMetrics");
const { hasPendingProductionOrQc, OPEN_QC_REJECTED_DISPOSITION_STATUSES } = require("./noQtySoOperationalGates");

const CLOSED_STATUSES = new Set(["COMPLETED", "CLOSED", "MANUALLY_CLOSED"]);

async function regularDispatchComplete(tx, so) {
  const full = await tx.salesOrder.findUnique({
    where: { id: so.id },
    include: { lines: true, dispatch: true },
  });
  if (!full) return { complete: false, reason: "SO_NOT_FOUND" };
  const unlockedForward = (full.dispatch || []).some((d) => d.reversalOfId == null && d.workflowStatus === "UNLOCKED");
  if (unlockedForward) return { complete: false, reason: "DRAFT_DISPATCH_EXISTS" };
  const { dispatchSummary } = computeSalesOrderDispatchLineStats(full.lines || [], full.dispatch || [], full.orderType);
  if (!dispatchSummary.fullyDispatched) return { complete: false, reason: "PENDING_DISPATCH" };
  return { complete: true, reason: null };
}

async function noQtyOperationallyComplete(tx, so) {
  const activeCycleCount = await tx.salesOrderCycle.count({
    where: { salesOrderId: so.id, status: "ACTIVE" },
  });
  if (activeCycleCount > 0 || so.currentCycleId != null) {
    return { complete: false, reason: "ACTIVE_CYCLE_EXISTS" };
  }

  const openSheetCount = await tx.requirementSheet.count({
    where: {
      salesOrderId: so.id,
      status: { in: ["DRAFT", "LOCKED"] },
      cycle: { status: "ACTIVE" },
    },
  });
  if (openSheetCount > 0) return { complete: false, reason: "ACTIVE_RS_EXISTS" };

  const unlockedDispatchCount = await tx.dispatch.count({
    where: {
      soId: so.id,
      reversalOfId: null,
      workflowStatus: "UNLOCKED",
    },
  });
  if (unlockedDispatchCount > 0) return { complete: false, reason: "DRAFT_DISPATCH_EXISTS" };

  return { complete: true, reason: null };
}

/**
 * Operational auto-close for SOs. Billing/export is intentionally ignored.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} salesOrderId
 * @param {{ actorUserId?: number | null; actorRole?: string | null; reason?: string | null }} [opts]
 */
async function maybeAutoCloseSalesOrderOperationally(tx, salesOrderId, opts = {}) {
  try {
    return await maybeAutoCloseSalesOrderOperationallyUnsafe(tx, salesOrderId, opts);
  } catch (err) {
    console.error("[salesOrderOperationalAutoClose] auto-close failed (QC/ops save continues):", err);
    return { closed: false, reason: "AUTO_CLOSE_ERROR" };
  }
}

async function maybeAutoCloseSalesOrderOperationallyUnsafe(tx, salesOrderId, opts = {}) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return { closed: false, reason: "INVALID_SO" };

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, docNo: true, orderType: true, internalStatus: true, currentCycleId: true },
  });
  if (!so) return { closed: false, reason: "SO_NOT_FOUND" };
  if (CLOSED_STATUSES.has(String(so.internalStatus ?? ""))) return { closed: false, reason: "ALREADY_CLOSED" };
  if (!["APPROVED", "IN_PROCESS", "OPEN"].includes(String(so.internalStatus ?? ""))) {
    return { closed: false, reason: "STATUS_NOT_OPERATIONAL" };
  }
  if (so.orderType !== "NORMAL" && so.orderType !== "NO_QTY") {
    return { closed: false, reason: "ORDER_TYPE_NOT_SUPPORTED" };
  }

  const pendingProdQc = await hasPendingProductionOrQc(tx, so.id, {
    orderType: so.orderType,
    currentCycleId: so.currentCycleId,
  });
  if (pendingProdQc.pending) return { closed: false, reason: pendingProdQc.reason };

  const flow =
    so.orderType === "NO_QTY"
      ? await noQtyOperationallyComplete(tx, so)
      : await regularDispatchComplete(tx, so);
  if (!flow.complete) return { closed: false, reason: flow.reason };

  await tx.salesOrder.update({
    where: { id: so.id },
    data: { internalStatus: "COMPLETED", ...(so.orderType === "NO_QTY" ? { currentCycleId: null } : {}) },
  });

  await auditLog.write(tx, {
    action: auditLog.AuditAction.UPDATE,
    entityType: auditLog.AuditEntityType.SALES_ORDER,
    entityId: String(so.id),
    actorUserId: opts.actorUserId ?? null,
    actorRole: opts.actorRole ?? null,
    summary: `Sales order ${so.docNo || `SO-${so.id}`} auto-closed after operational completion.`,
    payload: {
      module: "SALES",
      actionLabel: "AUTO_CLOSE_OPERATIONAL",
      status: { from: so.internalStatus, to: "COMPLETED" },
      orderType: so.orderType,
    },
    reason: opts.reason ?? "Operational workflow completed; billing/export may continue separately.",
  });

  return { closed: true, reason: null };
}

module.exports = {
  maybeAutoCloseSalesOrderOperationally,
  OPEN_QC_REJECTED_DISPOSITION_STATUSES,
};
