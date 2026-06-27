/** Material Issue screen — display math and suggested issue qty (UX only). */

const EPS = 1e-6;

/** Pilot default: max(0.5 Kg, 5% of pending). Mirrors backend rmIssueToleranceService. */
export const RM_ISSUE_TOLERANCE_MIN_KG = 0.5;
export const RM_ISSUE_TOLERANCE_PERCENT = 0.05;

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function computeRmIssueToleranceQty(pendingQty: number | null | undefined): number {
  const pending = round3(Math.max(0, Number(pendingQty ?? 0)));
  if (!Number.isFinite(pending) || pending <= EPS) return 0;
  return round3(Math.max(RM_ISSUE_TOLERANCE_MIN_KG, pending * RM_ISSUE_TOLERANCE_PERCENT));
}

export function computeMaxAllowedRmIssueQty(
  pendingQty: number | null | undefined,
  woStillRequiredQty?: number | null,
): number {
  const pending = round3(Math.max(0, Number(pendingQty ?? 0)));
  const maxFromPmr = round3(pending + computeRmIssueToleranceQty(pending));
  if (woStillRequiredQty == null) return maxFromPmr;
  const woPending = round3(Math.max(0, Number(woStillRequiredQty)));
  const maxFromWo = round3(woPending + computeRmIssueToleranceQty(woPending));
  return round3(Math.min(maxFromPmr, maxFromWo));
}

export type MaterialIssueQtyAssessment = {
  allowed: boolean;
  withinTolerance: boolean;
  overIssueQty: number;
  maxAllowedQty: number;
  toleranceQty: number;
  pendingQty: number;
};

export function assessMaterialIssueQty(
  issueQty: number | string | null | undefined,
  pendingQty: number | null | undefined,
  options?: { woStillRequiredQty?: number | null; maxAllowedIssueQty?: number | null },
): MaterialIssueQtyAssessment {
  const qty = round3(Number(issueQty ?? 0));
  const pending = round3(Math.max(0, Number(pendingQty ?? 0)));
  const toleranceQty = computeRmIssueToleranceQty(pending);
  const maxAllowedQty =
    options?.maxAllowedIssueQty != null
      ? round3(Number(options.maxAllowedIssueQty))
      : computeMaxAllowedRmIssueQty(pending, options?.woStillRequiredQty);

  if (!Number.isFinite(qty) || qty <= EPS) {
    return {
      allowed: false,
      withinTolerance: false,
      overIssueQty: 0,
      maxAllowedQty,
      toleranceQty,
      pendingQty: pending,
    };
  }
  if (qty <= pending + EPS) {
    return {
      allowed: true,
      withinTolerance: false,
      overIssueQty: 0,
      maxAllowedQty,
      toleranceQty,
      pendingQty: pending,
    };
  }

  const overIssueQty = round3(qty - pending);
  if (qty > maxAllowedQty + EPS) {
    return {
      allowed: false,
      withinTolerance: false,
      overIssueQty,
      maxAllowedQty,
      toleranceQty,
      pendingQty: pending,
    };
  }

  return {
    allowed: true,
    withinTolerance: true,
    overIssueQty,
    maxAllowedQty,
    toleranceQty,
    pendingQty: pending,
  };
}

export function formatOverIssueToleranceWarning(overIssueQty: number, unit?: string): string {
  const u = unit?.trim() ? ` ${unit}` : "";
  const qty = round3(Math.max(0, overIssueQty));
  return `Over issue by ${qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u} — allowed within tolerance.`;
}

export function formatIssueToleranceExceededMessage(): string {
  return "Issue exceeds allowed tolerance.";
}

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
