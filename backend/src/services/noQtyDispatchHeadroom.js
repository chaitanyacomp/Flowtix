/**
 * Canonical NO_QTY dispatch headroom — single source for cycle QC pool minus operational net.
 *
 * headroom = max(0, qcAccepted + recheckAccepted + postCycleApproval − alreadyOpNet)
 *
 * Used by dispatch routes, dashboard snapshots, and reports. Do not duplicate this formula elsewhere.
 */

const { REPORT_QUEUE_EPS } = require("./reportMetrics");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {{ alreadyOpNet: number; qcAcceptedThisCycle?: number; recheckAcceptedThisCycle?: number; postCycleApprovalQty?: number }} p
 * @returns {number}
 */
function computeNoQtyDispatchHeadroom(p) {
  const net = num(p.alreadyOpNet);
  const qc = num(p.qcAcceptedThisCycle);
  const recheck = num(p.recheckAcceptedThisCycle ?? 0);
  const post = num(p.postCycleApprovalQty ?? 0);
  return Math.max(0, qc + recheck + post - net);
}

module.exports = {
  REPORT_QUEUE_EPS,
  computeNoQtyDispatchHeadroom,
};
