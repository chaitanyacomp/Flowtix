/** Aligns with backend release delta epsilon — UI enable/disable only. */
export const RELEASE_DELTA_EPS = 1e-6;

export type ReleaseDeltaLineInput = {
  additionalRequirementQty?: number | string | null;
  suggestedPurchaseQty?: number | string | null;
};

export type ReleaseDeltaTotalsInput = {
  additionalRequirementTotal?: number | string | null;
  previouslyReleasedTotal?: number | string | null;
};

function toNum(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Derive additional requirement total from backend totals or line fallbacks. */
export function resolveAdditionalRequirementTotal(
  totals?: ReleaseDeltaTotalsInput | null,
  lines?: ReleaseDeltaLineInput[] | null,
): number {
  if (totals?.additionalRequirementTotal != null) {
    return toNum(totals.additionalRequirementTotal);
  }
  return (lines ?? []).reduce(
    (acc, line) => acc + toNum(line.additionalRequirementQty ?? line.suggestedPurchaseQty),
    0,
  );
}

export function resolvePreviouslyReleasedTotal(
  totals?: ReleaseDeltaTotalsInput | null,
  lines?: { previouslyReleasedQty?: number | string | null; alreadyRequisitionedQty?: number | string | null }[] | null,
): number {
  if (totals?.previouslyReleasedTotal != null) {
    return toNum(totals.previouslyReleasedTotal);
  }
  return (lines ?? []).reduce(
    (acc, line) => acc + toNum(line.previouslyReleasedQty ?? line.alreadyRequisitionedQty),
    0,
  );
}

/** Enabled only when unreleased procurement demand exists (backend-derived). */
export function isReleaseDeltaButtonEnabled(additionalRequirementTotal: number): boolean {
  return additionalRequirementTotal > RELEASE_DELTA_EPS;
}

export function getReleaseDeltaDisabledStatusMessage({
  additionalRequirementTotal,
  previouslyReleasedTotal = 0,
}: {
  additionalRequirementTotal: number;
  previouslyReleasedTotal?: number;
}): string {
  if (isReleaseDeltaButtonEnabled(additionalRequirementTotal)) return "";
  if (previouslyReleasedTotal > RELEASE_DELTA_EPS) {
    return "Procurement already released for current revision.";
  }
  return "No additional procurement requirement.";
}

export type ReleaseDeltaProcurementBadge = {
  revision: number;
  materialRequirementDocNo?: string | null;
};

/** Optional badge when current revision already has a release recorded on the plan. */
export function getReleaseDeltaProcurementBadge({
  currentRevision,
  releasedRevision,
  materialRequirementDocNo,
}: {
  currentRevision: number;
  releasedRevision: number | null | undefined;
  materialRequirementDocNo?: string | null;
}): ReleaseDeltaProcurementBadge | null {
  if (releasedRevision == null || releasedRevision !== currentRevision) return null;
  return {
    revision: releasedRevision,
    materialRequirementDocNo: materialRequirementDocNo ?? null,
  };
}
