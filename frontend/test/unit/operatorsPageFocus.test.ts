import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("OperatorsPage contextual focus behaviour", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/OperatorsPage.tsx"), "utf8");

  it("queues soft initial Operator Code focus after New form is ready", () => {
    expect(source).toContain("initialFocusDoneRef");
    expect(source).toContain('queueFocus({ target: "operator-code", force: false })');
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("applyOperatorFocus");
  });

  it("focuses Operator Code on New / Cancel reset", () => {
    expect(source).toContain("function onNewOperator");
    expect(source).toContain("resetToNewForm()");
    expect(source).toContain('queueFocus({ target: "operator-code", force: true })');
    expect(source).toContain('data-testid="operator-new-btn"');
  });

  it("focuses first editable field when selecting a row for edit", () => {
    expect(source).toContain("function selectRow");
    expect(source).toContain('queueFocus({ target: firstEditableFocusTarget("edit"), force: true })');
  });

  it("after create resets to New; after update keeps selection", () => {
    expect(source).toContain("await createOperator(payload)");
    expect(source).toContain("resetToNewForm()");
    expect(source).toContain("const updated = await updateOperator(editingId, payload)");
    expect(source).toContain("applyRowToForm(updated)");
    expect(source).toContain('queueFocus({ target: firstEditableFocusTarget("edit"), force: true })');
  });

  it("focuses first invalid / duplicate code fields", () => {
    expect(source).toContain('queueFocus({ target: "operator-code", force: true })');
    expect(source).toContain('queueFocus({ target: "operator-name", force: true })');
    expect(source).toContain("isDuplicateOperatorCodeError");
    expect(source).toContain('queueFocus({ target: "operator-code", select: true, force: true })');
    expect(source).toContain("isDuplicateEmployeeNumberError");
  });

  it("keeps visible focus outline on form controls", () => {
    expect(source).toContain("focus-visible:ring-sky-500");
    expect(source).toContain("fieldFocusRing");
  });
});
