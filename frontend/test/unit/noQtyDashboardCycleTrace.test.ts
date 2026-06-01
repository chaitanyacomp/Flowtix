import { describe, expect, it } from "vitest";

import {
  buildNoQtyDashboardTraceLine,
  formatNoQtyDashboardTracePosition,
} from "../../src/lib/noQtyDashboardCycleTrace";

describe("noQtyDashboardCycleTrace", () => {
  it("uses between-cycles position without shortage wording", () => {
    const line = buildNoQtyDashboardTraceLine({
      cycleNo: 3,
      planningPointerCycleNo: 4,
      noQtyPlanningPointerAhead: true,
      lastRsStatus: "LOCKED",
    });
    expect(line).not.toBeNull();
    expect(formatNoQtyDashboardTracePosition(line!)).toBe(
      "Previous cycle: Cycle 3 completed · Now planning Cycle 4",
    );
    expect(line!.isBetweenCycles).toBe(true);
    expect(formatNoQtyDashboardTracePosition(line!)).not.toMatch(/shortage|carried forward/i);
  });

  it("does not attach shortage to completed cycle label", () => {
    const text = formatNoQtyDashboardTracePosition(
      buildNoQtyDashboardTraceLine({
        cycleNo: 3,
        planningPointerCycleNo: 4,
        noQtyPlanningPointerAhead: true,
      })!,
    );
    expect(text).not.toContain("1000");
    expect(text).not.toContain("shortage");
  });

  it("labels draft RS on planning cycle", () => {
    const line = buildNoQtyDashboardTraceLine({
      cycleNo: 3,
      planningPointerCycleNo: 4,
      noQtyPlanningPointerAhead: true,
      lastRsStatus: "DRAFT",
    });
    expect(line?.positionText).toBe("Cycle 4 · Draft RS");
  });
});
