/**
 * P2 — Purchase-facing demand pools separated by procurement anchor.
 * REGULAR_SO (SALES_ORDER), MPRS (MONTHLY_PLAN), STOCK_REPLENISHMENT.
 * Legacy WORK_ORDER_PLANNING is read-compatible elsewhere but excluded from pool aggregation.
 */

const { LEGACY_REGULAR_SO_PROCUREMENT_SOURCE, REGULAR_SO_PROCUREMENT_SOURCE } = require("./regularSoProcurementSource");

const PROCUREMENT_DEMAND_POOL = Object.freeze({
  REGULAR_SO: "REGULAR_SO",
  MPRS: "MPRS",
  STOCK_REPLENISHMENT: "STOCK_REPLENISHMENT",
});

const MIXED_PROCUREMENT_DEMAND_POOL_CODE = "MIXED_PROCUREMENT_DEMAND_POOL";
const LEGACY_DEMAND_POOL_EXCLUDED_CODE = "LEGACY_DEMAND_POOL_EXCLUDED";

/** @type {Record<string, string[]>} */
const POOL_SOURCE_TYPES = Object.freeze({
  [PROCUREMENT_DEMAND_POOL.REGULAR_SO]: [REGULAR_SO_PROCUREMENT_SOURCE],
  [PROCUREMENT_DEMAND_POOL.MPRS]: ["MONTHLY_PLAN"],
  [PROCUREMENT_DEMAND_POOL.STOCK_REPLENISHMENT]: ["STOCK_REPLENISHMENT"],
});

const POOL_LABELS = Object.freeze({
  [PROCUREMENT_DEMAND_POOL.REGULAR_SO]: "Regular Sales Order",
  [PROCUREMENT_DEMAND_POOL.MPRS]: "Monthly Plan (MPRS)",
  [PROCUREMENT_DEMAND_POOL.STOCK_REPLENISHMENT]: "Stock Replenishment",
});

const ALL_DEMAND_POOL_KEYS = Object.freeze(Object.values(PROCUREMENT_DEMAND_POOL));

/** Map legacy workspace sourceType query values to demand pool keys. */
const SOURCE_TYPE_TO_DEMAND_POOL = Object.freeze({
  SALES_ORDER: PROCUREMENT_DEMAND_POOL.REGULAR_SO,
  MONTHLY_PLAN: PROCUREMENT_DEMAND_POOL.MPRS,
  STOCK_REPLENISHMENT: PROCUREMENT_DEMAND_POOL.STOCK_REPLENISHMENT,
});

function normalizeDemandPoolKey(value) {
  const key = String(value ?? "").trim().toUpperCase();
  if (!key) return null;
  if (ALL_DEMAND_POOL_KEYS.includes(key)) return key;
  if (SOURCE_TYPE_TO_DEMAND_POOL[key]) return SOURCE_TYPE_TO_DEMAND_POOL[key];
  return null;
}

function sourceTypesForDemandPool(demandPool) {
  const key = normalizeDemandPoolKey(demandPool);
  if (!key) return null;
  return [...(POOL_SOURCE_TYPES[key] || [])];
}

function resolveDemandPoolForSourceType(sourceType) {
  const st = String(sourceType ?? "").trim();
  if (st === LEGACY_REGULAR_SO_PROCUREMENT_SOURCE) return null;
  for (const poolKey of ALL_DEMAND_POOL_KEYS) {
    if ((POOL_SOURCE_TYPES[poolKey] || []).includes(st)) return poolKey;
  }
  return null;
}

function demandPoolLabel(demandPool) {
  return POOL_LABELS[demandPool] ?? demandPool;
}

function assertSingleDemandPoolFromSourceTypes(sourceTypes, contextLabel = "procurement demand") {
  const pools = new Set();
  const legacy = [];
  const unknown = [];
  for (const sourceType of sourceTypes || []) {
    const st = String(sourceType ?? "").trim();
    if (!st) continue;
    if (st === LEGACY_REGULAR_SO_PROCUREMENT_SOURCE) {
      legacy.push(st);
      continue;
    }
    const pool = resolveDemandPoolForSourceType(st);
    if (pool) pools.add(pool);
    else unknown.push(st);
  }
  if (legacy.length && !pools.size && !unknown.length) {
    const err = new Error(
      "Legacy WORK_ORDER_PLANNING material requirements are not included in separated purchase demand pools. " +
        "Raise or migrate demand under SALES_ORDER (Regular SO) before sending to Purchase.",
    );
    err.statusCode = 400;
    err.code = LEGACY_DEMAND_POOL_EXCLUDED_CODE;
    throw err;
  }
  if (unknown.length) {
    const err = new Error(`Unsupported procurement source type for ${contextLabel}: ${unknown.join(", ")}.`);
    err.statusCode = 400;
    throw err;
  }
  if (pools.size > 1) {
    const err = new Error(
      `Cannot combine demand from multiple procurement pools in one ${contextLabel}. ` +
        `Use a single pool: ${ALL_DEMAND_POOL_KEYS.join(", ")}.`,
    );
    err.statusCode = 400;
    err.code = MIXED_PROCUREMENT_DEMAND_POOL_CODE;
    throw err;
  }
  return pools.size === 1 ? [...pools][0] : null;
}

function filterMrsByDemandPool(mrs, demandPool) {
  const types = sourceTypesForDemandPool(demandPool);
  if (!types?.length) return mrs || [];
  const allowed = new Set(types);
  return (mrs || []).filter((mr) => allowed.has(mr.sourceType));
}

module.exports = {
  PROCUREMENT_DEMAND_POOL,
  MIXED_PROCUREMENT_DEMAND_POOL_CODE,
  LEGACY_DEMAND_POOL_EXCLUDED_CODE,
  POOL_SOURCE_TYPES,
  normalizeDemandPoolKey,
  sourceTypesForDemandPool,
  resolveDemandPoolForSourceType,
  demandPoolLabel,
  assertSingleDemandPoolFromSourceTypes,
  filterMrsByDemandPool,
  ALL_DEMAND_POOL_KEYS,
};
