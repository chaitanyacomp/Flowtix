/** Parse a mandatory positive quantity from user input; blank or invalid → null. */
export function parsePositiveQuantityDraft(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
