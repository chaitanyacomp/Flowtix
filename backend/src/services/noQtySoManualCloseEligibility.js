/**
 * Compat adapter — Batch 3D: delegates to assessNoQtySoClosure (SSOT).
 */

const { assessNoQtySoClosure, CLOSURE_MODES, BLOCK_MESSAGES } = require("./noQtySoClosureService");

const NO_QTY_MANUAL_CLOSE_BLOCK_MESSAGES = BLOCK_MESSAGES;

function messageForReason(reason) {
  return NO_QTY_MANUAL_CLOSE_BLOCK_MESSAGES[reason] ?? `Cannot close SO: ${reason || "operational work is pending"}.`;
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} db
 * @param {number} salesOrderId
 * @returns {Promise<{ eligible: boolean; reason: string; message: string | null; mode?: string; assessment?: object }>}
 */
async function computeNoQtyManualCloseEligibility(db, salesOrderId) {
  const assessment = await assessNoQtySoClosure(db, salesOrderId);
  if (assessment.mode === CLOSURE_MODES.BLOCKED) {
    const first = assessment.blockers[0];
    return {
      eligible: false,
      reason: first?.code || "BLOCKED",
      message: first?.message || messageForReason("ACTIVE_CYCLE_INCOMPLETE"),
      mode: assessment.mode,
      assessment,
    };
  }
  if (assessment.mode === CLOSURE_MODES.WAIVER_REQUIRED) {
    return {
      eligible: true,
      reason: "WAIVER_REQUIRED",
      message: BLOCK_MESSAGES.WAIVER_REQUIRED,
      mode: assessment.mode,
      assessment,
    };
  }
  return {
    eligible: true,
    reason: "OK",
    message: null,
    mode: assessment.mode,
    assessment,
  };
}

async function assertNoQtyManualCloseEligible(tx, salesOrderId) {
  const assessment = await computeNoQtyManualCloseEligibility(tx, salesOrderId);
  if (!assessment.eligible) {
    const err = new Error(assessment.message || "Cannot close this sales order.");
    err.statusCode = 409;
    err.code = "NO_QTY_CLOSE_BLOCKED";
    err.reason = assessment.reason;
    throw err;
  }
  if (assessment.mode === CLOSURE_MODES.WAIVER_REQUIRED) {
    const err = new Error(BLOCK_MESSAGES.WAIVER_REQUIRED);
    err.statusCode = 409;
    err.code = "WAIVER_REQUIRED";
    err.reason = "WAIVER_REQUIRED";
    err.assessment = assessment.assessment;
    throw err;
  }
}

module.exports = {
  NO_QTY_MANUAL_CLOSE_BLOCK_MESSAGES,
  messageForReason,
  computeNoQtyManualCloseEligibility,
  assertNoQtyManualCloseEligible,
};
