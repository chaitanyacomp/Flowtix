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
const { normalizePositiveCycleId } = require("../utils/cycleIds");
const { netDispatchedByItemId } = require("../services/salesOrderDispatchAllocation");
const {
  DISPATCH_BACKLOG_EPS,
  getDispatchBacklogRows,
  getProductionQueueRows,
  getQcQueueRows,
  getContinueWorkingRows,
  getRmRiskRows,
  getPurchaseSummaryRows,
} = require("../services/dashboardQueueSnapshots");
const { usableStockDisplayQty } = require("../services/stockService");
const { loadNoQtyCycleQcAcceptedMap } = require("./dispatch");

const dashboardRouter = express.Router();

const DASHBOARD_SUMMARY_ACCESS_DENIED = "Access denied. Only administrators can view the dashboard summary.";
/** Target matrix includes DISPATCH; UserRole has no DISPATCH yet — enforce ADMIN + SALES until role system supports it. */
const DISPATCH_BACKLOG_ACCESS_DENIED =
  "Access denied. Only administrators and sales staff can view dispatch backlog.";
const PRODUCTION_QUEUE_ACCESS_DENIED =
  "Access denied. Only administrators and production staff can view the production queue.";
const QC_QUEUE_ACCESS_DENIED = "Access denied. Only administrators and QC staff can view the QC queue.";
const RM_RISK_ACCESS_DENIED =
  "Access denied. Only administrators, store, and production staff can view RM risk.";
const PURCHASE_SUMMARY_ACCESS_DENIED =
  "Access denied. Only administrators and store staff can view purchase summary.";
const CONTINUE_WORKING_ACCESS_DENIED =
  "Access denied. You do not have access to the continue-working pipeline list.";

const dashboardSummaryRoles = requireRole(["ADMIN"], DASHBOARD_SUMMARY_ACCESS_DENIED);
/** Same broad operational audience as main app nav “Dashboard”. */
const continueWorkingRoles = requireRole(
  ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC", "SUPERVISOR"],
  CONTINUE_WORKING_ACCESS_DENIED,
);
const dispatchBacklogRoles = requireRole(["ADMIN", "SALES"], DISPATCH_BACKLOG_ACCESS_DENIED);
const productionQueueRoles = requireRole(["ADMIN", "PRODUCTION"], PRODUCTION_QUEUE_ACCESS_DENIED);
const qcQueueRoles = requireRole(["ADMIN", "QC", "SUPERVISOR"], QC_QUEUE_ACCESS_DENIED);
const rmRiskRoles = requireRole(["ADMIN", "STORE", "PRODUCTION"], RM_RISK_ACCESS_DENIED);
const purchaseSummaryRoles = requireRole(["ADMIN", "STORE"], PURCHASE_SUMMARY_ACCESS_DENIED);

