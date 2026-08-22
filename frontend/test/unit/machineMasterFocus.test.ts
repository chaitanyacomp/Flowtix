import { describe, expect, it, vi } from "vitest";
import {
  applyMachineFocus,
  firstEditableFocusTarget,
  isDuplicateMachineCodeError,
  isInteractiveControl,
  isMachineCodeEditable,
  shouldSkipFocusSteal,
} from "../../src/lib/machineMasterFocus";

function makeInput(value = ""): HTMLInputElement {
  return {
    value,
    tagName: "INPUT",
    focus: vi.fn(),
    select: vi.fn(),
    contains: () => false,
  } as unknown as HTMLInputElement;
}

describe("machineMasterFocus helpers", () => {
  it("resolves first editable target (code when editable)", () => {
    expect(isMachineCodeEditable("new")).toBe(true);
    expect(isMachineCodeEditable("edit")).toBe(true);
    expect(firstEditableFocusTarget("new")).toBe("machine-code");
    expect(firstEditableFocusTarget("edit")).toBe("machine-code");
  });

  it("detects duplicate machine code errors", () => {
    expect(isDuplicateMachineCodeError("Machine code already exists.")).toBe(true);
    expect(isDuplicateMachineCodeError("Save failed")).toBe(false);
  });

  it("soft focus skips when another interactive control is active", () => {
    const code = makeInput("A");
    const search = makeInput("q");
    expect(shouldSkipFocusSteal({ target: "machine-code", force: false }, search, code)).toBe(true);
    expect(shouldSkipFocusSteal({ target: "machine-code", force: true }, search, code)).toBe(false);
    expect(isInteractiveControl(search)).toBe(true);
  });

  it("applies create/new focus on Machine Code", () => {
    const code = makeInput();
    const name = makeInput();
    const applied = applyMachineFocus(
      { target: "machine-code", force: true },
      { code, name, type: null },
      null,
    );
    expect(applied).toBe(true);
    expect(code.focus).toHaveBeenCalled();
  });

  it("focuses and selects Machine Code on duplicate failure", () => {
    const code = makeInput("DUP");
    applyMachineFocus(
      { target: "machine-code", select: true, force: true },
      { code, name: null, type: null },
      null,
    );
    expect(code.focus).toHaveBeenCalled();
    expect(code.select).toHaveBeenCalled();
  });

  it("focuses Machine Name when validation targets name", () => {
    const name = makeInput();
    applyMachineFocus(
      { target: "machine-name", force: true },
      { code: null, name, type: null },
      null,
    );
    expect(name.focus).toHaveBeenCalled();
  });
});
