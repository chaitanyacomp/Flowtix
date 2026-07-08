/**
 * Work order completion lifecycle — sole authority for WorkOrder.status terminal transitions:
 * COMPLETED and CLOSED_WITH_SHORTFALL.
 *
 * Production execution closure (NO_QTY / Green Level) lives in productionExecutionService.
 * This service mirrors document status after production evidence is satisfied.
 */

const { GREEN_LEVEL_WO_SOURCE_TYPE } = require("./greenLevelWorkOrderService");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const auditLog = require("./auditLog");

const WO_SO_EPS = 1e-6;

const WO_STATUS_SYNC_FROZEN = new Set(["HOLD", "PAUSED", "CLOSED_WITH_SHORTFALL", "REJECTED"]);

const COMPLETION_TYPES = Object.freeze({
  NONE: "NONE",
  COMPLETED: "COMPLETED",
  CLOSED_WITH_SHORTFALL: "CLOSED_WITH_SHORTFALL",
});

const MISSING_CONDITIONS = Object.freeze({
  WORK_ORDER_NOT_FOUND: "WORK_ORDER_NOT_FOUND",
  WORK_ORDER_REJECTED: "WORK_ORDER_REJECTED",
  STATUS_SYNC_FROZEN: "STATUS_SYNC_FROZEN",
  ALREADY_COMPLETED: "ALREADY_COMPLETED",
  ALREADY_CLOSED_WITH_SHORTFALL: "ALREADY_CLOSED_WITH_SHORTFALL",
  PRODUCTION_REPORT_NOT_CONFIRMED: "PRODUCTION_REPORT_NOT_CONFIRMED",
  RM_RETURN_PENDING: "RM_RETURN_PENDING",
  PRODUCTION_INCOMPLETE: "PRODUCTION_INCOMPLETE",
  EXECUTION_NOT_COMPLETED: "EXECUTION_NOT_COMPLETED",
  NO_SHORTFALL_BALANCE: "NO_SHORTFALL_BALANCE",
  REGULAR_SCOPE_REQUIRED: "REGULAR_SCOPE_REQUIRED",
  CLOSURE_REASON_REQUIRED: "CLOSURE_REASON_REQUIRED",
});

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function isGreenLevelReplenishmentWorkOrder(wo) {
  return String(wo?.sourceType ?? "").toUpperCase() === GREEN_LEVEL_WO_SOURCE_TYPE;
}

function shouldFreezeStatusSync(status) {
  return WO_STATUS_SYNC_FROZEN.has(String(status ?? "").toUpperCase());
}

function isRegularWorkOrderRecord(wo, so) {
  if (!so || so.orderType === "NO_QTY") return false;
  if (wo.requirementSheetId != null) return false;
  return true;
}

function isShopFloorExecutionWorkOrder(wo, so) {
  return isGreenLevelReplenishmentWorkOrder(wo) || so?.orderType === "NO_QTY";
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function loadWorkOrderCompletionContext(tx, workOrderId) {
  return tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      docNo: true,
      status: true,
      sourceType: true,
      requirementSheetId: true,
      cycleId: true,
      shortfallQty: true,
      lines: { select: { id: true, qty: true, shortfallQty: true } },
      salesOrder: { select: { id: true, docNo: true, orderType: true } },
      productionExecution: { select: { executionStatus: true } },
    },
  });
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} workOrderId
 */
async function loadProductionCompletionEvidence(tx, workOrderId) {
  const report = await tx.productionWorkOrderReport.findUnique({
    where: { workOrderId },
    select: { id: true, status: true, remainingQty: true },
  });
  const hasConfirmedProductionReport = report?.status === "CONFIRMED";
  const openRmReturnPendingCount = hasConfirmedProductionReport
    ? await tx.productionRmReturnPending.count({ where: { workOrderId, status: "PENDING" } })
    : 0;
  return {
    report,
    hasConfirmedProductionReport,
    rmReturnsSettled: openRmReturnPendingCount === 0,
    openRmReturnPendingCount,
  };
}

/**
 * @param {object} input
 * @returns {{
 *   eligible: boolean;
 *   completionType: string;
 *   missingConditions: string[];
 *   reason: string | null;
 *   shortfallQty?: number;
 *   lineShortfalls?: Array<{ id: number; shortfallQty: number }>;
 * }}
 */
function buildEvaluation({
  eligible,
  completionType,
  missingConditions = [],
  reason = null,
  shortfallQty,
  lineShortfalls,
}) {
  return {
    eligible,
    completionType: eligible ? completionType : COMPLETION_TYPES.NONE,
    missingConditions,
    reason,
    ...(shortfallQty != null ? { shortfallQty } : {}),
    ...(lineShortfalls ? { lineShortfalls } : {}),
  };
}

