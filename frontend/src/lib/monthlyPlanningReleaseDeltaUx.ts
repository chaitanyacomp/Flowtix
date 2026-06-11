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
  usesPlanDocumentUx = false,
}: {
  additionalRequirementTotal: number;
  previouslyReleasedTotal?: number;
  usesPlanDocumentUx?: boolean;
}): string {
  if (isReleaseDeltaButtonEnabled(additionalRequirementTotal)) return "";
  if (previouslyReleasedTotal > RELEASE_DELTA_EPS) {
    return usesPlanDocumentUx
      ? "Procurement already released for this plan."
      : "Procurement already released for current revision.";
  }
  return "No additional procurement requirement.";
}

export type ReleaseDeltaProcurementBadge = {
  revision: number;
  label: string;
  materialRequirementDocNo?: string | null;
};

function resolveActiveSnapshotRevision(params: {
  planStatus?: string | null;
  currentRevision: number;
  snapshotRevision?: number | null;
}): number | null {
  const { planStatus, currentRevision, snapshotRevision } = params;
  if (planStatus === "APPROVED") {
    return snapshotRevision != null && snapshotRevision > 0 ? snapshotRevision : 1;
  }
  if (currentRevision >= 1) return currentRevision;
  if (snapshotRevision != null && snapshotRevision > 0) return snapshotRevision;
  return null;
}

/** Badge when the active snapshot for this plan already has procurement released. */
export function getReleaseDeltaProcurementBadge({
  planStatus,
  currentRevision,
  snapshotRevision,
  releasedRevision,
  materialRequirementDocNo,
  planDisplayLabel,
}: {
  planStatus?: string | null;
  currentRevision: number;
  snapshotRevision?: number | null;
  releasedRevision: number | null | undefined;
  materialRequirementDocNo?: string | null;
  planDisplayLabel?: string | null;
}): ReleaseDeltaProcurementBadge | null {
  const activeRevision = resolveActiveSnapshotRevision({ planStatus, currentRevision, snapshotRevision });
  if (releasedRevision == null || activeRevision == null) return null;
  if (releasedRevision !== activeRevision) return null;
  const label =
    planStatus === "APPROVED" && planDisplayLabel?.trim()
      ? planDisplayLabel.trim()
      : `Rev ${releasedRevision}`;
  return {
    revision: releasedRevision,
    label,
    materialRequirementDocNo: materialRequirementDocNo ?? null,
  };
}
