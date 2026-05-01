/** Item row from GET /api/items (RM) — includes master fields used for PO line snapshots. */
export type Item = {
  id: number;
  itemName: string;
  unit: string;
  unitName?: string | null;
  hsnCode?: string | null;
  gstRate?: string | number | null;
};
export type Supplier = {
  id: number;
  name: string;
  state?: string | null;
  stateName?: string | null;
  stateCode?: string | null;
};
export type RmPoLine = {
  id: number;
  itemId: number;
  qty: string;
  rate?: string;
  unit?: string | null;
  hsn?: string | null;
  gstRate?: string | null;
  amount?: string | null;
  item: Item;
};
export type GrnLineDraft = { rmPoLineId: number; receivedQty: number };
export type GrnRow = {
  id: number;
  reversedAt?: string | null;
  reversalReason?: string | null;
  lines: { rmPoLineId: number; receivedQty: string }[];
};
export type RmPoRow = {
  id: number;
  supplierId: number;
  supplier: Supplier;
  status: string;
  remarks?: string | null;
  lines: RmPoLine[];
  grns: GrnRow[];
  billingSummary?: {
    finalizedBilledQtyByPoLineId?: Record<number, number>;
    cancelledBilledQtyByPoLineId?: Record<number, number>;
  };
};

export type PoLineDraft = {
  id?: number;
  itemId: number;
  qty: number;
  rate: number;
  /** System-filled from item master (+ testing fallbacks) */
  unit: string;
  hsn: string;
  gstRate: number | null;
  amount: number;
};

const DEFAULT_UNIT = "Nos";
const DEFAULT_HSN = "0000";

/**
 * Client-side mirror of backend rmPoTaxFields resolution for display in the PO modal.
 */
export function deriveRmLineDisplayFromItem(item: Item | undefined, relaxed: boolean): {
  unit: string;
  hsn: string;
  /** null when strict mode and master GST missing */
  gstRate: number | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const unitRaw = (item?.unitName || item?.unit || "").trim();
  let unit = unitRaw;
  if (!unit) {
    if (relaxed) {
      unit = DEFAULT_UNIT;
      warnings.push('Item master missing unit; temporary fallback "Nos" applied in testing mode.');
    } else {
      unit = "";
    }
  }

  let hsn = item?.hsnCode != null ? String(item.hsnCode).trim() : "";
  if (!hsn) {
    if (relaxed) {
      hsn = DEFAULT_HSN;
      warnings.push("Item master missing HSN; temporary fallback applied in testing mode.");
    } else {
      hsn = "";
    }
  }

  let gstRate: number | null = item?.gstRate != null ? Number(item.gstRate) : null;
  if (gstRate != null && !Number.isFinite(gstRate)) gstRate = null;
  if (gstRate == null) {
    if (relaxed) {
      gstRate = 0;
      warnings.push("Item master missing GST Rate; temporary fallback 0 applied in testing mode.");
    }
  }

  return { unit, hsn, gstRate, warnings };
}

export function computeLineAmount(qty: number, rate: number): number {
  return Math.round(qty * rate * 100) / 100;
}

export function buildInitialPoLine(item: Item | undefined, relaxed: boolean, qty = Number.NaN, rate = Number.NaN): PoLineDraft {
  const d = deriveRmLineDisplayFromItem(item, relaxed);
  return {
    itemId: item?.id ?? 0,
    qty,
    rate,
    unit: d.unit,
    hsn: d.hsn,
    gstRate: d.gstRate,
    amount: Number.isFinite(qty) && Number.isFinite(rate) ? computeLineAmount(qty, rate) : 0,
  };
}

/** Map API RM PO line (with optional tax snapshots) to edit draft. */
export function poResponseLineToDraft(l: RmPoLine): PoLineDraft {
  const qty = Number(l.qty);
  const rate = Number(l.rate ?? 0);
  const fromApi = l.amount != null && String(l.amount).trim() !== "";
  const amount = fromApi ? Number(l.amount) : computeLineAmount(qty, rate);
  return {
    id: l.id,
    itemId: l.itemId,
    qty,
    rate,
    unit: l.unit ?? "",
    hsn: l.hsn ?? "",
    gstRate: l.gstRate != null && String(l.gstRate).trim() !== "" ? Number(l.gstRate) : null,
    amount: Number.isFinite(amount) ? amount : computeLineAmount(qty, rate),
  };
}

export type RmRequirementRow = {
  itemId: number;
  itemName: string;
  requiredQty: number;
  usableQty: number;
  shortage: number;
  suggested: number;
};

export function formatRmPoNo(id: number): string {
  return `RMPO-${id}`;
}

/** Display labels for PO list/detail (stored: PENDING / PARTIAL / COMPLETED / CANCELLED). */
export function poStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "PARTIAL":
      return "Partially Received";
    case "COMPLETED":
      return "Fully Received";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

/** Simple dot: green = complete, yellow = in progress/open, grey = cancelled or neutral. */
export function poStatusDotClass(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-500";
    case "PARTIAL":
      return "bg-amber-400";
    case "PENDING":
      return "bg-amber-300";
    case "CANCELLED":
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
}

export function grnStatusLabel(g: GrnRow): string {
  return g.reversedAt ? "Reversed" : "Active";
}

export function grnStatusDotClass(g: GrnRow): string {
  return g.reversedAt ? "bg-slate-400" : "bg-emerald-500";
}

export function receivedForLine(po: RmPoRow, lineId: number) {
  let s = 0;
  for (const g of po.grns) {
    if (g.reversedAt) continue;
    for (const l of g.lines) {
      if (l.rmPoLineId === lineId) s += Number(l.receivedQty);
    }
  }
  return s;
}

export function poOrderedReceivedPending(po: RmPoRow): { ordered: number; received: number; pending: number } {
  let ordered = 0;
  let received = 0;
  for (const ln of po.lines) {
    ordered += Number(ln.qty);
    received += receivedForLine(po, ln.id);
  }
  const pending = Math.max(0, ordered - received);
  return { ordered, received, pending };
}

export function hasActiveGrnRecord(po: RmPoRow): boolean {
  return po.grns.some((g) => !g.reversedAt);
}

export function lineItemLocked(r: RmPoRow | undefined, lineId: number | undefined) {
  if (!r || lineId == null) return false;
  return r.status === "PARTIAL" || r.grns.some((g) => g.lines.some((l) => l.rmPoLineId === lineId));
}
