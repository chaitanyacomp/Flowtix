/**
 * NO_QTY Batch 3B — Recovery Engine (authoritative).
 *
 * Available Qty = sourceQty − active allocations (RESERVED|COMMITTED) − waivedQty
 *
 * Does not own SO closure, RS create/lock orchestration, dashboard, or reports.
 */

const { Prisma } = require("../prismaClientPackage");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const { splitTerminalScrapAgainstWoPlan } = require("./noQtyProductionExcessRecoveryService");

const EPS = 1e-6;
const ACTIVE_ALLOC_STATUSES = Object.freeze(["RESERVED", "COMMITTED"]);

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function recoveryError(message, { statusCode = 409, code = "RECOVERY_ERROR" } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

async function lockRecoverySourceForUpdate(tx, recoverySourceId) {
  const id = Number(recoverySourceId);
  if (!Number.isFinite(id) || id <= 0) {
    throw recoveryError("Invalid recovery source id.", { statusCode: 400, code: "INVALID_RECOVERY_SOURCE" });
  }
  if (typeof tx.$queryRaw !== "function") {
    return tx.carryForwardPending.findUnique({ where: { id } });
  }
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT id FROM CarryForwardPending WHERE id = ${id} LIMIT 1 FOR UPDATE`,
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw recoveryError("Recovery source not found.", { statusCode: 404, code: "RECOVERY_SOURCE_NOT_FOUND" });
  }
  return tx.carryForwardPending.findUnique({ where: { id } });
}

function sumActiveAllocatedQty(allocations) {
  let sum = 0;
  for (const a of allocations || []) {
    if (!ACTIVE_ALLOC_STATUSES.includes(String(a.status))) continue;
    sum = round3(sum + n(a.allocatedQty));
  }
  return sum;
}

function computeAvailableQty(source, allocations) {
  const sourceQty = round3(n(source.sourceQty ?? source.remainingQty));
  const waived = round3(n(source.waivedQty));
  const active = sumActiveAllocatedQty(allocations);
  return round3(Math.max(0, sourceQty - active - waived));
}

function deriveRecoveryStatus(source, allocations) {
  const current = String(source.recoveryStatus ?? "");
  if (current === "CANCELLED") return "CANCELLED";

  const sourceQty = round3(n(source.sourceQty ?? source.remainingQty));
  const waived = round3(n(source.waivedQty));
  const active = sumActiveAllocatedQty(allocations);
  const available = round3(Math.max(0, sourceQty - active - waived));

  if (waived > EPS && available <= EPS && active <= EPS) return "WAIVED";
  if (waived > EPS && (available > EPS || active > EPS)) return "PARTIALLY_WAIVED";
  if (active > EPS && available <= EPS) return "FULLY_ALLOCATED";
  if (active > EPS) return "PARTIALLY_ALLOCATED";
  return "OPEN";
}

/**
 * Recompute and persist recoveryStatus (+ legacy remainingQty mirror of available).
 */
async function recomputeRecoveryStatus(tx, recoverySourceId) {
  const id = Number(recoverySourceId);
  const source = await tx.carryForwardPending.findUnique({
    where: { id },
    include: { allocations: { select: { status: true, allocatedQty: true } } },
  });
  if (!source) {
    throw recoveryError("Recovery source not found.", { statusCode: 404, code: "RECOVERY_SOURCE_NOT_FOUND" });
  }
  if (String(source.recoveryStatus) === "CANCELLED") {
    return source;
  }

  const nextStatus = deriveRecoveryStatus(source, source.allocations);
  const available = computeAvailableQty(source, source.allocations);
  const legacyStatus = available <= EPS && nextStatus !== "OPEN" ? "CONSUMED" : "PENDING";

  return tx.carryForwardPending.update({
    where: { id },
    data: {
      recoveryStatus: nextStatus,
      remainingQty: String(available),
      status: legacyStatus,
      ...(legacyStatus === "CONSUMED" && !source.consumedAt ? { consumedAt: new Date() } : {}),
    },
  });
}

async function findExistingByProvenance(tx, { recoveryType, sourceDocumentType, sourceDocumentId }) {
  if (sourceDocumentType == null || sourceDocumentId == null) return null;
  return tx.carryForwardPending.findFirst({
    where: {
      recoveryType,
      sourceDocumentType,
      sourceDocumentId: Number(sourceDocumentId),
    },
  });
}

/**
 * Create PRODUCTION_SHORTFALL recovery from a terminal WO shortfall resolution.
 * Idempotent on (PRODUCTION_SHORTFALL, PRODUCTION_SHORTFALL_RESOLUTION|WORK_ORDER, id).
 */
async function createProductionShortRecovery(
  tx,
  {
    workOrder,
    workOrderLine,
    remainderQty,
    resolutionReason,
    remarks,
    productionShortfallResolutionId,
    actorUserId,
  },
) {
  const qty = round3(remainderQty);
  if (qty <= EPS) return null;

  const soId = Number(workOrder?.salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true },
  });
  if (!so || so.orderType !== "NO_QTY") return null;

  const hasResolution =
    productionShortfallResolutionId != null && Number.isFinite(Number(productionShortfallResolutionId));
  const sourceDocumentType = hasResolution ? "PRODUCTION_SHORTFALL_RESOLUTION" : "WORK_ORDER";
  const sourceDocumentId = hasResolution ? Number(productionShortfallResolutionId) : Number(workOrder.id);

  const existing = await findExistingByProvenance(tx, {
    recoveryType: "PRODUCTION_SHORTFALL",
    sourceDocumentType,
    sourceDocumentId,
  });
  if (existing) return existing;

  try {
    return await tx.carryForwardPending.create({
      data: {
        itemId: workOrderLine.fgItemId,
        salesOrderId: soId,
        sourceRequirementSheetId: workOrder.requirementSheetId ?? null,
        sourceWorkOrderId: workOrder.id,
        cycleId: workOrder.cycleId ?? null,
        remainingQty: String(qty),
        resolutionReason: resolutionReason || "MANAGEMENT_DECISION",
        resolutionReasonOther: resolutionReason === "OTHER" ? String(remarks ?? "").trim() : null,
        remarks: remarks?.trim() || null,
        status: "PENDING",
        createdByUserId: actorUserId ?? null,
        productionShortfallResolutionId: hasResolution ? Number(productionShortfallResolutionId) : null,
        recoveryType: "PRODUCTION_SHORTFALL",
        sourceQty: String(qty),
        recoveryStatus: "OPEN",
        waivedQty: "0",
        sourceDocumentType,
        sourceDocumentId,
      },
    });
  } catch (e) {
    if (e && (e.code === "P2002" || /Unique constraint/i.test(String(e.message)))) {
      const again = await findExistingByProvenance(tx, {
        recoveryType: "PRODUCTION_SHORTFALL",
        sourceDocumentType,
        sourceDocumentId,
      });
      if (again) return again;
    }
    throw e;
  }
}

/**
 * Create or adjust QC_FINAL_REJECTION recovery from terminal unusable qty (scrap / final reject).
 *
 * Provenance identity: (QC_FINAL_REJECTION, sourceDocumentType, sourceDocumentId).
 * `sourceQty` is the authoritative absolute terminal-scrap total for that source.
 *
 * Never call for first-pass rework/hold routing or pending QC — only for terminal SCRAP.
 *
 * Adjustment rules:
 * - same source + same qty → no change (idempotent)
 * - same source + higher qty → increase by delta only
 * - same source + lower qty → decrease by delta only, never below activeAllocated + waived
 * - qty ≤ EPS on an existing source → cancel if fully unallocated (or only RESERVED)
 */
async function createFinalQcRejectedRecovery(
  tx,
  {
    salesOrderId,
    itemId,
    sourceQty,
    workOrderId = null,
    cycleId = null,
    sourceRequirementSheetId = null,
    sourceDocumentType = "QC_REJECTED_DISPOSITION",
    sourceDocumentId,
    remarks = null,
    actorUserId = null,
    resolutionReason = "QUALITY_CONCERN",
  },
) {
  const qty = round3(sourceQty);
  const soId = Number(salesOrderId);
  const iid = Number(itemId);
  const docId = Number(sourceDocumentId);
  if (!Number.isFinite(soId) || soId <= 0 || !Number.isFinite(iid) || iid <= 0 || !Number.isFinite(docId) || docId <= 0) {
    throw recoveryError("Invalid QC recovery identity.", { statusCode: 400, code: "INVALID_QC_RECOVERY" });
  }

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true },
  });
  if (!so || so.orderType !== "NO_QTY") return null;

  const existing = await findExistingByProvenance(tx, {
    recoveryType: "QC_FINAL_REJECTION",
    sourceDocumentType,
    sourceDocumentId: docId,
  });

  if (existing) {
    return adjustExistingQcRejectionSource(tx, {
      existing,
      qty,
      workOrderId,
      cycleId,
      sourceRequirementSheetId,
      remarks,
      actorUserId,
      sourceDocumentType,
      sourceDocumentId: docId,
    });
  }

  if (qty <= EPS) return null;

  try {
    return await tx.carryForwardPending.create({
      data: {
        itemId: iid,
        salesOrderId: soId,
        sourceWorkOrderId: workOrderId != null ? Number(workOrderId) : null,
        sourceRequirementSheetId:
          sourceRequirementSheetId != null ? Number(sourceRequirementSheetId) : null,
        cycleId: cycleId != null ? Number(cycleId) : null,
        remainingQty: String(qty),
        resolutionReason,
        remarks: remarks?.trim() || null,
        status: "PENDING",
        createdByUserId: actorUserId ?? null,
        recoveryType: "QC_FINAL_REJECTION",
        sourceQty: String(qty),
        recoveryStatus: "OPEN",
        waivedQty: "0",
        sourceDocumentType,
        sourceDocumentId: docId,
      },
    });
  } catch (e) {
    if (e && (e.code === "P2002" || /Unique constraint/i.test(String(e.message)))) {
      const again = await findExistingByProvenance(tx, {
        recoveryType: "QC_FINAL_REJECTION",
        sourceDocumentType,
        sourceDocumentId: docId,
      });
      if (again) {
        return adjustExistingQcRejectionSource(tx, {
          existing: again,
          qty,
          workOrderId,
          cycleId,
          sourceRequirementSheetId,
          remarks,
          actorUserId,
          sourceDocumentType,
          sourceDocumentId: docId,
        });
      }
    }
    throw e;
  }
}

/**
 * Apply absolute terminal-scrap qty to an existing QC_FINAL_REJECTION source.
 * Preserves the row (no silent delete); CANCELLED reopen is allowed when qty > 0.
 */
async function adjustExistingQcRejectionSource(
  tx,
  {
    existing,
    qty,
    workOrderId = null,
    cycleId = null,
    sourceRequirementSheetId = null,
    remarks = null,
    actorUserId = null,
    sourceDocumentType,
    sourceDocumentId,
  },
) {
  await lockRecoverySourceForUpdate(tx, existing.id);
  const locked = await tx.carryForwardPending.findUnique({
    where: { id: existing.id },
    include: { allocations: true },
  });
  if (!locked) {
    throw recoveryError("Recovery source not found.", { statusCode: 404, code: "RECOVERY_SOURCE_NOT_FOUND" });
  }

  const prev = round3(n(locked.sourceQty));
  const waived = round3(n(locked.waivedQty));
  const active = sumActiveAllocatedQty(locked.allocations);
  const floor = round3(active + waived);
  const metaPatch = {
    remarks: remarks?.trim() || locked.remarks,
    ...(workOrderId != null ? { sourceWorkOrderId: Number(workOrderId) } : {}),
    ...(cycleId != null ? { cycleId: Number(cycleId) } : {}),
    ...(sourceRequirementSheetId != null
      ? { sourceRequirementSheetId: Number(sourceRequirementSheetId) }
      : {}),
  };

  if (qty <= EPS) {
    if (floor > EPS) {
      throw recoveryError(
        "Cannot clear QC recovery source below active allocated + waived quantity.",
        { statusCode: 409, code: "RECOVERY_SOURCE_QTY_BELOW_ALLOCATED" },
      );
    }
    return cancelUnallocatedRecoverySource(tx, {
      recoveryType: "QC_FINAL_REJECTION",
      sourceDocumentType,
      sourceDocumentId,
      actorUserId,
      reason: remarks?.trim() || "Terminal scrap quantity cleared",
    });
  }

  if (String(locked.recoveryStatus) === "CANCELLED") {
    const reopened = await tx.carryForwardPending.update({
      where: { id: locked.id },
      data: {
        ...metaPatch,
        sourceQty: String(qty),
        remainingQty: String(qty),
        recoveryStatus: "OPEN",
        status: "PENDING",
        cancelledAt: null,
        cancelledByUserId: null,
        cancelReason: null,
      },
    });
    return recomputeRecoveryStatus(tx, reopened.id);
  }

  if (Math.abs(qty - prev) <= EPS) {
    if (Object.keys(metaPatch).length > 1 || remarks?.trim()) {
      await tx.carryForwardPending.update({
        where: { id: locked.id },
        data: metaPatch,
      });
    }
    return recomputeRecoveryStatus(tx, locked.id);
  }

  if (qty + EPS < floor) {
    throw recoveryError(
      `Cannot reduce QC recovery sourceQty below active allocated (${active}) + waived (${waived}).`,
      { statusCode: 409, code: "RECOVERY_SOURCE_QTY_BELOW_ALLOCATED" },
    );
  }

  const updated = await tx.carryForwardPending.update({
    where: { id: locked.id },
    data: {
      ...metaPatch,
      sourceQty: String(qty),
    },
  });
  return recomputeRecoveryStatus(tx, updated.id);
}

async function getAvailableRecovery(db, { salesOrderId, itemId = null, recoveryType = null } = {}) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return [];

  const where = {
    salesOrderId: soId,
    recoveryStatus: { notIn: ["CANCELLED", "WAIVED"] },
  };
  if (itemId != null) where.itemId = Number(itemId);
  if (recoveryType != null) where.recoveryType = recoveryType;

  const rows = await db.carryForwardPending.findMany({
    where,
    include: {
      allocations: { select: { id: true, status: true, allocatedQty: true } },
      item: { select: { id: true, itemName: true, unit: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return rows
    .map((r) => {
      const availableQty = computeAvailableQty(r, r.allocations);
      return {
        recoverySourceId: r.id,
        salesOrderId: r.salesOrderId,
        itemId: r.itemId,
        itemName: r.item?.itemName ?? null,
        uom: r.item?.unit ?? null,
        recoveryType: r.recoveryType,
        recoveryStatus: r.recoveryStatus,
        sourceQty: round3(n(r.sourceQty)),
        waivedQty: round3(n(r.waivedQty)),
        activeAllocatedQty: sumActiveAllocatedQty(r.allocations),
        availableQty,
        sourceDocumentType: r.sourceDocumentType,
        sourceDocumentId: r.sourceDocumentId,
        sourceWorkOrderId: r.sourceWorkOrderId ?? null,
        sourceRequirementSheetId: r.sourceRequirementSheetId ?? null,
        cycleId: r.cycleId,
        createdAt: r.createdAt,
      };
    })
    .filter((r) => r.availableQty > EPS);
}

/**
 * Allocate qty from a recovery source onto an RS line (RESERVED while sheet is DRAFT).
 */
async function allocateRecovery(
  tx,
  { recoverySourceId, requirementSheetId, requirementSheetLineId = null, qty, actorUserId = null },
) {
  const allocQty = round3(qty);
  if (allocQty <= EPS) {
    throw recoveryError("Allocation quantity must be positive.", { statusCode: 400, code: "INVALID_ALLOC_QTY" });
  }

  const source = await lockRecoverySourceForUpdate(tx, recoverySourceId);
  if (!source) {
    throw recoveryError("Recovery source not found.", { statusCode: 404, code: "RECOVERY_SOURCE_NOT_FOUND" });
  }
  if (["CANCELLED", "WAIVED"].includes(String(source.recoveryStatus))) {
    throw recoveryError("Recovery source is not allocatable.", { code: "RECOVERY_NOT_ALLOCATABLE" });
  }

  const sheetId = Number(requirementSheetId);
  const sheet = await tx.requirementSheet.findUnique({
    where: { id: sheetId },
    select: { id: true, status: true, salesOrderId: true },
  });
  if (!sheet) {
    throw recoveryError("Requirement sheet not found.", { statusCode: 404, code: "RS_NOT_FOUND" });
  }
  if (sheet.status !== "DRAFT") {
    throw recoveryError("Recovery can only be reserved on a draft requirement sheet.", {
      code: "RS_NOT_DRAFT",
    });
  }
  if (Number(sheet.salesOrderId) !== Number(source.salesOrderId)) {
    throw recoveryError("Requirement sheet does not belong to this sales order.", {
      statusCode: 400,
      code: "RS_SO_MISMATCH",
    });
  }

  let lineId = requirementSheetLineId != null ? Number(requirementSheetLineId) : null;
  if (!lineId) {
    const line = await tx.requirementSheetLine.findUnique({
      where: { sheetId_itemId: { sheetId, itemId: source.itemId } },
    });
    if (!line) {
      throw recoveryError("Requirement sheet line not found for recovery item.", {
        statusCode: 404,
        code: "RS_LINE_NOT_FOUND",
      });
    }
    lineId = line.id;
  } else {
    const line = await tx.requirementSheetLine.findUnique({ where: { id: lineId } });
    if (!line || Number(line.sheetId) !== sheetId) {
      throw recoveryError("Requirement sheet line not found.", { statusCode: 404, code: "RS_LINE_NOT_FOUND" });
    }
    if (Number(line.itemId) !== Number(source.itemId)) {
      throw recoveryError("Requirement sheet line item does not match recovery item.", {
        statusCode: 400,
        code: "RS_LINE_ITEM_MISMATCH",
      });
    }
  }

  const allocations = await tx.recoveryAllocation.findMany({
    where: { recoverySourceId: source.id },
    select: { status: true, allocatedQty: true },
  });
  const available = computeAvailableQty(source, allocations);
  if (allocQty > available + EPS) {
    throw recoveryError(`Recovery over-allocation: available ${available}, requested ${allocQty}.`, {
      code: "RECOVERY_OVER_ALLOC",
    });
  }

  const existingActive = await tx.recoveryAllocation.findFirst({
    where: {
      recoverySourceId: source.id,
      requirementSheetLineId: lineId,
      status: { in: [...ACTIVE_ALLOC_STATUSES] },
    },
  });

  const now = new Date();
  let allocation;
  if (existingActive && existingActive.status === "RESERVED") {
    allocation = await tx.recoveryAllocation.update({
      where: { id: existingActive.id },
      data: {
        allocatedQty: String(round3(n(existingActive.allocatedQty) + allocQty)),
        reservedAt: now,
        reservedByUserId: actorUserId ?? null,
      },
    });
  } else if (existingActive) {
    throw recoveryError("An active committed allocation already exists for this source and RS line.", {
      code: "RECOVERY_ALLOC_EXISTS",
    });
  } else {
    allocation = await tx.recoveryAllocation.create({
      data: {
        recoverySourceId: source.id,
        requirementSheetId: sheetId,
        requirementSheetLineId: lineId,
        allocatedQty: String(allocQty),
        status: "RESERVED",
        reservedAt: now,
        reservedByUserId: actorUserId ?? null,
      },
    });
  }

  const updatedSource = await recomputeRecoveryStatus(tx, source.id);
  const refreshedAllocs = await tx.recoveryAllocation.findMany({
    where: { recoverySourceId: source.id },
    select: { status: true, allocatedQty: true },
  });
  return {
    allocation,
    recoverySource: updatedSource,
    availableQty: computeAvailableQty(updatedSource, refreshedAllocs),
  };
}

/**
 * Reverse an allocation when permitted.
 * RESERVED: always. COMMITTED: only if RS is DRAFT or CANCELLED (conditional).
 */
async function reverseRecovery(tx, { allocationId, reason = null, actorUserId = null }) {
  const id = Number(allocationId);
  if (!Number.isFinite(id) || id <= 0) {
    throw recoveryError("Invalid allocation id.", { statusCode: 400, code: "INVALID_ALLOCATION" });
  }

  const allocation = await tx.recoveryAllocation.findUnique({
    where: { id },
    include: { requirementSheet: { select: { id: true, status: true } } },
  });
  if (!allocation) {
    throw recoveryError("Recovery allocation not found.", { statusCode: 404, code: "ALLOCATION_NOT_FOUND" });
  }
  if (allocation.status === "REVERSED") {
    return allocation;
  }

  await lockRecoverySourceForUpdate(tx, allocation.recoverySourceId);

  if (allocation.status === "COMMITTED") {
    const rsStatus = String(allocation.requirementSheet?.status ?? "");
    if (rsStatus !== "DRAFT" && rsStatus !== "CANCELLED") {
      throw recoveryError(
        "Committed recovery allocation is irreversible while the requirement sheet has downstream lock state.",
        { code: "RECOVERY_IRREVERSIBLE" },
      );
    }
  } else if (allocation.status !== "RESERVED") {
    throw recoveryError(`Cannot reverse allocation in status ${allocation.status}.`, {
      code: "RECOVERY_REVERSE_INVALID",
    });
  }

  const reversed = await tx.recoveryAllocation.update({
    where: { id },
    data: {
      status: "REVERSED",
      reversedAt: new Date(),
      reversedByUserId: actorUserId ?? null,
      reverseReason: reason?.trim() || null,
    },
  });

  await recomputeRecoveryStatus(tx, allocation.recoverySourceId);
  return reversed;
}

/**
 * Promote all RESERVED allocations on a sheet to COMMITTED (RS lock).
 */
async function commitReservedAllocationsForSheet(tx, { requirementSheetId, actorUserId = null }) {
  const sheetId = Number(requirementSheetId);
  const rows = await tx.recoveryAllocation.findMany({
    where: { requirementSheetId: sheetId, status: "RESERVED" },
    orderBy: [{ id: "asc" }],
  });
  const committed = [];
  const now = new Date();
  for (const row of rows) {
    await lockRecoverySourceForUpdate(tx, row.recoverySourceId);
    const updated = await tx.recoveryAllocation.update({
      where: { id: row.id },
      data: {
        status: "COMMITTED",
        committedAt: now,
        committedByUserId: actorUserId ?? null,
      },
    });
    await recomputeRecoveryStatus(tx, row.recoverySourceId);
    committed.push(updated);
  }
  return committed;
}

/**
 * Reverse all active allocations for a sheet.
 * Caller must set sheet status to CANCELLED before reversing COMMITTED rows (irreversibility gate).
 */
async function reverseAllocationsForSheet(
  tx,
  { requirementSheetId, actorUserId = null, reason = null, deleteRows = false },
) {
  const sheetId = Number(requirementSheetId);
  const rows = await tx.recoveryAllocation.findMany({
    where: {
      requirementSheetId: sheetId,
      status: { in: [...ACTIVE_ALLOC_STATUSES] },
    },
    orderBy: [{ id: "asc" }],
  });
  const reversed = [];
  for (const row of rows) {
    const out = await reverseRecovery(tx, {
      allocationId: row.id,
      actorUserId,
      reason: reason || "Requirement sheet cancelled",
    });
    reversed.push(out);
  }
  if (deleteRows) {
    await tx.recoveryAllocation.deleteMany({ where: { requirementSheetId: sheetId } });
  }
  return reversed;
}

function emptyRecoveryTotals() {
  return {
    productionShortfallSourceQty: 0,
    productionShortfallAvailableQty: 0,
    qcFinalRejectionSourceQty: 0,
    qcFinalRejectionAvailableQty: 0,
    waivedQty: 0,
    activeAllocatedQty: 0,
  };
}

/**
 * Build recovery summary from already-loaded CarryForwardPending rows (same math as getRecoverySummary).
 * @param {number} salesOrderId
 * @param {object[]} rows
 */
function buildRecoverySummaryFromRows(salesOrderId, rows) {
  const soId = Number(salesOrderId);
  const sources = (rows || []).map((r) => {
    const activeAllocatedQty = sumActiveAllocatedQty(r.allocations);
    const availableQty = computeAvailableQty(r, r.allocations);
    return {
      recoverySourceId: r.id,
      itemId: r.itemId,
      itemName: r.item?.itemName ?? null,
      uom: r.item?.unit ?? null,
      recoveryType: r.recoveryType,
      recoveryStatus: r.recoveryStatus,
      sourceQty: round3(n(r.sourceQty)),
      waivedQty: round3(n(r.waivedQty)),
      activeAllocatedQty,
      availableQty,
      sourceDocumentType: r.sourceDocumentType,
      sourceDocumentId: r.sourceDocumentId,
      sourceWorkOrderId: r.sourceWorkOrderId ?? null,
      sourceRequirementSheetId: r.sourceRequirementSheetId ?? null,
      cycleId: r.cycleId,
      createdAt: r.createdAt ?? null,
      migrationIncomplete: Boolean(r.migrationIncomplete),
      allocations: (r.allocations || []).map((a) => ({
        id: a.id,
        requirementSheetId: a.requirementSheetId,
        requirementSheetLineId: a.requirementSheetLineId,
        allocatedQty: round3(n(a.allocatedQty)),
        status: a.status,
        reservedAt: a.reservedAt,
        committedAt: a.committedAt,
        reversedAt: a.reversedAt,
      })),
    };
  });

  const totals = emptyRecoveryTotals();
  for (const s of sources) {
    if (s.recoveryStatus === "CANCELLED") continue;
    totals.waivedQty = round3(totals.waivedQty + s.waivedQty);
    totals.activeAllocatedQty = round3(totals.activeAllocatedQty + s.activeAllocatedQty);
    if (s.recoveryType === "PRODUCTION_SHORTFALL") {
      totals.productionShortfallSourceQty = round3(totals.productionShortfallSourceQty + s.sourceQty);
      totals.productionShortfallAvailableQty = round3(totals.productionShortfallAvailableQty + s.availableQty);
    } else if (s.recoveryType === "QC_FINAL_REJECTION") {
      totals.qcFinalRejectionSourceQty = round3(totals.qcFinalRejectionSourceQty + s.sourceQty);
      totals.qcFinalRejectionAvailableQty = round3(totals.qcFinalRejectionAvailableQty + s.availableQty);
    }
  }

  return { salesOrderId: soId, sources, totals };
}

async function getRecoverySummary(db, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    return { salesOrderId: soId, sources: [], totals: emptyRecoveryTotals() };
  }

  const rows = await db.carryForwardPending.findMany({
    where: { salesOrderId: soId },
    include: {
      allocations: true,
      item: { select: { id: true, itemName: true, unit: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return buildRecoverySummaryFromRows(soId, rows);
}

/**
 * Batch recovery summaries — one query for many SOs (Batch 3E read model). Same math as getRecoverySummary.
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number[]} salesOrderIds
 * @returns {Promise<Map<number, ReturnType<typeof buildRecoverySummaryFromRows>>>}
 */
async function getRecoverySummariesBatch(db, salesOrderIds) {
  /** @type {Map<number, ReturnType<typeof buildRecoverySummaryFromRows>>} */
  const out = new Map();
  const ids = [...new Set((salesOrderIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  for (const id of ids) out.set(id, buildRecoverySummaryFromRows(id, []));
  if (!ids.length) return out;

  const rows = await db.carryForwardPending.findMany({
    where: { salesOrderId: { in: ids } },
    include: {
      allocations: true,
      item: { select: { id: true, itemName: true, unit: true } },
    },
    orderBy: [{ salesOrderId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  /** @type {Map<number, object[]>} */
  const bySo = new Map();
  for (const r of rows) {
    const soId = Number(r.salesOrderId);
    if (!bySo.has(soId)) bySo.set(soId, []);
    bySo.get(soId).push(r);
  }
  for (const id of ids) {
    out.set(id, buildRecoverySummaryFromRows(id, bySo.get(id) || []));
  }
  return out;
}

/**
 * Append a new terminal-scrap delta onto a QC_FINAL_REJECTION recovery for a disposition.
 *
 * Call from EVERY terminal final-SCRAP path for NO_QTY:
 * - first-pass direct SCRAP (single or split scrap portion)
 * - hold → scrap / hold-save-combined scrap
 * - deny → scrap
 * - rework final QC scrap
 *
 * Do NOT call for hold-only, rework-pending, accept, or provisional reject.
 * Each call adds `scrapQty` as a delta (multi-step hold-scrap accumulates).
 * Duplicate absolute create for the same provenance uses createFinalQcRejectedRecovery
 * (same qty → no-op).
 */
async function appendTerminalQcScrapRecovery(
  tx,
  {
    disposition,
    scrapQty,
    actorUserId = null,
    remarks = null,
  },
) {
  const delta = round3(scrapQty);
  if (delta <= EPS) return null;

  const soId = Number(disposition?.workOrder?.salesOrderId ?? disposition?.salesOrderId);
  const itemId = Number(disposition?.itemId);
  const dispositionId = Number(disposition?.id);
  if (!Number.isFinite(dispositionId) || dispositionId <= 0) return null;
  if (!Number.isFinite(soId) || soId <= 0 || !Number.isFinite(itemId) || itemId <= 0) return null;

  // NO_QTY: only demand-backed (within WO plan) scrap creates QC_FINAL_REJECTION.
  // Surplus scrap cancels provisional excess offset only — never becomes kept QC recovery.
  let recoverableDelta = delta;
  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { orderType: true },
  });
  if (so?.orderType === "NO_QTY") {
    const woId = Number(disposition.workOrderId ?? disposition.workOrder?.id);
    if (Number.isFinite(woId) && woId > 0 && typeof tx.workOrderLine?.findFirst === "function") {
      const line = await tx.workOrderLine.findFirst({
        where: { workOrderId: woId, fgItemId: itemId },
        select: {
          qty: true,
          plannedQty: true,
          productions: {
            where: { workflowStatus: "APPROVED" },
            select: {
              producedQty: true,
              qcEntries: {
                where: QC_ENTRY_ACTIVE_WHERE,
                select: { acceptedQty: true, rejectedQty: true },
              },
            },
          },
        },
      });
      if (line) {
        let produced = 0;
        let accepted = 0;
        let rejected = 0;
        for (const pe of line.productions || []) {
          produced = round3(produced + n(pe.producedQty));
          for (const qc of pe.qcEntries || []) {
            accepted = round3(accepted + n(qc.acceptedQty));
            rejected = round3(rejected + n(qc.rejectedQty));
          }
        }
        // QC entry usually already includes this scrap in rejectedQty.
        const rejectedBefore = Math.max(0, round3(rejected - delta));
        const split = splitTerminalScrapAgainstWoPlan({
          plannedQty: n(line.plannedQty ?? line.qty),
          producedQty: produced,
          acceptedQty: accepted,
          rejectedQtyBeforeScrap: rejectedBefore,
          scrapQty: delta,
        });
        recoverableDelta = round3(split.demandBackedScrapQty);
        if (recoverableDelta <= EPS) return null;
      }
    }
  }

  const existing = await findExistingByProvenance(tx, {
    recoveryType: "QC_FINAL_REJECTION",
    sourceDocumentType: "QC_REJECTED_DISPOSITION",
    sourceDocumentId: dispositionId,
  });
  // Skip cancelled rows for append math — adjustExisting reopen is handled by absolute set.
  const prior =
    existing && String(existing.recoveryStatus) !== "CANCELLED"
      ? round3(n(existing.sourceQty))
      : 0;
  const nextQty = round3(prior + recoverableDelta);

  const created = await createFinalQcRejectedRecovery(tx, {
    salesOrderId: soId,
    itemId,
    sourceQty: nextQty,
    workOrderId: disposition.workOrderId ?? disposition.workOrder?.id ?? null,
    cycleId: disposition.workOrder?.cycleId ?? disposition.cycleId ?? null,
    sourceRequirementSheetId:
      disposition.workOrder?.requirementSheetId ?? disposition.sourceRequirementSheetId ?? null,
    sourceDocumentType: "QC_REJECTED_DISPOSITION",
    sourceDocumentId: dispositionId,
    remarks: remarks ?? disposition.remarks ?? null,
    actorUserId,
  });
  // Phase 2B: seed PENDING Keep/Waive on an eligible draft RS (discovery only — no allocate).
  if (created) {
    try {
      const { syncEligibleDraftRsAfterProductionShortfallCreated } = require("./noQtyRsRecoveryIntegrationService");
      const excludeIds = [];
      const srcRs =
        disposition.workOrder?.requirementSheetId ?? disposition.sourceRequirementSheetId ?? null;
      if (srcRs != null) excludeIds.push(Number(srcRs));
      await syncEligibleDraftRsAfterProductionShortfallCreated(tx, {
        salesOrderId: soId,
        excludeRequirementSheetIds: excludeIds,
        actorUserId,
      });
    } catch {
      /* discovery sync is best-effort; create path remains authoritative */
    }
  }

  return created;
}

/**
 * Permanently waive available qty on a recovery source (planning Waive or SO close).
 * Does not create NoQtySoWaiver rows — caller owns ceremony/audit.
 */
async function waiveAvailableQtyOnSource(
  tx,
  { recoverySourceId, qty, actorUserId = null, reason = null },
) {
  const id = Number(recoverySourceId);
  const waiveQty = round3(qty);
  if (!(waiveQty > EPS)) {
    throw recoveryError("Waiver qty must be positive.", { statusCode: 400, code: "WAIVER_QTY_INVALID" });
  }

  await lockRecoverySourceForUpdate(tx, id);
  const source = await tx.carryForwardPending.findUnique({
    where: { id },
    include: { allocations: { select: { status: true, allocatedQty: true } } },
  });
  if (!source) {
    throw recoveryError("Recovery source not found.", { statusCode: 404, code: "RECOVERY_SOURCE_NOT_FOUND" });
  }
  if (String(source.recoveryStatus) === "CANCELLED") {
    throw recoveryError("Cannot waive a cancelled recovery source.", {
      statusCode: 409,
      code: "RECOVERY_CANCELLED",
    });
  }

  const available = computeAvailableQty(source, source.allocations);
  if (waiveQty > available + EPS) {
    throw recoveryError(`Cannot waive ${waiveQty}; only ${available} available.`, {
      statusCode: 409,
      code: "WAIVER_QTY_EXCEEDS_AVAILABLE",
    });
  }

  const newWaived = round3(n(source.waivedQty) + waiveQty);
  await tx.carryForwardPending.update({
    where: { id },
    data: {
      waivedQty: String(newWaived),
      remarks: reason?.trim()
        ? `${source.remarks ? `${source.remarks}\n` : ""}Waived ${waiveQty}: ${reason.trim()}`
        : source.remarks,
    },
  });
  return recomputeRecoveryStatus(tx, id);
}

/**
 * Reverse a prior planning waive by reducing waivedQty (draft RS reverse only).
 */
async function reverseWaivedQtyOnSource(tx, { recoverySourceId, qty, actorUserId = null, reason = null }) {
  const id = Number(recoverySourceId);
  const reverseQty = round3(qty);
  if (!(reverseQty > EPS)) return null;

  await lockRecoverySourceForUpdate(tx, id);
  const source = await tx.carryForwardPending.findUnique({
    where: { id },
    include: { allocations: { select: { status: true, allocatedQty: true } } },
  });
  if (!source) {
    throw recoveryError("Recovery source not found.", { statusCode: 404, code: "RECOVERY_SOURCE_NOT_FOUND" });
  }
  if (String(source.recoveryStatus) === "CANCELLED") {
    throw recoveryError("Cannot reverse waiver on a cancelled recovery source.", {
      statusCode: 409,
      code: "RECOVERY_CANCELLED",
    });
  }

  const currentWaived = round3(n(source.waivedQty));
  if (reverseQty > currentWaived + EPS) {
    throw recoveryError(`Cannot reverse waive ${reverseQty}; only ${currentWaived} is waived.`, {
      statusCode: 409,
      code: "WAIVER_REVERSE_EXCEEDS",
    });
  }

  const newWaived = round3(Math.max(0, currentWaived - reverseQty));
  await tx.carryForwardPending.update({
    where: { id },
    data: {
      waivedQty: String(newWaived),
      remarks: reason?.trim()
        ? `${source.remarks ? `${source.remarks}\n` : ""}Waiver reversed ${reverseQty}: ${reason.trim()}`
        : source.remarks,
    },
  });
  return recomputeRecoveryStatus(tx, id);
}

/**
 * Cancel an unallocated (or only-RESERVED) QC recovery when the source QC is reversed.
 * Does not mutate COMMITTED irreversible allocations.
 */
async function cancelUnallocatedRecoverySource(
  tx,
  { recoveryType, sourceDocumentType, sourceDocumentId, actorUserId = null, reason = null },
) {
  const existing = await findExistingByProvenance(tx, { recoveryType, sourceDocumentType, sourceDocumentId });
  if (!existing) return null;

  await lockRecoverySourceForUpdate(tx, existing.id);
  const allocations = await tx.recoveryAllocation.findMany({ where: { recoverySourceId: existing.id } });
  const committed = allocations.filter((a) => a.status === "COMMITTED");
  if (committed.length) {
    throw recoveryError(
      "Cannot cancel recovery source with committed allocations; controlled exception required.",
      { code: "RECOVERY_CANCEL_BLOCKED" },
    );
  }

  for (const a of allocations.filter((x) => x.status === "RESERVED")) {
    await reverseRecovery(tx, {
      allocationId: a.id,
      reason: reason || "Source QC reversed",
      actorUserId,
    });
  }

  return tx.carryForwardPending.update({
    where: { id: existing.id },
    data: {
      recoveryStatus: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByUserId: actorUserId ?? null,
      cancelReason: reason?.trim() || "Source reversed",
      status: "CONSUMED",
      remainingQty: "0",
    },
  });
}

module.exports = {
  EPS,
  ACTIVE_ALLOC_STATUSES,
  computeAvailableQty,
  deriveRecoveryStatus,
  sumActiveAllocatedQty,
  lockRecoverySourceForUpdate,
  recomputeRecoveryStatus,
  createProductionShortRecovery,
  createFinalQcRejectedRecovery,
  appendTerminalQcScrapRecovery,
  getAvailableRecovery,
  allocateRecovery,
  reverseRecovery,
  commitReservedAllocationsForSheet,
  reverseAllocationsForSheet,
  getRecoverySummary,
  getRecoverySummariesBatch,
  buildRecoverySummaryFromRows,
  emptyRecoveryTotals,
  cancelUnallocatedRecoverySource,
  findExistingByProvenance,
  adjustExistingQcRejectionSource,
  waiveAvailableQtyOnSource,
  reverseWaivedQtyOnSource,
};
