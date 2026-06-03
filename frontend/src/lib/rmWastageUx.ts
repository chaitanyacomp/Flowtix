/** RM wastage declaration — client-side qty helpers. */

export function validateWastageQtyInput(
  raw: string,
  availableQty: number,
): { ok: true; qty: number } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "Enter wastage quantity." };
  }
  const qty = Number(trimmed);
  if (!Number.isFinite(qty)) {
    return { ok: false, message: "Enter a valid number." };
  }
  if (qty <= 0) {
    return { ok: false, message: "Wastage quantity must be greater than zero." };
  }
  if (qty > availableQty + 1e-6) {
    return {
      ok: false,
      message: `Cannot exceed available wastage qty (${availableQty}).`,
    };
  }
  return { ok: true, qty };
}

export const RM_WASTAGE_REASON_OPTIONS = [
  { id: "PROCESS_LOSS", label: "Process Loss" },
  { id: "MACHINE_SETTING", label: "Machine Setting" },
  { id: "SPILLAGE", label: "Spillage" },
  { id: "CONTAMINATION", label: "Contamination" },
  { id: "PURGING", label: "Purging" },
  { id: "OTHER", label: "Other" },
] as const;
