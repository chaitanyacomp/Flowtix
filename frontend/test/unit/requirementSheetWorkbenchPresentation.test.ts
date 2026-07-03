import { describe, expect, it } from "vitest";
import {
  buildRequirementSheetKpiItems,
  resolveRequirementSheetWorkbenchActions,
} from "../../src/lib/requirementSheetWorkbenchPresentation";

describe("requirementSheetWorkbenchPresentation", () => {
  it("caps NO_QTY KPI strip at six deduped segments", () => {
    const items = buildRequirementSheetKpiItems({
      isNoQty: true,
      hasSheet: true,
      rsCycleSummaryLoading: false,
      previousCyclesTotal: 10,
      allCyclesTotal: 20,
      summary: {
        shortfallSum: 1,
        pendingDispositionSum: 2,
        newWoSum: 3,
        totalWoSum: 4,
        stockSum: 5,
        postCycleApprovalSum: 0,
      },
    });
    expect(items).toHaveLength(6);
    expect(new Set(items.map((i) => i.key)).size).toBe(6);
  });

  it("prefers finalize as primary when draft NO_QTY sheet is editable", () => {
    const result = resolveRequirementSheetWorkbenchActions({
      isNoQty: true,
      sheet: { id: 1, salesOrderId: 2, status: "DRAFT", periodKey: "2026-05", cycleId: 3 },
      showNoQtyCreateWorkspace: false,
      showNoQtyFinalizeActions: true,
      noQtyFinalizeDisabled: false,
      draftUi: true,
      noQtyDraftCanFinalize: true,
      busy: false,
      noSheetsUi: false,
      canCreateNextRs: true,
      createNextRsEligible: false,
      nextCycleNoForRs: 2,
      nextRsPrepareBusy: false,
      readyToPlaceWo: false,
      processStageKey: null,
      showNoQtyLockedRsContextPanel: false,
      locked: false,
      onFinalize: () => {},
      onCreateSheet: () => {},
      onCreateNewSheetFromEmpty: () => {},
      onPrepareNextRs: () => {},
    });
    expect(result.primary?.key).toBe("finalize");
  });

  it("uses planning CTA when locked and not eligible for next RS", () => {
    const result = resolveRequirementSheetWorkbenchActions({
      isNoQty: true,
      sheet: { id: 1, salesOrderId: 2, status: "LOCKED", periodKey: "2026-05", cycleId: 3 },
      showNoQtyCreateWorkspace: false,
      showNoQtyFinalizeActions: false,
      noQtyFinalizeDisabled: true,
      draftUi: false,
      noQtyDraftCanFinalize: true,
      busy: false,
      noSheetsUi: false,
      canCreateNextRs: false,
      createNextRsEligible: false,
      nextCycleNoForRs: 2,
      nextRsPrepareBusy: false,
      readyToPlaceWo: false,
      processStageKey: "NO_QTY_REQUIREMENT_READY",
      showNoQtyLockedRsContextPanel: true,
      locked: true,
      onFinalize: () => {},
      onCreateSheet: () => {},
      onCreateNewSheetFromEmpty: () => {},
      onPrepareNextRs: () => {},
    });
    expect(result.primary?.key).toBe("planning-cta");
    expect(result.primary?.href).toContain("/monthly-planning");
  });
});
