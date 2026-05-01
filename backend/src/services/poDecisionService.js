const { effectiveQtyPerUnit } = require("./bomUtils");

async function getRmRequirementForFgQty(tx, fgItemId, fgQty) {
  const bom = await tx.bom.findUnique({
    where: { fgItemId },
    include: { lines: true },
  });
  if (!bom) return null;
  return bom.lines.map((l) => ({
    rmItemId: l.rmItemId,
    requiredQty: effectiveQtyPerUnit(l.baseQty, l.wastagePercent) * Number(fgQty),
  }));
}

module.exports = { getRmRequirementForFgQty };
