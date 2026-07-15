/**
 * Canonical NO_QTY dispatchable quantity.
 *
 * dispatchable = min(remaining customer demand, remaining QC pool, available FG stock)
 *
 * Used by dispatch routes, dashboard snapshots, and reports. Do not duplicate this formula elsewhere.
 */

const { REPORT_QUEUE_EPS } = require("./reportMetrics");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {{ alreadyOpNet: number; customerDemandQty?: number; qcAcceptedThisCycle?: number; recheckAcceptedThisCycle?: number; postCycleApprovalQty?: number; availableFgStock?: number }} p
 * @returns {number}
 */
function computeNoQtyDispatchHeadroom(p) {
  const net = num(p.alreadyOpNet);
  const qc = num(p.qcAcceptedThisCycle);
  const recheck = num(p.recheckAcceptedThisCycle ?? 0);
  const post = num(p.postCycleApprovalQty ?? 0);
  const qcRemaining = Math.max(0, qc + recheck + post - net);
  const demandRemaining = p.customerDemandQty == null ? Number.POSITIVE_INFINITY : Math.max(0, num(p.customerDemandQty) - net);
  const stock = p.availableFgStock == null ? Number.POSITIVE_INFINITY : Math.max(0, num(p.availableFgStock));
  return Math.max(0, Math.min(demandRemaining, qcRemaining, stock));
}

module.exports = {
  REPORT_QUEUE_EPS,
  computeNoQtyDispatchHeadroom,
};
