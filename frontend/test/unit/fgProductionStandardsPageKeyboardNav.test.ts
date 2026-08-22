import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("FgProductionStandardsPage keyboard navigation", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/pages/FgProductionStandardsPage.tsx"),
    "utf8",
  );

  const fieldOrder = [
    "fg-standard-field-fg",
    "fg-standard-field-machine",
    "fg-standard-field-cycle",
    "fg-standard-field-pieces",
    "fg-standard-field-efficiency",
    "fg-standard-field-preview-shift",
    "fg-standard-field-remarks",
    "fg-standard-field-active",
  ] as const;

  it("uses natural DOM tab order: fields → Active → Create/Update → Cancel", () => {
    const fieldsIdx = source.indexOf('data-testid="fg-standard-form-fields"');
    const actionsIdx = source.indexOf('data-testid="fg-standard-form-actions"');
    const submitIdx = source.indexOf('data-testid="fg-standard-form-submit"');
    const cancelIdx = source.indexOf('data-testid="fg-standard-form-cancel"');
    const activeIdx = source.indexOf('data-testid="fg-standard-field-active"');

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
