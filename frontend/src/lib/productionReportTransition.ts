/**
 * Stable UI gate for End/Equal/Extra → mandatory Production Report.
 * Prevents one-frame flashes of Continue / production-entry while refresh + navigate settle.
 */

export function isProductionReportCloseDecision(input: {
  remainingAfterEntry: number;
  disposition?: string | null;
}): boolean {
  const remaining = Number(input.remainingAfterEntry);
  if (Number.isFinite(remaining) && remaining <= 1e-6) return true;
  const d = String(input.disposition ?? "").trim().toUpperCase();
  return d === "END_WITH_SHORTAGE" || d === "CLOSE_WITH_SHORTAGE";
}

/** True while Finalize→Report is in flight or settling for this WO. */
export function shouldForceProductionReportTransition(input: {
  transitionWorkOrderId: number;
  effectiveScopedWoId: number;
}): boolean {
  const tid = Number(input.transitionWorkOrderId);
  if (!(tid > 0)) return false;
  const scoped = Number(input.effectiveScopedWoId);
  // Before URL/selection catches up, still force the gate for the closing WO.
  if (!(scoped > 0)) return true;
  return scoped === tid;
}

/**
 * Clear the gate only when the report/closure workspace is actually showing
 * (not merely when SHORTFALL_PENDING is optimistic).
 */
export function shouldClearProductionReportTransition(input: {
  transitionWorkOrderId: number;
  showProductionReport: boolean;
  showCompactClosureLayout: boolean;
}): boolean {
  if (!(Number(input.transitionWorkOrderId) > 0)) return false;
  return Boolean(input.showProductionReport && input.showCompactClosureLayout);
}

/** Ignore null summary callbacks from remounting panels during the transition. */
export function shouldIgnoreClearedExecutionSummaryDuringReportTransition(input: {
  transitionWorkOrderId: number;
  summary: { workOrderId?: number; executionStatus?: string | null } | null | undefined;
}): boolean {
  if (!(Number(input.transitionWorkOrderId) > 0)) return false;
  if (input.summary == null) return true;
  return false;
}

/**
 * Hide generic Continue / Continue Production while a mandatory Production Report
 * is open, settling, or pending (SHORTFALL_PENDING / REPORT_PENDING).
 * Does not affect true Pause→Resume when no closure report is required.
 */
export function shouldHideContinueWhileProductionReportPending(input: {
  showProductionReport?: boolean;
  showCompactClosureLayout?: boolean;
  forceProductionReportTransition?: boolean;
  showOpeningProductionReportGate?: boolean;
  pendingShortfallDecision?: boolean;
  executionStatus?: string | null;
}): boolean {
  if (input.showCompactClosureLayout) return true;
  if (input.showProductionReport) return true;
  if (input.forceProductionReportTransition) return true;
  if (input.showOpeningProductionReportGate) return true;
  if (input.pendingShortfallDecision) return true;
  const status = String(input.executionStatus ?? "").toUpperCase();
  return status === "SHORTFALL_PENDING" || status === "REPORT_PENDING";
}

/** Operator stage chip while mandatory report must be completed. */
export function productionStageLabelForReportPending(input?: {
  executionStatus?: string | null;
}): string {
  const status = String(input?.executionStatus ?? "").toUpperCase();
  if (status === "COMPLETED" || status === "CLOSED" || status === "CLOSED_WITH_SHORTFALL") {
    return "Complete";
  }
  return "Report pending";
}
