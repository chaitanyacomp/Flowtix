import { describe, expect, it } from "vitest";
import {
  DEFAULT_DASHBOARD_BACK_TARGET,
  DEFAULT_REPORT_BACK_TARGET,
  resolveAnalysisReportBackTarget,
} from "../../src/components/ReportPageHeader";

describe("resolveAnalysisReportBackTarget", () => {
  it("defaults Analysis reports to Back to Reports", () => {
    expect(resolveAnalysisReportBackTarget("")).toEqual(DEFAULT_REPORT_BACK_TARGET);
    expect(resolveAnalysisReportBackTarget("?q=1")).toEqual(DEFAULT_REPORT_BACK_TARGET);
  });

  it("uses Back to Dashboard when opened from dashboard", () => {
    expect(resolveAnalysisReportBackTarget("?source=dashboard")).toEqual(DEFAULT_DASHBOARD_BACK_TARGET);
    expect(resolveAnalysisReportBackTarget("?from=dashboard")).toEqual(DEFAULT_DASHBOARD_BACK_TARGET);
  });

  it("uses Back to Reports when opened from reports hub", () => {
    expect(resolveAnalysisReportBackTarget("?from=reports")).toEqual(DEFAULT_REPORT_BACK_TARGET);
    expect(resolveAnalysisReportBackTarget("?source=reports")).toEqual(DEFAULT_REPORT_BACK_TARGET);
  });

  it("uses module default when not from reports/dashboard", () => {
    const moduleBack = { to: "/qc-entry", label: "Back to Quality Inspection Workspace" };
    expect(resolveAnalysisReportBackTarget("", moduleBack)).toEqual(moduleBack);
    expect(resolveAnalysisReportBackTarget("?from=reports", moduleBack)).toEqual(DEFAULT_REPORT_BACK_TARGET);
  });
});
