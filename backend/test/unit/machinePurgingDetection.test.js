const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  fingerprintFromComponents,
  profilesEqual,
  buildPurgingProfileForFg,
} = require("../../src/services/bomPurgingProfileService");

const {
  detectPurgingForTransition,
  detectPhysicalSetupForRun,
  derivePlanningCountsFromDetectedRuns,
  MATERIAL_STATE,
  PURGING_DETECTION,
  PHYSICAL_SETUP_DETECTION,
} = require("../../src/services/machineMaterialStateService");

const {
  assertClientSetupCountMatchesDerived,
  assertClientPurgeCountMatchesDerived,
} = require("../../src/services/woProductionRunAllocationService");

const { computePurgingRmForFg } = require("../../src/services/bomPurgingRmPlanningService");

describe("purging profile fingerprint", () => {
  it("same RM + same mix % → same fingerprint (FG identity ignored)", () => {
    const a = fingerprintFromComponents([
      { rmItemId: 10, mixPercent: 60 },
      { rmItemId: 11, mixPercent: 40 },
    ]);
    const b = fingerprintFromComponents([
      { rmItemId: 11, mixPercent: 40 },
      { rmItemId: 10, mixPercent: 60 },
    ]);
    assert.equal(a, b);
    assert.ok(profilesEqual(a, b));
  });

  it("different RM item (colour/additive) → different fingerprint", () => {
    const natural = fingerprintFromComponents([
      { rmItemId: 10, mixPercent: 98 },
      { rmItemId: 20, mixPercent: 2 },
    ]);
    const colour = fingerprintFromComponents([
      { rmItemId: 10, mixPercent: 98 },
      { rmItemId: 21, mixPercent: 2 },
    ]);
    assert.notEqual(natural, colour);
  });

  it("different mix percentage → different fingerprint", () => {
    const a = fingerprintFromComponents([
      { rmItemId: 10, mixPercent: 90 },
      { rmItemId: 11, mixPercent: 10 },
    ]);
    const b = fingerprintFromComponents([
      { rmItemId: 10, mixPercent: 85 },
      { rmItemId: 11, mixPercent: 15 },
    ]);
    assert.notEqual(a, b);
  });

  it("nested SFG explosion yields leaf RM profile", async () => {
    const sfgBom = {
      fgWeight: "1",
      fgWeightUnit: { unitCode: "kg" },
      outputQty: "1",
      normalizationMode: "PER_PIECE",
      lines: [
        { mixPercent: "70", baseQty: "0.7", rmItem: { id: 10, itemType: "RM" } },
        { mixPercent: "30", baseQty: "0.3", rmItem: { id: 11, itemType: "RM" } },
      ],
    };
    const fgBom = {
      fgWeight: "1",
      fgWeightUnit: { unitCode: "kg" },
      outputQty: "1",
      normalizationMode: "PER_PIECE",
      lines: [{ mixPercent: "100", baseQty: "1", rmItem: { id: 50, itemType: "SFG" } }],
    };
    const tx = {
      bom: {
        findFirst: async ({ where }) => {
          const id = where?.fgItemId ?? where?.AND?.find?.((c) => c.fgItemId)?.fgItemId;
          // approvedBomWhere shape varies — match by call order / item
          if (tx._lastItemId === 1 || id === 1) return fgBom;
          return sfgBom;
        },
      },
    };
    // Hook accumulate via sequential item ids: FG=1 then SFG=50
    let call = 0;
    tx.bom.findFirst = async () => {
      call += 1;
      return call === 1 ? fgBom : sfgBom;
    };
    const profile = await buildPurgingProfileForFg(tx, 1);
    assert.equal(profile.components.length, 2);
    assert.equal(profile.components[0].rmItemId, 10);
    assert.equal(profile.components[1].rmItemId, 11);
    assert.ok(Math.abs(profile.components[0].mixPercent + profile.components[1].mixPercent - 100) < 0.01);
  });
});

