import { describe, expect, it } from "vitest";

import { resolveNoQtyDashboardContinuation } from "../../src/lib/noQtyDashboardContinuation";
import { isNoQtyDashboardPlanningRow } from "../../src/lib/dashboardActionQueue";
import type { NoQtyFlowState } from "../../src/lib/noQtyFlowState";

/**
 * The Planning Dashboard renders a *commercial continuation* list of OPEN
 * NO_QTY sales orders for ADMIN. This list lives parallel to the
 * shop-floor queues (Production / QC / Dispatch / RM) on the same
 * operational column but encodes a different business intent: it is the
 * planning continuation surface (Next RS / Open Draft RS / Close SO),
 * not an operational action queue.
 *
 * These tests pin down two invariants that protect that separation:
 *
 *  1. `resolveNoQtyDashboardContinuation` with `commercialContinuation:
 *     true` ALWAYS lands on a planning action for ADMIN — never
 *     on "Open QC" / "Open Production" / "Open Dispatch" / "Open Sales
 *     Bill" — even when the flow state advertises pending QC / dispatch
 *     and reports `createNextRsEligible: false`. (The actual Next RS
 *     eligibility check is deferred to click time.)
 *
 *  2. `isNoQtyDashboardPlanningRow` accepts the resulting `prepare_next_rs`
 *     resolution so the dashboard does not silently drop the row.
 *
 * If either invariant breaks, the dashboard regresses to the previous
 * bug where the NO_QTY continuation row disappears as soon as operational
 * queues clear (showing "Operations clear" while the SO is still OPEN
 * between cycles).
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
  it("always returns prepare_next_rs for ADMIN on the dashboard even when createNextRsEligible is false and QC is pending", () => {
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
    expect(resolved.kind).toBe("prepare_next_rs");
    expect(resolved.label).toBe("Next RS");
  });

  it("always returns prepare_next_rs for ADMIN on the dashboard even when nextAction is DISPATCH", () => {
    const flow: NoQtyFlowState = {
      ...baseFlow,
      createNextRsEligible: false,
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

  it("still navigates to the draft RS workspace when lastRsStatus is DRAFT (operators must open and finalize the draft)", () => {
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
    expect(resolved.label).toBe("Next RS");
    if (resolved.kind === "navigate") {
      expect(resolved.to).toContain("/sales-orders/1/requirement-sheets");
      expect(resolved.to).toContain("sheetId=42");
    }
  });

  it("falls back to prepare_next_rs for ADMIN even when flow has not loaded yet (commercial continuation never blanks the row mid-fetch)", () => {
    const resolved = resolveNoQtyDashboardContinuation({
      salesOrderId: 1,
      cycleId: 10,
      latestRequirementSheetId: null,
      lastRsStatus: null,
      flow: null,
      viewerRole: "ADMIN",
      commercialContinuation: true,
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
    // ADMIN with QC pending and no planning eligibility → legacy resolver routes to QC.
    expect(resolved.kind).toBe("navigate");
    if (resolved.kind === "navigate") {
      expect(resolved.label).toBe("Complete QA");
    }
  });
});

describe("isNoQtyDashboardPlanningRow", () => {
  it("accepts prepare_next_rs resolutions regardless of createNextRsEligible (the gate is deferred to click time)", () => {
    expect(
      isNoQtyDashboardPlanningRow(
        { createNextRsEligible: false },
        { kind: "prepare_next_rs" },
      ),
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
