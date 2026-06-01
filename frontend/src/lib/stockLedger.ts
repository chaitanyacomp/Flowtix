/** User-facing activity names for ledger rows (maps Prisma `StockTxnType`). */
export const LEDGER_ACTIVITY_LABELS: Record<string, string> = {
  OPENING: "Opening Stock",
  OPENING_REVERSAL: "Opening Reversed",
  BUCKET_TRANSFER: "Bucket transfer",
  LOCATION_TRANSFER: "Material Transfer",
  QC: "Produced & Approved",
  DISPATCH: "Dispatched",
  CUSTOMER_RETURN: "Customer Return",
  ADJUSTMENT: "Stock Adjusted",
  DISPATCH_REVERSAL: "Dispatch Reversed",
  QC_REVERSAL: "QC Reversed",
  SCRAP: "Scrap / Loss",
  ISSUE: "Production Consumption",
  GRN: "Goods Receipt",
  PRODUCTION: "Production",
};

/** Movement history screen — filter values match GET /api/stock/movement-history `movement`. */
export const MOVEMENT_HISTORY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "ALL", label: "All movements" },
  { value: "GRN", label: "Goods Receipt" },
  { value: "LOCATION_TRANSFER", label: "Material Transfer" },
  { value: "MATERIAL_RETURN", label: "Material Return" },
  { value: "PRODUCTION_CONSUMPTION", label: "Production Consumption" },
  { value: "DISPATCH", label: "Dispatch" },
  { value: "QC", label: "QC" },
  { value: "REVERSAL", label: "Reversal" },
  { value: "ADJUSTMENT", label: "Adjustment" },
  { value: "OPENING", label: "Opening Stock" },
  { value: "BUCKET_TRANSFER", label: "Bucket Transfer" },
];

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
/** Compact row tint for movement ledger scanning (UI only). */
export function ledgerMovementRowClass(transactionType: string, stockBucket: string): string {
  const t = String(transactionType || "").trim().toUpperCase();
  const bucket = String(stockBucket || "").trim().toUpperCase();
  if (bucket === "USABLE") return "bg-emerald-50/40";
  if (t === "DISPATCH" || t === "DISPATCH_REVERSAL") return "bg-red-50/35";
  if (t === "SCRAP") return "bg-slate-100/80";
  if (t === "BUCKET_TRANSFER") return "bg-violet-50/40";
  if (t === "QC" || t === "QC_REVERSAL" || t === "PRODUCTION") return "bg-sky-50/35";
  if (t === "GRN" || t === "OPENING") return "bg-emerald-50/25";
  if (t === "LOCATION_TRANSFER") return "bg-blue-50/40";
  if (t === "ISSUE") return "bg-orange-50/35";
  return "";
}

/** Compact operational badge for movement type (Movement History). */
export function movementActivityBadgeClass(
  transactionType: string,
  row?: { reversalOfId?: number | null },
): string {
  const t = String(transactionType || "").trim().toUpperCase();
  if (
    row?.reversalOfId != null ||
    t === "QC_REVERSAL" ||
    t === "DISPATCH_REVERSAL" ||
    t === "OPENING_REVERSAL"
  ) {
    return "border-red-200 bg-red-50 text-red-800";
  }
  if (t === "GRN" || t === "OPENING") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (t === "LOCATION_TRANSFER") return "border-blue-200 bg-blue-50 text-blue-900";
  if (t === "ISSUE") return "border-orange-200 bg-orange-50 text-orange-900";
  if (t === "DISPATCH") return "border-purple-200 bg-purple-50 text-purple-900";
  if (t === "QC" || t === "PRODUCTION") return "border-sky-200 bg-sky-50 text-sky-900";
  if (t === "ADJUSTMENT") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

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
    case "LOCATION_TRANSFER":
      return refId > 0 ? `MIN #${refId}` : "Material transfer";
    default:
      return `Ref #${refId}`;
  }
}
