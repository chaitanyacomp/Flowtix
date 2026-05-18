/**
 * Shared rules for Dispatch page open SO dropdown and dashboard dispatch KPI alignment.
 * NO_QTY cycle dispatch uses separate thresholds; do not apply NORMAL rules there.
 */

const { REPORT_QUEUE_EPS, computeSalesOrderDispatchLineStats } = require("./reportMetrics");

/**
 * Per-line: should this row appear on the Dispatch open list / SO dropdown?
 * @param {{ pendingDispatchQty?: unknown; dispatchPendingLock?: unknown; dispatchable?: unknown; dispatchableQty?: unknown; orderQty?: unknown; dispatched?: unknown }} lineStat
 * @param {string | null | undefined} orderType
 */
function isDispatchOpenListLineCandidate(lineStat, orderType) {
  const pend = Number(lineStat.pendingDispatchQty ?? 0);
  const lock = Number(lineStat.dispatchPendingLock ?? 0);
  const dbl = Number(lineStat.dispatchable ?? lineStat.dispatchableQty ?? 0);

  if (orderType === "NO_QTY") {
    return (
      pend > REPORT_QUEUE_EPS || dbl > REPORT_QUEUE_EPS || lock > REPORT_QUEUE_EPS
    );
  }

  const ordered = Number(lineStat.orderQty ?? 0);
  const dispatched = Number(lineStat.dispatched ?? 0);
  if (ordered > REPORT_QUEUE_EPS && dispatched + REPORT_QUEUE_EPS >= ordered) {
    return lock > REPORT_QUEUE_EPS;
  }

  if (lock > REPORT_QUEUE_EPS) return true;
  if (pend > REPORT_QUEUE_EPS && dbl > REPORT_QUEUE_EPS) return true;
  return false;
}

/**
 * @param {{ orderType?: string | null; lines?: unknown[]; dispatch?: unknown[] }} so
 * @param {number | undefined} invoicedQty
 */
function isSalesOrderCommerciallyClosedForDispatch(so, invoicedQty) {
  if (so.orderType === "NO_QTY") return false;
  const { dispatchSummary } = computeSalesOrderDispatchLineStats(
    so.lines ?? [],
    so.dispatch ?? [],
    so.orderType,
  );
  if (!dispatchSummary.fullyDispatched) return false;
  const totalDispatched = Number(dispatchSummary.totalDispatched ?? 0);
  if (!(totalDispatched > REPORT_QUEUE_EPS)) return true;
  const inv = Number(invoicedQty ?? 0);
  return inv + REPORT_QUEUE_EPS >= totalDispatched;
}

/**
 * SO-level exclusion before line filtering (status, commercial closure).
 * @param {{ orderType?: string | null; internalStatus?: string | null; lines?: unknown[]; dispatch?: unknown[] }} so
 * @param {number | undefined} invoicedQty
 */
function shouldExcludeSalesOrderFromDispatchOpenList(so, invoicedQty) {
  if (so.orderType === "NO_QTY") {
    return so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED";
  }
  if (so.internalStatus === "DRAFT") return true;
  if (so.internalStatus === "COMPLETED") return true;
  if (so.internalStatus === "CLOSED" || so.internalStatus === "MANUALLY_CLOSED") return true;
  if (isSalesOrderCommerciallyClosedForDispatch(so, invoicedQty)) return true;
  return false;
}

/**
 * @param {Array<Record<string, unknown>> | null | undefined} lineStats
 * @param {string | null | undefined} orderType
 */
function filterLineStatsForDispatchOpenList(lineStats, orderType) {
  return (lineStats || []).filter((l) => isDispatchOpenListLineCandidate(l, orderType));
}

/**
 * @param {{ lineStats?: Array<Record<string, unknown>>; orderType?: string | null }} so
 */
function salesOrderHasDispatchOpenListLines(so) {
  return filterLineStatsForDispatchOpenList(so.lineStats, so.orderType).length > 0;
}

module.exports = {
  isDispatchOpenListLineCandidate,
  isSalesOrderCommerciallyClosedForDispatch,
  shouldExcludeSalesOrderFromDispatchOpenList,
  filterLineStatsForDispatchOpenList,
  salesOrderHasDispatchOpenListLines,
};
