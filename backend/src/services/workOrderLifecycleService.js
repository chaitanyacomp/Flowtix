/**
 * REGULAR work order lifecycle — HOLD, resume, close with shortfall.
 * NO_QTY work orders are rejected (cycleId set).
 */

const { prisma } = require("../utils/prisma");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { assertRegularProductionRmReadiness } = require("./productionRmReadinessService");
const auditLog = require("./auditLog");

const EPS = 1e-6;

const HOLD_REASONS = [
  "RM_SHORTAGE",
  "MACHINE_BREAKDOWN",
  "PRIORITY_SHIFT",
  "CUSTOMER_HOLD",
  "MANAGEMENT_HOLD",
  "PRODUCTION_PAUSE",
  "OTHER",
];

const WO_PRODUCTION_BLOCKED = new Set([
  "HOLD",
  "PAUSED",
  "CLOSED_WITH_SHORTFALL",
  "COMPLETED",
  "REJECTED",
]);

const WO_STATUS_SYNC_FROZEN = new Set(["HOLD", "PAUSED", "CLOSED_WITH_SHORTFALL", "REJECTED"]);

const WO_TERMINAL = new Set(["CLOSED_WITH_SHORTFALL", "COMPLETED", "REJECTED"]);

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function isRegularWorkOrderRecord(wo, so) {
  if (!so || so.orderType === "NO_QTY") return false;
  if (wo.requirementSheetId != null) return false;
  return true;
}

/**
 * Effective line qty counting against SO planning (shortfall-closed WOs release remainder).
 */
function effectiveLinePlanQty(line, woStatus) {
  const qty = n(line.qty);
  if (woStatus === "CLOSED_WITH_SHORTFALL") {
    const sf = line.shortfallQty != null ? n(line.shortfallQty) : n(line.workOrder?.shortfallQty);
    return round3(Math.max(0, qty - sf));
  }
  return round3(qty);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function loadWorkOrderLifecycleContext(db, workOrderId) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      lines: { include: { fgItem: { select: { id: true, itemName: true } } } },
      salesOrder: { select: { id: true, docNo: true, orderType: true } },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  return { wo, so: wo.salesOrder };
}

/**
 * REGULAR lifecycle only.
 */
async function assertRegularWorkOrderLifecycleScope(db, workOrderId) {
  const ctx = await loadWorkOrderLifecycleContext(db, workOrderId);
  if (!isRegularWorkOrderRecord(ctx.wo, ctx.so)) {
    const err = new Error(
      "Work order hold and shortfall close apply to REGULAR sales orders only. NO_QTY orders use cycle planning.",
    );
    err.statusCode = 409;
    err.code = "WO_LIFECYCLE_REGULAR_ONLY";
    throw err;
  }
  return ctx;
}

function productionBlockedMessage(status, holdReason) {
  if (status === "PAUSED") {
    return "Work order is paused. Accepted FG stock is kept in store. Resume production to continue.";
  }
  if (status === "HOLD") {
    const reasonLabel = holdReason ? String(holdReason).replace(/_/g, " ") : "on hold";
    return `Work order is on hold (${reasonLabel}). Resume the work order before recording production.`;
  }
  if (status === "CLOSED_WITH_SHORTFALL") {
    return "Work order is closed with shortfall. No further production is allowed.";
  }
  if (status === "COMPLETED") {
    return "Work order is completed. No further production is allowed.";
  }
  if (status === "REJECTED") {
    return "Work order is rejected.";
  }
  return "Production is not allowed for this work order status.";
}

/**
 * Call for REGULAR production create/approve paths (after NO_QTY guard).
 */
async function assertWorkOrderAllowsProduction(tx, workOrderId) {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      status: true,
      holdReason: true,
      cycleId: true,
      requirementSheetId: true,
      salesOrder: { select: { orderType: true } },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (!isRegularWorkOrderRecord(wo, wo.salesOrder)) return;
  if (WO_PRODUCTION_BLOCKED.has(wo.status)) {
    const err = new Error(productionBlockedMessage(wo.status, wo.holdReason));
    err.statusCode = 409;
    err.code = "WO_PRODUCTION_BLOCKED";
    throw err;
  }
}

