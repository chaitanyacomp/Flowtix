/**
 * Production-run start confirmation + actual purging (PURGING_CONSUMPTION).
 *
 * Stock accounting: reuses createMaterialWastageNote (RM_WASTAGE + reason PURGING)
 * against already-issued production RM — never Store stock and never BOM ISSUE.
 * Does not change FG qty, runner weight, or good production.
 */

const { prisma } = require("../utils/prisma");
const { approvedBomWhere, approvedBomOrderBy } = require("./bomStatus");
const {
  allocateActualPurgingGramsToLeafRm,
  computePurgingRmForFg,
  round3,
} = require("./bomPurgingRmPlanningService");
const { buildPurgingProfileForFg } = require("./bomPurgingProfileService");
const {
  MATERIAL_STATE,
  loadMachineMaterialState,
  confirmMachineMaterialState,
} = require("./machineMaterialStateService");
const { createMaterialWastageNote } = require("./materialWastageService");
const { buildReturnableLinesForWorkOrder } = require("./materialReturnService");
const { STOCK_EPS } = require("./stockService");
const auditLog = require("./auditLog");

const PURGING_CONSUMPTION_EVENT = "PURGING_CONSUMPTION";

const MATERIAL_CONDITION = Object.freeze({
  SAME_MATERIAL_RETAINED: "SAME_MATERIAL_RETAINED",
  DIFFERENT_MATERIAL_RETAINED: "DIFFERENT_MATERIAL_RETAINED",
  MACHINE_CLEARED: "MACHINE_CLEARED",
  UNKNOWN: "UNKNOWN",
});

const SETUP_CONDITION = Object.freeze({
  SETUP_RETAINED: "SETUP_RETAINED",
  NEW_SETUP_COMPLETED: "NEW_SETUP_COMPLETED",
});

const CONFIRM_STATUS = Object.freeze({
  CONFIRMED: "CONFIRMED",
  REVERSED: "REVERSED",
});

const LEGACY_LABEL = "Legacy — start confirmation not applicable";
const FINGERPRINT_MAX_LEN = 64;

function resolveConfirmActorUserId(actor) {
  const id = Number(actor?.userId ?? actor?.id ?? 0);
  if (!(Number.isFinite(id) && id > 0)) {
    const err = new Error("Your session is missing a user identity. Sign in again and retry.");
    err.statusCode = 401;
    err.code = "START_CONFIRM_ACTOR_REQUIRED";
    err.expose = true;
    throw err;
  }
  return id;
}

function truncateFingerprint(fp) {
  if (fp == null) return null;
  const s = String(fp).trim();
  if (!s) return null;
  return s.length > FINGERPRINT_MAX_LEN ? s.slice(0, FINGERPRINT_MAX_LEN) : s;
}

/**
 * Operator-readable material profile, e.g. "PP Black Grinding — 100%".
 * Fingerprint hashes stay in technical/audit fields only.
 */
function formatReadableMaterialProfileLabel(components) {
  const rows = Array.isArray(components) ? components : [];
  const parts = rows
    .map((c) => {
      const name = String(c?.itemName ?? c?.rmItemName ?? "").trim() || `RM #${c?.rmItemId ?? "?"}`;
      const pct = Number(c?.mixPercent);
      if (!Number.isFinite(pct)) return name;
      const rounded = Math.round(pct * 1000) / 1000;
      return `${name} — ${rounded}%`;
    })
    .filter(Boolean);
  if (!parts.length) return "Not available";
  return parts.join(" · ");
}

function mapStartConfirmPersistenceError(e) {
  // eslint-disable-next-line no-console
  console.error("[productionRunStartConfirmation] persistence failed", {
    name: e?.name,
    code: e?.code,
    meta: e?.meta ?? null,
    message: e?.message,
    stack: e?.stack,
  });
  const err = new Error("Could not confirm production start. No changes were saved. Please try again or contact Admin.");
  err.statusCode = 500;
  err.code = "PRODUCTION_START_CONFIRM_FAILED";
  err.expose = true;
  err.cause = e;
  return err;
}

function assertProductionStartConfirmRole(actorRole) {
  const role = String(actorRole ?? "").trim().toUpperCase();
  if (role === "STORE") {
    const err = new Error("Store cannot confirm production start or actual purging.");
    err.statusCode = 403;
    err.code = "STORE_START_CONFIRM_FORBIDDEN";
    throw err;
  }
  if (role !== "ADMIN" && role !== "PRODUCTION") {
    const err = new Error("Only Production or Admin may confirm production start.");
    err.statusCode = 403;
    err.code = "START_CONFIRM_FORBIDDEN";
    throw err;
  }
  return role;
}

function assertPurgeDecisionOverrideRole(actorRole) {
  const role = String(actorRole ?? "").trim().toUpperCase();
  if (role !== "ADMIN" && role !== "PRODUCTION") {
    const err = new Error("Only Production or Admin may override the suggested purge decision.");
    err.statusCode = 403;
    err.code = "PURGE_DECISION_OVERRIDE_FORBIDDEN";
    throw err;
  }
}

