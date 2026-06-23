/**
 * P6B-1B — NO_QTY Requirement Sheet lifecycle (create guard + cancellation eligibility).
 */

const { isPlanImmutableStatus } = require("./monthlyPlanningPlanLifecycleService");
const { NO_QTY_WO_PLACED_COUNT_STATUSES } = require("./noQtyExecutionReleaseService");

const MONTHLY_PLAN_SOURCE = "MONTHLY_PLAN";

/** User-facing messages (Objective 7). */
const RS_LIFECYCLE_MESSAGES = Object.freeze({
  CYCLE_ALREADY_LOCKED:
    "Cannot create another Requirement Sheet for this cycle. The cycle is already locked. Create the next cycle instead.",
  CYCLE_DEMAND_CANCELLED:
    "Cannot create another Requirement Sheet for this cycle. This cycle's requirement was cancelled. Create the next cycle instead.",
  LOCKED_CYCLE_CANNOT_REVISE: "Locked cycle cannot be revised. Create the next cycle instead.",
  CANCEL_SUCCESS: "Requirement Sheet cancelled successfully.",
  NOT_LOCKED: "Only locked requirement sheets can be cancelled.",
  ALREADY_CANCELLED: "This requirement sheet is already cancelled.",
  PRODUCTION_STARTED: "Cannot cancel. Production has already started on this cycle.",
  PRODUCTION_COMPLETED: "Cannot cancel. Production has already been completed on this cycle.",
  PROCUREMENT_RELEASED: "Cannot cancel. Procurement has already been released.",
  MONTHLY_PLAN_APPROVED: "Cannot cancel. Monthly Planning has already been approved for this period.",
  PO_EXISTS: "Cannot cancel. A purchase order already exists for this planning period.",
  GRN_POSTED: "Cannot cancel. Goods receipt has already been posted for this planning period.",
  PMR_ISSUED: "Cannot cancel. Store has already issued material for this work order.",
  WORK_ORDER_EXISTS: "Cannot cancel. Active Work Orders already exist for this Requirement Sheet.",
  DISPATCH_EXISTS: "Cannot cancel. Dispatch records exist for this cycle.",
  SALES_BILL_EXISTS: "Cannot cancel. A sales bill exists for this cycle.",
});

