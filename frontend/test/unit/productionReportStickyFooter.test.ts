import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  shouldHideOperationalPanelsInProductionReportMode,
  shouldShowProductionWorkspaceCompactLayout,
} from "../../src/lib/productionWorkspaceCompactUx";

describe("ProductionReportPanel header close action", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionReportPanel.tsx"),
    "utf8",
  );

  it("places Confirm Report & Close WO in the sticky report header (not a bottom duplicate)", () => {
    expect(source).toContain('data-testid="production-report-header"');
    expect(source).toContain('data-testid="production-report-header-actions"');
    expect(source).toContain('data-testid="production-report-header-status"');
    expect(source).toContain('data-testid="confirm-report-close-wo-btn"');
    expect(source).toContain("sticky top-0");
    expect(source).not.toContain('data-testid="production-report-sticky-footer"');
    expect(source).not.toContain('data-testid="production-report-footer-status"');

    const headerBlock = source.slice(
      source.indexOf('data-testid="production-report-header"'),
      source.indexOf('data-testid="production-report-scroll-body"'),
    );
    expect(headerBlock).toContain("{confirmButton}");
    expect(headerBlock).toContain("{headerReadinessText}");
    expect(headerBlock).toContain("production-report-header-actions");
    expect(headerBlock).toContain("Mandatory");

    const scrollBodyBlock = source.slice(
      source.indexOf('data-testid="production-report-scroll-body"'),
      source.indexOf("/* Non-compact"),
    );
    expect(scrollBodyBlock).toContain("ProductionReportWastageDetails");
    expect(scrollBodyBlock).toContain("{remarksField}");
    expect(scrollBodyBlock).not.toContain("{confirmButton}");
    expect(scrollBodyBlock).toContain("scrollableRows={false}");
  });

  it("keeps enable rules and shows exact reconciliation blocker nearby", () => {
    expect(source).toContain("confirmBlockedByUnexplained");
    expect(source).toContain("confirmBlockedByWastage");
    expect(source).toContain("disabled={saving || confirmBlocked}");
    expect(source).toContain("if (!report || saving) return");
    expect(source).toContain("Ready to close");
    expect(source).toContain("headerReadinessText");
    expect(source).toContain("is still unreconciled. Return it or classify it as wastage.");
  });

  it("uses compact viewport workbench labels and remaining-unreconciled terminology", () => {
    expect(source).toContain("production-report-header");
    expect(source).toContain("production-report-rm-zone");
    expect(source).toContain("Remaining Unreconciled");
    expect(source).toContain("Classified Wastage");
    expect(source).toContain("Expected Runner");
    expect(source).toContain("computeRmLineWastageAllocation");
    expect(source).toContain("production-report-recovered-draft");
  });
});

describe("ProductionReportWastageDetails — no nested scroll in Report Mode", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionReportWastageDetails.tsx"),
    "utf8",
  );

  it("supports non-scrolling wastage rows when scrollableRows is false", () => {
    expect(source).toContain("canAddWastageReason");
    expect(source).toContain("disabled={!canAddWastageReason}");
    expect(source).toContain("Required wastage:");
    expect(source).toContain('data-testid={scrollableRows ? "production-wastage-rows-scroll" : "production-wastage-rows"}');
  });
});

describe("ProductionWorkspaceCompactPanel Report Mode", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionWorkspaceCompactPanel.tsx"),
    "utf8",
  );

  it("renders compact WO identity and hides operational panels in Report Mode", () => {
    expect(source).toContain('data-testid="production-no-qty-viewport-shell"');
    expect(source).toContain('data-testid="production-report-wo-identity"');
    expect(source).toContain('data-testid="production-report-mode-locked-line"');
    expect(source).toContain("Production entry locked — complete the mandatory Production Report.");
    expect(source).toContain("Intentionally omit: Production Entry, Material Ready, Recent Entries, Other Open WOs");
    expect(source).not.toContain("<ProductionNoQtyWoSummaryCard");
    expect(source).not.toContain("production-workspace-closure-panel");
    expect(source).not.toContain("ProductionOperatorOpenWoQueue");
    expect(source).not.toContain("ProductionRecentEntriesPanel");
    expect(source).not.toContain("ProductionConciseRmStatus");
  });

  it("always routes Confirm Report & Close WO through onExecutionClosed (never legacy NO_QTY advance)", () => {
    expect(source).toContain("Compact workbench always closes on confirm");
    expect(source).toContain("if (onExecutionClosed)");
  });
});

describe("ProductionPage Regular Report Mode", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/ProductionPage.tsx"), "utf8");

  it("enters dedicated REGULAR Report Mode when report is pending", () => {
    expect(source).toContain('data-testid="regular-production-report-mode"');
    expect(source).toContain("regularReportPending:");
    expect(source).toContain('orderType="REGULAR"');
    expect(source).toContain("Back to Work Orders");
    expect(source).toContain("Production report confirmed —");
  });

  it("returns to Ready to Start via buildPostProductionReportCloseHref after close", () => {
    expect(source).toContain("buildPostProductionReportCloseHref");
    expect(source).toContain("shouldRedirectLegacyOrphanNoQtyProductionSearch");
    expect(source).toContain("returnToProductionWorkspaceDashboard({ refreshAfter: true })");
  });

  it("hides generic Continue while mandatory Production Report is pending", () => {
    expect(source).toContain("shouldHideContinueWhileProductionReportPending");
    expect(source).toContain("hideContinueForProductionReport");
    expect(source).toContain("productionStageLabelForReportPending");
  });
});

describe("shouldShowProductionWorkspaceCompactLayout — REGULAR report pending", () => {
  it("activates compact Report Mode for REGULAR when report pending", () => {
    expect(
      shouldShowProductionWorkspaceCompactLayout({
        showProductionReport: true,
        workOrderId: 5,
        canOperate: true,
        navigateNoQtyContext: false,
        regularReportPending: true,
        hideNoQtyAddProductionEntry: false,
        woIdFromUrlValid: true,
        workOrderLineIdFromUrlValid: true,
      }),
    ).toBe(true);
  });

  it("does not activate Report Mode for REGULAR when report is not pending", () => {
    expect(
      shouldShowProductionWorkspaceCompactLayout({
        showProductionReport: true,
        workOrderId: 5,
        canOperate: true,
        navigateNoQtyContext: false,
        regularReportPending: false,
        hideNoQtyAddProductionEntry: false,
        woIdFromUrlValid: true,
        workOrderLineIdFromUrlValid: true,
      }),
    ).toBe(false);
  });

  it("hides operational panels when Report Mode is active", () => {
    expect(shouldHideOperationalPanelsInProductionReportMode({ reportModeActive: true })).toBe(true);
    expect(shouldHideOperationalPanelsInProductionReportMode({ reportModeActive: false })).toBe(false);
  });
});
