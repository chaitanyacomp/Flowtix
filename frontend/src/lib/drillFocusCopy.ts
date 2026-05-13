/**
 * Shared microcopy for drill focus banners and recovery actions.
 * Keeps dashboard, reports, and destination pages aligned.
 */

export const DRILL_FOCUS_CLEAR_LABEL = "Clear focus";

export const DRILL_RECOVERY_LABEL = {
  salesOrder: "Show sales order",
  workOrder: "Show work order",
  item: "Show item",
  purchaseOrder: "Show in Material Planning",
} as const;

export function drillFocusTitleSalesOrder(id: number): string {
  return `Focused from dashboard/report: Sales order #${id}`;
}

export function drillFocusTitleWorkOrder(id: number): string {
  return `Focused from drill-down: Work order #${id}`;
}

export function drillFocusTitleStockItem(id: number, itemName?: string): string {
  if (itemName?.trim()) {
    return `Focused from drill-down: ${itemName.trim()} (item #${id})`;
  }
  return `Focused from drill-down: Stock item #${id}`;
}

export function drillFocusTitleRmPo(id: number, supplierName?: string): string {
  if (supplierName?.trim()) {
    return `Focused from drill-down: RM purchase order #${id} — ${supplierName.trim()}`;
  }
  return `Focused from drill-down: RM purchase order #${id}`;
}

export function drillFocusTitleQcProduction(id: number): string {
  return `Focused from drill-down: Production #${id}`;
}

/** Soft-banner hints: not in loaded dataset */
export const DRILL_FOCUS_HINT_NOT_IN_LIST = {
  salesOrder:
    "Not in the current list. It may have been removed or not included in this view. Use Clear focus when finished.",
  workOrder:
    "Not in the current list. It may have been removed or not included in this view. Use Clear focus when finished.",
  stockItem: "This item has no row in the current stock summary. Use Clear focus when finished.",
  purchaseOrder: "Not in the current list. It may have been deleted. Use Clear focus when finished.",
} as const;

/** Soft-banner hints: in data but hidden by filters */
export const DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS = {
  salesOrder: "Loaded but hidden by filters. Use Show sales order or Clear focus.",
  workOrder: "Loaded but hidden by search or status. Use Show work order or Clear focus.",
  stockItem: "Loaded but hidden by type or search. Use Show item or Clear focus.",
  purchaseOrder: "Loaded but hidden by list filters. Use Show in Material Planning or Clear focus.",
} as const;

/** QC-specific (no URL list filters; recovery is Clear focus only) */
export const DRILL_FOCUS_HINT_QC = {
  woNoBatch:
    "No QC-waiting batch is linked to that work order. You may be redirected to Work orders, or use Clear focus.",
  productionMissing: "That production row is not in the QC-waiting queue. Use Clear focus.",
  emptyQueue: "The QC queue is empty. Use Clear focus to remove the link from the address bar.",
} as const;

/** Empty table body: extra line when drill target exists but row hidden by filters */
export const DRILL_FOCUS_EMPTY_FILTERED_SUFFIX = {
  salesOrder:
    "A sales order is focused in the address bar — use Show sales order in the banner, or Clear focus.",
  workOrder:
    "A work order is focused in the address bar — use Show work order in the banner, or Clear focus.",
  stockItem: "An item is focused in the address bar — use Show item in the banner, or Clear focus.",
  purchaseOrder:
    "A PO is focused in the address bar — use Show in Material Planning in the banner, or Clear focus.",
} as const;
