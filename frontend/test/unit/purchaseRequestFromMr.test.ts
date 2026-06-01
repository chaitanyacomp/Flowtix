import { describe, expect, it } from "vitest";
import { buildPurchaseRequestPayloadFromMr } from "../../src/lib/purchaseRequestFromMr";

describe("buildPurchaseRequestPayloadFromMr", () => {
  it("groups MR lines by RM item with matching net and allocations", () => {
    const payload = buildPurchaseRequestPayloadFromMr({
      materialRequirementId: 1,
      docNo: "MR-26-0001",
      lines: [
        {
          lineId: 10,
          rmItemId: 100,
          itemName: "Steel",
          unit: "KG",
          requiredQty: 50,
          shortageQty: 50,
          remainingQty: 40,
        },
        {
          lineId: 11,
          rmItemId: 100,
          itemName: "Steel",
          unit: "KG",
          requiredQty: 10,
          shortageQty: 10,
          remainingQty: 5,
        },
      ],
    });

    expect(payload).not.toBeNull();
    expect(payload!.lines).toHaveLength(1);
    const line = payload!.lines[0];
    expect(line.itemId).toBe(100);
    expect(line.netRequiredQty).toBe(45);
    expect(line.allocations).toHaveLength(2);
    expect(line.allocations.reduce((s, a) => s + a.qty, 0)).toBe(45);
  });

  it("returns null when no remaining qty", () => {
    expect(
      buildPurchaseRequestPayloadFromMr({
        materialRequirementId: 2,
        docNo: null,
        lines: [{ lineId: 1, rmItemId: 1, itemName: "X", unit: "", requiredQty: 1, shortageQty: 1, remainingQty: 0 }],
      }),
    ).toBeNull();
  });
});
