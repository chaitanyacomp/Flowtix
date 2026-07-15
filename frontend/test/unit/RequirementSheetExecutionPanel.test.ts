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

  it("renders context KPI tiles inside the left context column of the workstation grid", () => {
    const workIdx = indexOfOrFail(panelSource, 'data-testid="execution-two-column-work-area"');
    const heroIdx = indexOfOrFail(panelSource, 'data-testid="execution-hero-kpis"');
    const placeIdx = indexOfOrFail(panelSource, 'data-testid="execution-place-wo-block"');
    // KPI tiles live in the left context column, which is inside the grid and before the right action column.
    expect(workIdx).toBeLessThan(heroIdx);
    expect(heroIdx).toBeLessThan(placeIdx);
    expect(panelSource).toContain("KPI_REMAINING_TO_PLACE");
    expect(panelSource).toContain("KPI_SUGGESTED_NEXT_WO");
    expect(panelSource).toContain("KPI_RM_LIMITED_CAPACITY");
    expect(panelSource).toContain("KPI_WO_QTY_PLACED");
    expect(panelSource).toContain("KPI_TOTAL_RS_REQUIREMENT");
    expect(panelSource).toContain("KPI_NUMBER_OF_WOS");
    expect(panelSource).toContain("KPI_CUSTOMER_DEMAND");
    expect(panelSource).toContain("KPI_PRODUCTION_SHORTAGE");
    expect(panelSource).toContain("KPI_QC_FINAL_REJECTION");
    expect(panelSource).toContain("KPI_TOTAL_RECOVERY");
    expect(panelSource).toContain("KPI_RM_COVERAGE");
    expect(panelSource).toContain('data-testid="execution-composition-kpis"');
    expect(panelSource).not.toContain("Original WO Qty");
  });

  it("places left context column before the right action column with RM integrated inside it", () => {
    expect(panelSource).toContain('data-testid="execution-workflow-stage-banner"');
    expect(panelSource).toContain("WORK_AREA_TITLE");
    expect(panelSource).toContain("INFO_PANEL_TITLE");
    expect(panelSource).toContain("STAGE_CURRENT");
    expect(panelSource).toContain("PAGE_TITLE");
    expect(panelSource).toContain("CAPACITY_AREA_TITLE");

    const infoIdx = indexOfOrFail(panelSource, 'data-testid="execution-info-panel"');
    const placeIdx = indexOfOrFail(panelSource, 'data-testid="execution-place-wo-block"');
    const rmIdx = indexOfOrFail(panelSource, 'data-testid="execution-rm-capacity-panel"');
    // Left context first, then the action block; the RM panel is nested inside the action block.
    expect(infoIdx).toBeLessThan(placeIdx);
    expect(placeIdx).toBeLessThan(rmIdx);
  });

  it("keeps the full WO transaction (Enter Qty, RM, Create buttons) in one above-fold action column", () => {
    const infoIdx = indexOfOrFail(panelSource, 'data-testid="execution-info-panel"');
    const placeIdx = indexOfOrFail(panelSource, 'data-testid="execution-place-wo-block"');
    const rmIdx = indexOfOrFail(panelSource, 'data-testid="execution-rm-capacity-panel"');
    const woHistoryIdx = indexOfOrFail(panelSource, 'data-testid="execution-wo-history"');
    const procIdx = indexOfOrFail(panelSource, 'testId="execution-procurement-progress"');
    // Workstation grid (context + action) sits above Current Work Orders and the collapsed reference sections.
    expect(infoIdx).toBeLessThan(placeIdx);
    expect(placeIdx).toBeLessThan(rmIdx);
    expect(rmIdx).toBeLessThan(woHistoryIdx);
    expect(woHistoryIdx).toBeLessThan(procIdx);
    expect(panelSource.indexOf("Enter Qty", placeIdx)).toBeGreaterThan(placeIdx);
    expect(panelSource.indexOf("RM Status", placeIdx)).toBeGreaterThan(placeIdx);
    // Create buttons render after the integrated RM panel but still inside the action column (above Current Work Orders).
    const createIdx = panelSource.indexOf("execution-create-suggested-wo", placeIdx);
    expect(createIdx).toBeGreaterThan(rmIdx);
    expect(createIdx).toBeLessThan(woHistoryIdx);
  });

  it("uses operational Current Work Orders table columns", () => {
    expect(panelSource).toContain("WO Number");
    expect(panelSource).toContain("FG Item");
    expect(panelSource).toContain("Planned Qty");
    expect(panelSource).toContain("RM Status");
    expect(panelSource).toContain("Production Status");
    expect(panelSource).toContain("CURRENT_WOS_TITLE");
    expect(panelSource).toContain("EXECUTION_WO_HISTORY_MAX_ROWS");
    expect(panelSource).toContain("executionWoHistoryVisibleCount");
    expect(panelSource).toContain('data-testid="execution-wo-history-view-all"');
  });

  it("keeps live RM detail after the action panel and reference sections collapsed below", () => {
    expect(panelSource).toContain('data-testid="execution-rm-detail"');
    expect(panelSource).toContain("execution/rm-preview");
    expect(panelSource).toContain("operatorGuidance");
    expect(panelSource).toContain('testId="execution-audit-history"');
    expect(panelSource).toContain('testId="execution-coverage-calculations"');
    expect(panelSource).toContain("defaultOpen={false}");
  });

  it("splits placement into suggested and custom create actions and stays on workspace after create", () => {
    expect(panelSource).toContain("CREATE_SUGGESTED");
    expect(panelSource).toContain("CREATE_CUSTOM");
    expect(panelSource).toContain('data-testid="execution-create-suggested-wo"');
    expect(panelSource).toContain('data-testid="execution-create-custom-wo"');
    expect(panelSource).toContain('submitPlacement("suggested")');
    expect(panelSource).toContain('submitPlacement("custom")');
    expect(panelSource).toContain("/create-wo");
    expect(panelSource).toContain("execution-wo-created-banner");
    expect(panelSource).toContain("CREATE_ANOTHER");
    expect(panelSource).toContain("reloadExecutionSummary");
    expect(panelSource).not.toContain("useNavigate");
    expect(panelSource).not.toContain("navigate(");
    expect(panelSource).toContain("materialIssueFromWorkspaceState");
    expect(panelSource).toContain("formatPostWoCreateSuccessMessage");
    expect(panelSource).toContain("placementQuantitiesMatchSuggested");
  });

  it("removes duplicate above-fold sections", () => {
    expect(panelSource).not.toContain("Line Balance");
    expect(panelSource).not.toContain("Execution Readiness");
    expect(panelSource).not.toContain("Existing WO Summary");
    expect(panelSource).not.toContain("WO Batch Placement");
    expect(panelSource).not.toContain("Release creates Monthly Plan MR");
  });
});