/**
 * Map actual machine condition → suggested purge (product rules).
 */
function suggestPurgeFromActualCondition(actualMaterialCondition) {
  const c = String(actualMaterialCondition || "").toUpperCase();
  if (c === MATERIAL_CONDITION.SAME_MATERIAL_RETAINED) {
    return {
      suggestedPurgingRequired: false,
      suggestedPurgingReason: "Same material as this job — purging is not required.",
    };
  }
  if (c === MATERIAL_CONDITION.DIFFERENT_MATERIAL_RETAINED) {
    return {
      suggestedPurgingRequired: true,
      suggestedPurgingReason: "Different material is in the machine — purging is required.",
    };
  }
  if (c === MATERIAL_CONDITION.MACHINE_CLEARED) {
    return {
      suggestedPurgingRequired: true,
      suggestedPurgingReason: "Machine is empty/cleaned — purging is required.",
    };
  }
  if (c === MATERIAL_CONDITION.UNKNOWN) {
    return {
      suggestedPurgingRequired: true,
      suggestedPurgingReason: "Material is not sure — purging is required.",
    };
  }
  const err = new Error(
    "Actual machine condition must be SAME_MATERIAL_RETAINED, DIFFERENT_MATERIAL_RETAINED, MACHINE_CLEARED, or UNKNOWN.",
  );
  err.statusCode = 400;
  err.code = "INVALID_MATERIAL_CONDITION";
  throw err;
}

/**
 * Parse actual purge quantity in grams. Rejects unsafe values.
 * Zero allowed only when purging is not required.
 */
function parseActualPurgeQtyGrams(value, { purgingRequired }) {
  if (value == null || value === "") {
    if (!purgingRequired) return 0;
    const err = new Error("Actual purging quantity is required when purging is required.");
    err.statusCode = 400;
    err.code = "ACTUAL_PURGE_QTY_REQUIRED";
    throw err;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      const err = new Error("Actual purging quantity must be a finite number.");
      err.statusCode = 400;
      err.code = "ACTUAL_PURGE_QTY_INVALID";
      throw err;
    }
  } else if (typeof value === "string") {
    const raw = value.trim();
    if (raw === "" || !/^-?\d+(\.\d+)?$/.test(raw)) {
      const err = new Error("Actual purging quantity is malformed.");
      err.statusCode = 400;
      err.code = "ACTUAL_PURGE_QTY_INVALID";
      throw err;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      const err = new Error("Actual purging quantity must be a finite number.");
      err.statusCode = 400;
      err.code = "ACTUAL_PURGE_QTY_INVALID";
      throw err;
    }
    value = parsed;
  } else {
    const err = new Error("Actual purging quantity must be a number.");
    err.statusCode = 400;
    err.code = "ACTUAL_PURGE_QTY_INVALID";
    throw err;
  }
  const qty = round3(Number(value));
  if (qty < 0) {
    const err = new Error("Actual purging quantity cannot be negative.");
    err.statusCode = 400;
    err.code = "ACTUAL_PURGE_QTY_NEGATIVE";
    throw err;
  }
  if (!purgingRequired) {
    if (qty > STOCK_EPS) {
      const err = new Error("Actual purging quantity must be zero when purging is not required.");
      err.statusCode = 400;
      err.code = "ACTUAL_PURGE_QTY_MUST_BE_ZERO";
      throw err;
    }
    return 0;
  }
  if (qty <= STOCK_EPS) {
    const err = new Error("Actual purging quantity must be greater than zero when purging is required.");
    err.statusCode = 400;
    err.code = "ACTUAL_PURGE_QTY_REQUIRED";
    throw err;
  }
  return qty;
}

function parseSetupCondition(value) {
  const c = String(value || "").toUpperCase();
  if (!Object.values(SETUP_CONDITION).includes(c)) {
    const err = new Error("Physical setup must be SETUP_RETAINED or NEW_SETUP_COMPLETED.");
    err.statusCode = 400;
    err.code = "INVALID_SETUP_CONDITION";
    throw err;
  }
  return c;
}

function schemaReady(db) {
  return typeof db.workOrderProductionRunStartConfirmation?.findUnique === "function";
}

function allocationQueryReady(db) {
  return typeof db.workOrderProductionRunAllocation?.findMany === "function";
}

function throwStartConfirmSetupRequired(message) {
  const err = new Error(
    message ||
      "Production start confirmation is not available on this server. Apply migration 20260823200000 and restart before recording production on machine-planned work orders.",
  );
  err.statusCode = 503;
  err.code = "PRODUCTION_START_CONFIRM_SETUP_REQUIRED";
  throw err;
}

/**
 * Load FG run allocations. Database/query failures are never treated as legacy.
 */