/**
 * Evaluate whether a work order may transition to a terminal completion state.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} workOrderId
 * @param {{ intent?: 'AUTO' | 'SHORTFALL_CLOSE'; closureReason?: string | null }} [options]
 */
async function evaluateWorkOrderCompletion(tx, workOrderId, options = {}) {
  const intent = options.intent ?? "AUTO";
  const wo = await loadWorkOrderCompletionContext(tx, workOrderId);
  if (!wo) {
    return buildEvaluation({
      eligible: false,
      completionType: COMPLETION_TYPES.NONE,
      missingConditions: [MISSING_CONDITIONS.WORK_ORDER_NOT_FOUND],
      reason: "Work order not found.",
    });
  }

  if (wo.status === "REJECTED") {
    return buildEvaluation({
      eligible: false,
      completionType: COMPLETION_TYPES.NONE,
      missingConditions: [MISSING_CONDITIONS.WORK_ORDER_REJECTED],
      reason: "Rejected work orders cannot be completed.",
    });
  }

  if (wo.status === "COMPLETED") {
    return buildEvaluation({
      eligible: false,
      completionType: COMPLETION_TYPES.COMPLETED,
      missingConditions: [MISSING_CONDITIONS.ALREADY_COMPLETED],
      reason: "Work order is already completed.",
    });
  }

  if (wo.status === "CLOSED_WITH_SHORTFALL") {
    return buildEvaluation({
      eligible: false,
      completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
      missingConditions: [MISSING_CONDITIONS.ALREADY_CLOSED_WITH_SHORTFALL],
      reason: "Work order is already closed with shortfall.",
    });
  }

  if (intent === "SHORTFALL_CLOSE") {
    if (!isRegularWorkOrderRecord(wo, wo.salesOrder)) {
      return buildEvaluation({
        eligible: false,
        completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
        missingConditions: [MISSING_CONDITIONS.REGULAR_SCOPE_REQUIRED],
        reason: "Shortfall close applies to REGULAR work orders only.",
      });
    }
    const reason = String(options.closureReason ?? "").trim();
    if (reason.length < 3) {
      return buildEvaluation({
        eligible: false,
        completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
        missingConditions: [MISSING_CONDITIONS.CLOSURE_REASON_REQUIRED],
        reason: "Enter a closure reason (at least 3 characters).",
      });
    }
    const report = await tx.productionWorkOrderReport.findUnique({
      where: { workOrderId },
      select: { id: true, status: true },
    });
    if (!report || report.status !== "CONFIRMED") {
      return buildEvaluation({
        eligible: false,
        completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
        missingConditions: [MISSING_CONDITIONS.PRODUCTION_REPORT_NOT_CONFIRMED],
        reason: "Confirm Production Report before closing the work order.",
      });
    }

    const lineIds = wo.lines.map((l) => l.id);
    const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(tx, lineIds);
    let totalShortfall = 0;
    const lineShortfalls = [];
    for (const line of wo.lines) {
      const required = n(line.qty);
      const produced = producedByLineId.get(line.id) ?? 0;
      const lineShortfall = round3(Math.max(0, required - produced));
      if (lineShortfall > WO_SO_EPS) {
        lineShortfalls.push({ id: line.id, shortfallQty: lineShortfall });
        totalShortfall = round3(totalShortfall + lineShortfall);
      }
    }
    if (totalShortfall <= WO_SO_EPS) {
      return buildEvaluation({
        eligible: false,
        completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
        missingConditions: [MISSING_CONDITIONS.NO_SHORTFALL_BALANCE],
        reason:
          "No remaining balance to close. All planned quantity is already produced, or increase production before shortfall close.",
      });
    }
    return buildEvaluation({
      eligible: true,
      completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
      missingConditions: [],
      reason: null,
      shortfallQty: totalShortfall,
      lineShortfalls,
    });
  }

  if (shouldFreezeStatusSync(wo.status)) {
    return buildEvaluation({
      eligible: false,
      completionType: COMPLETION_TYPES.NONE,
      missingConditions: [MISSING_CONDITIONS.STATUS_SYNC_FROZEN],
      reason: `Work order status ${wo.status} is frozen for auto completion.`,
    });
  }

  const evidence = await loadProductionCompletionEvidence(tx, workOrderId);
  const missingConditions = [];

  if (!evidence.hasConfirmedProductionReport) {
    missingConditions.push(MISSING_CONDITIONS.PRODUCTION_REPORT_NOT_CONFIRMED);
  }
  if (!evidence.rmReturnsSettled) {
    missingConditions.push(MISSING_CONDITIONS.RM_RETURN_PENDING);
  }

  const isShopFloor = isShopFloorExecutionWorkOrder(wo, wo.salesOrder);
  if (isShopFloor) {
    const executionCompleted = wo.productionExecution?.executionStatus === "COMPLETED";
    if (!executionCompleted) {
      missingConditions.push(MISSING_CONDITIONS.EXECUTION_NOT_COMPLETED);
    }
    if (missingConditions.length > 0) {
      return buildEvaluation({
        eligible: false,
        completionType: COMPLETION_TYPES.COMPLETED,
        missingConditions,
        reason: completionBlockReason(missingConditions),
      });
    }
    return buildEvaluation({
      eligible: true,
      completionType: COMPLETION_TYPES.COMPLETED,
      missingConditions: [],
      reason: null,
    });
  }

  const lineIds = wo.lines.map((l) => l.id);
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(tx, lineIds);
  let allComplete = true;
  for (const line of wo.lines) {
    const required = n(line.qty);
    const produced = producedByLineId.get(line.id) ?? 0;
    if (produced + WO_SO_EPS < required) allComplete = false;
  }
  if (!allComplete) {
    missingConditions.push(MISSING_CONDITIONS.PRODUCTION_INCOMPLETE);
  }
  if (missingConditions.length > 0) {
    return buildEvaluation({
      eligible: false,
      completionType: COMPLETION_TYPES.COMPLETED,
      missingConditions,
      reason: completionBlockReason(missingConditions),
    });
  }

  return buildEvaluation({
    eligible: true,
    completionType: COMPLETION_TYPES.COMPLETED,
    missingConditions: [],
    reason: null,
  });
}

