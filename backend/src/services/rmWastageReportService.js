/**
 * RM Wastage Report — MWN register with GRN-based valuation for reporting.
 */

const { prisma } = require("../utils/prisma");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");
const { wastageReasonLabel } = require("./materialWastageService");
const { getLatestRmGrnRatesByItemIds } = require("./rmInventoryValuationService");

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function n(v) {
  return qtyToNumber(v);
}

function parseDateStart(raw) {
  if (!raw || String(raw).trim() === "") return undefined;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDateEnd(raw) {
  if (!raw || String(raw).trim() === "") return undefined;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseFilters(query = {}) {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const pageSize = Math.max(
    1,
    Math.min(MAX_PAGE_SIZE, Math.floor(Number(query.pageSize)) || DEFAULT_PAGE_SIZE),
  );
  const rmItemId =
    query.rmItemId != null && Number.isFinite(Number(query.rmItemId)) && Number(query.rmItemId) > 0
      ? Number(query.rmItemId)
      : null;
  const workOrderId =
    query.workOrderId != null && Number.isFinite(Number(query.workOrderId)) && Number(query.workOrderId) > 0
      ? Number(query.workOrderId)
      : null;
  const reason = String(query.reason || "").trim().toUpperCase();
  const woNumber = String(query.woNumber || query.workOrderNo || "").trim();

  return {
    page,
    pageSize,
    dateFrom: parseDateStart(query.dateFrom || query.fromDate),
    dateTo: parseDateEnd(query.dateTo || query.toDate),
    rmItemId,
    workOrderId,
    reason: reason && reason !== "ALL" ? reason : null,
    woNumber,
    exportMode: String(query.export || "").toLowerCase(),
  };
}

function buildWhere(filters) {
  /** @type {import('@prisma/client').Prisma.MaterialWastageNoteWhereInput} */
  const where = {};
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = filters.dateFrom;
    if (filters.dateTo) where.createdAt.lte = filters.dateTo;
  }
  if (filters.rmItemId) where.itemId = filters.rmItemId;
  if (filters.workOrderId) where.workOrderId = filters.workOrderId;
  if (filters.reason) where.reason = filters.reason;
  if (filters.woNumber) {
    where.workOrder = { docNo: { contains: filters.woNumber } };
  }
  return where;
}

function roundMoney(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

async function buildRmWastageReport(query = {}, db = prisma) {
  const filters = parseFilters(query);
  const where = buildWhere(filters);

  const total = await db.materialWastageNote.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const skip = (filters.page - 1) * filters.pageSize;

  const rows = await db.materialWastageNote.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: filters.exportMode === "csv" ? 0 : skip,
    take: filters.exportMode === "csv" ? 10000 : filters.pageSize,
    include: {
      item: { select: { id: true, itemName: true, unit: true } },
      workOrder: { select: { id: true, docNo: true } },
      createdBy: { select: { name: true } },
    },
  });

  const rateByItem = await getLatestRmGrnRatesByItemIds(rows.map((r) => r.itemId), db);

  const detailRows = rows.map((r) => {
    const qty = n(r.qty);
    const rateInfo = rateByItem.get(r.itemId) || { rate: 0, source: null };
    const rate = n(rateInfo.rate);
    const wastageValue = roundMoney(qty * rate);
    return {
      id: r.id,
      date: r.createdAt,
      mwnNo: r.docNo,
      workOrderId: r.workOrderId,
      workOrderNo: r.workOrder?.docNo ?? null,
      rmItemId: r.itemId,
      rmItemName: r.item?.itemName ?? "",
      rmUnit: r.item?.unit ?? "",
      qty: round3(qty),
      reason: r.reason,
      reasonLabel: wastageReasonLabel(r.reason),
      remarks: r.remarks,
      createdByName: r.createdBy?.name ?? null,
      rate,
      rateSource: rateInfo.source,
      wastageValue,
    };
  });

  let totalQty = 0;
  let totalValue = 0;
  for (const row of detailRows) {
    totalQty = round3(totalQty + row.qty);
    totalValue = roundMoney(totalValue + row.wastageValue);
  }

  const payload = {
    meta: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages,
    },
    kpis: {
      totalNotes: total,
      totalWastageQty: totalQty,
      totalWastageValue: totalValue,
    },
    rows: detailRows,
  };

  if (filters.exportMode === "csv") {
    const header =
      "Date,MWN No,WO No,RM Item,Qty,Unit,Reason,Remarks,Created By,Rate,Wastage Value";
    const lines = detailRows.map((r) => {
      const date = r.date ? new Date(r.date).toISOString().slice(0, 10) : "";
      const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      return [
        date,
        esc(r.mwnNo),
        esc(r.workOrderNo),
        esc(r.rmItemName),
        r.qty,
        esc(r.rmUnit),
        esc(r.reasonLabel),
        esc(r.remarks),
        esc(r.createdByName),
        r.rate,
        r.wastageValue,
      ].join(",");
    });
    return { ...payload, export: "csv", csv: [header, ...lines].join("\n"), rowCount: detailRows.length };
  }

  return payload;
}

module.exports = {
  buildRmWastageReport,
  parseFilters,
};
