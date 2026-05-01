/**
 * @file Production batch vs active QC totals (node --test). No DB.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getActiveQcProcessedTotal,
  assertProducedQtyCoversActiveQc,
} = require("../src/services/productionEntryIntegrity");

describe("productionEntryIntegrity", () => {
  it("getActiveQcProcessedTotal ignores reversed QC rows", () => {
    const rows = [
      { reversedAt: null, acceptedQty: 3, rejectedQty: 1 },
      { reversedAt: new Date("2026-01-01"), acceptedQty: 99, rejectedQty: 99 },
    ];
    assert.equal(getActiveQcProcessedTotal(rows), 4);
  });

  it("assertProducedQtyCoversActiveQc throws when produced below active QC total", () => {
    assert.throws(
      () =>
        assertProducedQtyCoversActiveQc(
          2,
          [{ reversedAt: null, acceptedQty: 3, rejectedQty: 0 }],
        ),
      /cannot be less than/,
    );
  });

  it("assertProducedQtyCoversActiveQc passes when produced covers active QC", () => {
    assertProducedQtyCoversActiveQc(10, [
      { reversedAt: null, acceptedQty: 3, rejectedQty: 1 },
    ]);
  });
});
