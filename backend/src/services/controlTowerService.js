/**
 * Control Tower read-model — panel metrics only (Prompt 1).
 * Composes existing dashboard / queue / accounts services; does not alter workflow logic.
 */

const { prisma } = require("../utils/prisma");
const { loadStockByItemIdUsableMap } = require("./stockService");
const { buildRmStockHealthAlerts } = require("./inventoryHealthService");
const {
  getActionableWorkOrderCount,
  getDispatchBacklogRows,
  getProductionQueueRows,
  getQcWorkQueueCounts,
  getRmRiskRows,
  getActiveNoQtySalesOrders,
  getContinueWorkingRows,
  QUEUE_EPS,
} = require("./dashboardQueueSnapshots");
const { getWoPrepareDashboardQueues } = require("./woPrepareOperationalQueue");
const {
  buildStoreIssuePendingDashboardRows,
  buildAllocationFirstDashboardRows,
} = require("./materialAvailabilityWorkspaceService");
const { getAccountsDashboard } = require("./accountsDashboardService");
const { getEligibleDispatches } = require("./salesBillService");
const { buildOperationsExceptionReportPayload } = require("./operationsExceptionReport");

const PANEL_NUM_EPS = QUEUE_EPS;

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Stable empty panel shape (counts null = not loaded / deferred). */
function buildEmptyPanelMetricsData() {
  return {
    liveFactoryPanel: {
      rmShortageCount: 0,
      rmReadyCount: 0,
      productionPendingCount: 0,
      qaPendingCount: 0,
      dispatchPendingLineCount: 0,
      dispatchPendingQty: 0,
      activeSalesOrders: 0,
      activeWorkOrders: 0,
      billingReadyCount: null,
      billingPendingCount: null,
      exportPendingCount: null,
    },
    liveProcessBoard: {
      pendingProcesses: 0,
      delayedProcesses: 0,
    },
    criticalAlerts: {
      rmCriticalCount: 0,
      blockedWorkOrders: 0,
      systemExceptions: 0,
      alertTotal: 0,
    },
    noQtyControlPanel: {
      activeNoQtyOrders: 0,
      planningPending: 0,
    },
    commercialControl: {
      billingReady: null,
      billingPending: null,
      exportPending: null,
      paymentPending: null,
    },
    roleBasedQueues: {
      admin: null,
      store: null,
      production: null,
      qa: null,
      purchase: null,
    },
  };
}

/**
 * @param {unknown} data
 * @returns {boolean}
 */
function validatePanelMetricsShape(data) {
  if (!data || typeof data !== "object") return false;
  const required = [
    "liveFactoryPanel",
    "liveProcessBoard",
    "criticalAlerts",
    "noQtyControlPanel",
    "commercialControl",
    "roleBasedQueues",
  ];
  for (const key of required) {
    if (!(key in data)) return false;
  }
  const lfp = data.liveFactoryPanel;
  if (!lfp || typeof lfp !== "object") return false;
  const lfpKeys = [
    "rmShortageCount",
    "rmReadyCount",
    "productionPendingCount",
    "qaPendingCount",
    "dispatchPendingLineCount",
    "dispatchPendingQty",
    "activeSalesOrders",
    "activeWorkOrders",
  ];
  for (const k of lfpKeys) {
    if (!(k in lfp)) return false;
  }
  return true;
}

async function countActiveSalesOrders(db) {
  return db.salesOrder.count({
    where: {
      internalStatus: { in: ["APPROVED", "IN_PROCESS"] },
      orderType: { in: ["NORMAL", "NO_QTY", "REPLACEMENT"] },
    },
  });
}

function countDispatchPendingFromBacklog(rows) {
  let lineCount = 0;
  let qty = 0;
  for (const r of rows || []) {
    const dbl = n(r.dispatchableNow);
    if (dbl > PANEL_NUM_EPS) {
      lineCount += 1;
      qty += dbl;
    }
  }
  return { lineCount, qty };
}

function countProductionPendingFromQueue(rows) {
  let count = 0;
  for (const r of rows || []) {
    if (String(r.nextAction ?? "") === "ON_HOLD") continue;
    if (String(r.nextAction ?? "") === "PRODUCTION_PENDING") count += 1;
  }
  return count;
}

function countRmReady(allocationRows, storeIssueRows, readyForWoCreationCount) {
  const readyIssue = (allocationRows || []).filter((r) => r.operationalKey === "READY_FOR_ISSUE").length;
  return n(readyForWoCreationCount) + (storeIssueRows || []).length + readyIssue;
}

function countPlanningPendingNoQty(activeRows) {
  let nPending = 0;
  for (const row of activeRows || []) {
    const st = String(row.latestRequirementSheetStatus ?? "").toUpperCase();
    if (st !== "LOCKED") nPending += 1;
  }
  return nPending;
}

function sumExceptionSummary(summary) {
  if (!summary || typeof summary !== "object") return 0;
  return (
    n(summary.dispatchExceptionCount) +
    n(summary.productionExceptionCount) +
    n(summary.qcExceptionRowsWithPendingQc) +
    n(summary.criticalRmItemCount) +
    n(summary.purchaseSummaryLineCount)
  );
}

/**
 * High-level Control Tower panel metrics (counts only — no operational rows).
 * @param {import('@prisma/client').PrismaClient} [db]
 * @param {{ userRole?: string | null }} [opts]
 */
