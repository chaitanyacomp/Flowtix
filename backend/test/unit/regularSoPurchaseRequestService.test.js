const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPurchaseRequestLinesFromMaterialRequirement,
  OPEN_REGULAR_SO_MR_FOR_PR_STATUSES,
} = require("../../src/services/regularSoPurchaseRequestService");
const { remainingAfterPurchaseRequests } = require("../../src/services/purchaseRequestService");

describe("regularSoPurchaseRequestService — REGULAR_SO MR → PR lines", () => {
  it("builds PR allocations from shortage remaining on SALES_ORDER MR lines", () => {
    const mr = {
      id: 10,
      sourceType: "SALES_ORDER",
      salesOrderId: 258,
      lines: [
        {
          id: 101,
          rmItemId: 7,
          requiredQty: 140,
          shortageQty: 140,
          availableQtySnapshot: 0,
          unitSnapshot: "Kg",
          rmItem: { unit: "Kg" },
        },
      ],
    };
    const allocByMrLine = new Map();
    const lines = buildPurchaseRequestLinesFromMaterialRequirement(mr, allocByMrLine);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].itemId, 7);
    assert.equal(lines[0].netRequiredQty, 140);
    assert.deepEqual(lines[0].allocations, [{ materialRequirementLineId: 101, qty: 140 }]);
  });

  it("omits lines already fully allocated to a Purchase Request (idempotent remaining)", () => {
    const line = {
      id: 101,
      rmItemId: 7,
      requiredQty: 140,
      shortageQty: 140,
      availableQtySnapshot: 0,
    };
    const allocByMrLine = new Map([[101, 140]]);
    assert.equal(remainingAfterPurchaseRequests(line, allocByMrLine), 0);
    const lines = buildPurchaseRequestLinesFromMaterialRequirement(
      { id: 10, lines: [line] },
      allocByMrLine,
    );
    assert.equal(lines.length, 0);
  });

  it("keeps APPROVED/SENT_TO_PURCHASE as open statuses for Regular SO PR handoff", () => {
    assert.ok(OPEN_REGULAR_SO_MR_FOR_PR_STATUSES.includes("APPROVED"));
    assert.ok(OPEN_REGULAR_SO_MR_FOR_PR_STATUSES.includes("SENT_TO_PURCHASE"));
    assert.equal(OPEN_REGULAR_SO_MR_FOR_PR_STATUSES.includes("CLOSED"), false);
  });
});
