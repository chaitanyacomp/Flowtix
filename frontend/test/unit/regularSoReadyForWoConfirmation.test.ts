/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shouldUseReadyForWoConfirmationLayout } from "../../src/lib/regularSoReadyForWoLayout";
import {
  READY_FOR_WO_SHELL_CLASS,
  READY_FOR_WO_STACK_CLASS,
} from "../../src/components/erp/RegularSoReadyForWoConfirmation";

const root = resolve(__dirname, "../..");
const confirmationSource = readFileSync(
  resolve(root, "src/components/erp/RegularSoReadyForWoConfirmation.tsx"),
  "utf8",
);
const rmCheckSource = readFileSync(resolve(root, "src/pages/RmCheckPage.tsx"), "utf8");
const salesOrdersSource = readFileSync(resolve(root, "src/pages/SalesOrdersPage.tsx"), "utf8");
const styleSource = readFileSync(resolve(root, "src/style.css"), "utf8");

describe("shouldUseReadyForWoConfirmationLayout", () => {
  it("activates for READY_FOR_WO when machine planning is complete (Admin/Store path)", () => {
    expect(
      shouldUseReadyForWoConfirmationLayout({
        useCompactMachinePlanning: false,
        workflowState: "READY_FOR_WO",
        machinePlanningComplete: true,
      }),
    ).toBe(true);
  });

  it("does not override Production compact machine-planning layout", () => {
    expect(
      shouldUseReadyForWoConfirmationLayout({
        useCompactMachinePlanning: true,
        workflowState: "READY_FOR_WO",
        machinePlanningComplete: true,
      }),
    ).toBe(false);
  });
});

describe("Ready-for-WO sticky top toolbar + aligned sections", () => {
  it("uses one shared shell width and 12px vertical stack for equal edges", () => {
    expect(READY_FOR_WO_SHELL_CLASS).toBe("mx-auto w-full max-w-6xl");
    expect(READY_FOR_WO_STACK_CLASS).toBe("space-y-3");
    expect(confirmationSource).toContain("READY_FOR_WO_SHELL_CLASS");
    expect(confirmationSource).toContain("READY_FOR_WO_STACK_CLASS");
    expect(confirmationSource).toContain("erp-ready-for-wo-section");
    expect(styleSource).toContain(".erp-ready-for-wo-toolbar");
    expect(styleSource).toContain(".erp-ready-for-wo-section");
    // Banner + machine + material all use shared section class
    const sectionUses = confirmationSource.split("erp-ready-for-wo-section").length - 1;
    expect(sectionUses).toBeGreaterThanOrEqual(3);
  });

  it("has sticky top toolbar and no bottom sticky footer", () => {
    expect(confirmationSource).toContain('data-testid="ready-for-wo-sticky-toolbar"');
    expect(confirmationSource).toContain("erp-ready-for-wo-toolbar");
    expect(styleSource).toContain("sticky top-0 z-[26]");
    expect(confirmationSource).not.toContain("erp-sticky-workflow-bar");
    expect(confirmationSource).not.toContain('data-testid="ready-for-wo-action-bar"');
    expect(confirmationSource).not.toContain("ready-for-wo-footer-summary");
    expect(confirmationSource).not.toContain("pb-24");
  });

  it("keeps a single Create Work Order action in the toolbar (not banner)", () => {
    const createMatches = confirmationSource.match(/data-testid="next-create-wo-btn"/g) ?? [];
    expect(createMatches).toHaveLength(1);
    expect(confirmationSource).toContain('data-testid="ready-for-wo-toolbar-actions"');
    const bannerIdx = confirmationSource.indexOf('data-testid="ready-for-wo-primary-banner"');
    const bannerSlice = confirmationSource.slice(bannerIdx, bannerIdx + 450);
    expect(bannerSlice).toContain("Planning and material checks are complete.");
    expect(bannerSlice).not.toContain("next-create-wo-btn");
    expect(bannerSlice).not.toContain("Create Work Order");
  });

  it("toolbar has Back left, summary centre, Change SO + Create right", () => {
    expect(confirmationSource).toContain('data-testid="ready-for-wo-back"');
    expect(confirmationSource).toContain("ERPBackNavigation");
    expect(confirmationSource).toContain("BACK_TO_SALES_ORDERS");
    expect(confirmationSource).toContain('data-testid="ready-for-wo-toolbar-summary"');
    expect(confirmationSource).toContain("Customer Qty");
    expect(confirmationSource).toContain("Planned WO Qty");
    expect(confirmationSource).toContain('data-testid="ready-for-wo-rm-badge"');
    // Change SO slot + Create in actions cluster
    expect(confirmationSource).toContain("{soChange ? <div className=\"shrink-0\">{soChange}</div> : null}");
    expect(confirmationSource).toContain("flex-wrap");
    expect(confirmationSource).toContain("lg:flex-nowrap");
  });

  it("unauthorized handoff lives in toolbar actions only", () => {
    expect(confirmationSource).toContain('data-testid="ready-for-wo-handoff-text"');
    const toolbarIdx = confirmationSource.indexOf('data-testid="ready-for-wo-sticky-toolbar"');
    const bannerIdx = confirmationSource.indexOf('data-testid="ready-for-wo-primary-banner"');
    expect(confirmationSource.slice(toolbarIdx, bannerIdx)).toContain("ready-for-wo-handoff-text");
    expect(confirmationSource.slice(bannerIdx)).not.toContain("ready-for-wo-handoff-text");
  });

  it("renders read-only allocation without inputs/dropdowns/add-run", () => {
    expect(confirmationSource).not.toMatch(/<select\b/);
    expect(confirmationSource).not.toMatch(/type=["']date["']/);
    expect(confirmationSource).not.toContain("Add Machine Run");
    expect(confirmationSource).not.toContain("onRemove");
  });

  it("shows friendly shift name only", () => {
    const shiftFnStart = confirmationSource.indexOf("function shiftLabel");
    const shiftFnEnd = confirmationSource.indexOf("export function RegularSoReadyForWoConfirmation");
    const shiftFn = confirmationSource.slice(shiftFnStart, shiftFnEnd);
    expect(shiftFn).toContain('if (name) return name');
    expect(shiftFn).not.toContain("${code} · ${name}");
  });

  it("preserves Sales Orders list returnTo for Back", () => {
    expect(rmCheckSource).toContain("resolveListBackTarget");
    expect(salesOrdersSource).toContain("withSoListReturn(primaryCta.to)");
  });
});
