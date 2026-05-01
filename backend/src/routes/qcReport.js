/**
 * QC Report / history — production QcEntry vs customer-return rows (separate lanes; customer returns never use production).
 */
const express = require("express");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { QC_ENTRY_ACTIVE_WHERE } = require("../services/qcEntryConstants");
const { buildCustomerReturnListPayload } = require("../services/customerReturnListPayload");

const qcReportRouter = express.Router();

const ACCESS_DENIED = "Access denied.";
const roles = requireRole(["ADMIN", "QC", "SUPERVISOR", "PRODUCTION", "STORE", "SALES"], ACCESS_DENIED);

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

function productionStatusLabel(q) {
  if (q.reversedAt) return "Voided";
  const acc = Number(q.acceptedQty ?? 0);
  const rej = Number(q.rejectedQty ?? 0);
  const loss = Number(q.lossQty ?? 0);
  const eps = 1e-9;
  if (rej <= eps && loss <= eps) return "QC Completed";
  if (acc > eps && rej > eps) return "Partially Accepted";
  if (acc <= eps && rej > eps) {
    const route = q.rejectedRoute;
    if (route === "REWORK") return "Sent for Rework";
    if (route === "HOLD") return "In Hold";
    if (route === "SCRAP") return "Scrapped";
    if (route === "USABLE") return "Approved to Usable";
    return "Waiting QC";
  }
  if (loss > eps) return "QC Completed";
  return "QC Completed";
}

function splitRejectedBuckets(q) {
  const rej = Number(q.rejectedQty ?? 0);
  const route = q.rejectedRoute;
  let rework = 0;
  let hold = 0;
  let scrap = 0;
  if (rej > 0 && route === "REWORK") rework = rej;
  else if (rej > 0 && route === "HOLD") hold = rej;
  else if (rej > 0 && route === "SCRAP") scrap = rej;
  else if (rej > 0) {
    rework = 0;
    hold = 0;
    scrap = 0;
  }
  const loss = Number(q.lossQty ?? 0);
  scrap = roundQty(scrap + loss);
  return { reworkQty: roundQty(rework), holdQty: roundQty(hold), scrapQty: roundQty(scrap) };
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

      for (const q of prodRows) {
        const pe = q.production;
        const wol = pe?.workOrderLine;
        const wo = wol?.workOrder;
        const so = wo?.salesOrder;
        const item = wol?.fgItem;
        const acc = roundQty(Number(q.acceptedQty ?? 0));
        const rej = roundQty(Number(q.rejectedQty ?? 0));
        const loss = roundQty(Number(q.lossQty ?? 0));
        const inspected = roundQty(acc + rej + loss);
        const { reworkQty, holdQty, scrapQty } = splitRejectedBuckets(q);

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
          inputQty: inspected,
          acceptedQty: acc,
          rejectedQty: rej,
          reworkQty,
          holdQty,
          scrapQty,
          statusLabel: productionStatusLabel(q),
          isReversed: Boolean(q.reversedAt),
          dispatchableQty: null,
          detail: {
            producedQty: pe ? roundQty(Number(pe.producedQty ?? 0)) : null,
            lossQty: loss,
            reversalReason: q.reversalReason ?? null,
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
