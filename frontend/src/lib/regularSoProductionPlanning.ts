/** Mirrors backend `clampBufferPercent` / snapshot line math (REGULAR SO only). */

export const REGULAR_SO_BUFFER_PERCENT_MAX = 10;

export function clampRegularSoBufferPercent(value: number): number {
  const p = Math.round(Number(value));
  if (!Number.isFinite(p)) return 0;
  return Math.min(REGULAR_SO_BUFFER_PERCENT_MAX, Math.max(0, p));
}

export function parseRegularSoBufferPercentInput(raw: string): number | null {
  const t = String(raw).trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
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
 * plannedProductionQty = customerCommittedQty + bufferQty
 * rmPlanningQty = plannedProductionQty (FG surplus in store is informational only)
 */
export function computeProductionPlanningMetrics(
  customerCommittedQty: number,
  bufferPercent: number,
  fgStockAdjustmentQty: number,
): ProductionPlanningMetrics {
  const customer = Math.max(0, Math.floor(Number(customerCommittedQty) || 0));
  const pct = clampRegularSoBufferPercent(bufferPercent);
  const productionBufferQty = Math.ceil((customer * pct) / 100);
  const plannedProductionQty = customer + productionBufferQty;
  const fgStock = Math.max(0, Number(fgStockAdjustmentQty) || 0);
  const rmPlanningQty = plannedProductionQty;
  return {
    customerCommittedQty: customer,
    productionBufferPercent: pct,
    productionBufferQty,
    plannedProductionQty,
    fgStockAdjustmentQty: fgStock,
    rmPlanningQty,
  };
}
