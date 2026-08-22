import { describe, expect, it } from "vitest";
import {
  formatRegularSoClosureQty,
  regularSoDemandCoveredStatusMessage,
  shouldHideRegularProductionEntryForReport,
  shouldOfferRegularContinueLater,
  shouldOfferRegularEndProductionCovered,
  shouldOfferRegularEndProductionShortage,
} from "../../src/lib/regularSoProductionClosureUx";
import { shouldShowScopedProductionReport } from "../../src/lib/productionScopedWorkspaceState";

describe("regularSoProductionClosureUx", () => {
  const covered = {
    soDemandCovered: true,
    woTargetBalance: 75,
    expectedExcessBeforeQc: 25,
    canEndProductionWithWoRemainder: true,
    reportPending: false,
    hasSoShortage: false,
    producedQty: 10025,
  };

  const equalToSo = {
    soDemandCovered: true,
    woTargetBalance: 100,
    expectedExcessBeforeQc: 0,
    canEndProductionWithWoRemainder: true,
    reportPending: false,
    hasSoShortage: false,
    producedQty: 10000,
  };

  const belowSo = {
    soDemandCovered: false,
    woTargetBalance: 200,
    expectedExcessBeforeQc: 0,
    canEndProductionWithWoRemainder: false,
    reportPending: false,
    hasSoShortage: true,
    producedQty: 9900,
  };

  it("shows SO demand covered status with excess before QC", () => {
    expect(regularSoDemandCoveredStatusMessage(covered, "Nos")).toBe(
      "SO demand covered — 25 Nos produced above SO demand.",
    );
    expect(shouldOfferRegularEndProductionCovered(covered)).toBe(true);
    expect(shouldOfferRegularEndProductionShortage(covered)).toBe(false);
    expect(shouldOfferRegularContinueLater(covered)).toBe(false);
    expect(shouldHideRegularProductionEntryForReport(covered)).toBe(true);
  });

  it("hides entry and Continue Later when produced equals SO qty", () => {
    expect(shouldHideRegularProductionEntryForReport(equalToSo)).toBe(true);
    expect(shouldOfferRegularEndProductionCovered(equalToSo)).toBe(true);
    expect(shouldOfferRegularContinueLater(equalToSo)).toBe(false);
  });

  it("keeps the production entry form when produced is below SO qty", () => {
    expect(shouldHideRegularProductionEntryForReport(belowSo)).toBe(false);
    expect(shouldOfferRegularEndProductionCovered(belowSo)).toBe(false);
    expect(shouldOfferRegularEndProductionShortage(belowSo)).toBe(true);
    expect(shouldOfferRegularContinueLater(belowSo)).toBe(true);
  });

  it("hides entry while report pending", () => {
    expect(shouldHideRegularProductionEntryForReport({ reportPending: true })).toBe(true);
    expect(shouldOfferRegularEndProductionCovered({ ...covered, reportPending: true })).toBe(false);
    expect(shouldOfferRegularContinueLater({ ...belowSo, reportPending: true })).toBe(false);
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
    expect(formatRegularSoClosureQty(10025, "Nos")).toBe("10025 Nos");
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
        regularSo: { enabled: true, reportPending: true, woTargetBalance: 75 },
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
        regularSo: { enabled: true, reportPending: false, woTargetBalance: 75 },
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
