import { PROCUREMENT_TERMS } from "./procurementTerminology";

export const RM_PO_MODAL_DISCARD_CONFIRM = "Discard unsaved PO entry?";

/** Shared header control sizing — Supplier + Supplier PO Number stay aligned. */
export const RM_PO_MODAL_HEADER_GRID_CLASS = "grid grid-cols-1 items-start gap-3 md:grid-cols-2";
export const RM_PO_MODAL_HEADER_FIELD_CLASS =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";

/** Compact right-aligned decimal fields in the PO lines table (shared height for Order Qty + Rate). */
export const RM_PO_MODAL_QTY_INPUT_CLASS =
  "h-8 w-full max-w-[7.5rem] text-right tabular-nums";
export const RM_PO_MODAL_RATE_INPUT_CLASS =
  "h-8 w-full max-w-[7.5rem] text-right tabular-nums";
/** Shared input-row chrome so Order Qty (with unit) and Rate stay vertically aligned. */
export const RM_PO_MODAL_LINE_INPUT_ROW_CLASS = "flex h-8 w-full items-center justify-end";
export const RM_PO_MODAL_LINE_INPUT_HINT_CLASS =
  "mt-0.5 block min-h-[14px] text-[10px] leading-[14px]";

export type RmPoModalEntryBaseline = {
  supplierPoNumber: string;
  poRemarks: string;
  supplierId: number;
  poQty: Record<number, string>;
  rates: Record<number, string>;
};

export type PendingPrPoPrepUi = {
  showCheckboxes: boolean;
  showPrepareButton: boolean;
  readOnlyMessage: string | null;
};

/** PO preparation chrome — Store read-only, Purchase/Admin interactive. */
export function resolvePendingPrPoPrepUi(canPrepareRmPo = false): PendingPrPoPrepUi {
  if (canPrepareRmPo) {
    return {
      showCheckboxes: true,
      showPrepareButton: true,
      readOnlyMessage: null,
    };
  }
  return {
    showCheckboxes: false,
    showPrepareButton: false,
    readOnlyMessage: PROCUREMENT_TERMS.WAITING_FOR_PURCHASE_RM_PO,
  };
}

/** True when the create-PO modal has diverged from the snapshot taken at open. */
export function hasRmPoModalUnsavedEntry(
  baseline: RmPoModalEntryBaseline | null,
  current: RmPoModalEntryBaseline,
): boolean {
  if (!baseline) return false;
  if (current.supplierPoNumber.trim() !== baseline.supplierPoNumber.trim()) return true;
  if (current.poRemarks.trim() !== baseline.poRemarks.trim()) return true;
  if (current.supplierId !== baseline.supplierId) return true;
  const lineIds = new Set([
    ...Object.keys(baseline.poQty).map((k) => Number(k)),
    ...Object.keys(current.poQty).map((k) => Number(k)),
    ...Object.keys(baseline.rates).map((k) => Number(k)),
    ...Object.keys(current.rates).map((k) => Number(k)),
  ]);
  for (const id of lineIds) {
    if (!Number.isFinite(id)) continue;
    if ((current.poQty[id] ?? "") !== (baseline.poQty[id] ?? "")) return true;
    if ((current.rates[id] ?? "") !== (baseline.rates[id] ?? "")) return true;
  }
  return false;
}
