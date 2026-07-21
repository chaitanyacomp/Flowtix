/**
 * Planned Process Allowance Admin approval workflow (above 5% through 10%).
 * Store submits → Admin approves/rejects → Store issues (stock moves only on final issue).
 */
const { Prisma } = require("../prismaClientPackage");
const { prisma } = require("../utils/prisma");
const auditLog = require("./auditLog");
const {
  calculatePlannedProcessAllowance,
  validatePlannedProcessAllowance,
  applicableBomRequirement,
  defaultIssueNowQty,
} = require("./plannedProcessAllowanceService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");

const Decimal = Prisma.Decimal;
/** Active requests that block a new submit until superseded. */
const ACTIVE_STATUSES = ["PENDING_APPROVAL", "APPROVED"];
/**
 * Statuses cleared when a newer request is submitted or the fingerprint is invalidated.
 * REJECTED is included so a revise/resubmit does not leave a stale Rejected Pending Action.
 */
const SUPERSEDABLE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "REJECTED"];
/** PMR statuses that still allow Store Material Issue. */
const STORE_ISSUE_PMR_STATUSES = ["REQUESTED", "PARTIALLY_ISSUED"];
const QTY_EPS = 0.000001;

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

function serializeRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestNo: row.requestNo,
    workOrderId: row.workOrderId,
    workOrderNo: row.workOrder?.docNo ?? null,
    productionMaterialRequestId: row.productionMaterialRequestId,
    pmrDocNo: row.productionMaterialRequest?.docNo ?? null,
    salesOrderId: row.workOrder?.salesOrderId ?? null,
    salesOrderNo: row.workOrder?.salesOrder?.docNo ?? null,
    pmrLineId: row.pmrLineId,
    itemId: row.itemId,
    itemName: row.item?.itemName ?? null,
    unit: row.item?.unit ?? row.pmrLine?.unitSnapshot ?? null,
    theoreticalBomQty: n(row.theoreticalBomQty),
    applicableBomQty: n(row.applicableBomQty),
    alreadyIssuedQty: n(row.alreadyIssuedQty),
    addQty: n(row.addQty),
    allowancePct: n(row.allowancePct),
    issueQty: n(row.issueQty),
    availableQtyAtRequest: row.availableQtyAtRequest == null ? null : n(row.availableQtyAtRequest),
    storeReason: row.storeReason,
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    requestedByName: row.requestedBy?.name ?? null,
    requestedAt: row.requestedAt,
    reviewedByUserId: row.reviewedByUserId,
    reviewedByName: row.reviewedBy?.name ?? null,
    reviewedAt: row.reviewedAt,
    rejectionReason: row.rejectionReason,
    materialIssueNoteId: row.materialIssueNoteId,
    issuedAt: row.issuedAt,
    issuedByUserId: row.issuedByUserId,
  };
}

const includeRelations = {
  workOrder: { select: { id: true, docNo: true, salesOrderId: true, salesOrder: { select: { docNo: true } } } },
  productionMaterialRequest: { select: { id: true, docNo: true, status: true } },
  pmrLine: { select: { id: true, unitSnapshot: true, issuedQty: true, requiredQty: true, waivedQty: true } },
  item: { select: { id: true, itemName: true, unit: true } },
  requestedBy: { select: { id: true, name: true, role: true } },
  reviewedBy: { select: { id: true, name: true, role: true } },
};

async function supersedeActiveRequests(tx, pmrLineId, exceptId = null) {
  await tx.rmAllowanceApprovalRequest.updateMany({
    where: {
      pmrLineId,
      status: { in: SUPERSEDABLE_STATUSES },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { status: "SUPERSEDED", updatedAt: new Date() },
  });
}

/**
 * Mark an approval SUPERSEDED when quantities drift after approve/request.
 * Never writes REJECTED — invalidated ≠ rejected.
 */
async function markRmAllowanceApprovalSuperseded(requestId, db = prisma) {
  const id = Number(requestId);
  if (!id) return null;
  const existing = await db.rmAllowanceApprovalRequest.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) return null;
  if (!SUPERSEDABLE_STATUSES.includes(String(existing.status))) return existing;
  return db.rmAllowanceApprovalRequest.update({
    where: { id },
    data: { status: "SUPERSEDED", updatedAt: new Date() },
  });
}

