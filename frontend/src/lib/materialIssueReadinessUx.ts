/**
 * M1.5 — Material Issue readiness consumption (presentation only).
 * Maps additive backend store/line readiness from PMR list + issue-context APIs.
 * Does not decide issue eligibility — backend POST remains the hard authority.
 */

export type BackendPmrStoreReadiness = {
  storeIssueReady?: boolean | null;
  hasPendingIssueQty?: boolean | null;
  storeActionKey?: string | null;
  storeActionLabel?: string | null;
};

export type BackendIssueLineReadiness = {
  lineReadinessKey?: string | null;
  lineReadinessLabel?: string | null;
  lineReadinessExplanation?: string | null;
  waitingProcurement?: boolean | null;
};

export type BackendIssueDecisionReadiness = {
  canIssueMore?: boolean | null;
  canIssueAnyPendingLine?: boolean | null;
  waitingProcurement?: boolean | null;
  waitingProcurementLineCount?: number | null;
  blockerReason?: string | null;
  storeActionKey?: string | null;
  storeActionLabel?: string | null;
  storeIssueReady?: boolean | null;
  canReleaseToProduction?: boolean | null;
  canWaiveRemaining?: boolean | null;
  totalRemaining?: number | null;
  totalIssued?: number | null;
};

const EPS = 1e-6;

export function isBackendStoreIssueReady(pmr: BackendPmrStoreReadiness | null | undefined): boolean {
  if (pmr?.storeIssueReady != null) return Boolean(pmr.storeIssueReady);
  const key = String(pmr?.storeActionKey ?? "").trim().toUpperCase();
  return key === "ISSUE";
}

/** Prefer backend `storeIssueReady`; fall back only when additive fields are absent. */
export function filterStoreReadyPmrs<T extends BackendPmrStoreReadiness & { status?: string; totalPending?: number }>(
  pmrs: T[],
): T[] {
  return pmrs.filter((p) => {
    if (p.storeIssueReady != null || p.storeActionKey != null) {
      return isBackendStoreIssueReady(p);
    }
    const status = String(p.status ?? "").toUpperCase();
    return (status === "REQUESTED" || status === "PARTIALLY_ISSUED") && Number(p.totalPending ?? 0) > EPS;
  });
}

export function mapBackendLineReadiness(line: BackendIssueLineReadiness | null | undefined): {
  status: string;
  label: string;
  explanation: string | null;
} | null {
  const key = String(line?.lineReadinessKey ?? "").trim().toUpperCase();
  if (!key) return null;
  return {
    status: key,
    label: String(line?.lineReadinessLabel ?? key).trim() || key,
    explanation: line?.lineReadinessExplanation?.trim() || null,
  };
}

export function isBackendIssueDecisionOpen(decision: BackendIssueDecisionReadiness | null | undefined): boolean {
  if (decision?.canIssueMore != null) return Boolean(decision.canIssueMore);
  if (decision?.storeIssueReady != null) return Boolean(decision.storeIssueReady);
  return String(decision?.storeActionKey ?? "").toUpperCase() === "ISSUE";
}

export function canSubmitFromBackendIssueDecision(
  decision: BackendIssueDecisionReadiness | null | undefined,
  opts: {
    hasPositiveIssueQty: boolean;
    hasToleranceBlockedLine: boolean;
    submitting: boolean;
    loading: boolean;
  },
): boolean {
  if (!isBackendIssueDecisionOpen(decision)) return false;
  if (decision?.canIssueAnyPendingLine === false) return false;
  if (!opts.hasPositiveIssueQty) return false;
  if (opts.hasToleranceBlockedLine) return false;
  if (opts.submitting || opts.loading) return false;
  return true;
}

export function waitingProcurementFromIssueDecision(
  decision: BackendIssueDecisionReadiness | null | undefined,
): boolean {
  return Boolean(decision?.waitingProcurement);
}
