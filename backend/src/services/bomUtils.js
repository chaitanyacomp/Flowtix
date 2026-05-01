/** effective RM qty per 1 unit of FG */
function effectiveQtyPerUnit(baseQty, wastagePercent) {
  return Number(baseQty) * (1 + Number(wastagePercent) / 100);
}

module.exports = { effectiveQtyPerUnit };
