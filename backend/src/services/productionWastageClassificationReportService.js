const { prisma } = require("../utils/prisma");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");
const { mapWastageDetailRows } = require("./productionWastageClassificationService");

function n(v) {
  return qtyToNumber(v);
}

/**
 * Reporting foundation — aggregated production report wastage classification rows.
 * Supports item / customer / operator / trend / Pareto slices via query filters.
 */
async function buildProductionWastageClassificationReport(db = prisma, filters = {}) {
  const from = filters.fromDate ? new Date(filters.fromDate) : null;
  const to = filters.toDate ? new Date(filters.toDate) : null;
  const itemId = filters.itemId != null ? Number(filters.itemId) : null;
  const customerId = filters.customerId != null ? Number(filters.customerId) : null;
  const wastageTypeId = filters.wastageTypeId != null ? Number(filters.wastageTypeId) : null;

  const rows = await db.productionWorkOrderReportWastageDetail.findMany({
    where: {
      ...(wastageTypeId > 0 ? { wastageTypeId } : {}),
      productionReport: {
        status: "CONFIRMED",
        ...(from || to
          ? {
              confirmedAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
        workOrder: {
          ...(customerId > 0 ? { salesOrder: { customerId } } : {}),
        },
        ...(itemId > 0
          ? {
              lines: { some: { itemId } },
            }
          : {}),
      },
    },
    include: {
      wastageType: { select: { id: true, name: true } },
      productionReport: {
        select: {
          id: true,
          confirmedAt: true,
          workOrderId: true,
          workOrder: {
            select: {
              id: true,
              docNo: true,
              salesOrder: {
                select: {
                  id: true,
                  docNo: true,
                  customer: { select: { id: true, name: true } },
                },
              },
              lines: {
                select: {
                  fgItem: { select: { id: true, itemName: true } },
                },
                take: 1,
              },
            },
          },
          lines: { select: { itemId: true, item: { select: { itemName: true, unit: true } } } },
        },
      },
    },
    orderBy: [{ productionReport: { confirmedAt: "desc" } }, { sortOrder: "asc" }, { id: "asc" }],
  });

  const detailRows = rows.map((row) => {
    const report = row.productionReport;
    const wo = report?.workOrder;
    const fg = wo?.lines?.[0]?.fgItem ?? null;
    const rmLines = report?.lines ?? [];
    const totalWastageQty = round3(rmLines.reduce((acc, ln) => acc + Math.max(0, n(ln.scrapWasteQty)), 0));
    return {
      id: row.id,
      reportId: report?.id ?? null,
      confirmedAt: report?.confirmedAt ?? null,
      workOrderId: wo?.id ?? null,
      workOrderNo: wo?.docNo ?? null,
      salesOrderId: wo?.salesOrder?.id ?? null,
      salesOrderNo: wo?.salesOrder?.docNo ?? null,
      customerId: wo?.salesOrder?.customer?.id ?? null,
      customerName: wo?.salesOrder?.customer?.name ?? null,
      fgItemId: fg?.id ?? null,
      fgItemName: fg?.itemName ?? null,
      wastageTypeId: row.wastageTypeId,
      wastageTypeName: row.wastageType?.name ?? null,
      qty: round3(n(row.qty)),
      remarks: row.remarks ?? null,
      reportTotalWastageQty: totalWastageQty,
      rmItems: rmLines.map((ln) => ({
        itemId: ln.itemId,
        itemName: ln.item?.itemName ?? null,
        unit: ln.item?.unit ?? null,
        totalWastageQty: round3(Math.max(0, n(ln.scrapWasteQty))),
      })),
    };
  });

  const byReason = new Map();
  for (const row of detailRows) {
    const key = row.wastageTypeId;
    const prev = byReason.get(key) ?? {
      wastageTypeId: row.wastageTypeId,
      wastageTypeName: row.wastageTypeName,
      qty: 0,
      reportCount: 0,
      _reports: new Set(),
    };
    prev.qty = round3(prev.qty + row.qty);
    prev._reports.add(row.reportId);
    byReason.set(key, prev);
  }
  const pareto = [...byReason.values()]
    .map((row) => ({
      wastageTypeId: row.wastageTypeId,
      wastageTypeName: row.wastageTypeName,
      qty: row.qty,
      reportCount: row._reports.size,
    }))
    .sort((a, b) => b.qty - a.qty);

  const totalQty = round3(detailRows.reduce((acc, row) => acc + row.qty, 0));

  return {
    filters: {
      fromDate: from?.toISOString() ?? null,
      toDate: to?.toISOString() ?? null,
      itemId: itemId > 0 ? itemId : null,
      customerId: customerId > 0 ? customerId : null,
      wastageTypeId: wastageTypeId > 0 ? wastageTypeId : null,
    },
    summary: {
      rowCount: detailRows.length,
      totalQty,
      distinctReports: new Set(detailRows.map((r) => r.reportId)).size,
    },
    pareto,
    rows: detailRows,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildProductionWastageClassificationReport,
  mapWastageDetailRows,
};
