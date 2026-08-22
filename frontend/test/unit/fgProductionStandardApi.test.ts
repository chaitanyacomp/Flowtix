import { describe, expect, it, vi } from "vitest";
import { computeExpectedShiftQtyPreview } from "../../src/lib/fgProductionStandardCalc";
import {
  applyFgStandardFocus,
  firstEditableFocusTarget,
  isDuplicateFgMachineError,
  shouldSkipFocusSteal,
} from "../../src/lib/fgProductionStandardFocus";

function makeInput(): HTMLInputElement {
  return {
    tagName: "INPUT",
    focus: vi.fn(),
    select: vi.fn(),
    contains: () => false,
  } as unknown as HTMLInputElement;
}

describe("fgProductionStandardCalc preview", () => {
  it("matches documented example (~500 expected)", () => {
    const preview = computeExpectedShiftQtyPreview({
      cycleTimeSeconds: 51.3,
      piecesPerCycle: 1,
      standardEfficiencyPercent: 95,
      netShiftMinutes: 450,
    });
    expect(preview).toMatchObject({
      netShiftSeconds: 27000,
      theoreticalQuantity: 526,
      expectedQuantity: 500,
    });
  });

  it("rejects invalid cycle / pieces / efficiency", () => {
    expect(computeExpectedShiftQtyPreview({ cycleTimeSeconds: 0, netShiftMinutes: 450 })).toEqual({
      error: "Cycle time must be greater than zero.",
    });
    expect(
      computeExpectedShiftQtyPreview({ cycleTimeSeconds: 10, piecesPerCycle: 1.5, netShiftMinutes: 450 }),
    ).toEqual({ error: "Pieces per cycle must be a positive whole number." });
    expect(
      computeExpectedShiftQtyPreview({
        cycleTimeSeconds: 10,
        standardEfficiencyPercent: 0,
        netShiftMinutes: 450,
      }),
    ).toEqual({ error: "Standard efficiency % must be greater than 0 and not more than 100." });
  });
});

describe("fgProductionStandardFocus helpers", () => {
  it("defaults first focus to FG item and detects duplicate FG+Machine", () => {
    expect(firstEditableFocusTarget("new")).toBe("fg-item");
    expect(
      isDuplicateFgMachineError("An FG production standard already exists for this FG and machine."),
    ).toBe(true);
  });

  it("applies focus and skips soft steal", () => {
    const fgItem = makeInput();
    applyFgStandardFocus(
      { target: "fg-item", force: true },
      {
        fgItem,
        machine: null,
        cycleTime: null,
        pieces: null,
        efficiency: null,
        previewShift: null,
      },
      null,
    );
    expect(fgItem.focus).toHaveBeenCalled();
    const other = makeInput();
    expect(shouldSkipFocusSteal({ target: "fg-item", force: false }, other, fgItem)).toBe(true);
  });
});
