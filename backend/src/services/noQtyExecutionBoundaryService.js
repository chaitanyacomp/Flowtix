/**
 * P8F — NO_QTY execution visibility boundary.
 *
 * Period release remains required for shortage-driven FG items (procurement path).
 * Stock-ready FG items (READY_FOR_WO / partial executable from free usable RM) may
 * create and execute Work Orders without waiting for Monthly Plan release — FG-level gate.
 */

const { normalizePositiveCycleId } = require("../utils/cycleIds");
const { GREEN_LEVEL_WO_SOURCE_TYPE } = require("./greenLevelWorkOrderService");

const EPS = 1e-6;

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
 * Existing Work Orders are execution-visible once created.
 * Create-time gate enforces FG-level stock readiness vs period release; do not
 * hide stock-ready WOs that were legitimately created before period release.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} db
 * @param {Array<{ id: number, salesOrder?: { orderType?: string } | null, salesOrderId?: number, cycleId?: number | null, requirementSheetId?: number | null }>} workOrders
 */
async function filterNoQtyExecutionReleasedWorkOrders(db, workOrders) {
  const list = workOrders || [];
  if (!list.length) return [];
  // Preserve REGULAR / non-NO_QTY rows and all NO_QTY WOs that already exist.
  // Period-release filtering previously blocked stock-ready FG WOs created
  // before Monthly Plan release (incorrect whole-RS gate).
  void db;
  return list;
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

  // Create-time FG-level gate is authoritative. Once a WO exists (including
  // stock-ready FG before period release), Material Issue / QC / production may proceed.
  void messagePrefix;
  return wo;
}

/**
 * NO_QTY production entry: locked RS on WO cycle + allowed execution context.
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
 * Allow WO create when period is released, OR when every requested (or fully suggested)
 * FG line is covered by authoritative placement executable qty from free stock
 * (FG-level READY_FOR_WO / PARTIALLY_READY). Shortage FG remain blocked until release
 * (or until stock becomes available).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} db
 * @param {{ id?: number, periodKey?: string | null, salesOrder?: { orderType?: string } | null, lines?: Array<any> }} sheet
 * @param {{ requestedLines?: Array<{ itemId?: number, fgItemId?: number, qty?: number }>, deps?: object }} [options]
 */
async function assertNoQtyRequirementSheetPeriodReleased(db, sheet, options = {}) {
  if (!isNoQtyOrderType(sheet.salesOrder?.orderType)) return;
  const pk = String(sheet.periodKey ?? "").trim();
  if (pk && (await isPeriodReleasedForExecution(db, pk))) return;

  const { assessNoQtyBatchPlacement } = require("./noQtyBatchPlacementEngine");
  const assessPlacement = options.deps?.assessNoQtyBatchPlacement || assessNoQtyBatchPlacement;

  const linkedWorkOrders =
    sheet.id != null && typeof db.workOrder?.findMany === "function"
      ? await db.workOrder.findMany({
          where: { requirementSheetId: sheet.id },
          select: {
            id: true,
            status: true,
            lines: { select: { fgItemId: true, qty: true, plannedQty: true } },
          },
        })
      : [];

  const placedByItem = new Map();
  for (const wo of linkedWorkOrders) {
    if (String(wo.status ?? "").toUpperCase() === "CANCELLED") continue;
    for (const ln of wo.lines ?? []) {
      const fgItemId = Number(ln.fgItemId);
      if (!(fgItemId > 0)) continue;
      const qty = Number(ln.plannedQty ?? ln.qty ?? 0);
      placedByItem.set(fgItemId, (placedByItem.get(fgItemId) ?? 0) + (Number.isFinite(qty) ? qty : 0));
    }
  }

  const assessment = await assessPlacement(db, sheet, { placedByItem, ...(options.deps || {}) });
  const balanceLines = (assessment.balanceLines ?? assessment.placement?.lines ?? []).filter(
    (line) => Number(line.rsBalanceQty ?? 0) > EPS,
  );
  const placementByItem = new Map(
    (assessment.placement?.lines ?? balanceLines).map((line) => [Number(line.itemId), line]),
  );

  let requested = Array.isArray(options.requestedLines) ? options.requestedLines : null;
  if (!requested || !requested.length) {
    requested = [...placementByItem.values()]
      .filter((line) => Number(line.suggestedExecutableQty ?? line.executableQty ?? 0) > EPS)
      .map((line) => ({
        itemId: line.itemId,
        qty: Number(line.suggestedExecutableQty ?? line.executableQty ?? 0),
      }));
  }

  const positive = (requested || []).filter((ln) => Number(ln.qty) > EPS);
  if (!positive.length) {
    const err = new Error(
      pk
        ? `Work orders for this requirement sheet cannot be created until RM is available for at least one FG item, or the Monthly Production Plan for ${pk} is released to procurement.`
        : "Work orders for this requirement sheet cannot be created until RM is available for at least one FG item, or Monthly Planning is released.",
    );
    err.statusCode = 409;
    err.code = "NO_QTY_EXECUTION_NOT_RELEASED";
    throw err;
  }

  const blocked = [];
  for (const req of positive) {
    const itemId = Number(req.itemId ?? req.fgItemId);
    const qty = Number(req.qty);
    const line = placementByItem.get(itemId);
    const executable = Number(line?.suggestedExecutableQty ?? line?.executableQty ?? 0);
    if (!line || !(executable > EPS) || qty > executable + EPS) {
      blocked.push({
        itemId,
        itemName: line?.itemName ?? `Item ${itemId}`,
        requestedQty: qty,
        executableQty: executable,
      });
    }
  }

  if (blocked.length) {
    const names = blocked.map((b) => b.itemName).join(", ");
    const err = new Error(
      `Work Order creation is blocked for FG item(s) with unresolved RM shortage (${names}). RM-ready items may still place WO. Shortage items require Monthly Plan release or additional usable RM.`,
    );
    err.statusCode = 409;
    err.code = "NO_QTY_FG_PROCUREMENT_REQUIRED";
    err.details = { blockedFgItems: blocked, periodKey: pk || null };
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
