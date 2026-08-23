/**
 * NO_QTY RS execution Work Order helpers.
 *
 * Monthly Plan Release creates procurement MR only. Store/manual WO placement
 * uses the remaining RS balance and can create multiple WOs per Requirement Sheet.
 *
 * Placement preview and create validation delegate to noQtyBatchPlacementEngine.
 */

const { allocateWorkOrderDocNo, WORK_ORDER_FLOW } = require("./docNoService");
const {
  assessNoQtyBatchPlacement,
  validateNoQtyPlacementRequest,
  loadFgItemUnitMap,
} = require("./noQtyBatchPlacementEngine");
const {
  getExistingProductionMaterialRequestForWorkOrder,
} = require("./productionMaterialRequestService");
const { roundFgQty } = require("./itemQtyPrecision");

const NO_QTY_WO_PLACED_COUNT_STATUSES = Object.freeze([
  "PENDING",
  "IN_PROGRESS",
  "HOLD",
  "PAUSED",
  "COMPLETED",
  "CLOSED_WITH_SHORTFALL",
]);
const EPS = 1e-6;

function n(v) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function isNoQtyWoPlacedStatusCounted(status) {
  return NO_QTY_WO_PLACED_COUNT_STATUSES.includes(String(status ?? ""));
}

function woLinePlacedQty(line) {
  return round3(n(line?.plannedQty ?? line?.qty));
}

function sumPlacedQtyByItem(workOrders) {
  const out = new Map();
  for (const wo of workOrders ?? []) {
    if (!isNoQtyWoPlacedStatusCounted(wo.status)) continue;
    for (const line of wo.lines ?? []) {
      const itemId = Number(line.fgItemId);
      if (!(itemId > 0)) continue;
      out.set(itemId, round3((out.get(itemId) ?? 0) + woLinePlacedQty(line)));
    }
  }
  return out;
}

function normalizeRequestedPlacementLines(requestedLines, balanceLines) {
  const hasExplicitRequest = Array.isArray(requestedLines);
  if (!hasExplicitRequest) {
    return (balanceLines ?? [])
      .map((line) => ({
        itemId: Number(line.itemId ?? line.fgItemId),
        fgItemId: Number(line.itemId ?? line.fgItemId),
        qty: round3(n(line.rsBalanceQty ?? line.qty)),
      }))
      .filter((line) => line.qty > 0);
  }

  const merged = new Map();
  const order = [];
  for (const raw of requestedLines ?? []) {
    const itemId = Number(raw?.itemId ?? raw?.fgItemId);
    const qty = round3(n(raw?.qty ?? raw?.plannedQty ?? raw?.requirementQty ?? raw?.plannedQtySnapshot));
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    if (!order.includes(itemId)) order.push(itemId);
    merged.set(itemId, round3((merged.get(itemId) ?? 0) + qty));
  }
  return order.map((itemId) => ({ itemId, fgItemId: itemId, qty: round3(merged.get(itemId) ?? 0) }));
}

/**
 * Authoritative placement preview — thin wrapper over the batch placement engine.
 */
async function buildNoQtyWoBatchPlacementPreview(tx, sheet, deps = {}) {
  const linkedWorkOrders = await tx.workOrder.findMany({
    where: { requirementSheetId: sheet.id },
    select: {
      id: true,
      cycleId: true,
      status: true,
      lines: { select: { fgItemId: true, qty: true, plannedQty: true } },
    },
  });
  const placedByItem = sumPlacedQtyByItem(linkedWorkOrders);
  const assessment = await assessNoQtyBatchPlacement(tx, sheet, { ...deps, placedByItem });
  return {
    ...assessment.placement,
    snapshot: assessment.snapshot,
  };
}

/**
 * Serialize WO placement for one Requirement Sheet.
 */
async function lockRequirementSheetForWoPlacement(tx, requirementSheetId) {
  const id = Number(requirementSheetId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error("Invalid requirement sheet id.");
    err.statusCode = 400;
    throw err;
  }
  if (typeof tx.$queryRaw !== "function") return;

  const rows = await tx.$queryRaw`SELECT id FROM RequirementSheet WHERE id = ${id} FOR UPDATE`;
  if (Array.isArray(rows) && rows.length === 0) {
    const err = new Error("Requirement sheet not found.");
    err.statusCode = 404;
    throw err;
  }
}

/**
 * Latest locked requirement sheet per SO+cycle for a planning period.
 */
async function findLatestLockedSheetsForPeriod(tx, periodKey) {
  const pk = String(periodKey ?? "").trim();
  if (!pk) return [];

  const sheets = await tx.requirementSheet.findMany({
    where: { periodKey: pk, status: "LOCKED" },
    include: {
      salesOrder: { select: { id: true, orderType: true, customerReturnId: true } },
      lines: { select: { id: true, itemId: true, requirementQty: true } },
    },
    orderBy: [{ salesOrderId: "asc" }, { cycleId: "asc" }, { version: "desc" }, { id: "desc" }],
  });

  const latestByKey = new Map();
  for (const sheet of sheets) {
    if (sheet.salesOrder?.orderType !== "NO_QTY") continue;
    const cycleId = sheet.cycleId != null ? Number(sheet.cycleId) : 0;
    const key = `${sheet.salesOrderId}:${cycleId}`;
    if (!latestByKey.has(key)) latestByKey.set(key, sheet);
  }
  return [...latestByKey.values()];
}