async function listFgRunAllocationsOrThrow(tx, { workOrderId, fgItemId }) {
  if (!allocationQueryReady(tx)) {
    // Without allocation table access we cannot prove legacy vs new-model — fail closed.
    throwStartConfirmSetupRequired(
      "Work order production-run allocations are not available. Cannot determine production start gate.",
    );
  }
  try {
    return await tx.workOrderProductionRunAllocation.findMany({
      where: { workOrderId: Number(workOrderId), fgItemId: Number(fgItemId) },
      select: {
        id: true,
        workOrderId: true,
        fgItemId: true,
        machineId: true,
        runSequence: true,
        isActive: true,
      },
      orderBy: [{ runSequence: "asc" }, { id: "asc" }],
    });
  } catch (e) {
    const err = new Error(
      `Failed to load production-run allocations: ${e?.message || String(e)}`,
    );
    err.statusCode = 503;
    err.code = "PRODUCTION_RUN_ALLOCATION_QUERY_FAILED";
    err.cause = e;
    throw err;
  }
}

/**
 * Resolve gate mode for WO+FG. Legacy only when allocations are explicitly empty.
 * Does not decide per-run allow/block — use assertProductionRunStartConfirmed.
 */
async function resolveProductionRunStartGate(tx, { workOrderId, fgItemId }) {
  const allocations = await listFgRunAllocationsOrThrow(tx, { workOrderId, fgItemId });
  if (!allocations.length) {
    return {
      mode: "LEGACY",
      label: LEGACY_LABEL,
      required: false,
      blocked: false,
      allocationCount: 0,
      confirmedCount: 0,
      pendingRunAllocationIds: [],
    };
  }
  if (!schemaReady(tx)) {
    throwStartConfirmSetupRequired();
  }
  let confs = [];
  try {
    confs = await tx.workOrderProductionRunStartConfirmation.findMany({
      where: {
        workOrderId: Number(workOrderId),
        fgItemId: Number(fgItemId),
        status: CONFIRM_STATUS.CONFIRMED,
        runAllocationId: { in: allocations.map((a) => a.id) },
      },
      select: { runAllocationId: true },
    });
  } catch (e) {
    const err = new Error(
      `Failed to load production start confirmations: ${e?.message || String(e)}`,
    );
    err.statusCode = 503;
    err.code = "PRODUCTION_START_CONFIRM_QUERY_FAILED";
    err.cause = e;
    throw err;
  }
  const confirmedIds = new Set(confs.map((c) => Number(c.runAllocationId)));
  const pending = allocations.filter((a) => !confirmedIds.has(Number(a.id))).map((a) => a.id);
  return {
    mode: "MACHINE_RUN_PLANNING",
    label: "Machine-run planning — confirm each run before its production entries.",
    required: true,
    blocked: false,
    allocationCount: allocations.length,
    confirmedCount: confirmedIds.size,
    pendingRunAllocationIds: pending,
    confirmedRunAllocationIds: [...confirmedIds],
  };
}

/**
 * Per-run production entry gate.
 * - Legacy WO (no allocations): allow; runAllocationId must be null/omitted.
 * - New-model WO: require runAllocationId for this WO+FG, active, confirmed.
 * - Never trust client machineId alone — machine is taken from the allocation row.
 */
