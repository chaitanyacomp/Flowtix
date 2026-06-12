/**
 * P1 — REGULAR SO procurement anchor is Sales Order (MR sourceType SALES_ORDER).
 * WORK_ORDER_PLANNING remains readable for legacy rows only.
 */

const REGULAR_SO_PROCUREMENT_SOURCE = "SALES_ORDER";
const LEGACY_REGULAR_SO_PROCUREMENT_SOURCE = "WORK_ORDER_PLANNING";

function regularSoProcurementSourceTypes() {
  return [REGULAR_SO_PROCUREMENT_SOURCE, LEGACY_REGULAR_SO_PROCUREMENT_SOURCE];
}

function isRegularSoProcurementSource(sourceType) {
  return regularSoProcurementSourceTypes().includes(String(sourceType ?? ""));
}

function regularSoProcurementSourceWhere() {
  return { sourceType: { in: regularSoProcurementSourceTypes() } };
}

module.exports = {
  REGULAR_SO_PROCUREMENT_SOURCE,
  LEGACY_REGULAR_SO_PROCUREMENT_SOURCE,
  regularSoProcurementSourceTypes,
  isRegularSoProcurementSource,
  regularSoProcurementSourceWhere,
};
