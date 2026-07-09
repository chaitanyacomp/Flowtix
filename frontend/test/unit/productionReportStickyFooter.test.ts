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

    const compactFooterBlock = source.slice(
      source.indexOf('data-testid="production-report-sticky-footer"'),
      source.indexOf("/* Non-compact"),
    );
    expect(compactFooterBlock).toContain("{confirmButton}");
    expect(compactFooterBlock).toContain("{wastageFooterFeedback");
    expect(compactFooterBlock).not.toContain("production-report-scroll-body");

    const scrollBodyBlock = source.slice(
      source.indexOf('data-testid="production-report-scroll-body"'),
      source.indexOf('data-testid="production-report-sticky-footer"'),
    );
    expect(scrollBodyBlock).toContain("ProductionReportWastageDetails");
    expect(scrollBodyBlock).toContain("{remarksField}");
    expect(scrollBodyBlock).not.toContain("{confirmButton}");
  });

  it("uses three-zone containment classes for compact report", () => {
    expect(source).toContain("production-report-header");
    expect(source).toContain("production-report-rm-zone");
    expect(source).toContain("shrink-0 border-t border-slate-200 bg-white");
    expect(source).toContain("fillAvailableHeight");
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
