import { describe, expect, it } from "vitest";
import {
  captureProductionPlanBaseline,
  formatLockSnapshotSuccessMessage,
  formatPlannedSuggestedLockWarning,
  hasPlannedSuggestedMismatch,
  hasUnsavedProductionChanges,
} from "../../src/lib/monthlyPlanningProductionPlanDirty";

describe("monthlyPlanningProductionPlanDirty", () => {
  const baseline = captureProductionPlanBaseline([
    {
      id: 1,
      fgItemId: 10,
      plannedFgQty: 1000,
      plannedQtyOverridden: false,
      source: "MANUAL",
      remarks: "cap",
    },
  ]);

  it("detects planned qty edits", () => {
    expect(
      hasUnsavedProductionChanges(
        [{ ...baseline.rows[0], plannedFgQty: 1200 }],
        [],
        baseline,
      ),
    ).toBe(true);
  });

  it("detects removed server rows", () => {
    expect(hasUnsavedProductionChanges([], [1], baseline)).toBe(true);
  });

  it("detects added rows", () => {
    expect(
      hasUnsavedProductionChanges(
        [
          ...baseline.rows,
          {
            fgItemId: 11,
            plannedFgQty: 500,
            plannedQtyOverridden: false,
            source: "REQUIREMENT_SHEET",
            remarks: "",
          },
        ],
        [],
        baseline,
      ),
    ).toBe(true);
  });

  it("detects remarks changes", () => {
    expect(
      hasUnsavedProductionChanges([{ ...baseline.rows[0], remarks: "updated" }], [], baseline),
    ).toBe(true);
  });

  it("returns false when rows match baseline", () => {
    expect(
      hasUnsavedProductionChanges(
        [
          {
            id: 1,
            fgItemId: 10,
            plannedFgQty: "1000",
            plannedQtyOverridden: false,
            source: "MANUAL",
            remarks: "cap",
          },
        ],
        [],
        baseline,
      ),
    ).toBe(false);
  });

  it("hasPlannedSuggestedMismatch compares totals", () => {
    expect(hasPlannedSuggestedMismatch(82000, 136000)).toBe(true);
    expect(hasPlannedSuggestedMismatch(100, 100)).toBe(false);
  });

  it("formatPlannedSuggestedLockWarning uses planned qty in closing line", () => {
    const msg = formatPlannedSuggestedLockWarning(82000, 136000);
    expect(msg.replace(/,/g, "")).toContain("136000");
    expect(msg.replace(/,/g, "")).toContain("82000 planned quantity");
  });

  it("formatLockSnapshotSuccessMessage summarizes lock response", () => {
    const msg = formatLockSnapshotSuccessMessage({
      revision: 7,
      totalFgPlannedQty: 136000,
      rmLines: [{ netRequirementQty: 542.3 }],
    });
    expect(msg.replace(/,/g, "")).toBe("Snapshot 7 created. Planned FG: 136000. RM Requirement: 542.3.");
  });
});
