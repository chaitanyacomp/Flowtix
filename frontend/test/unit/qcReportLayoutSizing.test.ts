import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("QcReportPage — layout sizing (report chrome)", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/QcReportPage.tsx"), "utf8");

  it("uses ReportPageShell / Report chrome instead of erp-flow-page density", () => {
    expect(source).toContain("ReportPageShell");
    expect(source).toContain("ReportPageHeader");
    expect(source).toContain("ReportFilterToolbar");
    expect(source).toContain("ReportKpiStrip");
    expect(source).toContain("ReportEmptyState");
    expect(source).toContain("ReportTableShell");
    expect(source).not.toContain("erp-flow-page");
    expect(source).not.toContain("StickyWorkspaceHead");
    expect(source).not.toContain('className="erp-flow-page');
  });

  it("restores standard readable table/control sizing", () => {
    expect(source).toContain("erp-table w-full border-collapse text-sm");
    expect(source).toContain("px-3 py-2");
    expect(source).toContain('className="h-8 text-xs"');
    expect(source).not.toContain("px-1.5 py-1");
    expect(source).not.toContain('className="h-7 text-[11px]"');
    expect(source).not.toContain('text-[12px] text-slate-600">{rows.length}');
    expect(source).not.toContain("transform: scale");
    expect(source).not.toContain("zoom:");
    expect(source).not.toContain("scale(");
  });

  it("keeps a properly sized empty state", () => {
    expect(source).toContain("ReportEmptyState");
    expect(source).toContain("No QC records found");
    expect(source).toContain('className="py-8"');
  });
});
