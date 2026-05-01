/**
 * Deep-link helpers for list pages until dedicated /entity/:id routes exist.
 * Query keys are stable; pages read them with useSearchParams.
 */

export const DRILL_QUERY = {
  salesOrderId: "salesOrderId",
  workOrderId: "workOrderId",
  /** RM purchase order header id (RmPurchaseOrder.id, matches RM Purchase page selection). */
  rmPoId: "poId",
  /** Stock summary row (item id). */
  itemId: "itemId",
  /** QC entry: selected production batch id in the URL. */
  productionId: "productionId",
} as const;

export function salesOrdersFocusHref(salesOrderId: number): string {
  return `/sales-orders?${DRILL_QUERY.salesOrderId}=${salesOrderId}`;
}

export function workOrdersFocusHref(workOrderId: number): string {
  return `/work-orders?${DRILL_QUERY.workOrderId}=${workOrderId}`;
}

/** QC entry: selects production batch for this work order when present. */
export function qcEntryFocusHref(workOrderId: number): string {
  return `/qc-entry?${DRILL_QUERY.workOrderId}=${workOrderId}`;
}

export function rmPoGrnFocusHref(purchaseOrderId: number): string {
  return `/rm-po-grn/${purchaseOrderId}`;
}

export function stockFocusHref(itemId: number): string {
  return `/stock?${DRILL_QUERY.itemId}=${itemId}`;
}

/** Dispatch workbench: focuses ledger row when supported by DispatchPage. */
export function dispatchLedgerFocusHref(dispatchId: number): string {
  return `/dispatch?dispatchId=${dispatchId}`;
}

/**
 * Appends `from=reports` so drill-down targets (WO, SO, stock, etc.) show **Back to Reports** via `PageSmartBackLink`
 * query resolution. Safe to call multiple times.
 */
export function withReportsReturnContext(href: string): string {
  if (/[?&](from|source)=reports(?:&|$)/.test(href)) return href;
  return href.includes("?") ? `${href}&from=reports` : `${href}?from=reports`;
}

/** True when the current URL carries report return context on `from` and/or `source` (either may be `reports`). */
export function isReportsReturnContext(search: string): boolean {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const from = (q.get("from") ?? "").trim().toLowerCase();
  const source = (q.get("source") ?? "").trim().toLowerCase();
  return from === "reports" || source === "reports";
}

/**
 * When the current location already carries report return context, propagate it to the next `href`
 * (e.g. list URL after delete, or post-create redirect). Otherwise returns `href` unchanged.
 */
export function withReportsReturnContextIfPresent(href: string, currentSearch: string): string {
  if (!isReportsReturnContext(currentSearch)) return href;
  return withReportsReturnContext(href);
}

export {
  DRILL_ACTIVATABLE_ROW_BASE_CLASS,
  DRILL_DOWN_ROW_CLASS,
  getDrillRowProps,
  isDrillRowNestedInteractiveTarget,
  NESTED_DRILL_STOP_SELECTOR,
} from "./drillDownRowProps";

/** Temporary emphasis after drill-down navigation (removed by useDrillFocus after a few seconds). */
export const DRILL_FOCUS_HIGHLIGHT_MS = 3800;

/**
 * Tailwind classes applied then removed by useDrillFocus. Keep as one string; split on whitespace for classList.
 * Slightly softer ring than keyboard focus so both can coexist briefly on the same row.
 */
export const DRILL_FOCUS_HIGHLIGHT_CLASS =
  "ring-2 ring-sky-500/40 ring-offset-2 ring-offset-white shadow-sm transition-shadow duration-300 ease-out rounded-md";

/** Stable data attributes for drill focus targets (use with useDrillFocus). */
export const DRILL_DATA = {
  salesOrderId: "data-sales-order-id",
  workOrderId: "data-work-order-id",
  itemId: "data-item-id",
  poId: "data-po-id",
  productionId: "data-production-id",
} as const;
