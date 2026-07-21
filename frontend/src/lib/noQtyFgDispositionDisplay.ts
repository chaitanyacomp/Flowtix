/**
 * NO_QTY accepted-FG disposition labels — business identity only (never raw DB IDs).
 */

import { formatQuantityWithUnit } from "./quantityDisplay";

export const UNKNOWN_FG_ITEM_LABEL = "Unknown item — data correction required";

export type AcceptedFgDispositionItemView = {
  itemId: number;
  itemCode?: string | null;
  itemName?: string | null;
  unit?: string | null;
  identityResolved?: boolean;
  quantity?: number | null;
  acceptedFgPendingDispositionQty?: number | null;
  workOrderNumber?: string | null;
  productionBatchNumber?: string | null;
  cycleNo?: number | null;
  cycleReference?: string | null;
};

function trimLabel(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

export function isAcceptedFgIdentityResolved(row: AcceptedFgDispositionItemView | null | undefined): boolean {
  if (!row) return false;
  if (row.identityResolved === false) return false;
  if (row.identityResolved === true && trimLabel(row.itemName)) return true;
  return Boolean(trimLabel(row.itemName));
}

/** Headline: "HDPE Cap – FG-001" or unknown-item copy. Never "Item ID 96". */
export function formatAcceptedFgItemHeadline(row: AcceptedFgDispositionItemView | null | undefined): string {
  if (!isAcceptedFgIdentityResolved(row)) return UNKNOWN_FG_ITEM_LABEL;
  const name = trimLabel(row?.itemName)!;
  const code = trimLabel(row?.itemCode);
  return code ? `${name} – ${code}` : name;
}

export function acceptedFgPendingQty(row: AcceptedFgDispositionItemView | null | undefined): number {
  const q = Number(row?.quantity ?? row?.acceptedFgPendingDispositionQty ?? 0);
  return Number.isFinite(q) ? q : 0;
}

/** e.g. "187 Nos accepted stock pending disposition" */
export function formatAcceptedFgPendingQtyLine(row: AcceptedFgDispositionItemView | null | undefined): string {
  const qty = acceptedFgPendingQty(row);
  const unit = trimLabel(row?.unit) || "Nos";
  const qtyLabel = formatQuantityWithUnit(qty, { unit, category: "fg" });
  return `${qtyLabel} accepted stock pending disposition`;
}

/** e.g. "Source: WO-26-0003 · Batch PE-26-0003 · Cycle 2" */
export function formatAcceptedFgSourceLine(row: AcceptedFgDispositionItemView | null | undefined): string | null {
  if (!row) return null;
  const parts: string[] = [];
  const wo = trimLabel(row.workOrderNumber);
  const batch = trimLabel(row.productionBatchNumber);
  const cycle = trimLabel(row.cycleReference) || (row.cycleNo != null && Number(row.cycleNo) > 0 ? `Cycle ${row.cycleNo}` : null);
  if (wo) parts.push(wo);
  if (batch) parts.push(`Batch ${batch}`);
  if (cycle) parts.push(cycle);
  if (!parts.length) return null;
  return `Source: ${parts.join(" · ")}`;
}

export function canTransferAcceptedFgToGeneralStock(
  row: AcceptedFgDispositionItemView | null | undefined,
): boolean {
  return isAcceptedFgIdentityResolved(row);
}

/** Confirmation blurb before applying a disposition decision. */
export function formatAcceptedFgDispositionConfirmSummary(
  row: AcceptedFgDispositionItemView | null | undefined,
  dispositionLabel: string,
): string {
  const headline = formatAcceptedFgItemHeadline(row);
  const qtyLine = formatAcceptedFgPendingQtyLine(row);
  const source = formatAcceptedFgSourceLine(row);
  const bits = [`Decision: ${dispositionLabel}`, headline, qtyLine];
  if (source) bits.push(source);
  return bits.join("\n");
}
