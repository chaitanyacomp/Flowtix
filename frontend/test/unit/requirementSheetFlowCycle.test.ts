import { describe, expect, it } from "vitest";

import { resolveRequirementSheetFlowStateCycleId } from "../../src/lib/requirementSheetFlowCycle";

describe("requirementSheetFlowCycle", () => {
  it("uses active planning cycle for intent=add (so_created / pending-actions)", () => {
    expect(
      resolveRequirementSheetFlowStateCycleId({
        isNoQty: true,
        addRequirementIntent: true,
        activePlanningCycleId: 12,
        sheetCycleId: null,
      }),
    ).toBe(12);
  });

  it("returns null for non-NO_QTY SO", () => {
    expect(
      resolveRequirementSheetFlowStateCycleId({
        isNoQty: false,
        addRequirementIntent: true,
        activePlanningCycleId: 12,
      }),
    ).toBeNull();
  });
});
