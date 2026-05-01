/** User-facing activity names for ledger rows (maps Prisma `StockTxnType`). */
export const LEDGER_ACTIVITY_LABELS: Record<string, string> = {
  OPENING: "Opening Stock",
  OPENING_REVERSAL: "Opening Reversed",
  BUCKET_TRANSFER: "Bucket transfer",
  QC: "Produced & Approved",
  DISPATCH: "Dispatched",
  CUSTOMER_RETURN: "Customer Return",
  ADJUSTMENT: "Stock Adjusted",
  DISPATCH_REVERSAL: "Dispatch Reversed",
  QC_REVERSAL: "QC Reversed",
  SCRAP: "Scrap / Loss",
  ISSUE: "Issued",
  GRN: "Received",
  PRODUCTION: "Production",
};

/**
 * Activity type filter (UI). Values are still single `StockTxnType` or ALL for the API.
 * Only the five business groupings below are listed; use "All Activity" for every type.
 */
export const ACTIVITY_TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "ALL", label: "All Activity" },
  { value: "QC", label: "Production" },
  { value: "DISPATCH", label: "Dispatch" },
  { value: "CUSTOMER_RETURN", label: "Returns" },
  { value: "ADJUSTMENT", label: "Adjustments" },
];

/**
 * Stock ledger row label. Reversal rows keep `transactionType: "ADJUSTMENT"` with `reversalOfId` set (no separate enum).
 */
export function ledgerActivityLabel(
  transactionType: string,
  row?: { reversalOfId?: number | null } | null,
): string {
  const t = String(transactionType || "").trim();
  if (t === "ADJUSTMENT" && row?.reversalOfId != null) {
    return "Adjustment reversal";
  }
  return LEDGER_ACTIVITY_LABELS[t] ?? t.replace(/_/g, " ");
}

/**
 * Lightweight ref hint for the Notes column (no joins).
 */
export function ledgerRefDisplay(transactionType: string, refId: number): string {
  if (refId == null || !Number.isFinite(refId)) return "";
  if (refId === 0 && transactionType === "ADJUSTMENT") return "";
  switch (transactionType) {
    case "OPENING":
      return `Opening #${refId}`;
    case "OPENING_REVERSAL":
      return `Opening reversal #${refId}`;
    case "QC":
      return `QC record #${refId}`;
    case "DISPATCH":
      return `Dispatch #${refId}`;
    case "DISPATCH_REVERSAL":
      return `Dispatch reversal #${refId}`;
    case "ADJUSTMENT":
      return `Adjustment #${refId}`;
    case "CUSTOMER_RETURN":
      return `Return #${refId}`;
    case "QC_REVERSAL":
      return `QC reversal #${refId}`;
    case "GRN":
      return `Receipt #${refId}`;
    case "ISSUE":
      return `Batch #${refId}`;
    case "SCRAP":
      return `Scrap #${refId}`;
    case "PRODUCTION":
      return `Batch #${refId}`;
    case "BUCKET_TRANSFER":
      return refId > 0 ? `Transfer ref #${refId}` : "Bucket transfer";
    default:
      return `Ref #${refId}`;
  }
}
