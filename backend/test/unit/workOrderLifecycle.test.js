const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  effectiveLinePlanQty,
  shouldFreezeStatusSync,
  HOLD_REASONS,
  WO_PRODUCTION_BLOCKED,
} = require("../../src/services/workOrderLifecycleService");

describe("workOrderLifecycleService", () => {
  it("effectiveLinePlanQty releases shortfall on CLOSED_WITH_SHORTFALL", () => {
    const line = { qty: "5000", shortfallQty: "2000" };
    assert.equal(effectiveLinePlanQty(line, "CLOSED_WITH_SHORTFALL"), 3000);
    assert.equal(effectiveLinePlanQty(line, "IN_PROGRESS"), 5000);
  });

  it("freezes auto status sync for HOLD, PAUSED and shortfall closed", () => {
    assert.equal(shouldFreezeStatusSync("HOLD"), true);
    assert.equal(shouldFreezeStatusSync("PAUSED"), true);
    assert.equal(shouldFreezeStatusSync("CLOSED_WITH_SHORTFALL"), true);
    assert.equal(shouldFreezeStatusSync("IN_PROGRESS"), false);
  });

  it("exports hold reasons including production pause", () => {
    assert.ok(HOLD_REASONS.includes("RM_SHORTAGE"));
    assert.ok(HOLD_REASONS.includes("MANAGEMENT_HOLD"));
    assert.ok(HOLD_REASONS.includes("PRODUCTION_PAUSE"));
  });

  it("blocks production for PAUSED status", () => {
    assert.ok(WO_PRODUCTION_BLOCKED.has("PAUSED"));
    assert.ok(!WO_PRODUCTION_BLOCKED.has("IN_PROGRESS"));
  });
});
