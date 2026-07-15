import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pagePath = resolve(__dirname, "../../src/pages/RequirementSheetPage.tsx");
const pageSource = readFileSync(pagePath, "utf8");
const gridPath = resolve(__dirname, "../../src/components/erp/requirementSheet/RequirementSheetNoQtyGrid.tsx");
const gridSource = readFileSync(gridPath, "utf8");

describe("RequirementSheetPage workbench actions (FT-PD-066)", () => {
  it("uses a single Items-header action cluster", () => {
    expect(pageSource).toContain("WorkbenchActionCluster");
    expect(pageSource).not.toContain("WorkbenchActionBar");
    expect(pageSource).not.toContain('data-testid="workbench-action-bar"');
    expect(pageSource).toContain("rsWorkbenchActionCluster");
    expect(pageSource).toContain('data-testid="rs-items-header-row"');
    expect(pageSource).toContain("rsItemsHeaderActionClassName");
  });

  it("keeps draft action handlers on the single cluster", () => {
    expect(pageSource).toContain('label: "Recalculate"');
    expect(pageSource).toContain('label: "Save draft"');
    expect(pageSource).toContain("onClick: () => void recalc()");
    expect(pageSource).toContain("onClick: () => void saveDraft()");
    expect(pageSource).toContain("resolveRequirementSheetWorkbenchActions");
    // Save draft must recalculate atomically and clear needsRecalc
    expect(pageSource).toContain("/recalculate");
    expect(pageSource).toContain("setNeedsRecalc(false)");
  });

  it("places Items title and actions on one header row for NO_QTY", () => {
    expect(pageSource).toContain('data-testid="rs-items-header-row"');
    expect(pageSource).toMatch(/Items[\s\S]*rsWorkbenchActionCluster/);
    expect(pageSource).not.toContain("Planning Summary");
  });
});

describe("RequirementSheetNoQtyGrid headings", () => {
  it("keeps corrected qty column headings", () => {
    expect(gridSource).toContain("Customer Demand");
    expect(gridSource).toContain("Production Shortage");
    expect(gridSource).toContain("Final QC Rejection");
    expect(gridSource).toContain("Pending Recovery");
    expect(gridSource).toContain("Prior Accepted Excess");
    expect(gridSource).toContain("Net Production Requirement");
    expect(gridSource).toContain("Pending QC");
    expect(gridSource).not.toContain("Final RS Qty");
  });
});
