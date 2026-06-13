import { describe, expect, it } from "vitest";
import {
  buildApplySuggestedExistingRowPatch,
  formatApplySuggestedOverrideConfirmMessage,
  shouldConfirmOverrideReplace,
} from "../../src/lib/monthlyPlanningApplySuggestedProduction";
import {
  captureProductionPlanBaseline,
  hasUnsavedProductionChanges,
} from "../../src/lib/monthlyPlanningProductionPlanDirty";

describe("monthlyPlanningApplySuggestedProduction", () => {
  it("shouldConfirmOverrideReplace when plannedQtyOverridden is true", () => {
    expect(shouldConfirmOverrideReplace(true)).toBe(true);
    expect(shouldConfirmOverrideReplace(false)).toBe(false);
  });

  it("buildApplySuggestedExistingRowPatch clears override and sets planned qty", () => {
    expect(buildApplySuggestedExistingRowPatch(210000)).toEqual({
      suggestedFgQty: 210000,
      plannedFgQty: "210000",
      plannedQtyOverridden: false,
      source: "REQUIREMENT_SHEET",
    });
  });

  it("formatApplySuggestedOverrideConfirmMessage includes planned and suggested totals", () => {
    const msg = formatApplySuggestedOverrideConfirmMessage(82000, 210000);
    expect(msg.replace(/,/g, "")).toContain("82000");
    expect(msg.replace(/,/g, "")).toContain("210000");
    expect(msg).toContain("Replace planned quantity with suggested production?");
  });

  it("replace patch marks production plan dirty against overridden baseline", () => {
    const baseline = captureProductionPlanBaseline([
      {
        id: 1,
        fgItemId: 10,
        plannedFgQty: 82000,
        plannedQtyOverridden: true,
        source: "MANUAL",
        remarks: "",
      },
    ]);
    const patch = buildApplySuggestedExistingRowPatch(210000);
    expect(
      hasUnsavedProductionChanges(
        [{ id: 1, fgItemId: 10, remarks: "", ...patch }],
        [],
        baseline,
      ),
    ).toBe(true);
  });
});
