import { describe, expect, it } from "vitest";

import {
  PRODUCTION_CLOSE_RETURN_DELAY_MS,
  PRODUCTION_REPORT_CLOSE_SUCCESS_TOAST,
  PRODUCTION_WORKSPACE_DASHBOARD_HREF,
  buildPostProductionReportCloseHref,
  buildProductionCloseSuccessToast,
  resolveProductionCloseNavigationOrigin,
  shouldRedirectLegacyOrphanNoQtyProductionSearch,
} from "../../src/lib/productionCloseCompletionUx";

describe("productionCloseCompletionUx", () => {
  it("builds success toast for carry-forward close", () => {
    const toast = buildProductionCloseSuccessToast("CARRY_FORWARD");
    expect(toast).toContain(PRODUCTION_REPORT_CLOSE_SUCCESS_TOAST);
    expect(toast).toContain("carried forward");
  });

  it("uses the primary close message for full complete", () => {
    expect(buildProductionCloseSuccessToast("COMPLETE")).toBe(PRODUCTION_REPORT_CLOSE_SUCCESS_TOAST);
  });

  it("uses production workspace dashboard route and delay constants", () => {
    expect(PRODUCTION_WORKSPACE_DASHBOARD_HREF).toBe("/production");
    expect(PRODUCTION_CLOSE_RETURN_DELAY_MS).toBe(2000);
  });

  it("resolves navigation origin from URL hints", () => {
    expect(resolveProductionCloseNavigationOrigin({ from: "pending-actions" })).toBe("pending-actions");
    expect(resolveProductionCloseNavigationOrigin({ from: "execution-register", source: "no_qty_execution" })).toBe(
      "no-qty-execution",
    );
  });

  it("routes post-close to Ready to Start card workspace", () => {
    expect(buildPostProductionReportCloseHref()).toBe(
      "/production?productionBucket=readyToStart&pwSection=ready",
    );
  });

  it("preserves Pending Actions return on post-close", () => {
    expect(
      buildPostProductionReportCloseHref({ from: "pending-actions", returnTo: "pending-actions" }),
    ).toBe(
      "/production?productionBucket=readyToStart&pwSection=ready&from=pending-actions&returnTo=pending-actions",
    );
  });

  it("never returns NO_QTY guided Select-WO URLs after close", () => {
    const href = buildPostProductionReportCloseHref({ source: "no_qty_so" });
    expect(href).not.toContain("source=no_qty_so");
    expect(href).not.toContain("flow=NO_QTY");
    expect(href).not.toContain("salesOrderId=");
    expect(href).not.toContain("workOrderId=");
  });

  it("detects orphan NO_QTY query that would render legacy Select-WO", () => {
    expect(shouldRedirectLegacyOrphanNoQtyProductionSearch("source=no_qty_so&flow=NO_QTY")).toBe(true);
    expect(shouldRedirectLegacyOrphanNoQtyProductionSearch("source=no_qty_so&salesOrderId=12")).toBe(false);
    expect(shouldRedirectLegacyOrphanNoQtyProductionSearch("workOrderId=9&flow=NO_QTY")).toBe(false);
    expect(shouldRedirectLegacyOrphanNoQtyProductionSearch("productionBucket=readyToStart")).toBe(false);
  });
});
