import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("OperatorsPage keyboard navigation", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/OperatorsPage.tsx"), "utf8");

  const fieldOrder = [
    "operator-field-code",
    "operator-field-name",
    "operator-field-employee",
    "operator-field-department",
    "operator-field-designation",
    "operator-field-remarks",
    "operator-field-active",
  ] as const;

  it("uses natural DOM tab order: fields → Active → Create/Update → Cancel", () => {
    const fieldsIdx = source.indexOf('data-testid="operator-form-fields"');
    const actionsIdx = source.indexOf('data-testid="operator-form-actions"');
    const submitIdx = source.indexOf('data-testid="operator-form-submit"');
    const cancelIdx = source.indexOf('data-testid="operator-form-cancel"');
    const activeIdx = source.indexOf('data-testid="operator-field-active"');

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

    expect(source).not.toContain("linked-user");
    expect(source).not.toContain("linkedUser");
    expect(source).toContain("flex-row-reverse");
    expect(source).toContain("noValidate");
    expect(source).not.toMatch(/tabIndex=\{[1-9]/);
  });
});
