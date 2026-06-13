import { describe, expect, it } from "vitest";
import {
  APPROVED_PLAN_GUIDANCE,
  approvedPlanGuidanceMessage,
  canLoadRmPurchaseTabs,
  canShowAdditionalPlanEntry,
  formatPlanStatusLabel,
  formatReleaseSuccessSummary,
  formatRmSnapshotContextLabel,
  historicalApprovedPlanBannerMessage,
  isHistoricalPlanDocument,
  isLegacyPlanDocument,
  isPlanEditable,
  legacyPlanWorkflowBannerMessage,
  LEGACY_PLAN_INFO_TOOLTIP,
  planStatusBadgeVariant,
  productionPlanReadOnlyMessage,
  resolvePlanDisplayLabel,
  resolveWorkflowActionVisibility,
  shouldShowPlanSelector,
  usesPlanDocumentProcurementUx,
  type MonthlyPlanHeader,
} from "../../src/lib/monthlyPlanningWorkflowUx";

function plan(overrides: Partial<MonthlyPlanHeader> & Pick<MonthlyPlanHeader, "status">): MonthlyPlanHeader {
  return {
    id: 1,
    currentRevision: 0,
    planSequenceNo: 1,
    planKind: "INITIAL",
    displayLabel: "June Plan 1",
    ...overrides,
  };
}

describe("monthlyPlanningWorkflowUx.isPlanEditable", () => {
  it("DRAFT is editable when user can mutate period", () => {
    expect(isPlanEditable(plan({ status: "DRAFT" }), true)).toBe(true);
  });

  it("AWAITING_PURCHASE_REVIEW is read-only", () => {
    expect(isPlanEditable(plan({ status: "AWAITING_PURCHASE_REVIEW" }), true)).toBe(false);
  });

  it("APPROVED is read-only", () => {
    expect(isPlanEditable(plan({ status: "APPROVED" }), true)).toBe(false);
  });

  it("LOCKED is read-only", () => {
    expect(isPlanEditable(plan({ status: "LOCKED", currentRevision: 1 }), true)).toBe(false);
  });
});

describe("monthlyPlanningWorkflowUx.legacy detection", () => {
  it("LOCKED is legacy", () => {
    expect(isLegacyPlanDocument(plan({ status: "LOCKED", currentRevision: 1 }))).toBe(true);
  });

  it("reopened revision draft is legacy", () => {
    expect(
      isLegacyPlanDocument(
        plan({ status: "DRAFT", currentRevision: 1, reopenedAt: "2026-06-01T00:00:00Z" }),
      ),
    ).toBe(true);
  });

  it("new DRAFT plan document is not legacy", () => {
    expect(isLegacyPlanDocument(plan({ status: "DRAFT", currentRevision: 0 }))).toBe(false);
  });

  it("APPROVED is not legacy lock workflow", () => {
    expect(isLegacyPlanDocument(plan({ status: "APPROVED" }))).toBe(false);
  });
});

