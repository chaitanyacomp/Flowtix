/**
 * Machine material-state + purging / physical-setup detection for planned runs.
 * Physical setup is confirmation-required until mould/tool retained-setup exists.
 * Purging is driven by leaf-RM profile changes — never by run-row count alone.
 */
const { buildPurgingProfileForFg, profilesEqual } = require("./bomPurgingProfileService");

const MATERIAL_STATE = Object.freeze({
  RETAINED: "RETAINED",
  CLEARED: "CLEARED",
  UNKNOWN: "UNKNOWN",
});

const PURGING_DETECTION = Object.freeze({
  AUTO_REQUIRED: "AUTO_REQUIRED",
  AUTO_NOT_REQUIRED: "AUTO_NOT_REQUIRED",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  OVERRIDDEN: "OVERRIDDEN",
});

const PHYSICAL_SETUP_DETECTION = Object.freeze({
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  CONFIRMED_REQUIRED: "CONFIRMED_REQUIRED",
  CONFIRMED_NOT_REQUIRED: "CONFIRMED_NOT_REQUIRED",
  OVERRIDDEN: "OVERRIDDEN",
});

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} machineId
 */
async function loadMachineMaterialState(db, machineId) {
  if (typeof db.machineMaterialState?.findUnique !== "function") {
    return {
      machineId: Number(machineId),
      materialState: MATERIAL_STATE.UNKNOWN,
      currentProfileFingerprint: null,
      currentProfileJson: null,
      sourceWorkOrderId: null,
      sourceRunAllocationId: null,
      confirmedAt: null,
      confirmedByUserId: null,
      version: 0,
    };
  }
  const row = await db.machineMaterialState.findUnique({
    where: { machineId: Number(machineId) },
  });
  if (!row) {
    return {
      machineId: Number(machineId),
      materialState: MATERIAL_STATE.UNKNOWN,
      currentProfileFingerprint: null,
      currentProfileJson: null,
      sourceWorkOrderId: null,
      sourceRunAllocationId: null,
      confirmedAt: null,
      confirmedByUserId: null,
      version: 0,
    };
  }
  return {
    machineId: row.machineId,
    materialState: String(row.materialState || MATERIAL_STATE.UNKNOWN).toUpperCase(),
    currentProfileFingerprint: row.currentProfileFingerprint ?? null,
    currentProfileJson: row.currentProfileJson ?? null,
    sourceWorkOrderId: row.sourceWorkOrderId ?? null,
    sourceRunAllocationId: row.sourceRunAllocationId ?? null,
    confirmedAt: row.confirmedAt ?? null,
    confirmedByUserId: row.confirmedByUserId ?? null,
    version: row.version ?? 0,
    updatedAt: row.updatedAt ?? null,
  };
}

/**
 * Detect purging need for one run given prior machine/virtual state.
 * @param {{ materialState: string, profileFingerprint: string|null }} prior
 * @param {{ fingerprint: string }} targetProfile
 * @param {{ override?: { purgingRequired: boolean, reason: string, userId?: number } }|null} [opts]
 */