/**
 * Balance-capped WO creation from a locked Requirement Sheet.
 */
async function createNoQtyWorkOrderFromLockedSheet(tx, sheet, options = {}) {
  const activeCycleId = sheet.cycleId != null ? Number(sheet.cycleId) : null;
  if (!activeCycleId || !Number.isFinite(activeCycleId) || activeCycleId <= 0) {
    return { workOrderId: null, created: false, skippedReason: "NO_CYCLE" };
  }

  await lockRequirementSheetForWoPlacement(tx, sheet.id);

  const linkedWorkOrders = await tx.workOrder.findMany({
    where: { requirementSheetId: sheet.id },
    select: {
      id: true,
      cycleId: true,
      status: true,
      lines: { select: { fgItemId: true, qty: true, plannedQty: true } },
    },
  });
  for (const existing of linkedWorkOrders) {
    const woCycleId = existing.cycleId == null ? null : Number(existing.cycleId);
    if (!woCycleId || woCycleId !== activeCycleId) {
      await tx.workOrder.update({
        where: { id: existing.id },
        data: { cycleId: activeCycleId },
      });
    }
  }

  const soHead = sheet.salesOrder;
  if (soHead?.orderType === "REPLACEMENT" || soHead?.customerReturnId != null) {
    return { workOrderId: null, created: false, skippedReason: "REPLACEMENT_SO" };
  }

  const soLines = await tx.salesOrderLine.findMany({
    where: { soId: sheet.salesOrderId },
    select: { itemId: true, item: { select: { itemType: true } } },
  });
  const allowedFgItemIds = new Set((soLines || []).filter((l) => l.item?.itemType === "FG").map((l) => l.itemId));

  const placedByItem = sumPlacedQtyByItem(linkedWorkOrders);
  const {
    validateAndEnrichProductionRuns,
    assertClientSetupCountMatchesDerived,
    assertClientPurgeCountMatchesDerived,
    createWorkOrderProductionRuns,
    mapPersistedRunRow,
    RUN_INCLUDE,
  } = require("./woProductionRunAllocationService");

  let runsSource = options?.productionRuns;
  if (!Array.isArray(runsSource) || !runsSource.length) {
    const draftFindMany = tx.requirementSheetPlannedRunAllocation?.findMany;
    if (typeof draftFindMany === "function") {
      const draftRuns = await draftFindMany.call(tx.requirementSheetPlannedRunAllocation, {
        where: { requirementSheetId: sheet.id },
        include: RUN_INCLUDE,
        orderBy: [{ fgItemId: "asc" }, { runSequence: "asc" }],
      });
      runsSource = (draftRuns ?? []).map(mapPersistedRunRow).filter(Boolean);
    } else {
      runsSource = [];
    }
  }

  // Assessment without purging first for placement caps; per-WO setup applied at create.
  const assessment = await assessNoQtyBatchPlacement(tx, sheet, {
    placedByItem,
    plannedSetupCount: 1,
  });
  const balanceLines = assessment.balanceLines.filter((line) => line.rsBalanceQty > EPS);

  const requestedLines = normalizeRequestedPlacementLines(options?.requestedLines, balanceLines);
  const positiveLines = requestedLines.filter((line) => Number.isFinite(line.qty) && line.qty > EPS);

  if (!positiveLines.length) {
    return { workOrderId: null, created: false, skippedReason: "ZERO_EXECUTABLE_QTY" };
  }

  const shouldEnforceAllowedFgItemIds = Array.isArray(sheet?.salesOrder?.lines) && sheet.salesOrder.lines.length > 0;
  if (shouldEnforceAllowedFgItemIds && allowedFgItemIds.size > 0) {
    for (const l of positiveLines) {
      const fgItemId = Number(l.itemId ?? l.fgItemId);
      if (!allowedFgItemIds.has(fgItemId)) {
        const err = new Error("Requirement sheet contains an item that is not a finished good on the sales order.");
        err.statusCode = 409;
        throw err;
      }
    }
  }

  validateNoQtyPlacementRequest(assessment, positiveLines, {
    snapshot: options?.placementSnapshot ?? null,
  });

  const placementUnitByItemId = assessment.fgUnitByItemId;

  const createdWorkOrders = [];
  for (const line of positiveLines) {
    const fgItemId = Number(line.itemId ?? line.fgItemId);
    const fgUnit = placementUnitByItemId.get(fgItemId) ?? null;
    const qty = roundFgQty(line.qty, fgUnit, { mode: "floor" });
    if (!(qty > EPS)) continue;

    const fgRuns = (runsSource ?? []).filter((r) => Number(r.fgItemId) === fgItemId);
    const validated = await validateAndEnrichProductionRuns(
      tx,
      fgRuns,
      [{ fgItemId, plannedQty: qty }],
      { requireRuns: true },
    );
    assertClientSetupCountMatchesDerived(options?.plannedSetupCount);
    assertClientPurgeCountMatchesDerived(options?.plannedPurgeCount, validated.plannedPurgeCount);

    const created = await tx.workOrder.create({
      data: {
        salesOrderId: sheet.salesOrderId,
        requirementSheetId: sheet.id,
        cycleId: activeCycleId,
        plannedSetupCount: 1,
        plannedPurgeCount: validated.plannedPurgeCount,
        productionRunCount: validated.productionRunCount,
        status: "PENDING",
        docNo: await allocateWorkOrderDocNo(tx, { flow: WORK_ORDER_FLOW.NO_QTY, date: new Date() }),
        lines: {
          create: [
            {
              fgItemId,
              qty: String(qty),
              plannedQty: String(qty),
            },
          ],
        },
      },
      include: { lines: true },
    });
    await createWorkOrderProductionRuns(tx, created.id, created.lines, validated.enriched);
    // Clear draft runs for this FG after successful placement.
    if (typeof tx.requirementSheetPlannedRunAllocation?.deleteMany === "function") {
      await tx.requirementSheetPlannedRunAllocation.deleteMany({
        where: { requirementSheetId: sheet.id, fgItemId },
      });
    }
    createdWorkOrders.push({
      workOrderId: created.id,
      workOrderDocNo: created.docNo ?? null,
      fgItemId,
      qty,
      plannedPurgeCount: validated.plannedPurgeCount,
      productionRunCount: validated.productionRunCount,
      plannedSetupCount: 1,
    });
  }

  const first = createdWorkOrders[0] ?? null;
  return {
    workOrderId: first?.workOrderId ?? null,
    workOrderDocNo: first?.workOrderDocNo ?? null,
    workOrderIds: createdWorkOrders.map((wo) => wo.workOrderId),
    workOrders: createdWorkOrders,
    created: createdWorkOrders.length > 0,
    skippedReason: null,
  };
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ periodKey: string }} input
 */
