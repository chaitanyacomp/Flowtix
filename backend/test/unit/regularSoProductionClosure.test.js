const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateRegularSoLineDemandCoverage,
} = require("../../src/services/regularSoProductionClosure");

describe("regularSoProductionClosure", () => {
  it("SO 10000 / WO 10100 / Produced 10087 — SO covered, WO remainder not mandatory", () => {
    const c = evaluateRegularSoLineDemandCoverage({
      soDemandQty: 10000,
      producedOnOtherWos: 0,
      producedOnThisWo: 10087,
      woPlannedQty: 10100,
    });
    assert.equal(c.soDemandCovered, true);
    assert.equal(c.woPlanMet, false);
    assert.equal(c.productionObligationMet, true);
    assert.equal(c.hasSoShortage, false);
    assert.equal(c.canEndProductionWithWoRemainder, true);
    assert.equal(c.woTargetBalance, 13);
    assert.equal(c.expectedExcessBeforeQc, 87);
    assert.equal(c.soShortageQty, 0);
  });

  it("produced below SO demand — shortage path, not WO-plan-only shortfall", () => {
    const c = evaluateRegularSoLineDemandCoverage({
      soDemandQty: 10000,
      producedOnOtherWos: 0,
      producedOnThisWo: 9000,
      woPlannedQty: 10100,
    });
    assert.equal(c.soDemandCovered, false);
    assert.equal(c.productionObligationMet, false);
    assert.equal(c.hasSoShortage, true);
    assert.equal(c.soShortageQty, 1000);
    assert.equal(c.woTargetBalance, 1100);
    assert.equal(c.canEndProductionWithWoRemainder, false);
  });

  it("accounts for other WO produced qty when computing remaining SO demand", () => {
    const c = evaluateRegularSoLineDemandCoverage({
      soDemandQty: 10000,
      producedOnOtherWos: 4000,
      producedOnThisWo: 6000,
      woPlannedQty: 6100,
    });
    assert.equal(c.remainingSoDemand, 6000);
    assert.equal(c.soDemandCovered, true);
    assert.equal(c.expectedExcessBeforeQc, 0);
    assert.equal(c.productionObligationMet, true);
  });

  it("WO plan met without SO excess still completes obligation", () => {
    const c = evaluateRegularSoLineDemandCoverage({
      soDemandQty: 10000,
      producedOnOtherWos: 0,
      producedOnThisWo: 10100,
      woPlannedQty: 10100,
    });
    assert.equal(c.woPlanMet, true);
    assert.equal(c.soDemandCovered, true);
    assert.equal(c.productionObligationMet, true);
    assert.equal(c.canEndProductionWithWoRemainder, false);
    assert.equal(c.expectedExcessBeforeQc, 100);
  });
});
