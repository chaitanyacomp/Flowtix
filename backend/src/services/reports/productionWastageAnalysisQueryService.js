/**
 * Lane C — Production Work Order Report wastage analysis (read-only).
 *
 * Fact tables:
 *   - ProductionWorkOrderReport (CONFIRMED only)
 *   - ProductionWorkOrderReportLine (issued / returned / consumed / scrapWasteQty)
 *   - ProductionWorkOrderReportWastageDetail (type classification)
 *
 * Does NOT merge MaterialWastageNote (Lane A), PE consumption variance (Lane B),
 * or ScrapRecord (Lane D). Returns are never counted as wastage.
 *
 * Formulas (centralized):
 *   wastageQty      = line.scrapWasteQty
 *   wastagePct      = wastageQty / issuedQty × 100   (null if issuedQty ≤ 0)
 *   yieldPct        = actualConsumedQty / issuedQty × 100  (null if issuedQty ≤ 0)
 *   plannedConsumption = Σ ProductionEntryRmConsumption.standardQty for WO+RM (nullable)
 *   excessConsumption  = actualConsumed − plannedConsumption (nullable)
 *
 * Join safety:
 *   WO-detail grain = one row per report RM line (never × wastage details).
 *   Type classifications attach as an array; filtering by type scopes reports only.
 *   Type-summary grain = one row per wastage type from detail qty (not line qty × details).
 */

const { prisma } = require("../../utils/prisma");
const { qtyToNumber } = require("../rmPurchaseHelpers");
const { round3 } = require("../bomExplosionService");

const EPS = 1e-6;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const FORMULA_METADATA = Object.freeze({
  wastageQty: "ProductionWorkOrderReportLine.scrapWasteQty (issued − consumed − returned at confirm). Returns are excluded.",
  wastagePct: "wastageQty / issuedQty × 100 (null when issuedQty ≤ 0).",
  yieldPct: "actualConsumedQty / issuedQty × 100 (null when issuedQty ≤ 0).",
  plannedConsumption: "Sum of ProductionEntryRmConsumption.standardQty for the work order + RM item (nullable).",
  excessConsumption: "actualConsumedQty − plannedConsumption when planned is available.",
  typeTotalWastageQty: "Sum of ProductionWorkOrderReportWastageDetail.qty for the type (classification lane).",
  lanes: {
    A: "MaterialWastageNote / RM_WASTAGE — not included in these totals",
    B: "ProductionEntryRmConsumption variance — plannedConsumption only; not wastage",
    C: "This report — Production Work Order Report classification",
    D: "ScrapRecord FG scrap — not included",
  },
});

function n(v) {
  return qtyToNumber(v);
}

function pct(numerator, denominator) {
  const den = n(denominator);
  if (!(den > EPS)) return null;
  return round3((n(numerator) / den) * 100);
}