async function createWorkOrdersForPeriodRelease(tx, { periodKey }) {
  const sheets = await findLatestLockedSheetsForPeriod(tx, periodKey);
  const workOrders = [];
  for (const sheet of sheets) {
    const result = await createNoQtyWorkOrderFromLockedSheet(tx, sheet);
    const createdRows = Array.isArray(result.workOrders) && result.workOrders.length > 0
      ? result.workOrders
      : result.workOrderId
        ? [{ workOrderId: result.workOrderId, workOrderDocNo: result.workOrderDocNo ?? null }]
        : [];
    for (const row of createdRows) {
      workOrders.push({
        workOrderId: row.workOrderId,
        workOrderDocNo: row.workOrderDocNo ?? null,
        requirementSheetId: sheet.id,
        salesOrderId: sheet.salesOrderId,
        created: result.created,
        skippedReason: result.skippedReason,
      });
    }
  }
  return workOrders;
}

/**
 * All NO_QTY WOs for a released period (including pre-release grandfather rows).
 */
async function listNoQtyWorkOrderIdsForPeriod(db, periodKey) {
  const pk = String(periodKey ?? "").trim();
  if (!pk) return [];

  const sheets = await db.requirementSheet.findMany({
    where: { periodKey: pk, status: "LOCKED" },
    select: { id: true },
  });
  const sheetIds = sheets.map((s) => s.id);
  if (!sheetIds.length) return [];

  const wos = await db.workOrder.findMany({
    where: {
      requirementSheetId: { in: sheetIds },
      status: { in: ["PENDING", "IN_PROGRESS", "HOLD", "PAUSED"] },
      salesOrder: { orderType: "NO_QTY" },
    },
    select: { id: true },
  });
  return wos.map((w) => w.id);
}

/**
 * Post-release PMR lookup for all execution WOs in the period.
 */
async function ensurePmrsForPeriodExecution(db, { periodKey, actor = {} }) {
  void actor;
  const woIds = await listNoQtyWorkOrderIdsForPeriod(db, periodKey);
  const pmrs = [];
  for (const workOrderId of woIds) {
    try {
      const pmr = await getExistingProductionMaterialRequestForWorkOrder(workOrderId, db);
      if (!pmr) continue;
      pmrs.push({
        workOrderId,
        pmrId: pmr?.id ?? null,
        pmrDocNo: pmr?.docNo ?? null,
        status: pmr?.status ?? null,
      });
    } catch (err) {
      console.warn(`[NO_QTY_RELEASE] PMR lookup for WO ${workOrderId} failed:`, err?.message || err);
    }
  }
  return pmrs;
}

module.exports = {
  NO_QTY_WO_PLACED_COUNT_STATUSES,
  findLatestLockedSheetsForPeriod,
  buildNoQtyWoBatchPlacementPreview,
  createNoQtyWorkOrderFromLockedSheet,
  createWorkOrdersForPeriodRelease,
  listNoQtyWorkOrderIdsForPeriod,
  ensurePmrsForPeriodExecution,
  isNoQtyWoPlacedStatusCounted,
  lockRequirementSheetForWoPlacement,
  sumPlacedQtyByItem,
  woLinePlacedQty,
};
