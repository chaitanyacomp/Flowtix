const { effectiveQtyPerUnitWithHeaderLosses } = require("./bomWeightPlanning");

/** effective RM qty per 1 unit of FG (legacy: wastagePercent only). */
function effectiveQtyPerUnit(baseQty, wastagePercent, qcLossPercent = 0) {
  return Number(baseQty);
}

/**
 * Normalize optional non-negative decimal master fields (e.g. standardPurgingQtyGrams).
 * Blank / null / omitted → 0. Rejects negatives, non-numeric strings, NaN, Infinity.
 * @param {unknown} value
 * @param {string} fieldLabel
 * @returns {number}
 */
function parseOptionalNonNegativeDecimal(value, fieldLabel = "Value") {
  if (value == null || value === "") return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      const err = new Error(`${fieldLabel} must be a valid number.`);
      err.statusCode = 400;
      throw err;
    }
    if (value < 0) {
      const err = new Error(`${fieldLabel} cannot be negative.`);
      err.statusCode = 400;
      throw err;
    }
    return value;
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (raw === "") return 0;
    // Reject malformed / scientific / signed-empty strings; do not coerce silently.
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
      const err = new Error(`${fieldLabel} must be a valid number.`);
      err.statusCode = 400;
      throw err;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      const err = new Error(`${fieldLabel} must be a valid number.`);
      err.statusCode = 400;
      throw err;
    }
    if (n < 0) {
      const err = new Error(`${fieldLabel} cannot be negative.`);
      err.statusCode = 400;
      throw err;
    }
    return n;
  }
  const err = new Error(`${fieldLabel} must be a valid number.`);
  err.statusCode = 400;
  throw err;
}

const STANDARD_PURGING_QTY_LABEL = "Standard Purging Qty per Setup";

/** @param {unknown} value */
function parseStandardPurgingQtyGrams(value) {
  return parseOptionalNonNegativeDecimal(value, STANDARD_PURGING_QTY_LABEL);
}

module.exports = {
  effectiveQtyPerUnit,
  effectiveQtyPerUnitWithHeaderLosses,
  parseOptionalNonNegativeDecimal,
  parseStandardPurgingQtyGrams,
  STANDARD_PURGING_QTY_LABEL,
};