describe("purging detection rules", () => {
  const profileA = { fingerprint: "aaa" };
  const profileB = { fingerprint: "bbb" };

  it("Product A → Product B with identical RM profile: no purge", () => {
    const result = detectPurgingForTransition(
      { materialState: MATERIAL_STATE.RETAINED, profileFingerprint: "same" },
      { fingerprint: "same" },
    );
    assert.equal(result.purgingRequired, false);
    assert.equal(result.detectionStatus, PURGING_DETECTION.AUTO_NOT_REQUIRED);
  });

  it("same FG/profile retained: no purge", () => {
    const result = detectPurgingForTransition(
      { materialState: MATERIAL_STATE.RETAINED, profileFingerprint: profileA.fingerprint },
      profileA,
    );
    assert.equal(result.purgingRequired, false);
  });

  it("different RM profile: purge", () => {
    const result = detectPurgingForTransition(
      { materialState: MATERIAL_STATE.RETAINED, profileFingerprint: profileA.fingerprint },
      profileB,
    );
    assert.equal(result.purgingRequired, true);
    assert.equal(result.detectionStatus, PURGING_DETECTION.AUTO_REQUIRED);
  });

  it("cleared machine: purge", () => {
    const result = detectPurgingForTransition(
      { materialState: MATERIAL_STATE.CLEARED, profileFingerprint: profileA.fingerprint },
      profileA,
    );
    assert.equal(result.purgingRequired, true);
    assert.equal(result.detectionStatus, PURGING_DETECTION.AUTO_REQUIRED);
  });

  it("unknown machine: conservative purge planned (does not block planning)", () => {
    const result = detectPurgingForTransition(
      { materialState: MATERIAL_STATE.UNKNOWN, profileFingerprint: null },
      profileA,
    );
    assert.equal(result.purgingRequired, true);
    assert.equal(result.detectionStatus, PURGING_DETECTION.CONFIRMATION_REQUIRED);
    assert.equal(result.conservativePlan, true);
    assert.equal(result.detectionLabel, "Conservative purge planned");
    assert.match(result.detectionReason, /operator confirms at production start/i);
  });

  it("detection labels cover retained / changed / cleared / override", () => {
    assert.equal(
      detectPurgingForTransition(
        { materialState: MATERIAL_STATE.RETAINED, profileFingerprint: profileA.fingerprint },
        profileA,
      ).detectionLabel,
      "No purge — same material retained",
    );
    assert.equal(
      detectPurgingForTransition(
        { materialState: MATERIAL_STATE.RETAINED, profileFingerprint: profileA.fingerprint },
        profileB,
      ).detectionLabel,
      "Purge required — material changed",
    );
    assert.equal(
      detectPurgingForTransition(
        { materialState: MATERIAL_STATE.CLEARED, profileFingerprint: profileA.fingerprint },
        profileA,
      ).detectionLabel,
      "Purge required — machine cleared",
    );
    const ov = detectPurgingForTransition(
      { materialState: MATERIAL_STATE.CLEARED, profileFingerprint: null },
      profileA,
      { override: { purgingRequired: false, reason: "Admin exception", userId: 1 } },
    );
    assert.equal(ov.detectionStatus, PURGING_DETECTION.OVERRIDDEN);
    assert.match(ov.detectionLabel, /Override — no purge/);
  });

  it("same product returning after intervening different profile: purge", () => {
    // Virtual sequence: retained B then A returns
    const afterB = detectPurgingForTransition(
      { materialState: MATERIAL_STATE.RETAINED, profileFingerprint: profileB.fingerprint },
      profileA,
    );
    assert.equal(afterB.purgingRequired, true);
  });

  it("override requires reason", () => {
    assert.throws(
      () =>
        detectPurgingForTransition(
          { materialState: MATERIAL_STATE.CLEARED, profileFingerprint: null },
          profileA,
          { override: { purgingRequired: false, reason: "" } },
        ),
      (err) => err.code === "PURGE_OVERRIDE_REASON_REQUIRED",
    );
  });

  it("physical setup is confirmation-required by default", () => {
    const setup = detectPhysicalSetupForRun();
    assert.equal(setup.physicalSetupStatus, PHYSICAL_SETUP_DETECTION.CONFIRMATION_REQUIRED);
    assert.equal(setup.physicalSetupRequired, null);
  });
});

