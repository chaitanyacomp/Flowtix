const { rmRequiredForFgCount } = require("./bomWeightPlanning");
const { approvedBomWhere, approvedBomOrderBy } = require("./bomStatus");

async function getRmRequirementForFgQty(tx, fgItemId, fgQty) {
  const bom = await tx.bom.findFirst({
    where: approvedBomWhere(fgItemId),
    orderBy: approvedBomOrderBy,
    include: { lines: true },
  });
  if (!bom) return null;
  return bom.lines.map((l) => ({
    rmItemId: l.rmItemId,
    requiredQty: rmRequiredForFgCount(
      l.baseQty,
      Number(fgQty),
      bom.outputQty,
      l.wastagePercent,
      l.qcAllowancePercent,
      bom.normalizationMode,
    ),
  }));
}

module.exports = { getRmRequirementForFgQty };
