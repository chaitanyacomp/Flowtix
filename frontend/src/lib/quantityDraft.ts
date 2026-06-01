/** Parse a mandatory positive quantity from user input; blank or invalid → null. */
export function parsePositiveQuantityDraft(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Production qty field — digits only, no leading-zero padding (e.g. "0000" → "0").
 * Preserves empty string while the operator clears the field.
 */
export function sanitizeProductionQtyDraftInput(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits === "") return "";
  const withoutLeadingZeros = digits.replace(/^0+/, "");
  return withoutLeadingZeros === "" ? "0" : withoutLeadingZeros;
}
