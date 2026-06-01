/**
 * QC Report / history — production QcEntry vs customer-return rows (separate lanes; customer returns never use production).
 */
const express = require("express");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { QC_ENTRY_ACTIVE_WHERE } = require("../services/qcEntryConstants");
const { buildCustomerReturnListPayload } = require("../services/customerReturnListPayload");

const { QA_REPORT_READ_ROLES } = require("../constants/erpRoles");

const qcReportRouter = express.Router();

const ACCESS_DENIED = "Access denied.";
const roles = requireRole([...QA_REPORT_READ_ROLES], ACCESS_DENIED);

function roundQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

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

const REWORK_DISPOSITION_STATUSES = new Set([
  "REWORK_PENDING_SUPERVISOR",
  "REWORK_APPROVED_PENDING_EXECUTION",
  "REWORK_READY_FOR_QC",
]);

/** @param {string} status */
function isReworkDispositionStatus(status) {
  return REWORK_DISPOSITION_STATUSES.has(String(status ?? ""));
}

/**
 * Classify disposition bucket for reporting (handles CLOSED rows).
 * @param {{ id: number; status: string }} d
 * @param {{ reworkDispIds: Set<number>; holdDispIds: Set<number> }} hints
 */
function dispositionReportBucket(d, hints) {
  const status = String(d.status ?? "");
  if (status === "SCRAP") return "scrap";
  if (status === "HOLD") return "hold";
  if (isReworkDispositionStatus(status)) return "rework";
  if (status === "CLOSED") {
    if (hints.reworkDispIds.has(d.id)) return "rework";
    if (hints.holdDispIds.has(d.id)) return "hold";
  }
  return "rework";
}

/**
 * Legacy single-route rows (no disposition children).
 * @param {import("@prisma/client").QcEntry} q
 */
function splitRejectedBucketsLegacy(q) {
  const rej = Number(q.rejectedQty ?? 0);
  const route = q.rejectedRoute;
  const loss = Number(q.lossQty ?? 0);
  let rework = 0;
  let hold = 0;
  let scrap = 0;
  if (rej > 0 && route === "REWORK") rework = rej;
  else if (rej > 0 && route === "HOLD") hold = rej;
  else if (rej > 0 && route === "SCRAP") scrap = rej;
  else if (loss > 0) scrap = loss;
  return { reworkQty: roundQty(rework), holdQty: roundQty(hold), scrapQty: roundQty(scrap) };
}

/**
 * @param {import("@prisma/client").QcEntry} q
 * @param {import("@prisma/client").QcRejectedDisposition[]} dispositions
 * @param {{ reworkDispIds: Set<number>; holdDispIds: Set<number> }} hints
 * @param {Map<number, number>} recheckAcceptedByDispId
 * @param {{ directScrapQty: number; reworkFinalScrapQty: number }} scrapParts
 */
function buildProductionQcReportMetrics(q, dispositions, hints, recheckAcceptedByDispId, scrapParts) {
  const initialAcceptedQty = roundQty(Number(q.acceptedQty ?? 0));
  const rejectedQty = roundQty(Number(q.rejectedQty ?? 0));
  const lossQty = roundQty(Number(q.lossQty ?? 0));
  const inspectedQty = roundQty(initialAcceptedQty + rejectedQty);

  let reworkQty = 0;
  let holdQty = 0;
  let directScrapQty = 0;
  let pendingReworkQty = 0;

  if (dispositions.length > 0) {
    for (const d of dispositions) {
      const qty = roundQty(Number(d.qty ?? 0));
      const remaining = roundQty(Number(d.remainingQty ?? 0));
      const bucket = dispositionReportBucket(d, hints);
      if (bucket === "rework") {
        reworkQty = roundQty(reworkQty + qty);
        pendingReworkQty = roundQty(pendingReworkQty + remaining);
      } else if (bucket === "hold") {
        holdQty = roundQty(holdQty + qty);
      } else if (bucket === "scrap") {
        directScrapQty = roundQty(directScrapQty + qty);
      }
    }
  } else {
    const legacy = splitRejectedBucketsLegacy(q);
    reworkQty = legacy.reworkQty;
    holdQty = legacy.holdQty;
    directScrapQty = legacy.scrapQty;
    if (directScrapQty <= 0 && scrapParts.directScrapQty > 0) {
      directScrapQty = scrapParts.directScrapQty;
    }
    if (directScrapQty <= 0 && lossQty > 0) {
      directScrapQty = lossQty;
    }
  }

  let reworkAcceptedQty = 0;
  for (const d of dispositions) {
    if (dispositionReportBucket(d, hints) !== "rework") continue;
    reworkAcceptedQty = roundQty(reworkAcceptedQty + (recheckAcceptedByDispId.get(d.id) ?? 0));
  }

  const reworkFinalScrapQty = roundQty(scrapParts.reworkFinalScrapQty);
  const totalScrapQty = roundQty(directScrapQty + reworkFinalScrapQty);
  const finalUsableQty = roundQty(initialAcceptedQty + reworkAcceptedQty);

  return {
    inspectedQty,
    initialAcceptedQty,
    rejectedQty,
    reworkQty,
    holdQty,
    directScrapQty,
    reworkFinalScrapQty,
    totalScrapQty,
    reworkAcceptedQty,
    finalUsableQty,
    pendingReworkQty,
    lossQty,
  };
}

