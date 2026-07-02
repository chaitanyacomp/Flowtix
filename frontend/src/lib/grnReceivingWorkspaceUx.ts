import type { GrnLineDraft } from "../pages/rmPurchase/rmPurchaseShared";

export const GRN_MODAL_DISCARD_CONFIRM = "Discard unsaved GRN receipt?";

export type GrnModalEntryBaseline = {
  grnDateInput: string;
  grnSupplierInvoiceNo: string;
  grnLines: Array<{ rmPoLineId: number; receivedQty: number; locationId: number }>;
};

export function formatGrnWorkspaceQty(qty: number, unit?: string): string {
  const u = unit?.trim() ? ` ${unit}` : "";
  if (!Number.isFinite(qty)) return "—";
  return `${qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

export function snapshotGrnModalLines(lines: GrnLineDraft[]): GrnModalEntryBaseline["grnLines"] {
  return lines.map((l) => ({
    rmPoLineId: l.rmPoLineId,
    receivedQty: normalizeGrnReceiveQty(l.receivedQty),
    locationId: Number(l.locationId) || 0,
  }));
}

export function normalizeGrnReceiveQty(qty: number): number {
  return Number.isFinite(qty) ? qty : 0;
}

export function computeGrnBalanceAfterReceipt(pending: number, receiveQty: number): number {
  const rq = normalizeGrnReceiveQty(receiveQty);
  return Math.max(0, pending - rq);
}

export function hasGrnModalUnsavedEntry(
  baseline: GrnModalEntryBaseline | null,
  current: {
    grnDateInput: string;
    grnSupplierInvoiceNo: string;
    grnLines: GrnLineDraft[];
  },
): boolean {
  if (!baseline) return false;
  if (current.grnDateInput.trim() !== baseline.grnDateInput.trim()) return true;
  if (current.grnSupplierInvoiceNo.trim() !== baseline.grnSupplierInvoiceNo.trim()) return true;
  const currentSnap = snapshotGrnModalLines(current.grnLines);
  if (currentSnap.length !== baseline.grnLines.length) return true;
  for (let i = 0; i < baseline.grnLines.length; i += 1) {
    const b = baseline.grnLines[i]!;
    const c = currentSnap.find((x) => x.rmPoLineId === b.rmPoLineId);
    if (!c) return true;
    if (Math.abs(c.receivedQty - b.receivedQty) > 1e-9) return true;
    if (c.locationId !== b.locationId) return true;
  }
  return false;
}
