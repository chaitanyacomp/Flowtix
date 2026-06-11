import { describe, expect, it } from "vitest";

import {
  buildWoPrepareBlockedCardModel,
  buildWoPrepareGuidedStripModel,
  buildWoPrepareReadinessChecklist,
  deriveWoPrepareWorkflowState,
  deriveWoPrepareWorkflowStepLabel,
  rmLineDisplayStatus,
} from "../../src/lib/woPrepareWorkflowGuidance";

describe("woPrepareWorkflowGuidance", () => {
  it("derives validation scenarios 1–5", () => {
    expect(
      deriveWoPrepareWorkflowState({
        canCreateWorkOrder: false,
        hasRmShortage: true,
        hasPendingMr: false,
        hasExistingWorkOrder: false,
        allFgEnough: false,
      }),
    ).toBe("NO_MR");

    expect(
      deriveWoPrepareWorkflowState({
        canCreateWorkOrder: false,
        hasRmShortage: true,
        hasPendingMr: true,
        hasExistingWorkOrder: false,
        allFgEnough: false,
        pendingPoStatus: "No PO yet",
        pendingGrnStatus: "—",
      }),
    ).toBe("PROCUREMENT_PENDING");

    expect(
      deriveWoPrepareWorkflowState({
        canCreateWorkOrder: false,
        hasRmShortage: true,
        hasPendingMr: true,
        hasExistingWorkOrder: false,
        allFgEnough: false,
        pendingPoStatus: "PO open",
        pendingGrnStatus: "Awaiting GRN",
      }),
    ).toBe("WAITING_GRN");

    expect(
      deriveWoPrepareWorkflowState({
        canCreateWorkOrder: true,
        hasRmShortage: false,
        hasPendingMr: false,
        hasExistingWorkOrder: false,
        allFgEnough: false,
      }),
    ).toBe("READY_FOR_WO");

    expect(
      deriveWoPrepareWorkflowState({
        canCreateWorkOrder: false,
        hasRmShortage: true,
        hasPendingMr: true,
        hasExistingWorkOrder: true,
        allFgEnough: false,
      }),
    ).toBe("WO_CREATED");
  });

  it("maps RM line status for shortage with and without MR", () => {
    expect(
      rmLineDisplayStatus({ shortage: 100, available: 0, hasPendingMr: false, canCreateWorkOrder: false }),
    ).toBe("Blocked");
    expect(
      rmLineDisplayStatus({ shortage: 100, available: 50, hasPendingMr: false, canCreateWorkOrder: false }),
    ).toBe("Partial");
    expect(
      rmLineDisplayStatus({ shortage: 100, available: 0, hasPendingMr: true, canCreateWorkOrder: false }),
    ).toBe("Waiting Procurement");
    expect(rmLineDisplayStatus({ shortage: 0, available: 0, hasPendingMr: false, canCreateWorkOrder: true })).toBe(
      "Ready",
    );
  });

  it("builds primary CTA per state", () => {
    const noop = () => {};
    const noMr = buildWoPrepareGuidedStripModel({
      state: "NO_MR",
      salesOrderId: 1,
      pendingMrLabel: "",
      canRaiseMr: true,
      raisingMr: false,
      canStartWo: false,
      woCreateDisabled: true,
      loading: false,
      onRaiseMr: noop,
      onCreateWo: noop,
      onResumeWo: noop,
      onRefreshAvailability: noop,
    });
    expect(noMr?.primaryLabel).toBe("Open RM Control Center");
    expect(noMr?.primaryKind).toBe("link");
    expect(noMr?.primaryHref).toContain("/reports/rm-shortage");
    expect(noMr?.tertiaryLabel).toBe("Refresh Status");

    const proc = buildWoPrepareGuidedStripModel({
      state: "PROCUREMENT_PENDING",
      salesOrderId: 1,
      pendingMrLabel: "MR-26-0007",
      firstMrId: 7,
      canRaiseMr: false,
      raisingMr: false,
      canStartWo: false,
      woCreateDisabled: true,
      loading: false,
      onRaiseMr: noop,
      onCreateWo: noop,
      onResumeWo: noop,
      onRefreshAvailability: noop,
    });
    expect(proc?.primaryLabel).toBe("Open RM Control Center");
    expect(proc?.secondaryLabel).toBeUndefined();
  });

  it("builds blocked card and readiness checklist for RM shortage", () => {
    const step = deriveWoPrepareWorkflowStepLabel({
      workflowState: "NO_MR",
      canCreateWorkOrder: false,
      hasRmShortage: true,
      hasPendingMr: false,
      hasExistingWorkOrder: false,
      allRmAvailable: false,
    });
    expect(step).toBe("RM Shortage");

    const card = buildWoPrepareBlockedCardModel({
      workflowState: "NO_MR",
      stepLabel: step,
      salesOrderId: 42,
      onRefresh: () => {},
    });
    expect(card.title).toBe("Work Order Creation Blocked");
    expect(card.reason).toContain("not available in Store");
    expect(card.nextAction).toContain("RM Control Center");
    expect(card.rmWorkspaceHref).toContain("salesOrderId=42");

    const checklist = buildWoPrepareReadinessChecklist({
      salesOrderApproved: true,
      rmAvailableInStore: false,
      workOrderCreationAllowed: false,
      productionReady: false,
    });
    expect(checklist.filter((i) => i.met).map((i) => i.label)).toEqual(["Sales Order Approved"]);
  });
});
