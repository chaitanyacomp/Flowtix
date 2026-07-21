import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ProductionReportPanel header close action", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionReportPanel.tsx"),
    "utf8",
  );

  it("places Confirm Report & Close WO in the report header (not a bottom duplicate)", () => {
    expect(source).toContain('data-testid="production-report-header"');
    expect(source).toContain('data-testid="production-report-header-actions"');
    expect(source).toContain('data-testid="production-report-header-status"');
    expect(source).toContain('data-testid="confirm-report-close-wo-btn"');
    expect(source).toContain('data-testid="production-report-summary-strip"');
    expect(source).not.toContain('data-testid="production-report-sticky-footer"');
    expect(source).not.toContain('data-testid="production-report-footer-status"');

    const headerBlock = source.slice(
      source.indexOf('data-testid="production-report-header"'),
      source.indexOf('data-testid="production-report-scroll-body"'),
    );
    expect(headerBlock).toContain("{confirmButton}");
    expect(headerBlock).toContain("{headerReadinessText}");
    expect(headerBlock).toContain("production-report-header-actions");

    const scrollBodyBlock = source.slice(
      source.indexOf('data-testid="production-report-scroll-body"'),
      source.indexOf("/* Non-compact"),
    );
    expect(scrollBodyBlock).toContain("ProductionReportWastageDetails");
    expect(scrollBodyBlock).toContain("{remarksField}");
    expect(scrollBodyBlock).not.toContain("{confirmButton}");
    expect(scrollBodyBlock).toContain("scrollableRows");
  });

  it("keeps enable rules and double-submit guard on Confirm", () => {
    expect(source).toContain("confirmBlockedByUnexplained");
    expect(source).toContain("confirmBlockedByWastage");
    expect(source).toContain("disabled={saving || confirmBlocked}");
    expect(source).toContain("if (!report || saving) return");
    expect(source).toContain("Ready to close");
    expect(source).toContain("headerReadinessText");
    expect(source).toContain("`Balance ${fmtQty(Math.abs(rmTotals.unexplained))} ${rmTotals.unit}`");
  });

  it("uses compact viewport workbench labels and unexplained-balance terminology", () => {
    expect(source).toContain("production-report-header");
    expect(source).toContain("production-report-rm-zone");
    expect(source).toContain("Unexplained Balance");
    expect(source).toContain("computeRmLineWastageAllocation");
  });
});

describe("ProductionReportWastageDetails internal scroll", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionReportWastageDetails.tsx"),
    "utf8",
  );

  it("scrolls wastage rows internally without expanding the page to reach Confirm", () => {
    expect(source).toContain("canAddWastageReason");
    expect(source).toContain("disabled={!canAddWastageReason}");
    expect(source).toContain("Required wastage:");
    expect(source).toContain("production-wastage-rows-scroll");
    expect(source).toContain("overflow-y-auto");
    expect(source).toContain("overflow-x-hidden");
    expect(source).toContain("scrollableRows");
    expect(source).toContain("fillAvailableHeight");
  });
});

describe("ProductionWorkspaceCompactPanel full-width report workbench", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionWorkspaceCompactPanel.tsx"),
    "utf8",
  );

  it("renders a single-column viewport without the tall left summary card", () => {
    expect(source).toContain('data-testid="production-no-qty-viewport-shell"');
    expect(source).toContain('data-testid="production-report-wo-identity"');
    expect(source).not.toContain("ProductionNoQtyViewportShell");
    expect(source).not.toContain("<ProductionNoQtyWoSummaryCard");
    expect(source).not.toContain("production-workspace-closure-panel");
    expect(source).toContain("Short production:");
  });

  it("always routes Confirm Report & Close WO through onExecutionClosed (never legacy NO_QTY advance)", () => {
    expect(source).toContain("Compact workbench always closes on confirm");
    expect(source).toContain("if (onExecutionClosed)");
  });
});

describe("ProductionPage post-close navigation", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/ProductionPage.tsx"), "utf8");

  it("returns to Ready to Start via buildPostProductionReportCloseHref after close", () => {
    expect(source).toContain("buildPostProductionReportCloseHref");
    expect(source).toContain("shouldRedirectLegacyOrphanNoQtyProductionSearch");
    expect(source).toContain("returnToProductionWorkspaceDashboard({ refreshAfter: true })");
    const closeHandler = source.slice(
      source.indexOf("const handleProductionReportConfirmed"),
      source.indexOf("const executableProductionQueueLines"),
    );
    expect(closeHandler).toContain("closedByConfirm");
    expect(closeHandler).toContain("returnToProductionWorkspaceDashboard({ refreshAfter: true })");
    expect(closeHandler).not.toContain('params.set("source", "no_qty_so")');
  });

  it("hides generic Continue while mandatory Production Report is pending", () => {
    expect(source).toContain("shouldHideContinueWhileProductionReportPending");
    expect(source).toContain("hideContinueForProductionReport");
    expect(source).toContain("productionStageLabelForReportPending");
    expect(source).toContain("!hideContinueForProductionReport");
    // Header Continue production link must be gated by report-pending hide flag.
    expect(source).toMatch(
      /!hideContinueForProductionReport \? \(\s*<button[\s\S]*?>\s*Continue production\s*<\/button>/,
    );
  });
});

describe("ProductionNoQtyViewportShell stretch containment", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionNoQtyViewportShell.tsx"),
    "utf8",
  );

  it("forces stretch height so report footer cannot escape the viewport shell", () => {
    expect(source).toContain("items-stretch lg:items-stretch");
    expect(source).toContain("h-full min-h-0");
    expect(source).toContain("overflow-hidden");
  });
});
