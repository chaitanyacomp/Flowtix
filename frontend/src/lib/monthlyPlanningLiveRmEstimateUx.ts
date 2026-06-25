export type LiveRmEstimatePanelState =
  | "loading"
  | "ready"
  | "unsaved"
  | "stale"
  | "empty";

export const LIVE_RM_ESTIMATE_UNSAVED_MESSAGE =
  "Save changes to calculate Live RM Estimate.";

export const LIVE_RM_ESTIMATE_STALE_MESSAGE =
  "Estimate may be outdated. Save changes to refresh.";

export const LIVE_RM_ESTIMATE_EMPTY_MESSAGE =
  "Add at least one FG line with planned qty > 0 to calculate the live RM estimate.";

export const LIVE_RM_ESTIMATE_SAVE_AND_REFRESH_LABEL = "Save and Refresh Estimate";

export function hasPlannedFgQtyInRows(
  rows: Array<{ plannedFgQty?: string | number | null }>,
): boolean {
  return rows.some((row) => Number(row.plannedFgQty) > 0);
}

export function resolveLiveRmEstimatePanelState(params: {
  loading: boolean;
  hasUnsavedChanges: boolean;
  hasPlannedFgInUi: boolean;
  estimateExists: boolean;
  hasEstimateData: boolean;
}): LiveRmEstimatePanelState {
  const { loading, hasUnsavedChanges, hasPlannedFgInUi, estimateExists, hasEstimateData } = params;
  if (loading && !hasEstimateData) return "loading";
  if (!hasPlannedFgInUi) return "empty";
  if (hasUnsavedChanges && estimateExists) return "stale";
  if (hasUnsavedChanges) return "unsaved";
  if (estimateExists) return "ready";
  return "empty";
}

export function liveRmEstimatePanelMessage(state: LiveRmEstimatePanelState): string {
  switch (state) {
    case "unsaved":
      return LIVE_RM_ESTIMATE_UNSAVED_MESSAGE;
    case "stale":
      return LIVE_RM_ESTIMATE_STALE_MESSAGE;
    case "empty":
      return LIVE_RM_ESTIMATE_EMPTY_MESSAGE;
    default:
      return "";
  }
}

export function shouldOfferSaveAndRefreshEstimate(state: LiveRmEstimatePanelState): boolean {
  return state === "unsaved" || state === "stale";
}
