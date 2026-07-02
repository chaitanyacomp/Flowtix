/**
 * Single source of truth for dispatch workspace operational quantities (per SO line).
 * Backend computes once; frontend renders only.
 */

const EPS = 1e-9;

/** @typedef {'READY' | 'DRAFT_CREATED' | 'PARTIALLY_DRAFTED' | 'DISPATCHED' | 'NOT_READY'} DispatchLineStatus */

/**
 * @param {number} remaining
 * @param {number} draft
 * @param {number} finalized
 * @returns {DispatchLineStatus}
 */
function resolveDispatchLineStatus(remaining, draft, finalized) {
  const r = Math.max(0, Number(remaining) || 0);
  const d = Math.max(0, Number(draft) || 0);
  const f = Math.max(0, Number(finalized) || 0);
  if (d > EPS && r <= EPS) return "DRAFT_CREATED";
  if (d > EPS && r > EPS) return "PARTIALLY_DRAFTED";
  if (r > EPS) return "READY";
  if (f > EPS && r <= EPS && d <= EPS) return "DISPATCHED";
  return "NOT_READY";
}

/** @param {DispatchLineStatus} status */
function dispatchLineStatusLabel(status) {
  switch (status) {
    case "DRAFT_CREATED":
      return "Draft Saved";
    case "PARTIALLY_DRAFTED":
      return "Partial Draft";
    case "READY":
      return "Ready";
    case "DISPATCHED":
      return "Dispatched";
    default:
      return "—";
  }
}

/**
 * Derive authoritative dispatch quantities from existing line-stat fields.
 * @param {Record<string, unknown>} lineStat
 */
function enrichDispatchLineQuantities(lineStat) {
  const remainingDispatchableQty = Math.max(
    0,
    Number(lineStat.dispatchable ?? lineStat.dispatchableQty ?? 0) || 0,
  );
  const dispatchDraftQty = Math.max(0, Number(lineStat.dispatchPendingLock ?? 0) || 0);
  const finalizedDispatchQty = Math.max(0, Number(lineStat.dispatched ?? 0) || 0);
  const originalReadyQty = remainingDispatchableQty + dispatchDraftQty + finalizedDispatchQty;
  const dispatchStatus = resolveDispatchLineStatus(
    remainingDispatchableQty,
    dispatchDraftQty,
    finalizedDispatchQty,
  );
  return {
    ...lineStat,
    originalReadyQty,
    dispatchDraftQty,
    finalizedDispatchQty,
    remainingDispatchableQty,
    dispatchStatus,
    dispatchStatusLabel: dispatchLineStatusLabel(dispatchStatus),
  };
}

/**
 * @param {Array<Record<string, unknown>> | null | undefined} lineStats
 */
function enrichDispatchLineStatsArray(lineStats) {
  return (lineStats || []).map((row) => enrichDispatchLineQuantities(row));
}

/**
 * @param {{ lineStats?: Array<Record<string, unknown>> } & Record<string, unknown>} so
 */
function enrichSalesOrderDispatchQuantities(so) {
  const lineStats = enrichDispatchLineStatsArray(so.lineStats);
  const totalRemainingDispatchableQty = lineStats.reduce(
    (sum, row) => sum + Number(row.remainingDispatchableQty ?? 0),
    0,
  );
  return {
    ...so,
    lineStats,
    totalRemainingDispatchableQty,
  };
}

module.exports = {
  EPS,
  resolveDispatchLineStatus,
  dispatchLineStatusLabel,
  enrichDispatchLineQuantities,
  enrichDispatchLineStatsArray,
  enrichSalesOrderDispatchQuantities,
};
