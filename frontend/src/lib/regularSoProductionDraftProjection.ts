/**
 * REGULAR_SO production operator summary — finalized vs draft (approval-pending).
 * Draft FG is never treated as finalized Produced / Target Remaining reduction.
 */

export type RegularSoProductionDraftProjectionInput = {
  plannedQty: number;
  /** Approved / finalized produced only. */
  finalizedProducedQty: number;
  /** Sum of open draft entry qty on the line (blocking). */
  activeDraftQty: number;
  /** Lifetime RM-supported FG maximum (e.g. 5142). */
  rmSupportedMaximumQty: number | null;
  /**
   * Max additional entry qty now from readiness (productionAllowedNowQty / maxAdditionalQty),
   * before reserving the active draft. When omitted, derived from max − finalized.
   */
  rmSupportedEntryCapacityBeforeDraft?: number | null;
};

export type RegularSoProductionDraftProjection = {
  finalizedProducedQty: number;
  activeDraftQty: number;
  plannedTargetRemainingQty: number;
  rmSupportedMaximumQty: number;
  rmSupportedEntryCapacityBeforeDraft: number;
  /** Capacity still available for a *new* entry after the draft reserves the envelope. */
  rmSupportedCapacityAfterDraft: number;
  projectedProducedAfterDraft: number;
  /** max(0, projectedProduced − planned). */
  projectedExtraQty: number;
  /** max(0, RM max − planned) lifetime display; draft does not change planned. */
  extraRmCapacityVsPlanQty: number;
  /** max(0, RM max − projectedProducedAfterDraft). */
  remainingRmSupportedAfterDraftQty: number;
  hasActiveDraft: boolean;
  blocksNewProductionEntry: boolean;
};

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

export function resolveRegularSoProductionDraftProjection(
  input: RegularSoProductionDraftProjectionInput,
): RegularSoProductionDraftProjection {
  const planned = Math.max(0, n(input.plannedQty));
  const finalized = Math.max(0, n(input.finalizedProducedQty));
  const draft = Math.max(0, n(input.activeDraftQty));
  const rmMax = Math.max(0, n(input.rmSupportedMaximumQty));
  const beforeDraftRaw = input.rmSupportedEntryCapacityBeforeDraft;
  const beforeDraft =
    beforeDraftRaw != null && Number.isFinite(Number(beforeDraftRaw))
      ? Math.max(0, n(beforeDraftRaw))
      : Math.max(0, rmMax - finalized);

  const projectedProduced = finalized + draft;
  const afterDraft = Math.max(0, beforeDraft - draft);
  const hasActiveDraft = draft > 1e-6;

  return {
    finalizedProducedQty: finalized,
    activeDraftQty: draft,
    plannedTargetRemainingQty: Math.max(0, planned - finalized),
    rmSupportedMaximumQty: rmMax,
    rmSupportedEntryCapacityBeforeDraft: beforeDraft,
    rmSupportedCapacityAfterDraft: afterDraft,
    projectedProducedAfterDraft: projectedProduced,
    projectedExtraQty: Math.max(0, projectedProduced - planned),
    extraRmCapacityVsPlanQty: Math.max(0, rmMax - planned),
    remainingRmSupportedAfterDraftQty: Math.max(0, rmMax - projectedProduced),
    hasActiveDraft,
    blocksNewProductionEntry: hasActiveDraft,
  };
}

/**
 * Unused-RM return primary strip — never paint from stale/partial readiness.
 * Draft alone must not enable return; require finalized produced + settled readiness.
 */
export function shouldShowUnusedRmReturnPrimaryStrip(args: {
  rmReadinessLoading: boolean;
  entriesLoadSettled: boolean;
  draftApprovalPending: boolean;
  workOrderLineId: number;
  readinessWorkOrderLineId: number | null | undefined;
  hasFinalizedProduced: boolean;
  returnableQtyTotal: number;
}): boolean {
  if (args.rmReadinessLoading) return false;
  if (!args.entriesLoadSettled) return false;
  if (args.draftApprovalPending) return false;
  if (!(args.workOrderLineId > 0)) return false;
  if (Number(args.readinessWorkOrderLineId ?? 0) !== args.workOrderLineId) return false;
  if (!args.hasFinalizedProduced) return false;
  return Number(args.returnableQtyTotal ?? 0) > 1e-6;
}

export function sumReturnableRmQty(
  rmLines: Array<{ returnableQty?: number | null }> | null | undefined,
): number {
  if (!rmLines?.length) return 0;
  return rmLines.reduce((s, ln) => s + Math.max(0, Number(ln.returnableQty ?? 0)), 0);
}
