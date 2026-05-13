const { Prisma } = require("@prisma/client");
const { getEligibleDispatches } = require("./salesBillService");

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function startOfUtcDay(d) {
  const x = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/** DB null, invalid, or epoch / pre-1971 sentinels — not a business due date. */
function effectiveDueStartUtc(raw) {
  if (raw == null) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() < 1971) return null;
  return startOfUtcDay(d);
}

function toIsoOrNull(raw) {
  if (raw == null) return null;
  if (effectiveDueStartUtc(raw) == null) return null;
  return raw instanceof Date ? raw.toISOString() : new Date(raw).toISOString();
}

/**
 * Accounts-focused dashboard — billing/export/payment snapshot (no production/QC queues).
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getAccountsDashboard(prisma) {
  const eligibleDispatches = await getEligibleDispatches(prisma);
  const billingPending = eligibleDispatches.slice(0, 40).map((d) => ({
    dispatchId: d.dispatchId,
    soId: d.salesOrderId,
    dispatchNo: d.dispatchNo,
    dispatchDate: d.dispatchDate,
    customerName: d.customerName ?? "",
    dispatchedQty: num(d.dispatchedQty),
    itemName: d.itemName ?? "",
    draftBillId: d.draftBillId ?? null,
    hasDraftBill: Boolean(d.hasDraftBill),
  }));

  const exportSalesWhere = {
    status: "FINALIZED",
    cancelledAt: null,
    isExported: false,
  };
  const exportPurchaseWhere = {
    status: "FINALIZED",
    cancelledAt: null,
    isExported: false,
  };

  const [exportSalesRows, exportPurchaseRows, exportSalesCount, exportPurchaseCount] = await Promise.all([
    prisma.salesBill.findMany({
      where: exportSalesWhere,
      select: {
        id: true,
        docNo: true,
        billNo: true,
        billDate: true,
        netAmount: true,
        customerNameSnapshot: true,
      },
      orderBy: [{ billDate: "desc" }, { id: "desc" }],
      take: 25,
    }),
    prisma.purchaseBill.findMany({
      where: exportPurchaseWhere,
      select: {
        id: true,
        billNo: true,
        billDate: true,
        netAmount: true,
        supplier: { select: { name: true } },
      },
      orderBy: [{ billDate: "desc" }, { id: "desc" }],
      take: 25,
    }),
    prisma.salesBill.count({ where: exportSalesWhere }),
    prisma.purchaseBill.count({ where: exportPurchaseWhere }),
  ]);

  const today = startOfUtcDay(new Date());

  const paymentFollowUp = await prisma.salesBill.findMany({
    where: {
      status: "FINALIZED",
      cancelledAt: null,
      pendingAmount: { gt: new Prisma.Decimal("0.0001") },
    },
    select: {
      id: true,
      docNo: true,
      billNo: true,
      billDate: true,
      dueDate: true,
      pendingAmount: true,
      paymentStatus: true,
      customerNameSnapshot: true,
    },
    orderBy: [{ dueDate: "asc" }, { billDate: "asc" }],
    take: 40,
  });

  const followUpRows = paymentFollowUp.map((r) => {
    const due = effectiveDueStartUtc(r.dueDate);
    let daysOverdue = null;
    if (due) {
      daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86400000);
    }
    return {
      id: r.id,
      customer: r.customerNameSnapshot || "—",
      billNo: r.billNo || r.docNo || `SB-${r.id}`,
      billDate: r.billDate,
      dueDate: toIsoOrNull(r.dueDate),
      pendingAmount: num(r.pendingAmount),
      daysOverdue,
      paymentStatus: r.paymentStatus,
    };
  });

  const payablesFollowUpRows = await prisma.purchaseBill.findMany({
    where: {
      status: "FINALIZED",
      cancelledAt: null,
      pendingAmount: { gt: new Prisma.Decimal("0.0001") },
    },
    select: {
      id: true,
      billNo: true,
      billDate: true,
      dueDate: true,
      pendingAmount: true,
      paymentStatus: true,
      supplier: { select: { name: true } },
    },
    orderBy: [{ dueDate: "asc" }, { billDate: "asc" }],
    take: 40,
  });

  const payablesFollowUp = payablesFollowUpRows.map((r) => {
    const due = effectiveDueStartUtc(r.dueDate);
    let daysOverdue = null;
    if (due) {
      daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86400000);
    }
    return {
      id: r.id,
      supplier: r.supplier?.name || "—",
      billNo: r.billNo?.trim() ? r.billNo : `PB-${r.id}`,
      billDate: r.billDate,
      dueDate: toIsoOrNull(r.dueDate),
      pendingAmount: num(r.pendingAmount),
      daysOverdue,
      paymentStatus: r.paymentStatus,
    };
  });

  const salesAgg = await prisma.salesBill.aggregate({
    where: { status: "FINALIZED", cancelledAt: null },
    _sum: { pendingAmount: true, netAmount: true },
  });
  const purchaseAgg = await prisma.purchaseBill.aggregate({
    where: { status: "FINALIZED", cancelledAt: null },
    _sum: { pendingAmount: true, netAmount: true },
  });

  const minBusinessDue = new Date(Date.UTC(1971, 0, 1));

  const overdueRecvAgg = await prisma.salesBill.aggregate({
    where: {
      status: "FINALIZED",
      cancelledAt: null,
      pendingAmount: { gt: new Prisma.Decimal("0.0001") },
      dueDate: { not: null, lt: today, gte: minBusinessDue },
    },
    _sum: { pendingAmount: true },
  });

  const overduePayAgg = await prisma.purchaseBill.aggregate({
    where: {
      status: "FINALIZED",
      cancelledAt: null,
      pendingAmount: { gt: new Prisma.Decimal("0.0001") },
      dueDate: { not: null, lt: today, gte: minBusinessDue },
    },
    _sum: { pendingAmount: true },
  });

  return {
    billingPending,
    exportPending: {
      salesBills: exportSalesRows.map((r) => ({
        id: r.id,
        docNo: r.docNo,
        billNo: r.billNo,
        billDate: r.billDate,
        netAmount: num(r.netAmount),
        customerName: r.customerNameSnapshot || "—",
      })),
      purchaseBills: exportPurchaseRows.map((r) => ({
        id: r.id,
        billNo: r.billNo,
        billDate: r.billDate,
        netAmount: num(r.netAmount),
        supplierName: r.supplier?.name ?? "—",
      })),
    },
    paymentFollowUp: followUpRows,
    payablesFollowUp,
    outstandingSnapshot: {
      totalReceivable: num(salesAgg._sum.pendingAmount),
      totalPayable: num(purchaseAgg._sum.pendingAmount),
      overdueReceivable: num(overdueRecvAgg._sum.pendingAmount),
      overduePayable: num(overduePayAgg._sum.pendingAmount),
    },
    stats: {
      billingPendingCount: eligibleDispatches.length,
      exportSalesCount,
      exportPurchaseCount,
    },
  };
}

module.exports = {
  getAccountsDashboard,
};
