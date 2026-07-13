/** RM Stock Monitor — client-side guards (display/selection; backend enforces raise rules). */

export type RmStockPlanningQtyRow = {
  pendingReplenishmentQty?: number;
  openStockReplenishmentQty?: number;
  shortageQty?: number;
  usableStock?: number;
  currentStock?: number;
  minimumStockQty?: number;
  targetStockQty?: number | null;
  suggestedPurchaseQty?: number;
  canRaisePurchaseRequest?: boolean;
  eligibleForRequest?: boolean;
  monitorStatus?: "BELOW_MINIMUM" | "HEALTHY";
};

/** Selectable only when eligible (below minimum + net gap > 0) and qty > 0. */
export function isRowSelectableForReplenishmentMr(row: RmStockPlanningQtyRow, orderQty: number): boolean {
  if (!canRaisePurchaseRequestForRow(row)) return false;
  const qty = Number(orderQty);
  return Number.isFinite(qty) && qty > 0;
}

export function canRaisePurchaseRequestForRow(row: RmStockPlanningQtyRow): boolean {
  if (row.canRaisePurchaseRequest === true || row.eligibleForRequest === true) return true;
  const stock = Number(row.currentStock ?? row.usableStock);
  const minimum = Number(row.minimumStockQty);
  if (!(Number.isFinite(stock) && Number.isFinite(minimum) && minimum > 0 && stock < minimum)) {
    return false;
  }
  const suggested = Number(row.suggestedPurchaseQty);
  if (Number.isFinite(suggested)) return suggested > 0;
  return true;
}

export function isRowOrderQtyLocked(row: RmStockPlanningQtyRow): boolean {
  return !canRaisePurchaseRequestForRow(row);
}

/** Checkbox enabled for eligible rows regardless of typed qty (qty validated on submit). */
export function isRowCheckboxEnabled(row: RmStockPlanningQtyRow): boolean {
  return canRaisePurchaseRequestForRow(row);
}
