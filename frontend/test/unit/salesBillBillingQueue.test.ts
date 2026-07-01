import { describe, expect, it } from "vitest";
import {
  hrefForEligibleDispatch,
  pickNextEligibleDispatch,
  sortEligibleDispatches,
} from "../../src/lib/salesBillBillingQueue";

describe("salesBillBillingQueue", () => {
  it("pickNextEligibleDispatch skips current dispatch and returns FIFO next", () => {
    const rows = sortEligibleDispatches([
      { dispatchId: 10, dispatchDate: "2026-06-01", salesOrderId: 1 },
      { dispatchId: 11, dispatchDate: "2026-06-02", salesOrderId: 1 },
    ]);
    const next = pickNextEligibleDispatch(rows, { excludeDispatchId: 11 });
    expect(next?.dispatchId).toBe(10);
  });

  it("hrefForEligibleDispatch opens draft bill when present", () => {
    expect(hrefForEligibleDispatch({ dispatchId: 9, dispatchDate: "", hasDraftBill: true, draftBillId: 44 })).toBe(
      "/sales-bills/44?from=billing-queue",
    );
  });
});
