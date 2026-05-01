const { prisma } = require("../utils/prisma");

function isNonEmptyStr(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Export history based on SalesBill export fields (audit view).
 * Only includes bills with isExported=true.
 */
async function listExportHistory(params = {}) {
  const { from, to, customerName, q } = params || {};

  const dateFilter = {};
  if (from) dateFilter.gte = from;
  if (to) dateFilter.lte = to;

  const search = isNonEmptyStr(q) ? q.trim() : "";

  const rows = await prisma.salesBill.findMany({
    where: {
      isExported: true,
      ...(from || to ? { exportedAt: dateFilter } : {}),
      ...(isNonEmptyStr(customerName)
        ? {
            OR: [
              { customer: { name: customerName.trim() } },
              { customerNameSnapshot: customerName.trim() },
            ],
          }
        : {}),
      ...(search
        ? {
            OR: [
              { billNo: { contains: search } },
              { exportedFileName: { contains: search } },
              { customerNameSnapshot: { contains: search } },
              { customer: { name: { contains: search } } },
            ],
          }
        : {}),
    },
    include: {
      customer: true,
      dispatch: true,
      exportedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ exportedAt: "desc" }, { id: "desc" }],
    take: 2000,
  });

  return rows.map((b) => ({
    id: b.id,
    dispatchId: b.dispatchId,
    customerName: b.customer?.name ?? b.customerNameSnapshot ?? "—",
    voucherNo: b.billNo ?? `SB-${b.id}`,
    fileName: b.exportedFileName ?? `sales-bill-SB-${b.id}.xml`,
    exportedAt: b.exportedAt,
    exportedBy: b.exportedBy?.name ?? null,
  }));
}

module.exports = { listExportHistory };