async function assertProductionRunStartConfirmed(
  tx,
  { workOrderId, fgItemId, runAllocationId = null, claimedMachineId = null },
) {
  const overview = await resolveProductionRunStartGate(tx, { workOrderId, fgItemId });

  if (overview.mode === "LEGACY") {
    if (runAllocationId != null && Number(runAllocationId) > 0) {
      const err = new Error(
        "This work order has no machine-run allocations. Production entries cannot reference a run allocation.",
      );
      err.statusCode = 400;
      err.code = "RUN_ALLOCATION_NOT_APPLICABLE";
      throw err;
    }
    return overview;
  }

  // New-model — confirmation schema already verified by resolveProductionRunStartGate.
  if (runAllocationId == null || !(Number(runAllocationId) > 0)) {
    const err = new Error(
      "Select a planned machine run (runAllocationId) for this production entry.",
    );
    err.statusCode = 409;
    err.code = "RUN_ALLOCATION_REQUIRED";
    err.details = overview;
    throw err;
  }

  const runId = Number(runAllocationId);
  let alloc;
  try {
    alloc = await tx.workOrderProductionRunAllocation.findUnique({
      where: { id: runId },
      include: {
        startConfirmation: { select: { id: true, status: true } },
        machine: { select: { id: true, machineCode: true, machineName: true } },
      },
    });
  } catch (e) {
    const err = new Error(
      `Failed to load production-run allocation: ${e?.message || String(e)}`,
    );
    err.statusCode = 503;
    err.code = "PRODUCTION_RUN_ALLOCATION_QUERY_FAILED";
    err.cause = e;
    throw err;
  }

  if (!alloc) {
    const err = new Error("Production run allocation not found.");
    err.statusCode = 404;
    err.code = "RUN_ALLOCATION_NOT_FOUND";
    throw err;
  }
  if (Number(alloc.workOrderId) !== Number(workOrderId)) {
    const err = new Error("Run allocation does not belong to this work order.");
    err.statusCode = 409;
    err.code = "RUN_ALLOCATION_WO_MISMATCH";
    throw err;
  }
  if (Number(alloc.fgItemId) !== Number(fgItemId)) {
    const err = new Error("Run allocation does not belong to this FG line.");
    err.statusCode = 409;
    err.code = "RUN_ALLOCATION_FG_MISMATCH";
    throw err;
  }
  if (alloc.isActive === false) {
    const err = new Error("This planned machine run is inactive and cannot receive production entries.");
    err.statusCode = 409;
    err.code = "RUN_ALLOCATION_INACTIVE";
    throw err;
  }
  if (
    claimedMachineId != null &&
    Number(claimedMachineId) > 0 &&
    Number(claimedMachineId) !== Number(alloc.machineId)
  ) {
    const err = new Error(
      "Assigned machine does not match the planned run allocation. Machine is taken from the planned run — not the client machineId alone.",
    );
    err.statusCode = 409;
    err.code = "RUN_ALLOCATION_MACHINE_MISMATCH";
    throw err;
  }

  const conf = alloc.startConfirmation;
  if (!conf || conf.status !== CONFIRM_STATUS.CONFIRMED) {
    const err = new Error(
      `Confirm production start for machine run #${alloc.runSequence} before recording production for this run.`,
    );
    err.statusCode = 409;
    err.code = "PRODUCTION_START_CONFIRMATION_REQUIRED";
    err.details = {
      ...overview,
      runAllocationId: runId,
      runSequence: alloc.runSequence,
      machineId: alloc.machineId,
    };
    throw err;
  }

  return {
    ...overview,
    blocked: false,
    runAllocationId: runId,
    runSequence: alloc.runSequence,
    machineId: alloc.machineId,
    machine: alloc.machine,
    startConfirmationId: conf.id,
  };
}

function mapConfirmation(row) {
  return {
    id: row.id,
    status: row.status,
    eventType: PURGING_CONSUMPTION_EVENT,
    actualMaterialCondition: row.actualMaterialCondition,
    actualSetupCondition: row.actualSetupCondition,
    suggestedPurgingRequired: row.suggestedPurgingRequired,
    suggestedPurgingReason: row.suggestedPurgingReason,
    actualPurgingRequired: row.actualPurgingRequired,
    purgeOverrideReason: row.purgeOverrideReason,
    purgeOverrideAt: row.purgeOverrideAt,
    plannedPurgeQtyGrams: round3(Number(row.plannedPurgeQtyGrams ?? 0)),
    actualPurgeQtyGrams: round3(Number(row.actualPurgeQtyGrams ?? 0)),
    purgeVarianceGrams: round3(Number(row.purgeVarianceGrams ?? 0)),
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy
      ? { id: row.confirmedBy.id, name: row.confirmedBy.name }
      : row.confirmedByUserId
        ? { id: row.confirmedByUserId, name: null }
        : null,
    machineStateVersionBefore: row.machineStateVersionBefore,
    machineStateVersionAfter: row.machineStateVersionAfter,
    purgeRmLines: (row.purgeRmLines || []).map((l) => ({
      itemId: l.itemId,
      itemName: l.item?.itemName ?? null,
      unit: l.item?.unit ?? null,
      plannedQtyKg: round3(Number(l.plannedQtyKg ?? 0)),
      actualQtyKg: round3(Number(l.actualQtyKg ?? 0)),
      fromLocationId: l.fromLocationId,
      materialWastageNoteId: l.materialWastageNoteId,
      materialWastageDocNo: l.materialWastageNote?.docNo ?? null,
      eventType: PURGING_CONSUMPTION_EVENT,
    })),
  };
}

