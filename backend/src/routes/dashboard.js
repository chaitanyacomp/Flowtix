const express = require("express");
const { prisma } = require("../utils/prisma");
const { QC_ENTRY_ACTIVE_WHERE } = require("../services/qcEntryConstants");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  METRIC_DEFINITIONS,
  METRIC_CONTEXT,
  buildSoLineDispatchAllocation,
  getSoLineAttributedDispatchedQty,
  getSoLineDispatchPendingQty,
  buildDispatchableQtyBySalesOrderLineId,
  DISPATCH_ALLOC_MODE,
  REPORT_QUEUE_EPS,
} = require("../services/reportMetrics");
const { mapSoLinesToDispatchFifoInputs, dispatchFifoQtyForSoLine } = require("../services/regularSoBufferQty");
const { buildQcAcceptedMap, buildReplacementReturnQcGrossBySoItemKey } = require("../services/dispatchQcCap");
const { getWoPrepareDashboardQueues } = require("../services/woPrepareOperationalQueue");
const { buildProcurementPendingQueue } = require("../services/procurementWorkspaceService");
const {
  getDispatchBacklogRows,
  getProductionQueueRows,
  getPausedWorkOrderRows,
  getQcQueueRows,
  getContinueWorkingRows,
  logAuditWo147ContinueWorkingRows,
  getActiveNoQtySalesOrders,
  getNoQtyDashboardCycleHistory,
  getActionableWorkOrderCount,
  getRmRiskRows,
  getPurchaseSummaryRows,
  getQcWorkQueueCounts,
  getQuotationsPendingSalesOrderRows,
} = require("../services/dashboardQueueSnapshots");
const { usableStockDisplayQty, loadStockByItemIdUsableMap } = require("../services/stockService");
const {
  DISPATCH_READ_ROLES,
  PURCHASE_DASHBOARD_ROLES,
  WO_PREPARE_CREATION_DASHBOARD_ROLES,
  ALL_APP_ROLES,
} = require("../constants/erpRoles");
const { getAccountsDashboard } = require("../services/accountsDashboardService");
const {
  dispositionPendingExcludingReworkReady,
  dispositionHoldRemaining,
  buildRecentQcRejectionsReportDtos,
  resolveReportDateRangeFromQuery,
  sumTotals,
  buildRecentQcRejectionsPdfBuffer,
} = require("../services/recentQcRejectionsReport");

const dashboardRouter = express.Router();

const DASHBOARD_SUMMARY_ACCESS_DENIED = "Access denied. Only administrators can view the dashboard summary.";
const DISPATCH_BACKLOG_ACCESS_DENIED =
  "Access denied. Only administrators and store staff can view dispatch backlog.";
const PRODUCTION_QUEUE_ACCESS_DENIED =
  "Access denied. Only administrators and production staff can view the production queue.";
const QC_QUEUE_ACCESS_DENIED = "Access denied. Only administrators and QA staff can view the QA queue.";
const RM_RISK_ACCESS_DENIED =
  "Access denied. Only administrators, store, purchase, and production staff can view RM risk.";
const PURCHASE_SUMMARY_ACCESS_DENIED =
  "Access denied. Only administrators and purchase staff can view purchase summary.";
const CONTINUE_WORKING_ACCESS_DENIED =
  "Access denied. You do not have access to the continue-working pipeline list.";
const QUOTATIONS_PENDING_SO_ACCESS_DENIED =
  "Access denied. Only administrators can view quotations pending sales order creation.";

