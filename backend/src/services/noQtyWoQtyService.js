/**
 * NO_QTY cycle-wise executable WO qty (operational production only).
 * Cumulative planning/procurement demand stays on RequirementSheetLine.suggestedWoQtySnapshot.
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
 * Cycle-wise WO executable qty from a requirement sheet line.
 * Uses new requirement only — ignores suggestedWoQtySnapshot (cumulative Total to Produce).
 *
 * @param {{ requirementQty?: number | string | null; suggestedWoQtySnapshot?: number | string | null }} rsLine
 * @returns {number}
 */
function resolveNoQtyWoExecutableQty(rsLine) {
  const req = round3(n(rsLine?.requirementQty));
  if (!(req > 0)) return 0;
  return req;
}

module.exports = {
  resolveNoQtyWoExecutableQty,
  round3,
};
