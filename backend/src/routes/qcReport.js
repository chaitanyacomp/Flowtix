/**
 * QC Report / history — production QcEntry vs customer-return rows (separate lanes; customer returns never use production).
 */
const express = require("express");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { buildCustomerReturnListPayload } = require("../services/customerReturnListPayload");
const {
  roundQty,
  buildProductionQcLifecycleMetrics,
  productionQcLifecycleStatusLabel,
  buildReworkClearedTraceNote,
  loadProductionQcLifecycleContext,
  aggregateProductionQcSummaryToday,
} = require("../services/qcLifecycleProjection");

const { QA_REPORT_READ_ROLES } = require("../constants/erpRoles");

const qcReportRouter = express.Router();

const ACCESS_DENIED = "Access denied.";
const roles = requireRole([...QA_REPORT_READ_ROLES], ACCESS_DENIED);

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function customerReturnStatusLabel(p) {
  if (p.reversedAt) return "Reversed";
  if (p.status === "IN_REWORK") return "Waiting for Rework Approval";
  if (p.status === "IN_QC_HOLD") return "Waiting QC";
  if (p.status === "APPROVED_TO_STOCK") return "Approved for Dispatch";
  if (p.status === "SCRAPPED") return "Scrapped";
  return String(p.status ?? "—");
}

/**
 * @param {Awaited<ReturnType<typeof buildCustomerReturnListPayload>>[number]} p
 */
function customerReturnListItemToQcReportRow(p) {
  const returnQty = roundQty(Number(p.qty ?? 0));
  const qcAcc = roundQty(Number(p.qcAcceptedQty ?? 0));
  const pending = roundQty(Number(p.pendingInProcessQty ?? 0));
  const scrap = roundQty(Number(p.scrapQty ?? 0));
  const disp = roundQty(Number(p.dispatchableQty ?? 0));
  const repSoId = p.replacementSalesOrderId ?? null;
  const origSoId = p.originalSalesOrderId ?? null;
  const netDisp = roundQty(Number(p.replacementNetDispatchedQty ?? 0));

  return {
    sourceType: "CUSTOMER_RETURN",
    rowKind: "RETURN_SUMMARY",
    id: `CR-${p.id}`,
    customerReturnId: p.id,
    qcDocNo: p.returnNo,
    date: p.date,
    sourceRef: p.returnNo,
    originalSalesOrderId: origSoId,
    workOrderId: null,
    workOrderDocNo: null,
    productionEntryId: null,
    salesOrderId: repSoId ?? origSoId,
    salesOrderDocNo: p.replacementSalesOrderDocNo ?? null,
    customerId: p.customer?.id ?? null,
    customerName: p.customer?.name ?? null,
    itemId: p.item?.id ?? null,
    itemName: p.item?.name ?? "—",
    inputQty: returnQty,
    acceptedQty: qcAcc,
    rejectedQty: 0,
    reworkQty: pending,
    holdQty: 0,
    scrapQty: scrap,
    statusLabel: customerReturnStatusLabel(p),
    isReversed: Boolean(p.reversedAt),
    dispatchableQty: disp,
    stockAdjustmentQcEntryId: null,
    detail: {
      disposition: p.disposition,
      dispatchNo: p.dispatchNo,
      returnBreakdown: {
        returnQty,
        qcPassedTotal: qcAcc,
        pendingInProcess: pending,
        scrapQty: scrap,
        dispatchableNow: disp,
        alreadyDispatched: netDisp,
        replacementSalesOrderId: p.replacementSalesOrderId ?? null,
        replacementSalesOrderDocNo: p.replacementSalesOrderDocNo ?? null,
        originalSalesOrderId: origSoId,
      },
    },
  };
}

/**
 * GET /api/qc/report
 * Query: dateFrom, dateTo, sourceType (ALL|PRODUCTION|CUSTOMER_RETURN), customerId, itemId, status (ALL|ACTIVE|REVERSED), search
 */
