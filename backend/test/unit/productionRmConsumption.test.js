const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  calcVariance,
  RM_CONSUMPTION_WARN_PCT,
  RM_CONSUMPTION_ROUNDING_TOLERANCE_KG,
  assessRmConsumptionShortage,
  roundingToleranceWarningMessage,
} = require("../../src/services/productionRmConsumptionService");

describe("productionRmConsumptionService", () => {
  it("calcVariance: actual 104 vs standard 100", () => {
    const { varianceQty, variancePercent } = calcVariance(100, 104);
    assert.equal(varianceQty, 4);
    assert.equal(variancePercent, 4);
  });

  it("calcVariance: actual 95 vs standard 100", () => {
    const { varianceQty, variancePercent } = calcVariance(100, 95);
    assert.equal(varianceQty, -5);
    assert.equal(variancePercent, -5);
  });

  it("warn threshold default is 5%", () => {
    assert.equal(RM_CONSUMPTION_WARN_PCT, 0.05);
    const warnAt = 100 * (1 + RM_CONSUMPTION_WARN_PCT);
    assert.equal(warnAt, 105);
    assert.ok(104 <= warnAt);
    assert.ok(106 > warnAt);
  });

  it("rounding tolerance default is 0.01 Kg", () => {
    assert.equal(RM_CONSUMPTION_ROUNDING_TOLERANCE_KG, 0.01);
  });

  it("assessRmConsumptionShortage: WO-26-0001 PP batch 2 drift", () => {
    const check = assessRmConsumptionShortage(2.017, 2.018);
    assert.equal(check.blocked, false);
    assert.equal(check.withinTolerance, true);
    assert.equal(check.shortage, 0.001);
    assert.equal(
      roundingToleranceWarningMessage(check.shortage, "Kg"),
      "Allowed due to rounding tolerance: shortage 0.001 Kg",
    );
  });

  it("assessRmConsumptionShortage: blocks when shortage exceeds tolerance", () => {
    const check = assessRmConsumptionShortage(2, 2.02);
    assert.equal(check.blocked, true);
    assert.equal(check.withinTolerance, false);
    assert.equal(check.shortage, 0.02);
  });

  it("assessRmConsumptionShortage: allows when actual equals available", () => {
    const check = assessRmConsumptionShortage(2.018, 2.018);
    assert.equal(check.blocked, false);
    assert.equal(check.withinTolerance, false);
    assert.equal(check.shortage, 0);
  });
});
