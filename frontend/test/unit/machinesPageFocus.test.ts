import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("MachinesPage contextual focus behaviour", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/MachinesPage.tsx"), "utf8");

  it("queues soft initial Machine Code focus after New form is ready", () => {
    expect(source).toContain("initialFocusDoneRef");
    expect(source).toContain('queueFocus({ target: "machine-code", force: false })');
    expect(source).toContain("if (loading) return");
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("applyMachineFocus");
  });

  it("focuses Machine Code on New / Cancel reset", () => {
    expect(source).toContain("function onNewMachine");
    expect(source).toContain("resetToNewForm()");
    expect(source).toContain('queueFocus({ target: "machine-code", force: true })');
    expect(source).toContain('data-testid="machine-new-btn"');
    expect(source).toContain("onClick={onNewMachine}");
  });

  it("focuses first editable field when selecting a row for edit", () => {
    expect(source).toContain("function selectRow");
    expect(source).toContain('queueFocus({ target: firstEditableFocusTarget("edit"), force: true })');
    expect(source).toContain("firstEditableFocusTarget");
  });

  it("after create resets to New and focuses Machine Code; after update keeps selection", () => {
    expect(source).toContain("await createMachine(payload)");
    expect(source).toContain("resetToNewForm()");
    expect(source).toContain('queueFocus({ target: "machine-code", force: true })');
    expect(source).toContain("const updated = await updateMachine(editingId, payload)");
    expect(source).toContain("applyRowToForm(updated)");
    expect(source).toContain('queueFocus({ target: firstEditableFocusTarget("edit"), force: true })');
  });

  it("focuses first invalid field and selects code on duplicate failure", () => {
    expect(source).toContain('queueFocus({ target: "machine-code", force: true })');
    expect(source).toContain('queueFocus({ target: "machine-name", force: true })');
    expect(source).toContain('queueFocus({ target: "machine-type", force: true })');
    expect(source).toContain("isDuplicateMachineCodeError");
    expect(source).toContain('queueFocus({ target: "machine-code", select: true, force: true })');
  });

  it("keeps visible focus outline on form controls", () => {
    expect(source).toContain("focus-visible:ring-sky-500");
    expect(source).toContain("fieldFocusRing");
  });
});
