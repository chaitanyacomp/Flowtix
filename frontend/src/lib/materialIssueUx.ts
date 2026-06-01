/** Material Issue screen — display math and suggested issue qty (UX only). */

const EPS = 1e-6;

/** Still required on PMR line: max(0, original request − already issued). */
export function stillRequiredMaterialIssueQty(
  originalRequest: number | null | undefined,
  alreadyIssued: number | null | undefined,
): number {
  const req = Number(originalRequest ?? 0);
  const iss = Number(alreadyIssued ?? 0);
  if (!Number.isFinite(req) || req <= EPS) return 0;
  const issued = Number.isFinite(iss) && iss > 0 ? iss : 0;
  return Math.max(0, Math.round((req - issued) * 1000) / 1000);
}

/**
 * Suggested “Issue now” qty:
 * `MIN(stillRequired, availableInStore)` when stock is known; `0` while availability is unknown.
 */
export function suggestedMaterialIssueQty(
  stillRequiredQty: number | null | undefined,
  availableInStore: number | null | undefined,
): number {
  const required = Number(stillRequiredQty ?? 0);
  if (!Number.isFinite(required) || required <= EPS) return 0;
  if (availableInStore == null) return 0;
  const available = Number(availableInStore);
  if (!Number.isFinite(available) || available < 0) return 0;
  return Math.min(required, Math.max(0, available));
}

/** String for controlled number inputs (keeps integers clean). */
export function formatSuggestedIssueQty(
  stillRequiredQty: number | null | undefined,
  availableInStore: number | null | undefined,
): string {
  const n = suggestedMaterialIssueQty(stillRequiredQty, availableInStore);
  if (n <= EPS) return "0";
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

/** True when PMR line still needs qty but no usable stock at the selected store location. */
export function isMaterialIssueLineStockBlocked(
  stillRequiredQty: number | null | undefined,
  availableInStore: number | null | undefined,
): boolean {
  const required = Number(stillRequiredQty ?? 0);
  if (!Number.isFinite(required) || required <= EPS) return false;
  if (availableInStore == null) return false;
  const available = Number(availableInStore);
  return Number.isFinite(available) && available <= EPS;
}

/** Any line auto-filled below still required because store stock is short. */
export function hasPartialStoreAutofill(
  lines: Array<{
    stillRequiredQty?: number;
    originalRequestQty?: number;
    available: number | null;
  }>,
): boolean {
  return lines.some((ln) => {
    if (ln.stillRequiredQty == null || ln.available == null) return false;
    const still = Number(ln.stillRequiredQty);
    const available = Number(ln.available);
    if (!Number.isFinite(still) || !Number.isFinite(available)) return false;
    return still > EPS && available + EPS < still;
  });
}