function shouldFreezeStatusSync(status) {
  return WO_STATUS_SYNC_FROZEN.has(status);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function holdWorkOrder(tx, workOrderId, { holdReason, remarks, actorUserId, actorRole }) {
  const { wo } = await assertRegularWorkOrderLifecycleScope(tx, workOrderId);
  if (WO_TERMINAL.has(wo.status)) {
    const err = new Error(`Cannot hold a work order in status ${wo.status}.`);
    err.statusCode = 409;
    throw err;
  }
  if (wo.status === "HOLD" || wo.status === "PAUSED") {
    const err = new Error(
      wo.status === "PAUSED" ? "Work order is already paused." : "Work order is already on hold.",
    );
    err.statusCode = 409;
    throw err;
  }
  if (!HOLD_REASONS.includes(holdReason)) {
    const err = new Error("Invalid hold reason.");
    err.statusCode = 400;
    throw err;
  }

  const nextStatus = holdReason === "PRODUCTION_PAUSE" ? "PAUSED" : "HOLD";
  const actionLabel = nextStatus === "PAUSED" ? "PAUSE" : "HOLD";

  const updated = await tx.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: nextStatus,
      holdReason,
      heldAt: new Date(),
      heldByUserId: actorUserId ?? null,
      holdRemarks: remarks?.trim() || null,
    },
    include: { lines: { include: { fgItem: true } }, salesOrder: true },
  });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `WORK_ORDER:${workOrderId}`,
      actorUserId,
      actorRole,
      summary: `Work order ${updated.docNo || workOrderId} ${nextStatus === "PAUSED" ? "paused" : "placed on hold"} (${holdReason})`,
      payload: { module: "WORK_ORDER_LIFECYCLE", actionLabel, holdReason, status: nextStatus },
    });
  }

  return updated;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function resumeWorkOrder(tx, workOrderId, { actorUserId, actorRole }) {
  const { wo } = await assertRegularWorkOrderLifecycleScope(tx, workOrderId);
  if (wo.status !== "HOLD" && wo.status !== "PAUSED") {
    const err = new Error("Only paused or on-hold work orders can be resumed.");
    err.statusCode = 409;
    throw err;
  }

  await tx.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: "PENDING",
      holdReason: null,
      heldAt: null,
      heldByUserId: null,
      holdRemarks: null,
    },
  });

  const { reconcileWorkOrderStatusFromProduction } = require("./workOrderCompletionService");
  await reconcileWorkOrderStatusFromProduction(tx, workOrderId, {
    actorUserId,
    actorRole,
    source: "RESUME",
  });

  const updated = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    include: { lines: { include: { fgItem: true } }, salesOrder: true },
  });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `WORK_ORDER:${workOrderId}`,
      actorUserId,
      actorRole,
      summary: `Work order ${updated?.docNo || workOrderId} resumed (${updated?.status ?? "PENDING"})`,
      payload: {
        module: "WORK_ORDER_LIFECYCLE",
        actionLabel: "RESUME",
        status: updated?.status ?? "PENDING",
      },
    });
  }

  return updated;
}

async function assertProductionReportConfirmedForWorkOrder(tx, workOrderId) {
  const { assertProductionReportConfirmedForCompletion } = require("./productionWorkOrderReportService");
  return assertProductionReportConfirmedForCompletion(tx, workOrderId);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function closeWorkOrderWithShortfall(tx, workOrderId, { closureReason, actorUserId, actorRole }) {
  await assertRegularWorkOrderLifecycleScope(tx, workOrderId);
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { status: true },
  });
  if (wo?.status === "REJECTED") {
    const err = new Error("Rejected work orders cannot be closed with shortfall.");
    err.statusCode = 409;
    throw err;
  }

  const { completeWorkOrder, COMPLETION_TYPES } = require("./workOrderCompletionService");
  const result = await completeWorkOrder(tx, workOrderId, {
    completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
    closureReason,
    actorUserId,
    actorRole,
    source: "SHORTFALL_CLOSE",
  });

  return {
    workOrder: result.workOrder,
    shortfallQty: result.shortfallQty,
    lineShortfalls: result.lineShortfalls,
  };
}

const { GREEN_LEVEL_WO_SOURCE_TYPE } = require("./greenLevelWorkOrderService");
const { EPS: WO_SO_EPS } = require("./workOrderSoValidation");

const PRODUCTION_ENTRY_WO_TOLERANCE_PCT = 0.05;

function allowsWorkOrderProductionOverPlan(wo, orderType) {
  return orderType === "NO_QTY" || String(wo?.sourceType ?? "").toUpperCase() === GREEN_LEVEL_WO_SOURCE_TYPE;
}

/**
 * REGULAR WO line plan cap (+5% tolerance). Skipped for NO_QTY and Green Level over-plan flows.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
async function assertProductionEntryWoQtyTolerance(
  tx,
  {
    workOrderLineId,
    producedQty,
    excludeProductionId,
    lineQty,
    workOrder,
    orderType,
    messageBuilder,
  },
) {
  const allowOverproduction = allowsWorkOrderProductionOverPlan(workOrder, orderType);
  if (allowOverproduction) return;

  const where = { workOrderLineId };
  if (excludeProductionId != null) where.id = { not: excludeProductionId };
  const agg = await tx.productionEntry.aggregate({
    where,
    _sum: { producedQty: true },
  });
  const alreadyProduced = Number(agg._sum.producedQty ?? 0);
  const totalProducedQty = alreadyProduced + Number(producedQty);
  const allowedMaxQty = Number(lineQty) * (1 + PRODUCTION_ENTRY_WO_TOLERANCE_PCT);
  if (totalProducedQty > allowedMaxQty + WO_SO_EPS) {
    const err = new Error(
      messageBuilder({
        lineQty: Number(lineQty),
        allowedMaxQty,
        totalProducedQty,
        alreadyProduced,
      }),
    );
    err.statusCode = 409;
    err.code = "PRODUCTION_EXCEEDS_WO";
    throw err;
  }
}

module.exports = {
  HOLD_REASONS,
  WO_PRODUCTION_BLOCKED,
  WO_STATUS_SYNC_FROZEN,
  WO_TERMINAL,
  PRODUCTION_ENTRY_WO_TOLERANCE_PCT,
  allowsWorkOrderProductionOverPlan,
  isRegularWorkOrderRecord,
  effectiveLinePlanQty,
  assertWorkOrderAllowsProduction,
  assertProductionEntryWoQtyTolerance,
  shouldFreezeStatusSync,
  holdWorkOrder,
  resumeWorkOrder,
  closeWorkOrderWithShortfall,
  loadWorkOrderLifecycleContext,
};
