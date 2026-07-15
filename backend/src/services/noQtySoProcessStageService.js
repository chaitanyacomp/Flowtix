/**
 * NO_QTY agreement Current Stage resolver (list / card display).
 * Distinguishes Production vs QC vs FG disposition vs Recovery vs Dispatch — never combines Production+QA.
 *
 * Ready to Close MUST agree with assessNoQtySoClosure (closureMode COMPLETE).
 * Never promote commercial billing alone to Ready to Close while close is blocked.
 */

const STAGE = Object.freeze({
  COMPLETED: { key: "COMPLETED", label: "Completed" },
  PREPARE_NEXT_RS: { key: "NO_QTY_PREPARE_NEXT_RS", label: "Next cycle RS" },
  READY_TO_CLOSE: { key: "NO_QTY_READY_TO_CLOSE", label: "Ready to Close" },
  BILLING_COMPLETE: { key: "NO_QTY_BILLING_COMPLETE", label: "Billing complete" },
  BILLING_PENDING_EXPORT: { key: "NO_QTY_BILLING_PENDING_EXPORT", label: "Billing Pending Export" },
  DISPATCH_BILLING: { key: "NO_QTY_DISPATCH_BILLING", label: "Dispatch / Billing" },
  DISPATCH_PENDING: { key: "NO_QTY_DISPATCH_PENDING", label: "Dispatch Pending" },
  RECOVERY_PENDING: { key: "NO_QTY_RECOVERY_PENDING", label: "Recovery Decision Pending" },
  FG_DISPOSITION_PENDING: { key: "NO_QTY_FG_DISPOSITION_PENDING", label: "FG Disposition Pending" },
  QC_IN_PROGRESS: { key: "NO_QTY_QC_IN_PROGRESS", label: "QC In Progress" },
  PRODUCTION_RUNNING: { key: "NO_QTY_PRODUCTION_RUNNING", label: "Production Running" },
  /** @deprecated Prefer PRODUCTION_RUNNING / QC_IN_PROGRESS — kept for dual-read of older payloads */
  IN_PRODUCTION_LEGACY: { key: "NO_QTY_IN_PRODUCTION", label: "Production Running" },
  WORK_ORDER: { key: "NO_QTY_WORK_ORDER", label: "Work order" },
  READY_TO_PLACE_WO: { key: "NO_QTY_READY_TO_PLACE_WO", label: "Ready to place WO" },
  PROCUREMENT_IN_PROGRESS: { key: "NO_QTY_PROCUREMENT_IN_PROGRESS", label: "Procurement in progress" },
  REQUIREMENT_READY: { key: "NO_QTY_REQUIREMENT_READY", label: "Monthly planning pending" },
  DRAFT: { key: "NO_QTY_DRAFT", label: "Draft" },
});

const CLOSURE_MODES = Object.freeze({
  COMPLETE: "COMPLETE",
  WAIVER_REQUIRED: "WAIVER_REQUIRED",
  BLOCKED: "BLOCKED",
});

/**
 * Map assessNoQtySoClosure blocker codes to Current Stage (SSOT alignment).
 * @param {Array<{ code?: string }> | null | undefined} blockers
 */
function stageFromClosureBlockers(blockers) {
  const codes = new Set((blockers || []).map((b) => String(b?.code || "").toUpperCase()).filter(Boolean));
  if (
    codes.has("PENDING_PRODUCTION") ||
    codes.has("SHORTFALL_PENDING") ||
    codes.has("PMR_WAITING_STORE_ISSUE") ||
    codes.has("PMR_PARTIALLY_ISSUED")
  ) {
    return { ...STAGE.PRODUCTION_RUNNING };
  }
  if (codes.has("PENDING_QC") || codes.has("PENDING_QC_DISPOSITION")) {
    return { ...STAGE.QC_IN_PROGRESS };
  }
  if (codes.has("FG_DISPOSITION_REQUIRED")) return { ...STAGE.FG_DISPOSITION_PENDING };
  if (codes.has("PENDING_DISPATCH") || codes.has("DRAFT_DISPATCH_EXISTS") || codes.has("ACTIVE_CYCLE_INCOMPLETE")) {
    return { ...STAGE.DISPATCH_PENDING };
  }
  if (codes.has("BILLING_NOT_EXPORTED")) return { ...STAGE.BILLING_PENDING_EXPORT };
  if (codes.has("DRAFT_BILLING")) return { ...STAGE.DISPATCH_BILLING };
  if (codes.has("WO_PENDING")) return { ...STAGE.WORK_ORDER };
  if (codes.has("ACTIVE_RS_DRAFT")) return { ...STAGE.DRAFT };
  return null;
}

