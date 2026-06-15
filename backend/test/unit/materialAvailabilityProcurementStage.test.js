const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveLineBlocker,
  deriveCaseStoreAction,
} = require("../../src/services/materialAvailabilityWorkspaceService");

describe("materialAvailabilityWorkspace procurement stage alignment", () => {
  it("deriveLineBlocker prefers PR stage over PMR waiting when stock is zero", () => {
    const blocker = deriveLineBlocker(
      {
        freeStockQty: 0,
        shortageAfterReservationQty: 50,
        coveredByIncomingQty: 0,
        legacyReservedQty: 0,
        activeAllocatedQty: 0,
        physicalUsableStockQty: 0,
        requiredQty: 50,
        warnings: [],
      },
      {
        pmrStatus: { openPmrs: [{ status: "REQUESTED", lines: [{ rmItemId: 10, pendingQty: 50 }] }] },
        trace: {
          prLines: [{ purchaseRequestLineId: 1 }],
          poLines: [],
          openMrLines: [{ sourceType: "MONTHLY_PLAN", materialRequirementId: 99 }],
        },
        hasWorkOrder: true,
      },
    );
    assert.equal(blocker, "RM Requisition sent, PR/PO pending");
  });

  it("deriveCaseStoreAction returns WAIT_PO when PR exists and stock is zero", () => {
    const action = deriveCaseStoreAction({
      rmLines: [
        {
          rmItemId: 10,
          freeStockQty: 0,
          netShortageAfterIncomingQty: 50,
          shortageAfterReservationQty: 50,
        },
      ],
      pmrStatus: { openPmrs: [{ status: "REQUESTED", lines: [{ rmItemId: 10, pendingQty: 50 }] }] },
      woMr: null,
      terminalMr: null,
      caseSupply: {
        summary: { prLineCount: 1, poLineCount: 0, pendingGrnQty: 0 },
        openMrLines: [{ sourceType: "MONTHLY_PLAN", materialRequirementId: 99 }],
      },
      escalation: {
        state: "PROCUREMENT_IN_PROGRESS",
        procurementInitiated: true,
        description: "Purchase in progress",
      },
      shortageSummary: { unresolvedLineCount: 1 },
    });
    assert.equal(action.key, "WAIT_PO");
    assert.match(action.label, /Waiting for Purchase/i);
  });

  it("deriveCaseStoreAction does not return ISSUE when PMR open but stock is zero", () => {
    const action = deriveCaseStoreAction({
      rmLines: [{ rmItemId: 10, freeStockQty: 0, netShortageAfterIncomingQty: 0, shortageAfterReservationQty: 0 }],
      pmrStatus: { openPmrs: [{ status: "REQUESTED", lines: [{ rmItemId: 10, pendingQty: 50 }] }] },
      woMr: null,
      terminalMr: null,
      caseSupply: { summary: { prLineCount: 0, poLineCount: 0, pendingGrnQty: 0 }, openMrLines: [] },
      escalation: { state: "NOT_ESCALATED", procurementInitiated: false },
      shortageSummary: { unresolvedLineCount: 0 },
    });
    assert.notEqual(action.key, "ISSUE");
  });
});
