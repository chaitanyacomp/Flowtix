/** P16-18B/E — Production Workspace compact layout helpers (presentation only). */

import {
  resolveProductionCompletionScenario,
  type ProductionCompletionScenario,
} from "./productionCompletionUx";
import type { ProductionExecutionSummary } from "./productionExecutionApi";

const EPS = 1e-6;

export const PRODUCTION_REPORT_CLOSE_GATE_HELPER =
  "Confirm Production Report before closing WO.";

export type ProductionReportPanelStatus = {
  loading: boolean;
  resolved: boolean;
  confirmed: boolean;
  hasApprovedProduction: boolean;
};

export function initialProductionReportPanelStatus(): ProductionReportPanelStatus {
  return {
    loading: false,
    resolved: false,
    confirmed: false,
    hasApprovedProduction: false,
  };
}

export function shouldShowProductionWorkspaceCompactLayout(input: {
  showProductionReport: boolean;
  workOrderId: number;
  canOperate: boolean;
  navigateNoQtyContext: boolean;
  isGreenLevelContext?: boolean;
  hideNoQtyAddProductionEntry: boolean;
  woIdFromUrlValid: boolean;
  workOrderLineIdFromUrlValid: boolean;
}): boolean {
  if (!input.showProductionReport || !(input.workOrderId > 0) || !input.canOperate) return false;
  if (input.isGreenLevelContext) return true;
  if (!input.navigateNoQtyContext) return false;
  if (input.hideNoQtyAddProductionEntry) return true;
  return input.woIdFromUrlValid || input.workOrderLineIdFromUrlValid;
}

/** Green Level scoped card uses viewport-height workbench when report/close is active. */
export function shouldUseGreenLevelPremiumViewportWorkspace(input: {
  isGreenLevelContext: boolean;
  showGreenLevelScopedProductionCard: boolean;
  showProductionWorkspaceCompactLayout: boolean;
}): boolean {
  return (
    input.isGreenLevelContext &&
    input.showGreenLevelScopedProductionCard &&
    input.showProductionWorkspaceCompactLayout
  );
}

/** NO_QTY scoped card uses viewport-height workbench (logging or report/close). */
export function shouldUseNoQtyPremiumViewportWorkspace(input: {
  navigateNoQtyContext: boolean;
  showNoQtyScopedProductionCard: boolean;
}): boolean {
  return input.navigateNoQtyContext && input.showNoQtyScopedProductionCard;
}

/** Recent entries live in the right column during logging — not as a separate page section. */
export function shouldEmbedNoQtyRecentEntriesInLoggingWorkbench(input: {
  usePremiumViewport: boolean;
  showProductionWorkspaceCompactLayout: boolean;
}): boolean {
  return input.usePremiumViewport && !input.showProductionWorkspaceCompactLayout;
}

/**
 * When false, the production page uses a locked viewport (flex + overflow-hidden + calc height).
 * When true, the main document scrolls and sections are not vertically clipped.
 */
export function shouldUseProductionPageNaturalScroll(input: {
  noQtyPremiumViewport: boolean;
  greenLevelPremiumViewport: boolean;
}): boolean {
  return !input.noQtyPremiumViewport && !input.greenLevelPremiumViewport;
}

/** Minimal sticky chrome: one back nav + operator context (logging or report/close). */
export function shouldShowNoQtyOperatorWorkstationChrome(input: {
  embedNoQtyRecentEntries: boolean;
  showProductionWorkspaceCompactLayout: boolean;
}): boolean {
  return input.embedNoQtyRecentEntries || input.showProductionWorkspaceCompactLayout;
}

export function shouldRenderProductionClosureControls(input: {
  executionLoading: boolean;
  executionResolved: boolean;
  reportStatus: ProductionReportPanelStatus;
}): boolean {
  if (input.executionLoading && !input.executionResolved) return false;
  if (!input.reportStatus.resolved) return false;
  return true;
}

export function isCloseWorkOrderEnabled(input: {
  productionReportConfirmed: boolean;
  executionSummary: ProductionExecutionSummary | null;
  busy: boolean;
}): boolean {
  if (!input.productionReportConfirmed || input.busy || !input.executionSummary) return false;
  const scenario = resolveProductionCompletionScenario(input.executionSummary);
  if (scenario === "DONE" || scenario === "OPEN") return false;
  return true;
}

export function resolveCloseWorkOrderIntent(
  summary: ProductionExecutionSummary | null,
): "finish" | "carry_forward" | null {
  if (!summary) return null;
  const scenario = resolveProductionCompletionScenario(summary);
  if (scenario === "COMPLETE" || scenario === "SURPLUS") return "finish";
  if (scenario === "SHORTFALL" || scenario === "PAUSED") return "carry_forward";
  return null;
}

/** Produced qty is below WO planned qty — Pause is allowed only in this state. */
export function isProductionQtyShort(producedQty: number, plannedQty: number): boolean {
  const produced = Number(producedQty);
  const planned = Number(plannedQty);
  if (!Number.isFinite(produced) || !Number.isFinite(planned)) return false;
  return produced + EPS < planned;
}

export function shouldShowPauseWorkOrderAction(input: {
  producedQty: number;
  plannedQty: number;
  showPausedShortfall: boolean;
  isDone?: boolean;
  /** End/Equal/Extra close decision already parked — Pause must not reappear as Continue. */
  reportPending?: boolean;
}): boolean {
  if (input.isDone) return false;
  if (input.showPausedShortfall) return false;
  if (input.reportPending) return false;
  return isProductionQtyShort(input.producedQty, input.plannedQty);
}

export function productionClosureStatusLabel(
  summary: ProductionExecutionSummary | null,
  scenario: ProductionCompletionScenario,
): string {
  if (!summary) return "Loading…";
  if (scenario === "DONE") return "Closed";
  if (scenario === "PAUSED") return "Paused";
  if (isProductionQtyShort(Number(summary.producedQty ?? 0), Number(summary.plannedQty ?? 0))) {
    return "Below WO qty";
  }
  if (scenario === "SURPLUS") return "Surplus";
  if (scenario === "COMPLETE") return "Complete";
  return "In progress";
}

export function shouldShowWaiveRemainingAction(_scenario: ProductionCompletionScenario): boolean {
  return false;
}
