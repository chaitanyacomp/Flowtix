import { describe, expect, it } from "vitest";
import {
  formatRegularSoClosureQty,
  regularSoDemandCoveredStatusMessage,
  shouldHideRegularProductionEntryForReport,
  shouldOfferRegularEndProductionCovered,
  shouldOfferRegularEndProductionShortage,
} from "../../src/lib/regularSoProductionClosureUx";
import { shouldShowScopedProductionReport } from "../../src/lib/productionScopedWorkspaceState";

describe("regularSoProductionClosureUx", () => {
  const covered = {
    soDemandCovered: true,
    woTargetBalance: 13,
    expectedExcessBeforeQc: 87,
    canEndProductionWithWoRemainder: true,
    reportPending: false,
    hasSoShortage: false,
    producedQty: 10087,
  };

  it("shows SO demand covered status with excess before QC", () => {
    expect(regularSoDemandCoveredStatusMessage(covered, "Nos")).toBe(
      "SO demand covered — 87 Nos produced above SO demand.",
    );
    expect(shouldOfferRegularEndProductionCovered(covered)).toBe(true);
    expect(shouldOfferRegularEndProductionShortage(covered)).toBe(false);
  });

  it("hides entry while report pending", () => {
    expect(shouldHideRegularProductionEntryForReport({ reportPending: true })).toBe(true);
    expect(shouldOfferRegularEndProductionCovered({ ...covered, reportPending: true })).toBe(false);
  });

  it("offers shortage end when produced below SO demand", () => {
    expect(
      shouldOfferRegularEndProductionShortage({
        hasSoShortage: true,
        producedQty: 9000,
        reportPending: false,
      }),
    ).toBe(true);
  });

  it("formats quantities with unit", () => {
    expect(formatRegularSoClosureQty(10087, "Nos")).toBe("10087 Nos");
  });
});

describe("shouldShowScopedProductionReport — REGULAR SO", () => {
  it("shows report when REGULAR End Production parks report-pending", () => {
    expect(
      shouldShowScopedProductionReport({
        workOrderId: 5,
        hasApprovedProductionOnWorkOrder: true,
        navigateNoQtyContext: false,
        executionSummary: null,
        regularSo: { enabled: true, reportPending: true, woTargetBalance: 13 },
      }),
    ).toBe(true);
  });

  it("does not force report while SO covered but End Production not requested and WO balance remains", () => {
    expect(
      shouldShowScopedProductionReport({
        workOrderId: 5,
        hasApprovedProductionOnWorkOrder: true,
        navigateNoQtyContext: false,
        executionSummary: null,
        regularSo: { enabled: true, reportPending: false, woTargetBalance: 13 },
      }),
    ).toBe(false);
  });

  it("shows report when REGULAR WO target balance is zero", () => {
    expect(
      shouldShowScopedProductionReport({
        workOrderId: 5,
        hasApprovedProductionOnWorkOrder: true,
        navigateNoQtyContext: false,
        executionSummary: null,
        regularSo: { enabled: true, reportPending: false, woTargetBalance: 0 },
      }),
    ).toBe(true);
  });
});
