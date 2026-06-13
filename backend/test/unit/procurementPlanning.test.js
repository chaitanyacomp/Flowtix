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
  it("returns qty not yet allocated to any purchase request", () => {
    const line = { id: 1, shortageQty: 5000, requiredQty: 5000 };
    const totalPr = new Map([[1, 1500]]);
    assert.equal(remainingAfterPurchaseRequests(line, totalPr), 3500);
  });

  it("June 2026 rev5 PP delta not on PR", () => {
    const line = { id: 1, shortageQty: 330.87, requiredQty: 330.87 };
    const totalPr = new Map([[1, 185.61]]);
    assert.equal(remainingAfterPurchaseRequests(line, totalPr), 145.26);
  });

  it("June 2026 rev5 Powder delta not on PR", () => {
    const line = { id: 2, shortageQty: 10.25, requiredQty: 10.25 };
    const totalPr = new Map([[2, 5.75]]);
    assert.equal(remainingAfterPurchaseRequests(line, totalPr), 4.5);
  });

  it("qtyToNumber handles strings", () => {
    assert.equal(qtyToNumber("12.5"), 12.5);
  });
});
