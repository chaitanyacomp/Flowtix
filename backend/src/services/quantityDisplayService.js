/**
 * ERP-wide quantity display standard (P16-UX-UOM) — backend mirror of frontend quantityDisplay.
 */

const {
  fgQtyDecimalPlaces,
  normalizeUnitToken,
  roundFgQty,
} = require("./itemQtyPrecision");

/**
 * @param {string | null | undefined} unit
 * @returns {number}
 */
function qtyDecimalPlacesFromUnit(unit) {
  return fgQtyDecimalPlaces(unit);
}

/**
 * @param {string} fixed
 */
function stripTrailingZeros(fixed) {
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

/**
 * Format numeric portion only (no unit suffix).
 * @param {number | string | null | undefined} value
 * @param {string | null | undefined} [unit]
 * @param {{ decimalPlaces?: number | null, locale?: boolean, emptyValue?: string }} [opts]
 */
function formatQtyNumber(value, unit, opts = {}) {
  const emptyValue = opts.emptyValue ?? "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return emptyValue;

  const decimalPlaces =
    opts.decimalPlaces != null && Number.isFinite(opts.decimalPlaces)
      ? Math.max(0, Math.min(6, Math.trunc(opts.decimalPlaces)))
      : qtyDecimalPlacesFromUnit(unit);
  const rounded = roundFgQty(n, unit);
  const useLocale = opts.locale !== false;

  if (decimalPlaces <= 0) {
    const intVal = Math.round(rounded);
    if (useLocale && Math.abs(intVal) >= 1000) {
      return intVal.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    return String(intVal);
  }

  if (useLocale && Math.abs(rounded) >= 1000) {
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  return stripTrailingZeros(rounded.toFixed(decimalPlaces));
}

/**
 * @param {number | string | null | undefined} value
 * @param {string | { unit?: string | null, includeUnit?: boolean, decimalPlaces?: number | null, locale?: boolean, emptyValue?: string } | null | undefined} [options]
 */
function formatQuantityWithUnit(value, options) {
  const opts = typeof options === "string" || options == null ? { unit: options } : options;
  const unitLabel = String(opts.unit ?? "").trim();
  const includeUnit = opts.includeUnit ?? Boolean(unitLabel);
  const emptyValue = opts.emptyValue ?? "—";

  const n = Number(value);
  if (!Number.isFinite(n)) {
    return includeUnit && unitLabel ? `${emptyValue} ${unitLabel}` : emptyValue;
  }

  const qty = formatQtyNumber(n, opts.unit, {
    decimalPlaces: opts.decimalPlaces,
    locale: opts.locale,
    emptyValue,
  });
  return includeUnit && unitLabel ? `${qty} ${unitLabel}` : qty;
}

function formatRmQuantity(value, unit, options) {
  return formatQuantityWithUnit(value, { ...options, unit });
}

function formatFgQuantity(value, unit, options) {
  return formatQuantityWithUnit(value, { ...options, unit });
}

function formatStockQuantity(value, unit, options) {
  return formatQuantityWithUnit(value, { ...options, unit, category: "stock" });
}

function formatPlanningQuantity(value, unit, options) {
  return formatQuantityWithUnit(value, { ...options, unit, category: "planning" });
}

function formatDispatchQuantity(value, unit, options) {
  return formatQuantityWithUnit(value, { ...options, unit, category: "dispatch" });
}

function formatQcQuantity(value, unit, options) {
  return formatQuantityWithUnit(value, { ...options, unit, category: "qc" });
}

function formatConsumptionQuantity(value, unit, options) {
  return formatQuantityWithUnit(value, { ...options, unit, category: "consumption" });
}

function formatScrapQuantity(value, unit, options) {
  return formatQuantityWithUnit(value, { ...options, unit, category: "scrap" });
}

module.exports = {
  normalizeUnitToken,
  qtyDecimalPlacesFromUnit,
  formatQtyNumber,
  formatQuantityWithUnit,
  formatRmQuantity,
  formatFgQuantity,
  formatStockQuantity,
  formatPlanningQuantity,
  formatDispatchQuantity,
  formatQcQuantity,
  formatConsumptionQuantity,
  formatScrapQuantity,
};