function completionBlockReason(missingConditions) {
  if (missingConditions.includes(MISSING_CONDITIONS.PRODUCTION_REPORT_NOT_CONFIRMED)) {
    return "Confirm Production Report before completing the work order.";
  }
  if (missingConditions.includes(MISSING_CONDITIONS.RM_RETURN_PENDING)) {
    return "RM return pending — waiting for Store to receive returned material.";
  }
  if (missingConditions.includes(MISSING_CONDITIONS.EXECUTION_NOT_COMPLETED)) {
    return "Production execution must be completed before the work order document can close.";
  }
  if (missingConditions.includes(MISSING_CONDITIONS.PRODUCTION_INCOMPLETE)) {
    return "Approved production quantity has not reached the work order plan.";
  }
  return "Work order completion conditions are not satisfied.";
}

/**
 * Apply a terminal work order completion transition.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} workOrderId
 * @param {{
 *   completionType: string;
 *   closureReason?: string | null;
 *   actorUserId?: number | null;
 *   actorRole?: string | null;
 *   source?: string;
 *   evaluation?: Awaited<ReturnType<typeof evaluateWorkOrderCompletion>>;
 * }} input
 */
async function completeWorkOrder(tx, workOrderId, input) {
  const completionType = input.completionType;
  if (completionType === COMPLETION_TYPES.CLOSED_WITH_SHORTFALL) {
    const evaluation =
      input.evaluation ??
      (await evaluateWorkOrderCompletion(tx, workOrderId, {
        intent: "SHORTFALL_CLOSE",
        closureReason: input.closureReason,
      }));
    if (!evaluation.eligible || evaluation.completionType !== COMPLETION_TYPES.CLOSED_WITH_SHORTFALL) {
      const err = new Error(evaluation.reason ?? "Work order cannot be closed with shortfall.");
      err.statusCode =
        evaluation.missingConditions.includes(MISSING_CONDITIONS.CLOSURE_REASON_REQUIRED) ? 400 : 409;
      if (evaluation.missingConditions.includes(MISSING_CONDITIONS.PRODUCTION_REPORT_NOT_CONFIRMED)) {
        err.code = "PRODUCTION_REPORT_REQUIRED";
      }
      throw err;
    }

    for (const lineUpdate of evaluation.lineShortfalls ?? []) {
      await tx.workOrderLine.update({
        where: { id: lineUpdate.id },
        data: { shortfallQty: String(lineUpdate.shortfallQty) },
      });
    }

    const updated = await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        status: "CLOSED_WITH_SHORTFALL",
        shortfallQty: String(evaluation.shortfallQty ?? 0),
        closureReason: String(input.closureReason ?? "").trim(),
        closedAt: new Date(),
        closedByUserId: input.actorUserId ?? null,
        holdReason: null,
        heldAt: null,
        heldByUserId: null,
        holdRemarks: null,
      },
      include: { lines: { include: { fgItem: true } }, salesOrder: true },
    });

    if (typeof input.actorUserId === "number") {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `WORK_ORDER:${workOrderId}`,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        summary: `Work order ${updated.docNo || workOrderId} closed with shortfall ${evaluation.shortfallQty ?? 0}`,
        payload: {
          module: "WORK_ORDER_COMPLETION",
          actionLabel: "CLOSED_WITH_SHORTFALL",
          source: input.source ?? "LIFECYCLE",
          shortfallQty: evaluation.shortfallQty ?? 0,
        },
        reason: String(input.closureReason ?? "").trim(),
      });
    }

    return {
      workOrder: updated,
      completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
      shortfallQty: evaluation.shortfallQty ?? 0,
      lineShortfalls: evaluation.lineShortfalls ?? [],
    };
  }

  if (completionType !== COMPLETION_TYPES.COMPLETED) {
    const err = new Error("Unsupported work order completion type.");
    err.statusCode = 400;
    throw err;
  }

  const evaluation = input.evaluation ?? (await evaluateWorkOrderCompletion(tx, workOrderId));
  if (!evaluation.eligible || evaluation.completionType !== COMPLETION_TYPES.COMPLETED) {
    if (evaluation.missingConditions.includes(MISSING_CONDITIONS.ALREADY_COMPLETED)) {
      const wo = await loadWorkOrderCompletionContext(tx, workOrderId);
      return { workOrder: wo, completionType: COMPLETION_TYPES.COMPLETED, alreadyCompleted: true };
    }
    const err = new Error(evaluation.reason ?? "Work order completion conditions are not satisfied.");
    err.statusCode = 409;
    err.code = evaluation.missingConditions[0] ?? "WO_COMPLETION_BLOCKED";
    err.missingConditions = evaluation.missingConditions;
    throw err;
  }

  const woBefore = await loadWorkOrderCompletionContext(tx, workOrderId);
  const updated = await tx.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: "COMPLETED",
      holdReason: null,
      heldAt: null,
      heldByUserId: null,
      holdRemarks: null,
    },
    include: { lines: { include: { fgItem: true } }, salesOrder: true },
  });

  if (typeof input.actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.WORK_ORDER,
      entityId: String(workOrderId),
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      summary: `Work order ${updated.docNo || workOrderId} completed`,
      payload: {
        module: "WORK_ORDER_COMPLETION",
        actionLabel: "COMPLETED",
        source: input.source ?? "PRODUCTION",
        previousStatus: woBefore?.status ?? null,
      },
    });
  }

  return { workOrder: updated, completionType: COMPLETION_TYPES.COMPLETED, alreadyCompleted: false };
}

