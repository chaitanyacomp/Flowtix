import { describe, expect, it } from "vitest";
import { flattenOrderablePurchaseRequestLines, formatPurchaseRequestPoError } from "../../src/lib/purchaseRequestPoSync";

describe("flattenOrderablePurchaseRequestLines", () => {
  it("only includes lines with canOrder true", () => {
    const rows = flattenOrderablePurchaseRequestLines([
      {
        id: 1,
        docNo: "PR-26-0001",
        status: "PARTIALLY_ORDERED",
        statusLabel: "Partially ordered",
        remarks: null,
        lines: [
          {
            id: 10,
            purchaseRequestId: 1,
            rmItemId: 1,
            itemName: "RM A",
            unit: "KG",
            requiredQty: 100,
            availableQty: 0,
            netRequiredQty: 100,
            orderedQty: 100,
            pendingQty: 0,
            canOrder: false,
            orderBlockReason: "PO already created for this line",
          },
          {
            id: 11,
            purchaseRequestId: 1,
            rmItemId: 2,
            itemName: "RM B",
            unit: "KG",
            requiredQty: 50,
            availableQty: 0,
            netRequiredQty: 50,
            orderedQty: 0,
            pendingQty: 50,
            canOrder: true,
          },
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(11);
  });
});

describe("formatPurchaseRequestPoError", () => {
  it("maps PR_ALREADY_ORDERED code to actionable copy", () => {
    const msg = formatPurchaseRequestPoError({
      message: "PO already created for purchase request PR-26-0001.",
      code: "PR_ALREADY_ORDERED",
    });
    expect(msg).toContain("PO already created");
  });
});
