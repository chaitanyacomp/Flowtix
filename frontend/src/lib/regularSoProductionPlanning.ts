/** REGULAR SO production-planning buffer % — mirrors backend clamp / planned-qty math. */

export const REGULAR_SO_BUFFER_PERCENT_SOFT_MAX = 5;
export const REGULAR_SO_BUFFER_PERCENT_MAX = 10;
export const REGULAR_SO_BUFFER_PERCENT_DECIMALS = 2;

const EPS = 1e-9;

function n(value: unknown): number {
  const x = typeof value === "number" ? value : Number(value);
  return Number.isFinite(x) ? x : NaN;
}

/** Round to at most `decimals` places without integer Math.round on the whole percent. */
export function roundRegularSoBufferPercent(value: number, decimals = REGULAR_SO_BUFFER_PERCENT_DECIMALS): number {
  const p = n(value);
  if (!Number.isFinite(p)) return 0;
  const factor = 10 ** decimals;
  return Math.round((p + Number.EPSILON) * factor) / factor;
}

/**
 * Clamp into the hard band [0, 10] and normalize to ≤2 decimal places.
 * Does not integer-round (0.5 stays 0.5).
 */
export function clampRegularSoBufferPercent(value: number): number {
  const p = n(value);
  if (!Number.isFinite(p)) return 0;
  const clamped = Math.min(REGULAR_SO_BUFFER_PERCENT_MAX, Math.max(0, p));
  return roundRegularSoBufferPercent(clamped);
}

export function parseRegularSoBufferPercentInput(raw: string): number | null {
  const t = String(raw).trim().replace(",", ".");
  if (t === "" || t === ".") return null;
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const num = Number(t.startsWith(".") ? `0${t}` : t);
  if (!Number.isFinite(num)) return null;
  return num;
}

/** True when the typed value has more than the allowed fraction digits (before blur normalize). */
export function regularSoBufferPercentExceedsFractionDigits(
  raw: string,
  maxDecimals = REGULAR_SO_BUFFER_PERCENT_DECIMALS,
): boolean {
  const t = String(raw).trim().replace(",", ".");
  const m = /^(?:\d+)\.(\d+)$/.exec(t);
  if (!m) return false;
  return m[1].length > maxDecimals;
}

export type RegularSoBufferPercentBand = "ALLOWED" | "REQUIRES_ADMIN_APPROVAL" | "BLOCKED";

/**
 * 0–5%: allowed · above 5% through 10%: reason + Admin · above 10%: blocked.
 */
export function classifyRegularSoBufferPercent(value: number): RegularSoBufferPercentBand {
  const p = n(value);
  if (!Number.isFinite(p) || p < -EPS) return "BLOCKED";
  if (p > REGULAR_SO_BUFFER_PERCENT_MAX + EPS) return "BLOCKED";
  if (p > REGULAR_SO_BUFFER_PERCENT_SOFT_MAX + EPS) return "REQUIRES_ADMIN_APPROVAL";
  return "ALLOWED";
}

export function regularSoBufferPercentRequiresAdminApproval(value: number): boolean {
  return classifyRegularSoBufferPercent(value) === "REQUIRES_ADMIN_APPROVAL";
}

export function regularSoBufferPercentIsBlocked(value: number): boolean {
  return classifyRegularSoBufferPercent(value) === "BLOCKED";
}

/**
 * Apply FG UOM precision to a planned quantity.
 * Uses floor for 0-dp units so we never round the WO qty upward past the decimal product.
 */
export function applyFgUomPrecisionToPlannedQty(qty: number, decimalPlaces = 0): number {
  const q = n(qty);
  if (!Number.isFinite(q) || q <= 0) return 0;
  const dp = Math.max(0, Math.floor(Number(decimalPlaces) || 0));
  if (dp <= 0) return Math.floor(q + EPS);
  const factor = 10 ** dp;
  return Math.floor(q * factor + EPS) / factor;
}

/**
 * Cap planned qty by RM-supported capacity (never increase past RM max).
 */
export function capPlannedQtyByRmSupportedMax(
  plannedQty: number,
  rmSupportedMaxQty: number | null | undefined,
): number {
  const planned = Math.max(0, n(plannedQty) || 0);
  if (rmSupportedMaxQty == null) return planned;
  const cap = Number(rmSupportedMaxQty);
  if (!Number.isFinite(cap) || cap < 0) return planned;
  return Math.min(planned, cap);
}

export type ProductionPlanningMetrics = {
  customerCommittedQty: number;
  productionBufferPercent: number;
  productionBufferQty: number;
  plannedProductionQty: number;
  fgStockAdjustmentQty: number;
  rmPlanningQty: number;
};

/**
 * plannedProductionQty = baseQty × (1 + bufferPercent / 100), then FG UOM precision, then RM cap.
 * Buffer qty is the delta after precision (not a separately ceil'd component).
 */
export function computeProductionPlanningMetrics(
  customerCommittedQty: number,
  bufferPercent: number,
  fgStockAdjustmentQty: number,
  opts?: {
    uomDecimalPlaces?: number;
    rmSupportedMaxQty?: number | null;
  },
): ProductionPlanningMetrics {
  const customer = Math.max(0, n(customerCommittedQty) || 0);
  const pct = clampRegularSoBufferPercent(bufferPercent);
  const rawPlanned = customer * (1 + pct / 100);
  let plannedProductionQty = applyFgUomPrecisionToPlannedQty(rawPlanned, opts?.uomDecimalPlaces ?? 0);
  plannedProductionQty = capPlannedQtyByRmSupportedMax(plannedProductionQty, opts?.rmSupportedMaxQty);
  const productionBufferQty = Math.max(0, plannedProductionQty - customer);
  const fgStock = Math.max(0, n(fgStockAdjustmentQty) || 0);
  return {
    customerCommittedQty: customer,
    productionBufferPercent: pct,
    productionBufferQty,
    plannedProductionQty,
    fgStockAdjustmentQty: fgStock,
    rmPlanningQty: plannedProductionQty,
  };
}

/** Format buffer percent for display labels (e.g. "0.5"). */
export function formatRegularSoBufferPercentDisplay(value: number): string {
  const pct = clampRegularSoBufferPercent(value);
  return String(roundRegularSoBufferPercent(pct));
}