/**
 * @param {import("@prisma/client").QcEntry} q
 * @param {ReturnType<typeof buildProductionQcReportMetrics>} metrics
 */
function productionStatusLabel(q, metrics) {
  if (q.reversedAt) return "Voided";
  const eps = 1e-9;
  const {
    initialAcceptedQty: acc,
    rejectedQty: rej,
    reworkQty,
    reworkAcceptedQty,
    pendingReworkQty,
    totalScrapQty,
    holdQty,
  } = metrics;

  if (reworkQty > eps) {
    if (pendingReworkQty > eps) return "Rework Pending";
    if (reworkAcceptedQty > eps || totalScrapQty > metrics.directScrapQty + eps) return "Disposition Completed";
    return "Sent for Rework";
  }
  if (holdQty > eps && pendingReworkQty <= eps) return "In Hold";
  if (rej <= eps && totalScrapQty <= eps) return "QC Completed";
  if (acc > eps && rej > eps) return "Partially Accepted";
  if (acc <= eps && rej > eps) {
    const route = q.rejectedRoute;
    if (route === "REWORK") return "Sent for Rework";
    if (route === "HOLD") return "In Hold";
    if (route === "SCRAP") return "Scrapped";
    if (route === "USABLE") return "Approved to Usable";
    return "Waiting QC";
  }
  if (totalScrapQty > eps) return "QC Completed";
  return "QC Completed";
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number[]} qcEntryIds
 */
