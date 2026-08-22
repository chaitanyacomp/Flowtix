import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ShiftsPage contextual focus behaviour", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/ShiftsPage.tsx"), "utf8");

  it("queues soft initial Shift Code focus after New form is ready", () => {
    expect(source).toContain("initialFocusDoneRef");
    expect(source).toContain('queueFocus({ target: "shift-code", force: false })');
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("applyShiftFocus");
  });

  it("focuses Shift Code on New / Cancel reset", () => {
    expect(source).toContain("function onNewShift");
    expect(source).toContain("resetToNewForm()");
    expect(source).toContain('queueFocus({ target: "shift-code", force: true })');
    expect(source).toContain('data-testid="shift-new-btn"');
  });

  it("focuses first editable field when selecting a row for edit", () => {
    expect(source).toContain("function selectRow");
    expect(source).toContain('queueFocus({ target: firstEditableFocusTarget("edit"), force: true })');
  });

  it("after create resets to New; after update keeps selection", () => {
    expect(source).toContain("await createShift(payload)");
    expect(source).toContain("resetToNewForm()");
    expect(source).toContain("const updated = await updateShift(editingId, payload)");
    expect(source).toContain("applyRowToForm(updated)");
    expect(source).toContain('queueFocus({ target: firstEditableFocusTarget("edit"), force: true })');
  });

  it("focuses first invalid / duplicate code fields", () => {
    expect(source).toContain('queueFocus({ target: "shift-code", force: true })');
    expect(source).toContain('queueFocus({ target: "shift-name", force: true })');
    expect(source).toContain("isDuplicateShiftCodeError");
    expect(source).toContain('queueFocus({ target: "shift-code", select: true, force: true })');
  });

  it("always shows duration preview before save", () => {
    expect(source).toContain('data-testid="shift-duration-preview"');
    expect(source).toContain("computeShiftDurationsPreview");
    expect(source).toContain("Gross shift duration");
    expect(source).toContain("Net production duration");
    expect(source).toContain("Overnight shift");
  });

  it("keeps visible focus outline on form controls", () => {
    expect(source).toContain("focus-visible:ring-sky-500");
    expect(source).toContain("fieldFocusRing");
  });
});