describe("planned purging formula uses purge count not run count", () => {
  const mockBom = {
    fgWeight: "100",
    fgWeightUnit: { unitCode: "gram" },
    outputQty: "1",
    runnerWeight: "0",
    standardPurgingQtyGrams: "100",
    normalizationMode: "PER_PIECE",
    lines: [{ baseQty: "0.1", rmItem: { id: 10, itemType: "RM", itemName: "RM" } }],
  };
  const tx = { bom: { findFirst: async () => mockBom } };

  it("3 runs but 1 purge → total = standard × 1", async () => {
    const counts = derivePlanningCountsFromDetectedRuns([
      { fgItemId: 1, purgingRequired: true, physicalSetupStatus: PHYSICAL_SETUP_DETECTION.CONFIRMATION_REQUIRED },
      { fgItemId: 1, purgingRequired: false, physicalSetupStatus: PHYSICAL_SETUP_DETECTION.CONFIRMATION_REQUIRED },
      { fgItemId: 1, purgingRequired: false, physicalSetupStatus: PHYSICAL_SETUP_DETECTION.CONFIRMATION_REQUIRED },
    ]);
    assert.equal(counts.productionRunCount, 3);
    assert.equal(counts.plannedPurgeCount, 1);
    assert.equal(counts.plannedMachineSetupCount, null);

    const purge = await computePurgingRmForFg(tx, 1, counts.plannedPurgeCount);
    assert.equal(purge.totalPlannedPurgingGrams, 100);
  });
});

describe("client count / boolean manipulation", () => {
  it("rejects any client plannedSetupCount", () => {
    assert.throws(
      () => assertClientSetupCountMatchesDerived(2),
      (err) => err.code === "SETUP_COUNT_NOT_DERIVED",
    );
  });

  it("rejects mismatched plannedPurgeCount", () => {
    assert.throws(
      () => assertClientPurgeCountMatchesDerived(9, 1),
      (err) => err.code === "PURGE_COUNT_NOT_DERIVED",
    );
  });

  it("allows matching plannedPurgeCount", () => {
    assert.doesNotThrow(() => assertClientPurgeCountMatchesDerived(1, 1));
  });
});

describe("legacy plannedSetupCount never drives purging", () => {
  const mockBom = {
    fgWeight: "100",
    fgWeightUnit: { unitCode: "gram" },
    outputQty: "1",
    runnerWeight: "0",
    standardPurgingQtyGrams: "250",
    normalizationMode: "PER_PIECE",
    lines: [{ baseQty: "0.1", rmItem: { id: 10, itemType: "RM", itemName: "RM" } }],
  };
  const tx = { bom: { findFirst: async () => mockBom } };

  it("plannedSetupCount of 1+ in options is ignored for purge RM", async () => {
    const {
      addPurgingRmForFgLines,
      buildPurgingPlanningSummary,
      resolvePurgeCountForFg,
    } = require("../../src/services/bomPurgingRmPlanningService");

    assert.equal(resolvePurgeCountForFg({ plannedSetupCount: 5, plannedPurgeCount: 0 }, 1), 0);
    assert.equal(resolvePurgeCountForFg({ plannedSetupCount: 3 }, 1), 0);
    assert.equal(resolvePurgeCountForFg({ plannedPurgeCount: 2, plannedSetupCount: 9 }, 1), 2);

    const rmNeeded = new Map();
    await addPurgingRmForFgLines(tx, rmNeeded, [{ fgItemId: 1 }], {
      plannedSetupCount: 7,
      plannedPurgeCount: 0,
    });
    assert.equal(rmNeeded.size, 0);

    const summary = await buildPurgingPlanningSummary(tx, [{ fgItemId: 1 }], {
      plannedSetupCount: 4,
    });
    assert.equal(summary.plannedPurgeCount, 0);
    assert.equal(summary.totalPlannedPurgingGrams, 0);

    const withPurge = await computePurgingRmForFg(tx, 1, 1);
    assert.equal(withPurge.totalPlannedPurgingGrams, 250);
  });

  it("setupCountByFgItemId map is ignored (only purgeCountByFgItemId applies)", async () => {
    const { buildPurgingPlanningSummary } = require("../../src/services/bomPurgingRmPlanningService");
    const summary = await buildPurgingPlanningSummary(tx, [{ fgItemId: 1 }], {
      setupCountByFgItemId: new Map([[1, 5]]),
      plannedPurgeCount: 0,
    });
    assert.equal(summary.plannedPurgeCount, 0);
    assert.equal(summary.totalPlannedPurgingGrams, 0);

    const detected = await buildPurgingPlanningSummary(tx, [{ fgItemId: 1 }], {
      purgeCountByFgItemId: new Map([[1, 2]]),
    });
    assert.equal(detected.plannedPurgeCount, 2);
    assert.equal(detected.totalPlannedPurgingGrams, 500);
  });
});

