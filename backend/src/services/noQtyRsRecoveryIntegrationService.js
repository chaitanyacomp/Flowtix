/**
 * Batch 3C / Phase 2B — Requirement Sheet ↔ Recovery Engine integration.
 *
 * Phase 2B: PRODUCTION_SHORTFALL and QC_FINAL_REJECTION are NEVER auto-allocated.
 * Allocation happens only via Keep (noQtyRsRecoveryDecisionService).
 *
 * This module owns: line component sync from active allocations,
 * discovery stubs (no allocate), cancel/delete reverse, QC helpers.
 */

const auditLog = require("./auditLog");
const {
  EPS,
  getAvailableRecovery,
  reverseRecovery,
  reverseAllocationsForSheet,
  ACTIVE_ALLOC_STATUSES,
} = require("./noQtyRecoveryService");

const PRODUCTION_SHORTFALL = "PRODUCTION_SHORTFALL";
/** @deprecated Phase 2B — auto sync source types removed; Keep/Waive owns allocation. */
const DEFAULT_SYNC_SOURCE_TYPES = Object.freeze([PRODUCTION_SHORTFALL]);

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function rsRecoveryError(message, { statusCode = 409, code = "RS_RECOVERY_ERROR" } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Recompute line composition from active allocations + base/adj.
 * Legacy shortfallQtySnapshot mirrors production shortfall only.
 */
async function syncRequirementSheetLineComponents(tx, requirementSheetLineId) {
  const lineId = Number(requirementSheetLineId);
  const line = await tx.requirementSheetLine.findUnique({ where: { id: lineId } });
  if (!line) {
    throw rsRecoveryError("Requirement sheet line not found.", {
      statusCode: 404,
      code: "RS_LINE_NOT_FOUND",
    });
  }

  const allocs = await tx.recoveryAllocation.findMany({
    where: {
      requirementSheetLineId: lineId,
      status: { in: [...ACTIVE_ALLOC_STATUSES] },
    },
    include: { recoverySource: { select: { recoveryType: true } } },
  });

  let productionShortfallQty = 0;
  let qcRejectionRecoveryQty = 0;
  for (const a of allocs) {
    const qty = round3(n(a.allocatedQty));
    if (a.recoverySource?.recoveryType === "PRODUCTION_SHORTFALL") {
      productionShortfallQty = round3(productionShortfallQty + qty);
    } else if (a.recoverySource?.recoveryType === "QC_FINAL_REJECTION") {
      qcRejectionRecoveryQty = round3(qcRejectionRecoveryQty + qty);
    }
  }

  const baseDemandQty = round3(n(line.baseDemandQty ?? line.requirementQty));
  const approvedManualAdjustmentQty = round3(n(line.approvedManualAdjustmentQty));
  const totalRsQty = round3(
    baseDemandQty + productionShortfallQty + qcRejectionRecoveryQty + approvedManualAdjustmentQty,
  );

  return tx.requirementSheetLine.update({
    where: { id: lineId },
    data: {
      baseDemandQty: String(baseDemandQty),
      productionShortfallQty: String(productionShortfallQty),
      qcRejectionRecoveryQty: String(qcRejectionRecoveryQty),
      approvedManualAdjustmentQty: String(approvedManualAdjustmentQty),
      shortfallQtySnapshot: String(productionShortfallQty),
      totalRsQty: String(totalRsQty),
    },
  });
}

async function syncAllSheetLineComponents(tx, requirementSheetId) {
  const lines = await tx.requirementSheetLine.findMany({
    where: { sheetId: Number(requirementSheetId) },
    select: { id: true },
  });
  const updated = [];
  for (const ln of lines) {
    updated.push(await syncRequirementSheetLineComponents(tx, ln.id));
  }
  return updated;
}

/**
 * Ensure FG lines exist for items with available recovery (both types). Does NOT allocate.
 * @deprecated Prefer ensureLinesForPendingRecoveryItems in decision service; kept for compatibility.
 */
async function ensureLinesForProductionShortfallItems(tx, { salesOrderId, requirementSheetId, itemIds }) {
  void itemIds;
  const { ensureLinesForPendingRecoveryItems } = require("./noQtyRsRecoveryDecisionService");
  return ensureLinesForPendingRecoveryItems(tx, { salesOrderId, requirementSheetId });
}

/**
 * Locate the canonical editable next-cycle draft RS for late recovery discovery.
 * Does not create a sheet. Never returns locked/cancelled/closed-cycle drafts or excluded source RS.
 *
 * @returns {Promise<{ id: number, salesOrderId: number, cycleId: number|null } | null>}
 */
async function findEligibleDraftRequirementSheetForRecoverySync(
  tx,
  { salesOrderId, excludeRequirementSheetIds = [] } = {},
) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true, currentCycleId: true },
  });
  if (!so || so.orderType !== "NO_QTY") return null;

  const exclude = new Set(
    (excludeRequirementSheetIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0),
  );

  const drafts = await tx.requirementSheet.findMany({
    where: { salesOrderId: soId, status: "DRAFT" },
    select: {
      id: true,
      salesOrderId: true,
      cycleId: true,
      createdAt: true,
      cycle: { select: { id: true, cycleNo: true, status: true } },
    },
    orderBy: [{ id: "desc" }],
  });

  const eligible = drafts.filter((d) => {
    if (exclude.has(Number(d.id))) return false;
    const cycleStatus = d.cycle?.status;
    if (cycleStatus === "CLOSED") return false;
    return true;
  });
  if (!eligible.length) return null;

  const currentCycleId = so.currentCycleId != null ? Number(so.currentCycleId) : null;
  if (Number.isFinite(currentCycleId) && currentCycleId > 0) {
    const onActive = eligible.find((d) => Number(d.cycleId) === currentCycleId);
    if (onActive) {
      return { id: onActive.id, salesOrderId: onActive.salesOrderId, cycleId: onActive.cycleId ?? null };
    }
  }

  eligible.sort((a, b) => {
    const ca = Number(a.cycle?.cycleNo ?? 0);
    const cb = Number(b.cycle?.cycleNo ?? 0);
    if (cb !== ca) return cb - ca;
    return Number(b.id) - Number(a.id);
  });
  const pick = eligible[0];
  return { id: pick.id, salesOrderId: pick.salesOrderId, cycleId: pick.cycleId ?? null };
}