function detectPurgingForTransition(prior, targetProfile, opts = null) {
  const override = opts?.override ?? null;
  if (override && typeof override.purgingRequired === "boolean") {
    if (!String(override.reason || "").trim()) {
      const err = new Error("Purging override requires a reason.");
      err.statusCode = 400;
      err.code = "PURGE_OVERRIDE_REASON_REQUIRED";
      throw err;
    }
    const required = Boolean(override.purgingRequired);
    const reason = String(override.reason).trim().slice(0, 500);
    return {
      purgingRequired: required,
      detectionStatus: PURGING_DETECTION.OVERRIDDEN,
      detectionLabel: required
        ? `Override — purge required (${reason})`
        : `Override — no purge (${reason})`,
      detectionReason: reason,
      previousProfileFingerprint: prior.profileFingerprint ?? null,
      targetProfileFingerprint: targetProfile.fingerprint,
      conservativePlan: false,
      overrideReason: reason,
      overrideByUserId: override.userId ?? null,
    };
  }

  const state = String(prior.materialState || MATERIAL_STATE.UNKNOWN).toUpperCase();
  const prevFp = prior.profileFingerprint ?? null;
  const targetFp = targetProfile.fingerprint;

  if (state === MATERIAL_STATE.UNKNOWN || !prevFp) {
    return {
      purgingRequired: true,
      detectionStatus: PURGING_DETECTION.CONFIRMATION_REQUIRED,
      detectionLabel: "Conservative purge planned",
      detectionReason:
        "Machine material state is unknown; operator confirms at production start.",
      previousProfileFingerprint: prevFp,
      targetProfileFingerprint: targetFp,
      conservativePlan: true,
      overrideReason: null,
      overrideByUserId: null,
    };
  }

  if (state === MATERIAL_STATE.CLEARED) {
    return {
      purgingRequired: true,
      detectionStatus: PURGING_DETECTION.AUTO_REQUIRED,
      detectionLabel: "Purge required — machine cleared",
      detectionReason: "Machine material was cleared — purge required before next production run.",
      previousProfileFingerprint: prevFp,
      targetProfileFingerprint: targetFp,
      conservativePlan: false,
      overrideReason: null,
      overrideByUserId: null,
    };
  }

  // RETAINED
  if (profilesEqual(prevFp, targetFp)) {
    return {
      purgingRequired: false,
      detectionStatus: PURGING_DETECTION.AUTO_NOT_REQUIRED,
      detectionLabel: "No purge — same material retained",
      detectionReason:
        "Retained purging profile matches this run’s leaf-RM composition — no purge required.",
      previousProfileFingerprint: prevFp,
      targetProfileFingerprint: targetFp,
      conservativePlan: false,
      overrideReason: null,
      overrideByUserId: null,
    };
  }

  return {
    purgingRequired: true,
    detectionStatus: PURGING_DETECTION.AUTO_REQUIRED,
    detectionLabel: "Purge required — material changed",
    detectionReason:
      "Retained purging profile differs from this run’s leaf-RM composition — purge required.",
    previousProfileFingerprint: prevFp,
    targetProfileFingerprint: targetFp,
    conservativePlan: false,
    overrideReason: null,
    overrideByUserId: null,
  };
}

/**
 * STORE cannot confirm/override purging. ADMIN override is exceptional.
 * Production confirms at actual production start — not via planning overrides.
 */
function assertPurgingOrSetupOverrideRole(actorRole, hasOverride, kind = "purging") {
  if (!hasOverride) return;
  const role = String(actorRole ?? "").trim().toUpperCase();
  if (role === "STORE") {
    const err = new Error(
      kind === "setup"
        ? "Store cannot confirm or override physical setup. Confirmation is at production start."
        : "Store cannot confirm or override machine purging. Confirmation is at production start.",
    );
    err.statusCode = 403;
    err.code = kind === "setup" ? "SETUP_OVERRIDE_FORBIDDEN" : "PURGE_OVERRIDE_FORBIDDEN";
    throw err;
  }
  if (role !== "ADMIN") {
    const err = new Error(
      kind === "setup"
        ? "Physical setup confirmation is done at production start. Only Admin may apply an exceptional override here."
        : "Purging confirmation is done at production start. Only Admin may apply an exceptional override here.",
    );
    err.statusCode = 403;
    err.code = kind === "setup" ? "SETUP_OVERRIDE_FORBIDDEN" : "PURGE_OVERRIDE_FORBIDDEN";
    throw err;
  }
}

/**
 * Physical mould/tool setup — no retained-setup master yet → confirmation required.
 */
function detectPhysicalSetupForRun(opts = null) {
  const override = opts?.override ?? null;
  if (override && typeof override.setupRequired === "boolean") {
    if (!String(override.reason || "").trim()) {
      const err = new Error("Physical setup override requires a reason.");
      err.statusCode = 400;
      err.code = "SETUP_OVERRIDE_REASON_REQUIRED";
      throw err;
    }
    return {
      physicalSetupRequired: Boolean(override.setupRequired),
      physicalSetupStatus: PHYSICAL_SETUP_DETECTION.OVERRIDDEN,
      physicalSetupReason: String(override.reason).trim().slice(0, 500),
      overrideReason: String(override.reason).trim().slice(0, 500),
      overrideByUserId: override.userId ?? null,
    };
  }
  return {
    physicalSetupRequired: null,
    physicalSetupStatus: PHYSICAL_SETUP_DETECTION.CONFIRMATION_REQUIRED,
    physicalSetupReason:
      "Physical mould/tool setup cannot be inferred from run rows alone — confirmation required.",
    overrideReason: null,
    overrideByUserId: null,
  };
}

