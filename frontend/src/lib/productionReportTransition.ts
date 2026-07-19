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
