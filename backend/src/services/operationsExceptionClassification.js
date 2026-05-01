/**
 * Pure operations-exception classification (no DB). Used by operationsExceptionReport and tests.
 * @param {number} [refTimeMs] — for tests; defaults to Date.now()
 */

const { METRIC_CONTEXT } = require("./reportMetrics");

const ROW_NUM_EPS = 1e-6;

const OPERATIONS_EXCEPTION_CONFIG = {
  dispatch: {
    ageWarningDays: 10,
    ageCriticalDays: 14,
    pendingRatioWarning: 0.28,
    pendingRatioCritical: 0.5,
    comboMinPendingQty: 5,
    comboMinAgeDays: 7,
  },
  production: {
    ageWarningDays: 14,
    ageCriticalDays: 21,
    balanceRatioWarning: 0.35,
    balanceRatioCritical: 0.55,
  },
  qc: {
    pendingToProducedCriticalRatio: 0.45,
  },
  purchase: {
    ageCriticalDays: 28,
    pendingFracOfMaxCritical: 0.85,
  },
};

function daysSince(isoDate, refTimeMs = Date.now()) {
  return (refTimeMs - new Date(isoDate).getTime()) / 86400000;
}

function maxInSlice(nums) {
  if (nums.length === 0) return 0;
  return Math.max(...nums);
}

function buildDispatchExceptions(rows, refTimeMs) {
  const cfg = OPERATIONS_EXCEPTION_CONFIG.dispatch;
  const out = [];
  for (const r of rows) {
    const ageDays = daysSince(r.salesOrderDate, refTimeMs);
    const ordered = Math.max(r.orderedQty, ROW_NUM_EPS);
    const exceptionPendingShare = r.pendingQty / ordered;
    const isException =
      ageDays >= cfg.ageWarningDays ||
      exceptionPendingShare >= cfg.pendingRatioWarning ||
      (r.pendingQty >= cfg.comboMinPendingQty && ageDays >= cfg.comboMinAgeDays);
    if (!isException) continue;
    const critical =
      ageDays >= cfg.ageCriticalDays || exceptionPendingShare >= cfg.pendingRatioCritical;
    out.push({
      ...r,
      severity: critical ? "CRITICAL" : "WARNING",
      exceptionAgeDays: ageDays,
      exceptionPendingShare,
      exceptionClassificationContext: METRIC_CONTEXT.SO_FIFO,
    });
  }
  return out.sort((a, b) => b.exceptionAgeDays - a.exceptionAgeDays || b.pendingQty - a.pendingQty);
}

function buildProductionExceptions(rows, refTimeMs) {
  const cfg = OPERATIONS_EXCEPTION_CONFIG.production;
  const out = [];
  for (const r of rows) {
    if (r.balanceQty <= ROW_NUM_EPS) continue;
    const ageDays = daysSince(r.workOrderDate, refTimeMs);
    const denom = Math.max(r.requiredQty ?? r.workOrderQty ?? 0, ROW_NUM_EPS);
    const exceptionBalanceShare = r.balanceQty / denom;
    const isException = ageDays >= cfg.ageWarningDays || exceptionBalanceShare >= cfg.balanceRatioWarning;
    if (!isException) continue;
    const critical = ageDays >= cfg.ageCriticalDays || exceptionBalanceShare >= cfg.balanceRatioCritical;
    out.push({
      ...r,
      severity: critical ? "CRITICAL" : "WARNING",
      exceptionAgeDays: ageDays,
      exceptionBalanceShare,
      exceptionClassificationContext: METRIC_CONTEXT.WO_LINE,
    });
  }
  return out.sort((a, b) => b.exceptionAgeDays - a.exceptionAgeDays || b.balanceQty - a.balanceQty);
}

function buildQcExceptions(rows) {
  const ratioCrit = OPERATIONS_EXCEPTION_CONFIG.qc.pendingToProducedCriticalRatio;
  const out = [];
  for (const r of rows) {
    if (r.pendingQcQty <= ROW_NUM_EPS && r.rejectedQty <= ROW_NUM_EPS) continue;
    const produced = Math.max(r.producedQty, ROW_NUM_EPS);
    const exceptionPendingQcToProducedRatio =
      r.pendingQcQty > ROW_NUM_EPS ? r.pendingQcQty / produced : 0;
    const critical =
      r.rejectedQty > ROW_NUM_EPS ||
      (r.pendingQcQty > ROW_NUM_EPS && r.pendingQcQty >= produced * ratioCrit);
    out.push({
      ...r,
      severity: critical ? "CRITICAL" : "WARNING",
      exceptionPendingQcToProducedRatio,
      exceptionClassificationContext: METRIC_CONTEXT.QC_BATCH,
    });
  }
  return out.sort((a, b) => b.pendingQcQty - a.pendingQcQty || b.rejectedQty - a.rejectedQty);
}

function buildRmExceptions(rows) {
  const out = [];
  for (const r of rows) {
    if (r.status === "CRITICAL")
      out.push({ ...r, severity: "CRITICAL", exceptionClassificationContext: METRIC_CONTEXT.RM_PLANNING });
    else if (r.status === "LOW_BUFFER")
      out.push({ ...r, severity: "WARNING", exceptionClassificationContext: METRIC_CONTEXT.RM_PLANNING });
  }
  return out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "CRITICAL" ? -1 : 1;
    return b.shortageQty - a.shortageQty;
  });
}

function buildPurchaseExceptions(rows, refTimeMs) {
  if (rows.length === 0) return [];
  const cfg = OPERATIONS_EXCEPTION_CONFIG.purchase;
  const maxP = maxInSlice(rows.map((x) => x.pendingQty));
  return rows
    .map((r) => {
      const ageDays = daysSince(r.purchaseDate, refTimeMs);
      const exceptionPendingVsMaxShare = maxP > ROW_NUM_EPS ? r.pendingQty / maxP : 0;
      const critical =
        ageDays >= cfg.ageCriticalDays ||
        (maxP > ROW_NUM_EPS && r.pendingQty >= maxP * cfg.pendingFracOfMaxCritical);
      return {
        ...r,
        severity: critical ? "CRITICAL" : "WARNING",
        exceptionAgeDays: ageDays,
        exceptionPendingVsMaxShare,
        exceptionClassificationContext: METRIC_CONTEXT.RM_PO_LINE,
      };
    })
    .sort(
      (a, b) =>
        new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime() || b.pendingQty - a.pendingQty,
    );
}

function buildExceptionSummary({ dispatch, production, qc, rm, purchase }) {
  return {
    dispatchExceptionCount: dispatch.length,
    qcExceptionRowsWithPendingQc: qc.filter((r) => r.pendingQcQty > ROW_NUM_EPS).length,
    criticalRmItemCount: rm.filter((r) => r.severity === "CRITICAL").length,
    purchaseSummaryLineCount: purchase.length,
    productionExceptionCount: production.length,
  };
}

module.exports = {
  ROW_NUM_EPS,
  OPERATIONS_EXCEPTION_CONFIG,
  daysSince,
  maxInSlice,
  buildDispatchExceptions,
  buildProductionExceptions,
  buildQcExceptions,
  buildRmExceptions,
  buildPurchaseExceptions,
  buildExceptionSummary,
};
