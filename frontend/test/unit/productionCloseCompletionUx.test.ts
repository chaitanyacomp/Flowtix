import { describe, expect, it } from "vitest";

import {
  PRODUCTION_CLOSE_RETURN_DELAY_MS,
  PRODUCTION_WORKSPACE_DASHBOARD_HREF,
  buildProductionCloseSuccessToast,
  resolveProductionCloseNavigationOrigin,
} from "../../src/lib/productionCloseCompletionUx";

describe("productionCloseCompletionUx", () => {
  it("builds multi-line success toast for carry-forward close", () => {
    const toast = buildProductionCloseSuccessToast("CARRY_FORWARD");
    expect(toast).toContain("Production Report submitted");
    expect(toast).toContain("Work Order closed");
    expect(toast).toContain("Remaining quantity carried forward");
  });

  it("omits carry-forward line for full complete close", () => {
    const toast = buildProductionCloseSuccessToast("COMPLETE");
    expect(toast).not.toContain("carried forward");
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
});