dashboardRouter.get("/dispatch-backlog", requireAuth, dispatchBacklogRoles, async (req, res, next) => {
  try {
    const rows = await getDispatchBacklogRows();
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

dashboardRouter.get("/production-queue", requireAuth, productionQueueRoles, async (req, res, next) => {
  try {
    const rows = await getProductionQueueRows();
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

dashboardRouter.get("/qc-queue", requireAuth, qcQueueRoles, async (req, res, next) => {
  try {
    const rows = await getQcQueueRows();
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

dashboardRouter.get("/rm-risk", requireAuth, rmRiskRoles, async (req, res, next) => {
  try {
    const rows = await getRmRiskRows();
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

dashboardRouter.get("/purchase-summary", requireAuth, purchaseSummaryRoles, async (req, res, next) => {
  try {
    const rows = await getPurchaseSummaryRows();
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

dashboardRouter.get("/continue-working", requireAuth, continueWorkingRoles, async (req, res, next) => {
  try {
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) && raw > 0 ? raw : 10;
    const rows = await getContinueWorkingRows({ limit });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

dashboardRouter.get("/", requireAuth, dashboardSummaryRoles, async (req, res, next) => {
  try {
    const stockRows = await prisma.stockTransaction.groupBy({
      by: ["itemId"],
      // Stock math must include reversed originals; reversal rows offset them.
      where: { stockBucket: "USABLE" },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const stockByItemId = new Map(
      stockRows.map((r) => [r.itemId, Number(r._sum.qtyIn || 0) - Number(r._sum.qtyOut || 0)]),
    );

    const rmItems = await prisma.item.findMany({ where: { itemType: "RM" } });
    const fgItems = await prisma.item.findMany({ where: { itemType: "FG" } });

    const rmStockAlert = rmItems
      .map((i) => ({
        itemId: i.id,
        itemName: i.itemName,
        qty: stockByItemId.get(i.id) || 0,
        minStockLevel: Number(i.minStockLevel),
      }))
      .filter((r) => r.qty < r.minStockLevel)
      .sort((a, b) => a.qty - b.qty);

    const fgStock = fgItems
      .map((i) => ({
        itemId: i.id,
        itemName: i.itemName,
        qty: usableStockDisplayQty(stockByItemId.get(i.id) ?? 0),
      }))
      .sort((a, b) => a.itemName.localeCompare(b.itemName));

    const fgStockTotalQty = fgStock.reduce((s, x) => s + Number(x.qty), 0);

    const pendingWorkOrders = await prisma.workOrder.count({
      where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
    });

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const qcAgg = await prisma.qcEntry.aggregate({
      where: { ...QC_ENTRY_ACTIVE_WHERE, date: { gte: since } },
      _sum: { acceptedQty: true, rejectedQty: true },
    });
    const acc = Number(qcAgg._sum.acceptedQty || 0);
    const rej = Number(qcAgg._sum.rejectedQty || 0);
    const qcRejectionPct = acc + rej > 0 ? (rej / (acc + rej)) * 100 : 0;

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

    const recentQcRejectionsRaw = await prisma.qcEntry.findMany({
      where: { ...QC_ENTRY_ACTIVE_WHERE },
      orderBy: { date: "desc" },
      take: 40,
      include: {
        production: {
          include: { workOrderLine: { include: { fgItem: true } } },
        },
      },
    });
    const recentQcRejections = recentQcRejectionsRaw.filter((q) => Number(q.rejectedQty) > 0).slice(0, 8);

    const salesOrders = await prisma.salesOrder.findMany({
      include: { dispatch: true, lines: { include: { item: true } } },
    });

    /**
     * Dashboard KPI definition:
     *
     * NO_QTY: matches Dispatch page QC-backed compulsory pending (not min(capRemaining, usableStock) alone):
     * count when cycle QC-accepted qty still exceeds operational net dispatch for the cycle.
     *
     * NORMAL (Regular SO): **excluded** — usable stock must not increase Dispatch prep; no counting from
     * min(SO pending, usable FG).
     *
     * REPLACEMENT: lines with positive replacement dispatch headroom (return-QC pool), same operational rule as before.
     */
    let pendingDispatchCount = 0;
    let pendingDispatchableQty = 0;

    // Regular/Replacement dispatchability uses the same helper as the Dispatch page.
    const qcAcceptedMap = await buildQcAcceptedMap(prisma);
    const replacementQcGrossBySoItem = await buildReplacementReturnQcGrossBySoItemKey(prisma, salesOrders, qcAcceptedMap);

    // NO_QTY: preload latest LOCKED caps per (soId, cycleId).
    const noQtySos = salesOrders.filter((so) => so.orderType === "NO_QTY" && normalizePositiveCycleId(so.currentCycleId) != null);
    const noQtySoIds = noQtySos.map((so) => so.id);
    const noQtyCycleIds = [...new Set(noQtySos.map((so) => normalizePositiveCycleId(so.currentCycleId)).filter((x) => x != null))];
    const noQtyCapBySoCycleKey = new Map();
    if (noQtySoIds.length && noQtyCycleIds.length) {
      const lockedSheets = await prisma.requirementSheet.findMany({
        where: {
          salesOrderId: { in: noQtySoIds },
          cycleId: { in: noQtyCycleIds },
          status: "LOCKED",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { lines: true },
      });
      for (const sh of lockedSheets) {
        const k = `${sh.salesOrderId}:${Number(sh.cycleId)}`;
        if (noQtyCapBySoCycleKey.has(k)) continue; // already took latest
        const capsByItemId = new Map();
        for (const ln of sh.lines || []) {
          const cap = Math.max(Number(ln.suggestedWoQtySnapshot ?? 0), Number(ln.requirementQty ?? 0));
          if (!(cap > REPORT_QUEUE_EPS)) continue;
          capsByItemId.set(ln.itemId, cap);
        }
        noQtyCapBySoCycleKey.set(k, capsByItemId);
      }
    }

    /** @type {Map<string, number>} */
    let noQtyCycleQcAcceptedMap = new Map();
    if (noQtySos.length) {
      noQtyCycleQcAcceptedMap = await loadNoQtyCycleQcAcceptedMap(
        prisma,
        noQtySos.map((so) => ({ id: so.id, currentCycleId: normalizePositiveCycleId(so.currentCycleId) })),
      );
    }

    for (const so of salesOrders) {
      // NO_QTY: dispatch pending is NOT shortage. Count only what can ship now:
      // min(current RS qty, usable FG stock).
      if (so.orderType === "NO_QTY") {
        const effCycleId = normalizePositiveCycleId(so.currentCycleId);
        if (effCycleId == null) continue;
        const capKey = `${so.id}:${effCycleId}`;
        const capsByItemId = noQtyCapBySoCycleKey.get(capKey);
        if (!capsByItemId) continue;

        const dispatchInCycle = (so.dispatch || []).filter((d) => normalizePositiveCycleId(d.cycleId) === effCycleId);
        const alreadyOpNetByItemId = netDispatchedByItemId(dispatchInCycle, DISPATCH_ALLOC_MODE.OPERATIONAL);

        for (const ln of so.lines || []) {
          const cap = Number(capsByItemId.get(ln.itemId) ?? 0);
          if (!(cap > REPORT_QUEUE_EPS)) continue;
          const already = Number(alreadyOpNetByItemId.get(ln.itemId) ?? 0);
          const usable = Math.max(0, Number(stockByItemId.get(ln.itemId) ?? 0));
          const compulsoryDispatchNow = Math.max(0, Math.min(cap, usable));
          if (compulsoryDispatchNow > REPORT_QUEUE_EPS) {
            pendingDispatchCount += 1;
            pendingDispatchableQty += compulsoryDispatchNow;
          }
        }
        continue;
      }

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

    return res.json({
      rmStockAlert,
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
      recentQcRejections: recentQcRejections.map((q) => ({
        id: q.id,
        date: q.date,
        itemName: q.production.workOrderLine.fgItem.itemName,
        rejectedQty: Number(q.rejectedQty),
        acceptedQty: Number(q.acceptedQty),
        lossQty: Number(q.lossQty),
        reason: q.reason,
        scrapReusable: q.scrapReusable,
      })),
      dashboardMetricHints: {
        fgStockTotalQty:
          "Sum of displayed USABLE FG qty (ledger USABLE, reversedAt null, floored at 0 per item — same display rule as Stock Summary)",
        pendingDispatchCount:
          "NO_QTY: QC-backed compulsory dispatch lines. REPLACEMENT: lines with positive dispatchable qty from return-QC rules. NORMAL: customer PO qty still pending with positive dispatchable qty (buffer excluded).",
        pendingDispatchableQty:
          "Sum of dispatchable qty on counted lines (NO_QTY + REPLACEMENT + NORMAL).",
        openEnquiries:
          "Count of enquiries in active pre-quotation states: OPEN, DRAFT, PENDING, FEASIBLE (excludes NOT_FEASIBLE, QUOTED, PO_RECEIVED, CLOSED)",
        pendingWorkOrders: "Count of work orders whose status is not COMPLETED or REJECTED (includes PENDING, IN_PROGRESS)",
        metricDefinitionsRef: METRIC_DEFINITIONS,
        metricContextLegend: METRIC_CONTEXT,
      },
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = { dashboardRouter };
