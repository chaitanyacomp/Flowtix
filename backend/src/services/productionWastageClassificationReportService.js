/**
 * Thin compatibility wrapper — Lane C production wastage classification report.
 * Delegates to productionWastageAnalysisQueryService (modes: legacy | wo-detail | type-summary).
 */
const { prisma } = require("../utils/prisma");
const { mapWastageDetailRows } = require("./productionWastageClassificationService");
const { buildProductionWastageAnalysis } = require("./reports/productionWastageAnalysisQueryService");

function looksLikePrisma(candidate) {
  return (
    candidate != null &&
    typeof candidate === "object" &&
    (typeof candidate.productionWorkOrderReport?.findMany === "function" ||
      typeof candidate.productionWorkOrderReportWastageDetail?.findMany === "function")
  );
}

/**
 * @param {object} filtersOrDb - query filters, or prisma when called as (db, filters)
 * @param {object} [maybeFilters]
 */
async function buildProductionWastageClassificationReport(filtersOrDb = {}, maybeFilters) {
  let db = prisma;
  let filters = filtersOrDb;

  if (looksLikePrisma(filtersOrDb)) {
    db = filtersOrDb;
    filters = maybeFilters || {};
  } else if (maybeFilters != null && looksLikePrisma(maybeFilters)) {
    // Defensive: (filters, db)
    db = maybeFilters;
  }

  const mode = String(filters.mode || "legacy").trim().toLowerCase();
  const forExport = filters.export === "1" || filters.export === "true" || filters.export === "all";

  const result = await buildProductionWastageAnalysis(
    {
      mode: mode === "wo-detail" || mode === "type-summary" ? mode : "legacy",
      filters: {
        fromDate: filters.fromDate || filters.dateFrom || null,
        toDate: filters.toDate || filters.dateTo || null,
        workOrderId: filters.workOrderId,
        woNumber: filters.woNumber || filters.workOrderNo,
        salesOrderId: filters.salesOrderId,
        customerId: filters.customerId,
        fgItemId: filters.fgItemId,
        rmItemId: filters.rmItemId || filters.itemId,
        wastageTypeId: filters.wastageTypeId,
        category: filters.category,
        page: forExport ? 1 : filters.page,
        pageSize: forExport ? 100000 : filters.pageSize,
        sortField: filters.sortField,
        sortDir: filters.sortDir,
      },
      page: forExport ? 1 : filters.page,
      pageSize: forExport ? 100000 : filters.pageSize,
      sort: filters.sortField
        ? { field: filters.sortField, dir: filters.sortDir || "desc" }
        : undefined,
    },
    db,
  );

  // Strip internal export helper if present
  if (result.allRowsForExport) {
    if (forExport && (result.mode === "wo-detail" || result.mode === "type-summary")) {
      result.rows = result.allRowsForExport;
      result.pagination = {
        page: 1,
        pageSize: result.allRowsForExport.length,
        total: result.allRowsForExport.length,
        totalPages: 1,
      };
    }
    delete result.allRowsForExport;
  }

  // Preserve legacy filter key `itemId` alias in applied filters for old consumers
  if (result.filters && filters.itemId != null && result.filters.rmItemId == null) {
    result.filters.itemId = Number(filters.itemId) || null;
  } else if (result.filters) {
    result.filters.itemId = result.filters.rmItemId;
  }

  return result;
}

module.exports = {
  buildProductionWastageClassificationReport,
  mapWastageDetailRows,
};
