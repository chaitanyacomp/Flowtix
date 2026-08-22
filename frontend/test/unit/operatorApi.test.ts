import { describe, expect, it, vi } from "vitest";
import {
  applyOperatorFocus,
  firstEditableFocusTarget,
  isDuplicateEmployeeNumberError,
  isDuplicateOperatorCodeError,
  isOperatorCodeEditable,
  shouldSkipFocusSteal,
} from "../../src/lib/operatorMasterFocus";
import { normalizeOperatorCodePreview } from "../../src/lib/operatorApi";

function makeInput(): HTMLInputElement {
  return {
    tagName: "INPUT",
    focus: vi.fn(),
    select: vi.fn(),
    contains: () => false,
  } as unknown as HTMLInputElement;
}

describe("operatorApi / operatorMasterFocus helpers", () => {
  it("normalizes operator code like machine code", () => {
    expect(normalizeOperatorCodePreview("  op 01 ")).toBe("OP_01");
    expect(normalizeOperatorCodePreview("   ")).toBe("");
  });

  it("resolves first editable target and duplicate messages", () => {
    expect(isOperatorCodeEditable("edit")).toBe(true);
    expect(firstEditableFocusTarget("edit")).toBe("operator-code");
    expect(isDuplicateOperatorCodeError("Operator code already exists.")).toBe(true);
    expect(isDuplicateEmployeeNumberError("Employee number already exists.")).toBe(true);
  });

  it("applies focus / select on operator code", () => {
    const code = makeInput();
    applyOperatorFocus(
      { target: "operator-code", select: true, force: true },
      { code, name: null, employeeNumber: null },
      null,
    );
    expect(code.focus).toHaveBeenCalled();
    expect(code.select).toHaveBeenCalled();
  });

  it("soft focus skips when another control is active", () => {
    const code = makeInput();
    const other = makeInput();
    expect(shouldSkipFocusSteal({ target: "operator-code", force: false }, other, code)).toBe(true);
    expect(shouldSkipFocusSteal({ target: "operator-code", force: true }, other, code)).toBe(false);
  });
});
