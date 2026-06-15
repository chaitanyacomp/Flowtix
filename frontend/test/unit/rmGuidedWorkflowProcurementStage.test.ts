import { describe, expect, it } from "vitest";
import { resolveGuidedWorkflow } from "../../src/lib/rmGuidedWorkflow";
import { PROCUREMENT_TERMS } from "../../src/lib/procurementTerminology";

describe("rmGuidedWorkflow procurement stage", () => {
  it("does not enter ready-to-issue when PMR exists but stock is not issueable", () => {
    const guided = resolveGuidedWorkflow({
      storeActionKey: "REVIEW",
      escalation: { state: "PROCUREMENT_IN_PROGRESS", procurementInitiated: true, headline: "Purchase in progress" },
      caseSupply: { summary: { prLineCount: 1, poLineCount: 0, pendingGrnQty: 0 }, prLines: [{ pendingPoQty: 50 }] },
      rmLines: [{ freeStockQty: 0, shortageAfterReservationQty: 50, netShortageAfterIncomingQty: 50 }],
      anyIssueable: false,
      hasWaitingPmr: true,
      workOrderId: 1,
      salesOrderId: 2,
      materialRequirementId: 99,
    });
    expect(guided.phase).not.toBe("E_READY_TO_ISSUE");
    expect(guided.showMaterialIssueSection).toBe(false);
  });

  it("after PR shows waiting for Purchase on Store RM CC", () => {
    const guided = resolveGuidedWorkflow({
      storeActionKey: "WAIT_PO",
      escalation: { state: "PROCUREMENT_IN_PROGRESS", procurementInitiated: true, headline: "Purchase in progress" },
      caseSupply: { summary: { prLineCount: 1, poLineCount: 0, pendingGrnQty: 0 }, prLines: [{ pendingPoQty: 50 }] },
      rmLines: [{ freeStockQty: 0, shortageAfterReservationQty: 50, netShortageAfterIncomingQty: 50 }],
      anyIssueable: false,
      hasWaitingPmr: true,
      workOrderId: 1,
      salesOrderId: 2,
      materialRequirementId: 99,
    });
    expect(guided.phase).toBe("C_PR_CREATED");
    expect(guided.primaryAction.label).toBe(PROCUREMENT_TERMS.WAITING_FOR_PURCHASE_RM_PO);
    expect(guided.showMaterialIssueSection).toBe(false);
  });

  it("enters ready-to-issue only when anyIssueable is true", () => {
    const guided = resolveGuidedWorkflow({
      storeActionKey: "ISSUE",
      escalation: { state: "PROCUREMENT_COMPLETED", procurementInitiated: true },
      caseSupply: { summary: { prLineCount: 1, poLineCount: 1, pendingGrnQty: 0, receivedGrnQty: 50 } },
      rmLines: [{ freeStockQty: 100, blockerReason: "Ready for material issue", shortageAfterReservationQty: 0 }],
      anyIssueable: true,
      hasWaitingPmr: true,
      workOrderId: 1,
      salesOrderId: 2,
      materialRequirementId: 99,
    });
    expect(guided.phase).toBe("E_READY_TO_ISSUE");
    expect(guided.primaryAction.label).toBe("Issue RM to Production");
  });
});
