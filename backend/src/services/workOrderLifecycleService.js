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

  const lineIds = wo.lines.map((l) => l.id);
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(tx, lineIds);
  let anyProgress = false;
  let allComplete = true;
  for (const line of wo.lines) {
    const required = n(line.qty);
    const produced = producedByLineId.get(line.id) ?? 0;
    if (produced > EPS) anyProgress = true;
    if (produced + EPS < required) allComplete = false;
  }
  const nextStatus = allComplete ? "COMPLETED" : anyProgress ? "IN_PROGRESS" : "PENDING";

  const updated = await tx.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: nextStatus,
      holdReason: null,
      heldAt: null,
      heldByUserId: null,
      holdRemarks: null,
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
      summary: `Work order ${updated.docNo || workOrderId} resumed (${nextStatus})`,
      payload: { module: "WORK_ORDER_LIFECYCLE", actionLabel: "RESUME", status: nextStatus },
    });
  }

  return updated;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function closeWorkOrderWithShortfall(tx, workOrderId, { closureReason, actorUserId, actorRole }) {
  const { wo } = await assertRegularWorkOrderLifecycleScope(tx, workOrderId);
  if (wo.status === "CLOSED_WITH_SHORTFALL") {
    const err = new Error("Work order is already closed with shortfall.");
    err.statusCode = 409;
    throw err;
  }
  if (wo.status === "COMPLETED") {
    const err = new Error(
      "Work order is already fully produced. Use hold if you need to pause; shortfall close applies to incomplete balance.",
    );
    err.statusCode = 409;
    throw err;
  }
  if (wo.status === "REJECTED") {
    const err = new Error("Rejected work orders cannot be closed with shortfall.");
    err.statusCode = 409;
    throw err;
  }

  const reason = String(closureReason || "").trim();
  if (reason.length < 3) {
    const err = new Error("Enter a closure reason (at least 3 characters).");
    err.statusCode = 400;
    throw err;
  }

  const lineIds = wo.lines.map((l) => l.id);
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(tx, lineIds);

  let totalShortfall = 0;
  const lineUpdates = [];
  for (const line of wo.lines) {
    const required = n(line.qty);
    const produced = producedByLineId.get(line.id) ?? 0;
    const lineShortfall = round3(Math.max(0, required - produced));
    if (lineShortfall > EPS) {
      lineUpdates.push({ id: line.id, shortfallQty: lineShortfall });
      totalShortfall = round3(totalShortfall + lineShortfall);
    }
  }

  if (totalShortfall <= EPS) {
    const err = new Error(
      "No remaining balance to close. All planned quantity is already produced, or increase production before shortfall close.",
    );
    err.statusCode = 409;
    throw err;
  }

  for (const u of lineUpdates) {
    await tx.workOrderLine.update({
      where: { id: u.id },
      data: { shortfallQty: String(u.shortfallQty) },
    });
  }

  const updated = await tx.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: "CLOSED_WITH_SHORTFALL",
      shortfallQty: String(totalShortfall),
      closureReason: reason,
      closedAt: new Date(),
      closedByUserId: actorUserId ?? null,
      holdReason: null,
      heldAt: null,
      heldByUserId: null,
      holdRemarks: null,
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
      summary: `Work order ${updated.docNo || workOrderId} closed with shortfall ${totalShortfall}`,
      payload: {
        module: "WORK_ORDER_LIFECYCLE",
        actionLabel: "CLOSED_WITH_SHORTFALL",
        shortfallQty: totalShortfall,
      },
      reason,
    });
  }

  return { workOrder: updated, shortfallQty: totalShortfall, lineShortfalls: lineUpdates };
}

module.exports = {
  HOLD_REASONS,
  WO_PRODUCTION_BLOCKED,
  WO_STATUS_SYNC_FROZEN,
  WO_TERMINAL,
  isRegularWorkOrderRecord,
  effectiveLinePlanQty,
  assertWorkOrderAllowsProduction,
  shouldFreezeStatusSync,
  holdWorkOrder,
  resumeWorkOrder,
  closeWorkOrderWithShortfall,
  loadWorkOrderLifecycleContext,
};
