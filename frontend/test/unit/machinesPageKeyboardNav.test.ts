import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source-contract regression for Machine Master keyboard tab order.
 * Actions stay visually in the header via CSS grid; DOM order drives Tab.
 */
describe("MachinesPage keyboard navigation", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/MachinesPage.tsx"), "utf8");

  const fieldOrder = [
    "machine-field-code",
    "machine-field-name",
    "machine-field-type",
    "machine-field-make",
    "machine-field-model",
    "machine-field-serial",
    "machine-field-department",
    "machine-field-description",
    "machine-field-active",
  ] as const;

  it("uses natural DOM tab order: fields → Active → Create/Update → Cancel (no positive tabindex)", () => {
    const fieldsIdx = source.indexOf('data-testid="machine-form-fields"');
    const actionsIdx = source.indexOf('data-testid="machine-form-actions"');
    const submitIdx = source.indexOf('data-testid="machine-form-submit"');
    const cancelIdx = source.indexOf('data-testid="machine-form-cancel"');
    const activeIdx = source.indexOf('data-testid="machine-field-active"');

    expect(fieldsIdx).toBeGreaterThan(-1);
    expect(actionsIdx).toBeGreaterThan(fieldsIdx);
    expect(submitIdx).toBeGreaterThan(actionsIdx);
    expect(cancelIdx).toBeGreaterThan(submitIdx);
    expect(activeIdx).toBeGreaterThan(fieldsIdx);
    expect(submitIdx).toBeGreaterThan(activeIdx);

    let prev = fieldsIdx;
    for (const id of fieldOrder) {
      const idx = source.indexOf(`data-testid="${id}"`);
      expect(idx, id).toBeGreaterThan(prev);
      prev = idx;
    }
    expect(submitIdx).toBeGreaterThan(prev);

    expect(source).toContain("flex-row-reverse");
    expect(source).toContain('type="submit"');
    expect(source).toContain("noValidate");
    expect(source).not.toMatch(/tabIndex=\{[1-9]/);
    expect(source).not.toMatch(/tabindex=["'][1-9]/);
    expect(source).not.toMatch(/onKeyDown=\{[\s\S]*Tab/);
    expect(source).not.toMatch(/addEventListener\(\s*["']keydown["']/);
  });

  it("keeps Cancel after submit in DOM while showing Cancel only when appropriate", () => {
    expect(source).toContain("showCancel");
    expect(source).toContain("machine-form-cancel");
    const actionsBlock = source.slice(
      source.indexOf('data-testid="machine-form-actions"'),
      source.lastIndexOf("</form>"),
    );
    const submitInActions = actionsBlock.indexOf('data-testid="machine-form-submit"');
    const cancelInActions = actionsBlock.indexOf('data-testid="machine-form-cancel"');
    expect(submitInActions).toBeGreaterThan(-1);
    expect(cancelInActions).toBeGreaterThan(submitInActions);
  });
});
