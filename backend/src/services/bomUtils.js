const { effectiveQtyPerUnitWithHeaderLosses } = require("./bomWeightPlanning");

/** effective RM qty per 1 unit of FG (legacy: wastagePercent only). */
function effectiveQtyPerUnit(baseQty, wastagePercent, qcLossPercent = 0) {
  const p = Number(wastagePercent ?? 0);
  const q = Number(qcLossPercent ?? 0);
  if (q > 0 || p > 0) {
    return effectiveQtyPerUnitWithHeaderLosses(baseQty, p, q);
  }
  return Number(baseQty) * (1 + p / 100);
}

module.exports = { effectiveQtyPerUnit, effectiveQtyPerUnitWithHeaderLosses };