const dashboardSummaryRoles = requireRole(["ADMIN"], DASHBOARD_SUMMARY_ACCESS_DENIED);
const continueWorkingRoles = requireRole(["ADMIN", "STORE", "PRODUCTION", "QA"], CONTINUE_WORKING_ACCESS_DENIED);
const dispatchBacklogRoles = requireRole([...DISPATCH_READ_ROLES], DISPATCH_BACKLOG_ACCESS_DENIED);
const productionQueueRoles = requireRole(["ADMIN", "PRODUCTION"], PRODUCTION_QUEUE_ACCESS_DENIED);
const qcQueueRoles = requireRole(["ADMIN", "QA"], QC_QUEUE_ACCESS_DENIED);
const rmRiskRoles = requireRole(["ADMIN", "PRODUCTION"], RM_RISK_ACCESS_DENIED);
const purchaseSummaryRoles = requireRole(["ADMIN", "PURCHASE", "STORE"], PURCHASE_SUMMARY_ACCESS_DENIED);
const woPrepareProcurementRoles = requireRole(
  [...PURCHASE_DASHBOARD_ROLES],
  "Access denied. Only administrators and purchase staff can view procurement prepare queues.",
);
const woPrepareQueuesRoles = requireRole(
  [...new Set([...PURCHASE_DASHBOARD_ROLES, ...WO_PREPARE_CREATION_DASHBOARD_ROLES])],
  "Access denied.",
);
const quotationsPendingSoRoles = requireRole(["ADMIN"], QUOTATIONS_PENDING_SO_ACCESS_DENIED);
const purchaseDashboardRoles = requireRole(["ADMIN", "PURCHASE"], "Access denied.");

function dashboardErrorResponse(res, err, endpoint) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error("Dashboard API Error:", { endpoint, message: e.message, stack: e.stack });
  return res.status(500).json({
    message: "Dashboard failed",
    endpoint,
    error: e.message,
    stack: process.env.NODE_ENV === "development" ? e.stack : undefined,
  });
}

dashboardRouter.get("/dispatch-backlog", requireAuth, dispatchBacklogRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/dispatch-backlog" });
  try {
    const rows = await getDispatchBacklogRows();
    return res.json(rows);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/dispatch-backlog");
  }
});

dashboardRouter.get("/production-queue", requireAuth, productionQueueRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/production-queue" });
  try {
    const rows = await getProductionQueueRows();
    return res.json(rows);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/production-queue");
  }
});

dashboardRouter.get("/paused-work-orders", requireAuth, productionQueueRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/paused-work-orders" });
  try {
    const rows = await getPausedWorkOrderRows();
    return res.json(rows);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/paused-work-orders");
  }
});

dashboardRouter.get("/qc-queue", requireAuth, qcQueueRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/qc-queue" });
  try {
    /** Same pool as QC workspace production queue: all APPROVED batches with pending first-pass QC (REGULAR + NO_QTY). */
    const rows = await getQcQueueRows();
    return res.json(rows);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/qc-queue");
  }
});

dashboardRouter.get("/rm-risk", requireAuth, rmRiskRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/rm-risk" });
  try {
    const rows = await getRmRiskRows();
    return res.json(rows);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/rm-risk");
  }
});

dashboardRouter.get("/procurement-pending", requireAuth, woPrepareProcurementRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/procurement-pending" });
  try {
    const {
      buildStoreIssuePendingDashboardRows,
      buildAllocationFirstDashboardRows,
    } = require("../services/materialAvailabilityWorkspaceService");
    const [rows, storeIssuePending] = await Promise.all([
      buildProcurementPendingQueue(prisma, { woPlanningOnly: true }),
      buildStoreIssuePendingDashboardRows(prisma),
    ]);
    const allocationFirstPending = await buildAllocationFirstDashboardRows(prisma);
    return res.json({ rows, storeIssuePending, allocationFirstPending, count: rows.length });
  } catch (err) {
    console.error("Dashboard procurement-pending aggregation failed", {
      endpoint: "/api/dashboard/procurement-pending",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return dashboardErrorResponse(res, err, "/api/dashboard/procurement-pending");
  }
});

dashboardRouter.get("/wo-prepare-queues", requireAuth, woPrepareQueuesRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/wo-prepare-queues" });
  try {
    const queues = await getWoPrepareDashboardQueues(prisma);
    return res.json(queues);
  } catch (err) {
    console.error("Dashboard wo-prepare-queues aggregation failed", {
      endpoint: "/api/dashboard/wo-prepare-queues",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return dashboardErrorResponse(res, err, "/api/dashboard/wo-prepare-queues");
  }
});

dashboardRouter.get("/purchase-summary", requireAuth, purchaseSummaryRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/purchase-summary" });
  try {
    const rows = await getPurchaseSummaryRows();
    return res.json(rows);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/purchase-summary");
  }
});

dashboardRouter.get("/accounts", requireAuth, purchaseDashboardRoles, async (req, res, next) => {
  try {
    const payload = await getAccountsDashboard(prisma);
    return res.json(payload);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/accounts");
  }
});

dashboardRouter.get("/quotations-pending-so", requireAuth, quotationsPendingSoRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/quotations-pending-so" });
  try {
    const raw = Number(req.query.limit);
    const limit =
      Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.max(1, Math.floor(raw))) : 25;
    const rows = await getQuotationsPendingSalesOrderRows({ limit });
    return res.json(rows);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/quotations-pending-so");
  }
});