describe("monthlyPlanningWorkflowUx.resolveWorkflowActionVisibility", () => {
  const base = {
    planExists: true,
    canMutatePeriod: true,
    canPurchaseReview: true,
    hasSaveableLines: true,
  };

  it("DRAFT shows save and submit, hides purchase actions and release", () => {
    const actions = resolveWorkflowActionVisibility({
      ...base,
      plan: plan({ status: "DRAFT" }),
    });
    expect(actions.save).toBe(true);
    expect(actions.submitForReview).toBe(true);
    expect(actions.approve).toBe(false);
    expect(actions.reject).toBe(false);
    expect(actions.release).toBe(false);
    expect(actions.lock).toBe(false);
  });

  it("AWAITING_PURCHASE_REVIEW is read-only with purchase approve/reject", () => {
    const actions = resolveWorkflowActionVisibility({
      ...base,
      plan: plan({ status: "AWAITING_PURCHASE_REVIEW" }),
    });
    expect(actions.save).toBe(false);
    expect(actions.submitForReview).toBe(false);
    expect(actions.approve).toBe(true);
    expect(actions.reject).toBe(true);
    expect(actions.release).toBe(false);
  });

  it("Store cannot approve/reject when purchase review role missing", () => {
    const actions = resolveWorkflowActionVisibility({
      ...base,
      canPurchaseReview: false,
      plan: plan({ status: "AWAITING_PURCHASE_REVIEW" }),
    });
    expect(actions.approve).toBe(false);
    expect(actions.reject).toBe(false);
  });

  it("APPROVED shows release only among workflow mutations", () => {
    const actions = resolveWorkflowActionVisibility({
      ...base,
      plan: plan({ status: "APPROVED" }),
    });
    expect(actions.save).toBe(false);
    expect(actions.submitForReview).toBe(false);
    expect(actions.approve).toBe(false);
    expect(actions.reject).toBe(false);
    expect(actions.release).toBe(true);
  });

  it("legacy LOCKED shows reopen and release, hides submit", () => {
    const actions = resolveWorkflowActionVisibility({
      ...base,
      plan: plan({ status: "LOCKED", currentRevision: 1 }),
    });
    expect(actions.submitForReview).toBe(false);
    expect(actions.reopen).toBe(true);
    expect(actions.release).toBe(true);
    expect(actions.lock).toBe(false);
  });

  it("legacy DRAFT with revision shows lock, not submit", () => {
    const actions = resolveWorkflowActionVisibility({
      ...base,
      plan: plan({ status: "DRAFT", currentRevision: 1 }),
    });
    expect(actions.submitForReview).toBe(false);
    expect(actions.lock).toBe(true);
  });
});

describe("monthlyPlanningWorkflowUx.tabs and selectors", () => {
  it("RM/Purchase tabs load for APPROVED and LOCKED", () => {
    expect(canLoadRmPurchaseTabs("APPROVED")).toBe(true);
    expect(canLoadRmPurchaseTabs("LOCKED")).toBe(true);
    expect(canLoadRmPurchaseTabs("DRAFT")).toBe(false);
    expect(canLoadRmPurchaseTabs("AWAITING_PURCHASE_REVIEW")).toBe(false);
  });

  it("plan selector visible when plans exist", () => {
    expect(shouldShowPlanSelector([])).toBe(false);
    expect(shouldShowPlanSelector([plan({ status: "DRAFT" })])).toBe(true);
    expect(
      shouldShowPlanSelector([
        plan({ id: 1, status: "APPROVED" }),
        plan({ id: 2, status: "DRAFT", planSequenceNo: 2, planKind: "ADDITIONAL" }),
      ]),
    ).toBe(true);
  });

  it("additional plan entry when approved plan exists and user can mutate", () => {
    expect(
      canShowAdditionalPlanEntry({
        canMutatePeriod: true,
        periodPlans: [plan({ status: "APPROVED" })],
      }),
    ).toBe(true);
    expect(
      canShowAdditionalPlanEntry({
        canMutatePeriod: true,
        periodPlans: [plan({ status: "DRAFT" })],
      }),
    ).toBe(false);
    expect(
      canShowAdditionalPlanEntry({
        canMutatePeriod: false,
        periodPlans: [plan({ status: "APPROVED" })],
      }),
    ).toBe(false);
  });
});

