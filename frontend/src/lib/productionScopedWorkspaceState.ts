/** P16-20D — Scoped production workspace state hygiene (UI/navigation only). */

import type { ProductionExecutionSummary } from "./productionExecutionApi";
import { PRODUCTION_WORKSPACE_DASHBOARD_HREF } from "./productionCloseCompletionUx";

export { PRODUCTION_WORKSPACE_DASHBOARD_HREF };

export function parseUrlWorkOrderId(searchParams: URLSearchParams): number {
  const raw = Number(searchParams.get("workOrderId") ?? searchParams.get("woId") ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function parseUrlWorkOrderLineId(searchParams: URLSearchParams): number {
  const raw = Number(searchParams.get("workOrderLineId") ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function executionSummaryMatchesWorkOrder(
  summary: ProductionExecutionSummary | null | undefined,
  workOrderId: number,
): boolean {
  if (!summary || !(workOrderId > 0)) return false;
  return Number(summary.workOrderId) === Number(workOrderId);
}

/** Drop execution summary when it belongs to a different WO than the scoped URL/selection. */
export function coerceExecutionSummaryForWorkOrder(
  summary: ProductionExecutionSummary | null | undefined,
  workOrderId: number,
): ProductionExecutionSummary | null {
  return executionSummaryMatchesWorkOrder(summary, workOrderId) ? summary : null;
}

export function shouldShowScopedProductionReport(input: {
  workOrderId: number;
  hasApprovedProductionOnWorkOrder: boolean;
  navigateNoQtyContext: boolean;
  executionSummary: ProductionExecutionSummary | null | undefined;
}): boolean {
  if (!(input.workOrderId > 0)) return false;
  if (input.hasApprovedProductionOnWorkOrder) return true;
  if (
    input.navigateNoQtyContext &&
    executionSummaryMatchesWorkOrder(input.executionSummary, input.workOrderId) &&
    input.executionSummary?.executionStatus === "COMPLETED"
  ) {
    return true;
  }
  return false;
}

const CLOSED_SCOPED_WO_STATUSES = new Set(["COMPLETED", "CLOSED_WITH_SHORTFALL", "REJECTED"]);

export function isScopedWorkOrderClosed(status: string | null | undefined): boolean {
  return CLOSED_SCOPED_WO_STATUSES.has(String(status ?? "").toUpperCase());
}

export type ScopedProductionNavigationAction = "stay" | "redirect_dashboard";

/**
 * When browser history lands on a scoped production URL that no longer exists in loaded data,
 * redirect to the main workspace instead of showing stale completion UI.
 */
export function resolveStaleScopedProductionNavigation(input: {
  urlWorkOrderId: number;
  initialRefreshDone: boolean;
  workOrdersLoaded: boolean;
  workOrderExists: boolean;
  workOrderStatus?: string | null;
}): ScopedProductionNavigationAction {
  if (!(input.urlWorkOrderId > 0)) return "stay";
  if (!input.initialRefreshDone || !input.workOrdersLoaded) return "stay";
  if (!input.workOrderExists) return "redirect_dashboard";
  if (isScopedWorkOrderClosed(input.workOrderStatus)) return "redirect_dashboard";
  return "stay";
}

export function isProductionScopedContextConsistent(input: {
  urlWorkOrderId: number;
  effectiveWorkOrderId: number;
  selectedWorkOrderId: number;
  contextWorkOrderId: number;
  summaryWorkOrderId?: number;
}): boolean {
  if (!(input.urlWorkOrderId > 0)) return true;
  const expected = input.urlWorkOrderId;
  const ids = [
    input.effectiveWorkOrderId,
    input.selectedWorkOrderId,
    input.contextWorkOrderId,
    input.summaryWorkOrderId ?? expected,
  ].filter((id) => id > 0);
  return ids.length > 0 && ids.every((id) => id === expected);
}

export function scopedProductionWorkspaceKey(workOrderId: number, workOrderLineId: number): string {
  return `wo:${workOrderId}:wol:${workOrderLineId}`;
}

export function formatScopedWorkOrderCompletionMessage(
  workOrderLabel: string,
  itemName?: string | null,
): string {
  const wo = workOrderLabel.trim() || "Work order";
  const item = String(itemName ?? "").trim();
  return item ? `${wo} ${item} completed.` : `${wo} completed.`;
}

export type ScopedProductionWorkspaceReset = {
  clearExecutionSummary: true;
  resetCompletionEvaluate: true;
  bumpExecutionPanelRefresh: true;
};

export function createScopedProductionWorkspaceReset(): ScopedProductionWorkspaceReset {
  return {
    clearExecutionSummary: true,
    resetCompletionEvaluate: true,
    bumpExecutionPanelRefresh: true,
  };
}

export type NoQtyLineProducibility = {
  workOrderId: number;
  workOrderLineId: number;
  remainingQty: number;
  qcPendingQty: number;
  isCarryForwardLine: boolean;
};

/**
 * True when the scoped WO still has shop-floor production entry work (remaining qty, not blocked).
 */
export function scopedWorkOrderHasProducibleLine(
  lines: NoQtyLineProducibility[],
  workOrderId: number,
  opts?: { allowCarryForwardContinue?: boolean },
): boolean {
  if (!(workOrderId > 0)) return false;
  const eps = 1e-6;
  const allowCf = opts?.allowCarryForwardContinue === true;
  return lines.some((line) => {
    if (Number(line.workOrderId) !== Number(workOrderId)) return false;
    if (!(Number(line.remainingQty) > eps)) return false;
    if (Number(line.qcPendingQty) > eps) return false;
    if (line.isCarryForwardLine && !allowCf) return false;
    return true;
  });
}

/**
 * Gates the indigo "Production entry completed for this cycle" panel.
 *
 * Root cause fix: when a workOrderId is scoped in the URL, completion UI must reflect THAT wo only —
 * not SO-wide approved batches / empty auto-pick from a previously closed wo.
 */
export function shouldHideNoQtyAddProductionEntry(input: {
  navigateNoQtyContext: boolean;
  showNoQtyScopedProductionCard: boolean;
  effectiveScopedWoId: number;
  noQtyBlockProductionEntry: boolean;
  noQtyNextRsReady: boolean;
  noQtyAllowShopFloorContinue: boolean;
  /** SO has any approved production (legacy fallback when no wo scoped). */
  approvedForSo: boolean;
  /** SO-wide auto-pick queue empty (legacy fallback when no wo scoped). */
  noQtyAutoPickLinesCount: number;
  currentWoHasProducibleLine: boolean;
  currentWoHasApprovedProduction: boolean;
  currentWoIsClosed: boolean;
}): boolean {
  if (input.noQtyBlockProductionEntry) return true;
  if (input.noQtyNextRsReady && !input.noQtyAllowShopFloorContinue) return true;
  if (!input.navigateNoQtyContext || input.noQtyAllowShopFloorContinue || !input.showNoQtyScopedProductionCard) {
    return false;
  }

  if (input.effectiveScopedWoId > 0) {
    if (input.currentWoHasProducibleLine) return false;
    if (input.currentWoIsClosed) return false;
    if (input.currentWoHasApprovedProduction) return true;
    return false;
  }

  if (!input.approvedForSo) return false;
  return input.noQtyAutoPickLinesCount === 0;
}
