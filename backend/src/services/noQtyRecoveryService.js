/**
 * NO_QTY Batch 3B — Recovery Engine (authoritative).
 *
 * Available Qty = sourceQty − active allocations (RESERVED|COMMITTED) − waivedQty
 *
 * Does not own SO closure, RS create/lock orchestration, dashboard, or reports.
 */

const { Prisma } = require("../prismaClientPackage");

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
 * Create QC_FINAL_REJECTION recovery from terminal unusable qty (scrap / final reject).
 * Never call for first-pass rework/hold routing.
 */
async function createFinalQcRejectedRecovery(
  tx,
  {
    salesOrderId,
    itemId,
    sourceQty,
    workOrderId = null,
    cycleId = null,
    sourceDocumentType = "QC_REJECTED_DISPOSITION",
    sourceDocumentId,
    remarks = null,
    actorUserId = null,
    resolutionReason = "QUALITY_CONCERN",
  },
) {
  const qty = round3(sourceQty);
  if (qty <= EPS) return null;

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
    // Same disposition may scrap in multiple steps — increase source if new terminal qty exceeds prior.
    const prev = round3(n(existing.sourceQty));
    if (qty > prev + EPS) {
      const delta = round3(qty - prev);
      const updated = await tx.carryForwardPending.update({
        where: { id: existing.id },
        data: {
          sourceQty: String(qty),
          remainingQty: String(round3(n(existing.remainingQty) + delta)),
          remarks: remarks?.trim() || existing.remarks,
        },
      });
      return recomputeRecoveryStatus(tx, updated.id);
    }
    return existing;
  }

  try {
    return await tx.carryForwardPending.create({
      data: {
        itemId: iid,
        salesOrderId: soId,
        sourceWorkOrderId: workOrderId != null ? Number(workOrderId) : null,
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
      if (again) return again;
    }
    throw e;
  }
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

async function getRecoverySummary(db, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    return {
      salesOrderId: soId,
      sources: [],
      totals: {
        productionShortfallSourceQty: 0,
        productionShortfallAvailableQty: 0,
        qcFinalRejectionSourceQty: 0,
        qcFinalRejectionAvailableQty: 0,
        waivedQty: 0,
        activeAllocatedQty: 0,
      },
    };
  }

  const rows = await db.carryForwardPending.findMany({
    where: { salesOrderId: soId },
    include: {
      allocations: true,
      item: { select: { id: true, itemName: true, unit: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const sources = rows.map((r) => {
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
      cycleId: r.cycleId,
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

  const totals = {
    productionShortfallSourceQty: 0,
    productionShortfallAvailableQty: 0,
    qcFinalRejectionSourceQty: 0,
    qcFinalRejectionAvailableQty: 0,
    waivedQty: 0,
    activeAllocatedQty: 0,
  };
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

/**
 * Append terminal scrap qty onto a QC_FINAL_REJECTION recovery for a disposition.
 * Call only from disposition terminal-scrap paths (hold scrap, deny→scrap, final recheck scrap).
 * Do NOT call from first-pass QC entry scrap creation.
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

  const existing = await findExistingByProvenance(tx, {
    recoveryType: "QC_FINAL_REJECTION",
    sourceDocumentType: "QC_REJECTED_DISPOSITION",
    sourceDocumentId: dispositionId,
  });
  const nextQty = existing ? round3(n(existing.sourceQty) + delta) : delta;

  return createFinalQcRejectedRecovery(tx, {
    salesOrderId: soId,
    itemId,
    sourceQty: nextQty,
    workOrderId: disposition.workOrderId ?? disposition.workOrder?.id ?? null,
    cycleId: disposition.workOrder?.cycleId ?? disposition.cycleId ?? null,
    sourceDocumentType: "QC_REJECTED_DISPOSITION",
    sourceDocumentId: dispositionId,
    remarks: remarks ?? disposition.remarks ?? null,
    actorUserId,
  });
}

/**
 * Cancel an unallocated (or only-RESERVED) QC recovery when the source QC is reversed.
 * Does not mutate COMMITTED irreversible allocations.
 */
async function cancelUnallocatedRecoverySource(tx, { recoveryType, sourceDocumentType, sourceDocumentId, actorUserId = null, reason = null }) {
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
  cancelUnallocatedRecoverySource,
  findExistingByProvenance,
};