describe("monthlyPlanningWorkflowUx.labels", () => {
  it("formats status badges and labels", () => {
    expect(planStatusBadgeVariant("APPROVED")).toBe("success");
    expect(planStatusBadgeVariant("AWAITING_PURCHASE_REVIEW")).toBe("warning");
    expect(formatPlanStatusLabel("AWAITING_PURCHASE_REVIEW")).toBe("Awaiting Purchase Review");
    expect(resolvePlanDisplayLabel(plan({ status: "DRAFT", displayLabel: "June Plan 2" }))).toBe(
      "June Plan 2",
    );
  });

  it("uses plan document labels instead of revision wording on APPROVED plans", () => {
    const approved = plan({ status: "APPROVED", displayLabel: "June Plan 1" });
    expect(usesPlanDocumentProcurementUx(approved)).toBe(true);
    expect(
      formatRmSnapshotContextLabel({ plan: approved, snapshotRevision: 1, lineCount: 4 }),
    ).toBe("June Plan 1 · 4 RM lines (audit snapshot)");
    expect(
      formatReleaseSuccessSummary({
        plan: approved,
        releaseRevision: 1,
        materialRequirementDocNo: "MR-26-0001",
        releasedLineCount: 2,
        totalDeltaQty: 50,
        skippedLineCount: 0,
        surplusLineCount: 0,
      }),
    ).toContain("Demand Released from June Plan 1");
    expect(
      formatReleaseSuccessSummary({
        plan: approved,
        releaseRevision: 1,
        materialRequirementDocNo: "MR-26-0001",
        releasedLineCount: 2,
        totalDeltaQty: 50,
        skippedLineCount: 0,
        surplusLineCount: 0,
      }),
    ).not.toContain("revision");
  });

  it("uses legacy snapshot wording for legacy LOCKED plans", () => {
    const legacy = plan({ status: "LOCKED", currentRevision: 2, displayLabel: "June Plan 1" });
    expect(usesPlanDocumentProcurementUx(legacy)).toBe(false);
    expect(
      formatRmSnapshotContextLabel({ plan: legacy, snapshotRevision: 2, lineCount: 3 }),
    ).toBe("Legacy lock snapshot 2 · 3 RM lines (read-only)");
    expect(productionPlanReadOnlyMessage(legacy)).toContain("Legacy plan");
    expect(productionPlanReadOnlyMessage(legacy)).toContain("Reopen Plan");
  });

  it("guides APPROVED plans toward Additional Plan without reopen wording", () => {
    const approved = plan({ status: "APPROVED", displayLabel: "June Plan 1", planSequenceNo: 1 });
    expect(approvedPlanGuidanceMessage()).toBe(APPROVED_PLAN_GUIDANCE);
    expect(approvedPlanGuidanceMessage({ canCreateAdditionalPlan: true })).toContain(
      "Create Additional Plan",
    );
    expect(productionPlanReadOnlyMessage(approved, { canCreateAdditionalPlan: true })).toContain(
      APPROVED_PLAN_GUIDANCE,
    );
    expect(productionPlanReadOnlyMessage(approved)).not.toContain("Reopen");
    expect(productionPlanReadOnlyMessage(approved)).not.toContain("revision");
  });

  it("identifies historical approved plan documents in a period", () => {
    const plan1 = plan({ id: 1, status: "APPROVED", displayLabel: "June Plan 1", planSequenceNo: 1 });
    const plan2 = plan({
      id: 2,
      status: "DRAFT",
      displayLabel: "June Plan 2",
      planSequenceNo: 2,
      planKind: "ADDITIONAL",
    });
    const periodPlans = [plan1, plan2];
    expect(isHistoricalPlanDocument(plan1, periodPlans)).toBe(true);
    expect(isHistoricalPlanDocument(plan2, periodPlans)).toBe(false);
    expect(historicalApprovedPlanBannerMessage(plan1, periodPlans)).toContain("June Plan 2");
    expect(historicalApprovedPlanBannerMessage(plan1, periodPlans)).toContain("not modified");
  });

  it("legacy workflow banner explains isolation from modern plan documents", () => {
    expect(legacyPlanWorkflowBannerMessage()).toContain("Legacy plan");
    expect(legacyPlanWorkflowBannerMessage()).toContain("Create Additional Plan");
    expect(LEGACY_PLAN_INFO_TOOLTIP).toBe(legacyPlanWorkflowBannerMessage());
  });
});