function parsePositiveInt(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parsePage(value, fallback = 1) {
  const p = Number(value);
  return Number.isFinite(p) && p >= 1 ? Math.floor(p) : fallback;
}

function parsePageSize(value) {
  const p = Number(value);
  if (!Number.isFinite(p) || p < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(p));
}

function normalizeMode(mode) {
  const m = String(mode || "legacy").trim().toLowerCase();
  if (m === "wo-detail" || m === "type-summary" || m === "legacy") return m;
  return "legacy";
}

/**
 * Load CONFIRMED reports matching filters (report-level scope).
 * Type / category filters restrict to reports that have matching details.
 */
async function loadConfirmedReports(db, filters) {
  const from = filters.fromDate ? new Date(filters.fromDate) : null;
  const to = filters.toDate ? new Date(filters.toDate) : null;
  const workOrderId = parsePositiveInt(filters.workOrderId);
  const salesOrderId = parsePositiveInt(filters.salesOrderId);
  const customerId = parsePositiveInt(filters.customerId);
  const fgItemId = parsePositiveInt(filters.fgItemId);
  const rmItemId = parsePositiveInt(filters.rmItemId);
  const wastageTypeId = parsePositiveInt(filters.wastageTypeId);
  const category = filters.category ? String(filters.category).trim().toUpperCase() : null;
  const woNumber = String(filters.woNumber || filters.workOrderNo || "").trim();

  const detailWhere =
    wastageTypeId || category
      ? {
          some: {
            ...(wastageTypeId ? { wastageTypeId } : {}),
            ...(category ? { wastageType: { category } } : {}),
          },
        }
      : undefined;

  const reports = await db.productionWorkOrderReport.findMany({
    where: {
      status: "CONFIRMED",
      ...(from || to
        ? {
            confirmedAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(workOrderId ? { workOrderId } : {}),
      ...(detailWhere ? { wastageDetails: detailWhere } : {}),
      ...(rmItemId
        ? { lines: { some: { itemId: rmItemId } } }
        : {}),
      workOrder: {
        ...(woNumber ? { docNo: { contains: woNumber } } : {}),
        ...(salesOrderId ? { salesOrderId } : {}),
        ...(customerId ? { salesOrder: { customerId } } : {}),
        ...(fgItemId ? { lines: { some: { fgItemId } } } : {}),
      },
    },
    include: {
      lines: {
        where: rmItemId ? { itemId: rmItemId } : undefined,
        include: { item: { select: { id: true, itemName: true, unit: true } } },
        orderBy: { id: "asc" },
      },
      wastageDetails: {
        include: {
          wastageType: {
            select: { id: true, code: true, name: true, category: true, isActive: true },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
      workOrder: {
        select: {
          id: true,
          docNo: true,
          salesOrderId: true,
          salesOrder: {
            select: {
              id: true,
              docNo: true,
              customerId: true,
              customer: { select: { id: true, name: true } },
            },
          },
          lines: {
            select: {
              fgItemId: true,
              fgItem: { select: { id: true, itemName: true, unit: true } },
            },
            take: 3,
          },
        },
      },
      confirmedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
  });

  return reports;
}

async function loadPlannedConsumptionByWoRm(db, workOrderIds) {
  const ids = [...new Set((workOrderIds || []).filter((id) => id > 0))];
  const map = new Map(); // `${woId}:${rmItemId}` -> standardQty
  if (!ids.length || !db.productionEntryRmConsumption?.findMany) return map;

  const rows = await db.productionEntryRmConsumption.findMany({
    where: {
      productionEntry: {
        status: "APPROVED",
        workOrderLine: { workOrderId: { in: ids } },
      },
    },
    select: {
      rmItemId: true,
      standardQty: true,
      productionEntry: {
        select: { workOrderLine: { select: { workOrderId: true } } },
      },
    },
  });

  for (const row of rows) {
    const woId = row.productionEntry?.workOrderLine?.workOrderId;
    if (!woId) continue;
    const key = `${woId}:${row.rmItemId}`;
    map.set(key, round3(n(map.get(key) || 0) + n(row.standardQty)));
  }
  return map;
}

function mapClassifications(details) {
  return (details || []).map((d) => ({
    wastageTypeId: d.wastageTypeId,
    wastageTypeCode: d.wastageType?.code ?? null,
    wastageTypeName: d.wastageType?.name ?? null,
    category: d.wastageType?.category ?? null,
    isActiveType: d.wastageType?.isActive ?? null,
    qty: round3(n(d.qty)),
    remarks: d.remarks ?? null,
  }));
}

function buildWoDetailRows(reports, plannedByWoRm) {
  const rows = [];
  for (const report of reports) {
    const wo = report.workOrder;
    const fg = wo?.lines?.[0]?.fgItem ?? null;
    const classifications = mapClassifications(report.wastageDetails);
    const typeLabel =
      classifications.length === 0
        ? null
        : classifications.length === 1
          ? classifications[0].wastageTypeName
          : `Multiple (${classifications.length})`;
    const categoryLabel =
      classifications.length === 0
        ? null
        : [...new Set(classifications.map((c) => c.category).filter(Boolean))].join(", ") || null;
    const remarksLabel = classifications
      .map((c) => c.remarks)
      .filter(Boolean)
      .join("; ");

    const lineList = report.lines || [];
    // Prefer RM lines with wastage; if none, still expose lines so issued/return/consume are visible.
    const sourceLines = lineList.some((ln) => n(ln.scrapWasteQty) > EPS)
      ? lineList.filter((ln) => n(ln.scrapWasteQty) > EPS || n(ln.rmIssuedQty) > EPS)
      : lineList;

    for (const line of sourceLines) {
      const issuedQty = round3(n(line.rmIssuedQty));
      const returnedQty = round3(n(line.rmReturnQty));
      const actualConsumedQty = round3(n(line.rmConsumedQty));
      const wastageQty = round3(n(line.scrapWasteQty));
      const plannedKey = `${wo?.id}:${line.itemId}`;
      const plannedConsumption =
        plannedByWoRm.has(plannedKey) ? round3(n(plannedByWoRm.get(plannedKey))) : null;
      const excessConsumption =
        plannedConsumption == null ? null : round3(actualConsumedQty - plannedConsumption);

      rows.push({
        reportId: report.id,
        reportDate: report.confirmedAt,
        workOrderId: wo?.id ?? null,
        workOrderNo: wo?.docNo ?? null,
        salesOrderId: wo?.salesOrder?.id ?? null,
        salesOrderNo: wo?.salesOrder?.docNo ?? null,
        customerId: wo?.salesOrder?.customer?.id ?? null,
        customerName: wo?.salesOrder?.customer?.name ?? null,
        fgItemId: fg?.id ?? null,
        fgItemName: fg?.itemName ?? null,
        fgUnit: fg?.unit ?? null,
        rmItemId: line.itemId,
        rmItemName: line.item?.itemName ?? `Item #${line.itemId}`,
        rmUnit: line.item?.unit ?? "",
        plannedConsumption,
        issuedQty,
        returnedQty,
        actualConsumedQty,
        fgProducedQty: round3(n(report.producedQty)),
        wastageQty,
        wastagePct: pct(wastageQty, issuedQty),
        yieldPct: pct(actualConsumedQty, issuedQty),
        excessConsumption,
        wastageTypeLabel: typeLabel,
        categoryLabel,
        remarks: remarksLabel || line.remarks || null,
        classifications,
        productionReportRef: `PWR-${report.id}`,
        status: report.status,
        drillDown: {
          workOrderId: wo?.id ?? null,
          productionReportId: report.id,
          hrefWorkOrder: wo?.id ? `/work-orders?focus=${wo.id}` : null,
          hrefProductionReport: wo?.id ? `/production?workOrderId=${wo.id}&tab=report` : null,
        },
      });
    }
  }
  return rows;
}

function buildTypeSummaryRows(reports, filters = {}) {
  const filterTypeId = parsePositiveInt(filters.wastageTypeId);
  const filterCategory = filters.category ? String(filters.category).trim().toUpperCase() : null;
  const byType = new Map();
  const reportIssuedById = new Map();
  for (const report of reports) {
    const issued = round3((report.lines || []).reduce((s, ln) => s + n(ln.rmIssuedQty), 0));
    const wastage = round3((report.lines || []).reduce((s, ln) => s + n(ln.scrapWasteQty), 0));
    reportIssuedById.set(report.id, { issued, wastage, workOrderId: report.workOrderId, workOrderNo: report.workOrder?.docNo ?? null });
  }

  for (const report of reports) {
    for (const detail of report.wastageDetails || []) {
      if (filterTypeId && detail.wastageTypeId !== filterTypeId) continue;
      if (filterCategory && detail.wastageType?.category !== filterCategory) continue;
      const typeId = detail.wastageTypeId;
      const qty = round3(n(detail.qty));
      if (!(qty > EPS)) continue;
      const prev = byType.get(typeId) ?? {
        wastageTypeId: typeId,
        wastageTypeCode: detail.wastageType?.code ?? null,
        wastageTypeName: detail.wastageType?.name ?? null,
        category: detail.wastageType?.category ?? null,
        isActiveType: detail.wastageType?.isActive ?? null,
        totalWastageQty: 0,
        workOrderIds: new Set(),
        reportIds: new Set(),
        woQty: new Map(), // woId -> qty for this type
        reportWastagePcts: [],
      };
      prev.totalWastageQty = round3(prev.totalWastageQty + qty);
      prev.workOrderIds.add(report.workOrderId);
      prev.reportIds.add(report.id);
      prev.woQty.set(report.workOrderId, round3(n(prev.woQty.get(report.workOrderId) || 0) + qty));
      const meta = reportIssuedById.get(report.id);
      if (meta?.issued > EPS) {
        prev.reportWastagePcts.push(pct(meta.wastage, meta.issued));
      }
      // Keep latest name/category from type master (inactive types remain visible).
      prev.wastageTypeCode = detail.wastageType?.code ?? prev.wastageTypeCode;
      prev.wastageTypeName = detail.wastageType?.name ?? prev.wastageTypeName;
      prev.category = detail.wastageType?.category ?? prev.category;
      prev.isActiveType = detail.wastageType?.isActive ?? prev.isActiveType;
      byType.set(typeId, prev);
    }
  }

  const grandTotal = round3([...byType.values()].reduce((s, r) => s + r.totalWastageQty, 0));

  return [...byType.values()]
    .map((row) => {
      const woEntries = [...row.woQty.entries()].map(([workOrderId, qty]) => {
        const reportMeta = [...reportIssuedById.entries()].find(([, m]) => m.workOrderId === workOrderId);
        return {
          workOrderId,
          workOrderNo: reportMeta?.[1]?.workOrderNo ?? null,
          qty,
        };
      });
      const nonZero = woEntries.filter((e) => e.qty > EPS).sort((a, b) => b.qty - a.qty);
      const highest = nonZero[0] ?? null;
      const lowest = nonZero.length ? nonZero[nonZero.length - 1] : null;
      const woCount = row.workOrderIds.size;
      const avgPcts = row.reportWastagePcts.filter((p) => p != null);
      return {
        wastageTypeId: row.wastageTypeId,
        wastageTypeCode: row.wastageTypeCode,
        wastageTypeName: row.wastageTypeName,
        category: row.category,
        isActiveType: row.isActiveType,
        totalWastageQty: row.totalWastageQty,
        shareOfTotalWastagePct: grandTotal > EPS ? round3((row.totalWastageQty / grandTotal) * 100) : null,
        workOrderCount: woCount,
        productionReportCount: row.reportIds.size,
        averageWastagePerWo: woCount > 0 ? round3(row.totalWastageQty / woCount) : null,
        averageWastagePct:
          avgPcts.length > 0 ? round3(avgPcts.reduce((s, p) => s + p, 0) / avgPcts.length) : null,
        highestWastageWoId: highest?.workOrderId ?? null,
        highestWastageWoNo: highest?.workOrderNo ?? null,
        highestWastageQty: highest?.qty ?? null,
        lowestNonZeroWastageWoId: lowest?.workOrderId ?? null,
        lowestNonZeroWastageWoNo: lowest?.workOrderNo ?? null,
        lowestNonZeroWastageQty: lowest?.qty ?? null,
        drillDown: {
          wastageTypeId: row.wastageTypeId,
          hrefWoReport: `/reports/production-wastage-wo?wastageTypeId=${row.wastageTypeId}`,
        },
      };
    })
    .sort((a, b) => b.totalWastageQty - a.totalWastageQty);
}

function buildReconciliation(reports) {
  let lineWastageTotal = 0;
  let detailWastageTotal = 0;
  let reportCount = reports.length;
  for (const report of reports) {
    lineWastageTotal = round3(lineWastageTotal + (report.lines || []).reduce((s, ln) => s + n(ln.scrapWasteQty), 0));
    detailWastageTotal = round3(
      detailWastageTotal + (report.wastageDetails || []).reduce((s, d) => s + n(d.qty), 0),
    );
  }
  const delta = round3(lineWastageTotal - detailWastageTotal);
  const warnings = [];
  if (Math.abs(delta) > EPS) {
    warnings.push({
      code: "CLASSIFICATION_QTY_MISMATCH",
      message: `Sum of RM line wastage (${lineWastageTotal}) differs from classification detail qty (${detailWastageTotal}) by ${delta}.`,
    });
  }
  warnings.push({
    code: "LANE_BOUNDARY",
    message: "Totals exclude MaterialWastageNote (Lane A) and ScrapRecord (Lane D). MWN is not double-counted here.",
  });
  return {
    confirmedReportCount: reportCount,
    lineWastageTotal,
    classificationDetailTotal: detailWastageTotal,
    delta,
    warnings,
  };
}

function buildKpisFromWoRows(rows) {
  const reportIds = new Set(rows.map((r) => r.reportId));
  const woIds = new Set(rows.map((r) => r.workOrderId).filter(Boolean));
  return {
    reportCount: reportIds.size,
    workOrderCount: woIds.size,
    rmLineCount: rows.length,
    totalIssuedQty: round3(rows.reduce((s, r) => s + n(r.issuedQty), 0)),
    totalReturnedQty: round3(rows.reduce((s, r) => s + n(r.returnedQty), 0)),
    totalConsumedQty: round3(rows.reduce((s, r) => s + n(r.actualConsumedQty), 0)),
    totalWastageQty: round3(rows.reduce((s, r) => s + n(r.wastageQty), 0)),
    averageWastagePct: (() => {
      const withIssued = rows.filter((r) => n(r.issuedQty) > EPS && r.wastagePct != null);
      if (!withIssued.length) return null;
      return round3(withIssued.reduce((s, r) => s + r.wastagePct, 0) / withIssued.length);
    })(),
    materialCostLoss: null,
    materialCostLossStatus: "DEFERRED_PENDING_VALUATION_POLICY",
  };
}

function buildKpisFromTypeRows(typeRows, reconciliation) {
  return {
    wastageTypeCount: typeRows.length,
    totalWastageQty: round3(typeRows.reduce((s, r) => s + n(r.totalWastageQty), 0)),
    workOrderCount: reconciliation
      ? null
      : null,
    classificationDetailTotal: reconciliation?.classificationDetailTotal ?? null,
    lineWastageTotal: reconciliation?.lineWastageTotal ?? null,
    materialCostLoss: null,
    materialCostLossStatus: "DEFERRED_PENDING_VALUATION_POLICY",
  };
}

function sortWoRows(rows, sort) {
  const field = String(sort?.field || "reportDate");
  const dir = String(sort?.dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return sorted;
}

function paginate(rows, page, pageSize) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    pagination: { page: safePage, pageSize, total, totalPages },
  };
}

/**
 * @param {object} opts
 * @param {'wo-detail'|'type-summary'|'legacy'} [opts.mode]
 */
async function buildProductionWastageAnalysis(opts = {}, db = prisma) {
  const mode = normalizeMode(opts.mode || opts.filters?.mode);
  const filters = { ...(opts.filters || opts), mode };
  const page = parsePage(opts.page ?? filters.page);
  const pageSize = parsePageSize(opts.pageSize ?? filters.pageSize);
  const sort = opts.sort || {
    field: filters.sortField || (mode === "type-summary" ? "totalWastageQty" : "reportDate"),
    dir: filters.sortDir || "desc",
  };

  const reports = await loadConfirmedReports(db, filters);
  const reconciliation = buildReconciliation(reports);
  const plannedByWoRm = await loadPlannedConsumptionByWoRm(
    db,
    reports.map((r) => r.workOrderId),
  );

  const appliedFilters = {
    fromDate: filters.fromDate || null,
    toDate: filters.toDate || null,
    workOrderId: parsePositiveInt(filters.workOrderId),
    woNumber: String(filters.woNumber || filters.workOrderNo || "").trim() || null,
    salesOrderId: parsePositiveInt(filters.salesOrderId),
    customerId: parsePositiveInt(filters.customerId),
    fgItemId: parsePositiveInt(filters.fgItemId),
    rmItemId: parsePositiveInt(filters.rmItemId),
    wastageTypeId: parsePositiveInt(filters.wastageTypeId),
    category: filters.category ? String(filters.category).trim().toUpperCase() : null,
    mode,
  };

  if (mode === "type-summary") {
    let typeRows = buildTypeSummaryRows(reports, filters);
    if (sort.field) {
      const dir = String(sort.dir || "desc").toLowerCase() === "asc" ? 1 : -1;
      typeRows = [...typeRows].sort((a, b) => {
        const av = a[sort.field];
        const bv = b[sort.field];
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
      });
    }
    const pageResult = paginate(typeRows, page, pageSize);
    const kpis = buildKpisFromTypeRows(typeRows, reconciliation);
    kpis.workOrderCount = new Set(reports.map((r) => r.workOrderId)).size;
    kpis.reportCount = reports.length;
    return {
      mode: "type-summary",
      filters: appliedFilters,
      kpis,
      rows: pageResult.rows,
      pagination: pageResult.pagination,
      sort,
      formulas: FORMULA_METADATA,
      reconciliation,
      generatedAt: new Date().toISOString(),
      ...(pageSize >= 100000 ? { allRowsForExport: typeRows } : {}),
    };
  }

  // wo-detail (default for new pages) and legacy compatibility payload
  let woRows = buildWoDetailRows(reports, plannedByWoRm);
  woRows = sortWoRows(woRows, sort);
  const pageResult = paginate(woRows, page, pageSize);
  const kpis = buildKpisFromWoRows(woRows);

  if (mode === "legacy") {
    // Backward-compatible shape for existing consumers of production-wastage-classification
    const detailRows = [];
    for (const report of reports) {
      const wo = report.workOrder;
      const fg = wo?.lines?.[0]?.fgItem ?? null;
      const totalWastageQty = round3((report.lines || []).reduce((acc, ln) => acc + Math.max(0, n(ln.scrapWasteQty)), 0));
      for (const row of report.wastageDetails || []) {
        detailRows.push({
          id: row.id,
          reportId: report.id,
          confirmedAt: report.confirmedAt,
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
          category: row.wastageType?.category ?? null,
          qty: round3(n(row.qty)),
          remarks: row.remarks ?? null,
          reportTotalWastageQty: totalWastageQty,
          rmItems: (report.lines || []).map((ln) => ({
            itemId: ln.itemId,
            itemName: ln.item?.itemName ?? null,
            unit: ln.item?.unit ?? null,
            totalWastageQty: round3(Math.max(0, n(ln.scrapWasteQty))),
          })),
        });
      }
    }
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

    return {
      filters: appliedFilters,
      summary: {
        rowCount: detailRows.length,
        totalQty: round3(detailRows.reduce((acc, row) => acc + row.qty, 0)),
        distinctReports: new Set(detailRows.map((r) => r.reportId)).size,
      },
      pareto,
      rows: detailRows,
      generatedAt: new Date().toISOString(),
      // Extended fields (non-breaking additions)
      mode: "legacy",
      kpis,
      formulas: FORMULA_METADATA,
      reconciliation,
      woDetailRows: woRows,
    };
  }

  return {
    mode: "wo-detail",
    filters: appliedFilters,
    kpis,
    rows: pageResult.rows,
    pagination: pageResult.pagination,
    sort,
    formulas: FORMULA_METADATA,
    reconciliation,
    generatedAt: new Date().toISOString(),
    ...(pageSize >= 100000 ? { allRowsForExport: woRows } : {}),
  };
}

module.exports = {
  FORMULA_METADATA,
  buildProductionWastageAnalysis,
  buildWoDetailRows,
  buildTypeSummaryRows,
  buildReconciliation,
  pct,
};
