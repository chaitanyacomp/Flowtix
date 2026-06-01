/**
 * Phase 3F — Production RM variance report (immutable ProductionEntryRmConsumption only).
 */

const { prisma } = require("../utils/prisma");
const { AuditAction, AuditEntityType } = require("../prismaClientPackage");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 10000;
const DEFAULT_THRESHOLD_PCT = 5;

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
  const thresholdPct = Math.max(
    0,
    Number.isFinite(Number(query.thresholdPct)) ? Number(query.thresholdPct) : DEFAULT_THRESHOLD_PCT,
  );
  const fgItemId =
    query.fgItemId != null && Number.isFinite(Number(query.fgItemId)) && Number(query.fgItemId) > 0
      ? Number(query.fgItemId)
      : null;
  const rmItemId =
    query.rmItemId != null && Number.isFinite(Number(query.rmItemId)) && Number(query.rmItemId) > 0
      ? Number(query.rmItemId)
      : null;
  const varianceType = String(query.varianceType || "ALL").toUpperCase();
  const consumptionType = String(query.consumptionType || "ALL").toUpperCase();
  const highVarianceOnly =
    query.highVarianceOnly === "1" ||
    query.highVarianceOnly === "true" ||
    query.highVarianceOnly === true;
  const woNumber = String(query.woNumber || query.workOrderNo || "").trim();
  const soNumber = String(query.soNumber || query.salesOrderNo || "").trim();
  const exportMode = String(query.export || "").toLowerCase();

  return {
    page,
    pageSize,
    dateFrom: parseDateStart(query.dateFrom || query.fromDate),
    dateTo: parseDateEnd(query.dateTo || query.toDate),
    fgItemId,
    rmItemId,
    varianceType:
      varianceType === "EXTRA_USAGE" || varianceType === "LOWER_USAGE" ? varianceType : "ALL",
    consumptionType:
      consumptionType === "NORMAL" ||
      consumptionType === "EXTRA_PROCESS_LOSS" ||
      consumptionType === "LOWER_USAGE" ||
      consumptionType === "REWORK_RESERVED"
        ? consumptionType
        : "ALL",
    thresholdPct,
    highVarianceOnly,
    woNumber,
    soNumber,
    exportMode,
  };
}

/**
 * REGULAR flow only: rows with consumption snapshot; includes reversed batches (consumption retained).
 * @param {ReturnType<typeof parseFilters>} filters
 */
function buildConsumptionWhere(filters) {
  /** @type {import('@prisma/client').Prisma.ProductionEntryRmConsumptionWhereInput} */
  const where = {
    productionEntry: {
      workOrderLine: {
        ...(filters.fgItemId ? { fgItemId: filters.fgItemId } : {}),
        workOrder: {
          ...(filters.woNumber ? { docNo: { contains: filters.woNumber } } : {}),
          salesOrder: {
            NOT: { orderType: "NO_QTY" },
            ...(filters.soNumber ? { docNo: { contains: filters.soNumber } } : {}),
          },
        },
      },
    },
  };

  if (filters.dateFrom || filters.dateTo) {
    where.productionEntry.date = {};
    if (filters.dateFrom) where.productionEntry.date.gte = filters.dateFrom;
    if (filters.dateTo) where.productionEntry.date.lte = filters.dateTo;
  }

  if (filters.rmItemId) where.itemId = filters.rmItemId;
  if (filters.consumptionType !== "ALL") where.consumptionType = filters.consumptionType;

  if (filters.varianceType === "EXTRA_USAGE") {
    where.varianceQty = { gt: 0 };
  } else if (filters.varianceType === "LOWER_USAGE") {
    where.varianceQty = { lt: 0 };
  }

  if (filters.highVarianceOnly) {
    where.OR = [
      { variancePercent: { gte: filters.thresholdPct } },
      { variancePercent: { lte: -filters.thresholdPct } },
    ];
  }

  return where;
}

const consumptionInclude = {
  item: { select: { id: true, itemName: true, unit: true } },
  productionEntry: {
    select: {
      id: true,
      docNo: true,
      date: true,
      producedQty: true,
      workflowStatus: true,
      workOrderLine: {
        select: {
          fgItem: { select: { id: true, itemName: true, unit: true } },
          workOrder: {
            select: {
              id: true,
              docNo: true,
              salesOrder: { select: { id: true, docNo: true, orderType: true } },
            },
          },
        },
      },
    },
  },
};

