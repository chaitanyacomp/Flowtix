/**
 * P8F — NO_QTY execution visibility boundary.
 * Planning ends at Monthly Plan Release; execution (WO/PMR/RM CC/Issue) starts at Release.
 */

const { normalizePositiveCycleId } = require("../utils/cycleIds");
const { GREEN_LEVEL_WO_SOURCE_TYPE } = require("./greenLevelWorkOrderService");

const NO_QTY_EXECUTION_NOT_RELEASED_MESSAGE =
  "Monthly Production Plan must be released to procurement before NO_QTY execution can proceed for this cycle.";

function isNoQtyOrderType(orderType) {
  return String(orderType ?? "").trim() === "NO_QTY";
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} db
 * @param {string[]} periodKeys
 * @returns {Promise<Set<string>>}
 */
async function loadReleasedPeriodKeySet(db, periodKeys) {
  const keys = [...new Set((periodKeys || []).map((k) => String(k ?? "").trim()).filter(Boolean))];
  if (!keys.length) return new Set();
  const rows = await db.monthlyProductionPlan.findMany({
    where: { periodKey: { in: keys }, releasedAt: { not: null } },
    select: { periodKey: true },
  });
  return new Set(rows.map((r) => r.periodKey));
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} db
 * @param {string} periodKey
 */
async function isPeriodReleasedForExecution(db, periodKey) {
  const pk = String(periodKey ?? "").trim();
  if (!pk) return false;
  const plan = await db.monthlyProductionPlan.findFirst({
    where: { periodKey: pk, releasedAt: { not: null } },
    select: { id: true },
  });
  return Boolean(plan);
}

/**
 * Batch-resolve periodKey for work orders (requirementSheetId or locked RS on cycle).
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} db
 * @param {Array<{ id: number, salesOrderId?: number, cycleId?: number | null, requirementSheetId?: number | null }>} workOrders
 * @returns {Promise<Map<number, string|null>>}
 */
async function resolvePeriodKeysByWorkOrderId(db, workOrders) {
  const out = new Map();
  const list = workOrders || [];
  if (!list.length) return out;

  const rsIds = [...new Set(list.map((wo) => wo.requirementSheetId).filter(Boolean))];
  const rsById = new Map();
  if (rsIds.length) {
    const rsRows = await db.requirementSheet.findMany({
      where: { id: { in: rsIds } },
      select: { id: true, periodKey: true },
    });
    for (const rs of rsRows) rsById.set(rs.id, rs.periodKey);
  }

  const needCycleLookup = [];
  for (const wo of list) {
    if (wo.requirementSheetId && rsById.has(wo.requirementSheetId)) {
      out.set(wo.id, rsById.get(wo.requirementSheetId) ?? null);
    } else if (wo.salesOrderId && wo.cycleId) {
      needCycleLookup.push({ woId: wo.id, salesOrderId: wo.salesOrderId, cycleId: wo.cycleId });
    } else {
      out.set(wo.id, null);
    }
  }

  if (needCycleLookup.length) {
    const cycleRows = await db.requirementSheet.findMany({
      where: {
        status: "LOCKED",
        OR: needCycleLookup.map((x) => ({ salesOrderId: x.salesOrderId, cycleId: x.cycleId })),
      },
      select: { salesOrderId: true, cycleId: true, periodKey: true, version: true },
      orderBy: { version: "desc" },
    });
    const periodBySoCycle = new Map();
    for (const rs of cycleRows) {
      const k = `${rs.salesOrderId}:${rs.cycleId}`;
      if (!periodBySoCycle.has(k)) periodBySoCycle.set(k, rs.periodKey);
    }
    for (const x of needCycleLookup) {
      out.set(x.woId, periodBySoCycle.get(`${x.salesOrderId}:${x.cycleId}`) ?? null);
    }
  }

  return out;
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} db
 * @param {Array<{ id: number, salesOrder?: { orderType?: string } | null, salesOrderId?: number, cycleId?: number | null, requirementSheetId?: number | null }>} workOrders
 */
