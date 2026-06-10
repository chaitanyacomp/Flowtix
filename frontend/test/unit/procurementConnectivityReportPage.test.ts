import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pagePath = resolve(__dirname, "../../src/pages/RmProcurementConnectivityReportPage.tsx");
const pageSource = readFileSync(pagePath, "utf8");

describe("RmProcurementConnectivityReportPage structure", () => {
  it("exports page component", async () => {
    const mod = await import("../../src/pages/RmProcurementConnectivityReportPage");
    expect(typeof mod.RmProcurementConnectivityReportPage).toBe("function");
  });

  it("renders empty state test id", () => {
    expect(pageSource).toContain('data-testid="connectivity-report-empty"');
  });

  it("has responsive card layout for mobile", () => {
    expect(pageSource).toContain('data-testid="connectivity-report-cards"');
    expect(pageSource).toContain("md:hidden");
  });

  it("has desktop table layout", () => {
    expect(pageSource).toContain("hidden overflow-x-auto md:block");
  });

  it("expand row shows trace chain component", () => {
    expect(pageSource).toContain("Trace chain");
    expect(pageSource).toContain("row.traceChain");
  });

  it("filters call connectivity report API", () => {
    expect(pageSource).toContain("/api/procurement-trace/connectivity-report");
    expect(pageSource).toContain("buildConnectivityReportQuery");
  });

  it("does not add PO or GRN write actions", () => {
    expect(pageSource).not.toMatch(/createRmPo|postGrn|saveGrn|onSubmit|apiFetch\([^)]*method:\s*["']POST/i);
  });
});
