const { effectiveQtyPerUnitWithHeaderLosses } = require("./bomWeightPlanning");

/** effective RM qty per 1 unit of FG (legacy: wastagePercent only). */
function effectiveQtyPerUnit(baseQty, wastagePercent, qcLossPercent = 0) {
  return Number(baseQty);
}

module.exports = { effectiveQtyPerUnit, effectiveQtyPerUnitWithHeaderLosses };
