/**
 * P4A — Business-facing procurement demand source labels (presentation only).
 */

const SOURCE_CATEGORY_LABELS = Object.freeze({
  MONTHLY_PLAN: "Monthly Planning",
  SALES_ORDER: "Sales Order",
  STOCK_REPLENISHMENT: "Stock Replenishment",
  WORK_ORDER_PLANNING: "Legacy / Historical Demand",
  QUOTATION: "Quotation",
});

const LEGACY_HISTORICAL_DEMAND = "Legacy / Historical Demand";

function resolveDemandSourcePresentation(ds) {
  if (!ds) {
    return { category: LEGACY_HISTORICAL_DEMAND, detail: null, sourceType: null };
  }

  const sourceType = ds.demandSourceType ?? ds.mr?.sourceType ?? null;

  if (ds.monthlyPlan?.label?.trim()) {
    return {
      category: SOURCE_CATEGORY_LABELS.MONTHLY_PLAN,
      detail: ds.monthlyPlan.label.trim(),
      sourceType: sourceType ?? "MONTHLY_PLAN",
    };
  }

  if (sourceType === "SALES_ORDER") {
    const detail = ds.salesOrder?.docNo?.trim() || ds.mr?.docNo?.trim() || null;
    return { category: SOURCE_CATEGORY_LABELS.SALES_ORDER, detail, sourceType };
  }

  if (sourceType === "MONTHLY_PLAN") {
    const detail =
      ds.demandSourceLabel?.trim() ||
      (ds.monthlyPlanRevision != null ? `Monthly Plan Rev ${ds.monthlyPlanRevision}` : null) ||
      ds.mr?.docNo?.trim() ||
      null;
    return { category: SOURCE_CATEGORY_LABELS.MONTHLY_PLAN, detail, sourceType };
  }

  if (sourceType === "STOCK_REPLENISHMENT") {
    return {
      category: SOURCE_CATEGORY_LABELS.STOCK_REPLENISHMENT,
      detail: ds.mr?.docNo?.trim() || null,
      sourceType,
    };
  }

  if (sourceType === "WORK_ORDER_PLANNING") {
    return {
      category: LEGACY_HISTORICAL_DEMAND,
      detail: ds.workOrder?.docNo?.trim() || ds.mr?.docNo?.trim() || null,
      sourceType,
    };
  }

  if (sourceType && SOURCE_CATEGORY_LABELS[sourceType]) {
    return {
      category: SOURCE_CATEGORY_LABELS[sourceType],
      detail: ds.mr?.docNo?.trim() || ds.pr?.docNo?.trim() || null,
      sourceType,
    };
  }

  if (ds.salesOrder?.docNo?.trim()) {
    return {
      category: SOURCE_CATEGORY_LABELS.SALES_ORDER,
      detail: ds.salesOrder.docNo.trim(),
      sourceType: "SALES_ORDER",
    };
  }

  if (ds.mr?.docNo?.trim()) {
    return {
      category: LEGACY_HISTORICAL_DEMAND,
      detail: ds.mr.docNo.trim(),
      sourceType,
    };
  }

  if (ds.pr?.docNo?.trim()) {
    return {
      category: LEGACY_HISTORICAL_DEMAND,
      detail: ds.pr.docNo.trim(),
      sourceType,
    };
  }

  return { category: LEGACY_HISTORICAL_DEMAND, detail: null, sourceType };
}

function formatDemandSourceDisplay(presentation) {
  const p = presentation ?? { category: LEGACY_HISTORICAL_DEMAND, detail: null };
  if (p.detail?.trim()) return p.detail.trim();
  return p.category || LEGACY_HISTORICAL_DEMAND;
}

function formatDemandSourceLabel(ds) {
  return formatDemandSourceDisplay(resolveDemandSourcePresentation(ds));
}

function summarizePoProcurementSourceFromTrace(trace) {
  const labels = new Set();
  for (const line of trace?.lines || []) {
    const sources = line.demandSources?.length ? line.demandSources : [];
    if (!sources.length) {
      labels.add(LEGACY_HISTORICAL_DEMAND);
      continue;
    }
    for (const ds of sources) {
      labels.add(formatDemandSourceLabel(ds));
    }
  }
  if (!labels.size) return LEGACY_HISTORICAL_DEMAND;
  return [...labels].join(", ");
}

module.exports = {
  LEGACY_HISTORICAL_DEMAND,
  SOURCE_CATEGORY_LABELS,
  formatDemandSourceDisplay,
  formatDemandSourceLabel,
  resolveDemandSourcePresentation,
  summarizePoProcurementSourceFromTrace,
};
