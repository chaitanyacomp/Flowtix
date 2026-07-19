/**
 * Keyboard-entry decimal controls for ERP quantity fields.
 * Avoids type="number" so browser spinners, wheel and arrow-key increments never apply.
 */

/** Intermediate editing states: blank, 0, 2., .5 */
export function isAllowedDecimalEdit(raw: string): boolean {
  if (raw === "") return true;
  return /^(?:\d+\.?\d*|\.\d*)$/.test(raw);
}

export function sanitizeDecimalInput(raw: string): string | null {
  const value = String(raw ?? "").replace(/,/g, "").trim();
  if (!isAllowedDecimalEdit(value)) return null;
  return value;
}

export function normalizeDecimalOnBlur(raw: string, maxFractionDigits = 6): string {
  const value = String(raw ?? "").trim();
  if (value === "" || value === ".") return "0";
  const n = Number(value.startsWith(".") ? `0${value}` : value);
  if (!Number.isFinite(n) || n < 0) return "0";
  return n.toFixed(maxFractionDigits).replace(/\.?0+$/, "") || "0";
}

export function parseNonNegativeDecimal(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (value === "" || value === ".") return null;
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value)) return null;
  const n = Number(value.startsWith(".") ? `0${value}` : value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function blockDecimalSpinnerKeys(event: { key: string; preventDefault: () => void }): void {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
  }
}

export function blockDecimalWheel(event: { preventDefault: () => void }): void {
  event.preventDefault();
}
