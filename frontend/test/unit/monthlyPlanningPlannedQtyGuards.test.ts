import { describe, expect, it } from "vitest";

import {
  GREEN_SHORTAGE_PLANNING_MESSAGE,
  isPlannedBelowSuggestedConfirmError,
  rowHasGreenShortagePlannedGap,
} from "../../src/lib/monthlyPlanningPlannedQtyGuards";

describe("monthlyPlanningPlannedQtyGuards", () => {
  it("exposes green shortage planning message", () => {
    expect(GREEN_SHORTAGE_PLANNING_MESSAGE).toContain("Green Shortage");
  });

  it("detects PVC Angle style planned below suggested gap", () => {
    expect(
      rowHasGreenShortagePlannedGap({
        greenShortage: 6000,
        plannedQty: 8100,
        suggestedQty: 14100,
      }),
    ).toBe(true);
  });

  it("ignores gap when green shortage is zero", () => {
    expect(
      rowHasGreenShortagePlannedGap({
        greenShortage: 0,
        plannedQty: 8100,
        suggestedQty: 14100,
      }),
    ).toBe(false);
  });

  it("recognizes confirm error code", () => {
    expect(isPlannedBelowSuggestedConfirmError("PLANNED_BELOW_SUGGESTED_CONFIRM_REQUIRED")).toBe(true);
    expect(isPlannedBelowSuggestedConfirmError("OTHER")).toBe(false);
  });
});