dashboardRouter.get("/continue-working", requireAuth, continueWorkingRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/continue-working" });
  try {
    const raw = Number(req.query.limit);
    const limit =
      Number.isFinite(raw) && raw > 0 ? Math.min(100, Math.max(5, Math.floor(raw))) : 50;
    const rows = await getContinueWorkingRows({ limit });
    logAuditWo147ContinueWorkingRows(rows);
    return res.json(rows);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/continue-working");
  }
});

dashboardRouter.get("/no-qty-active", requireAuth, continueWorkingRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/no-qty-active" });
  try {
    const raw = Number(req.query.limit);
    const limit =
      Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.max(1, Math.floor(raw))) : 10;
    const rows = await getActiveNoQtySalesOrders({ limit });
    return res.json(rows);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/no-qty-active");
  }
});

dashboardRouter.get("/no-qty-cycle-history", requireAuth, continueWorkingRoles, async (req, res, next) => {
  try {
    const soId = Number(req.query.soId);
    if (!Number.isFinite(soId) || soId <= 0) {
      return res.status(400).json({ message: "Query soId (positive integer) is required." });
    }
    const payload = await getNoQtyDashboardCycleHistory(soId);
    if (!payload) {
      return res.status(404).json({ message: "No Qty sales order not found." });
    }
    return res.json(payload);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/no-qty-cycle-history");
  }
});

const RECENT_QC_REJECTIONS_REPORT_ROW_CAP = 2500;

