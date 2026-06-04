const {
  hasPendingProductionOrQc,
  assessNoQtyCycleDispatchCapMet,
} = require("./noQtySoOperationalGates");

const CLOSED_STATUSES = new Set(["COMPLETED", "CLOSED", "MANUALLY_CLOSED"]);

/** @type {Record<string, string>} */
const NO_QTY_MANUAL_CLOSE_BLOCK_MESSAGES = {
  NOT_NO_QTY: "Close is allowed only for No Qty sales orders.",
  SO_NOT_FOUND: "Sales order not found.",
  ALREADY_CLOSED: "Sales order is already closed.",
  PENDING_PRODUCTION: "Cannot close SO: production is still pending.",
  PENDING_QC: "Cannot close SO: QA is pending.",
  PENDING_QC_DISPOSITION: "Cannot close SO: QC rework or hold disposition is pending.",
  DRAFT_DISPATCH_EXISTS: "Cannot close SO: dispatch draft is not finalized.",
  ACTIVE_RS_DRAFT: "Cannot close SO: requirement sheet is not locked.",
  WO_PENDING: "Cannot close SO: work order is pending for active cycle.",
  PENDING_DISPATCH: "Cannot close SO: dispatch is pending for active cycle.",
  PMR_WAITING_STORE_ISSUE: "Cannot close SO: store material issue is pending for active cycle.",
  PMR_PARTIALLY_ISSUED: "Cannot close SO: store material issue is incomplete for active cycle.",
  ACTIVE_CYCLE_INCOMPLETE: "Cannot close SO: active cycle operational work is incomplete.",
};

function messageForReason(reason) {
  return NO_QTY_MANUAL_CLOSE_BLOCK_MESSAGES[reason] ?? `Cannot close SO: ${reason || "operational work is pending"}.`;
}

/**
 * Whether a NO_QTY sales order may be manually closed (POST /close).
 * Billing / Tally export / payment do not affect eligibility.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} db
 * @param {number} salesOrderId
 * @returns {Promise<{ eligible: boolean; reason: string; message: string | null }>}
 */
async function computeNoQtyManualCloseEligibility(db, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    return { eligible: false, reason: "INVALID_SO", message: messageForReason("INVALID_SO") };
  }

  const so = await db.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true, internalStatus: true },
  });
  if (!so) {
    return { eligible: false, reason: "SO_NOT_FOUND", message: messageForReason("SO_NOT_FOUND") };
  }
  if (so.orderType !== "NO_QTY") {
    return { eligible: false, reason: "NOT_NO_QTY", message: messageForReason("NOT_NO_QTY") };
  }
  if (CLOSED_STATUSES.has(String(so.internalStatus ?? ""))) {
    return { eligible: false, reason: "ALREADY_CLOSED", message: messageForReason("ALREADY_CLOSED") };
  }

  const pendingProdQc = await hasPendingProductionOrQc(db, soId, { orderType: "NO_QTY" });
  if (pendingProdQc.pending) {
    const reason = pendingProdQc.reason || "ACTIVE_CYCLE_INCOMPLETE";
    return { eligible: false, reason, message: messageForReason(reason) };
  }

  const unlockedDispatchCount = await db.dispatch.count({
    where: {
      soId,
      reversalOfId: null,
      workflowStatus: "UNLOCKED",
    },
  });
  if (unlockedDispatchCount > 0) {
    return {
      eligible: false,
      reason: "DRAFT_DISPATCH_EXISTS",
      message: messageForReason("DRAFT_DISPATCH_EXISTS"),
    };
  }

  const draftRsCount = await db.requirementSheet.count({
    where: {
      salesOrderId: soId,
      status: "DRAFT",
      cycle: { status: "ACTIVE" },
    },
  });
  if (draftRsCount > 0) {
    return { eligible: false, reason: "ACTIVE_RS_DRAFT", message: messageForReason("ACTIVE_RS_DRAFT") };
  }

  const activeCycle = await db.salesOrderCycle.findFirst({
    where: { salesOrderId: soId, status: "ACTIVE" },
    orderBy: { cycleNo: "desc" },
    select: { id: true, cycleNo: true },
  });

  if (!activeCycle) {
    return { eligible: true, reason: "OK", message: null };
  }

  const cycleId = Number(activeCycle.id);

  const lockedRs = await db.requirementSheet.findFirst({
    where: { salesOrderId: soId, cycleId, status: "LOCKED" },
    select: { id: true },
  });

  const woCount = await db.workOrder.count({
    where: { salesOrderId: soId, cycleId, status: { not: "REJECTED" } },
  });

  if (lockedRs && woCount === 0) {
    return { eligible: false, reason: "WO_PENDING", message: messageForReason("WO_PENDING") };
  }

  const openPmr = await db.productionMaterialRequest.findFirst({
    where: {
      workOrder: { salesOrderId: soId, cycleId },
      status: { in: ["REQUESTED", "PARTIALLY_ISSUED"] },
    },
    orderBy: { id: "desc" },
    select: { status: true },
  });
  if (openPmr) {
    const reason = openPmr.status === "REQUESTED" ? "PMR_WAITING_STORE_ISSUE" : "PMR_PARTIALLY_ISSUED";
    return { eligible: false, reason, message: messageForReason(reason) };
  }

  if (lockedRs) {
    const dispatchCap = await assessNoQtyCycleDispatchCapMet(db, { soId, cycleId });
    if (!dispatchCap.complete) {
      return {
        eligible: false,
        reason: "PENDING_DISPATCH",
        message: messageForReason("PENDING_DISPATCH"),
      };
    }
    return { eligible: true, reason: "OK", message: null };
  }

  if (woCount > 0) {
    return {
      eligible: false,
      reason: "ACTIVE_CYCLE_INCOMPLETE",
      message: messageForReason("ACTIVE_CYCLE_INCOMPLETE"),
    };
  }

  return { eligible: true, reason: "OK", message: null };
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} salesOrderId
 */
async function assertNoQtyManualCloseEligible(tx, salesOrderId) {
  const assessment = await computeNoQtyManualCloseEligibility(tx, salesOrderId);
  if (!assessment.eligible) {
    const err = new Error(assessment.message || "Cannot close this sales order.");
    err.statusCode = 409;
    err.code = "NO_QTY_CLOSE_BLOCKED";
    err.reason = assessment.reason;
    throw err;
  }
}

module.exports = {
  NO_QTY_MANUAL_CLOSE_BLOCK_MESSAGES,
  messageForReason,
  computeNoQtyManualCloseEligibility,
  assertNoQtyManualCloseEligible,
};
