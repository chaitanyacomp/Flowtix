import { describe, expect, it } from "vitest";
import {
  buildReportHref,
  buildReportQuery,
  formatVarianceQty,
  rowStatusTone,
} from "../../src/lib/rmPlanningVsReceivedReportUx";

describe("rmPlanningVsReceivedReportUx", () => {
  it("buildReportQuery encodes filters", () => {
    const qs = buildReportQuery({
      periodKey: "2026-05",
      rmItemId: "12",
      procurementSource: "MONTHLY_PLAN",
      supplierId: "",
      status: "OVER_RECEIVED",
    });
    expect(qs).toContain("periodKey=2026-05");
    expect(qs).toContain("rmItemId=12");
    expect(qs).toContain("procurementSource=MONTHLY_PLAN");
    expect(qs).toContain("status=OVER_RECEIVED");
  });

  it("buildReportHref points to report route with period", () => {
    expect(buildReportHref("2026-05")).toBe(
      "/reports/rm-planning-vs-actual?periodKey=2026-05&procurementSource=MONTHLY_PLAN",
    );
  });

  it("formatVarianceQty prefixes positive values", () => {
    expect(formatVarianceQty(14.39, "Kg")).toBe("+14.39 Kg");
  });

  it("rowStatusTone maps over-received styling", () => {
    expect(rowStatusTone("OVER_RECEIVED")).toContain("sky");
  });
});
