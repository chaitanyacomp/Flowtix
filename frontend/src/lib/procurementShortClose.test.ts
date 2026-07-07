import { describe, expect, it } from "vitest";
import { canOfferProcurementShortClose, poProcurementBadgeLabel } from "./procurementShortClose";

describe("procurementShortClose ux helpers", () => {
  it("offers short close only after receipt with outstanding balance", () => {
    expect(
      canOfferProcurementShortClose({ status: "PARTIAL", receivedQty: 40, outstandingQty: 60 }),
    ).toBe(true);
    expect(
      canOfferProcurementShortClose({ status: "PARTIAL", receivedQty: 0, outstandingQty: 100 }),
    ).toBe(false);
    expect(
      canOfferProcurementShortClose({ status: "COMPLETED", receivedQty: 100, outstandingQty: 0 }),
    ).toBe(false);
  });

  it("shows short closed badge label on completed PO with waived balance", () => {
    expect(
      poProcurementBadgeLabel("COMPLETED", {
        procurementClosureKind: "SHORT_CLOSED",
        procurementStatusLabel: "PARTIALLY PROCURED (SHORT CLOSED)",
        lines: [],
        totals: { requiredQty: 0, receivedQty: 0, shortClosedQty: 0, outstandingProcurement: 0 },
      }),
    ).toBe("PARTIALLY PROCURED (SHORT CLOSED)");
  });
});
