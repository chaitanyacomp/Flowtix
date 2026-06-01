/** RM quantity + unit label for operational screens (Prepare WO, RM Control Center, planning). */

export function formatRmQty(value: number | null | undefined, unit?: string | null): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) {
    const u = String(unit ?? "").trim();
    return u ? `— ${u}` : "—";
  }
  const qty =
    Math.abs(n) >= 1000
      ? n.toLocaleString(undefined, { maximumFractionDigits: 1 })
      : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  const u = String(unit ?? "").trim();
  return u ? `${qty} ${u}` : qty;
}