/**
 * Phase 2B: discovery-only. Does NOT allocate.
 * Seeds PENDING Keep/Waive decisions via noQtyRsRecoveryDecisionService.
 * Name retained for call-site compatibility.
 */
async function syncDraftRsWithAvailableRecovery(
  tx,
  {
    requirementSheetId,
    sourceTypes = DEFAULT_SYNC_SOURCE_TYPES,
    itemIds = null,
    actorUserId = null,
    actorRole = null,
    salesOrderId = null,
  } = {},
) {
  void sourceTypes;
  void itemIds;
  void salesOrderId;
  void actorRole;
  const { syncPendingRecoveryDecisionsForSheet } = require("./noQtyRsRecoveryDecisionService");
  const result = await syncPendingRecoveryDecisionsForSheet(tx, {
    requirementSheetId,
    actorUserId,
  });
  return {
    skipped: Boolean(result.skipped),
    reason: result.reason || null,
    allocated: [],
    createdItemIds: [],
    requirementSheetId: Number(requirementSheetId),
    decisions: result.decisions || [],
  };
}

/**
 * Phase 2B: after recovery is created, sync PENDING decisions on eligible draft — no allocate.
 */
async function syncEligibleDraftRsAfterProductionShortfallCreated(
  tx,
  {
    salesOrderId,
    excludeRequirementSheetIds = [],
    actorUserId = null,
    actorRole = null,
  } = {},
) {
  void actorRole;
  const draft = await findEligibleDraftRequirementSheetForRecoverySync(tx, {
    salesOrderId,
    excludeRequirementSheetIds,
  });
  if (!draft) {
    return {
      synced: false,
      reason: "NO_ELIGIBLE_DRAFT_RS",
      requirementSheetId: null,
      allocated: [],
      createdItemIds: [],
    };
  }

  const result = await syncDraftRsWithAvailableRecovery(tx, {
    requirementSheetId: draft.id,
    salesOrderId: draft.salesOrderId,
    actorUserId,
  });

  return {
    synced: !result.skipped,
    reason: result.reason || "DECISIONS_SYNCED",
    requirementSheetId: draft.id,
    allocated: [],
    createdItemIds: result.createdItemIds || [],
  };
}

