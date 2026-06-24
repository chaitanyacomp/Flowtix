import { describe, expect, it } from "vitest";

import { resolveNoQtyDashboardContinuation } from "../../src/lib/noQtyDashboardContinuation";
import { isNoQtyDashboardPlanningRow } from "../../src/lib/dashboardActionQueue";
import type { NoQtyFlowState } from "../../src/lib/noQtyFlowState";

/**
 * Commercial continuation on the Planning Dashboard must stay planning-only
 * (never QC / Production / Dispatch) while using correct cycle labels:
 *   - no RS → creation workspace (Cycle 1)
 *   - draft → open draft sheet
 *   - locked + createNextRsEligible → prepare next RS
 */

const baseFlow: NoQtyFlowState = {
  salesOrderId: 1,
  cycleId: 10,
  isCompleted: false,
  requirementExists: true,
  requirementLocked: true,
  workOrderExists: false,
  workOrderId: null,
  productionExists: false,
  qcExists: false,
  dispatchExists: false,
  salesBillExists: false,
  nextAction: "WORK_ORDER",
  activeStep: 2,
  createNextRsEligible: false,
};

describe("resolveNoQtyDashboardContinuation — commercial continuation", () => {
  it("opens current RS workspace for ADMIN when createNextRsEligible is false (not prepare_next_rs)", () => {
    const flow: NoQtyFlowState = {
      ...baseFlow,
      createNextRsEligible: false,
      qcPendingForCycle: true,
      hasQcDispatchPending: true,
      nextAction: "QC",
    };
    const resolved = resolveNoQtyDashboardContinuation({
      salesOrderId: 1,
      cycleId: 10,
      latestRequirementSheetId: 99,
      lastRsStatus: "LOCKED",
      flow,
      viewerRole: "ADMIN",
      commercialContinuation: true,
    });
    expect(resolved.kind).toBe("navigate");
    if (resolved.kind === "navigate") {
      expect(resolved.to).toContain("/sales-orders/1/requirement-sheets");
      expect(resolved.label).toBe("Open Requirement Sheet");
    }
  });

  it("returns prepare_next_rs for ADMIN when createNextRsEligible is true", () => {
    const flow: NoQtyFlowState = {
      ...baseFlow,
      createNextRsEligible: true,
      hasQcDispatchPending: true,
      nextAction: "DISPATCH",
    };
    const resolved = resolveNoQtyDashboardContinuation({
      salesOrderId: 1,
      cycleId: 10,
      latestRequirementSheetId: 99,
      lastRsStatus: "LOCKED",
      flow,
      viewerRole: "ADMIN",
      commercialContinuation: true,
    });
    expect(resolved.kind).toBe("prepare_next_rs");
  });

  it("still navigates to the draft RS workspace when lastRsStatus is DRAFT", () => {
    const flow: NoQtyFlowState = {
      ...baseFlow,
      requirementLocked: false,
      requirementExists: true,
    };
    const resolved = resolveNoQtyDashboardContinuation({
      salesOrderId: 1,
      cycleId: 10,
      latestRequirementSheetId: 42,
      lastRsStatus: "DRAFT",
      flow,
      viewerRole: "ADMIN",
      commercialContinuation: true,
    });
    expect(resolved.kind).toBe("navigate");
    if (resolved.kind === "navigate") {
      expect(resolved.to).toContain("/sales-orders/1/requirement-sheets");
      expect(resolved.to).toContain("sheetId=42");
    }
  });

  it("navigates to RS creation workspace when flow has not loaded and no RS exists", () => {
    const resolved = resolveNoQtyDashboardContinuation({
      salesOrderId: 1,
      cycleId: 10,
      latestRequirementSheetId: null,
      lastRsStatus: null,
      flow: null,
      viewerRole: "ADMIN",
      commercialContinuation: true,
    });
    expect(resolved.kind).toBe("navigate");
    if (resolved.kind === "navigate") {
      expect(resolved.to).toContain("intent=add");
      expect(resolved.to).toContain("/sales-orders/1/requirement-sheets");
    }
  });

  it("returns prepare_next_rs for STORE when createNextRsEligible is true", () => {
    const flow: NoQtyFlowState = {
      ...baseFlow,
      createNextRsEligible: true,
      hasQcDispatchPending: true,
      nextAction: "DISPATCH",
      primaryActionForCurrentUser: "DISPATCH",
      roleAllowedSecondaryActions: ["CREATE_NEXT_RS"],
    };
    const resolved = resolveNoQtyDashboardContinuation({
      salesOrderId: 1,
      cycleId: 10,
      latestRequirementSheetId: 99,
      lastRsStatus: "LOCKED",
      flow,
      viewerRole: "STORE",
      commercialContinuation: true,
    });
    expect(resolved.kind).toBe("prepare_next_rs");
  });

  it("returns prepare_next_rs for STORE when createNextRsEligible even with dispatch pending (non-commercial path)", () => {
    const flow: NoQtyFlowState = {
      ...baseFlow,
      createNextRsEligible: true,
      hasQcDispatchPending: true,
      nextAction: "DISPATCH",
      primaryActionForCurrentUser: "CREATE_NEXT_RS",
    };
    const resolved = resolveNoQtyDashboardContinuation({
      salesOrderId: 1,
      cycleId: 10,
      latestRequirementSheetId: 99,
      lastRsStatus: "LOCKED",
      flow,
      viewerRole: "STORE",
    });
    expect(resolved.kind).toBe("prepare_next_rs");
  });

  it("does not override operational resolution when commercialContinuation is false (legacy callers retain QC/Dispatch routing)", () => {
    const flow: NoQtyFlowState = {
      ...baseFlow,
      createNextRsEligible: false,
      qcPendingForCycle: true,
      hasQcDispatchPending: true,
      nextAction: "QC",
    };
    const resolved = resolveNoQtyDashboardContinuation({
      salesOrderId: 1,
      cycleId: 10,
      latestRequirementSheetId: 99,
      lastRsStatus: "LOCKED",
      flow,
      viewerRole: "ADMIN",
    });
    expect(resolved.kind).toBe("navigate");
    if (resolved.kind === "navigate") {
      expect(resolved.label).toBe("Complete QA");
    }
  });

  it("routes STORE commercial continuation to execution workspace when readyToPlaceWo", () => {
    const flow: NoQtyFlowState = {
      ...baseFlow,
      createNextRsEligible: false,
      readyToPlaceWo: true,
      nextAction: "WORK_ORDER",
    };
    const resolved = resolveNoQtyDashboardContinuation({
      salesOrderId: 1,
      cycleId: 10,
      latestRequirementSheetId: 99,
      lastRsStatus: "LOCKED",
      flow,
      viewerRole: "STORE",
      commercialContinuation: true,
    });
    expect(resolved.kind).toBe("navigate");
    if (resolved.kind === "navigate") {
      expect(resolved.label).toBe("Place WO");
      expect(resolved.to).toContain("focus=execution");
      expect(resolved.to).toContain("sheetId=99");
    }
  });

  it("routes WORK_ORDER next action to execution workspace with sheet id", () => {
    const resolved = resolveNoQtyDashboardContinuation({
      salesOrderId: 1,
      cycleId: 10,
      latestRequirementSheetId: 88,
      lastRsStatus: "LOCKED",
      flow: { ...baseFlow, nextAction: "WORK_ORDER" },
      viewerRole: "STORE",
    });
    expect(resolved.kind).toBe("navigate");
    if (resolved.kind === "navigate") {
      expect(resolved.to).toContain("sheetId=88");
      expect(resolved.to).toContain("focus=execution");
    }
  });
});

