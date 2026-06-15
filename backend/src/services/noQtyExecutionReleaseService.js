/**
 * P8F — Create NO_QTY work orders at Monthly Plan Release (execution phase).
 */

const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { resolveNoQtyWoExecutableQty } = require("./noQtyWoQtyService");
const {
  ensureSubmittedProductionMaterialRequestForWorkOrder,
} = require("./productionMaterialRequestService");

function n(v) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Latest locked requirement sheet per SO+cycle for a planning period.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} periodKey
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
 * Idempotent WO creation from a locked requirement sheet (same rules as legacy RS-lock path).
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
async function createNoQtyWorkOrderFromLockedSheet(tx, sheet) {
  const activeCycleId = sheet.cycleId != null ? Number(sheet.cycleId) : null;
  if (!activeCycleId || !Number.isFinite(activeCycleId) || activeCycleId <= 0) {
    return { workOrderId: null, created: false, skippedReason: "NO_CYCLE" };
  }

  const existing = await tx.workOrder.findFirst({
    where: { requirementSheetId: sheet.id },
    select: { id: true, cycleId: true },
  });
  if (existing) {
    const woCycleId = existing.cycleId == null ? null : Number(existing.cycleId);
    if (!woCycleId || woCycleId !== activeCycleId) {
      await tx.workOrder.update({
        where: { id: existing.id },
        data: { cycleId: activeCycleId },
      });
    }
    return { workOrderId: existing.id, created: false, skippedReason: "ALREADY_EXISTS" };
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

  const positiveLines = (sheet.lines || [])
    .map((ln) => {
      const toProduce = resolveNoQtyWoExecutableQty(ln);
      return { fgItemId: ln.itemId, qty: toProduce };
    })
    .filter((x) => Number.isFinite(x.qty) && x.qty > 0);

  if (!positiveLines.length) {
    return { workOrderId: null, created: false, skippedReason: "ZERO_EXECUTABLE_QTY" };
  }

  const activeWo = await tx.workOrder.findFirst({
    where: {
      salesOrderId: sheet.salesOrderId,
      cycleId: activeCycleId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    select: { id: true },
  });
  if (activeWo) {
    await tx.workOrder.update({
      where: { id: activeWo.id },
      data: { status: "COMPLETED" },
    });
  }

  for (const l of positiveLines) {
    if (!allowedFgItemIds.has(l.fgItemId)) {
      const err = new Error("Requirement sheet contains an item that is not a finished good on the sales order.");
      err.statusCode = 409;
      throw err;
    }
  }

  const created = await tx.workOrder.create({
    data: {
      salesOrderId: sheet.salesOrderId,
      requirementSheetId: sheet.id,
      cycleId: activeCycleId,
      status: "PENDING",
      docNo: await allocateDocNo(tx, { docType: DocType.WORK_ORDER, date: new Date() }),
      lines: {
        create: positiveLines.map((l) => ({
          fgItemId: l.fgItemId,
          qty: String(l.qty),
          plannedQty: String(l.qty),
        })),
      },
    },
    select: { id: true, docNo: true },
  });

  return { workOrderId: created.id, workOrderDocNo: created.docNo ?? null, created: true, skippedReason: null };
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
    if (result.workOrderId) {
      workOrders.push({
        workOrderId: result.workOrderId,
        workOrderDocNo: result.workOrderDocNo ?? null,
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
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {string} periodKey
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
 * Post-release PMR ensure for all execution WOs in the period.
 * @param {import("@prisma/client").PrismaClient} db
 * @param {{ periodKey: string, actor?: { userId?: number, role?: string } }} input
 */
async function ensurePmrsForPeriodExecution(db, { periodKey, actor = {} }) {
  const woIds = await listNoQtyWorkOrderIdsForPeriod(db, periodKey);
  const pmrs = [];
  for (const workOrderId of woIds) {
    try {
      const pmr = await ensureSubmittedProductionMaterialRequestForWorkOrder(workOrderId, actor, db);
      pmrs.push({
        workOrderId,
        pmrId: pmr?.id ?? null,
        pmrDocNo: pmr?.docNo ?? null,
        status: pmr?.status ?? null,
      });
    } catch (err) {
      console.warn(`[NO_QTY_RELEASE] Auto-ensure PMR for WO ${workOrderId} failed:`, err?.message || err);
    }
  }
  return pmrs;
}

module.exports = {
  findLatestLockedSheetsForPeriod,
  createNoQtyWorkOrderFromLockedSheet,
  createWorkOrdersForPeriodRelease,
  listNoQtyWorkOrderIdsForPeriod,
  ensurePmrsForPeriodExecution,
};
