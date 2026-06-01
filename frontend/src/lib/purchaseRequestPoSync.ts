/** Pending PR lines from GET /api/purchase/purchase-requests/pending */

export type PendingPurchaseRequestLine = {
  id: number;
  purchaseRequestId: number;
  rmItemId: number;
  itemName: string;
  unit: string;
  requiredQty: number;
  availableQty: number;
  netRequiredQty: number;
  orderedQty: number;
  pendingQty: number;
  canOrder: boolean;
  orderBlockReason?: string | null;
};

export type PendingPurchaseRequest = {
  id: number;
  docNo: string | null;
  status: string;
  statusLabel: string;
  remarks: string | null;
  lines: PendingPurchaseRequestLine[];
};

export type PendingPurchaseRequestLineRow = PendingPurchaseRequestLine & {
  requestDocNo: string;
  requestStatus: string;
  requestStatusLabel: string;
};

export function flattenOrderablePurchaseRequestLines(
  requests: PendingPurchaseRequest[],
): PendingPurchaseRequestLineRow[] {
  const out: PendingPurchaseRequestLineRow[] = [];
  for (const pr of requests) {
    const doc = pr.docNo || `PR-${pr.id}`;
    for (const ln of pr.lines) {
      if (!ln.canOrder) continue;
      out.push({
        ...ln,
        requestDocNo: doc,
        requestStatus: pr.status,
        requestStatusLabel: pr.statusLabel,
      });
    }
  }
  return out;
}

/** User-facing message for create-po failures (uses backend code when present). */
export function formatPurchaseRequestPoError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message: string; code?: string };
    if (e.code === "PR_ALREADY_ORDERED") {
      return e.message || "PO already created for this purchase request. Refresh the list.";
    }
    if (e.code === "PR_LINE_ALREADY_ORDERED") {
      return e.message || "PO already created for the selected line. Refresh the list.";
    }
    if (e.code === "PR_NOT_OPEN_FOR_ORDERING" || e.code === "PR_CANCELLED") {
      return e.message;
    }
    if (e.message.includes("not open for ordering")) {
      return "This purchase request is no longer open for ordering. Refresh pending requests — the PO may already exist.";
    }
    return e.message;
  }
  return "Failed to create RM PO";
}
