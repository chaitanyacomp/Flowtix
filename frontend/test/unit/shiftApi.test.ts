import { describe, expect, it, vi } from "vitest";
import {
  applyShiftFocus,
  firstEditableFocusTarget,
  isDuplicateShiftCodeError,
  isShiftCodeEditable,
  shouldSkipFocusSteal,
} from "../../src/lib/shiftMasterFocus";
import { normalizeShiftCodePreview } from "../../src/lib/shiftApi";
import {
  computeShiftDurationsPreview,
  formatDurationMinutes,
} from "../../src/lib/shiftDuration";

function makeInput(): HTMLInputElement {
  return {
    tagName: "INPUT",
    focus: vi.fn(),
    select: vi.fn(),
    contains: () => false,
  } as unknown as HTMLInputElement;
}

describe("shiftApi / shiftMasterFocus helpers", () => {
  it("normalizes shift code like machine/operator code", () => {
    expect(normalizeShiftCodePreview("  shift a ")).toBe("SHIFT_A");
    expect(normalizeShiftCodePreview("shift-12")).toBe("SHIFT-12");
    expect(normalizeShiftCodePreview("   ")).toBe("");
  });

  it("resolves first editable target and duplicate messages", () => {
    expect(isShiftCodeEditable("edit")).toBe(true);
    expect(firstEditableFocusTarget("edit")).toBe("shift-code");
    expect(isDuplicateShiftCodeError("Shift code already exists.")).toBe(true);
  });

  it("applies focus / select on shift code", () => {
    const code = makeInput();
    applyShiftFocus(
      { target: "shift-code", select: true, force: true },
      { code, name: null, startTime: null, endTime: null, breakMinutes: null },
      null,
    );
    expect(code.focus).toHaveBeenCalled();
    expect(code.select).toHaveBeenCalled();
  });

  it("soft focus skips when another control is active", () => {
    const code = makeInput();
    const other = makeInput();
    expect(shouldSkipFocusSteal({ target: "shift-code", force: false }, other, code)).toBe(true);
    expect(shouldSkipFocusSteal({ target: "shift-code", force: true }, other, code)).toBe(false);
  });
});

describe("shiftDuration preview (overnight + invalid break)", () => {
  it("matches day and overnight examples", () => {
    const a = computeShiftDurationsPreview("06:00", "14:00", 0);
    expect(a).toMatchObject({ grossDurationMinutes: 480, isOvernight: false, netProductionDurationMinutes: 480 });

    const b = computeShiftDurationsPreview("14:00", "22:00", 0);
    expect(b).toMatchObject({ grossDurationMinutes: 480, isOvernight: false });

    const c = computeShiftDurationsPreview("22:00", "06:00", 0);
    expect(c).toMatchObject({ grossDurationMinutes: 480, isOvernight: true, netProductionDurationMinutes: 480 });

    const d = computeShiftDurationsPreview("08:00", "20:00", 0);
    expect(d).toMatchObject({ grossDurationMinutes: 720, isOvernight: false });

    expect(formatDurationMinutes(480)).toBe("8h 0m");
  });

  it("rejects identical times and invalid break minutes", () => {
    expect(computeShiftDurationsPreview("08:00", "08:00", 0)).toEqual({
      error: "Start time and end time cannot be identical.",
    });
    expect(computeShiftDurationsPreview("06:00", "14:00", -5)).toEqual({
      error: "Planned break minutes must be zero or positive.",
    });
    expect(computeShiftDurationsPreview("06:00", "14:00", 480)).toEqual({
      error: "Planned break minutes must be less than gross shift duration.",
    });
    const withBreak = computeShiftDurationsPreview("06:00", "14:00", 30);
    expect(withBreak).toMatchObject({
      grossDurationMinutes: 480,
      netProductionDurationMinutes: 450,
      plannedBreakMinutes: 30,
    });
  });
});
