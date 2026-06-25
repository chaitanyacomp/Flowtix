import { describe, expect, it } from "vitest";
import {
  hasPlannedFgQtyInRows,
  liveRmEstimatePanelMessage,
  resolveLiveRmEstimatePanelState,
  shouldOfferSaveAndRefreshEstimate,
} from "../../src/lib/monthlyPlanningLiveRmEstimateUx";

describe("monthlyPlanningLiveRmEstimateUx", () => {
  it("detects planned FG rows in UI", () => {
    expect(hasPlannedFgQtyInRows([])).toBe(false);
    expect(hasPlannedFgQtyInRows([{ plannedFgQty: 0 }, { plannedFgQty: 1200 }])).toBe(true);
  });

  it("uses unsaved message when planned FG exists only in draft UI", () => {
    const state = resolveLiveRmEstimatePanelState({
      loading: false,
      hasUnsavedChanges: true,
      hasPlannedFgInUi: true,
      estimateExists: false,
      hasEstimateData: false,
    });
    expect(state).toBe("unsaved");
    expect(liveRmEstimatePanelMessage(state)).toContain("Save changes");
    expect(shouldOfferSaveAndRefreshEstimate(state)).toBe(true);
  });

  it("marks estimate stale after local edits when a saved estimate exists", () => {
    const state = resolveLiveRmEstimatePanelState({
      loading: false,
      hasUnsavedChanges: true,
      hasPlannedFgInUi: true,
      estimateExists: true,
      hasEstimateData: true,
    });
    expect(state).toBe("stale");
    expect(liveRmEstimatePanelMessage(state)).toContain("outdated");
  });

  it("does not show add-planned-qty message when UI already has planned rows", () => {
    const state = resolveLiveRmEstimatePanelState({
      loading: false,
      hasUnsavedChanges: true,
      hasPlannedFgInUi: true,
      estimateExists: false,
      hasEstimateData: false,
    });
    expect(liveRmEstimatePanelMessage(state)).not.toContain("Add at least one FG line");
  });

  it("shows ready state when saved estimate exists and draft is clean", () => {
    const state = resolveLiveRmEstimatePanelState({
      loading: false,
      hasUnsavedChanges: false,
      hasPlannedFgInUi: true,
      estimateExists: true,
      hasEstimateData: true,
    });
    expect(state).toBe("ready");
    expect(liveRmEstimatePanelMessage(state)).toBe("");
  });
});