/**
 * True when a Store PA / Material Issue bucket should still surface this approval.
 * Requires: current REJECTED|APPROVED|PENDING_APPROVAL, open PMR, and remaining qty on the RM line.
 */
function isRmAllowanceRequestActionableForStore(row) {
  const status = String(row?.status ?? "");
  if (!["PENDING_APPROVAL", "APPROVED", "REJECTED"].includes(status)) return false;
  const pmrStatus = String(row?.productionMaterialRequest?.status ?? row?.pmrStatus ?? "");
  if (!STORE_ISSUE_PMR_STATUSES.includes(pmrStatus)) return false;
  const line = row?.pmrLine ?? null;
  if (line) {
    const required = n(line.requiredQty);
    const issued = n(line.issuedQty);
    const waived = n(line.waivedQty ?? line.shortIssueQty ?? 0);
    const pending = Math.max(0, required - issued - waived);
    if (pending <= QTY_EPS) return false;
  } else if (row?.linePendingQty != null) {
    if (n(row.linePendingQty) <= QTY_EPS) return false;
  }
  return true;
}

/**
 * Store submits an approval request. No stock movement.
 */
async function submitRmAllowanceApprovalRequest(input, actor = {}, db = prisma) {
  const role = String(actor.role || "").toUpperCase();
  if (role !== "STORE" && role !== "ADMIN") {
    throw approvalError("Only Store (or Admin) may submit RM allowance approval requests.", "FORBIDDEN", 403);
  }
  const userId = Number(actor.userId);
  if (!userId) throw approvalError("Authenticated user is required.", "UNAUTHORIZED", 401);

  const pmrId = Number(input.productionMaterialRequestId);
  const pmrLineId = Number(input.pmrLineId);
  const issueQty = n(input.issueQty);
  const addQty = n(input.enteredAllowanceQty ?? input.addQty ?? 0);
  const reason = String(input.allowanceReason || input.storeReason || "").trim();
  const fromLocationId = input.fromLocationId != null ? Number(input.fromLocationId) : null;

  if (!pmrId || !pmrLineId) throw approvalError("PMR and PMR line are required.", "INVALID_PMR_LINE");
  if (issueQty <= 0) throw approvalError("Issue Now quantity must be positive.", "INVALID_ISSUE_QTY");
  if (addQty < 0) throw approvalError("Add Qty cannot be negative.", "INVALID_ADD_QTY");

  return db.$transaction(async (tx) => {
    const pmr = await tx.productionMaterialRequest.findUnique({
      where: { id: pmrId },
      include: {
        lines: { where: { id: pmrLineId }, include: { item: { select: { id: true, itemName: true, unit: true } } } },
        workOrder: { select: { id: true, docNo: true, salesOrderId: true } },
      },
    });
    if (!pmr) throw approvalError("Production material request not found.", "PMR_NOT_FOUND", 404);
    const pl = pmr.lines[0];
    if (!pl) throw approvalError("PMR line not found on this request.", "PMR_LINE_NOT_FOUND", 404);

    const theoreticalBomQty = n(pl.requiredQty);
    const alreadyIssuedQty = n(pl.issuedQty);
    const planning = validatePlannedProcessAllowance(
      {
        allowanceInputSource: "QUANTITY",
        theoreticalBomQty,
        alreadyIssuedQty,
        issueQty,
        enteredAllowanceQty: addQty,
        allowanceReason: reason,
      },
      { role, mode: "SUBMIT_APPROVAL" },
    );
    if (!planning.requiresAdminApproval) {
      throw approvalError(
        "Allowance is within 5%. Issue material normally — Admin approval is not required.",
        "ALLOWANCE_APPROVAL_NOT_REQUIRED",
        409,
      );
    }
    if (planning.plannedAllowancePct > 10 + QTY_EPS) {
      throw approvalError("Allowance above 10% cannot be sent for approval.", "PLANNED_ALLOWANCE_INITIAL_ISSUE_LIMIT", 409);
    }

    const applicableBomQty = planning.applicableBomQty;
    const expectedIssue = defaultIssueNowQty(theoreticalBomQty, addQty, alreadyIssuedQty);
    // Allow partial of the default target, but not above it for the request snapshot.
    if (issueQty > expectedIssue + QTY_EPS) {
      throw approvalError(
        `Requested Issue Now (${issueQty}) exceeds applicable BOM + Add Qty (${expectedIssue}).`,
        "ISSUE_QTY_EXCEEDS_TARGET",
        409,
      );
    }

    // Duplicate active request with identical fingerprint → return existing (idempotent).
    const existing = await tx.rmAllowanceApprovalRequest.findFirst({
      where: {
        pmrLineId,
        status: { in: ACTIVE_STATUSES },
        addQty: new Decimal(addQty),
        issueQty: new Decimal(issueQty),
      },
      include: includeRelations,
      orderBy: { id: "desc" },
    });
    if (existing) {
      return serializeRequest(existing);
    }

    await supersedeActiveRequests(tx, pmrLineId);

    let availableQtyAtRequest = null;
    if (fromLocationId > 0) {
      const avail = await getMaterialAvailabilityByItems({
        db: tx,
        itemIds: [pl.itemId],
        locationScope: { locationId: fromLocationId },
        includeIncoming: false,
        includeIssued: false,
      });
      availableQtyAtRequest = n(avail[0]?.freeStockQty);
    }

    const created = await tx.rmAllowanceApprovalRequest.create({
      data: {
        requestNo: `RAA-${Date.now().toString(36).toUpperCase()}-${pmrLineId}`,
        workOrderId: pmr.workOrderId,
        productionMaterialRequestId: pmrId,
        pmrLineId,
        itemId: pl.itemId,
        theoreticalBomQty: new Decimal(theoreticalBomQty),
        applicableBomQty: new Decimal(applicableBomQty),
        alreadyIssuedQty: new Decimal(alreadyIssuedQty),
        addQty: new Decimal(planning.plannedAllowanceQty),
        allowancePct: new Decimal(planning.plannedAllowancePct),
        issueQty: new Decimal(issueQty),
        availableQtyAtRequest: availableQtyAtRequest == null ? null : new Decimal(availableQtyAtRequest),
        storeReason: reason,
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
      entityId: `RM_ALLOWANCE_APPROVAL:${created.id}`,
      summary: `RM allowance approval requested for WO ${pmr.workOrder?.docNo ?? pmr.workOrderId}`,
      payload: {
        requestId: created.id,
        workOrderId: created.workOrderId,
        pmrId,
        pmrLineId,
        itemId: pl.itemId,
        applicableBomQty,
        alreadyIssuedQty,
        addQty: planning.plannedAllowanceQty,
        allowancePct: planning.plannedAllowancePct,
        issueQty,
        status: "PENDING_APPROVAL",
      },
      reason,
    });

    return serializeRequest(created);
  });
}

async function listRmAllowanceApprovals(filters = {}, db = prisma) {
  const where = {};
  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
  }
  if (filters.workOrderId) where.workOrderId = Number(filters.workOrderId);
  if (filters.productionMaterialRequestId) {
    where.productionMaterialRequestId = Number(filters.productionMaterialRequestId);
  }
  if (filters.pmrLineId) where.pmrLineId = Number(filters.pmrLineId);
  const rows = await db.rmAllowanceApprovalRequest.findMany({
    where,
    include: includeRelations,
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: Math.min(Number(filters.limit) || 100, 200),
  });
  return rows.map(serializeRequest);
}

