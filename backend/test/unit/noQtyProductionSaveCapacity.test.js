const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveRmSupportedEntryCapacity,
} = require("../../src/services/productionRmReadinessService");

describe("NO_QTY Save Production RM capacity", () => {
  it("allows 2175 when RM-supported capacity is 2200", () => {
    const capacity = resolveRmSupportedEntryCapacity({
      productionAllowedNowQty: 2200,
      otherUnapprovedQty: 0,
    });

    assert.equal(capacity.remainingQty, 2200);
    assert.ok(2175 <= capacity.remainingQty);
  });

  it("subtracts other draft reservations once", () => {
    const capacity = resolveRmSupportedEntryCapacity({
      productionAllowedNowQty: 2200,
      otherUnapprovedQty: 150,
    });

    assert.equal(capacity.remainingQty, 2050);
    assert.ok(2051 > capacity.remainingQty);
  });
});
