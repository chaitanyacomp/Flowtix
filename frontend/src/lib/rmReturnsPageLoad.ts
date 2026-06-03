/** RM Returns workspace — API error logging helpers (dev console). */

export function logRmReturnsApiError(endpoint: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`[RM Returns] ${endpoint} failed:`, message, err);
}

export function parsePositiveIntParam(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
