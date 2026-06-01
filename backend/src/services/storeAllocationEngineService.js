const { prisma } = require("../utils/prisma");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const { ensureSubmittedProductionMaterialRequestForWorkOrder } = require("./productionMaterialRequestService");
const { buildMaterialAvailabilityWorkspace } = require("./materialAvailabilityWorkspaceService");
const { ACTIVE_ALLOCATION_STATUSES } = require("./materialAllocationService");

const EPS = 1e-6;

function n(v) {
  return qtyToNumber(v);
}

function round3(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

function runInTransaction(db, fn) {
  return typeof db?.$transaction === "function" ? db.$transaction(fn) : fn(db);
}

function assertOpenWorkOrder(wo) {
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  const status = String(wo.status || "");
  if (!["PENDING", "IN_PROGRESS", "HOLD"].includes(status)) {
    const err = new Error("Allocation is allowed only for open work orders.");
    err.statusCode = 400;
    throw err;
  }
  if (wo.salesOrder?.orderType === "NO_QTY") {
    const err = new Error("Allocation engine is enabled only for REGULAR work orders.");
    err.statusCode = 400;
    throw err;
  }
}

async function refreshRmControlCenterCase({ workOrderId }) {
  return buildMaterialAvailabilityWorkspace(undefined, { workOrderId: Number(workOrderId) });
}

/**
 * Store-owned allocation (PMR-anchored) — creates/updates MANUAL MaterialAllocation row for (PMR, WO, RM item).
 */
async function allocateForWorkOrder(input, actor = {}, db = prisma, deps = {}) {
  const ensurePmr = deps.ensureSubmittedProductionMaterialRequestForWorkOrder || ensureSubmittedProductionMaterialRequestForWorkOrder;
  const availabilityFn = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;
  const refresh = deps.refreshRmControlCenterCase || refreshRmControlCenterCase;

  const workOrderId = Number(input.workOrderId);
  const rmItemId = Number(input.rmItemId);
  const qty = round3(n(input.qty));
  const note = input.note?.trim() || null;

  if (!Number.isFinite(workOrderId) || workOrderId <= 0) {
    const err = new Error("workOrderId is required.");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(rmItemId) || rmItemId <= 0) {
    const err = new Error("rmItemId is required.");
    err.statusCode = 400;
    throw err;
  }
  if (!(qty > EPS)) {
    const err = new Error("Allocation qty must be positive.");
    err.statusCode = 400;
    throw err;
  }

  // Ensure PMR exists and is submitted/open for Store issue.
  const pmr = await ensurePmr(workOrderId, actor, db);
  const pmrId = Number(pmr?.id);
  if (!pmrId) {
    const err = new Error("PMR could not be ensured for this work order.");
    err.statusCode = 500;
    throw err;
  }

  // Transaction-safe allocation check + write.
  await runInTransaction(db, async (tx) => {
    const wo = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      include: { salesOrder: { select: { id: true, docNo: true, orderType: true } } },
    });
    assertOpenWorkOrder(wo);

    const pmrFull = await tx.productionMaterialRequest.findUnique({
      where: { id: pmrId },
      include: { lines: true },
    });
    if (!pmrFull) {
      const err = new Error("PMR not found for allocation.");
      err.statusCode = 404;
      throw err;
    }
    const pmrLine = (pmrFull.lines || []).find((l) => Number(l.itemId) === rmItemId) || null;
    if (!pmrLine) {
      const err = new Error("RM item is not present on PMR for this work order.");
      err.statusCode = 400;
      throw err;
    }

    const requiredQty = round3(Math.max(0, n(pmrLine.requiredQty)));
    const issuedQty = round3(Math.max(0, n(pmrLine.issuedQty)));
    const remainingRequired = round3(Math.max(0, requiredQty - issuedQty));
    if (!(remainingRequired > EPS)) {
      const err = new Error("No pending RM requirement remains for allocation on this work order.");
      err.statusCode = 400;
      throw err;
    }

    const existingAllocs = await tx.materialAllocation.findMany({
      where: {
        productionMaterialRequestId: pmrId,
        workOrderId,
        rmItemId,
        status: { in: ACTIVE_ALLOCATION_STATUSES },
      },
      select: { id: true, qtyAllocated: true, qtyIssued: true, status: true, allocationType: true },
    });
    const activeAllocated = round3(
      existingAllocs.reduce((s, a) => s + Math.max(0, n(a.qtyAllocated) - n(a.qtyIssued)), 0),
    );
    const remainingToAllocate = round3(Math.max(0, remainingRequired - activeAllocated));
    if (!(remainingToAllocate > EPS)) {
      const err = new Error("Requirement is already fully allocated or issued for this RM item.");
      err.statusCode = 400;
      throw err;
    }

    // Free stock excluding this PMR's allocations so we can add to them safely.
    const requiredQtyByItemId = new Map([[rmItemId, requiredQty]]);
    const [availability] = await availabilityFn({
      db: tx,
      itemIds: [rmItemId],
      requiredQtyByItemId,
      includeIncoming: false,
      includeIssued: false,
      excludePmrId: pmrId,
    });
    const freeStock = round3(Math.max(0, n(availability?.freeStockQty)));
    const maxAlloc = Math.min(remainingToAllocate, freeStock);
    if (qty > maxAlloc + EPS) {
      const err = new Error(
        qty > freeStock + EPS
          ? `Cannot allocate ${qty}. Free stock is ${freeStock}.`
          : `Cannot allocate ${qty}. Pending requirement is ${remainingToAllocate}.`,
      );
      err.statusCode = 400;
      throw err;
    }

    const manual = existingAllocs.find((a) => a.allocationType === "MANUAL") || null;
    if (manual) {
      await tx.materialAllocation.update({
        where: { id: manual.id },
        data: {
          qtyAllocated: String(round3(n(manual.qtyAllocated) + qty)),
          status: "ACTIVE",
          remarks: note ? `${note}` : undefined,
        },
      });
    } else {
      await tx.materialAllocation.create({
        data: {
          allocationNo: null,
          rmItemId,
          salesOrderId: wo.salesOrder?.id ?? null,
          workOrderId,
          workOrderLineId: null,
          productionMaterialRequestId: pmrId,
          sourceLocationId: null,
          qtyAllocated: String(qty),
          qtyIssued: "0",
          status: "ACTIVE",
          priority: "NORMAL",
          allocationType: "MANUAL",
          remarks: note,
          createdByUserId: actor.userId ?? null,
        },
      });
    }
  });

  return {
    pmrId,
    workspace: await refresh({ workOrderId }),
  };
}

