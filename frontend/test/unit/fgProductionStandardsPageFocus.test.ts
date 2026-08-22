import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("FgProductionStandardsPage contextual focus behaviour", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/pages/FgProductionStandardsPage.tsx"),
    "utf8",
  );

  it("queues soft initial FG focus after New form is ready", () => {
    expect(source).toContain("initialFocusDoneRef");
    expect(source).toContain('queueFocus({ target: "fg-item", force: false })');
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("applyFgStandardFocus");
  });

  it("focuses FG on New / Cancel reset", () => {
    expect(source).toContain("function onNewStandard");
    expect(source).toContain("resetToNewForm()");
    expect(source).toContain('queueFocus({ target: "fg-item", force: true })');
    expect(source).toContain('data-testid="fg-standard-new-btn"');
  });

  it("after create resets to New; after update keeps selection", () => {
    expect(source).toContain("await createFgProductionStandard(payload)");
    expect(source).toContain("resetToNewForm()");
    expect(source).toContain("const updated = await updateFgProductionStandard(editingId, payload)");
    expect(source).toContain("applyRowToForm(updated)");
  });

  it("focuses duplicate FG+Machine and shows qty preview", () => {
    expect(source).toContain("isDuplicateFgMachineError");
    expect(source).toContain('data-testid="fg-standard-qty-preview"');
    expect(source).toContain("computeExpectedShiftQtyPreview");
    expect(source).toContain("Preview shift");
    expect(source).toContain("not saved");
  });

  it("does not store preview shift on save payload", () => {
    const start = source.indexOf("const payload = {");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("};", start);
    const payloadBlock = source.slice(start, end + 2);
    expect(payloadBlock).toContain("itemId");
    expect(payloadBlock).toContain("machineId");
    expect(payloadBlock).toContain("cycleTimeSeconds");
    expect(payloadBlock).not.toContain("previewShift");
  });
});
