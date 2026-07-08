/**
 * Work order operational status — single read path for production pacing.
 *
 * REGULAR work orders: WorkOrder.status is authoritative.
 * NO_QTY / Green Level: WorkOrderProductionExecution.executionStatus is authoritative;
 * WorkOrder.status is a document mirror (COMPLETED after execution finishes) and must not
 * independently drive production pacing.
 */

const { GREEN_LEVEL_WO_SOURCE_TYPE } = require("./greenLevelWorkOrderService");

const REGULAR_PRODUCTION_BLOCKED = new Set([
  "HOLD",
  "PAUSED",
  "CLOSED_WITH_SHORTFALL",
  "COMPLETED",
  "REJECTED",
]);

/** Blocks production for every manufacturing flow (REGULAR, NO_QTY, Green Level). */
const UNIVERSAL_WO_PRODUCTION_BLOCKED = new Set([
  "HOLD",
  "PAUSED",
  "CLOSED_WITH_SHORTFALL",
  "COMPLETED",
  "REJECTED",
]);

const REGULAR_TERMINAL = new Set(["COMPLETED", "REJECTED", "CLOSED_WITH_SHORTFALL"]);

/**
 * @param {object | null | undefined} wo
 * @param {object | null | undefined} [so]
 */
function isShopFloorExecutionWorkOrder(wo, so) {
  if (String(wo?.sourceType ?? "").toUpperCase() === GREEN_LEVEL_WO_SOURCE_TYPE) return true;
  if (wo?.requirementSheetId != null || wo?.cycleId != null) return true;
  return so?.orderType === "NO_QTY";
}

function normalizeExecutionStatus(executionStatus) {
  const status = String(executionStatus ?? "NOT_STARTED").trim().toUpperCase();
  return status || "NOT_STARTED";
}

function normalizeWorkOrderStatus(status) {
  const normalized = String(status ?? "PENDING").trim().toUpperCase();
  return normalized || "PENDING";
}

/**
 * @param {object | null | undefined} wo — may include productionExecution
 * @param {object | null | undefined} [so]
 * @returns {{
 *   authority: "WORK_ORDER_STATUS" | "EXECUTION_STATUS";
 *   workOrderStatus: string;
 *   executionStatus: string | null;
 *   operationalKey: string;
 *   productionClosed: boolean;
 *   allowsProduction: boolean;
 * }}
 */
function resolveWorkOrderOperationalStatus(wo, so) {
  const workOrderStatus = normalizeWorkOrderStatus(wo?.status);

  if (UNIVERSAL_WO_PRODUCTION_BLOCKED.has(workOrderStatus)) {
    return {
      authority: isShopFloorExecutionWorkOrder(wo, so) ? "EXECUTION_STATUS" : "WORK_ORDER_STATUS",
      workOrderStatus,
      executionStatus: isShopFloorExecutionWorkOrder(wo, so)
        ? normalizeExecutionStatus(wo?.productionExecution?.executionStatus)
        : null,
      operationalKey: workOrderStatus,
      productionClosed: true,
      allowsProduction: false,
    };
  }

  if (!isShopFloorExecutionWorkOrder(wo, so)) {
    return {
      authority: "WORK_ORDER_STATUS",
      workOrderStatus,
      executionStatus: null,
      operationalKey: workOrderStatus,
      productionClosed: REGULAR_TERMINAL.has(workOrderStatus),
      allowsProduction: !REGULAR_PRODUCTION_BLOCKED.has(workOrderStatus),
    };
  }

  const executionStatus = normalizeExecutionStatus(wo?.productionExecution?.executionStatus);
  const rejected = workOrderStatus === "REJECTED";
  const productionClosed = rejected || executionStatus === "COMPLETED";
  const allowsProduction =
    !productionClosed && executionStatus !== "BLOCKED" && executionStatus !== "SHORTFALL_PENDING";

  return {
    authority: "EXECUTION_STATUS",
    workOrderStatus,
    executionStatus,
    operationalKey: executionStatus,
    productionClosed,
    allowsProduction,
  };
}

/**
 * @param {object | null | undefined} wo
 * @param {object | null | undefined} [so]
 */
function isWorkOrderProductionOperationallyClosed(wo, so) {
  return resolveWorkOrderOperationalStatus(wo, so).productionClosed;
}

/**
 * @param {object[]} rows
 * @param {{ includeClosed?: boolean }} [opts]
 */
function filterWorkOrdersByOperationalClosure(rows, { includeClosed = false } = {}) {
  return (rows ?? []).filter((wo) => {
    const closed = isWorkOrderProductionOperationallyClosed(wo, wo?.salesOrder);
    return includeClosed ? closed : !closed;
  });
}