/**
 * @deprecated Phase 2B — auto-allocate removed. Seeds PENDING decisions only.
 */
async function autoAllocateProductionShortfallForSheet(
  tx,
  { salesOrderId, requirementSheetId, itemIds = null, actorUserId = null, actorRole = null },
) {
  const result = await syncDraftRsWithAvailableRecovery(tx, {
    requirementSheetId,
    salesOrderId,
    itemIds,
    actorUserId,
    actorRole,
  });
  return { allocated: [], createdItemIds: result.createdItemIds || [], decisions: result.decisions };
}

/**
 * Legacy facade used by RS create — Phase 2B: seed PENDING decisions only (no allocate).
 */
async function consumeCarryForwardPendingForRequirementSheet(tx, args) {
  const result = await syncDraftRsWithAvailableRecovery(tx, {
    salesOrderId: args.salesOrderId,
    requirementSheetId: args.requirementSheetId,
    itemIds: args.itemIds,
    actorUserId: args.actorUserId,
    actorRole: args.actorRole,
  });
  return {
    consumed: [],
    allocated: [],
    createdItemIds: result.createdItemIds || [],
    ...result,
  };
}

/**
 * @deprecated Phase 2B — use Keep (keepItemRecovery) for all recovery types.
 * Thin alias: Keep for the source's FG item (all-or-nothing for that item).
 */
async function allocateQcRecoveryToSheet(
  tx,
  { requirementSheetId, recoverySourceId, qty, actorUserId = null },
) {
  void qty;
  const source = await tx.carryForwardPending.findUnique({
    where: { id: Number(recoverySourceId) },
    select: { id: true, itemId: true, recoveryType: true },
  });
  if (!source) {
    throw rsRecoveryError("Recovery source not found.", { statusCode: 404, code: "RECOVERY_SOURCE_NOT_FOUND" });
  }
  const { keepItemRecovery } = require("./noQtyRsRecoveryDecisionService");
  const kept = await keepItemRecovery(tx, {
    requirementSheetId,
    itemId: source.itemId,
    actorUserId,
  });
  const sheet = await tx.requirementSheet.findUnique({
    where: { id: Number(requirementSheetId) },
    select: { salesOrderId: true },
  });
  const remaining = await getAvailableRecovery(tx, {
    salesOrderId: sheet?.salesOrderId,
    itemId: source.itemId,
    recoveryType: "QC_FINAL_REJECTION",
  });
  return {
    allocation: null,
    recoverySource: kept.decision,
    availableQcRecovery: remaining,
    line: null,
    redirectedToKeep: true,
    decision: kept.decision,
  };
}

/**
 * Reverse a RESERVED (or cancel-permitted) allocation and refresh line components.
 */
async function reverseSheetRecoveryAllocation(tx, { allocationId, actorUserId = null, reason = null }) {
  const allocation = await tx.recoveryAllocation.findUnique({
    where: { id: Number(allocationId) },
    select: { id: true, requirementSheetLineId: true, requirementSheetId: true, status: true },
  });
  if (!allocation) {
    throw rsRecoveryError("Recovery allocation not found.", { statusCode: 404, code: "ALLOCATION_NOT_FOUND" });
  }
  const reversed = await reverseRecovery(tx, { allocationId: allocation.id, actorUserId, reason });
  if (allocation.requirementSheetLineId) {
    await syncRequirementSheetLineComponents(tx, allocation.requirementSheetLineId);
  }
  return reversed;
}

/**
 * Phase 2B lock finalize — decision gate + commit KEPT reservations. No auto-allocate.
 */
async function finalizeRecoveryOnRequirementSheetLock(tx, { requirementSheetId, actorUserId = null }) {
  const { finalizeRecoveryDecisionsOnRequirementSheetLock } = require("./noQtyRsRecoveryDecisionService");
  return finalizeRecoveryDecisionsOnRequirementSheetLock(tx, { requirementSheetId, actorUserId });
}

