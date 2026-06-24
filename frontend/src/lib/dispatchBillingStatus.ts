/** Read-only billing lifecycle for a dispatch ledger row (no API/schema changes). */
export type DispatchBillingStatus =
  | "READY_FOR_SALES_BILL"
  | "BILL_DRAFT"
  | "BILLED"
  | "EXPORTED"
  | "NOT_APPLICABLE";

export type DispatchBillingStatusInput = {
  workflowStatus?: string | null;
  reversalOfId?: number | null;
  dispatchedQty?: unknown;
  salesBillExists?: boolean | null;
  salesBillId?: number | null;
  salesBillStatus?: string | null;
  salesBillIsExported?: boolean | null;
};

const ROW_EPS = 1e-9;

export function deriveDispatchBillingStatus(row: DispatchBillingStatusInput): DispatchBillingStatus {
  if (row.reversalOfId != null) return "NOT_APPLICABLE";
  if (String(row.workflowStatus ?? "") !== "LOCKED") return "NOT_APPLICABLE";
  const qty = Number(row.dispatchedQty ?? 0);
  if (!Number.isFinite(qty) || qty <= ROW_EPS) return "NOT_APPLICABLE";
  if (!row.salesBillExists) return "READY_FOR_SALES_BILL";
  if (row.salesBillIsExported === true) return "EXPORTED";
  if (String(row.salesBillStatus ?? "").trim().toUpperCase() === "FINALIZED") return "BILLED";
  return "BILL_DRAFT";
}

export function dispatchBillingStatusLabel(status: DispatchBillingStatus): string {
  switch (status) {
    case "READY_FOR_SALES_BILL":
      return "Ready for Sales Bill";
    case "BILL_DRAFT":
      return "Bill draft";
    case "BILLED":
      return "Billed";
    case "EXPORTED":
      return "Billed · Exported";
    default:
      return "";
  }
}

export type DispatchBillingStatusTone = "emerald" | "amber" | "sky" | "slate";

export function dispatchBillingStatusTone(status: DispatchBillingStatus): DispatchBillingStatusTone {
  switch (status) {
    case "READY_FOR_SALES_BILL":
      return "emerald";
    case "BILL_DRAFT":
      return "amber";
    case "BILLED":
      return "sky";
    case "EXPORTED":
      return "slate";
    default:
      return "slate";
  }
}

/** Store-facing helper when dispatch is finalized and billing is Admin-owned. */
export const DISPATCH_BILLING_ADMIN_HANDOFF = "Sales billing is handled by Admin.";

export const DISPATCH_FINALIZED_READY_LABEL = "Dispatch finalized · Ready for Sales Bill";