async function getControlTowerPanelMetrics(db = prisma, opts = {}) {
  const role = String(opts.userRole ?? "").trim().toUpperCase();
  const includeCommercial = role === "ADMIN";

  const data = buildEmptyPanelMetricsData();

  const [
    stockByItemId,
    rmItems,
    activeSalesOrders,
    activeWorkOrders,
    dispatchBacklog,
    productionQueue,
    qcCounts,
    rmRiskRows,
    woPrepareQueues,
    storeIssuePending,
    allocationFirstPending,
    activeNoQtyRows,
    continueWorking,
    operationsExceptions,
  ] = await Promise.all([
    loadStockByItemIdUsableMap(db),
    db.item.findMany({ where: { itemType: "RM" }, select: { id: true, itemName: true, minimumStockQty: true, minStockLevel: true } }),
    countActiveSalesOrders(db),
    getActionableWorkOrderCount(db),
    getDispatchBacklogRows(),
    getProductionQueueRows(),
    getQcWorkQueueCounts(db),
    getRmRiskRows(),
    getWoPrepareDashboardQueues(db),
    buildStoreIssuePendingDashboardRows(db),
    buildAllocationFirstDashboardRows(db),
    getActiveNoQtySalesOrders({ limit: 50 }),
    getContinueWorkingRows({ limit: 100 }),
    buildOperationsExceptionReportPayload(),
  ]);

  const { rmStockCriticalCount } = buildRmStockHealthAlerts(rmItems, stockByItemId);

  const rmRiskCritical = (rmRiskRows || []).filter((r) => r.status === "CRITICAL").length;
  const woRmShortage = (woPrepareQueues?.rmShortageBlocking || []).length;
  const dispatchPending = countDispatchPendingFromBacklog(dispatchBacklog);
  const exceptionSummary = operationsExceptions?.summary ?? {};

  data.liveFactoryPanel = {
    rmShortageCount: rmRiskCritical + woRmShortage,
    rmReadyCount: countRmReady(
      allocationFirstPending,
      storeIssuePending,
      (woPrepareQueues?.readyForWoCreation || []).length,
    ),
    productionPendingCount: countProductionPendingFromQueue(productionQueue),
    qaPendingCount: n(qcCounts?.productionQcPendingCount),
    dispatchPendingLineCount: dispatchPending.lineCount,
    dispatchPendingQty: Math.round(dispatchPending.qty * 1000) / 1000,
    activeSalesOrders,
    activeWorkOrders,
    billingReadyCount: null,
    billingPendingCount: null,
    exportPendingCount: null,
  };

  data.liveProcessBoard = {
    pendingProcesses:
      n(data.liveFactoryPanel.productionPendingCount) +
      n(data.liveFactoryPanel.qaPendingCount) +
      dispatchPending.lineCount +
      (continueWorking || []).length,
    delayedProcesses: sumExceptionSummary(exceptionSummary),
  };

  data.criticalAlerts = {
    rmCriticalCount: n(rmStockCriticalCount) + rmRiskCritical,
    blockedWorkOrders: rmRiskCritical,
    systemExceptions: sumExceptionSummary(exceptionSummary),
    alertTotal: 0,
  };
  data.criticalAlerts.alertTotal =
    n(data.criticalAlerts.rmCriticalCount) +
    n(data.criticalAlerts.blockedWorkOrders) +
    n(data.criticalAlerts.systemExceptions);

  data.noQtyControlPanel = {
    activeNoQtyOrders: (activeNoQtyRows || []).length,
    planningPending: countPlanningPendingNoQty(activeNoQtyRows),
  };

  if (includeCommercial) {
    const [accounts, eligibleDispatches] = await Promise.all([
      getAccountsDashboard(db),
      getEligibleDispatches(db),
    ]);
    const billingReady = (eligibleDispatches || []).filter((d) => !d.hasDraftBill).length;
    const billingPending = (eligibleDispatches || []).filter((d) => d.hasDraftBill).length;
    const exportPending =
      n(accounts?.stats?.exportSalesCount) + n(accounts?.stats?.exportPurchaseCount);
    const paymentPending = (accounts?.paymentFollowUp || []).filter(
      (r) => n(r.pendingAmount) > PANEL_NUM_EPS,
    ).length;

    data.liveFactoryPanel.billingReadyCount = billingReady;
    data.liveFactoryPanel.billingPendingCount = billingPending;
    data.liveFactoryPanel.exportPendingCount = exportPending;

    data.commercialControl = {
      billingReady,
      billingPending,
      exportPending,
      paymentPending,
    };
  }

  return {
    data,
    meta: {
      generatedAt: new Date().toISOString(),
      panelOnly: true,
      commercialIncluded: includeCommercial,
      hints: {
        productionPendingCount: "Production-queue lines with nextAction PRODUCTION_PENDING (excludes ON_HOLD).",
        dispatchPendingLineCount: "Dispatch-backlog lines with dispatchableNow > 0 (includes NO_QTY when applicable).",
        rmShortageCount: "RM-risk CRITICAL rows plus WO-prepare RM_SHORTAGE blocking SOs.",
        roleBasedQueues: "Deferred — role queue buckets are not implemented in Prompt 1.",
      },
    },
  };
}

module.exports = {
  getControlTowerPanelMetrics,
  buildEmptyPanelMetricsData,
  validatePanelMetricsShape,
};