class RequirementSheetLifecycleError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [statusCode]
   * @param {object} [details]
   */
  constructor(code, message, statusCode = 409, details = null) {
    super(message);
    this.name = "RequirementSheetLifecycleError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof import("../utils/prisma").prisma} db
 * @param {number | null | undefined} cycleId
 */
async function resolveCycleNoLabel(db, cycleId) {
  const cid = cycleId != null ? Number(cycleId) : NaN;
  if (!Number.isFinite(cid) || cid <= 0) return null;
  const row = await db.salesOrderCycle.findUnique({
    where: { id: cid },
    select: { cycleNo: true },
  });
  const n = row?.cycleNo != null ? Number(row.cycleNo) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cycleLockedCreateMessage(cycleNo) {
  if (cycleNo != null) {
    return `Cannot create another Requirement Sheet for Cycle ${cycleNo}. Cycle ${cycleNo} is already locked. Create the next cycle instead.`;
  }
  return RS_LIFECYCLE_MESSAGES.CYCLE_ALREADY_LOCKED;
}

function cycleCancelledCreateMessage(cycleNo) {
  if (cycleNo != null) {
    return `Cannot create another Requirement Sheet for Cycle ${cycleNo}. This cycle's requirement was cancelled. Create the next cycle instead.`;
  }
  return RS_LIFECYCLE_MESSAGES.CYCLE_DEMAND_CANCELLED;
}

/**
 * Block same-cycle revision: one terminal demand record per (SO, cycle, period).
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ salesOrderId: number; cycleId: number | null; periodKey: string }} input
 */
async function assertNoLockedOrCancelledSheetForCyclePeriod(tx, input) {
  const soId = Number(input.salesOrderId);
  const cycleId = input.cycleId != null ? Number(input.cycleId) : null;
  const periodKey = String(input.periodKey ?? "").trim();
  if (!Number.isFinite(soId) || soId <= 0 || !periodKey) {
    throw new RequirementSheetLifecycleError("INVALID_INPUT", "Invalid requirement sheet scope.", 400);
  }

  const cycleNo = await resolveCycleNoLabel(tx, cycleId);

  const locked = await tx.requirementSheet.findFirst({
    where: {
      salesOrderId: soId,
      cycleId,
      periodKey,
      status: "LOCKED",
    },
    select: { id: true, docNo: true },
  });
  if (locked) {
    throw new RequirementSheetLifecycleError("CYCLE_ALREADY_LOCKED", cycleLockedCreateMessage(cycleNo), 409, {
      existingSheetId: locked.id,
      cycleNo,
    });
  }

  const cancelled = await tx.requirementSheet.findFirst({
    where: {
      salesOrderId: soId,
      cycleId,
      periodKey,
      status: "CANCELLED",
    },
    select: { id: true },
  });
  if (cancelled) {
    throw new RequirementSheetLifecycleError("CYCLE_DEMAND_CANCELLED", cycleCancelledCreateMessage(cycleNo), 409, {
      existingSheetId: cancelled.id,
      cycleNo,
    });
  }
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof import("../utils/prisma").prisma} db
 * @param {string} periodKey
 */
async function findBlockingMonthlyPlan(db, periodKey) {
  const pk = String(periodKey ?? "").trim();
  if (!pk) return null;
  const plans = await db.monthlyProductionPlan.findMany({
    where: { periodKey: pk },
    select: {
      id: true,
      docNo: true,
      status: true,
      releasedAt: true,
      planSequenceNo: true,
    },
    orderBy: { planSequenceNo: "asc" },
  });
  for (const plan of plans) {
    if (plan.releasedAt != null) {
      return { kind: "PROCUREMENT_RELEASED", plan };
    }
    if (isPlanImmutableStatus(plan.status)) {
      return { kind: "MONTHLY_PLAN_APPROVED", plan };
    }
  }
  return null;
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof import("../utils/prisma").prisma} db
 * @param {string} periodKey
 */
async function findBlockingRmPoDocNo(db, periodKey) {
  const pk = String(periodKey ?? "").trim();
  if (!pk) return null;
  const link = await db.rmPoLineProcurementLink.findFirst({
    where: {
      materialRequirementLine: {
        materialRequirement: {
          sourceType: MONTHLY_PLAN_SOURCE,
          reversedAt: null,
          monthlyProductionPlan: { periodKey: pk },
        },
      },
    },
    select: {
      rmPoLine: {
        select: {
          rmPo: { select: { id: true, docNo: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  const docNo = link?.rmPoLine?.rmPo?.docNo?.trim();
  return docNo || (link?.rmPoLine?.rmPo?.id ? `PO-${link.rmPoLine.rmPo.id}` : null);
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof import("../utils/prisma").prisma} db
 * @param {string} periodKey
 */
async function hasGrnForMonthlyPlanPeriod(db, periodKey) {
  const pk = String(periodKey ?? "").trim();
  if (!pk) return false;
  const count = await db.grn.count({
    where: {
      rmPo: {
        lines: {
          some: {
            procurementLinks: {
              some: {
                materialRequirementLine: {
                  materialRequirement: {
                    sourceType: MONTHLY_PLAN_SOURCE,
                    reversedAt: null,
                    monthlyProductionPlan: { periodKey: pk },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  return count > 0;
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof import("../utils/prisma").prisma} db
 * @param {number} sheetId
 * @returns {Promise<{ allowed: boolean; code: string; message: string; details?: object }>}
 */
async function evaluateRequirementSheetCancellation(db, sheetId) {
  const id = Number(sheetId);
  if (!Number.isFinite(id) || id <= 0) {
    return { allowed: false, code: "INVALID_ID", message: "Invalid requirement sheet id." };
  }

  const sheet = await db.requirementSheet.findUnique({
    where: { id },
    include: { salesOrder: { select: { orderType: true } } },
  });
  if (!sheet) {
    return { allowed: false, code: "NOT_FOUND", message: "Requirement sheet not found." };
  }
  if (sheet.salesOrder?.orderType !== "NO_QTY") {
    return { allowed: false, code: "NOT_NO_QTY", message: "Cancellation is allowed only for No Qty requirement sheets." };
  }
  if (sheet.status === "CANCELLED") {
    return { allowed: false, code: "ALREADY_CANCELLED", message: RS_LIFECYCLE_MESSAGES.ALREADY_CANCELLED };
  }
  if (sheet.status !== "LOCKED") {
    return { allowed: false, code: "NOT_LOCKED", message: RS_LIFECYCLE_MESSAGES.NOT_LOCKED };
  }

  const activeWos = await db.workOrder.findMany({
    where: { requirementSheetId: sheet.id, status: { in: [...NO_QTY_WO_PLACED_COUNT_STATUSES] } },
    select: { id: true, cycleId: true },
  });

  if (activeWos.length) {
    const woIds = activeWos.map((wo) => wo.id);
    const prodAnyCount = await db.productionEntry.count({
      where: { workOrderLine: { workOrderId: { in: woIds } } },
    });
    if (prodAnyCount > 0) {
      return { allowed: false, code: "PRODUCTION_STARTED", message: RS_LIFECYCLE_MESSAGES.PRODUCTION_STARTED };
    }

    const prodApprovedCount = await db.productionEntry.count({
      where: { workOrderLine: { workOrderId: { in: woIds } }, workflowStatus: "APPROVED" },
    });
    if (prodApprovedCount > 0) {
      return { allowed: false, code: "PRODUCTION_COMPLETED", message: RS_LIFECYCLE_MESSAGES.PRODUCTION_COMPLETED };
    }

    const pmrActive = await db.productionMaterialRequest.findFirst({
      where: {
        workOrderId: { in: woIds },
        status: { in: ["REQUESTED", "PARTIALLY_ISSUED", "ISSUED"] },
      },
      select: { id: true, docNo: true, status: true },
    });
    if (pmrActive) {
      return {
        allowed: false,
        code: "PMR_ISSUED",
        message: RS_LIFECYCLE_MESSAGES.PMR_ISSUED,
        details: { pmrDocNo: pmrActive.docNo ?? null },
      };
    }

    const issueNoteCount = await db.materialIssueNote.count({
      where: { productionMaterialRequest: { workOrderId: { in: woIds } } },
    });
    if (issueNoteCount > 0) {
      return { allowed: false, code: "PMR_ISSUED", message: RS_LIFECYCLE_MESSAGES.PMR_ISSUED };
    }

    return {
      allowed: false,
      code: "WORK_ORDER_EXISTS",
      message: RS_LIFECYCLE_MESSAGES.WORK_ORDER_EXISTS,
      details: { workOrderIds: woIds },
    };
  }

  const cycleId = sheet.cycleId != null ? Number(sheet.cycleId) : null;
  if (cycleId != null && Number.isFinite(Number(cycleId))) {
    const dispatchCount = await db.dispatch.count({
      where: { soId: sheet.salesOrderId, cycleId: Number(cycleId), reversalOfId: null },
    });
    if (dispatchCount > 0) {
      return { allowed: false, code: "DISPATCH_EXISTS", message: RS_LIFECYCLE_MESSAGES.DISPATCH_EXISTS };
    }

    const billCount = await db.salesBill.count({
      where: { cycleId: Number(cycleId), dispatch: { soId: sheet.salesOrderId } },
    });
    if (billCount > 0) {
      return { allowed: false, code: "SALES_BILL_EXISTS", message: RS_LIFECYCLE_MESSAGES.SALES_BILL_EXISTS };
    }
  }

  const periodKey = String(sheet.periodKey ?? "").trim();
  const planBlock = await findBlockingMonthlyPlan(db, periodKey);
  if (planBlock?.kind === "PROCUREMENT_RELEASED") {
    return {
      allowed: false,
      code: "PROCUREMENT_RELEASED",
      message: RS_LIFECYCLE_MESSAGES.PROCUREMENT_RELEASED,
      details: { planId: planBlock.plan.id, planDocNo: planBlock.plan.docNo ?? null },
    };
  }
  if (planBlock?.kind === "MONTHLY_PLAN_APPROVED") {
    return {
      allowed: false,
      code: "MONTHLY_PLAN_APPROVED",
      message: RS_LIFECYCLE_MESSAGES.MONTHLY_PLAN_APPROVED,
      details: { planId: planBlock.plan.id, planDocNo: planBlock.plan.docNo ?? null },
    };
  }

  const poDocNo = await findBlockingRmPoDocNo(db, periodKey);
  if (poDocNo) {
    return {
      allowed: false,
      code: "PO_EXISTS",
      message: `Cannot cancel. PO ${poDocNo} already exists.`,
      details: { poDocNo },
    };
  }

  if (await hasGrnForMonthlyPlanPeriod(db, periodKey)) {
    return { allowed: false, code: "GRN_POSTED", message: RS_LIFECYCLE_MESSAGES.GRN_POSTED };
  }

  return { allowed: true, code: "OK", message: RS_LIFECYCLE_MESSAGES.CANCEL_SUCCESS };
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ sheetId: number; actorUserId?: number | null; reason?: string | null }} input
 */
async function cancelLockedRequirementSheet(tx, input) {
  const sheetId = Number(input.sheetId);
  const evaluation = await evaluateRequirementSheetCancellation(tx, sheetId);
  if (!evaluation.allowed) {
    throw new RequirementSheetLifecycleError(evaluation.code, evaluation.message, 409, evaluation.details ?? null);
  }

  const now = new Date();
  const reason =
    input.reason != null && String(input.reason).trim() ? String(input.reason).trim().slice(0, 8000) : null;

  const updated = await tx.requirementSheet.update({
    where: { id: sheetId },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      cancelledByUserId: input.actorUserId ?? null,
      cancellationReason: reason,
    },
    include: {
      salesOrder: { select: { id: true, docNo: true } },
      cycle: { select: { id: true, cycleNo: true } },
    },
  });

  return { sheet: updated, evaluation };
}

module.exports = {
  RS_LIFECYCLE_MESSAGES,
  RequirementSheetLifecycleError,
  assertNoLockedOrCancelledSheetForCyclePeriod,
  evaluateRequirementSheetCancellation,
  cancelLockedRequirementSheet,
  resolveCycleNoLabel,
  cycleLockedCreateMessage,
  _test: {
    findBlockingMonthlyPlan,
    findBlockingRmPoDocNo,
    hasGrnForMonthlyPlanPeriod,
  },
};