async function getRmAllowanceApprovalById(id, db = prisma) {
  const row = await db.rmAllowanceApprovalRequest.findUnique({
    where: { id: Number(id) },
    include: includeRelations,
  });
  if (!row) throw approvalError("Approval request not found.", "APPROVAL_NOT_FOUND", 404);
  return serializeRequest(row);
}

async function approveRmAllowanceApprovalRequest(id, actor = {}, db = prisma) {
  const role = String(actor.role || "").toUpperCase();
  if (role !== "ADMIN") {
    throw approvalError("Only Admin may approve RM allowance requests.", "FORBIDDEN", 403);
  }
  const userId = Number(actor.userId);
  if (!userId) throw approvalError("Authenticated user is required.", "UNAUTHORIZED", 401);

  return db.$transaction(async (tx) => {
    const row = await tx.rmAllowanceApprovalRequest.findUnique({
      where: { id: Number(id) },
      include: includeRelations,
    });
    if (!row) throw approvalError("Approval request not found.", "APPROVAL_NOT_FOUND", 404);
    if (row.status !== "PENDING_APPROVAL") {
      throw approvalError(`Request is ${row.status} and cannot be approved.`, "APPROVAL_NOT_PENDING", 409);
    }
    if (row.requestedByUserId === userId) {
      throw approvalError(
        "Requester cannot approve their own RM allowance request.",
        "SELF_APPROVAL_FORBIDDEN",
        403,
      );
    }

    const updated = await tx.rmAllowanceApprovalRequest.update({
      where: { id: row.id },
      data: {
        status: "APPROVED",
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
      include: includeRelations,
    });

    await auditLog.write(tx, {
      actorUserId: userId,
      action: "APPROVE",
      entityType: "SETTINGS",
      entityId: `RM_ALLOWANCE_APPROVAL:${updated.id}`,
      summary: `RM allowance approval approved for request ${updated.requestNo ?? updated.id}`,
      payload: {
        requestId: updated.id,
        workOrderId: updated.workOrderId,
        pmrLineId: updated.pmrLineId,
        addQty: n(updated.addQty),
        issueQty: n(updated.issueQty),
        allowancePct: n(updated.allowancePct),
        status: "APPROVED",
      },
    });

    return serializeRequest(updated);
  });
}

async function rejectRmAllowanceApprovalRequest(id, input = {}, actor = {}, db = prisma) {
  const role = String(actor.role || "").toUpperCase();
  if (role !== "ADMIN") {
    throw approvalError("Only Admin may reject RM allowance requests.", "FORBIDDEN", 403);
  }
  const userId = Number(actor.userId);
  if (!userId) throw approvalError("Authenticated user is required.", "UNAUTHORIZED", 401);
  const rejectionReason = String(input.rejectionReason || "").trim();
  if (!rejectionReason) {
    throw approvalError("Rejection reason is mandatory.", "REJECTION_REASON_REQUIRED");
  }

  return db.$transaction(async (tx) => {
    const row = await tx.rmAllowanceApprovalRequest.findUnique({
      where: { id: Number(id) },
      include: includeRelations,
    });
    if (!row) throw approvalError("Approval request not found.", "APPROVAL_NOT_FOUND", 404);
    if (row.status !== "PENDING_APPROVAL") {
      throw approvalError(`Request is ${row.status} and cannot be rejected.`, "APPROVAL_NOT_PENDING", 409);
    }

    const updated = await tx.rmAllowanceApprovalRequest.update({
      where: { id: row.id },
      data: {
        status: "REJECTED",
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        rejectionReason,
      },
      include: includeRelations,
    });

    await auditLog.write(tx, {
      actorUserId: userId,
      action: "REJECT",
      entityType: "SETTINGS",
      entityId: `RM_ALLOWANCE_APPROVAL:${updated.id}`,
      summary: `RM allowance approval rejected for request ${updated.requestNo ?? updated.id}`,
      payload: {
        requestId: updated.id,
        workOrderId: updated.workOrderId,
        pmrLineId: updated.pmrLineId,
        status: "REJECTED",
        rejectionReason,
      },
      reason: rejectionReason,
    });

    return serializeRequest(updated);
  });
}

/**
 * Resolve and validate an APPROVED request for final issue. Does not post stock.
 * Returns the request row or null when approval is not required.
 */
async function resolveApprovedRequestForIssue(input, db = prisma) {
  const pmrLineId = Number(input.pmrLineId);
  const addQty = n(input.enteredAllowanceQty ?? input.addQty ?? 0);
  const issueQty = n(input.issueQty);
  const theoreticalBomQty = n(input.theoreticalBomQty);
  const alreadyIssuedQty = n(input.alreadyIssuedQty);
  const planning = calculatePlannedProcessAllowance(theoreticalBomQty, addQty, alreadyIssuedQty);

  if (!planning.requiresAdminApproval) return null;

  const requestId = input.allowanceApprovalRequestId != null ? Number(input.allowanceApprovalRequestId) : null;
  let row = null;
  if (requestId) {
    row = await db.rmAllowanceApprovalRequest.findUnique({ where: { id: requestId } });
  } else if (pmrLineId) {
    row = await db.rmAllowanceApprovalRequest.findFirst({
      where: { pmrLineId, status: "APPROVED" },
      orderBy: { id: "desc" },
    });
  }
  if (!row || row.status !== "APPROVED") {
    throw approvalError(
      "An approved RM allowance request is required before issuing above 5%.",
      "PLANNED_ALLOWANCE_ADMIN_APPROVAL_REQUIRED",
      403,
    );
  }
  // When caller supplies a line id, it must match the approved request fingerprint.
  if (pmrLineId && row.pmrLineId !== pmrLineId) {
    throw approvalError("Approval request does not match this PMR line.", "APPROVAL_LINE_MISMATCH", 409);
  }
  if (!qtyClose(row.addQty, addQty)) {
    await markRmAllowanceApprovalSuperseded(row.id, db);
    throw approvalError(
      "Add Qty changed after approval. Resubmit for Admin approval.",
      "APPROVAL_INVALIDATED",
      409,
    );
  }
  if (issueQty > n(row.issueQty) + QTY_EPS) {
    throw approvalError(
      "Issue Now exceeds the Admin-approved quantity. Resubmit for approval or reduce Issue Now.",
      "APPROVAL_QTY_EXCEEDED",
      409,
    );
  }
  const applicableNow = applicableBomRequirement(theoreticalBomQty, alreadyIssuedQty);
  if (!qtyClose(row.applicableBomQty, applicableNow) || !qtyClose(row.alreadyIssuedQty, alreadyIssuedQty)) {
    await markRmAllowanceApprovalSuperseded(row.id, db);
    throw approvalError(
      "BOM entitlement or already-issued quantity changed after approval. Resubmit for Admin approval.",
      "APPROVAL_INVALIDATED",
      409,
    );
  }
  if (!qtyClose(row.allowancePct, planning.plannedAllowancePct)) {
    await markRmAllowanceApprovalSuperseded(row.id, db);
    throw approvalError(
      "Allowance % no longer matches the approved request. Resubmit for Admin approval.",
      "APPROVAL_INVALIDATED",
      409,
    );
  }
  return row;
}

async function markRmAllowanceApprovalIssued(requestId, { materialIssueNoteId, userId }, db = prisma) {
  if (!requestId) return null;
  return db.rmAllowanceApprovalRequest.update({
    where: { id: Number(requestId) },
    data: {
      status: "ISSUED",
      materialIssueNoteId: materialIssueNoteId ?? null,
      issuedAt: new Date(),
      issuedByUserId: userId ?? null,
    },
  });
}

/**
 * After a ≤5% issue (no approval used), clear leftover Rejected/Approved/Pending
 * rows on the line so they cannot remain as stale Store Pending Actions.
 */
async function clearStaleAllowanceRequestsAfterNormalIssue(pmrLineId, db = prisma) {
  const id = Number(pmrLineId);
  if (!id) return { count: 0 };
  const result = await db.rmAllowanceApprovalRequest.updateMany({
    where: {
      pmrLineId: id,
      status: { in: SUPERSEDABLE_STATUSES },
    },
    data: { status: "SUPERSEDED", updatedAt: new Date() },
  });
  return { count: result?.count ?? 0 };
}

module.exports = {
  submitRmAllowanceApprovalRequest,
  listRmAllowanceApprovals,
  getRmAllowanceApprovalById,
  approveRmAllowanceApprovalRequest,
  rejectRmAllowanceApprovalRequest,
  resolveApprovedRequestForIssue,
  markRmAllowanceApprovalIssued,
  markRmAllowanceApprovalSuperseded,
  clearStaleAllowanceRequestsAfterNormalIssue,
  isRmAllowanceRequestActionableForStore,
  serializeRequest,
  ACTIVE_STATUSES,
  SUPERSEDABLE_STATUSES,
  STORE_ISSUE_PMR_STATUSES,
};
