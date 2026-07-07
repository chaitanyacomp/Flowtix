const auditLog = require("./auditLog");
const { lockSalesOrderForUpdate } = require("./dispatchWriteLocks");
const { computeSalesOrderDispatchLineStats } = require("./reportMetrics");
const { hasPendingProductionOrQc, OPEN_QC_REJECTED_DISPOSITION_STATUSES } = require("./noQtySoOperationalGates");

const CLOSED_STATUSES = new Set(["COMPLETED", "CLOSED", "MANUALLY_CLOSED"]);

const OPERATIONAL_STATUSES = new Set(["APPROVED", "IN_PROCESS", "OPEN"]);

function operationalCompletionBlockMessage(reason) {
  switch (reason) {
    case "PENDING_DISPATCH":
      return "Cannot mark as COMPLETED. Dispatch is still pending.";
    case "DRAFT_DISPATCH_EXISTS":
      return "Cannot mark as COMPLETED. Confirm or delete draft dispatch first.";
    case "PENDING_PRODUCTION":
      return "Cannot mark as COMPLETED. Production is still pending.";
    case "PENDING_QC":
      return "Cannot mark as COMPLETED. QA is still pending.";
    case "PENDING_QC_DISPOSITION":
      return "Cannot mark as COMPLETED. Open QC disposition must be resolved first.";
    case "ACTIVE_CYCLE_EXISTS":
      return "Cannot mark as COMPLETED. An active NO_QTY cycle is still open.";
    case "ACTIVE_RS_EXISTS":
      return "Cannot mark as COMPLETED. An open requirement sheet exists for the active cycle.";
    case "ALREADY_CLOSED":
      return "Sales order is already closed.";
    case "STATUS_NOT_OPERATIONAL":
      return "Sales order cannot be completed from its current status.";
    case "ORDER_TYPE_NOT_SUPPORTED":
      return "This sales order type cannot be completed operationally.";
    case "SO_NOT_FOUND":
      return "Sales order not found.";
    default:
      return "Sales order cannot be marked as COMPLETED yet.";
  }
}

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
 * Evaluate whether a sales order may transition to operational COMPLETED.
 * Read-only — does not lock or mutate.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} salesOrderId
 * @returns {Promise<{ eligible: boolean; reason: string | null; so?: object | null }>}
 */
async function evaluateSalesOrderOperationalCompletion(tx, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return { eligible: false, reason: "INVALID_SO", so: null };

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, docNo: true, orderType: true, internalStatus: true, currentCycleId: true },
  });
  if (!so) return { eligible: false, reason: "SO_NOT_FOUND", so: null };
  if (CLOSED_STATUSES.has(String(so.internalStatus ?? ""))) {
    return { eligible: false, reason: "ALREADY_CLOSED", so };
  }
  if (!OPERATIONAL_STATUSES.has(String(so.internalStatus ?? ""))) {
    return { eligible: false, reason: "STATUS_NOT_OPERATIONAL", so };
  }
  if (so.orderType !== "NORMAL" && so.orderType !== "NO_QTY") {
    return { eligible: false, reason: "ORDER_TYPE_NOT_SUPPORTED", so };
  }

  const pendingProdQc = await hasPendingProductionOrQc(tx, so.id, {
    orderType: so.orderType,
    currentCycleId: so.currentCycleId,
  });
  if (pendingProdQc.pending) return { eligible: false, reason: pendingProdQc.reason, so };

  const flow =
    so.orderType === "NO_QTY" ? await noQtyOperationallyComplete(tx, so) : await regularDispatchComplete(tx, so);
  if (!flow.complete) return { eligible: false, reason: flow.reason, so };

  return { eligible: true, reason: null, so };
}

/**
 * Throws when operational completion guards fail. Locks the sales order row first.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} salesOrderId
 */
async function assertSalesOrderOperationalCompletion(tx, salesOrderId) {
  await lockSalesOrderForUpdate(tx, salesOrderId);
  const evaluation = await evaluateSalesOrderOperationalCompletion(tx, salesOrderId);
  if (!evaluation.eligible) {
    const err = new Error(operationalCompletionBlockMessage(evaluation.reason));
    err.statusCode = evaluation.reason === "SO_NOT_FOUND" ? 404 : 400;
    err.code = evaluation.reason ?? "SO_COMPLETION_BLOCKED";
    throw err;
  }
}

/**
 * Authoritative transition to internalStatus=COMPLETED (operational close).
 * Used by auto-close, manual status APIs, and dispatch/production handoffs.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} salesOrderId
 * @param {{ actorUserId?: number | null; actorRole?: string | null; reason?: string | null; actionLabel?: string }} [opts]
 * @returns {Promise<{ closed: boolean; reason: string | null; so?: object }>}
 */
async function completeSalesOrderOperationally(tx, salesOrderId, opts = {}) {
  await lockSalesOrderForUpdate(tx, salesOrderId);
  const evaluation = await evaluateSalesOrderOperationalCompletion(tx, salesOrderId);
  if (!evaluation.eligible) {
    if (evaluation.reason === "ALREADY_CLOSED") {
      const existing = await tx.salesOrder.findUnique({ where: { id: Number(salesOrderId) } });
      return { closed: false, reason: evaluation.reason, so: existing };
    }
    const err = new Error(operationalCompletionBlockMessage(evaluation.reason));
    err.statusCode = evaluation.reason === "SO_NOT_FOUND" ? 404 : 400;
    err.code = evaluation.reason ?? "SO_COMPLETION_BLOCKED";
    throw err;
  }

  const so = evaluation.so;
  const updated = await tx.salesOrder.update({
    where: { id: so.id },
    data: { internalStatus: "COMPLETED", ...(so.orderType === "NO_QTY" ? { currentCycleId: null } : {}) },
  });

  await auditLog.write(tx, {
    action: auditLog.AuditAction.UPDATE,
    entityType: auditLog.AuditEntityType.SALES_ORDER,
    entityId: String(so.id),
    actorUserId: opts.actorUserId ?? null,
    actorRole: opts.actorRole ?? null,
    summary: `Sales order ${so.docNo || `SO-${so.id}`} closed after operational completion.`,
    payload: {
      module: "SALES",
      actionLabel: opts.actionLabel ?? "CLOSE_OPERATIONAL",
      status: { from: so.internalStatus, to: "COMPLETED" },
      orderType: so.orderType,
    },
    reason: opts.reason ?? "Operational workflow completed; billing/export may continue separately.",
  });

  return { closed: true, reason: null, so: updated };
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
    const evaluation = await evaluateSalesOrderOperationalCompletion(tx, salesOrderId);
    if (!evaluation.eligible) {
      return { closed: false, reason: evaluation.reason };
    }
    return await completeSalesOrderOperationally(tx, salesOrderId, {
      ...opts,
      actionLabel: "AUTO_CLOSE_OPERATIONAL",
    });
  } catch (err) {
    console.error("[salesOrderOperationalAutoClose] auto-close failed (QC/ops save continues):", err);
    return { closed: false, reason: "AUTO_CLOSE_ERROR" };
  }
}

module.exports = {
  maybeAutoCloseSalesOrderOperationally,
  evaluateSalesOrderOperationalCompletion,
  assertSalesOrderOperationalCompletion,
  completeSalesOrderOperationally,
  operationalCompletionBlockMessage,
  OPEN_QC_REJECTED_DISPOSITION_STATUSES,
};
