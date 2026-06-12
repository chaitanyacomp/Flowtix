/**
 * P4A — Human-readable operational warning text (presentation only).
 */

const WARNING_LABELS: Record<string, string> = {
  LEGACY_RESERVATION_EXCEEDS_PHYSICAL: "Reserved quantity exceeds available stock",
  INCOMING_PO_INFORMATIONAL:
    "Open PO / incoming quantity is shown for reference only and does not reduce calculated RM shortage.",
  STOCK_IN_PRODUCTION_LOCATION: "Stock exists in a production location.",
  NON_USABLE_STOCK_EXISTS: "Stock exists but is not available for issue.",
  LEGACY_NULL_LOCATION_INCLUDED: "Stock without a location is included in availability.",
  ITEM_NOT_FOUND: "Item record was not found.",
  ITEM_NOT_RM: "Item is not classified as raw material.",
  ITEM_UNIT_MISSING: "Item unit of measure is missing.",
  AWAITING_PO: "Purchase Request exists — waiting for Purchase to create RM PO.",
  GRN_PENDING: "Goods receipt pending — material is ordered but not yet available in Store.",
  INCOMING_PO_INFORMATIONAL_UI: "Incoming PO quantity is informational until GRN is posted.",
  MONTHLY_PLAN_INCOMING: "Monthly plan demand — incoming purchase quantity is already on order.",
};

function humanizeWarningCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatOperationalWarningMessage(warning: {
  code?: string | null;
  message?: string | null;
}): string {
  const message = String(warning.message ?? "").trim();
  if (message && !looksLikeInternalCode(message)) return message;

  const code = String(warning.code ?? "").trim();
  if (code && WARNING_LABELS[code]) return WARNING_LABELS[code];
  if (message) return message;
  if (code) return humanizeWarningCode(code);
  return "Review required";
}

function looksLikeInternalCode(text: string): boolean {
  return /^[A-Z0-9_]+$/.test(text.trim()) && text.includes("_");
}

export function formatOperationalWarningList(
  warnings: ReadonlyArray<{ code?: string | null; message?: string | null }> | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of warnings ?? []) {
    const label = formatOperationalWarningMessage(w);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}
