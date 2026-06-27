const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeRmIssueToleranceQty,
  computeMaxAllowedRmIssueQty,
  assessRmIssueQty,
  DEFAULT_MIN_KG,
  DEFAULT_PERCENT,
} = require("../../src/services/rmIssueToleranceService");

describe("rmIssueToleranceService", () => {
  it("uses max(minKg, percent × pending) for tolerance band", () => {
    assert.equal(DEFAULT_MIN_KG, 0.5);
    assert.equal(DEFAULT_PERCENT, 0.05);
    assert.equal(computeRmIssueToleranceQty(12.792), 0.64);
    assert.equal(computeRmIssueToleranceQty(2.34), 0.5);
    assert.equal(computeRmIssueToleranceQty(20), 1);
  });

  it("allows issue at pending exactly", () => {
    const result = assessRmIssueQty(12.792, 12.792);
    assert.equal(result.allowed, true);
    assert.equal(result.withinTolerance, false);
    assert.equal(result.overIssueQty, 0);
  });

  it("allows 12.792 required with 13 Kg issue within tolerance", () => {
    const result = assessRmIssueQty(13, 12.792);
    assert.equal(result.allowed, true);
    assert.equal(result.withinTolerance, true);
    assert.equal(result.overIssueQty, 0.208);
    assert.ok(result.maxAllowedQty >= 13);
  });

  it("blocks issue far above tolerance for 12.792 pending", () => {
    const result = assessRmIssueQty(20, 12.792);
    assert.equal(result.allowed, false);
    assert.equal(result.withinTolerance, false);
    assert.ok(result.overIssueQty > 7);
  });

  it("allows slightly rounded issue for 2.34 pending when within tolerance", () => {
    assert.equal(assessRmIssueQty(2.5, 2.34).allowed, true);
    assert.equal(assessRmIssueQty(2.84, 2.34).allowed, true);
    assert.equal(assessRmIssueQty(2.85, 2.34).allowed, false);
  });

  it("computes max allowed from pending and WO still-required cap", () => {
    assert.equal(computeMaxAllowedRmIssueQty(12.792), 13.432);
    assert.equal(computeMaxAllowedRmIssueQty(12.792, 10), 10.5);
  });
});
