import { describe, expect, it } from "vitest";
import { canPauseShiftProduction, canShowManagerControls } from "../../src/lib/machineShiftSessionUi";

describe("shift pause/resume capability gates", () => {
  it("PRODUCTION can pause when manager assigned but cannot use manager controls", () => {
    const caps = {
      canView: true,
      canPerformManagerActions: false,
      canPauseProduction: true,
      productionManagerAssigned: true,
      isFallbackControl: false,
    };
    expect(canShowManagerControls(caps)).toBe(false);
    expect(canPauseShiftProduction(caps)).toBe(true);
  });

  it("ADMIN and PM have both manager controls and pause", () => {
    const caps = {
      canPerformManagerActions: true,
      canPauseProduction: true,
    };
    expect(canShowManagerControls(caps)).toBe(true);
    expect(canPauseShiftProduction(caps)).toBe(true);
  });
});
