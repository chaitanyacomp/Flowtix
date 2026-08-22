import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ShiftsPage keyboard navigation", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/ShiftsPage.tsx"), "utf8");

  const fieldOrder = [
    "shift-field-code",
    "shift-field-name",
    "shift-field-start",
    "shift-field-end",
    "shift-field-break",
    "shift-field-remarks",
    "shift-field-active",
  ] as const;

  it("uses natural DOM tab order: fields → Active → Create/Update → Cancel", () => {
    const fieldsIdx = source.indexOf('data-testid="shift-form-fields"');
    const actionsIdx = source.indexOf('data-testid="shift-form-actions"');
    const submitIdx = source.indexOf('data-testid="shift-form-submit"');
    const cancelIdx = source.indexOf('data-testid="shift-form-cancel"');
    const activeIdx = source.indexOf('data-testid="shift-field-active"');

    expect(fieldsIdx).toBeGreaterThan(-1);
    expect(actionsIdx).toBeGreaterThan(fieldsIdx);
    expect(submitIdx).toBeGreaterThan(actionsIdx);
    expect(cancelIdx).toBeGreaterThan(submitIdx);
    expect(submitIdx).toBeGreaterThan(activeIdx);

    let prev = fieldsIdx;
    for (const id of fieldOrder) {
      const idx = source.indexOf(`data-testid="${id}"`);
      expect(idx, id).toBeGreaterThan(prev);
      prev = idx;
    }
    expect(submitIdx).toBeGreaterThan(prev);

    expect(source).toContain("flex-row-reverse");
    expect(source).toContain("noValidate");
    expect(source).not.toMatch(/tabIndex=\{[1-9]/);
  });
});