describe("purging override / confirm role gates", () => {
  const {
    assertPurgingOrSetupOverrideRole,
  } = require("../../src/services/machineMaterialStateService");
  const { WRITE_ROLES } = require("../../src/routes/machines");

  it("STORE cannot confirm material state via machines write roles", () => {
    assert.ok(!WRITE_ROLES.includes("STORE"));
    assert.ok(WRITE_ROLES.includes("PRODUCTION"));
    assert.ok(WRITE_ROLES.includes("ADMIN"));
  });

  it("STORE cannot override purging or setup in planning", () => {
    assert.throws(
      () => assertPurgingOrSetupOverrideRole("STORE", true, "purging"),
      (err) => err.code === "PURGE_OVERRIDE_FORBIDDEN" && err.statusCode === 403,
    );
    assert.throws(
      () => assertPurgingOrSetupOverrideRole("STORE", true, "setup"),
      (err) => err.code === "SETUP_OVERRIDE_FORBIDDEN" && err.statusCode === 403,
    );
  });

  it("PRODUCTION cannot apply planning override (confirm at production start)", () => {
    assert.throws(
      () => assertPurgingOrSetupOverrideRole("PRODUCTION", true, "purging"),
      (err) => err.code === "PURGE_OVERRIDE_FORBIDDEN",
    );
  });

  it("ADMIN may apply exceptional override; no-op without override", () => {
    assert.doesNotThrow(() => assertPurgingOrSetupOverrideRole("ADMIN", true, "purging"));
    assert.doesNotThrow(() => assertPurgingOrSetupOverrideRole("STORE", false, "purging"));
  });

  it("UNKNOWN conservative purge does not block machine-planning completion validation", async () => {
    const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
    const woRuns = require("../../src/services/woProductionRunAllocationService");
    const materialState = require("../../src/services/machineMaterialStateService");
    const originalView = snapshotSvc.buildRegularSoPlanningSnapshotView;
    const originalValidate = woRuns.validateAndEnrichProductionRuns;
    const originalEnrich = materialState.enrichRunsWithPurgingDetection;

    snapshotSvc.buildRegularSoPlanningSnapshotView = async () => ({
      salesOrderId: 91,
      orderType: "NORMAL",
      machinePlanningCompleted: false,
      productionRuns: [
        { fgItemId: 1, machineId: 1, plannedQty: 10, runSequence: 1, purgingRequired: true },
      ],
      lines: [{ fgItemId: 1, fgName: "FG", plannedProductionQty: 10 }],
      salesOrder: {},
    });
    materialState.enrichRunsWithPurgingDetection = async (_db, runs) =>
      (runs || []).map((r) => ({
        ...r,
        purgingRequired: true,
        purgingDetectionStatus: PURGING_DETECTION.CONFIRMATION_REQUIRED,
        purgingDetectionLabel: "Conservative purge planned",
        purgingDetectionReason: "Machine material state is unknown; operator confirms at production start.",
        conservativePurgePlan: true,
        physicalSetupStatus: PHYSICAL_SETUP_DETECTION.CONFIRMATION_REQUIRED,
      }));
    woRuns.validateAndEnrichProductionRuns = async () => ({
      enriched: [
        {
          fgItemId: 1,
          machineId: 1,
          plannedQty: 10,
          runSequence: 1,
          purgingRequired: true,
          purgingDetectionStatus: PURGING_DETECTION.CONFIRMATION_REQUIRED,
          conservativePurgePlan: true,
        },
      ],
      productionRunCount: 1,
      plannedPurgeCount: 1,
      incomplete: false,
      purgeCountByFgItemId: new Map([[1, 1]]),
    });

    try {
      const { assessRegularSoMachinePlanning } = require("../../src/services/regularSoMachinePlanningService");
      // Valid qty allocations with UNKNOWN purge must be AWAITING_COMPLETION, not blocked.
      const a = await assessRegularSoMachinePlanning(91, { bom: { findFirst: async () => ({ revisionNo: 1 }) } });
      assert.equal(a.key, "MACHINE_PLANNING_AWAITING_COMPLETION");
      assert.equal(a.machinePlanningComplete, false);
      assert.ok(a.allocationsValid !== false || a.issues[0]?.includes("Complete"));
    } finally {
      snapshotSvc.buildRegularSoPlanningSnapshotView = originalView;
      woRuns.validateAndEnrichProductionRuns = originalValidate;
      materialState.enrichRunsWithPurgingDetection = originalEnrich;
    }
  });
});
