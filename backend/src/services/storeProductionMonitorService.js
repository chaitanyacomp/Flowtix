/**
 * Store Operations — read-only Production Monitor payload.
 * Reuses getProductionQueueRows() (same feed as Production Workspace) and adds
 * Completed Today. Never exposes production mutation CTAs.
 */

const { prisma } = require("../utils/prisma");
const { getOrSetRequestCache } = require("../utils/prismaQueryMetrics");
const {
  getProductionQueueRows,
  customerNameForSalesOrder,
  QUEUE_EPS,
} = require("./dashboardQueueSnapshots");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { getWoLineRemainingProductionQty } = require("./reportMetrics");

function isGreenLevelWorkOrder(wo) {
  return String(wo?.sourceType ?? "").toUpperCase() === "GREEN_LEVEL_REPLENISHMENT";
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function num(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Strip mutation navigation from queue rows for Store read-only consumption.
 * @param {object} row
 */
function toReadOnlyMonitorRow(row, { completedToday = false } = {}) {
  if (!row || typeof row !== "object") return row;
  const {
    actionHref: _actionHref,
    openDraftProductionId: _openDraftProductionId,
    ...rest
  } = row;
  return {
    ...rest,
    actionHref: null,
    openDraftProductionId: null,
    readOnly: true,
    completedToday: Boolean(completedToday),
    monitorBucket: completedToday ? "COMPLETED" : null,
  };
}

/**
 * Latest production-entry activity per WO line (APPROVED or DRAFT).
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number[]} workOrderLineIds
 * @returns {Promise<Map<number, string>>}
 */
async function loadLastProductionActivityByLineId(db, workOrderLineIds) {
  /** @type {Map<number, string>} */
  const out = new Map();
  const ids = [...new Set((workOrderLineIds || []).map(Number).filter((id) => id > 0))];
  if (!ids.length) return out;

  const entries = await db.productionEntry.findMany({
    where: {
      workOrderLineId: { in: ids },
      workflowStatus: { in: ["APPROVED", "DRAFT"] },
    },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { workOrderLineId: true, date: true },
  });

  for (const e of entries) {
    const lineId = Number(e.workOrderLineId);
    if (out.has(lineId)) continue;
    out.set(lineId, e.date instanceof Date ? e.date.toISOString() : String(e.date));
  }
  return out;
}

/**
 * WOs completed today (calendar local day). Excludes older completed WOs.
 * REGULAR uses WorkOrder.status + updatedAt; NO_QTY/GL prefer execution.completedAt.
 */
async function getCompletedTodayWorkOrderMonitorRowsUncached() {
  const since = startOfToday();

  const workOrders = await prisma.workOrder.findMany({
    where: {
      status: { notIn: ["REJECTED"] },
      OR: [
        {
          status: { in: ["COMPLETED", "CLOSED_WITH_SHORTFALL"] },
          updatedAt: { gte: since },
        },
        {
          productionExecution: {
            is: {
              executionStatus: "COMPLETED",
              completedAt: { gte: since },
            },
          },
        },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      lines: { include: { fgItem: true }, orderBy: { id: "asc" } },
      salesOrder: { include: { customer: true, po: { include: { customer: true } } } },
      cycle: { select: { id: true, cycleNo: true } },
      productionExecution: true,
    },
    take: 50,
  });

  const lineIds = workOrders.flatMap((wo) => (wo.lines || []).map((l) => l.id));
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(prisma, lineIds);
  const lastActivityByLineId = await loadLastProductionActivityByLineId(prisma, lineIds);

  /** @type {object[]} */
  const rows = [];
  for (const wo of workOrders) {
    const so = wo.salesOrder;
    const orderType = so?.orderType ?? null;
    const isGreenLevelWo = isGreenLevelWorkOrder(wo);
    const customerName = isGreenLevelWo
      ? "Green Level Replenishment"
      : so
        ? customerNameForSalesOrder(so)
        : "Unknown Customer";
    const execStatus = wo.productionExecution?.executionStatus ?? null;
    const completedAt =
      wo.productionExecution?.completedAt != null
        ? new Date(wo.productionExecution.completedAt).toISOString()
        : wo.updatedAt
          ? new Date(wo.updatedAt).toISOString()
          : null;

    for (const line of wo.lines || []) {
      const requiredQty = num(line.plannedQty ?? line.qty);
      const producedQty = num(producedByLineId.get(line.id) ?? 0);
      const balanceQty = getWoLineRemainingProductionQty(requiredQty, producedQty);
      rows.push(
        toReadOnlyMonitorRow(
          {
            workOrderId: wo.id,
            workOrderNo: wo.docNo ?? `WO-${wo.id}`,
            workOrderLineId: line.id,
            salesOrderId: wo.salesOrderId,
            salesOrderNo: isGreenLevelWo ? "Green Level WO" : wo.salesOrderId != null ? `SO-${wo.salesOrderId}` : null,
            customerName,
            sourceType: wo.sourceType ?? null,
            itemId: line.fgItemId,
            itemName: line.fgItem?.itemName ?? `Item #${line.fgItemId}`,
            itemCode: line.fgItem?.itemCode ?? null,
            itemUnit: line.fgItem?.unit ?? null,
            requiredQty,
            producedQty,
            balanceQty,
            status: wo.status,
            holdReason: wo.holdReason ?? null,
            productionExecutionStatus: execStatus,
            productionBlockReason: null,
            productionBlockReasonLabel: null,
            productionBlockRemarks: null,
            pausedAt: null,
            workOrderDate: wo.createdAt.toISOString(),
            lastProductionActivityAt: lastActivityByLineId.get(line.id) ?? completedAt,
            completedAt,
            orderType,
            cycleId: wo.cycleId ?? wo.cycle?.id ?? null,
            cycleNo: wo.cycle?.cycleNo != null ? Number(wo.cycle.cycleNo) : null,
            nextAction: null,
            hasPendingQc: false,
            pendingQcEntryCount: 0,
            pendingQcQty: 0,
            canAcceptProductionEntry: false,
            hasOpenDraft: false,
            productionWorkState: null,
            dispatchableQty: 0,
            actionLabel: "Completed today",
            rmReadinessGate: null,
            rmReadyForProduction: null,
            rmProductionAllowedNowQty: null,
            machineLabel: null,
          },
          { completedToday: true },
        ),
      );
    }
  }
  return rows;
}

async function getCompletedTodayWorkOrderMonitorRows() {
  return getOrSetRequestCache("dashboard:production-monitor:completed-today", () =>
    getCompletedTodayWorkOrderMonitorRowsUncached(),
  );
}

/**
 * Attach lastProductionActivityAt onto active queue rows (additive).
 * @param {object[]} rows
 */
async function attachLastActivityToActiveRows(rows) {
  const lineIds = (rows || []).map((r) => Number(r.workOrderLineId)).filter((id) => id > 0);
  const byLine = await loadLastProductionActivityByLineId(prisma, lineIds);
  for (const row of rows || []) {
    const lineId = Number(row.workOrderLineId);
    row.lastProductionActivityAt =
      (lineId > 0 ? byLine.get(lineId) : null) ?? row.pausedAt ?? row.workOrderDate ?? null;
  }
  return rows;
}

/**
 * Full Store Production Monitor payload.
 * Active rows = same authoritative production-queue feed as Production Workspace.
 */
async function getStoreProductionMonitorPayload() {
  const [activeRaw, completedTodayRows] = await Promise.all([
    getProductionQueueRows(),
    getCompletedTodayWorkOrderMonitorRows(),
  ]);

  const activeWithActivity = await attachLastActivityToActiveRows(
    (activeRaw || []).map((r) => ({ ...r })),
  );
  const activeRows = activeWithActivity.map((r) => toReadOnlyMonitorRow(r, { completedToday: false }));

  return {
    readOnly: true,
    activeRows,
    completedTodayRows,
    liveFactoryCounts: (() => {
      try {
        const { buildLiveFactorySnapshot } = require("./liveFactorySnapshotService");
        return buildLiveFactorySnapshot(activeRaw).counts;
      } catch {
        return null;
      }
    })(),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getStoreProductionMonitorPayload,
  getCompletedTodayWorkOrderMonitorRows,
  toReadOnlyMonitorRow,
  startOfToday,
  QUEUE_EPS,
};
