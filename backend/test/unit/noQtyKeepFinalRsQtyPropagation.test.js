const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveNoQtyWoExecutableQty } = require("../../src/services/noQtyWoQtyService");
const { buildRsBalanceLinesFromSheet } = require("../../src/services/requirementSheetExecutionService");
const { lineProductionRequirement } = require("../../src/services/monthlyPlanningRsSuggestionsService");

/**
 * Phase 2B Keep propagation: locked Final RS Qty (1025) must drive execution + planning.
 * Waive stays at customer demand (1000).
 */
describe("Phase 2B Keep Final RS Qty propagation", () => {
  const keptLockedLine = {
    itemId: 1,
    requirementQty: 1000,
    baseDemandQty: 1000,
    productionShortfallQty: 20,
    qcRejectionRecoveryQty: 5,
    totalRsQty: 1025,
    suggestedWoQtySnapshot: 1025,
    shortfallQtySnapshot: 20,
    item: { itemName: "FG-X" },
  };

  const waivedLockedLine = {
    itemId: 1,
    requirementQty: 1000,
    baseDemandQty: 1000,
    productionShortfallQty: 0,
    qcRejectionRecoveryQty: 0,
    totalRsQty: 1000,
    suggestedWoQtySnapshot: 1000,
    shortfallQtySnapshot: 0,
    item: { itemName: "FG-X" },
  };

  it("Keep: executable / RS balance / MP production need are 1025 (not base 1000)", () => {
    assert.equal(resolveNoQtyWoExecutableQty(keptLockedLine), 1025);

    const { lines, totals } = buildRsBalanceLinesFromSheet({ lines: [keptLockedLine] }, new Map());
    assert.equal(lines[0].rsDemandQty, 1025);
    assert.equal(lines[0].rsBalanceQty, 1025);
    assert.equal(totals.rsDemandQty, 1025);

    const mp = lineProductionRequirement(keptLockedLine);
    assert.equal(mp.productionRequirementQty, 1025);
    assert.equal(mp.scheduleQty, 1000, "schedule/base remains customer demand");
  });

  it("Keep: RS balance after partial WO placement uses 1025 ceiling", () => {
    const placed = new Map([[1, 25]]);
    const { lines } = buildRsBalanceLinesFromSheet({ lines: [keptLockedLine] }, placed);
    assert.equal(lines[0].rsDemandQty, 1025);
    assert.equal(lines[0].woPlacedQty, 25);
    assert.equal(lines[0].rsBalanceQty, 1000);
  });

  it("Waive: executable / RS balance / MP remain 1000", () => {
    assert.equal(resolveNoQtyWoExecutableQty(waivedLockedLine), 1000);
    const { lines, totals } = buildRsBalanceLinesFromSheet({ lines: [waivedLockedLine] }, new Map());
    assert.equal(lines[0].rsDemandQty, 1000);
    assert.equal(totals.rsDemandQty, 1000);
    assert.equal(lineProductionRequirement(waivedLockedLine).productionRequirementQty, 1000);
  });

  it("does not double-count recovery when totalRsQty already includes PS+QC", () => {
    const qty = resolveNoQtyWoExecutableQty(keptLockedLine);
    assert.equal(qty, 1025);
    assert.notEqual(qty, 1000 + 20 + 5 + 20 + 5);
  });
});
