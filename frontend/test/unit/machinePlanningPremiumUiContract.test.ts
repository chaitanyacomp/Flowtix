import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { erpTypography } from "../../src/lib/erpFoundationTokens";
import { REGULAR_TERMS } from "../../src/lib/flowTerminology";
import { getPageTitle } from "../../src/lib/routeTitles";

const root = resolve(__dirname, "../..");
const rmCheckSource = readFileSync(resolve(root, "src/pages/RmCheckPage.tsx"), "utf8");
const compactSource = readFileSync(
  resolve(root, "src/components/erp/MachineRunPlanningCompact.tsx"),
  "utf8",
);
const allocationSource = readFileSync(
  resolve(root, "src/components/erp/WoPrepareProductionRunAllocationPanel.tsx"),
  "utf8",
);
const pageHeaderSource = readFileSync(resolve(root, "src/components/PageHeader.tsx"), "utf8");

describe("Machine Run Planning premium UI contract", () => {
  it("uses fluid page width without max-w-6xl gutter", () => {
    expect(pageHeaderSource).toContain("full operational workspace width");
    expect(rmCheckSource).toContain(
      'data-page-width={useCompactMachinePlanning || useReadyForWoConfirmation ? "fluid" : "narrow"}',
    );
    expect(rmCheckSource).toContain("w-full min-w-0");
    expect(rmCheckSource).not.toContain("max-w-6xl");
    // Compact / Ready-for-WO paths must not force a narrow column that leaves a large right gutter.
    expect(rmCheckSource).toMatch(
      /useCompactMachinePlanning \|\| useReadyForWoConfirmation \? "space-y-3 pb-3" : "max-w-5xl"/,
    );
  });

  it("reuses shared typography / section tokens (readable hierarchy)", () => {
    expect(erpTypography.pageTitle).toBe("erp-type-page-title");
    expect(erpTypography.sectionTitle).toBe("erp-type-section-title");
    expect(erpTypography.tableBody).toBe("erp-type-table-body");
    expect(erpTypography.helper).toBe("erp-type-helper");
    expect(compactSource).toContain("erpTypography");
    expect(compactSource).toContain("Customer Qty");
    expect(compactSource).toContain("Planned Qty");
    expect(compactSource).not.toMatch(/>CUST</);
    expect(compactSource).not.toMatch(/>PLAN</);
    expect(allocationSource).toContain("erpTypography");
  });

  it("keeps a single authoritative page title (app header only)", () => {
    expect(REGULAR_TERMS.MACHINE_RUN_PLANNING_TITLE).toBe("Machine Run Planning");
    expect(getPageTitle("/work-orders/prepare", "?intent=machine-planning")).toBe(
      "Machine Run Planning",
    );
    expect(rmCheckSource).not.toContain('data-testid="machine-run-planning-page-title"');
    expect(rmCheckSource).toContain("MachineRunPlanningContextStrip");
    expect(compactSource).toContain('data-testid="machine-planning-context-strip"');
  });

  it("Change SO toggles with Cancel, Escape, outside close, and dirty confirm", () => {
    expect(compactSource).toContain("MachineRunPlanningSoChangeControl");
    expect(compactSource).toContain('data-testid="machine-planning-change-so"');
    expect(compactSource).toContain('data-testid="machine-planning-change-so-cancel"');
    expect(compactSource).toContain('e.key === "Escape"');
    expect(compactSource).toContain("mousedown");
    expect(compactSource).toContain("unsaved machine planning changes");
    expect(rmCheckSource).toContain("planningWorkspaceDirty");
    expect(rmCheckSource).toContain("useUnsavedChangesGuard");
    expect(rmCheckSource).toContain("switchSalesOrder");
  });

  it("optional buffer control without duplicate qty strip chrome", () => {
    expect(compactSource).toContain("+ Add production buffer");
    expect(compactSource).toContain("machine-planning-add-buffer");
    expect(compactSource).toContain("machine-planning-buffer-summary");
    expect(compactSource).toContain("machine-planning-buffer-editor");
    expect(compactSource).toContain("Customer Qty");
    expect(compactSource).toContain("CircleHelp");
    expect(compactSource).toContain("DecimalInput");
    expect(compactSource).not.toContain("Additional Qty");
  });

  it("equal-height action buttons via shared sticky workflow bar", () => {
    expect(compactSource).toContain("erp-sticky-workflow-bar");
    expect(compactSource).toContain("Complete Machine Planning");
    expect(compactSource).toContain("Save Draft");
    expect(compactSource).toContain('data-testid="machine-planning-back-hub"');
    expect(compactSource).toMatch(/>\s*Back\s*</);
    expect(compactSource).toContain("ArrowLeft");
    expect(compactSource).toContain('variant="outline"');
    expect(compactSource).toContain('variant="default"');
    expect(compactSource).toContain('variant: "ghost"');
    expect(compactSource).toContain('size="default"');
  });

  it("1280 usability + wide-screen fluid markers", () => {
    expect(rmCheckSource).toContain('data-machine-planning-layout={useCompactMachinePlanning ? "compact"');
    expect(rmCheckSource).toContain(
      'data-page-width={useCompactMachinePlanning || useReadyForWoConfirmation ? "fluid" : "narrow"}',
    );
    expect(rmCheckSource).toContain("w-full min-w-0");
    expect(pageHeaderSource).toContain("overflow-x-hidden");
  });

  it("keyboard focus and accessibility hooks", () => {
    expect(compactSource).toContain('role="toolbar"');
    expect(compactSource).toContain('aria-label="Machine planning actions"');
    expect(compactSource).toContain('aria-label="Change sales order"');
    expect(compactSource).toContain("sr-only");
    expect(compactSource).toContain("selectRef.current?.focus()");
  });
});
