import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ProductionReportPanel sticky close action", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionReportPanel.tsx"),
    "utf8",
  );

  it("keeps Confirm outside the scrollable wastage/middle body in compact mode", () => {
    expect(source).toContain('data-testid="production-report-sticky-footer"');
    expect(source).toContain('data-testid="production-report-scroll-body"');
    expect(source).toContain('data-testid="confirm-report-close-wo-btn"');
    expect(source).toContain('data-testid="production-report-footer-status"');
    expect(source).toContain('data-testid="production-report-summary-strip"');

    const compactFooterBlock = source.slice(
      source.indexOf('data-testid="production-report-sticky-footer"'),
      source.indexOf("/* Non-compact"),
    );
    expect(compactFooterBlock).toContain("{confirmButton}");
    expect(compactFooterBlock).toContain("{footerStatusText}");
    expect(compactFooterBlock).not.toContain("production-report-scroll-body");

    const scrollBodyBlock = source.slice(
      source.indexOf('data-testid="production-report-scroll-body"'),
      source.indexOf('data-testid="production-report-sticky-footer"'),
    );
    expect(scrollBodyBlock).toContain("ProductionReportWastageDetails");
    expect(scrollBodyBlock).toContain("{remarksField}");
    expect(scrollBodyBlock).not.toContain("{confirmButton}");
  });

  it("uses compact viewport workbench labels and unexplained-balance terminology", () => {
    expect(source).toContain("production-report-header");
    expect(source).toContain("production-report-rm-zone");
    expect(source).toContain("Unexplained Balance");
    expect(source).toContain("Ready to close");
    expect(source).toContain("confirmBlockedByUnexplained");
    expect(source).toContain("computeRmLineWastageAllocation");
    expect(source).toContain("shrink-0 border-t border-slate-200 bg-white");
  });
});

describe("ProductionReportWastageDetails no internal scrollbar", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionReportWastageDetails.tsx"),
    "utf8",
  );

  it("disables Add when classified and does not use wastage-rows-scroll", () => {
    expect(source).toContain("canAddWastageReason");
    expect(source).toContain("disabled={!canAddWastageReason}");
    expect(source).toContain("Required wastage:");
    expect(source).not.toContain("production-wastage-rows-scroll");
    expect(source).not.toContain("overflow-y-auto");
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
    // Post-close handler must not rewrite orphan NO_QTY Select-WO URLs.
    const closeHandler = source.slice(
      source.indexOf("const handleProductionReportConfirmed"),
      source.indexOf("const executableProductionQueueLines"),
    );
    expect(closeHandler).toContain("closedByConfirm");
    expect(closeHandler).toContain("returnToProductionWorkspaceDashboard({ refreshAfter: true })");
    expect(closeHandler).not.toContain('params.set("source", "no_qty_so")');
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