describe("isNoQtyDashboardPlanningRow", () => {
  it("accepts prepare_next_rs resolutions regardless of createNextRsEligible", () => {
    expect(
      isNoQtyDashboardPlanningRow({ createNextRsEligible: false }, { kind: "prepare_next_rs" }),
    ).toBe(true);
  });

  it("accepts navigates that target the requirement-sheets workspace", () => {
    expect(
      isNoQtyDashboardPlanningRow(
        { createNextRsEligible: false },
        { kind: "navigate", to: "/sales-orders/5/requirement-sheets?cycleId=12&sheetId=99" },
      ),
    ).toBe(true);
  });

  it("rejects shop-floor navigations (QC / Production / Dispatch / Sales Bill)", () => {
    expect(
      isNoQtyDashboardPlanningRow(
        { createNextRsEligible: false },
        { kind: "navigate", to: "/qc-entry?soId=5" },
      ),
    ).toBe(false);
    expect(
      isNoQtyDashboardPlanningRow(
        { createNextRsEligible: false },
        { kind: "navigate", to: "/production?soId=5" },
      ),
    ).toBe(false);
    expect(
      isNoQtyDashboardPlanningRow(
        { createNextRsEligible: false },
        { kind: "navigate", to: "/dispatch?soId=5" },
      ),
    ).toBe(false);
    expect(
      isNoQtyDashboardPlanningRow(
        { createNextRsEligible: false },
        { kind: "navigate", to: "/sales-bills?soId=5" },
      ),
    ).toBe(false);
  });
});
