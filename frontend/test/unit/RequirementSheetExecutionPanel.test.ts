import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelPath = resolve(__dirname, "../../src/components/erp/production/RequirementSheetExecutionPanel.tsx");
const panelSource = readFileSync(panelPath, "utf8");

function indexOfOrFail(haystack: string, needle: string): number {
  const idx = haystack.indexOf(needle);
  expect(idx, `Expected to find ${needle}`).toBeGreaterThanOrEqual(0);
  return idx;
}

describe("RequirementSheetExecutionPanel layout", () => {
  it("exports panel component", async () => {
    const mod = await import("../../src/components/erp/production/RequirementSheetExecutionPanel");
    expect(typeof mod.RequirementSheetExecutionPanel).toBe("function");
  });

  it("renders hero KPI hierarchy before context KPIs", () => {
    const heroIdx = indexOfOrFail(panelSource, 'data-testid="execution-hero-kpis"');
    const contextIdx = indexOfOrFail(panelSource, 'data-testid="execution-context-kpis"');
    expect(heroIdx).toBeLessThan(contextIdx);
    expect(panelSource).toContain('label="RS Balance"');
    expect(panelSource).toContain('label="Suggested WO"');
    expect(panelSource).toContain("RM Coverage");
    expect(panelSource).toContain('label="RS Demand"');
    expect(panelSource).toContain('label="WO Placed"');
  });

  it("places Place WO block before RM detail and procurement sections", () => {
    const placeIdx = indexOfOrFail(panelSource, 'data-testid="execution-place-wo-block"');
    const rmIdx = indexOfOrFail(panelSource, 'testId="execution-rm-detail"');
    const procIdx = indexOfOrFail(panelSource, 'testId="execution-procurement-progress"');
    const woHistoryIdx = indexOfOrFail(panelSource, 'data-testid="execution-wo-history"');
    expect(placeIdx).toBeLessThan(woHistoryIdx);
    expect(woHistoryIdx).toBeLessThan(rmIdx);
    expect(rmIdx).toBeLessThan(procIdx);
  });

  it("uses compact WO history columns and caps rows", () => {
    expect(panelSource).toContain("WO Number");
    expect(panelSource).toContain("EXECUTION_WO_HISTORY_MAX_ROWS");
    expect(panelSource).toContain("executionWoHistoryVisibleCount");
    expect(panelSource).toContain('data-testid="execution-wo-history-view-all"');
    expect(panelSource).not.toContain("PMR Status");
  });

  it("collapses RM detail and procurement by default", () => {
    expect(panelSource).toContain("CollapsibleWorkspaceSection");
    expect(panelSource).toContain('testId="execution-rm-detail"');
    expect(panelSource).toContain("defaultOpen={false}");
    expect(panelSource).toContain('testId="execution-audit-history"');
  });

  it("splits placement into suggested and custom create actions", () => {
    expect(panelSource).toContain("Create Suggested WO");
    expect(panelSource).toContain("Create Custom WO");
    expect(panelSource).toContain('data-testid="execution-create-suggested-wo"');
    expect(panelSource).toContain('data-testid="execution-create-custom-wo"');
    expect(panelSource).toContain('submitPlacement("suggested")');
    expect(panelSource).toContain('submitPlacement("custom")');
    expect(panelSource).toContain("/create-wo");
    expect(panelSource).toContain("postWoMaterialIssueHref");
    expect(panelSource).toContain("formatPostWoCreateSuccessMessage");
    expect(panelSource).toContain("placementQuantitiesMatchSuggested");
    expect(panelSource).toContain('variant={useSuggestedAsPrimary ? "default" : "outline"}');
  });

  it("removes duplicate above-fold sections", () => {
    expect(panelSource).not.toContain("Line Balance");
    expect(panelSource).not.toContain("Execution Readiness");
    expect(panelSource).not.toContain("Existing WO Summary");
    expect(panelSource).not.toContain("WO Batch Placement");
    expect(panelSource).not.toContain("Release creates Monthly Plan MR");
  });
});
