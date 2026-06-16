import { describe, expect, it } from "vitest";
import { NO_QTY_TERMS } from "../../src/lib/flowTerminology";
import { resolveGuidedWorkflow } from "../../src/lib/rmGuidedWorkflow";
import { noQtyRmShortagePlanningHref } from "../../src/lib/woPrepareOperationalStage";

describe("noQtyRmShortagePlanningHref", () => {
  it("routes NO_QTY planning dashboard shortage CTA to Monthly Planning", () => {
    expect(noQtyRmShortagePlanningHref()).toBe("/monthly-planning");
    expect(noQtyRmShortagePlanningHref({ source: "planning_dashboard" })).toBe(
      "/monthly-planning?source=planning_dashboard",
    );
    expect(noQtyRmShortagePlanningHref({ salesOrderId: 42, source: "planning_dashboard" })).toBe(
      "/monthly-planning?source=planning_dashboard&salesOrderId=42",
    );
  });

  it("does not route to Order RM Planning", () => {
    const href = noQtyRmShortagePlanningHref({ salesOrderId: 1, source: "planning_dashboard" });
    expect(href).not.toContain("/material-planning");
  });
});

describe("NO_QTY planning terminology", () => {
  it("labels shortage CTA as Monthly Planning", () => {
    expect(NO_QTY_TERMS.OPEN_RM_SHORTAGE_MONTHLY_PLANNING).toBe("Open Monthly Planning");
    expect(NO_QTY_TERMS.OPEN_RM_PURCHASE_FROM_SHORTAGE).toBe("Open Monthly Planning");
  });
});

describe("resolveGuidedWorkflow NO_QTY requisition navigation", () => {
  it("does not send NO_QTY Open RM Requisition to Order RM Planning", () => {
    const guided = resolveGuidedWorkflow({
      storeActionKey: "CONTINUE_PROCUREMENT",
      escalation: {
        state: "MR_ESCALATED",
        procurementInitiated: true,
        headline: "RM Requisition raised",
        materialRequirementDocNo: "MR-26-0001",
      },
      caseSupply: { summary: { prLineCount: 0, poLineCount: 0 } },
      rmLines: [{ freeStockQty: 0, shortageAfterReservationQty: 50 }],
      anyIssueable: false,
      hasWaitingPmr: true,
      workOrderId: 10,
      salesOrderId: 20,
      orderType: "NO_QTY",
      materialRequirementId: 99,
      mrStatus: "APPROVED",
    });
    expect(guided.phase).toBe("B_MR_ESCALATED");
    expect(guided.primaryAction.href).toContain("/reports/rm-shortage");
    expect(guided.primaryAction.href).not.toContain("/material-planning");
  });
});
