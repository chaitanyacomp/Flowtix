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
  if (op.workOrderStatus === "REJECTED") {
    return "Work order is rejected.";
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
 * Throws when shop-floor execution status blocks production entry.
 * No-op for REGULAR work orders (use assertWorkOrderAllowsProduction).
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
  assertShopFloorExecutionAllowsProduction,
  operationalProductionBlockMessage,
  REGULAR_PRODUCTION_BLOCKED,
  REGULAR_TERMINAL,
};
