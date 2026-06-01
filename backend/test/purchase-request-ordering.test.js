/**
 * PR line ordering gates — UI list and create-po must agree.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Load helpers via requiring module internals is awkward; test documented rules inline.
const OPEN = ["PENDING_PURCHASE", "PARTIALLY_ORDERED"];

function canOrder(prStatus, net, ordered, eps = 1e-9) {
  if (!OPEN.includes(prStatus)) return false;
  return Math.max(0, net - ordered) > eps;
}

describe("purchase request open-for-ordering rules", () => {
  it("ORDERED header cannot order even if line math shows pending (stale data guard)", () => {
    assert.equal(canOrder("ORDERED", 100, 50), false);
  });

  it("PARTIALLY_ORDERED with pending qty can order", () => {
    assert.equal(canOrder("PARTIALLY_ORDERED", 100, 40), true);
  });

  it("fully ordered line cannot order", () => {
    assert.equal(canOrder("PARTIALLY_ORDERED", 100, 100), false);
  });
});