/**
 * Apply detection across ordered planned runs (grouped by machine, in plan order).
 * After each run, virtual retained state becomes that run’s target profile (planning assumption only).
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {Array<{ fgItemId: number, machineId: number, runSequence: number, plannedDate?: string|null, clientKey?: string, override?: object }>} runs
 * @param {{ actorRole?: string|null }} [options]
 */
async function enrichRunsWithPurgingDetection(db, runs, options = {}) {
  const list = Array.isArray(runs) ? [...runs] : [];
  const actorRole = options.actorRole ?? null;
  const profileCache = new Map();

  async function profileFor(fgItemId) {
    const id = Number(fgItemId);
    if (profileCache.has(id)) return profileCache.get(id);
    const profile = await buildPurgingProfileForFg(db, id);
    profileCache.set(id, profile);
    return profile;
  }

  // Stable planning order: machine → date → sequence → fg
  list.sort((a, b) => {
    const m = Number(a.machineId) - Number(b.machineId);
    if (m !== 0) return m;
    const da = String(a.plannedDate ?? "");
    const db_ = String(b.plannedDate ?? "");
    if (da !== db_) return da < db_ ? -1 : 1;
    const s = Number(a.runSequence) - Number(b.runSequence);
    if (s !== 0) return s;
    return Number(a.fgItemId) - Number(b.fgItemId);
  });

  const machineIds = [...new Set(list.map((r) => Number(r.machineId)).filter((id) => id > 0))];
  const stateByMachine = new Map();
  for (const machineId of machineIds) {
    const st = await loadMachineMaterialState(db, machineId);
    stateByMachine.set(machineId, {
      materialState: st.materialState,
      profileFingerprint: st.currentProfileFingerprint,
    });
  }

  const enriched = [];
  for (const run of list) {
    const machineId = Number(run.machineId);
    const targetProfile = await profileFor(run.fgItemId);
    const prior = stateByMachine.get(machineId) ?? {
      materialState: MATERIAL_STATE.UNKNOWN,
      profileFingerprint: null,
    };

    const purgeOverride = run.purgingOverride ?? run.override?.purging ?? null;
    const setupOverride = run.physicalSetupOverride ?? run.override?.physicalSetup ?? null;
    assertPurgingOrSetupOverrideRole(actorRole, Boolean(purgeOverride), "purging");
    assertPurgingOrSetupOverrideRole(actorRole, Boolean(setupOverride), "setup");

    const purge = detectPurgingForTransition(prior, targetProfile, {
      override: purgeOverride,
    });
    const setup = detectPhysicalSetupForRun({
      override: setupOverride,
    });

    enriched.push({
      ...run,
      targetProfileFingerprint: targetProfile.fingerprint,
      targetProfileComponents: targetProfile.components,
      purgingRequired: purge.purgingRequired,
      purgingDetectionStatus: purge.detectionStatus,
      purgingDetectionLabel: purge.detectionLabel ?? null,
      purgingDetectionReason: purge.detectionReason,
      previousProfileFingerprint: purge.previousProfileFingerprint,
      conservativePurgePlan: Boolean(purge.conservativePlan),
      purgingOverrideReason: purge.overrideReason,
      purgingOverrideByUserId: purge.overrideByUserId,
      // Physical setup is confirmed at production start — keep fields for audit but not planning UX.
      physicalSetupRequired: setup.physicalSetupRequired,
      physicalSetupStatus: setup.physicalSetupStatus,
      physicalSetupReason: setup.physicalSetupReason,
      physicalSetupOverrideReason: setup.overrideReason,
      physicalSetupOverrideByUserId: setup.overrideByUserId,
    });

    // Planning assumption only: after this run, machine retains target profile (not auto-confirmed).
    stateByMachine.set(machineId, {
      materialState: MATERIAL_STATE.RETAINED,
      profileFingerprint: targetProfile.fingerprint,
    });
  }

  return enriched;
}

/**
 * Derive separate planning counters from detection-enriched runs.
 */