async function loadProductionQcReportContext(prisma, qcEntryIds) {
  if (!qcEntryIds.length) {
    return {
      dispositionsByQcEntryId: new Map(),
      recheckAcceptedByDispId: new Map(),
      scrapPartsByQcEntryId: new Map(),
      dispositionHints: { reworkDispIds: new Set(), holdDispIds: new Set() },
    };
  }

  const dispositions = await prisma.qcRejectedDisposition.findMany({
    where: { sourceQcEntryId: { in: qcEntryIds }, voidedAt: null },
    select: {
      id: true,
      sourceQcEntryId: true,
      status: true,
      qty: true,
      remainingQty: true,
    },
  });

  const dispIds = dispositions.map((d) => d.id);
  const dispositionsByQcEntryId = new Map();
  for (const d of dispositions) {
    const list = dispositionsByQcEntryId.get(d.sourceQcEntryId) ?? [];
    list.push(d);
    dispositionsByQcEntryId.set(d.sourceQcEntryId, list);
  }

  /** @type {{ reworkDispIds: Set<number>; holdDispIds: Set<number> }} */
  const dispositionHints = { reworkDispIds: new Set(), holdDispIds: new Set() };
  const recheckAcceptedByDispId = new Map();
  /** @type {Map<number, { directScrapQty: number; reworkFinalScrapQty: number }>} */
  const scrapPartsByQcEntryId = new Map();

  for (const id of qcEntryIds) {
    scrapPartsByQcEntryId.set(id, { directScrapQty: 0, reworkFinalScrapQty: 0 });
  }

  if (dispIds.length > 0) {
    const stockTxns = await prisma.stockTransaction.findMany({
      where: {
        qcRejectedDispositionId: { in: dispIds },
        reversedAt: null,
      },
      select: {
        qcRejectedDispositionId: true,
        stockBucket: true,
        transactionType: true,
        qtyIn: true,
        refId: true,
      },
    });

    for (const t of stockTxns) {
      const dispId = Number(t.qcRejectedDispositionId);
      if (!Number.isFinite(dispId) || dispId <= 0) continue;
      const qtyIn = Number(t.qtyIn ?? 0);
      if (t.stockBucket === "REWORK" && qtyIn > 0) dispositionHints.reworkDispIds.add(dispId);
      if (t.stockBucket === "QC_HOLD" && qtyIn > 0) dispositionHints.holdDispIds.add(dispId);
      if (
        t.transactionType === "BUCKET_TRANSFER" &&
        t.stockBucket === "USABLE" &&
        qtyIn > 0 &&
        Number(t.refId) === dispId
      ) {
        recheckAcceptedByDispId.set(dispId, roundQty((recheckAcceptedByDispId.get(dispId) ?? 0) + qtyIn));
      }
    }
  }

  const scrapRecords = await prisma.scrapRecord.findMany({
    where: { qcEntryId: { in: qcEntryIds } },
    select: { qcEntryId: true, rejectedQty: true, reason: true },
  });

  for (const sr of scrapRecords) {
    const qcId = Number(sr.qcEntryId);
    if (!Number.isFinite(qcId) || qcId <= 0) continue;
    const parts = scrapPartsByQcEntryId.get(qcId) ?? { directScrapQty: 0, reworkFinalScrapQty: 0 };
    const qty = roundQty(Number(sr.rejectedQty ?? 0));
    const reason = String(sr.reason ?? "");
    if (reason.includes("Rework final QC")) {
      parts.reworkFinalScrapQty = roundQty(parts.reworkFinalScrapQty + qty);
    } else {
      parts.directScrapQty = roundQty(parts.directScrapQty + qty);
    }
    scrapPartsByQcEntryId.set(qcId, parts);
  }

  return { dispositionsByQcEntryId, recheckAcceptedByDispId, scrapPartsByQcEntryId, dispositionHints };
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
      const reportCtx = await loadProductionQcReportContext(prisma, qcEntryIds);

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
        const metrics = buildProductionQcReportMetrics(
          q,
          entryDispositions,
          reportCtx.dispositionHints,
          reportCtx.recheckAcceptedByDispId,
          scrapParts,
        );

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
          customerId: so?.customerId ?? null,
          customerName: so?.customer?.name ?? null,
          itemId: item?.id ?? wol?.fgItemId ?? null,
          itemName: item?.itemName ?? "—",
          inputQty: metrics.inspectedQty,
          acceptedQty: metrics.finalUsableQty,
          rejectedQty: metrics.rejectedQty,
          reworkQty: metrics.reworkQty,
          holdQty: metrics.holdQty,
          scrapQty: metrics.totalScrapQty,
          statusLabel: productionStatusLabel(q, metrics),
          isReversed: Boolean(q.reversedAt),
          dispatchableQty: null,
          detail: {
            producedQty: pe ? roundQty(Number(pe.producedQty ?? 0)) : null,
            lossQty: metrics.lossQty,
            reversalReason: q.reversalReason ?? null,
            initialAcceptedQty: metrics.initialAcceptedQty,
            reworkAcceptedQty: metrics.reworkAcceptedQty,
            finalUsableQty: metrics.finalUsableQty,
            directScrapQty: metrics.directScrapQty,
            reworkFinalScrapQty: metrics.reworkFinalScrapQty,
            inspectedQty: metrics.inspectedQty,
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

    const customerReturnDispatchableSum = roundQty(customerReturnDispatchableSumForSummary);

    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    const [sumProdAcc, sumProdRej, sumAdjAcc, sumAdjRej, reworkPending] = await Promise.all([
      prisma.qcEntry.aggregate({
        where: { ...QC_ENTRY_ACTIVE_WHERE, date: { gte: todayStart, lte: todayEnd } },
        _sum: { acceptedQty: true },
      }),
      prisma.qcEntry.aggregate({
        where: { ...QC_ENTRY_ACTIVE_WHERE, date: { gte: todayStart, lte: todayEnd } },
        _sum: { rejectedQty: true },
      }),
      prisma.stockAdjustmentQcEntry.aggregate({
        where: { reversedAt: null, date: { gte: todayStart, lte: todayEnd }, salesOrder: { orderType: "REPLACEMENT", customerReturnId: { not: null } } },
        _sum: { acceptedQty: true },
      }),
      prisma.stockAdjustmentQcEntry.aggregate({
        where: { reversedAt: null, date: { gte: todayStart, lte: todayEnd }, salesOrder: { orderType: "REPLACEMENT", customerReturnId: { not: null } } },
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
      productionQcAcceptedToday: roundQty(Number(sumProdAcc._sum.acceptedQty ?? 0)),
      productionQcRejectedToday: roundQty(Number(sumProdRej._sum.rejectedQty ?? 0)),
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

module.exports = { qcReportRouter, ACCESS_DENIED: ACCESS_DENIED };
