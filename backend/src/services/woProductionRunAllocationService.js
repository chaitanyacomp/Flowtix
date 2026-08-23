/**
 * Work Order / planning production-run allocations.
 * Run rows ≠ physical setups ≠ material purges. Backend derives detection.
 */
const EPS = 1e-6;
const QTY_RECONCILE_EPS = 0.001;
const MAX_RUNS_PER_FG = 99;

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function httpError(message, statusCode = 400, code = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

/**
 * Normalize raw client run rows (does not load masters / standards).
 * @param {unknown} rawRuns
 * @returns {Array<{ fgItemId: number, runSequence: number, machineId: number, plannedQty: number, plannedDate: string|null, shiftId: number|null }>}
 */
function normalizeProductionRunInputs(rawRuns) {
  if (rawRuns == null) return [];
  if (!Array.isArray(rawRuns)) {
    throw httpError("Production run allocations must be an array.", 400, "INVALID_PRODUCTION_RUNS");
  }
  const out = [];
  for (let i = 0; i < rawRuns.length; i += 1) {
    const row = rawRuns[i] ?? {};
    const fgItemId = Number(row.fgItemId ?? row.itemId);
    const machineId = Number(row.machineId);
    const plannedQty = round3(row.plannedQty ?? row.qty);
    const runSequenceRaw = row.runSequence != null ? Number(row.runSequence) : i + 1;
    if (!Number.isInteger(fgItemId) || fgItemId <= 0) {
      throw httpError(`Production run #${i + 1}: FG item is required.`, 400, "INVALID_PRODUCTION_RUN");
    }
    if (!Number.isInteger(machineId) || machineId <= 0) {
      throw httpError(`Production run #${i + 1}: Machine is required.`, 400, "INVALID_PRODUCTION_RUN");
    }
    if (!Number.isFinite(plannedQty) || plannedQty <= EPS) {
      throw httpError(`Production run #${i + 1}: Planned quantity must be greater than zero.`, 400, "INVALID_PRODUCTION_RUN");
    }
    if (!Number.isInteger(runSequenceRaw) || runSequenceRaw < 1) {
      throw httpError(`Production run #${i + 1}: Run sequence must be a whole number ≥ 1.`, 400, "INVALID_PRODUCTION_RUN");
    }
    let plannedDate = null;
    if (row.plannedDate != null && String(row.plannedDate).trim() !== "") {
      const raw = String(row.plannedDate).trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw httpError(`Production run #${i + 1}: Planned date must be YYYY-MM-DD.`, 400, "INVALID_PRODUCTION_RUN");
      }
      plannedDate = raw;
    }
    let shiftId = null;
    if (row.shiftId != null && row.shiftId !== "") {
      const sid = Number(row.shiftId);
      if (!Number.isInteger(sid) || sid <= 0) {
        throw httpError(`Production run #${i + 1}: Shift is invalid.`, 400, "INVALID_PRODUCTION_RUN");
      }
      shiftId = sid;
    }
    out.push({
      fgItemId,
      runSequence: runSequenceRaw,
      machineId,
      plannedQty,
      plannedDate,
      shiftId,
      purgingOverride: row.purgingOverride ?? null,
      physicalSetupOverride: row.physicalSetupOverride ?? null,
    });
  }
  return out;
}

/**
 * productionRunCount = number of valid production-run allocation rows.
 * @deprecated Name kept for callers; does NOT equal planned purge count.
 */
function derivePlannedSetupCountFromRuns(runs, fgItemId = null) {
  const list = Array.isArray(runs) ? runs : [];
  const filtered =
    fgItemId == null ? list : list.filter((r) => Number(r.fgItemId) === Number(fgItemId));
  return filtered.length;
}

/**
 * @param {Array<{ fgItemId: number }>} runs
 * @returns {Map<number, number>}
 */
function deriveSetupCountByFgItemId(runs) {
  const map = new Map();
  for (const run of runs ?? []) {
    const fgItemId = Number(run.fgItemId);
    if (!Number.isInteger(fgItemId) || fgItemId <= 0) continue;
    map.set(fgItemId, (map.get(fgItemId) ?? 0) + 1);
  }
  return map;
}