function derivePlanningCountsFromDetectedRuns(enrichedRuns) {
  const runs = Array.isArray(enrichedRuns) ? enrichedRuns : [];
  const productionRunCount = runs.length;
  const plannedPurgeCount = runs.filter((r) => r.purgingRequired === true).length;
  // Physical setups are not invented from run rows.
  const plannedMachineSetupCount = null;
  const physicalSetupConfirmationRequired = runs.some(
    (r) => r.physicalSetupStatus === PHYSICAL_SETUP_DETECTION.CONFIRMATION_REQUIRED,
  );
  const confirmedPhysicalSetups = runs.filter((r) => r.physicalSetupRequired === true).length;

  /** @type {Map<number, number>} */
  const purgeCountByFgItemId = new Map();
  for (const run of runs) {
    if (!run.purgingRequired) continue;
    const fg = Number(run.fgItemId);
    purgeCountByFgItemId.set(fg, (purgeCountByFgItemId.get(fg) ?? 0) + 1);
  }

  return {
    productionRunCount,
    plannedPurgeCount,
    plannedMachineSetupCount,
    physicalSetupConfirmationRequired,
    confirmedPhysicalSetups,
    purgeCountByFgItemId,
  };
}

/**
 * Confirm machine material state (ADMIN/PRODUCTION only — caller enforces role).
 * Pass expectedVersion for optimistic locking (0 when no row yet).
 */
async function confirmMachineMaterialState(
  db,
  {
    machineId,
    materialState,
    profileFingerprint = null,
    profileJson = null,
    sourceWorkOrderId = null,
    sourceRunAllocationId = null,
    confirmedByUserId = null,
    expectedVersion = null,
  },
) {
  const state = String(materialState || "").toUpperCase();
  if (!Object.values(MATERIAL_STATE).includes(state)) {
    const err = new Error("Material state must be RETAINED, CLEARED, or UNKNOWN.");
    err.statusCode = 400;
    throw err;
  }
  if (typeof db.machineMaterialState?.upsert !== "function") {
    const err = new Error("Machine material state is not available.");
    err.statusCode = 500;
    throw err;
  }
  const existing = await db.machineMaterialState.findUnique({
    where: { machineId: Number(machineId) },
    select: { version: true, id: true },
  });
  const currentVersion = existing?.version ?? 0;
  if (expectedVersion != null && Number(expectedVersion) !== Number(currentVersion)) {
    const err = new Error(
      "Machine material state was updated by another work order. Reload and confirm again.",
    );
    err.statusCode = 409;
    err.code = "MACHINE_STATE_VERSION_CONFLICT";
    err.details = { expectedVersion: Number(expectedVersion), currentVersion };
    throw err;
  }
  const nextVersion = currentVersion + 1;
  if (!existing) {
    return db.machineMaterialState.create({
      data: {
        machineId: Number(machineId),
        materialState: state,
        currentProfileFingerprint: profileFingerprint,
        currentProfileJson: profileJson,
        sourceWorkOrderId,
        sourceRunAllocationId,
        confirmedAt: new Date(),
        confirmedByUserId,
        version: nextVersion,
      },
    });
  }
  const updated = await db.machineMaterialState.updateMany({
    where: { machineId: Number(machineId), version: currentVersion },
    data: {
      materialState: state,
      currentProfileFingerprint: profileFingerprint,
      currentProfileJson: profileJson,
      sourceWorkOrderId,
      sourceRunAllocationId,
      confirmedAt: new Date(),
      confirmedByUserId,
      version: nextVersion,
    },
  });
  if (updated.count !== 1) {
    const err = new Error(
      "Machine material state was updated by another work order. Reload and confirm again.",
    );
    err.statusCode = 409;
    err.code = "MACHINE_STATE_VERSION_CONFLICT";
    throw err;
  }
  return db.machineMaterialState.findUnique({ where: { machineId: Number(machineId) } });
}

module.exports = {
  MATERIAL_STATE,
  PURGING_DETECTION,
  PHYSICAL_SETUP_DETECTION,
  loadMachineMaterialState,
  detectPurgingForTransition,
  detectPhysicalSetupForRun,
  assertPurgingOrSetupOverrideRole,
  enrichRunsWithPurgingDetection,
  derivePlanningCountsFromDetectedRuns,
  confirmMachineMaterialState,
  n,
};
