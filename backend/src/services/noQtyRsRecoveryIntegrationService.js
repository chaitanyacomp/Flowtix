/**
 * Batch 3C — Requirement Sheet ↔ Recovery Engine integration.
 *
 * Owns RS-side orchestration: auto shortfall reserve, QC allocate/skip,
 * line component sync, lock commit, cancel/delete reverse.
 *
 * Canonical PRODUCTION_SHORTFALL sync: syncDraftRsWithAvailableRecovery —
 * keeps an editable next-cycle draft RS continuously aligned with the
 * CarryForwardPending + RecoveryAllocation queue (no parallel source of truth).
 */

const auditLog = require("./auditLog");
const {
  EPS,
  getAvailableRecovery,
  allocateRecovery,
  reverseRecovery,
  commitReservedAllocationsForSheet,
  reverseAllocationsForSheet,
  ACTIVE_ALLOC_STATUSES,
} = require("./noQtyRecoveryService");

const PRODUCTION_SHORTFALL = "PRODUCTION_SHORTFALL";
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
 * Ensure FG lines exist for items that still have available production shortfall.
 * Creates carry-forward-only lines (base/customer demand = 0) when missing.
 */
async function ensureLinesForProductionShortfallItems(tx, { salesOrderId, requirementSheetId, itemIds }) {
  const available = await getAvailableRecovery(tx, {
    salesOrderId,
    recoveryType: PRODUCTION_SHORTFALL,
  });
  const selected = new Set((itemIds || []).map((id) => Number(id)));
  const toEnsure = new Set(selected);
  for (const row of available) {
    if (row.availableQty > EPS) toEnsure.add(Number(row.itemId));
  }

  const existing = await tx.requirementSheetLine.findMany({
    where: { sheetId: requirementSheetId },
    select: { id: true, itemId: true },
  });
  const have = new Set(existing.map((l) => Number(l.itemId)));
  const createdItemIds = [];

  for (const itemId of toEnsure) {
    if (have.has(itemId)) continue;
    await tx.requirementSheetLine.create({
      data: {
        sheetId: requirementSheetId,
        itemId,
        requirementQty: 0,
        baseDemandQty: 0,
        productionShortfallQty: 0,
        qcRejectionRecoveryQty: 0,
        approvedManualAdjustmentQty: 0,
        totalRsQty: 0,
      },
    });
    createdItemIds.push(itemId);
    have.add(itemId);
  }

  return { itemIds: [...have], createdItemIds };
}

