/**
 * REGULAR_SO Prepare WO production buffer Admin approval (above 5% through 10%).
 * Store submits → Admin approves/rejects → Store creates WO only with approved buffer/qty.
 * Isolated from NO_QTY and from RM Planned Process Allowance approvals.
 */
const { Prisma } = require("../prismaClientPackage");
const { prisma } = require("../utils/prisma");
const auditLog = require("./auditLog");
const {
  assertRegularSoBufferPercentForPersist,
  applyFgUomPrecisionToPlannedQty,
  clampBufferPercent,
  upsertRegularSoPlanningSnapshot,
} = require("./regularSoPlanningSnapshotService");
const { computePlannedQtyFromCustomerBuffer } = require("./regularSoBufferQty");

const Decimal = Prisma.Decimal;
const ACTIVE_STATUSES = ["PENDING_APPROVAL", "APPROVED"];
const SUPERSEDABLE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "REJECTED"];
const QTY_EPS = 0.000001;
const PCT_EPS = 0.0001;

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function approvalError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

function qtyClose(a, b) {
  return Math.abs(n(a) - n(b)) <= QTY_EPS;
}

function pctClose(a, b) {
  return Math.abs(n(a) - n(b)) <= PCT_EPS;
}

function reasonEqual(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

function fingerprintsMatch(row, fingerprint) {
  if (!row || !fingerprint) return false;
  return (
    pctClose(row.bufferPercent, fingerprint.bufferPercent) &&
    qtyClose(row.plannedProductionQty, fingerprint.plannedProductionQty) &&
    reasonEqual(row.storeReason, fingerprint.storeReason)
  );
}

const includeRelations = {
  salesOrder: { select: { id: true, docNo: true, orderType: true } },
  fgItem: { select: { id: true, itemName: true, unit: true } },
  requestedBy: { select: { id: true, name: true, role: true } },
  reviewedBy: { select: { id: true, name: true, role: true } },
};

function serializeRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestNo: row.requestNo,
    salesOrderId: row.salesOrderId,
    salesOrderNo: row.salesOrder?.docNo ?? null,
    orderType: row.salesOrder?.orderType ?? null,
    fgItemId: row.fgItemId ?? null,
    fgItemName: row.fgItem?.itemName ?? null,
    fgUnit: row.fgItem?.unit ?? null,
    bufferPercent: clampBufferPercent(row.bufferPercent),
    plannedProductionQty: n(row.plannedProductionQty),
    storeReason: String(row.storeReason ?? "").trim(),
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    requestedByName: row.requestedBy?.name ?? null,
    requestedAt: row.requestedAt,
    reviewedByUserId: row.reviewedByUserId ?? null,
    reviewedByName: row.reviewedBy?.name ?? null,
    reviewedAt: row.reviewedAt ?? null,
    adminRemarks: row.adminRemarks ?? null,
    rejectionReason: row.rejectionReason ?? null,
  };
}

