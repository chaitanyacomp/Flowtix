/** RM return to store — client-side qty helpers (display/validation only). */

export function computeUnusedIssuedRmQty(
  grossIssued: number,
  consumed: number,
  returned: number,
): number {
  const g = Number(grossIssued);
  const c = Number(consumed);
  const r = Number(returned);
  if (!Number.isFinite(g) || !Number.isFinite(c) || !Number.isFinite(r)) return 0;
  return Math.max(0, Math.round((g - c - r) * 1000) / 1000);
}

export function parseReturnQtyInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function validateReturnQtyInput(
  raw: string,
  returnableQty: number,
): { ok: true; qty: number } | { ok: false; message: string } {
  const qty = parseReturnQtyInput(raw);
  if (qty == null) {
    return { ok: false, message: "Enter a quantity to return." };
  }
  if (qty <= 0) {
    return { ok: false, message: "Return quantity must be greater than zero." };
  }
  if (qty > returnableQty + 1e-6) {
    return {
      ok: false,
      message: `Cannot return more than ${returnableQty} (returnable at production).`,
    };
  }
  return { ok: true, qty };
}
