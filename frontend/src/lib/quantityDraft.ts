import { qtyDecimalPlacesFromUnit } from "./quantityDisplay";
import { isAllowedDecimalEdit, sanitizeDecimalInput } from "./keyboardDecimalInput";

/** Strip thousands separators from qty draft text (paste-safe for editable fields). */
export function sanitizeQtyInputDraft(raw: string): string {
  return String(raw ?? "").replace(/,/g, "");
}

/** Parse a mandatory positive quantity from user input; blank or invalid → null. */
export function parsePositiveQuantityDraft(raw: string): number | null {
  const t = sanitizeQtyInputDraft(raw).trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Strip commas, unit labels, and other non-numeric noise from a production qty paste/type.
 * Keeps digits and at most one decimal point.
 */
function stripProductionQtyNoise(raw: string): string {
  const noCommas = String(raw ?? "").replace(/,/g, "");
  const digitsAndDots = noCommas.replace(/[^\d.]/g, "");
  const firstDot = digitsAndDots.indexOf(".");
  if (firstDot === -1) return digitsAndDots;
  return digitsAndDots.slice(0, firstDot + 1) + digitsAndDots.slice(firstDot + 1).replace(/\./g, "");
}

function sanitizeIntegerProductionQtyDraft(digits: string): string {
  if (digits === "") return "";
  const withoutLeadingZeros = digits.replace(/^0+/, "");
  return withoutLeadingZeros === "" ? "0" : withoutLeadingZeros;
}

/**
 * Production qty field — raw numeric draft only (no commas / unit text).
 * Allows decimals when the item UOM supports them; otherwise digits only.
 * Preserves empty string while the operator clears the field.
 */
export function sanitizeProductionQtyDraftInput(raw: string, unit?: string | null): string {
  const stripped = stripProductionQtyNoise(raw);
  if (stripped === "") return "";

  const allowDecimals = qtyDecimalPlacesFromUnit(unit) > 0;
  if (!allowDecimals) {
    // Integer UOMs: ignore decimal point and fractional paste (12.75 → 12), never glue digits.
    const intOnly = stripped.includes(".") ? stripped.slice(0, stripped.indexOf(".")) : stripped;
    return sanitizeIntegerProductionQtyDraft(intOnly.replace(/\D/g, ""));
  }

  const sanitized = sanitizeDecimalInput(stripped);
  if (sanitized != null) {
    if (sanitized === "" || sanitized === "." || sanitized.endsWith(".")) return sanitized;
    // Normalize leading zeros on the integer part while keeping intermediate edits.
    if (!sanitized.includes(".")) {
      return sanitizeIntegerProductionQtyDraft(sanitized);
    }
    const [intPart, frac = ""] = sanitized.split(".");
    if (intPart === "" || intPart === "0") return `0.${frac}`;
    const intNorm = sanitizeIntegerProductionQtyDraft(intPart);
    return `${intNorm}.${frac}`;
  }

  // Fallback: keep last allowed prefix when paste is partially invalid.
  if (isAllowedDecimalEdit(stripped)) return stripped;
  return "";
}