async function filterNoQtyExecutionReleasedWorkOrders(db, workOrders) {
  const list = workOrders || [];
  if (!list.length) return [];

  const noQty = list.filter((wo) => isNoQtyOrderType(wo.salesOrder?.orderType));
  if (!noQty.length) return list;

  const periodByWoId = await resolvePeriodKeysByWorkOrderId(db, list);
  const released = await loadReleasedPeriodKeySet(db, [...periodByWoId.values()].filter(Boolean));

  return list.filter((wo) => {
    if (!isNoQtyOrderType(wo.salesOrder?.orderType)) return true;
    const pk = periodByWoId.get(wo.id);
    return Boolean(pk && released.has(pk));
  });
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} db
 * @param {number} workOrderId
 * @param {string} [messagePrefix]
 */
async function assertNoQtyWorkOrderExecutionReleased(db, workOrderId, messagePrefix = "This work order") {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      salesOrderId: true,
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
  if (!isNoQtyOrderType(wo.salesOrder?.orderType)) return wo;

  const periodByWoId = await resolvePeriodKeysByWorkOrderId(db, [wo]);
  const pk = periodByWoId.get(wo.id);
  if (!pk || !(await isPeriodReleasedForExecution(db, pk))) {
    const err = new Error(`${messagePrefix}: ${NO_QTY_EXECUTION_NOT_RELEASED_MESSAGE}`);
    err.statusCode = 409;
    err.code = "NO_QTY_EXECUTION_NOT_RELEASED";
    throw err;
  }
  return wo;
}

/**
 * NO_QTY production entry: locked RS on WO cycle + monthly plan release for execution.
 * Does not check SO closed or WO operational status (gate steps 2–3).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} db
 * @param {number} workOrderId
 * @param {string} [messagePrefix]
 */
async function assertNoQtyWorkOrderProductionCycleContext(db, workOrderId, messagePrefix = "Production") {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      salesOrderId: true,
      cycleId: true,
      sourceType: true,
      requirementSheetId: true,
      salesOrder: { select: { orderType: true } },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (wo.sourceType === GREEN_LEVEL_WO_SOURCE_TYPE || wo.salesOrderId == null) return wo;
  if (!isNoQtyOrderType(wo.salesOrder?.orderType)) return wo;

  const woCycleId = normalizePositiveCycleId(wo.cycleId);
  if (!woCycleId) {
    const err = new Error(
      "This work order is not linked to a requirement-sheet cycle. Production cannot be recorded.",
    );
    err.statusCode = 409;
    err.code = "NO_QTY_WO_CYCLE_REQUIRED";
    throw err;
  }

  const lockedOnWoCycle = await db.requirementSheet.findFirst({
    where: { salesOrderId: wo.salesOrderId, cycleId: woCycleId, status: "LOCKED" },
    select: { id: true },
  });
  if (!lockedOnWoCycle) {
    const err = new Error("Requirement Sheet must be locked before production.");
    err.statusCode = 409;
    err.code = "NO_QTY_RS_LOCK_REQUIRED";
    throw err;
  }

  await assertNoQtyWorkOrderExecutionReleased(db, workOrderId, messagePrefix);
  return wo;
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} db
 * @param {{ periodKey?: string | null, salesOrder?: { orderType?: string } | null }} sheet
 */
async function assertNoQtyRequirementSheetPeriodReleased(db, sheet) {
  if (!isNoQtyOrderType(sheet.salesOrder?.orderType)) return;
  const pk = String(sheet.periodKey ?? "").trim();
  if (!pk || !(await isPeriodReleasedForExecution(db, pk))) {
    const err = new Error(
      `Work orders for this requirement sheet cannot be created until the Monthly Production Plan for ${pk} is released to procurement.`,
    );
    err.statusCode = 409;
    err.code = "NO_QTY_EXECUTION_NOT_RELEASED";
    throw err;
  }
}

module.exports = {
  NO_QTY_EXECUTION_NOT_RELEASED_MESSAGE,
  isNoQtyOrderType,
  loadReleasedPeriodKeySet,
  isPeriodReleasedForExecution,
  resolvePeriodKeysByWorkOrderId,
  filterNoQtyExecutionReleasedWorkOrders,
  assertNoQtyWorkOrderExecutionReleased,
  assertNoQtyWorkOrderProductionCycleContext,
  assertNoQtyRequirementSheetPeriodReleased,
};
