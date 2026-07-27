/**
 * Stock Summary presentation — Usable Qty vs Total Accounted.
 * Derives display values from existing godown-overview fields only.
 * Does not change stock movement or inventory calculations.
 */

export const STOCK_SUMMARY_USABLE_QTY_TOOLTIP =
  "Usable Qty is stock currently available for new work or dispatch.";

export type StockSummaryUsableQtySource = {
  itemType?: string | null;
  /** RM Available (free / uncommitted store stock). */
  freeStock?: number | null;
  /** FG Store USABLE (dispatchable store stock; excludes scrap/QC/WIP). */
  fgStore?: number | null;
};

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? Math.max(0, x) : 0;
}

/**
 * Usable Qty for Stock Summary rows:
 * - RM → Available (`freeStock`) — excludes committed/reserved
 * - FG → FG Store (`fgStore`) — excludes scrap, under QC, WIP, production
 */
export function resolveStockSummaryUsableQty(row: StockSummaryUsableQtySource | null | undefined): number {
  if (!row) return 0;
  const itemType = String(row.itemType ?? "").trim().toUpperCase();
  if (itemType === "RM") return n(row.freeStock);
  if (itemType === "FG") return n(row.fgStore);
  return 0;
}

/** Sum Usable Qty across godown section rows (presentation total). */
export function sumStockSummaryUsableQty(
  rows: ReadonlyArray<StockSummaryUsableQtySource> | null | undefined,
): number {
  if (!rows?.length) return 0;
  let total = 0;
  for (const row of rows) {
    total += resolveStockSummaryUsableQty(row);
  }
  return total;
}