/**
 * Locate the canonical editable next-cycle draft RS for late PRODUCTION_SHORTFALL sync.
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
 * Canonical draft RS ↔ PRODUCTION_SHORTFALL synchronization.
 *
 * - Loads editable NO_QTY draft only
 * - Ensures lines for available shortfall items (merge or create CF-only line)
 * - Allocates via RecoveryAllocation (FOR UPDATE + available-qty gate = idempotent)
 * - Refreshes derived RS component snapshots
 * - Does NOT allocate QC_FINAL_REJECTION (out of scope)
 *
 * @param {object} tx
 * @param {{ requirementSheetId: number, sourceTypes?: string[], itemIds?: number[]|null, actorUserId?: number|null, actorRole?: string|null, salesOrderId?: number|null }} args
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
  const sheetId = Number(requirementSheetId);
  if (!Number.isFinite(sheetId) || sheetId <= 0) {
    throw rsRecoveryError("Invalid requirement sheet id.", { statusCode: 400, code: "RS_INVALID_ID" });
  }

  const types = [...new Set((sourceTypes || DEFAULT_SYNC_SOURCE_TYPES).map((t) => String(t)))];
  if (!types.includes(PRODUCTION_SHORTFALL)) {
    return {
      skipped: true,
      reason: "SOURCE_TYPES_EXCLUDE_PRODUCTION_SHORTFALL",
      allocated: [],
      createdItemIds: [],
      requirementSheetId: sheetId,
    };
  }
  // Explicitly refuse silent QC expansion in this sync path.
  if (types.some((t) => t !== PRODUCTION_SHORTFALL)) {
    throw rsRecoveryError(
      "syncDraftRsWithAvailableRecovery only supports PRODUCTION_SHORTFALL in this batch; QC_FINAL_REJECTION remains manual.",
      { statusCode: 400, code: "RS_SYNC_SOURCE_TYPE_UNSUPPORTED" },
    );
  }

  const sheet = await tx.requirementSheet.findUnique({
    where: { id: sheetId },
    select: {
      id: true,
      status: true,
      salesOrderId: true,
      salesOrder: { select: { id: true, orderType: true } },
    },
  });
  if (!sheet) {
    throw rsRecoveryError("Requirement sheet not found.", { statusCode: 404, code: "RS_NOT_FOUND" });
  }
  if (sheet.status !== "DRAFT") {
    return {
      skipped: true,
      reason: "RS_NOT_DRAFT",
      allocated: [],
      createdItemIds: [],
      requirementSheetId: sheetId,
    };
  }
  if (sheet.salesOrder?.orderType !== "NO_QTY") {
    return {
      skipped: true,
      reason: "NOT_NO_QTY",
      allocated: [],
      createdItemIds: [],
      requirementSheetId: sheetId,
    };
  }

  const soId = Number(salesOrderId != null ? salesOrderId : sheet.salesOrderId);
  if (Number(sheet.salesOrderId) !== soId) {
    throw rsRecoveryError("Requirement sheet does not belong to this sales order.", {
      statusCode: 400,
      code: "RS_SO_MISMATCH",
    });
  }

  const ensured = await ensureLinesForProductionShortfallItems(tx, {
    salesOrderId: soId,
    requirementSheetId: sheetId,
    itemIds: itemIds || [],
  });

  const available = await getAvailableRecovery(tx, {
    salesOrderId: soId,
    recoveryType: PRODUCTION_SHORTFALL,
  });

  const allowedItems = new Set(ensured.itemIds);
  const allocated = [];

  for (const src of available) {
    if (!allowedItems.has(Number(src.itemId))) continue;
    if (src.availableQty <= EPS) continue;
    // allocateRecovery locks CarryForwardPending FOR UPDATE and re-checks available qty.
    const result = await allocateRecovery(tx, {
      recoverySourceId: src.recoverySourceId,
      requirementSheetId: sheetId,
      qty: src.availableQty,
      actorUserId,
    });
    allocated.push({
      recoverySourceId: src.recoverySourceId,
      itemId: src.itemId,
      qty: src.availableQty,
      allocationId: result.allocation.id,
    });
  }

  await syncAllSheetLineComponents(tx, sheetId);

  if ((allocated.length || ensured.createdItemIds.length) && typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `REQUIREMENT_SHEET:${sheetId}`,
      actorUserId,
      actorRole,
      summary: `Synced ${allocated.length} PRODUCTION_SHORTFALL recovery source(s) onto draft RS ${sheetId}`,
      payload: {
        module: "RS_RECOVERY",
        actionLabel: "SYNC_DRAFT_RS_PRODUCTION_SHORTFALL",
        allocated,
        createdItemIds: ensured.createdItemIds,
      },
    });
  }

  return {
    skipped: false,
    reason: null,
    allocated,
    createdItemIds: ensured.createdItemIds,
    requirementSheetId: sheetId,
    salesOrderId: soId,
  };
}

/**
 * After a new PRODUCTION_SHORTFALL CarryForwardPending is created: sync the eligible next draft RS if any.
 * If no eligible draft exists, leave recovery OPEN for Create Next RS.
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
    sourceTypes: [PRODUCTION_SHORTFALL],
    actorUserId,
    actorRole,
  });

  return {
    synced: !result.skipped,
    reason: result.reason || "SYNCED",
    requirementSheetId: draft.id,
    allocated: result.allocated,
    createdItemIds: result.createdItemIds,
  };
}

/**
 * Auto-reserve all available PRODUCTION_SHORTFALL onto the draft RS (incl. base demand 0).
 * Delegates to syncDraftRsWithAvailableRecovery (canonical).
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
    sourceTypes: [PRODUCTION_SHORTFALL],
  });
  if (result.skipped && result.reason === "RS_NOT_DRAFT") {
    throw rsRecoveryError("Production shortfall can only be reserved on a draft requirement sheet.", {
      code: "RS_NOT_DRAFT",
    });
  }
  return { allocated: result.allocated, createdItemIds: result.createdItemIds };
}

/**
 * Legacy facade used by RS create — delegates to canonical draft sync.
 */
async function consumeCarryForwardPendingForRequirementSheet(tx, args) {
  const result = await syncDraftRsWithAvailableRecovery(tx, {
    salesOrderId: args.salesOrderId,
    requirementSheetId: args.requirementSheetId,
    itemIds: args.itemIds,
    actorUserId: args.actorUserId,
    actorRole: args.actorRole,
    sourceTypes: [PRODUCTION_SHORTFALL],
  });
  return {
    consumed: result.allocated.map((a) => ({
      carryForwardPendingId: a.recoverySourceId,
      itemId: a.itemId,
      qty: a.qty,
      requirementSheetLineId: null,
    })),
    allocated: result.allocated,
    createdItemIds: result.createdItemIds,
    ...result,
  };
}

/**
 * Allocate QC recovery (full or partial) onto a draft RS line.
 */