async function loadStartPreview(db, runAllocationId) {
  if (!schemaReady(db)) {
    const err = new Error("Production start confirmation is not available on this server.");
    err.statusCode = 503;
    err.code = "START_CONFIRM_SCHEMA_MISSING";
    throw err;
  }
  const alloc = await db.workOrderProductionRunAllocation.findUnique({
    where: { id: Number(runAllocationId) },
    include: {
      machine: { select: { id: true, machineCode: true, machineName: true } },
      fgItem: { select: { id: true, itemName: true, unit: true } },
      workOrder: {
        select: {
          id: true,
          docNo: true,
          salesOrder: { select: { id: true, orderType: true, docNo: true } },
        },
      },
      workOrderLine: { select: { id: true, qty: true } },
      startConfirmation: {
        include: {
          purgeRmLines: {
            include: {
              item: { select: { id: true, itemName: true, unit: true } },
              materialWastageNote: { select: { id: true, docNo: true } },
            },
          },
          confirmedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!alloc) {
    const err = new Error("Production run allocation not found.");
    err.statusCode = 404;
    err.code = "RUN_ALLOCATION_NOT_FOUND";
    throw err;
  }

  const bom = await db.bom.findFirst({
    where: approvedBomWhere(alloc.fgItemId),
    orderBy: approvedBomOrderBy,
    select: { id: true, revisionNo: true, standardPurgingQtyGrams: true, status: true },
  });
  const profile = await buildPurgingProfileForFg(db, alloc.fgItemId);
  const machineState = await loadMachineMaterialState(db, alloc.machineId);
  const plannedPurge = await computePurgingRmForFg(db, alloc.fgItemId, alloc.purgingRequired ? 1 : 0);

  const profileRmIds = [
    ...new Set([
      ...(profile.components || []).map((c) => Number(c.rmItemId)),
      ...(plannedPurge.allocationLines || []).map((l) => Number(l.rmItemId)),
    ]),
  ].filter((id) => Number.isFinite(id) && id > 0);

  const rmItems =
    profileRmIds.length > 0
      ? await db.item.findMany({
          where: { id: { in: profileRmIds } },
          select: { id: true, itemName: true },
        })
      : [];
  const rmNameById = new Map(rmItems.map((i) => [Number(i.id), i.itemName]));

  const targetComponents = (profile.components || []).map((c) => ({
    rmItemId: c.rmItemId,
    mixPercent: c.mixPercent,
    itemName: rmNameById.get(Number(c.rmItemId)) ?? null,
  }));
  const targetProfileLabel = formatReadableMaterialProfileLabel(targetComponents);

  let machineProfileLabel = null;
  const machineComponentsRaw = machineState.currentProfileJson;
  if (Array.isArray(machineComponentsRaw) && machineComponentsRaw.length) {
    const machineComponents = machineComponentsRaw.map((c) => ({
      rmItemId: c.rmItemId,
      mixPercent: c.mixPercent,
      itemName: rmNameById.get(Number(c.rmItemId)) ?? null,
    }));
    // Load any machine-only RM names
    const missing = machineComponents
      .map((c) => Number(c.rmItemId))
      .filter((id) => id > 0 && !rmNameById.has(id));
    if (missing.length) {
      const extra = await db.item.findMany({
        where: { id: { in: missing } },
        select: { id: true, itemName: true },
      });
      for (const i of extra) rmNameById.set(Number(i.id), i.itemName);
      for (const c of machineComponents) {
        c.itemName = rmNameById.get(Number(c.rmItemId)) ?? c.itemName;
      }
    }
    machineProfileLabel = formatReadableMaterialProfileLabel(machineComponents);
  }

  const allocationPreviewKg = (plannedPurge.allocationLines || []).map((row) => ({
    rmItemId: row.rmItemId,
    itemName: rmNameById.get(Number(row.rmItemId)) ?? null,
    mixPercent: row.mixPercent,
    purgingQtyKg: row.purgingQtyKg,
  }));

  return {
    runAllocationId: alloc.id,
    runSequence: alloc.runSequence,
    workOrderId: alloc.workOrderId,
    workOrderNo: alloc.workOrder?.docNo ?? null,
    orderType: alloc.workOrder?.salesOrder?.orderType ?? null,
    workOrderLineId: alloc.workOrderLineId,
    machine: alloc.machine,
    fgItem: alloc.fgItem,
    bom: bom
      ? {
          id: bom.id,
          revisionLabel: bom.revisionNo != null ? `Rev ${bom.revisionNo}` : null,
          standardPurgingQtyGrams: round3(Number(bom.standardPurgingQtyGrams ?? 0)),
        }
      : null,
    planned: {
      purgingRequired: Boolean(alloc.purgingRequired),
      detectionStatus: alloc.purgingDetectionStatus,
      detectionReason: alloc.purgingDetectionReason,
      previousProfileFingerprint: alloc.previousProfileFingerprint,
      targetProfileFingerprint: alloc.targetProfileFingerprint || profile.fingerprint,
      targetProfileLabel,
      targetProfileComponents: targetComponents,
      profileFingerprint: profile.fingerprint,
      plannedPurgeQtyGrams: plannedPurge.totalPlannedPurgingGrams,
      allocationPreviewKg,
    },
    machineState: {
      materialState: machineState.materialState,
      currentProfileFingerprint: machineState.currentProfileFingerprint,
      currentProfileLabel: machineProfileLabel,
      version: machineState.version,
      sourceWorkOrderId: machineState.sourceWorkOrderId,
      sourceRunAllocationId: machineState.sourceRunAllocationId,
    },
    confirmation: alloc.startConfirmation ? mapConfirmation(alloc.startConfirmation) : null,
    legacy: false,
  };
}

async function listStartConfirmationsForWorkOrder(db, workOrderId) {
  if (!allocationQueryReady(db)) {
    throwStartConfirmSetupRequired(
      "Work order production-run allocations are not available. Cannot list production start status.",
    );
  }
  const woId = Number(workOrderId);
  let allocations;
  try {
    allocations = await db.workOrderProductionRunAllocation.findMany({
      where: { workOrderId: woId },
      include: {
        machine: { select: { id: true, machineCode: true, machineName: true } },
        fgItem: { select: { id: true, itemName: true } },
        startConfirmation: schemaReady(db)
          ? {
              include: {
                confirmedBy: { select: { id: true, name: true } },
                purgeRmLines: true,
              },
            }
          : false,
      },
      orderBy: [{ fgItemId: "asc" }, { runSequence: "asc" }],
    });
  } catch (e) {
    const err = new Error(
      `Failed to load production-run allocations: ${e?.message || String(e)}`,
    );
    err.statusCode = 503;
    err.code = "PRODUCTION_RUN_ALLOCATION_QUERY_FAILED";
    err.cause = e;
    throw err;
  }
  if (!allocations.length) {
    return { mode: "LEGACY", label: LEGACY_LABEL, runs: [] };
  }
  if (!schemaReady(db)) {
    throwStartConfirmSetupRequired();
  }
  return {
    mode: "MACHINE_RUN_PLANNING",
    label: null,
    runs: allocations.map((a) => ({
      runAllocationId: a.id,
      runSequence: a.runSequence,
      machine: a.machine,
      fgItem: a.fgItem,
      isActive: a.isActive !== false,
      plannedPurgingRequired: a.purgingRequired,
      plannedDetectionReason: a.purgingDetectionReason,
      confirmation: a.startConfirmation ? mapConfirmation(a.startConfirmation) : null,
      needsConfirmation:
        a.isActive !== false &&
        (!a.startConfirmation || a.startConfirmation.status !== CONFIRM_STATUS.CONFIRMED),
      entryAllowed:
        a.isActive !== false &&
        a.startConfirmation?.status === CONFIRM_STATUS.CONFIRMED,
    })),
  };
}

/**
 * Atomic confirm: decision + purge RM_WASTAGE lines + machine state RETAINED.
 */
async function confirmProductionRunStart(input, actor = {}, db = prisma) {
  assertProductionStartConfirmRole(actor.role);
  const confirmedByUserId = resolveConfirmActorUserId(actor);
  if (!schemaReady(db)) {
    const err = new Error("Production start confirmation is not available on this server.");
    err.statusCode = 503;
    err.code = "START_CONFIRM_SCHEMA_MISSING";
    throw err;
  }

  const runAllocationId = Number(input.runAllocationId);
  const expectedVersion =
    input.expectedMachineStateVersion != null ? Number(input.expectedMachineStateVersion) : null;
  const idempotencyKey =
    input.idempotencyKey != null && String(input.idempotencyKey).trim()
      ? String(input.idempotencyKey).trim().slice(0, 64)
      : null;

  const run = async (tx) => {
    if (idempotencyKey) {
      const byKey = await tx.workOrderProductionRunStartConfirmation.findUnique({
        where: { idempotencyKey },
        include: {
          purgeRmLines: {
            include: {
              item: { select: { id: true, itemName: true, unit: true } },
              materialWastageNote: { select: { id: true, docNo: true } },
            },
          },
          confirmedBy: { select: { id: true, name: true } },
        },
      });
      if (byKey) return { confirmation: mapConfirmation(byKey), idempotent: true };
    }

    const existing = await tx.workOrderProductionRunStartConfirmation.findUnique({
      where: { runAllocationId },
      include: {
        purgeRmLines: {
          include: {
            item: { select: { id: true, itemName: true, unit: true } },
            materialWastageNote: { select: { id: true, docNo: true } },
          },
        },
        confirmedBy: { select: { id: true, name: true } },
      },
    });
    if (existing && existing.status === CONFIRM_STATUS.CONFIRMED) {
      return { confirmation: mapConfirmation(existing), idempotent: true };
    }
    if (existing && existing.status === CONFIRM_STATUS.REVERSED) {
      const err = new Error(
        "This run start was reversed. Use the audited correction flow — do not re-confirm silently.",
      );
      err.statusCode = 409;
      err.code = "START_CONFIRM_REVERSED";
      throw err;
    }

    const alloc = await tx.workOrderProductionRunAllocation.findUnique({
      where: { id: runAllocationId },
      include: {
        workOrder: { select: { id: true, docNo: true } },
        fgItem: { select: { id: true, itemName: true } },
      },
    });
    if (!alloc) {
      const err = new Error("Production run allocation not found.");
      err.statusCode = 404;
      throw err;
    }

    const actualMaterialCondition = String(input.actualMaterialCondition || "").toUpperCase();
    const actualSetupCondition = parseSetupCondition(input.actualSetupCondition);
    const suggestion = suggestPurgeFromActualCondition(actualMaterialCondition);

    let actualPurgingRequired = suggestion.suggestedPurgingRequired;
    let purgeOverrideReason = null;
    let purgeOverrideByUserId = null;
    let purgeOverrideAt = null;

    if (typeof input.actualPurgingRequired === "boolean") {
      if (Boolean(input.actualPurgingRequired) !== suggestion.suggestedPurgingRequired) {
        assertPurgeDecisionOverrideRole(actor.role);
        const reason = String(input.purgeOverrideReason || "").trim();
        if (!reason) {
          const err = new Error("Override of suggested purge decision requires a mandatory reason.");
          err.statusCode = 400;
          err.code = "PURGE_OVERRIDE_REASON_REQUIRED";
          throw err;
        }
        actualPurgingRequired = Boolean(input.actualPurgingRequired);
        purgeOverrideReason = reason.slice(0, 500);
        purgeOverrideByUserId = confirmedByUserId;
        purgeOverrideAt = new Date();
      } else {
        actualPurgingRequired = Boolean(input.actualPurgingRequired);
      }
    }

    const bom = await tx.bom.findFirst({
      where: approvedBomWhere(alloc.fgItemId),
      orderBy: approvedBomOrderBy,
      select: { id: true, revisionNo: true, standardPurgingQtyGrams: true },
    });
    const standardGrams = bom ? round3(Number(bom.standardPurgingQtyGrams ?? 0)) : 0;
    const plannedPurgeQtyGrams = actualPurgingRequired ? standardGrams : 0;
    const rawActualQty =
      input.actualPurgeQtyGrams != null && input.actualPurgeQtyGrams !== ""
        ? input.actualPurgeQtyGrams
        : actualPurgingRequired
          ? standardGrams
          : 0;
    const actualPurgeQtyGrams = parseActualPurgeQtyGrams(rawActualQty, {
      purgingRequired: actualPurgingRequired,
    });
    const purgeVarianceGrams = round3(actualPurgeQtyGrams - plannedPurgeQtyGrams);

    const plannedAlloc = await computePurgingRmForFg(
      tx,
      alloc.fgItemId,
      actualPurgingRequired && plannedPurgeQtyGrams > STOCK_EPS ? 1 : 0,
    );
    const actualLines = actualPurgingRequired
      ? await allocateActualPurgingGramsToLeafRm(tx, alloc.fgItemId, actualPurgeQtyGrams)
      : [];

    const returnable = await buildReturnableLinesForWorkOrder(tx, {
      workOrderId: alloc.workOrderId,
    });
    const fromLocationId = returnable.defaultFromLocationId;
    if (actualLines.length > 0 && !(fromLocationId > 0)) {
      const err = new Error(
        "No production location with issued RM found. Issue RM via Material Request / Material Issue before confirming purge.",
      );
      err.statusCode = 409;
      err.code = "PRODUCTION_PURGE_RM_INSUFFICIENT";
      throw err;
    }

    const shortages = [];
    for (const line of actualLines) {
      const ret = returnable.lines.find((l) => Number(l.itemId) === Number(line.rmItemId));
      const available = ret ? Number(ret.returnableQty ?? 0) : 0;
      if (line.qtyKg > available + STOCK_EPS) {
        shortages.push({
          itemId: line.rmItemId,
          itemName: ret?.itemName ?? `Item #${line.rmItemId}`,
          requiredKg: line.qtyKg,
          availableKg: available,
        });
      }
    }
    if (shortages.length) {
      const err = new Error(
        "Insufficient issued production RM for purging. Raise an additional Material Request — purge was not posted.",
      );
      err.statusCode = 409;
      err.code = "PRODUCTION_PURGE_RM_INSUFFICIENT";
      err.details = { shortages, hint: "Use Production Material Request / shortage workflow." };
      throw err;
    }

    const machineState = await loadMachineMaterialState(tx, alloc.machineId);
    const versionBefore = machineState.version ?? 0;
    if (expectedVersion != null && Number(expectedVersion) !== Number(versionBefore)) {
      const err = new Error(
        "Machine material state was updated by another work order. Reload and confirm again.",
      );
      err.statusCode = 409;
      err.code = "MACHINE_STATE_VERSION_CONFLICT";
      err.details = { expectedVersion: Number(expectedVersion), currentVersion: versionBefore };
      throw err;
    }

    const profile = await buildPurgingProfileForFg(tx, alloc.fgItemId);
    const targetFp = truncateFingerprint(alloc.targetProfileFingerprint || profile.fingerprint || null);

    let confirmation;
    try {
      confirmation = await tx.workOrderProductionRunStartConfirmation.create({
        data: {
          workOrderId: alloc.workOrderId,
          runAllocationId: alloc.id,
          machineId: alloc.machineId,
          fgItemId: alloc.fgItemId,
          workOrderLineId: alloc.workOrderLineId,
          bomId: bom?.id ?? null,
          bomRevisionLabel: bom?.revisionNo != null ? `Rev ${bom.revisionNo}`.slice(0, 64) : null,
          status: CONFIRM_STATUS.CONFIRMED,
          plannedProfileFingerprint: truncateFingerprint(alloc.previousProfileFingerprint),
          targetProfileFingerprint: targetFp,
          plannedPurgingRequired: Boolean(alloc.purgingRequired),
          plannedDetectionStatus: alloc.purgingDetectionStatus || "CONFIRMATION_REQUIRED",
          plannedDetectionReason:
            alloc.purgingDetectionReason != null
              ? String(alloc.purgingDetectionReason).slice(0, 500)
              : null,
          plannedPurgeQtyGrams: String(plannedPurgeQtyGrams),
          actualMaterialCondition,
          actualSetupCondition,
          suggestedPurgingRequired: suggestion.suggestedPurgingRequired,
          suggestedPurgingReason: suggestion.suggestedPurgingReason
            ? String(suggestion.suggestedPurgingReason).slice(0, 500)
            : null,
          actualPurgingRequired,
          purgeOverrideReason,
          purgeOverrideByUserId,
          purgeOverrideAt,
          actualPurgeQtyGrams: String(actualPurgeQtyGrams),
          purgeVarianceGrams: String(purgeVarianceGrams),
          machineStateVersionBefore: versionBefore,
          confirmedByUserId,
          idempotencyKey,
        },
      });
    } catch (e) {
      throw mapStartConfirmPersistenceError(e);
    }

    for (const line of actualLines) {
      const plannedKg =
        plannedAlloc.purgingRmByItemId.get(line.rmItemId) ??
        plannedAlloc.purgingRmByItemId.get(Number(line.rmItemId)) ??
        0;
      const note = await createMaterialWastageNote(
        {
          workOrderId: alloc.workOrderId,
          fromLocationId,
          itemId: line.rmItemId,
          qty: line.qtyKg,
          reason: "PURGING",
          remarks: `[${PURGING_CONSUMPTION_EVENT}] startConfirmationId=${confirmation.id} runAllocationId=${alloc.id}`,
        },
        { userId: confirmedByUserId, role: actor.role },
        tx,
      );
      await tx.workOrderProductionRunPurgeRmLine.create({
        data: {
          startConfirmationId: confirmation.id,
          itemId: line.rmItemId,
          plannedQtyKg: String(round3(plannedKg)),
          actualQtyKg: String(line.qtyKg),
          fromLocationId,
          materialWastageNoteId: note.id,
        },
      });
    }

    const updatedState = await confirmMachineMaterialState(tx, {
      machineId: alloc.machineId,
      materialState: MATERIAL_STATE.RETAINED,
      profileFingerprint: targetFp,
      profileJson: profile.components ?? null,
      sourceWorkOrderId: alloc.workOrderId,
      sourceRunAllocationId: alloc.id,
      confirmedByUserId,
      expectedVersion: versionBefore,
    });

    await tx.workOrderProductionRunStartConfirmation.update({
      where: { id: confirmation.id },
      data: { machineStateVersionAfter: updatedState.version },
    });

    await auditLog.write(tx, {
      action: auditLog.AuditAction.CREATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `PROD_RUN_START:${confirmation.id}`,
      actorUserId: confirmedByUserId,
      actorRole: actor.role,
      summary: `Production start confirmed for run #${alloc.id} — purge ${
        actualPurgingRequired ? `${actualPurgeQtyGrams}g` : "not required"
      }`,
      payload: {
        module: "PRODUCTION_RUN_START",
        actionLabel: PURGING_CONSUMPTION_EVENT,
        ref: { type: "WO_PROD_RUN_START_CONFIRM", id: String(confirmation.id) },
        snapshot: {
          runAllocationId: alloc.id,
          workOrderId: alloc.workOrderId,
          actualPurgingRequired,
          actualPurgeQtyGrams,
          purgeOverrideReason,
        },
      },
    });

    const full = await tx.workOrderProductionRunStartConfirmation.findUnique({
      where: { id: confirmation.id },
      include: {
        purgeRmLines: {
          include: {
            item: { select: { id: true, itemName: true, unit: true } },
            materialWastageNote: { select: { id: true, docNo: true } },
          },
        },
        confirmedBy: { select: { id: true, name: true } },
      },
    });
    return { confirmation: mapConfirmation(full), idempotent: false };
  };

  if (typeof db.$transaction === "function") {
    return db.$transaction(run);
  }
  return run(db);
}

module.exports = {
  PURGING_CONSUMPTION_EVENT,
  MATERIAL_CONDITION,
  SETUP_CONDITION,
  CONFIRM_STATUS,
  LEGACY_LABEL,
  assertProductionStartConfirmRole,
  resolveConfirmActorUserId,
  formatReadableMaterialProfileLabel,
  truncateFingerprint,
  mapStartConfirmPersistenceError,
  suggestPurgeFromActualCondition,
  parseActualPurgeQtyGrams,
  parseSetupCondition,
  resolveProductionRunStartGate,
  assertProductionRunStartConfirmed,
  loadStartPreview,
  listStartConfirmationsForWorkOrder,
  confirmProductionRunStart,
  mapConfirmation,
};
