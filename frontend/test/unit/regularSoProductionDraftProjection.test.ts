import { describe, expect, it } from "vitest";
import {
  resolveRegularSoProductionDraftProjection,
  shouldShowUnusedRmReturnPrimaryStrip,
  sumReturnableRmQty,
} from "../../src/lib/regularSoProductionDraftProjection";

describe("regularSoProductionDraftProjection", () => {
  it("draft 5102: finalized 0, projected extra 102, RM after draft 40", () => {
    const p = resolveRegularSoProductionDraftProjection({
      plannedQty: 5000,
      finalizedProducedQty: 0,
      activeDraftQty: 5102,
      rmSupportedMaximumQty: 5142,
      rmSupportedEntryCapacityBeforeDraft: 5142,
    });
    expect(p.finalizedProducedQty).toBe(0);
    expect(p.activeDraftQty).toBe(5102);
    expect(p.plannedTargetRemainingQty).toBe(5000);
    expect(p.projectedProducedAfterDraft).toBe(5102);
    expect(p.projectedExtraQty).toBe(102);
    expect(p.extraRmCapacityVsPlanQty).toBe(142);
    expect(p.rmSupportedCapacityAfterDraft).toBe(40);
    expect(p.remainingRmSupportedAfterDraftQty).toBe(40);
    expect(p.blocksNewProductionEntry).toBe(true);
  });

  it("after approval: no draft, finalized 5102, remaining RM 40", () => {
    const p = resolveRegularSoProductionDraftProjection({
      plannedQty: 5000,
      finalizedProducedQty: 5102,
      activeDraftQty: 0,
      rmSupportedMaximumQty: 5142,
      rmSupportedEntryCapacityBeforeDraft: 40,
    });
    expect(p.hasActiveDraft).toBe(false);
    expect(p.finalizedProducedQty).toBe(5102);
    expect(p.plannedTargetRemainingQty).toBe(0);
    expect(p.projectedExtraQty).toBe(102);
    expect(p.remainingRmSupportedAfterDraftQty).toBe(40);
  });

  it("after cancel: capacity returns to 5142", () => {
    const p = resolveRegularSoProductionDraftProjection({
      plannedQty: 5000,
      finalizedProducedQty: 0,
      activeDraftQty: 0,
      rmSupportedMaximumQty: 5142,
      rmSupportedEntryCapacityBeforeDraft: 5142,
    });
    expect(p.activeDraftQty).toBe(0);
    expect(p.rmSupportedEntryCapacityBeforeDraft).toBe(5142);
    expect(p.plannedTargetRemainingQty).toBe(5000);
  });
});

describe("shouldShowUnusedRmReturnPrimaryStrip", () => {
  const base = {
    rmReadinessLoading: false,
    entriesLoadSettled: true,
    draftApprovalPending: false,
    workOrderLineId: 99,
    readinessWorkOrderLineId: 99,
    hasFinalizedProduced: true,
    returnableQtyTotal: 2,
  };

  it("is absent while loading / unsettled / mismatched WO / draft pending / no finalized", () => {
    expect(shouldShowUnusedRmReturnPrimaryStrip({ ...base, rmReadinessLoading: true })).toBe(false);
    expect(shouldShowUnusedRmReturnPrimaryStrip({ ...base, entriesLoadSettled: false })).toBe(false);
    expect(shouldShowUnusedRmReturnPrimaryStrip({ ...base, draftApprovalPending: true })).toBe(false);
    expect(shouldShowUnusedRmReturnPrimaryStrip({ ...base, readinessWorkOrderLineId: 1 })).toBe(false);
    expect(shouldShowUnusedRmReturnPrimaryStrip({ ...base, hasFinalizedProduced: false })).toBe(false);
    expect(shouldShowUnusedRmReturnPrimaryStrip({ ...base, returnableQtyTotal: 0 })).toBe(false);
  });

  it("appears only when current WO is authoritatively eligible", () => {
    expect(shouldShowUnusedRmReturnPrimaryStrip(base)).toBe(true);
  });

  it("sumReturnableRmQty aggregates lines", () => {
    expect(sumReturnableRmQty([{ returnableQty: 1.2 }, { returnableQty: 0.8 }])).toBeCloseTo(2, 5);
  });

  it("loading-transition frames never show the strip before eligibility is confirmed", () => {
    const frames = [
      { ...base, rmReadinessLoading: true, entriesLoadSettled: false, returnableQtyTotal: 0, hasFinalizedProduced: false, readinessWorkOrderLineId: null },
      { ...base, rmReadinessLoading: true, entriesLoadSettled: false, returnableQtyTotal: 72, hasFinalizedProduced: false },
      { ...base, rmReadinessLoading: false, entriesLoadSettled: false, returnableQtyTotal: 72, hasFinalizedProduced: false },
      { ...base, rmReadinessLoading: false, entriesLoadSettled: true, returnableQtyTotal: 72, hasFinalizedProduced: false },
      { ...base, rmReadinessLoading: false, entriesLoadSettled: true, returnableQtyTotal: 72, hasFinalizedProduced: false, draftApprovalPending: true },
    ];
    for (const frame of frames) {
      expect(shouldShowUnusedRmReturnPrimaryStrip(frame)).toBe(false);
    }
  });
});