/**
 * After allowed cancel (status already CANCELLED): reverse decisions + allocations.
 */
async function reverseRecoveryOnRequirementSheetCancel(tx, { requirementSheetId, actorUserId = null, reason = null }) {
  void reason;
  const { reverseRecoveryDecisionsForSheet } = require("./noQtyRsRecoveryDecisionService");
  await reverseRecoveryDecisionsForSheet(tx, {
    requirementSheetId,
    actorUserId,
    deleteDecisionRows: false,
  });
  return reverseAllocationsForSheet(tx, {
    requirementSheetId,
    actorUserId,
    reason: reason || "Requirement sheet cancelled",
    deleteRows: false,
  });
}

/**
 * Draft delete: reverse decisions + allocations, delete allocation rows, then caller deletes sheet.
 */
async function reverseRecoveryOnDraftRequirementSheetDelete(tx, { requirementSheetId, actorUserId = null }) {
  const { reverseRecoveryDecisionsForSheet } = require("./noQtyRsRecoveryDecisionService");
  await reverseRecoveryDecisionsForSheet(tx, {
    requirementSheetId,
    actorUserId,
    deleteDecisionRows: true,
  });
  await reverseAllocationsForSheet(tx, {
    requirementSheetId,
    actorUserId,
    reason: "Draft requirement sheet deleted",
    deleteRows: true,
  });
}

/**
 * Available QC recovery for items on (or allocatable to) this sheet.
 */
async function getQcRecoveryAvailabilityForSheet(db, requirementSheetId) {
  const sheet = await db.requirementSheet.findUnique({
    where: { id: Number(requirementSheetId) },
    select: { id: true, salesOrderId: true, status: true },
  });
  if (!sheet) {
    throw rsRecoveryError("Requirement sheet not found.", { statusCode: 404, code: "RS_NOT_FOUND" });
  }
  const available = await getAvailableRecovery(db, {
    salesOrderId: sheet.salesOrderId,
    recoveryType: "QC_FINAL_REJECTION",
  });
  const activeOnSheet = await db.recoveryAllocation.findMany({
    where: {
      requirementSheetId: sheet.id,
      status: { in: [...ACTIVE_ALLOC_STATUSES] },
      recoverySource: { recoveryType: "QC_FINAL_REJECTION" },
    },
    include: {
      recoverySource: {
        select: {
          id: true,
          itemId: true,
          sourceQty: true,
          recoveryStatus: true,
          sourceDocumentType: true,
          sourceDocumentId: true,
        },
      },
    },
  });
  return {
    requirementSheetId: sheet.id,
    salesOrderId: sheet.salesOrderId,
    sheetStatus: sheet.status,
    available,
    allocatedOnSheet: activeOnSheet.map((a) => ({
      allocationId: a.id,
      recoverySourceId: a.recoverySourceId,
      itemId: a.recoverySource.itemId,
      allocatedQty: round3(n(a.allocatedQty)),
      status: a.status,
      sourceDocumentType: a.recoverySource.sourceDocumentType,
      sourceDocumentId: a.recoverySource.sourceDocumentId,
    })),
  };
}

module.exports = {
  PRODUCTION_SHORTFALL_SYNC_SOURCE_TYPE: PRODUCTION_SHORTFALL,
  syncRequirementSheetLineComponents,
  syncAllSheetLineComponents,
  ensureLinesForProductionShortfallItems,
  findEligibleDraftRequirementSheetForRecoverySync,
  syncDraftRsWithAvailableRecovery,
  syncEligibleDraftRsAfterProductionShortfallCreated,
  autoAllocateProductionShortfallForSheet,
  consumeCarryForwardPendingForRequirementSheet,
  allocateQcRecoveryToSheet,
  reverseSheetRecoveryAllocation,
  finalizeRecoveryOnRequirementSheetLock,
  reverseRecoveryOnRequirementSheetCancel,
  reverseRecoveryOnDraftRequirementSheetDelete,
  getQcRecoveryAvailabilityForSheet,
};
