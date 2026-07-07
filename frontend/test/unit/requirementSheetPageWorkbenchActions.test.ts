import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pagePath = resolve(__dirname, "../../src/pages/RequirementSheetPage.tsx");
const pageSource = readFileSync(pagePath, "utf8");

describe("RequirementSheetPage workbench actions (FT-PD-066)", () => {
  it("uses a single Items-header action cluster", () => {
    expect(pageSource).toContain("WorkbenchActionCluster");
    expect(pageSource).not.toContain("WorkbenchActionBar");
    expect(pageSource).not.toContain('data-testid="workbench-action-bar"');
    expect(pageSource).toContain("rsWorkbenchActionCluster");
    expect(pageSource).toContain("rsItemsHeaderActionClassName");
    expect(pageSource).toContain("sticky top-[var(--erp-app-header-h");
  });

  it("keeps draft action handlers on the single cluster", () => {
    expect(pageSource).toContain('label: "Recalculate"');
    expect(pageSource).toContain('label: "Save draft"');
    expect(pageSource).toContain("onClick: () => void recalc()");
    expect(pageSource).toContain("onClick: () => void saveDraft()");
    expect(pageSource).toContain("resolveRequirementSheetWorkbenchActions");
  });
});