dashboardRouter.get("/recent-qc-rejections-report.pdf", requireAuth, dashboardSummaryRoles, async (req, res, next) => {
  try {
    const parsed = resolveReportDateRangeFromQuery(req.query);
    if ("error" in parsed) return res.status(400).json({ message: parsed.error });
    const { from, to } = parsed;
    const rows = await buildRecentQcRejectionsReportDtos(prisma, {
      dateFrom: from,
      dateTo: to,
      take: RECENT_QC_REJECTIONS_REPORT_ROW_CAP,
    });
    const buf = await buildRecentQcRejectionsPdfBuffer({
      rows,
      from,
      to,
      generatedAt: new Date(),
    });
    const fname = `recent-qc-rejections_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    return res.send(buf);
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/recent-qc-rejections-report.pdf");
  }
});

dashboardRouter.get("/recent-qc-rejections-report", requireAuth, dashboardSummaryRoles, async (req, res, next) => {
  try {
    const parsed = resolveReportDateRangeFromQuery(req.query);
    if ("error" in parsed) return res.status(400).json({ message: parsed.error });
    const { from, to } = parsed;
    const rows = await buildRecentQcRejectionsReportDtos(prisma, {
      dateFrom: from,
      dateTo: to,
      take: RECENT_QC_REJECTIONS_REPORT_ROW_CAP,
    });
    const totals = sumTotals(rows);
    const generatedAt = new Date();
    return res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: generatedAt.toISOString(),
      rows,
      totals,
    });
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/recent-qc-rejections-report");
  }
});

dashboardRouter.get("/", requireAuth, dashboardSummaryRoles, async (req, res, next) => {
  console.log("Dashboard API called", { endpoint: "/api/dashboard/" });
  try {
    if (process.env.DASHBOARD_ISOLATE === "1") {
      return res.json({ ok: true, message: "Dashboard API working" });
    }

    const stockByItemId = await loadStockByItemIdUsableMap(prisma);

    const rmItems = await prisma.item.findMany({ where: { itemType: "RM" } });
    const fgItems = await prisma.item.findMany({ where: { itemType: "FG" } });

    const { buildRmStockHealthAlerts } = require("../services/inventoryHealthService");
    const {
      rmStockCritical,
      rmStockWarning,
      rmStockAlert,
      rmStockCriticalCount,
      rmStockWarningCount,
    } = buildRmStockHealthAlerts(rmItems, stockByItemId);

    const fgStock = fgItems
      .map((i) => ({
        itemId: i.id,
        itemName: i.itemName,
        qty: usableStockDisplayQty(stockByItemId.get(i.id) ?? 0),
      }))
      .sort((a, b) => a.itemName.localeCompare(b.itemName));

    const fgStockTotalQty = fgStock.reduce((s, x) => s + Number(x.qty), 0);

    const pendingWorkOrders = await getActionableWorkOrderCount(prisma);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const qcAgg = await prisma.qcEntry.aggregate({
      where: { ...QC_ENTRY_ACTIVE_WHERE, date: { gte: since } },
      _sum: { acceptedQty: true, rejectedQty: true },
    });
    const acc = Number(qcAgg._sum.acceptedQty || 0);
    const rejGross = Number(qcAgg._sum.rejectedQty || 0);

    const recentNetQcAggRows = await prisma.qcEntry.findMany({
      where: { ...QC_ENTRY_ACTIVE_WHERE, date: { gte: since } },
      select: {
        id: true,
        rejectedQty: true,
        rejectedDispositions: {
          where: { voidedAt: null },
          select: { remainingQty: true, status: true },
        },
      },
    });
    const qcIdsForNet = recentNetQcAggRows.map((q) => q.id);
    const scrapSumByQcId = new Map();
    if (qcIdsForNet.length) {
      const groupedScrap = await prisma.scrapRecord.groupBy({
        by: ["qcEntryId"],
        where: { qcEntryId: { in: qcIdsForNet }, voidedAt: null },
        _sum: { rejectedQty: true },
      });
      for (const g of groupedScrap) {
        if (g.qcEntryId == null) continue;
        scrapSumByQcId.set(g.qcEntryId, Number(g._sum.rejectedQty || 0));
      }
    }
    const netRejectedImpact30d = recentNetQcAggRows.reduce((s, q) => {
      const scrapSum = scrapSumByQcId.get(q.id) || 0;
      const pending = dispositionPendingExcludingReworkReady(q.rejectedDispositions);
      return s + Math.max(0, scrapSum + pending);
    }, 0);
    const qcRejectionPct = acc + rejGross > 0 ? (netRejectedImpact30d / (acc + rejGross)) * 100 : 0;

    const scrapAgg = await prisma.scrapRecord.aggregate({
      where: { date: { gte: since }, voidedAt: null },
      _sum: { rejectedQty: true },
    });
    const totalRejectedQty = Number(scrapAgg._sum.rejectedQty || 0);

    const scrapByFg = await prisma.scrapRecord.groupBy({
      by: ["fgItemId"],
      where: { date: { gte: since }, voidedAt: null },
      _sum: { rejectedQty: true },
      orderBy: { _sum: { rejectedQty: "desc" } },
      take: 8,
    });
    const scrapFgIds = scrapByFg.map((s) => s.fgItemId);
    const scrapFgItems = scrapFgIds.length ? await prisma.item.findMany({ where: { id: { in: scrapFgIds } } }) : [];
    const fgById = new Map(scrapFgItems.map((i) => [i.id, i]));
    const lossSummary = scrapByFg.map((s) => ({
      fgItemId: s.fgItemId,
      itemName: fgById.get(s.fgItemId)?.itemName ?? `#${s.fgItemId}`,
      rejectedQty: Number(s._sum.rejectedQty || 0),
    }));

    const purchasePending = await prisma.rmPurchaseOrder.count({
      where: { status: { in: ["PENDING", "PARTIAL"] } },
    });

    /** Active pre-quotation funnel only (excludes NOT_FEASIBLE, QUOTED, PO_RECEIVED, CLOSED). */
    const openEnquiries = await prisma.enquiry.count({
      where: {
        status: { in: ["OPEN", "DRAFT", "PENDING", "FEASIBLE"] },
      },
    });

    const recentQcRejectionsFull = await buildRecentQcRejectionsReportDtos(prisma, { take: 40 });
    const recentQcRejections = recentQcRejectionsFull.slice(0, 8);

    const salesOrders = await prisma.salesOrder.findMany({
      include: { dispatch: true, lines: { include: { item: true } } },
    });

    /**
     * Dashboard KPI definition:
     *
     * NO_QTY: dispatch is optional; do NOT treat QC-backed availability as “dispatch pending”.
     *
     * NORMAL (Regular SO): customer backlog driven by ordered qty.
     * REPLACEMENT: lines with positive replacement dispatch headroom (return-QC pool).
     */
    let pendingDispatchCount = 0;
    let pendingDispatchableQty = 0;

    // Regular/Replacement dispatchability uses the same helper as the Dispatch page.
    const qcAcceptedMap = await buildQcAcceptedMap(prisma);
    const replacementQcGrossBySoItem = await buildReplacementReturnQcGrossBySoItemKey(prisma, salesOrders, qcAcceptedMap);

    for (const so of salesOrders) {
      if (so.orderType === "NO_QTY") continue;

      // NORMAL (Regular SO): customer PO commitment pending with dispatchable stock (same dispatchable helper as Dispatch page).
      if (so.orderType === "NORMAL") {
        if (so.internalStatus !== "APPROVED" && so.internalStatus !== "IN_PROCESS") continue;
        const lineInputs = mapSoLinesToDispatchFifoInputs(so.lines, so.orderType);
        if (!lineInputs.length) continue;

        const { alloc: allocOp } = buildSoLineDispatchAllocation(
          lineInputs,
          so.dispatch,
          DISPATCH_ALLOC_MODE.OPERATIONAL,
        );
        const { alloc: allocConf } = buildSoLineDispatchAllocation(
          lineInputs,
          so.dispatch,
          DISPATCH_ALLOC_MODE.CONFIRMED,
        );

        const qcAcceptedTotalByItemId = new Map();
        for (const li of lineInputs) {
          const repKey = `${so.id}:${li.itemId}`;
          qcAcceptedTotalByItemId.set(li.itemId, qcAcceptedMap.get(repKey) ?? 0);
        }

        const dispatchableByLineId = buildDispatchableQtyBySalesOrderLineId({
          orderLineInputs: lineInputs,
          dispatchRecords: so.dispatch,
          orderType: so.orderType,
          onHandByItemId: stockByItemId,
          qcAcceptedTotalByItemId,
        });

        for (const ln of so.lines || []) {
          const attrOp = getSoLineAttributedDispatchedQty(allocOp, ln.id);
          const dispatchedConf = getSoLineAttributedDispatchedQty(allocConf, ln.id);
          const dispatchPendingLock = Math.max(0, Number(attrOp) - Number(dispatchedConf));
          const fifoCommit = dispatchFifoQtyForSoLine(ln, so.orderType);
          const pendingDispatchQty = getSoLineDispatchPendingQty(fifoCommit, Number(dispatchedConf));
          const includedOnOpenList = pendingDispatchQty > REPORT_QUEUE_EPS || dispatchPendingLock > REPORT_QUEUE_EPS;
          if (!includedOnOpenList) continue;

          const dispatchableNow = Number(dispatchableByLineId.get(ln.id) ?? 0);
          if (dispatchableNow > REPORT_QUEUE_EPS) {
            pendingDispatchCount += 1;
            pendingDispatchableQty += dispatchableNow;
          }
        }
        continue;
      }

      if (so.orderType !== "REPLACEMENT") continue;

      // REPLACEMENT only: count lines with positive dispatchable headroom (return-QC pool rules, not NORMAL min(backlog, usable)).
      const lineInputs = mapSoLinesToDispatchFifoInputs(so.lines, so.orderType);
      if (!lineInputs.length) continue;

      const { alloc: allocOp, netByItem } = buildSoLineDispatchAllocation(
        lineInputs,
        so.dispatch,
        DISPATCH_ALLOC_MODE.OPERATIONAL,
      );
      const { alloc: allocConf } = buildSoLineDispatchAllocation(
        lineInputs,
        so.dispatch,
        DISPATCH_ALLOC_MODE.CONFIRMED,
      );

      const qcAcceptedTotalByItemId = new Map();
      for (const li of lineInputs) {
        const repKey = `${so.id}:${li.itemId}`;
        let qcGross = qcAcceptedMap.get(repKey) ?? 0;
        if (replacementQcGrossBySoItem.has(repKey)) {
          qcGross = replacementQcGrossBySoItem.get(repKey) ?? 0;
        }
        qcAcceptedTotalByItemId.set(li.itemId, qcGross);
      }

      const dispatchableByLineId = buildDispatchableQtyBySalesOrderLineId({
        orderLineInputs: lineInputs,
        dispatchRecords: so.dispatch,
        orderType: so.orderType,
        onHandByItemId: stockByItemId,
        qcAcceptedTotalByItemId,
      });

      for (const ln of so.lines || []) {
        const attrOp = getSoLineAttributedDispatchedQty(allocOp, ln.id);
        const dispatchedConf = getSoLineAttributedDispatchedQty(allocConf, ln.id);
        const dispatchPendingLock = Math.max(0, Number(attrOp) - Number(dispatchedConf));
        const fifoCommitRep = dispatchFifoQtyForSoLine(ln, so.orderType);
        const pendingDispatchQty = getSoLineDispatchPendingQty(fifoCommitRep, Number(dispatchedConf));
        const includedOnOpenList = pendingDispatchQty > REPORT_QUEUE_EPS || dispatchPendingLock > REPORT_QUEUE_EPS;
        if (!includedOnOpenList) continue;

        const dispatchableNow = Number(dispatchableByLineId.get(ln.id) ?? 0);
        if (dispatchableNow > REPORT_QUEUE_EPS) {
          pendingDispatchCount += 1;
          pendingDispatchableQty += dispatchableNow;
        }
      }
    }

    const qcWorkQueueCounts = await getQcWorkQueueCounts(prisma);

    return res.json({
      rmStockAlert,
      rmStockCritical,
      rmStockWarning,
      rmStockCriticalCount,
      rmStockWarningCount,
      fgStock,
      fgStockTotalQty,
      pendingWorkOrders,
      totalRejectedQty,
      qcRejectionPct,
      lossSummary,
      pendingDispatchCount,
      pendingDispatchableQty,
      purchasePending,
      openEnquiries,
      qcWorkQueueCounts,
      recentQcRejections,
      dashboardMetricHints: {
        fgStockTotalQty:
          "Sum of displayed USABLE FG qty (ledger USABLE, reversedAt null, floored at 0 per item — same display rule as Stock Summary)",
        pendingDispatchCount:
          "NO_QTY: lines (SO × cycle × FG) with positive QC-backed dispatch headroom (any cycle). REPLACEMENT: lines with positive dispatchable qty from return-QC rules. NORMAL: customer PO qty still pending with positive SO-linked QC dispatchable qty (surplus buffer FG excluded).",
        pendingDispatchableQty:
          "Sum of dispatchable qty on counted lines (NO_QTY + REPLACEMENT + NORMAL).",
        openEnquiries:
          "Count of enquiries in active pre-quotation states: OPEN, DRAFT, PENDING, FEASIBLE (excludes NOT_FEASIBLE, QUOTED, PO_RECEIVED, CLOSED)",
        pendingWorkOrders:
          "Count of actionable work orders shown by the Work Orders open list; stale NO_QTY work orders from old cycles are excluded",
        metricDefinitionsRef: METRIC_DEFINITIONS,
        metricContextLegend: METRIC_CONTEXT,
        recentQcRejections:
          "Rows: latest QC entries with rejected qty > 0. Rejected (Gross) = qcEntry.rejectedQty. Hold = sum(remainingQty) on dispositions in HOLD. Scrap / Net Loss (table) = ScrapRecord sum for qcEntryId + disposition remainder in rework-pending / disposition-SCRAP paths (pending excluding HOLD; still excludes REWORK_READY_FOR_QC). Recovered = Gross − ScrapRecord − full pending (so Recovered + Hold + Scrap/Net Loss = Gross). KPI netRejectedImpact still uses scrap + full pending (includes hold).",
      },
    });
  } catch (err) {
    return dashboardErrorResponse(res, err, "/api/dashboard/");
  }
});

module.exports = { dashboardRouter };
