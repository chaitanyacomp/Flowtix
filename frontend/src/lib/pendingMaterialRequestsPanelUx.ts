import { PROCUREMENT_TERMS } from "./procurementTerminology";

export const RM_PO_MODAL_DISCARD_CONFIRM = "Discard unsaved PO entry?";

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
