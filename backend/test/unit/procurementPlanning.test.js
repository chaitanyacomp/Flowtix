const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeNetToBuy, QUEUE_EPS } = require("../../src/services/procurementPlanningService");
const { remainingAfterPurchaseRequests } = require("../../src/services/purchaseRequestService");
const { qtyToNumber } = require("../../src/services/rmPurchaseHelpers");

describe("procurementPlanningService helpers", () => {
  it("computeNetToBuy ignores open PO qty until allocation exists", () => {
    assert.equal(computeNetToBuy(6000, 2000), 6000);
    assert.equal(computeNetToBuy(1000, 1500), 1000);
  });

  it("QUEUE_EPS is small positive", () => {
    assert.ok(QUEUE_EPS > 0 && QUEUE_EPS < 0.01);
  });
});

describe("remainingAfterPurchaseRequests", () => {
  it("subtracts procured and pending purchase request alloc", () => {
    const line = { id: 1, shortageQty: 5000, procuredQty: 1000 };
    const pending = new Map([[1, 1500]]);
    assert.equal(remainingAfterPurchaseRequests(line, pending), 2500);
  });

  it("qtyToNumber handles strings", () => {
    assert.equal(qtyToNumber("12.5"), 12.5);
  });
});