/**
 * Estimated production duration (seconds) from FG Production Standard + planned qty.
 * Uses efficiency-adjusted effective rate (same masters as capacity preview).
 */
function estimateProductionDurationSeconds({
  plannedQty,
  cycleTimeSeconds,
  piecesPerCycle,
  standardEfficiencyPercent,
}) {
  const qty = n(plannedQty);
  const cycle = n(cycleTimeSeconds);
  const pieces = n(piecesPerCycle);
  const eff = n(standardEfficiencyPercent);
  if (!(qty > EPS) || !(cycle > EPS) || !(pieces >= 1) || !(eff > 0)) {
    return null;
  }
  const effectivePiecesPerSecond = (pieces / cycle) * (eff / 100);
  if (!(effectivePiecesPerSecond > EPS)) return null;
  return round3(qty / effectivePiecesPerSecond);
}

function formatDurationLabel(totalSeconds) {
  const sec = n(totalSeconds);
  if (!(sec > 0)) return null;
  const minutes = Math.ceil(sec / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Validate runs against planned FG qty and active FG Production Standards.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {Array} rawRuns
 * @param {Array<{ fgItemId: number, plannedQty: number, fgName?: string }>} plannedFgLines
 * @param {{ requireRuns?: boolean }} [options]
 */
async function validateAndEnrichProductionRuns(db, rawRuns, plannedFgLines, options = {}) {
  const requireRuns = options.requireRuns !== false;
  const allowIncomplete = options.allowIncomplete === true;
  const runs = normalizeProductionRunInputs(rawRuns);
  const plannedByFg = new Map(
    (plannedFgLines ?? [])
      .map((l) => [Number(l.fgItemId), { plannedQty: round3(l.plannedQty), fgName: l.fgName ?? null }])
      .filter(([id]) => Number.isInteger(id) && id > 0),
  );

  if (!runs.length) {
    if (requireRuns && !allowIncomplete && plannedByFg.size > 0) {
      throw httpError(
        "Add at least one machine production-run allocation before creating the Work Order.",
        400,
        "PRODUCTION_RUNS_REQUIRED",
      );
    }
    return {
      runs: [],
      enriched: [],
      productionRunCount: 0,
      plannedPurgeCount: 0,
      plannedMachineSetupCount: null,
      physicalSetupConfirmationRequired: false,
      purgeCountByFgItemId: new Map(),
      plannedSetupCount: 0,
      setupCountByFgItemId: new Map(),
      incomplete: allowIncomplete,
    };
  }

  // Reject runs for FGs not in the planned set
  for (const run of runs) {
    if (!plannedByFg.has(run.fgItemId)) {
      throw httpError(
        `Production run references FG item ${run.fgItemId} that is not on this Work Order plan.`,
        400,
        "PRODUCTION_RUN_FG_MISMATCH",
      );
    }
  }

  for (const [fgItemId, meta] of plannedByFg.entries()) {
    const fgRuns = runs.filter((r) => r.fgItemId === fgItemId);
    if (!fgRuns.length) {
      if (allowIncomplete) continue;
      throw httpError(
        `Add at least one machine production run for ${meta.fgName || `FG ${fgItemId}`}.`,
        400,
        "PRODUCTION_RUNS_REQUIRED",
      );
    }
    if (fgRuns.length > MAX_RUNS_PER_FG) {
      throw httpError(
        `Too many production runs for ${meta.fgName || `FG ${fgItemId}`} (max ${MAX_RUNS_PER_FG}).`,
        400,
        "TOO_MANY_PRODUCTION_RUNS",
      );
    }
    const seqs = new Set();
    for (const r of fgRuns) {
      if (seqs.has(r.runSequence)) {
        throw httpError(
          `Duplicate run sequence ${r.runSequence} for ${meta.fgName || `FG ${fgItemId}`}.`,
          400,
          "DUPLICATE_RUN_SEQUENCE",
        );
      }
      seqs.add(r.runSequence);
    }
    const allocated = round3(fgRuns.reduce((s, r) => s + r.plannedQty, 0));
    const target = round3(meta.plannedQty);
    if (Math.abs(allocated - target) > QTY_RECONCILE_EPS) {
      if (allowIncomplete) continue;
      throw httpError(
        `Allocated quantity (${allocated}) must equal planned WO quantity (${target}) for ${
          meta.fgName || `FG ${fgItemId}`
        }.`,
        400,
        "PRODUCTION_RUN_QTY_MISMATCH",
      );
    }
  }

  const machineIds = [...new Set(runs.map((r) => r.machineId))];
  const shiftIds = [...new Set(runs.map((r) => r.shiftId).filter((id) => id != null))];
  const fgItemIds = [...new Set(runs.map((r) => r.fgItemId))];

  const [machines, shifts, standards] = await Promise.all([
    db.machine.findMany({
      where: { id: { in: machineIds } },
      select: { id: true, machineCode: true, machineName: true, isActive: true },
    }),
    shiftIds.length
      ? db.shift.findMany({
          where: { id: { in: shiftIds } },
          select: { id: true, shiftCode: true, shiftName: true, isActive: true },
        })
      : Promise.resolve([]),
    db.fgProductionStandard.findMany({
      where: {
        itemId: { in: fgItemIds },
        machineId: { in: machineIds },
        isActive: true,
      },
      select: {
        itemId: true,
        machineId: true,
        cycleTimeSeconds: true,
        piecesPerCycle: true,
        standardEfficiencyPercent: true,
        isActive: true,
      },
    }),
  ]);

  const machineById = new Map(machines.map((m) => [m.id, m]));
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const standardByKey = new Map(
    standards.map((s) => [`${s.itemId}:${s.machineId}`, s]),
  );

  const enriched = [];
  // Stable order: by fgItemId then runSequence
  const ordered = [...runs].sort(
    (a, b) => a.fgItemId - b.fgItemId || a.runSequence - b.runSequence,
  );

  for (const run of ordered) {
    const machine = machineById.get(run.machineId);
    if (!machine) {
      throw httpError(`Machine #${run.machineId} was not found.`, 400, "MACHINE_NOT_FOUND");
    }
    if (!machine.isActive) {
      throw httpError(
        `Machine ${machine.machineCode || machine.machineName} is inactive and cannot be used for planning.`,
        400,
        "MACHINE_INACTIVE",
      );
    }
    if (run.shiftId != null) {
      const shift = shiftById.get(run.shiftId);
      if (!shift) {
        throw httpError(`Shift #${run.shiftId} was not found.`, 400, "SHIFT_NOT_FOUND");
      }
      if (!shift.isActive) {
        throw httpError(
          `Shift ${shift.shiftCode || shift.shiftName} is inactive.`,
          400,
          "SHIFT_INACTIVE",
        );
      }
    }
    const standard = standardByKey.get(`${run.fgItemId}:${run.machineId}`);
    if (!standard) {
      throw httpError(
        `No active FG Production Standard for this FG on machine ${
          machine.machineCode || machine.machineName
        }.`,
        400,
        "FG_MACHINE_STANDARD_MISSING",
      );
    }

    const cycleTimeSeconds = n(standard.cycleTimeSeconds);
    const piecesPerCycle = Number(standard.piecesPerCycle) || 1;
    const standardEfficiencyPercent = n(standard.standardEfficiencyPercent);
    const estimatedDurationSeconds = estimateProductionDurationSeconds({
      plannedQty: run.plannedQty,
      cycleTimeSeconds,
      piecesPerCycle,
      standardEfficiencyPercent,
    });

    enriched.push({
      ...run,
      machineCode: machine.machineCode,
      machineName: machine.machineName,
      shiftCode: run.shiftId != null ? shiftById.get(run.shiftId)?.shiftCode ?? null : null,
      shiftName: run.shiftId != null ? shiftById.get(run.shiftId)?.shiftName ?? null : null,
      cycleTimeSeconds,
      piecesPerCycle,
      standardEfficiencyPercent,
      estimatedDurationSeconds,
      estimatedDurationLabel: formatDurationLabel(estimatedDurationSeconds),
      expectedShiftQtyPreview: null,
      // Preserve client override payloads for detection (never trust client booleans as final).
      purgingOverride: run.purgingOverride ?? null,
      physicalSetupOverride: run.physicalSetupOverride ?? null,
      // Strip untrusted client detection fields if present on raw input.
      purgingRequired: undefined,
    });
  }

  // Reject client-submitted detection booleans / counts.
  for (const raw of rawRuns ?? []) {
    if (raw && (raw.purgingRequired === true || raw.purgingRequired === false) && !raw.purgingOverride) {
      // Client may send display hints; ignore unless framed as override with reason.
    }
    if (raw?.plannedPurgeCount != null || raw?.plannedSetupCount != null) {
      // Handled below via assertClientCountsNotTrusted at API layer.
    }
  }

  const {
    enrichRunsWithPurgingDetection,
    derivePlanningCountsFromDetectedRuns,
  } = require("./machineMaterialStateService");

  const detected = await enrichRunsWithPurgingDetection(db, enriched, {
    actorRole: options.actorRole ?? null,
  });
  const counts = derivePlanningCountsFromDetectedRuns(detected);

  // Merge capacity fields back onto detected rows (detection sort may reorder).
  const byKey = new Map(
    enriched.map((r) => [`${r.fgItemId}:${r.runSequence}:${r.machineId}`, r]),
  );
  const finalEnriched = detected.map((d) => {
    const base = byKey.get(`${d.fgItemId}:${d.runSequence}:${d.machineId}`) ?? {};
    return {
      ...base,
      ...d,
      cycleTimeSeconds: base.cycleTimeSeconds ?? d.cycleTimeSeconds,
      piecesPerCycle: base.piecesPerCycle ?? d.piecesPerCycle,
      standardEfficiencyPercent: base.standardEfficiencyPercent ?? d.standardEfficiencyPercent,
      estimatedDurationSeconds: base.estimatedDurationSeconds ?? null,
      estimatedDurationLabel: base.estimatedDurationLabel ?? null,
      machineCode: base.machineCode,
      machineName: base.machineName,
    };
  });

  return {
    runs: finalEnriched,
    enriched: finalEnriched,
    productionRunCount: counts.productionRunCount,
    plannedPurgeCount: counts.plannedPurgeCount,
    plannedMachineSetupCount: counts.plannedMachineSetupCount,
    physicalSetupConfirmationRequired: counts.physicalSetupConfirmationRequired,
    purgeCountByFgItemId: counts.purgeCountByFgItemId,
    /** @deprecated Not a purging multiplier — production run count only. */
    plannedSetupCount: counts.productionRunCount,
    /** @deprecated Do not use — was incorrectly aliased to purge map. */
    setupCountByFgItemId: undefined,
    incomplete: allowIncomplete,
  };
}

function derivePlanningCountsFromPersistedRuns(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const purgeCountByFgItemId = new Map();
  let plannedPurgeCount = 0;
  for (const r of list) {
    if (!r.purgingRequired) continue;
    plannedPurgeCount += 1;
    const fg = Number(r.fgItemId);
    purgeCountByFgItemId.set(fg, (purgeCountByFgItemId.get(fg) ?? 0) + 1);
  }
  return {
    productionRunCount: list.length,
    plannedPurgeCount,
    purgeCountByFgItemId,
  };
}

/**
 * Reject client-submitted purge/setup/run counts (backend derives them).
 */
function assertClientCountsNotTrusted(body = {}) {
  const suspects = [
    ["plannedPurgeCount", body.plannedPurgeCount],
    ["plannedSetupCount", body.plannedSetupCount],
    ["productionRunCount", body.productionRunCount],
  ];
  // Soft: only reject when client sends values that disagree with derived — callers pass derived.
  return suspects;
}

/**
 * Reject client-submitted setup/purge counts that do not match derived detection.
 */
function assertClientSetupCountMatchesDerived(clientSetupCount, _derivedIgnored) {
  if (clientSetupCount == null || clientSetupCount === "") return;
  throw httpError(
    "Planned setup/purge counts are derived from machine material-state detection and cannot be set manually.",
    400,
    "SETUP_COUNT_NOT_DERIVED",
  );
}

function assertClientPurgeCountMatchesDerived(clientPurgeCount, derivedPurgeCount) {
  if (clientPurgeCount == null || clientPurgeCount === "") return;
  const submitted = Number(clientPurgeCount);
  if (!Number.isInteger(submitted) || submitted !== Number(derivedPurgeCount)) {
    throw httpError(
      "Planned purge count is derived from purging-profile detection and cannot be set manually.",
      400,
      "PURGE_COUNT_NOT_DERIVED",
    );
  }
}

function runDetectionPersistFields(r) {
  return {
    purgingRequired: Boolean(r.purgingRequired),
    purgingDetectionStatus: r.purgingDetectionStatus ?? "CONFIRMATION_REQUIRED",
    purgingDetectionReason: r.purgingDetectionReason ?? null,
    previousProfileFingerprint: r.previousProfileFingerprint ?? null,
    targetProfileFingerprint: r.targetProfileFingerprint ?? null,
    purgingOverrideReason: r.purgingOverrideReason ?? null,
    purgingOverrideByUserId: r.purgingOverrideByUserId ?? null,
    purgingOverrideAt: r.purgingOverrideReason ? new Date() : null,
    physicalSetupRequired: r.physicalSetupRequired ?? null,
    physicalSetupStatus: r.physicalSetupStatus ?? "CONFIRMATION_REQUIRED",
    physicalSetupReason: r.physicalSetupReason ?? null,
    physicalSetupOverrideReason: r.physicalSetupOverrideReason ?? null,
    physicalSetupOverrideByUserId: r.physicalSetupOverrideByUserId ?? null,
    physicalSetupOverrideAt: r.physicalSetupOverrideReason ? new Date() : null,
  };
}

/**
 * Replace snapshot production runs.
 */
async function replaceRegularSoSnapshotProductionRuns(tx, snapshotId, enrichedRuns) {
  await tx.regularSoPlanningRunAllocation.deleteMany({ where: { snapshotId } });
  if (!enrichedRuns.length) return;
  await tx.regularSoPlanningRunAllocation.createMany({
    data: enrichedRuns.map((r) => ({
      snapshotId,
      fgItemId: r.fgItemId,
      runSequence: r.runSequence,
      machineId: r.machineId,
      plannedQty: String(r.plannedQty),
      plannedDate: r.plannedDate ? new Date(`${r.plannedDate}T00:00:00.000Z`) : null,
      shiftId: r.shiftId,
      ...runDetectionPersistFields(r),
    })),
  });
}

/**
 * Persist WO production runs after WO + lines exist.
 * @param {Array<{ id: number, fgItemId: number }>} woLines
 */
async function createWorkOrderProductionRuns(tx, workOrderId, woLines, enrichedRuns) {
  if (!enrichedRuns.length) return;
  if (typeof tx.workOrderProductionRunAllocation?.createMany !== "function") return;
  const lineByFg = new Map((woLines ?? []).map((l) => [Number(l.fgItemId), l]));
  await tx.workOrderProductionRunAllocation.createMany({
    data: enrichedRuns.map((r) => {
      const line = lineByFg.get(Number(r.fgItemId));
      return {
        workOrderId,
        workOrderLineId: line?.id ?? null,
        fgItemId: r.fgItemId,
        runSequence: r.runSequence,
        machineId: r.machineId,
        plannedQty: String(r.plannedQty),
        plannedDate: r.plannedDate ? new Date(`${r.plannedDate}T00:00:00.000Z`) : null,
        shiftId: r.shiftId,
        cycleTimeSeconds: r.cycleTimeSeconds != null ? String(r.cycleTimeSeconds) : null,
        piecesPerCycle: r.piecesPerCycle ?? null,
        standardEfficiencyPercent:
          r.standardEfficiencyPercent != null ? String(r.standardEfficiencyPercent) : null,
        ...runDetectionPersistFields(r),
      };
    }),
  });
}

async function replaceRequirementSheetPlannedRuns(tx, requirementSheetId, enrichedRuns) {
  await tx.requirementSheetPlannedRunAllocation.deleteMany({ where: { requirementSheetId } });
  if (!enrichedRuns.length) return;
  await tx.requirementSheetPlannedRunAllocation.createMany({
    data: enrichedRuns.map((r) => ({
      requirementSheetId,
      fgItemId: r.fgItemId,
      runSequence: r.runSequence,
      machineId: r.machineId,
      plannedQty: String(r.plannedQty),
      plannedDate: r.plannedDate ? new Date(`${r.plannedDate}T00:00:00.000Z`) : null,
      shiftId: r.shiftId,
      ...runDetectionPersistFields(r),
    })),
  });
}

function mapPersistedRunRow(row) {
  if (!row) return null;
  const plannedDate =
    row.plannedDate instanceof Date
      ? row.plannedDate.toISOString().slice(0, 10)
      : row.plannedDate
        ? String(row.plannedDate).slice(0, 10)
        : null;
  const cycleTimeSeconds = row.cycleTimeSeconds != null ? n(row.cycleTimeSeconds) : null;
  const piecesPerCycle = row.piecesPerCycle != null ? Number(row.piecesPerCycle) : null;
  const standardEfficiencyPercent =
    row.standardEfficiencyPercent != null ? n(row.standardEfficiencyPercent) : null;
  const plannedQty = round3(row.plannedQty);
  const estimatedDurationSeconds =
    cycleTimeSeconds != null && piecesPerCycle != null && standardEfficiencyPercent != null
      ? estimateProductionDurationSeconds({
          plannedQty,
          cycleTimeSeconds,
          piecesPerCycle,
          standardEfficiencyPercent,
        })
      : null;
  return {
    id: row.id,
    fgItemId: row.fgItemId,
    runSequence: row.runSequence,
    machineId: row.machineId,
    plannedQty,
    plannedDate,
    shiftId: row.shiftId ?? null,
    machineCode: row.machine?.machineCode ?? null,
    machineName: row.machine?.machineName ?? null,
    shiftCode: row.shift?.shiftCode ?? null,
    shiftName: row.shift?.shiftName ?? null,
    cycleTimeSeconds,
    piecesPerCycle,
    standardEfficiencyPercent,
    estimatedDurationSeconds,
    estimatedDurationLabel: formatDurationLabel(estimatedDurationSeconds),
    purgingRequired: Boolean(row.purgingRequired),
    purgingDetectionStatus: row.purgingDetectionStatus ?? null,
    purgingDetectionReason: row.purgingDetectionReason ?? null,
    previousProfileFingerprint: row.previousProfileFingerprint ?? null,
    targetProfileFingerprint: row.targetProfileFingerprint ?? null,
    physicalSetupRequired: row.physicalSetupRequired ?? null,
    physicalSetupStatus: row.physicalSetupStatus ?? null,
    physicalSetupReason: row.physicalSetupReason ?? null,
  };
}

const RUN_INCLUDE = Object.freeze({
  machine: { select: { id: true, machineCode: true, machineName: true, isActive: true } },
  shift: { select: { id: true, shiftCode: true, shiftName: true, isActive: true } },
});

module.exports = {
  EPS,
  QTY_RECONCILE_EPS,
  MAX_RUNS_PER_FG,
  normalizeProductionRunInputs,
  derivePlannedSetupCountFromRuns,
  deriveSetupCountByFgItemId,
  estimateProductionDurationSeconds,
  formatDurationLabel,
  validateAndEnrichProductionRuns,
  assertClientSetupCountMatchesDerived,
  assertClientPurgeCountMatchesDerived,
  assertClientCountsNotTrusted,
  derivePlanningCountsFromPersistedRuns,
  replaceRegularSoSnapshotProductionRuns,
  createWorkOrderProductionRuns,
  replaceRequirementSheetPlannedRuns,
  mapPersistedRunRow,
  RUN_INCLUDE,
  round3,
  n,
};
