import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../../src/pages/store/StoreDispatchDashboard.tsx"),
  "utf8",
);

describe("StoreDispatchDashboard navigation presentation", () => {
  it("does not render an Operations tab or GRN-only chip", () => {
    expect(source).not.toContain("store-tab-operations");
    expect(source).not.toContain(">Operations</");
    expect(source).not.toContain("store-quick-grn");
    expect(source).toContain("Procurement & GRN");
    expect(source).toContain("store-quick-procurement-grn");
  });

  it("activates only the selected workspace tab (Production Monitor)", () => {
    expect(source).toContain('tier={active ? "primary" : "tertiary"}');
    expect(source).toContain("isStoreWorkspaceTabActive");
    expect(source).not.toMatch(/tier="primary"\s*\n\s*className="gap-1\.5"/);
  });

  it("removes duplicate Pending RS card and empty-state cards when gated", () => {
    expect(source).not.toContain('data-testid="store-pending-rs"');
    expect(source).toContain("shouldShowStoreRmccSection");
    expect(source).toContain("shouldShowStoreDispatchReadySection");
    expect(source).toContain("shouldShowStorePrepareHeadroomSection");
    expect(source).toContain("NoQtyDashboardCompactPanel");
  });

  it("keeps role-critical workspace destinations", () => {
    expect(source).toContain("store-quick-no-qty-execution");
    expect(source).toContain("store-quick-rmcc");
    expect(source).toContain("store-quick-material-issue");
    expect(source).toContain("store-quick-production-monitor");
    expect(source).toContain("store-quick-dispatch");
    expect(source).toContain("store-quick-stock");
  });
});