async function loadRegularSoFgContext(salesOrderId, db = prisma) {
  const soId = Number(salesOrderId);
  const so = await db.salesOrder.findUnique({
    where: { id: soId },
    include: {
      lines: {
        include: { item: { select: { id: true, itemName: true, itemType: true, unit: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!so) throw approvalError("Sales order not found.", "SO_NOT_FOUND", 404);
  const orderType = so.orderType ?? "NORMAL";
  if (orderType === "NO_QTY") {
    throw approvalError(
      "Production buffer approval is not available for NO_QTY sales orders.",
      "NO_QTY_BUFFER_APPROVAL_FORBIDDEN",
      400,
    );
  }
  const fgLines = (so.lines ?? []).filter((line) => line.item?.itemType === "FG");
  if (!fgLines.length) {
    throw approvalError("Sales order has no FG lines for production planning.", "NO_FG_LINES", 400);
  }
  return { so, fgLines };
}

function computePlannedProductionQtyTotal(fgLines, bufferPercent) {
  const pct = clampBufferPercent(bufferPercent);
  let total = 0;
  for (const line of fgLines) {
    const customer = n(line.customerPoQty ?? line.qty);
    const raw = computePlannedQtyFromCustomerBuffer(customer, pct);
    total += applyFgUomPrecisionToPlannedQty(raw, 0);
  }
  return total;
}

async function supersedeActiveRequests(tx, salesOrderId, exceptId = null) {
  await tx.regularSoBufferApprovalRequest.updateMany({
    where: {
      salesOrderId: Number(salesOrderId),
      status: { in: SUPERSEDABLE_STATUSES },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { status: "SUPERSEDED", updatedAt: new Date() },
  });
}

/**
 * Mark matching PENDING/APPROVED/REJECTED requests SUPERSEDED when buffer fingerprint drifts.
 */
async function supersedeRegularSoBufferApprovalsForSalesOrder(salesOrderId, db = prisma, exceptId = null) {
  const soId = Number(salesOrderId);
  if (!soId || !db.regularSoBufferApprovalRequest?.updateMany) return;
  await db.regularSoBufferApprovalRequest.updateMany({
    where: {
      salesOrderId: soId,
      status: { in: SUPERSEDABLE_STATUSES },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { status: "SUPERSEDED", updatedAt: new Date() },
  });
}

async function findMatchingApprovedBufferRequest(salesOrderId, fingerprint, db = prisma) {
  if (!db.regularSoBufferApprovalRequest?.findMany) return null;
  const rows = await db.regularSoBufferApprovalRequest.findMany({
    where: {
      salesOrderId: Number(salesOrderId),
      status: "APPROVED",
    },
    include: includeRelations,
    orderBy: { id: "desc" },
    take: 20,
  });
  return rows.find((row) => fingerprintsMatch(row, fingerprint)) ?? null;
}

/**
 * True when Store may persist buffer >5% because an APPROVED request matches the fingerprint.
 */
async function hasMatchingApprovedRegularSoBufferRequest(
  salesOrderId,
  { bufferPercent, bufferReason, plannedProductionQty = null },
  db = prisma,
) {
  const soId = Number(salesOrderId);
  const pct = clampBufferPercent(bufferPercent);
  const reason = String(bufferReason ?? "").trim();
  if (!soId || pct <= 5 + PCT_EPS || !reason) return false;

  let planned = plannedProductionQty;
  if (planned == null) {
    const { fgLines } = await loadRegularSoFgContext(soId, db);
    planned = computePlannedProductionQtyTotal(fgLines, pct);
  }
  const match = await findMatchingApprovedBufferRequest(
    soId,
    { bufferPercent: pct, plannedProductionQty: planned, storeReason: reason },
    db,
  );
  return Boolean(match);
}

/**
 * Store submits buffer approval. No snapshot write until Admin approves.
 */
async function submitRegularSoBufferApprovalRequest(input, actor = {}, db = prisma) {
  const role = String(actor.role || "").toUpperCase();
  if (role !== "STORE" && role !== "ADMIN") {
    throw approvalError("Only Store (or Admin) may submit production buffer approval requests.", "FORBIDDEN", 403);
  }
  const userId = Number(actor.userId);
  if (!userId) throw approvalError("Authenticated user is required.", "UNAUTHORIZED", 401);

  const soId = Number(input.salesOrderId);
  const bufferPercent = clampBufferPercent(input.bufferPercent);
  const storeReason = String(input.storeReason || input.bufferReason || "").trim();

  if (!soId) throw approvalError("Sales order is required.", "INVALID_SALES_ORDER");
  if (!storeReason) {
    throw approvalError("A reason is required when requesting buffer approval.", "BUFFER_PERCENT_REASON_REQUIRED");
  }

  const gate = assertRegularSoBufferPercentForPersist(bufferPercent, {
    role: "ADMIN",
    bufferReason: storeReason,
  });
  if (!gate.ok && gate.code === "BUFFER_PERCENT_BLOCKED") {
    throw approvalError(gate.message, gate.code, gate.statusCode);
  }
  if (bufferPercent <= 5 + PCT_EPS) {
    throw approvalError(
      "Buffer within 5% does not require Admin approval — apply it directly.",
      "BUFFER_APPROVAL_NOT_REQUIRED",
      409,
    );
  }

  return db.$transaction(async (tx) => {
    const { so, fgLines } = await loadRegularSoFgContext(soId, tx);
    const plannedProductionQty = computePlannedProductionQtyTotal(fgLines, bufferPercent);
    const fingerprint = {
      bufferPercent,
      plannedProductionQty,
      storeReason,
    };

    const identicalPending = await tx.regularSoBufferApprovalRequest.findFirst({
      where: {
        salesOrderId: soId,
        status: "PENDING_APPROVAL",
      },
      include: includeRelations,
      orderBy: { id: "desc" },
    });
    if (identicalPending && fingerprintsMatch(identicalPending, fingerprint)) {
      return serializeRequest(identicalPending);
    }

    await supersedeActiveRequests(tx, soId);

    const primaryFg = fgLines[0];
    const created = await tx.regularSoBufferApprovalRequest.create({
      data: {
        requestNo: `RSB-${Date.now().toString(36).toUpperCase()}-${soId}`,
        salesOrderId: soId,
        fgItemId: primaryFg?.itemId ?? null,
        bufferPercent: new Decimal(bufferPercent),
        plannedProductionQty: new Decimal(plannedProductionQty),
        storeReason,
        status: "PENDING_APPROVAL",
        requestedByUserId: userId,
        requestedAt: new Date(),
      },
      include: includeRelations,
    });

    await auditLog.write(tx, {
      actorUserId: userId,
      action: "CREATE",
      entityType: "SETTINGS",
      entityId: `REGULAR_SO_BUFFER_APPROVAL:${created.id}`,
      summary: `REGULAR SO buffer approval requested for ${so.docNo ?? `SO-${soId}`}`,
      payload: {
        requestId: created.id,
        salesOrderId: soId,
        bufferPercent,
        plannedProductionQty,
        status: "PENDING_APPROVAL",
      },
      reason: storeReason,
    });

    return serializeRequest(created);
  });
}

async function listRegularSoBufferApprovals(filters = {}, db = prisma) {
  if (!db.regularSoBufferApprovalRequest?.findMany) return [];
  const where = {};
  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    where.status = { in: statuses };
  }
  if (filters.salesOrderId) where.salesOrderId = Number(filters.salesOrderId);
  const rows = await db.regularSoBufferApprovalRequest.findMany({
    where,
    include: includeRelations,
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(Number(filters.limit) || 100, 1), 200),
  });
  return rows.map(serializeRequest);
}

async function getRegularSoBufferApprovalById(id, db = prisma) {
  const row = await db.regularSoBufferApprovalRequest.findUnique({
    where: { id: Number(id) },
    include: includeRelations,
  });
  if (!row) throw approvalError("Approval request not found.", "APPROVAL_NOT_FOUND", 404);
  return serializeRequest(row);
}

async function getLatestRegularSoBufferApprovalForSalesOrder(salesOrderId, db = prisma) {
  if (!db.regularSoBufferApprovalRequest?.findFirst) return null;
  const row = await db.regularSoBufferApprovalRequest.findFirst({
    where: {
      salesOrderId: Number(salesOrderId),
      status: { in: ["PENDING_APPROVAL", "APPROVED", "REJECTED"] },
    },
    include: includeRelations,
    orderBy: { id: "desc" },
  });
  return serializeRequest(row);
}

/**
 * Admin approves: apply planning snapshot with approved buffer, then mark APPROVED.
 */
async function approveRegularSoBufferApprovalRequest(id, input = {}, actor = {}, db = prisma) {
  const role = String(actor.role || "").toUpperCase();
  if (role !== "ADMIN") {
    throw approvalError("Only Admin may approve production buffer requests.", "FORBIDDEN", 403);
  }
  const userId = Number(actor.userId);
  if (!userId) throw approvalError("Authenticated user is required.", "UNAUTHORIZED", 401);
  const adminRemarks = String(input.adminRemarks || "").trim() || null;

  return db.$transaction(async (tx) => {
    const row = await tx.regularSoBufferApprovalRequest.findUnique({
      where: { id: Number(id) },
      include: includeRelations,
    });
    if (!row) throw approvalError("Approval request not found.", "APPROVAL_NOT_FOUND", 404);
    if (row.status !== "PENDING_APPROVAL") {
      throw approvalError(`Request is ${row.status} and cannot be approved.`, "APPROVAL_NOT_PENDING", 409);
    }
    if (row.requestedByUserId === userId) {
      throw approvalError(
        "Requester cannot approve their own production buffer request.",
        "SELF_APPROVAL_FORBIDDEN",
        403,
      );
    }

    // Apply snapshot as Admin so Store can create WO with the approved buffer.
    await upsertRegularSoPlanningSnapshot(
      {
        salesOrderId: row.salesOrderId,
        bufferPercent: n(row.bufferPercent),
        createdByUserId: userId,
        actorRole: "ADMIN",
        bufferReason: row.storeReason,
        skipBufferApprovalSupersede: true,
      },
      tx,
    );

    const updated = await tx.regularSoBufferApprovalRequest.update({
      where: { id: row.id },
      data: {
        status: "APPROVED",
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        adminRemarks,
        rejectionReason: null,
      },
      include: includeRelations,
    });

    await auditLog.write(tx, {
      actorUserId: userId,
      action: "APPROVE",
      entityType: "SETTINGS",
      entityId: `REGULAR_SO_BUFFER_APPROVAL:${updated.id}`,
      summary: `REGULAR SO buffer approval approved for request ${updated.requestNo ?? updated.id}`,
      payload: {
        requestId: updated.id,
        salesOrderId: updated.salesOrderId,
        bufferPercent: n(updated.bufferPercent),
        plannedProductionQty: n(updated.plannedProductionQty),
        status: "APPROVED",
        adminRemarks,
      },
      reason: adminRemarks,
    });

    return serializeRequest(updated);
  });
}

async function rejectRegularSoBufferApprovalRequest(id, input = {}, actor = {}, db = prisma) {
  const role = String(actor.role || "").toUpperCase();
  if (role !== "ADMIN") {
    throw approvalError("Only Admin may reject production buffer requests.", "FORBIDDEN", 403);
  }
  const userId = Number(actor.userId);
  if (!userId) throw approvalError("Authenticated user is required.", "UNAUTHORIZED", 401);
  const rejectionReason = String(input.rejectionReason || input.adminRemarks || "").trim();
  if (!rejectionReason) {
    throw approvalError("Admin remarks are mandatory when rejecting.", "REJECTION_REASON_REQUIRED");
  }
  const adminRemarks = String(input.adminRemarks || rejectionReason).trim();

  return db.$transaction(async (tx) => {
    const row = await tx.regularSoBufferApprovalRequest.findUnique({
      where: { id: Number(id) },
      include: includeRelations,
    });
    if (!row) throw approvalError("Approval request not found.", "APPROVAL_NOT_FOUND", 404);
    if (row.status !== "PENDING_APPROVAL") {
      throw approvalError(`Request is ${row.status} and cannot be rejected.`, "APPROVAL_NOT_PENDING", 409);
    }

    const updated = await tx.regularSoBufferApprovalRequest.update({
      where: { id: row.id },
      data: {
        status: "REJECTED",
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        rejectionReason,
        adminRemarks,
      },
      include: includeRelations,
    });

    await auditLog.write(tx, {
      actorUserId: userId,
      action: "REJECT",
      entityType: "SETTINGS",
      entityId: `REGULAR_SO_BUFFER_APPROVAL:${updated.id}`,
      summary: `REGULAR SO buffer approval rejected for request ${updated.requestNo ?? updated.id}`,
      payload: {
        requestId: updated.id,
        salesOrderId: updated.salesOrderId,
        status: "REJECTED",
        rejectionReason,
        adminRemarks,
      },
      reason: rejectionReason,
    });

    return serializeRequest(updated);
  });
}

/**
 * WO create gate for REGULAR_SO: buffer ≤5% ok; >5–10% requires APPROVED fingerprint
 * matching current planning snapshot (buffer % + planned WO qty + store reason).
 * Admin may create without a Store approval request. NO_QTY is excluded by caller.
 */
async function assertRegularSoBufferApprovalForWoCreate(
  salesOrderId,
  { actorRole = null } = {},
  db = prisma,
) {
  const role = String(actorRole || "").toUpperCase();
  if (role === "ADMIN") return { ok: true };

  const soId = Number(salesOrderId);
  if (!soId) throw approvalError("Sales order is required.", "INVALID_SALES_ORDER");

  const { so, fgLines } = await loadRegularSoFgContext(soId, db);
  void so;

  const { buildRegularSoPlanningSnapshotView } = require("./regularSoPlanningSnapshotService");
  const planningView = await buildRegularSoPlanningSnapshotView(soId, db);
  const bufferPercent = clampBufferPercent(planningView?.bufferPercent ?? 0);

  if (bufferPercent <= 5 + PCT_EPS) return { ok: true, bufferPercent };

  if (bufferPercent > 10 + PCT_EPS) {
    throw approvalError(
      "Production buffer above 10% is blocked.",
      "BUFFER_PERCENT_BLOCKED",
      400,
    );
  }

  const plannedProductionQty = computePlannedProductionQtyTotal(fgLines, bufferPercent);
  const approvedRows = db.regularSoBufferApprovalRequest?.findMany
    ? await db.regularSoBufferApprovalRequest.findMany({
        where: { salesOrderId: soId, status: "APPROVED" },
        include: includeRelations,
        orderBy: { id: "desc" },
        take: 20,
      })
    : [];

  const match = approvedRows.find((row) =>
    fingerprintsMatch(row, {
      bufferPercent,
      plannedProductionQty,
      storeReason: row.storeReason,
    }),
  );

  // Match buffer % + planned qty against an APPROVED request (reason is that request's own reason).
  const matchByQty = approvedRows.find(
    (row) =>
      pctClose(row.bufferPercent, bufferPercent) && qtyClose(row.plannedProductionQty, plannedProductionQty),
  );

  if (!match && !matchByQty) {
    throw approvalError(
      "Buffer above 5% requires a matching Admin-approved request before creating the Work Order.",
      "BUFFER_PERCENT_ADMIN_REQUIRED",
      403,
    );
  }

  return {
    ok: true,
    bufferPercent,
    plannedProductionQty,
    approvalId: (match || matchByQty).id,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  SUPERSEDABLE_STATUSES,
  submitRegularSoBufferApprovalRequest,
  listRegularSoBufferApprovals,
  getRegularSoBufferApprovalById,
  getLatestRegularSoBufferApprovalForSalesOrder,
  approveRegularSoBufferApprovalRequest,
  rejectRegularSoBufferApprovalRequest,
  hasMatchingApprovedRegularSoBufferRequest,
  findMatchingApprovedBufferRequest,
  supersedeRegularSoBufferApprovalsForSalesOrder,
  assertRegularSoBufferApprovalForWoCreate,
  computePlannedProductionQtyTotal,
  fingerprintsMatch,
  serializeRequest,
};