function mapRow(c, approvedByName) {
  const pe = c.productionEntry;
  const wol = pe.workOrderLine;
  const wo = wol.workOrder;
  const so = wo.salesOrder;
  const standardQty = n(c.standardQty);
  const actualQty = n(c.actualQty);
  const varianceQty = n(c.varianceQty);
  const variancePercent = c.variancePercent != null ? n(c.variancePercent) : null;

  return {
    id: c.id,
    productionEntryId: pe.id,
    productionEntryDocNo: pe.docNo,
    productionDate: pe.date,
    productionWorkflowStatus: pe.workflowStatus,
    workOrderId: wo.id,
    workOrderNo: wo.docNo,
    salesOrderId: so.id,
    salesOrderNo: so.docNo,
    fgItemId: wol.fgItem.id,
    fgItemName: wol.fgItem.itemName,
    fgUnit: wol.fgItem.unit ?? "",
    rmItemId: c.itemId,
    rmItemName: c.item.itemName,
    rmUnit: c.item.unit ?? c.unitSnapshot ?? "",
    producedQty: n(pe.producedQty),
    standardQty,
    actualQty,
    varianceQty,
    variancePercent,
    consumptionType: c.consumptionType,
    remarks: c.remarks,
    approvedByName,
  };
}

async function loadApprovedByMap(productionEntryIds) {
  const map = new Map();
  if (!productionEntryIds.length) return map;
  const ids = [...new Set(productionEntryIds)].map(String);
  const logs = await prisma.auditLog.findMany({
    where: {
      entityType: AuditEntityType.PRODUCTION_ENTRY,
      action: AuditAction.APPROVE,
      entityId: { in: ids },
    },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  for (const log of logs) {
    if (!log.entityId || map.has(log.entityId)) continue;
    map.set(log.entityId, log.actor?.name ?? null);
  }
  return map;
}

async function computeKpis(where, thresholdPct) {
  const rows = await prisma.productionEntryRmConsumption.findMany({
    where,
    select: {
      productionEntryId: true,
      itemId: true,
      standardQty: true,
      actualQty: true,
      varianceQty: true,
      variancePercent: true,
      item: { select: { itemName: true } },
    },
  });

  const batchIds = new Set();
  let extraUsageQty = 0;
  let lowerUsageQty = 0;
  let highVarianceCases = 0;
  const actualByRm = new Map();

  for (const r of rows) {
    batchIds.add(r.productionEntryId);
    const v = n(r.varianceQty);
    const vp = r.variancePercent != null ? n(r.variancePercent) : null;
    if (v > 0) extraUsageQty += v;
    if (v < 0) lowerUsageQty += Math.abs(v);
    if (vp != null && Math.abs(vp) >= thresholdPct) highVarianceCases += 1;

    const actual = n(r.actualQty);
    actualByRm.set(r.itemId, {
      itemId: r.itemId,
      itemName: r.item.itemName,
      totalActual: (actualByRm.get(r.itemId)?.totalActual || 0) + actual,
    });
  }

  let mostConsumedRm = null;
  let maxActual = 0;
  for (const entry of actualByRm.values()) {
    if (entry.totalActual > maxActual) {
      maxActual = entry.totalActual;
      mostConsumedRm = { itemId: entry.itemId, itemName: entry.itemName, totalActualQty: round3(maxActual) };
    }
  }

  return {
    totalProductionBatches: batchIds.size,
    totalRmLines: rows.length,
    extraUsageQty: round3(extraUsageQty),
    lowerUsageQty: round3(lowerUsageQty),
    highVarianceCases,
    mostConsumedRm,
  };
}

async function computeRmSummary(where) {
  const rows = await prisma.productionEntryRmConsumption.findMany({
    where,
    select: {
      itemId: true,
      standardQty: true,
      actualQty: true,
      varianceQty: true,
      item: { select: { itemName: true, unit: true } },
    },
  });
  const byItem = new Map();
  for (const r of rows) {
    if (!byItem.has(r.itemId)) {
      byItem.set(r.itemId, {
        itemId: r.itemId,
        itemName: r.item.itemName,
        unit: r.item.unit ?? "",
        totalStandard: 0,
        totalActual: 0,
        netVariance: 0,
      });
    }
    const slot = byItem.get(r.itemId);
    slot.totalStandard += n(r.standardQty);
    slot.totalActual += n(r.actualQty);
    slot.netVariance += n(r.varianceQty);
  }
  return [...byItem.values()]
    .map((r) => {
      const totalStandard = round3(r.totalStandard);
      const totalActual = round3(r.totalActual);
      const netVariance = round3(r.netVariance);
      const variancePercent =
        totalStandard > 0 ? round3((netVariance / totalStandard) * 100) : null;
      return { ...r, totalStandard, totalActual, netVariance, variancePercent };
    })
    .sort((a, b) => Math.abs(b.netVariance) - Math.abs(a.netVariance));
}

async function computeFgSummary(where) {
  const rows = await prisma.productionEntryRmConsumption.findMany({
    where,
    select: {
      productionEntryId: true,
      standardQty: true,
      actualQty: true,
      productionEntry: {
        select: {
          workOrderLine: {
            select: {
              fgItem: { select: { id: true, itemName: true, unit: true } },
            },
          },
        },
      },
    },
  });
  const byFg = new Map();
  for (const r of rows) {
    const fg = r.productionEntry.workOrderLine.fgItem;
    if (!byFg.has(fg.id)) {
      byFg.set(fg.id, {
        fgItemId: fg.id,
        fgItemName: fg.itemName,
        fgUnit: fg.unit ?? "",
        batchIds: new Set(),
        totalStandard: 0,
        totalActual: 0,
      });
    }
    const slot = byFg.get(fg.id);
    slot.batchIds.add(r.productionEntryId);
    slot.totalStandard += n(r.standardQty);
    slot.totalActual += n(r.actualQty);
  }
  return [...byFg.values()]
    .map((r) => {
      const totalStandard = round3(r.totalStandard);
      const totalActual = round3(r.totalActual);
      const netVariance = round3(totalActual - totalStandard);
      const variancePercent =
        totalStandard > 0 ? round3((netVariance / totalStandard) * 100) : null;
      return {
        fgItemId: r.fgItemId,
        fgItemName: r.fgItemName,
        fgUnit: r.fgUnit,
        batchCount: r.batchIds.size,
        totalStandard,
        totalActual,
        netVariance,
        variancePercent,
      };
    })
    .sort((a, b) => Math.abs(b.netVariance) - Math.abs(a.netVariance));
}

function rowsToCsv(rows) {
  const header = [
    "Production Date",
    "WO No",
    "SO No",
    "FG Item",
    "RM Item",
    "Produced Qty",
    "Standard Consumption",
    "Actual Consumption",
    "Variance Qty",
    "Variance %",
    "Consumption Type",
    "Remarks",
    "Approved By",
  ];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = rows.map((r) =>
    [
      r.productionDate ? new Date(r.productionDate).toISOString().slice(0, 10) : "",
      r.workOrderNo ?? "",
      r.salesOrderNo ?? "",
      r.fgItemName,
      r.rmItemName,
      r.producedQty,
      r.standardQty,
      r.actualQty,
      r.varianceQty,
      r.variancePercent ?? "",
      r.consumptionType ?? "",
      r.remarks ?? "",
      r.approvedByName ?? "",
    ]
      .map(esc)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

/**
 * @param {import('express').Request['query']} query
 */
async function buildProductionRmVarianceReport(query = {}) {
  const filters = parseFilters(query);
  const where = buildConsumptionWhere(filters);

  if (filters.exportMode === "csv") {
    const raw = await prisma.productionEntryRmConsumption.findMany({
      where,
      orderBy: [
        { productionEntry: { date: "desc" } },
        { productionEntryId: "desc" },
        { id: "desc" },
      ],
      take: MAX_EXPORT_ROWS,
      include: consumptionInclude,
    });
    const approvedBy = await loadApprovedByMap(raw.map((r) => r.productionEntryId));
    const rows = raw.map((c) => mapRow(c, approvedBy.get(String(c.productionEntryId)) ?? null));
    return { export: "csv", csv: rowsToCsv(rows), rowCount: rows.length, filters };
  }

  const [total, rawPage, kpis, rmSummary, fgSummary] = await Promise.all([
    prisma.productionEntryRmConsumption.count({ where }),
    prisma.productionEntryRmConsumption.findMany({
      where,
      orderBy: [
        { productionEntry: { date: "desc" } },
        { productionEntryId: "desc" },
        { id: "desc" },
      ],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: consumptionInclude,
    }),
    computeKpis(where, filters.thresholdPct),
    computeRmSummary(where),
    computeFgSummary(where),
  ]);

  const approvedBy = await loadApprovedByMap(rawPage.map((r) => r.productionEntryId));
  const rows = rawPage.map((c) => mapRow(c, approvedBy.get(String(c.productionEntryId)) ?? null));

  return {
    meta: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
      thresholdPct: filters.thresholdPct,
      filters: {
        dateFrom: filters.dateFrom?.toISOString().slice(0, 10) ?? null,
        dateTo: filters.dateTo?.toISOString().slice(0, 10) ?? null,
        fgItemId: filters.fgItemId,
        rmItemId: filters.rmItemId,
        varianceType: filters.varianceType,
        consumptionType: filters.consumptionType,
        highVarianceOnly: filters.highVarianceOnly,
        woNumber: filters.woNumber || null,
        soNumber: filters.soNumber || null,
      },
    },
    kpis,
    rows,
    rmSummary,
    fgSummary,
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  DEFAULT_THRESHOLD_PCT,
  parseFilters,
  buildProductionRmVarianceReport,
  rowsToCsv,
};