/**
 * Resolve Current Stage from downstream evidence + authoritative close assessment.
 *
 * When `closureMode` is provided (from assessNoQtySoClosure):
 * - COMPLETE → Ready to Close
 * - WAIVER_REQUIRED → Recovery Decision Pending
 * - BLOCKED → mapped from blockers (never Ready to Close)
 *
 * @param {object} input
 * @returns {{ key: string, label: string }}
 */
function resolveNoQtyAgreementProcessStage(input = {}) {
  const completedSoRow = input.completedSoRow === true;
  const nextAction = input.nextAction || null;
  const finalizedBillExists = input.finalizedBillExists === true;
  const salesBillExists = input.salesBillExists === true;
  const dispatchExists = input.dispatchExists === true;
  const productionPending = input.productionPending === true;
  const qcPending = input.qcPending === true;
  const fgDispositionPending = input.fgDispositionPending === true;
  const recoveryPending = input.recoveryPending === true;
  const productionExists = input.productionExists === true;
  const qcExists = input.qcExists === true;
  const workOrderExists = input.workOrderExists === true;
  const requirementExists = input.requirementExists === true;
  const placementProcessStageKey = input.placementProcessStageKey || null;
  const closureMode = input.closureMode != null ? String(input.closureMode).toUpperCase() : null;
  const closureBlockers = Array.isArray(input.closureBlockers) ? input.closureBlockers : null;
  const hasClosureAssessment = closureMode != null;

  if (completedSoRow) return { ...STAGE.COMPLETED };
  if (nextAction === "CREATE_NEXT_RS") return { ...STAGE.PREPARE_NEXT_RS };

  // Authoritative close assessment wins over commercial bill heuristics.
  if (hasClosureAssessment) {
    if (closureMode === CLOSURE_MODES.COMPLETE) return { ...STAGE.READY_TO_CLOSE };
    if (closureMode === CLOSURE_MODES.WAIVER_REQUIRED) return { ...STAGE.RECOVERY_PENDING };
    if (closureMode === CLOSURE_MODES.BLOCKED) {
      const fromBlockers = stageFromClosureBlockers(closureBlockers);
      if (fromBlockers) return fromBlockers;
    }
  }

  // Manufacturing / disposition evidence (when assessment absent or unmapped)
  if (productionPending) return { ...STAGE.PRODUCTION_RUNNING };
  if (qcPending) return { ...STAGE.QC_IN_PROGRESS };
  if (fgDispositionPending) return { ...STAGE.FG_DISPOSITION_PENDING };
  if (recoveryPending) return { ...STAGE.RECOVERY_PENDING };

  // Commercial progress — never Ready to Close from bill alone when assessment says BLOCKED
  if (!hasClosureAssessment && (nextAction === "CLOSE_SO" || finalizedBillExists)) {
    return { ...STAGE.READY_TO_CLOSE };
  }
  if (finalizedBillExists && !hasClosureAssessment) return { ...STAGE.BILLING_COMPLETE };
  if (salesBillExists || dispatchExists) return { ...STAGE.DISPATCH_BILLING };

  if ((productionExists || qcExists) && !dispatchExists) return { ...STAGE.DISPATCH_PENDING };

  if (workOrderExists) return { ...STAGE.WORK_ORDER };

  if (requirementExists) {
    if (placementProcessStageKey === "NO_QTY_READY_TO_PLACE_WO") return { ...STAGE.READY_TO_PLACE_WO };
    if (placementProcessStageKey === "NO_QTY_PROCUREMENT_IN_PROGRESS") {
      return { ...STAGE.PROCUREMENT_IN_PROGRESS };
    }
    return { ...STAGE.REQUIREMENT_READY };
  }

  return { ...STAGE.DRAFT };
}

module.exports = {
  NO_QTY_AGREEMENT_PROCESS_STAGE: STAGE,
  resolveNoQtyAgreementProcessStage,
  stageFromClosureBlockers,
};
