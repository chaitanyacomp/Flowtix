import { describe, expect, it, vi } from "vitest";
import { refreshSalesBillCustomerDetails } from "./salesBillCustomerRefresh";

describe("refreshSalesBillCustomerDetails", () => {
  it("posts the refresh and immediately reloads the displayed bill", async () => {
    const reloaded = {
      id: 183,
      billToAddressSnapshot: "hinjawadi",
      shipToLabelSnapshot: "Goa Plant",
      posStateCodeSnapshot: "30",
      gstMode: "INTERSTATE",
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ id: 183 })
      .mockResolvedValueOnce(reloaded);

    await expect(refreshSalesBillCustomerDetails(183, fetcher)).resolves.toEqual(reloaded);
    expect(fetcher.mock.calls).toEqual([
      ["/api/sales-bills/183/refresh-customer-details", { method: "POST" }],
      ["/api/sales-bills/183"],
    ]);
  });
});