function operationalProductionBlockMessage(op, wo) {
  if (op.workOrderStatus === "PAUSED") {
    return "Work order is paused. Accepted FG stock is kept in store. Resume production to continue.";
  }
  if (op.workOrderStatus === "HOLD") {
    const reasonLabel = wo?.holdReason ? String(wo.holdReason).replace(/_/g, " ") : "on hold";
    return `Work order is on hold (${reasonLabel}). Resume the work order before recording production.`;
  }
  if (op.workOrderStatus === "CLOSED_WITH_SHORTFALL") {
    return "Work order is closed with shortfall. No further production is allowed.";
  }
  if (op.workOrderStatus === "REJECTED") {
    return "Work order is rejected.";
  }
  if (op.workOrderStatus === "COMPLETED") {
    return "Work order is completed. No further production is allowed.";
  }
  if (op.executionStatus === "BLOCKED") {
    const reason = wo?.productionExecution?.blockReason;
    const label = reason
      ? String(reason).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
      : "blocked";
    return `Production is blocked (${label}). Resume production before recording new batches.`;
  }
  if (op.executionStatus === "SHORTFALL_PENDING") {
    return "Production shortfall decision is pending. Confirm Report & Close WO or Pause before recording more production.";
  }
  if (op.executionStatus === "COMPLETED") {
    return "Production execution is finished for this work order. No further production is allowed.";
  }
  return "Production is not allowed for this work order.";
}

/**
 * Unified WO open check for production entry (all manufacturing flows).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} workOrderId
 * @param {{ wo?: object, so?: object | null }} [preloaded]
 */
async function assertWorkOrderOperationallyOpenForProduction(tx, workOrderId, preloaded = {}) {
  const wo =
    preloaded.wo ??
    (await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true,
        status: true,
        holdReason: true,
        requirementSheetId: true,
        cycleId: true,
        sourceType: true,
        salesOrderId: true,
        salesOrder: { select: { orderType: true } },
        productionExecution: { select: { executionStatus: true, blockReason: true } },
      },
    }));
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }

  const so =
    preloaded.so ??
    (wo.salesOrderId != null
      ? await tx.salesOrder.findUnique({
          where: { id: wo.salesOrderId },
          select: { id: true, orderType: true },
        })
      : null);

  const op = resolveWorkOrderOperationalStatus(wo, so ?? wo.salesOrder);
  if (op.allowsProduction) return { wo, so, operational: op };

  const err = new Error(operationalProductionBlockMessage(op, wo));
  err.statusCode = 409;
  if (op.workOrderStatus === "HOLD" || op.workOrderStatus === "PAUSED") err.code = "WO_PRODUCTION_BLOCKED";
  else if (op.executionStatus === "BLOCKED") err.code = "WO_EXEC_BLOCKED";
  else if (op.executionStatus === "SHORTFALL_PENDING") err.code = "WO_EXEC_SHORTFALL_DECISION_REQUIRED";
  else if (op.executionStatus === "COMPLETED") err.code = "WO_EXEC_COMPLETED";
  else if (op.workOrderStatus === "REJECTED") err.code = "WO_TERMINAL";
  else err.code = "WO_PRODUCTION_BLOCKED";
  throw err;
}

/**
 * Throws when shop-floor execution status blocks production entry.
 * No-op for REGULAR work orders (use {@link assertWorkOrderOperationallyOpenForProduction}).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} workOrderId
 */
async function assertShopFloorExecutionAllowsProduction(tx, workOrderId) {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      status: true,
      requirementSheetId: true,
      cycleId: true,
      sourceType: true,
      salesOrder: { select: { orderType: true } },
      productionExecution: { select: { executionStatus: true, blockReason: true } },
    },
  });
  if (!wo || !isShopFloorExecutionWorkOrder(wo, wo.salesOrder)) return;

  const op = resolveWorkOrderOperationalStatus(wo, wo.salesOrder);
  if (op.allowsProduction) return;

  const err = new Error(operationalProductionBlockMessage(op, wo));
  err.statusCode = 409;
  if (op.executionStatus === "BLOCKED") err.code = "WO_EXEC_BLOCKED";
  else if (op.executionStatus === "SHORTFALL_PENDING") err.code = "WO_EXEC_SHORTFALL_DECISION_REQUIRED";
  else if (op.executionStatus === "COMPLETED") err.code = "WO_EXEC_COMPLETED";
  else if (op.workOrderStatus === "REJECTED") err.code = "WO_TERMINAL";
  else err.code = "WO_PRODUCTION_BLOCKED";
  throw err;
}

module.exports = {
  isShopFloorExecutionWorkOrder,
  resolveWorkOrderOperationalStatus,
  isWorkOrderProductionOperationallyClosed,
  filterWorkOrdersByOperationalClosure,
  assertWorkOrderOperationallyOpenForProduction,
  assertShopFloorExecutionAllowsProduction,
  operationalProductionBlockMessage,
  REGULAR_PRODUCTION_BLOCKED,
  REGULAR_TERMINAL,
  UNIVERSAL_WO_PRODUCTION_BLOCKED,
};