/**
 * Reconcile non-terminal WO status from production progress and attempt completion when eligible.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} workOrderId
 * @param {{ actorUserId?: number | null; actorRole?: string | null; source?: string }} [actor]
 */
async function reconcileWorkOrderStatusFromProduction(tx, workOrderId, actor = {}) {
  const wo = await loadWorkOrderCompletionContext(tx, workOrderId);
  if (!wo || wo.status === "REJECTED" || !wo.lines?.length) return { changed: false };
  if (shouldFreezeStatusSync(wo.status)) return { changed: false };
  if (wo.status === "COMPLETED" || wo.status === "CLOSED_WITH_SHORTFALL") return { changed: false };

  const evaluation = await evaluateWorkOrderCompletion(tx, workOrderId);
  if (evaluation.eligible && evaluation.completionType === COMPLETION_TYPES.COMPLETED) {
    const result = await completeWorkOrder(tx, workOrderId, {
      completionType: COMPLETION_TYPES.COMPLETED,
      evaluation,
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      source: actor.source ?? "PRODUCTION_RECONCILE",
    });
    return { changed: true, completion: result };
  }

  const isShopFloor = isShopFloorExecutionWorkOrder(wo, wo.salesOrder);
  if (isShopFloor) {
    return { changed: false, evaluation };
  }

  const lineIds = wo.lines.map((l) => l.id);
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(tx, lineIds);
  let anyProgress = false;
  for (const line of wo.lines) {
    const produced = producedByLineId.get(line.id) ?? 0;
    if (produced > WO_SO_EPS) anyProgress = true;
  }

  const nextStatus = anyProgress ? "IN_PROGRESS" : "PENDING";
  if (nextStatus === wo.status) return { changed: false, evaluation };

  await tx.workOrder.update({
    where: { id: workOrderId },
    data: { status: nextStatus },
  });
  return { changed: true, status: nextStatus, evaluation };
}

module.exports = {
  COMPLETION_TYPES,
  MISSING_CONDITIONS,
  evaluateWorkOrderCompletion,
  completeWorkOrder,
  reconcileWorkOrderStatusFromProduction,
};
