const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  derivePlannedSetupCountFromRuns,
  deriveSetupCountByFgItemId,
  estimateProductionDurationSeconds,
  assertClientSetupCountMatchesDerived,
  assertClientPurgeCountMatchesDerived,
  normalizeProductionRunInputs,
  derivePlanningCountsFromPersistedRuns,
} = require("../../src/services/woProductionRunAllocationService");

describe("production-run count (not purge / not physical setup)", () => {
  it("counts run rows", () => {
    assert.equal(
      derivePlannedSetupCountFromRuns([{ fgItemId: 1, machineId: 10, plannedQty: 100 }]),
      1,
    );
    assert.equal(
      derivePlannedSetupCountFromRuns([
        { fgItemId: 1, machineId: 10, plannedQty: 40, runSequence: 1 },
        { fgItemId: 1, machineId: 10, plannedQty: 60, runSequence: 2 },
      ]),
      2,
    );
  });

  it("persisted purge counts come from detection flags, not row count", () => {
    const counts = derivePlanningCountsFromPersistedRuns([
      { fgItemId: 1, purgingRequired: true },
      { fgItemId: 1, purgingRequired: false },
      { fgItemId: 2, purgingRequired: true },
    ]);
    assert.equal(counts.productionRunCount, 3);
    assert.equal(counts.plannedPurgeCount, 2);
    assert.equal(counts.purgeCountByFgItemId.get(1), 1);
    assert.equal(counts.purgeCountByFgItemId.get(2), 1);
  });

  it("legacy per-FG map helper still counts rows (deprecated for purging)", () => {
    const map = deriveSetupCountByFgItemId([
      { fgItemId: 1, machineId: 10 },
      { fgItemId: 1, machineId: 11 },
      { fgItemId: 2, machineId: 10 },
    ]);
    assert.equal(map.get(1), 2);
    assert.equal(map.get(2), 1);
  });
});

describe("client setup/purge count manipulation", () => {
  it("rejects any client-submitted setup count", () => {
    assert.throws(
      () => assertClientSetupCountMatchesDerived(9, 2),
      (err) => err.statusCode === 400 && err.code === "SETUP_COUNT_NOT_DERIVED",
    );
  });

  it("allows omitted client setup count", () => {
    assert.doesNotThrow(() => assertClientSetupCountMatchesDerived(undefined, 2));
  });

  it("rejects mismatched purge count", () => {
    assert.throws(
      () => assertClientPurgeCountMatchesDerived(5, 2),
      (err) => err.code === "PURGE_COUNT_NOT_DERIVED",
    );
  });
});

describe("capacity duration preview", () => {
  it("uses FG-machine cycle time / pieces / efficiency", () => {
    const seconds = estimateProductionDurationSeconds({
      plannedQty: 950,
      cycleTimeSeconds: 10,
      piecesPerCycle: 1,
      standardEfficiencyPercent: 95,
    });
    assert.ok(seconds != null && seconds > 0);
    assert.ok(Math.abs(seconds - 10000) < 1);
  });
});

describe("normalize production run inputs", () => {
  it("rejects zero planned qty", () => {
    assert.throws(
      () =>
        normalizeProductionRunInputs([
          { fgItemId: 1, machineId: 1, plannedQty: 0, runSequence: 1 },
        ]),
      (err) => err.code === "INVALID_PRODUCTION_RUN",
    );
  });
});
