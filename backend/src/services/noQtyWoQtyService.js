/**
 * NO_QTY cycle-wise executable WO qty (operational production).
 *
 * Phase 2B: after Keep, locked Final RS Qty =
 *   Customer Demand + Production Shortage + Final QC Rejection
 * lives on totalRsQty / suggestedWoQtySnapshot. requirementQty remains base demand only.
 * Downstream WO/execution must use the locked final quantity — never baseDemandQty alone after Keep.
 */

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Authoritative locked Final RS qty for WO / RS-balance / execution.
 * Preference: suggestedWoQtySnapshot → totalRsQty → requirementQty (legacy / draft fallback).
 *
 * @param {{
 *   requirementQty?: number | string | null;
 *   totalRsQty?: number | string | null;
 *   suggestedWoQtySnapshot?: number | string | null;
 *   baseDemandQty?: number | string | null;
 * }} rsLine
 * @returns {number}
 */
function resolveNoQtyWoExecutableQty(rsLine) {
  const snap = round3(n(rsLine?.suggestedWoQtySnapshot));
  // A present snapshot is the operational production requirement, including zero after
  // prior QC-accepted excess. totalRsQty remains unchanged customer demand/recovery.
  if (rsLine?.suggestedWoQtySnapshot != null) return Math.max(0, snap);

  const total = round3(n(rsLine?.totalRsQty));
  if (total > 0) return total;

  const req = round3(n(rsLine?.requirementQty));
  if (req > 0) return req;

  return 0;
}

module.exports = {
  resolveNoQtyWoExecutableQty,
  round3,
};