async function releaseForWorkOrder(input, actor = {}, db = prisma, deps = {}) {
  const availabilityFn = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;
  const refresh = deps.refreshRmControlCenterCase || refreshRmControlCenterCase;

  const allocationId = input.allocationId != null ? Number(input.allocationId) : null;
  const workOrderId = input.workOrderId != null ? Number(input.workOrderId) : null;
  const rmItemId = input.rmItemId != null ? Number(input.rmItemId) : null;
  const qty = round3(n(input.qty));
  const reason = input.reason?.trim() || null;

  if (!(qty > EPS)) {
    const err = new Error("Release qty must be positive.");
    err.statusCode = 400;
    throw err;
  }

  const out = await runInTransaction(db, async (tx) => {
    const where = allocationId
      ? { id: allocationId }
      : workOrderId && rmItemId
        ? {
            workOrderId,
            rmItemId,
            allocationType: "MANUAL",
            status: { in: ACTIVE_ALLOCATION_STATUSES },
          }
        : null;
    if (!where) {
      const err = new Error("Provide allocationId or (workOrderId + rmItemId).");
      err.statusCode = 400;
      throw err;
    }

    const alloc = allocationId
      ? await tx.materialAllocation.findUnique({ where: { id: allocationId } })
      : await tx.materialAllocation.findFirst({ where });
    if (!alloc) {
      const err = new Error("Allocation not found.");
      err.statusCode = 404;
      throw err;
    }
    if (!ACTIVE_ALLOCATION_STATUSES.includes(String(alloc.status || ""))) {
      const err = new Error("Only active allocations can be released.");
      err.statusCode = 400;
      throw err;
    }

    const allocated = round3(Math.max(0, n(alloc.qtyAllocated)));
    const issued = round3(Math.max(0, n(alloc.qtyIssued)));
    const unissued = round3(Math.max(0, allocated - issued));
    if (!(unissued > EPS)) {
      const err = new Error("No unissued allocation quantity remains to release.");
      err.statusCode = 400;
      throw err;
    }
    if (qty > unissued + EPS) {
      const err = new Error(`Cannot release ${qty}. Unissued allocation is ${unissued}.`);
      err.statusCode = 400;
      throw err;
    }

    const nextAllocated = round3(Math.max(issued, allocated - qty));
    const fullyReleased = nextAllocated <= issued + EPS;
    await tx.materialAllocation.update({
      where: { id: alloc.id },
      data: {
        qtyAllocated: String(nextAllocated),
        status: fullyReleased ? (issued > EPS ? "ISSUED" : "RELEASED") : String(alloc.status),
        releasedByUserId: actor.userId ?? null,
        remarks: reason ? `${reason}` : undefined,
      },
    });

    return { workOrderId: alloc.workOrderId ?? workOrderId, pmrId: alloc.productionMaterialRequestId ?? null };
  });

  // availabilityFn referenced to keep parity with allocate signature (and future extended response), but not needed yet.
  void availabilityFn;

  return {
    pmrId: out.pmrId,
    workspace: out.workOrderId ? await refresh({ workOrderId: out.workOrderId }) : null,
  };
}

module.exports = {
  allocateForWorkOrder,
  releaseForWorkOrder,
};

