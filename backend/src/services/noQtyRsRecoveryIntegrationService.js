/**
 * Batch 3C — Requirement Sheet ↔ Recovery Engine integration.
 *
 * Owns RS-side orchestration: auto shortfall reserve, QC allocate/skip,
 * line component sync, lock commit, cancel/delete reverse.
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
 */
async function ensureLinesForProductionShortfallItems(tx, { salesOrderId, requirementSheetId, itemIds }) {
  const available = await getAvailableRecovery(tx, {
    salesOrderId,
    recoveryType: "PRODUCTION_SHORTFALL",
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
 * Auto-reserve all available PRODUCTION_SHORTFALL onto the draft RS (incl. base demand 0).
 * Idempotent for already-allocated sources (available qty excludes active allocs).
 */
async function autoAllocateProductionShortfallForSheet(
  tx,
  { salesOrderId, requirementSheetId, itemIds = null, actorUserId = null, actorRole = null },
) {
  const soId = Number(salesOrderId);
  const sheetId = Number(requirementSheetId);

  const sheet = await tx.requirementSheet.findUnique({
    where: { id: sheetId },
    select: { id: true, status: true, salesOrderId: true },
  });
  if (!sheet) {
    throw rsRecoveryError("Requirement sheet not found.", { statusCode: 404, code: "RS_NOT_FOUND" });
  }
  if (sheet.status !== "DRAFT") {
    throw rsRecoveryError("Production shortfall can only be reserved on a draft requirement sheet.", {
      code: "RS_NOT_DRAFT",
    });
  }
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
    recoveryType: "PRODUCTION_SHORTFALL",
  });

  const allowedItems = new Set(ensured.itemIds);
  const allocated = [];

  for (const src of available) {
    if (!allowedItems.has(Number(src.itemId))) continue;
    if (src.availableQty <= EPS) continue;
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

  if (allocated.length && typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `REQUIREMENT_SHEET:${sheetId}`,
      actorUserId,
      actorRole,
      summary: `Auto-reserved ${allocated.length} production shortfall recovery source(s) on RS ${sheetId}`,
      payload: { module: "RS_RECOVERY", allocated },
    });
  }

  return { allocated, createdItemIds: ensured.createdItemIds };
}

/**
 * Legacy facade used by RS create — delegates to recovery auto-allocate.
 */
async function consumeCarryForwardPendingForRequirementSheet(tx, args) {
  const result = await autoAllocateProductionShortfallForSheet(tx, {
    salesOrderId: args.salesOrderId,
    requirementSheetId: args.requirementSheetId,
    itemIds: args.itemIds,
    actorUserId: args.actorUserId,
    actorRole: args.actorRole,
  });
  return {
    consumed: result.allocated.map((a) => ({
      carryForwardPendingId: a.recoverySourceId,
      itemId: a.itemId,
      qty: a.qty,
      requirementSheetLineId: null,
    })),
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

  await autoAllocateProductionShortfallForSheet(tx, {
    salesOrderId: sheet.salesOrderId,
    requirementSheetId: sheetId,
    itemIds: (sheet.lines || []).map((l) => l.itemId),
    actorUserId,
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
  syncRequirementSheetLineComponents,
  syncAllSheetLineComponents,
  ensureLinesForProductionShortfallItems,
  autoAllocateProductionShortfallForSheet,
  consumeCarryForwardPendingForRequirementSheet,
  allocateQcRecoveryToSheet,
  reverseSheetRecoveryAllocation,
  finalizeRecoveryOnRequirementSheetLock,
  reverseRecoveryOnRequirementSheetCancel,
  reverseRecoveryOnDraftRequirementSheetDelete,
  getQcRecoveryAvailabilityForSheet,
};
