import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiRequestError } from "../../src/services/api";
import { loadPurchaseDashboardWidget, PURCHASE_WIDGET_UNAVAILABLE } from "../../src/lib/purchaseDashboardWidgets";

vi.mock("../../src/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

import { apiFetch } from "../../src/services/api";

describe("loadPurchaseDashboardWidget", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("returns ready data when the API succeeds", async () => {
    vi.mocked(apiFetch).mockResolvedValue([{ id: 1 }]);
    const result = await loadPurchaseDashboardWidget("/api/dashboard/purchase-summary", (payload) => payload as Array<{ id: number }>);
    expect(result).toEqual({ status: "ready", data: [{ id: 1 }] });
  });

  it("returns forbidden state on 403 without throwing", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiRequestError("Access denied.", 403));
    const result = await loadPurchaseDashboardWidget("/api/dashboard/accounts", (payload) => payload);
    expect(result).toEqual({ status: "forbidden", message: PURCHASE_WIDGET_UNAVAILABLE });
  });

  it("returns error state for non-403 failures", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Network down"));
    const result = await loadPurchaseDashboardWidget("/api/dashboard/accounts", (payload) => payload);
    expect(result).toEqual({ status: "error", message: "Network down" });
  });
});
