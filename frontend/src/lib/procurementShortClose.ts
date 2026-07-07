export const PROCUREMENT_SHORT_CLOSE_REASON_LABELS: Record<string, string> = {
  SUPPLIER_UNAVAILABLE: "Supplier unavailable",
  PRICE_NOT_ACCEPTABLE: "Price not acceptable",
  QUALITY_ISSUE: "Quality issue",
  PRODUCTION_PLAN_CHANGED: "Production plan changed",
  MANAGEMENT_DECISION: "Management decision",
  OTHER: "Other",
};

export type ProcurementShortCloseLinePreview = {
  rmPoLineId: number;
  itemId: number;
  itemName: string;
  unit: string;
  requiredQty: number;
  receivedQty: number;
  shortClosedQty: number;
  outstandingQty: number;
  outstandingAfterClose: number;
  canShortCloseLine: boolean;
  blockReason?: string | null;
};

export type ProcurementShortClosePreview = {
  rmPoId: number;
  rmPoStatus: string;
  canShortClose: boolean;
  blockReason?: string | null;
  lines: ProcurementShortCloseLinePreview[];
  impactSummary: {
    totalRequired: number;
    totalReceived: number;
    totalShortClosed: number;
    totalOutstanding: number;
    totalOutstandingAfterClose: number;
  };
  reasons: string[];
};

export type ProcurementSummary = {
  procurementClosureKind?: "SHORT_CLOSED" | "FULL_RECEIPT" | null;
  procurementStatusLabel?: string | null;
  lines: {
    rmPoLineId: number;
    requiredQty: number;
    receivedQty: number;
    shortClosedQty: number;
    outstandingProcurement: number;
  }[];
  totals: {
    requiredQty: number;
    receivedQty: number;
    shortClosedQty: number;
    outstandingProcurement: number;
  };
};

export function shortCloseReasonLabel(reason: string): string {
  const key = String(reason ?? "").trim().toUpperCase();
  return PROCUREMENT_SHORT_CLOSE_REASON_LABELS[key] ?? key.replaceAll("_", " ");
}

export function poProcurementBadgeLabel(
  status: string,
  procurementSummary?: ProcurementSummary | null,
): string {
  if (procurementSummary?.procurementClosureKind === "SHORT_CLOSED") {
    return "PARTIALLY PROCURED (SHORT CLOSED)";
  }
  if (procurementSummary?.procurementStatusLabel?.trim()) {
    return procurementSummary.procurementStatusLabel;
  }
  switch (status) {
    case "COMPLETED":
      return "Fully Received";
    case "PARTIAL":
      return "Partially Received";
    case "PENDING":
      return "Pending";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

export function canOfferProcurementShortClose(input: {
  status: string;
  receivedQty: number;
  outstandingQty: number;
}): boolean {
  if (input.status === "CANCELLED" || input.status === "COMPLETED") return false;
  return input.receivedQty > 1e-9 && input.outstandingQty > 1e-9;
}