async function allocateQcRecoveryToSheet(
  tx,
  { requirementSheetId, recoverySourceId, qty, actorUserId = null },
) {
  const sheet = await tx.requirementSheet.findUnique({
    where: { id: Number(requirementSheetId) },
    select: { id: true, status: true, salesOrderId: true },
  });
  if (!sheet) {
    throw rsRecoveryError("Requirement sheet not found.", { statusCode: 404, code: "RS_NOT_FOUND" });
  }
  if (sheet.status !== "DRAFT") {
    throw rsRecoveryError("QC recovery can only be reserved on a draft requirement sheet.", {
      code: "RS_NOT_DRAFT",
    });
  }

  const source = await tx.carryForwardPending.findUnique({
    where: { id: Number(recoverySourceId) },
    select: { id: true, recoveryType: true, itemId: true, salesOrderId: true },
  });
  if (!source) {
    throw rsRecoveryError("Recovery source not found.", { statusCode: 404, code: "RECOVERY_SOURCE_NOT_FOUND" });
  }
  if (source.recoveryType !== "QC_FINAL_REJECTION") {
    throw rsRecoveryError("Only QC final-rejection recovery can be allocated via this path.", {
      statusCode: 400,
      code: "RECOVERY_TYPE_INVALID",
    });
  }
  if (Number(source.salesOrderId) !== Number(sheet.salesOrderId)) {
    throw rsRecoveryError("Recovery source does not belong to this sales order.", {
      statusCode: 400,
      code: "RS_SO_MISMATCH",
    });
  }

  let line = await tx.requirementSheetLine.findUnique({
    where: { sheetId_itemId: { sheetId: sheet.id, itemId: source.itemId } },
  });
  if (!line) {
    line = await tx.requirementSheetLine.create({
      data: {
        sheetId: sheet.id,
        itemId: source.itemId,
        requirementQty: 0,
        baseDemandQty: 0,
        productionShortfallQty: 0,
        qcRejectionRecoveryQty: 0,
        approvedManualAdjustmentQty: 0,
        totalRsQty: 0,
      },
    });
  }

  const result = await allocateRecovery(tx, {
    recoverySourceId: source.id,
    requirementSheetId: sheet.id,
    requirementSheetLineId: line.id,
    qty,
    actorUserId,
  });
  const synced = await syncRequirementSheetLineComponents(tx, line.id);
  const available = await getAvailableRecovery(tx, {
    salesOrderId: sheet.salesOrderId,
    itemId: source.itemId,
    recoveryType: "QC_FINAL_REJECTION",
  });
  return { ...result, line: synced, availableQcRecovery: available };
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
 * RS lock: ensure shortfall reserved, commit RESERVED→COMMITTED, snapshot line totals.
 */
async function finalizeRecoveryOnRequirementSheetLock(tx, { requirementSheetId, actorUserId = null }) {
  const sheetId = Number(requirementSheetId);
  const sheet = await tx.requirementSheet.findUnique({
    where: { id: sheetId },
    include: { lines: true, salesOrder: { select: { id: true, orderType: true } } },
  });
  if (!sheet) {
    throw rsRecoveryError("Requirement sheet not found.", { statusCode: 404, code: "RS_NOT_FOUND" });
  }
  if (sheet.salesOrder?.orderType !== "NO_QTY") {
    return { committed: [], lines: sheet.lines };
  }
  if (sheet.status !== "DRAFT") {
    throw rsRecoveryError("Sheet must be draft to finalize recovery on lock.", { code: "RS_NOT_DRAFT" });
  }

  for (const ln of sheet.lines || []) {
    const base = round3(n(ln.requirementQty));
    await tx.requirementSheetLine.update({
      where: { id: ln.id },
      data: { baseDemandQty: String(base), requirementQty: String(base) },
    });
  }

  await syncDraftRsWithAvailableRecovery(tx, {
    salesOrderId: sheet.salesOrderId,
    requirementSheetId: sheetId,
    itemIds: (sheet.lines || []).map((l) => l.itemId),
    actorUserId,
    sourceTypes: [PRODUCTION_SHORTFALL],
  });

  const committed = await commitReservedAllocationsForSheet(tx, {
    requirementSheetId: sheetId,
    actorUserId,
  });

  const lines = await syncAllSheetLineComponents(tx, sheetId);

  for (const ln of lines) {
    const total = round3(n(ln.totalRsQty));
    const shortfall = round3(n(ln.productionShortfallQty));
    const base = round3(n(ln.baseDemandQty));
    await tx.requirementSheetLine.update({
      where: { id: ln.id },
      data: {
        shortfallQtySnapshot: String(shortfall),
        suggestedWoQtySnapshot: String(total),
        requirementQty: String(base),
      },
    });
  }

  return { committed, lines };
}

/**
 * After allowed cancel (status already CANCELLED): reverse active allocations.
 */
async function reverseRecoveryOnRequirementSheetCancel(tx, { requirementSheetId, actorUserId = null, reason = null }) {
  return reverseAllocationsForSheet(tx, {
    requirementSheetId,
    actorUserId,
    reason: reason || "Requirement sheet cancelled",
    deleteRows: false,
  });
}

/**
 * Draft delete: reverse active allocs, delete allocation rows (FK Restrict), then caller deletes sheet.
 */
async function reverseRecoveryOnDraftRequirementSheetDelete(tx, { requirementSheetId, actorUserId = null }) {
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
