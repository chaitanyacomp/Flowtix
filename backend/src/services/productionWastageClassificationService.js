const { qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");

const EPS = 1e-6;

function n(v) {
  return qtyToNumber(v);
}

function normalizeWastageDetailsInput(details) {
  const rows = [];
  for (const row of Array.isArray(details) ? details : []) {
    const wastageTypeId = Number(row?.wastageTypeId);
    const qty = round3(n(row?.qty));
    if (!Number.isFinite(wastageTypeId) || wastageTypeId <= 0) continue;
    if (!(qty > EPS)) continue;
    rows.push({
      wastageTypeId,
      itemId: Number.isFinite(Number(row?.itemId)) ? Number(row.itemId) : null,
      qty,
      remarks: String(row?.remarks ?? "").trim() || null,
      sortOrder: Number(row?.sortOrder ?? rows.length),
    });
  }
  return rows;
}

function sumWastageDetailQty(details) {
  return round3((details || []).reduce((acc, row) => acc + n(row.qty), 0));
}

function buildWastageClassificationMismatchError(totalWastageQty, detailedQty, unit = "Kg") {
  const err = new Error(
    `Total Wastage : ${round3(totalWastageQty)} ${unit}\n\nDetailed Wastage : ${round3(detailedQty)} ${unit}\n\nPlease classify the complete wastage before confirming.`,
  );
  err.statusCode = 409;
  err.code = "WASTAGE_CLASSIFICATION_MISMATCH";
  err.details = {
    totalWastageQty: round3(totalWastageQty),
    detailedWastageQty: round3(detailedQty),
    unit,
  };
  return err;
}

function assertWastageClassificationMatches(totalWastageQty, wastageDetails, unit = "Kg") {
  const total = round3(totalWastageQty);
  const detailed = sumWastageDetailQty(wastageDetails);
  if (total <= EPS) {
    if (detailed > EPS) {
      throw buildWastageClassificationMismatchError(total, detailed, unit);
    }
    return;
  }
  if (Math.abs(total - detailed) > EPS) {
    throw buildWastageClassificationMismatchError(total, detailed, unit);
  }
}

function mapWastageDetailRows(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    wastageTypeId: row.wastageTypeId,
    itemId: row.itemId ?? null,
    itemName: row.item?.itemName ?? null,
    unit: row.item?.unit ?? null,
    source: row.source ?? "MANUAL_PRODUCTION",
    wastageTypeName: row.wastageType?.name ?? null,
    wastageTypeCode: row.wastageType?.code ?? null,
    category: row.wastageType?.category ?? null,
    isActiveType: row.wastageType?.isActive ?? null,
    qty: round3(n(row.qty)),
    remarks: row.remarks ?? null,
    sortOrder: row.sortOrder ?? 0,
  }));
}

module.exports = {
  EPS,
  normalizeWastageDetailsInput,
  sumWastageDetailQty,
  assertWastageClassificationMatches,
  buildWastageClassificationMismatchError,
  mapWastageDetailRows,
};
