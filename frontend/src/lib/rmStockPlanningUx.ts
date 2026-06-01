/** RM Stock Planning — client-side guards (display/selection only; backend unchanged). */

export type RmStockPlanningQtyRow = {
  pendingReplenishmentQty: number;
  shortageQty: number;
  usableStock?: number;
  minimumStockQty?: number;
};

export const REPLENISHMENT_IN_PROGRESS_LABEL = "Replenishment already in progress";
export const STOCK_SUFFICIENT_LABEL = "Stock sufficient";

export function hasReplenishmentShortage(row: RmStockPlanningQtyRow): boolean {
  const shortage = Number(row.shortageQty);
  return Number.isFinite(shortage) && shortage > 0;
}

/** Pending MR/PR covers minimum — no new MR until shortage returns. */
export function isReplenishmentInProgress(row: RmStockPlanningQtyRow): boolean {
  const pending = Number(row.pendingReplenishmentQty);
  return Number.isFinite(pending) && pending > 0 && !hasReplenishmentShortage(row);
}

export function isStockSufficientRow(row: RmStockPlanningQtyRow): boolean {
  if (hasReplenishmentShortage(row)) return false;
  if (isReplenishmentInProgress(row)) return false;
  const stock = Number(row.usableStock);
  const minimum = Number(row.minimumStockQty);
  if (Number.isFinite(stock) && Number.isFinite(minimum) && minimum > 0) {
    return stock >= minimum;
  }
  return !hasReplenishmentShortage(row);
}

export function isRowOrderQtyLocked(row: RmStockPlanningQtyRow): boolean {
  return !hasReplenishmentShortage(row);
}

export function getRmStockPlanningRowStatus(row: RmStockPlanningQtyRow): string | null {
  if (hasReplenishmentShortage(row)) return null;
  if (isReplenishmentInProgress(row)) return REPLENISHMENT_IN_PROGRESS_LABEL;
  if (isStockSufficientRow(row)) return STOCK_SUFFICIENT_LABEL;
  if (!hasReplenishmentShortage(row)) return STOCK_SUFFICIENT_LABEL;
  return null;
}

/** Selectable only when live shortage exists and user entered order qty. */
export function isRowSelectableForReplenishmentMr(row: RmStockPlanningQtyRow, orderQty: number): boolean {
  if (!hasReplenishmentShortage(row)) return false;
  const qty = Number(orderQty);
  return Number.isFinite(qty) && qty > 0;
}
