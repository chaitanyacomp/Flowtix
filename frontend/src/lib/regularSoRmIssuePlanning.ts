/** REGULAR_SO RM issue / capacity helpers (mirrors backend regularSoRmIssuePlanning). */

const STOCK_EPS = 1e-6;
export const ROUNDING_TOLERANCE_PERCENT = 0.005;
export const ROUNDING_TOLERANCE_MAX_KG = 0.5;

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function round3(v: number): number {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

export function scaleRmRequiredToWoTarget(
  bomRmForSalesOrderQty: number,
  salesOrderQty: number,
  woTargetQty: number,
): number {
  const bomRm = n(bomRmForSalesOrderQty);
  const soQty = n(salesOrderQty);
  const woQty = n(woTargetQty);
  if (bomRm <= STOCK_EPS || soQty <= STOCK_EPS || woQty <= STOCK_EPS) return 0;
  return round3(woQty * (bomRm / soQty));
}

export function computeRoundedDownToleranceQty(theoreticalRmRequiredQty: number): number {
  const theo = round3(Math.max(0, n(theoreticalRmRequiredQty)));
  if (theo <= STOCK_EPS) return 0;
  return round3(Math.min(theo * ROUNDING_TOLERANCE_PERCENT, ROUNDING_TOLERANCE_MAX_KG));
}

export function physicalRmSupportedProductionQty(netRmIssuedQty: number, bomConsumptionPerFg: number): number {
  const net = Math.max(0, n(netRmIssuedQty));
  const perFg = n(bomConsumptionPerFg);
  if (!(perFg > STOCK_EPS)) return 0;
  return Math.floor((net + STOCK_EPS) / perFg);
}

export function computeRegularSoProductionMaximum(input: {
  netRmIssuedQty: number;
  bomConsumptionPerFg: number;
  woTargetQty: number;
  roundingToleranceAcknowledged?: boolean;
}): number {
  const physical = physicalRmSupportedProductionQty(input.netRmIssuedQty, input.bomConsumptionPerFg);
  const target = Math.max(0, Math.floor(n(input.woTargetQty)));
  if (input.roundingToleranceAcknowledged && physical < target) return target;
  return physical;
}