qcReportRouter.get("/report", requireAuth, roles, async (req, res, next) => {
  try {
    const toRaw = req.query.dateTo ? new Date(String(req.query.dateTo)) : new Date();
    const fromRaw = req.query.dateFrom
      ? new Date(String(req.query.dateFrom))
      : new Date(toRaw.getTime() - 90 * 86400000);
    const dateFrom = startOfDay(fromRaw);
    const dateTo = endOfDay(toRaw);

    const sourceType = String(req.query.sourceType || "ALL").toUpperCase();
    const customerId = Number(req.query.customerId);
    const itemId = Number(req.query.itemId);
    const statusFilter = String(req.query.status || "ALL").toUpperCase();
    const search = String(req.query.search || "")
      .trim()
      .toLowerCase();

    const statusWhere =
      statusFilter === "ACTIVE" ? { reversedAt: null } : statusFilter === "REVERSED" ? { reversedAt: { not: null } } : {};

    /** @type {any[]} */
    const rows = [];
    let customerReturnDispatchableSumForSummary = 0;

    if (sourceType === "ALL" || sourceType === "PRODUCTION") {
      const prodWhere = {
        date: { gte: dateFrom, lte: dateTo },
        ...statusWhere,
        ...(Number.isFinite(itemId) && itemId > 0
          ? { production: { workOrderLine: { fgItemId: itemId } } }
          : {}),
        ...(Number.isFinite(customerId) && customerId > 0
          ? { production: { workOrderLine: { workOrder: { salesOrder: { customerId } } } } }
          : {}),
      };

      const prodRows = await prisma.qcEntry.findMany({
        where: prodWhere,
        orderBy: { date: "desc" },
        take: 1500,
        include: {
          production: {
            include: {
              workOrderLine: {
                include: {
                  workOrder: { include: { salesOrder: { include: { customer: true } } } },
                  fgItem: true,
                },
              },
            },
          },
        },
      });

      const qcEntryIds = prodRows.map((q) => q.id);
      const reportCtx = await loadProductionQcLifecycleContext(prisma, qcEntryIds);

      for (const q of prodRows) {
        const pe = q.production;
        const wol = pe?.workOrderLine;
        const wo = wol?.workOrder;
        const so = wo?.salesOrder;
        const item = wol?.fgItem;
        const entryDispositions = reportCtx.dispositionsByQcEntryId.get(q.id) ?? [];
        const scrapParts = reportCtx.scrapPartsByQcEntryId.get(q.id) ?? {
          directScrapQty: 0,
          reworkFinalScrapQty: 0,
        };
        const metrics = buildProductionQcLifecycleMetrics(
          q,
          entryDispositions,
          reportCtx.dispositionHints,
          reportCtx.recheckAcceptedByDispId,
          scrapParts,
        );
        const lifecycleNote = buildReworkClearedTraceNote(metrics);

        const row = {
          sourceType: "PRODUCTION",
          id: `PE-QC-${q.id}`,
          qcEntryId: q.id,
          qcDocNo: q.docNo,
          date: q.date,
          sourceRef: pe?.docNo ? String(pe.docNo) : `PE #${pe?.id ?? "—"}`,
          workOrderId: wo?.id ?? null,
          workOrderDocNo: wo?.docNo ?? null,
          productionEntryId: pe?.id ?? null,
          salesOrderId: so?.id ?? null,
          salesOrderDocNo: so?.docNo ?? null,
          salesOrderType: so?.orderType ?? null,
          customerId: so?.customerId ?? null,
          customerName: so?.customer?.name ?? null,
          itemId: item?.id ?? wol?.fgItemId ?? null,
          itemName: item?.itemName ?? "—",
          uom: item?.unit ?? null,
          inputQty: metrics.inspectedQty,
          /** Final usable (first-pass + rework accepted) */
          acceptedQty: metrics.finalUsableQty,
          firstPassAcceptedQty: metrics.firstPassAcceptedQty,
          initialAcceptedQty: metrics.initialAcceptedQty,
          /** First-pass reject posting — not remaining unusable */
          rejectedQty: metrics.initialRejectedQty,
          initialRejectedQty: metrics.initialRejectedQty,
          reworkQty: metrics.reworkRoutedQty,
          reworkAcceptedQty: metrics.reworkAcceptedQty,
          reworkPendingQty: metrics.pendingReworkQty,
          holdQty: metrics.holdQty,
          scrapQty: metrics.totalScrapQty,
          finalUsableQty: metrics.finalUsableQty,
          finalUnusableQty: metrics.finalUnusableQty,
          statusLabel: productionQcLifecycleStatusLabel(q, metrics),
          isReversed: Boolean(q.reversedAt),
          dispatchableQty: null,
          // Batch 3F — recovery columns filled post-build. finalRejectedQty = terminal unusable only.
          finalRejectedQty: metrics.finalUnusableQty,
          recoveryCreatedQty: null,
          recoveryAllocatedQty: null,
          recoveryPendingQty: null,
          recoveryWaivedQty: null,
          recoverySourceStatus: null,
          recoveryOriginCycleId: null,
          recoveryAgeDays: null,
          detail: {
            producedQty: pe ? roundQty(Number(pe.producedQty ?? 0)) : null,
            lossQty: metrics.lossQty,
            reversalReason: q.reversalReason ?? null,
            inspectedQty: metrics.inspectedQty,
            initialAcceptedQty: metrics.initialAcceptedQty,
            firstPassAcceptedQty: metrics.firstPassAcceptedQty,
            initialRejectedQty: metrics.initialRejectedQty,
            reworkRoutedQty: metrics.reworkRoutedQty,
            reworkAcceptedQty: metrics.reworkAcceptedQty,
            reworkPendingQty: metrics.pendingReworkQty,
            holdQty: metrics.holdQty,
            scrapQty: metrics.totalScrapQty,
            directScrapQty: metrics.directScrapQty,
            reworkFinalScrapQty: metrics.reworkFinalScrapQty,
            finalUsableQty: metrics.finalUsableQty,
            finalUnusableQty: metrics.finalUnusableQty,
            lifecycleNote,
          },
        };

        if (search) {
          const hay = [
            row.qcDocNo,
            String(row.qcEntryId),
            row.sourceRef,
            String(row.workOrderId ?? ""),
            row.workOrderDocNo,
            String(row.salesOrderId ?? ""),
            row.salesOrderDocNo,
            row.itemName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(search) && !hay.includes(search.replace(/^so-?/i, ""))) continue;
        }
        rows.push(row);
      }
    }

    if (sourceType === "ALL" || sourceType === "CUSTOMER_RETURN") {
      const crStatusWhere =
        statusFilter === "ACTIVE" ? { reversedAt: null } : statusFilter === "REVERSED" ? { reversedAt: { not: null } } : {};

      const crWhere = {
        returnDate: { gte: dateFrom, lte: dateTo },
        ...crStatusWhere,
        ...(Number.isFinite(itemId) && itemId > 0 ? { itemId } : {}),
        ...(Number.isFinite(customerId) && customerId > 0 ? { customerId } : {}),
      };

      const crRows = await prisma.customerReturn.findMany({
        where: crWhere,
        orderBy: { id: "desc" },
        take: 1500,
        include: {
          customer: true,
          item: true,
          dispatch: true,
        },
      });

      const listPayload = await buildCustomerReturnListPayload(prisma, crRows);

      for (const p of listPayload) {
        const row = customerReturnListItemToQcReportRow(p);

        if (search) {
          const hay = [
            row.sourceRef,
            String(row.customerReturnId ?? ""),
            row.itemName,
            row.customerName,
            row.detail?.dispatchNo,
            String(row.originalSalesOrderId ?? ""),
            String(row.salesOrderId ?? ""),
            row.salesOrderDocNo,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(search) && !hay.includes(search.replace(/^ret-?/i, ""))) continue;
        }
        customerReturnDispatchableSumForSummary += Number(row.dispatchableQty ?? 0);
        rows.push(row);
      }
    }

    rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Batch 3F — attach NO_QTY QC recovery fields (read-only; does not alter QC metrics).
    const noQtySoIds = [
      ...new Set(
        rows
          .filter((r) => r.sourceType === "PRODUCTION" && r.salesOrderType === "NO_QTY" && Number(r.salesOrderId) > 0)
          .map((r) => Number(r.salesOrderId)),
      ),
    ];
    if (noQtySoIds.length > 0) {
      const { enrichSalesOrdersWithRecoveryClosure } = require("../services/noQtyRecoveryAnalyticsService");
      const recoveryBySo = await enrichSalesOrdersWithRecoveryClosure(prisma, noQtySoIds);
      const now = Date.now();
      for (const row of rows) {
        if (row.sourceType !== "PRODUCTION" || row.salesOrderType !== "NO_QTY") continue;
        const recovery = recoveryBySo.get(Number(row.salesOrderId));
        if (!recovery) continue;
        const itemSources = (recovery.recoverySummary?.sources || []).filter(
          (s) =>
            Number(s.itemId) === Number(row.itemId) &&
            s.recoveryType === "QC_FINAL_REJECTION" &&
            s.recoveryStatus !== "CANCELLED",
        );
        if (!itemSources.length) continue;
        let created = 0;
        let allocated = 0;
        let pending = 0;
        let waived = 0;
        let oldestCreatedAt = null;
        for (const s of itemSources) {
          created += Number(s.sourceQty || 0);
          allocated += Number(s.activeAllocatedQty || 0);
          pending += Number(s.availableQty || 0);
          waived += Number(s.waivedQty || 0);
          if (s.createdAt) {
            const t = new Date(s.createdAt).getTime();
            if (!oldestCreatedAt || t < oldestCreatedAt) oldestCreatedAt = t;
          }
        }
        row.recoveryCreatedQty = roundQty(created);
        row.recoveryAllocatedQty = roundQty(allocated);
        row.recoveryPendingQty = roundQty(pending);
        row.recoveryWaivedQty = roundQty(waived);
        row.recoverySourceStatus = itemSources[0]?.recoveryStatus ?? null;
        row.recoveryOriginCycleId = itemSources[0]?.cycleId ?? null;
        row.recoveryAgeDays =
          oldestCreatedAt != null ? Math.max(0, Math.floor((now - oldestCreatedAt) / 86400000)) : null;
        if (!row.uom && itemSources[0]?.uom) row.uom = itemSources[0].uom;
      }
    }

    const customerReturnDispatchableSum = roundQty(customerReturnDispatchableSumForSummary);

    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    const [prodSummaryToday, sumAdjAcc, sumAdjRej, reworkPending] = await Promise.all([
      aggregateProductionQcSummaryToday(prisma, todayStart, todayEnd),
      prisma.stockAdjustmentQcEntry.aggregate({
        where: {
          reversedAt: null,
          date: { gte: todayStart, lte: todayEnd },
          salesOrder: { orderType: "REPLACEMENT", customerReturnId: { not: null } },
        },
        _sum: { acceptedQty: true },
      }),
      prisma.stockAdjustmentQcEntry.aggregate({
        where: {
          reversedAt: null,
          date: { gte: todayStart, lte: todayEnd },
          salesOrder: { orderType: "REPLACEMENT", customerReturnId: { not: null } },
        },
        _sum: { rejectedQty: true },
      }),
      prisma.qcRejectedDisposition.count({
        where: {
          voidedAt: null,
          status: {
            in: [
              "REWORK_PENDING_SUPERVISOR",
              "REWORK_APPROVED_PENDING_EXECUTION",
              "REWORK_READY_FOR_QC",
              "HOLD",
            ],
          },
        },
      }),
    ]);

    const summaries = {
      productionQcAcceptedToday: prodSummaryToday.finalUsableAcceptedToday,
      productionQcRejectedToday: prodSummaryToday.initialRejectedToday,
      productionFinalUsableAcceptedToday: prodSummaryToday.finalUsableAcceptedToday,
      productionFirstPassAcceptedToday: prodSummaryToday.firstPassAcceptedToday,
      productionInitialRejectedToday: prodSummaryToday.initialRejectedToday,
      productionReworkAcceptedToday: prodSummaryToday.reworkAcceptedToday,
      productionFinalUnusableToday: prodSummaryToday.finalUnusableToday,
      customerReturnQcAcceptedToday: roundQty(Number(sumAdjAcc._sum.acceptedQty ?? 0)),
      customerReturnQcRejectedToday: roundQty(Number(sumAdjRej._sum.rejectedQty ?? 0)),
      reworkPendingDispositions: reworkPending,
      rowsInRange: rows.length,
      customerReturnDispatchableSum: roundQty(customerReturnDispatchableSum),
    };

    return res.json({ summaries, rows });
  } catch (e) {
    return next(e);
  }
});

module.exports = {
  qcReportRouter,
  ACCESS_DENIED: ACCESS_DENIED,
  buildProductionQcReportMetrics: buildProductionQcLifecycleMetrics,
  productionStatusLabel: productionQcLifecycleStatusLabel,
};
