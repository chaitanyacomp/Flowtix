const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  parsePlannedSetupCount,
  computePurgingRmForFg,
  mergePurgingIntoRmNeeded,
  snapshotProductionRmMap,
  rmSupportedProductionQtyAfterPurging,
  round3,
} = require("../../src/services/bomPurgingRmPlanningService");

describe("parsePlannedSetupCount", () => {
  it("defaults blank to 1 for new work orders", () => {
    assert.equal(parsePlannedSetupCount(null), 1);
    assert.equal(parsePlannedSetupCount(""), 1);
    assert.equal(parsePlannedSetupCount(undefined), 1);
  });

  it("accepts whole numbers >= 1", () => {
    assert.equal(parsePlannedSetupCount(1), 1);
    assert.equal(parsePlannedSetupCount("3"), 3);
  });

  it("rejects zero, negative, decimals, malformed, NaN and infinite values", () => {
    for (const bad of [0, -1, 1.5, "2.5", "abc", "1e2", NaN, Infinity]) {
      assert.throws(() => parsePlannedSetupCount(bad, { allowDefault: false }), (err) => err.statusCode === 400);
    }
  });
});

describe("purging RM calculation and allocation", () => {
  const mockBom = {
    fgWeight: "100",
    fgWeightUnit: { unitCode: "gram", unitName: "Gram" },
    outputQty: "1",
    runnerWeight: "0",
    standardPurgingQtyGrams: "200",
    normalizationMode: "PER_PIECE",
    lines: [
      {
        baseQty: "0.06",
        rmItem: { id: 10, itemType: "RM", itemName: "PP Natural" },
      },
      {
        baseQty: "0.04",
        rmItem: { id: 11, itemType: "RM", itemName: "Masterbatch" },
      },
    ],
  };

  const tx = {
    bom: {
      findFirst: async () => mockBom,
    },
  };

  it("computes total planned purging as standard × setup count", async () => {
    const one = await computePurgingRmForFg(tx, 100, 1);
    assert.equal(one.standardPurgingQtyGramsPerSetup, 200);
    assert.equal(one.totalPlannedPurgingGrams, 200);
    assert.equal(one.totalPlannedPurgingKg, 0.2);

    const three = await computePurgingRmForFg(tx, 100, 3);
    assert.equal(three.totalPlannedPurgingGrams, 600);
    assert.equal(three.totalPlannedPurgingKg, 0.6);
  });

  it("returns zero purging RM when BOM standard is zero", async () => {
    const zeroBom = { ...mockBom, standardPurgingQtyGrams: "0" };
    const txZero = { bom: { findFirst: async () => zeroBom } };
    const result = await computePurgingRmForFg(txZero, 100, 5);
    assert.equal(result.totalPlannedPurgingGrams, 0);
    assert.equal(result.purgingRmByItemId.size, 0);
  });

  it("allocates purging across multiple RM components and reconciles total", async () => {
    const purge = await computePurgingRmForFg(tx, 100, 3);
    const sum = round3([...purge.purgingRmByItemId.values()].reduce((s, v) => s + v, 0));
    assert.equal(sum, 0.6);
    assert.equal(purge.purgingRmByItemId.get(10), 0.36);
    assert.equal(purge.purgingRmByItemId.get(11), 0.24);
  });

  it("merges purging into production RM without changing production-only snapshot", () => {
    const rmNeeded = new Map([[10, 10], [11, 5]]);
    const production = snapshotProductionRmMap(rmNeeded);
    mergePurgingIntoRmNeeded(rmNeeded, new Map([[10, 0.36], [11, 0.24]]));
    assert.equal(production.get(10), 10);
    assert.equal(rmNeeded.get(10), 10.36);
    assert.equal(rmNeeded.get(11), 5.24);
  });

  it("reduces RM-supported production capacity after reserving purging RM", () => {
    const perFg = 0.014;
    const withoutPurging = rmSupportedProductionQtyAfterPurging({
      freeStockKg: 211,
      productionTheoreticalRmKg: 211,
      woTargetQty: 15075,
      purgingRmKg: 0,
    });
    const withPurging = rmSupportedProductionQtyAfterPurging({
      freeStockKg: 211,
      productionTheoreticalRmKg: 211,
      woTargetQty: 15075,
      purgingRmKg: 0.6,
    });
    assert.ok(withPurging < withoutPurging);
    assert.equal(withoutPurging, Math.floor(211 / (211 / 15075)));
  });
});

describe("existing work orders retain stored setup count via parse default", () => {
  it("does not coerce stored WO value through migration default semantics", () => {
    assert.equal(parsePlannedSetupCount(1), 1);
    assert.equal(parsePlannedSetupCount(4), 4);
  });

  it("legacy plannedSetupCount values never equal plannedPurgeCount for RM calc", async () => {
    const mockBom = {
      fgWeight: "100",
      fgWeightUnit: { unitCode: "gram", unitName: "Gram" },
      outputQty: "1",
      runnerWeight: "0",
      standardPurgingQtyGrams: "100",
      normalizationMode: "PER_PIECE",
      lines: [{ baseQty: "0.1", rmItem: { id: 10, itemType: "RM", itemName: "RM" } }],
    };
    const tx = { bom: { findFirst: async () => mockBom } };
    const {
      buildPurgingPlanningSummary,
      resolvePurgeCountForFg,
    } = require("../../src/services/bomPurgingRmPlanningService");

    for (const legacySetup of [1, 2, 5, 9]) {
      assert.equal(
        resolvePurgeCountForFg({ plannedSetupCount: legacySetup }, 42),
        0,
        `plannedSetupCount=${legacySetup} must not become purge count`,
      );
      const summary = await buildPurgingPlanningSummary(tx, [{ fgItemId: 42 }], {
        plannedSetupCount: legacySetup,
      });
      assert.equal(summary.plannedPurgeCount, 0);
      assert.equal(summary.totalPlannedPurgingGrams, 0);
      assert.equal(summary.purgingRmByItemId.size, 0);
    }
  });
});
