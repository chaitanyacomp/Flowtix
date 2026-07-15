const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveActionNeeded,
  isNoQtyWoPlacementActionable,
  pickPlacementSheetCandidate,
  buildExecutionRegisterFieldsFromPick,
} = require("../../src/services/noQtyExecutionRegisterService");

function assessment(overrides = {}) {
  return {
    requirementSheetId: 22,
    cycleId: 2,
    rsBalanceQty: 9000,
    suggestedWoQty: 9000,
    placementStatus: "READY",
    readinessStatus: "READY_TO_PLACE_WO",
    released: false,
    existingWoSummary: [{ woStatus: "COMPLETED", rmPendingIssueQty: 0 }],
    ...overrides,
  };
}

describe("NO_QTY active-cycle primary action", () => {
  it("A: completed earlier WO does not hide RM-ready active-cycle placement", () => {
    const row = assessment();
    assert.equal(deriveActionNeeded(row).key, "PLACE_WO");
    assert.equal(isNoQtyWoPlacementActionable(row), true);
  });

  it("B: remaining balance with no executable FG awaits procurement", () => {
    assert.equal(deriveActionNeeded(assessment({ suggestedWoQty: 0 })).key, "AWAIT_PROCUREMENT");
  });

  it("C/D: active-cycle balance or open WO remains selected over another cycle", () => {
    const active = { sheet: { id: 22, cycleId: 2 }, assessment: assessment() };
    const other = {
      sheet: { id: 33, cycleId: 3 },
      assessment: assessment({ requirementSheetId: 33, cycleId: 3, rsBalanceQty: 12000, suggestedWoQty: 12000 }),
    };
    assert.equal(pickPlacementSheetCandidate([other, active], 2).sheet.id, 22);
    const openActive = {
      ...active,
      assessment: assessment({ rsBalanceQty: 0, suggestedWoQty: 0, existingWoSummary: [{ woStatus: "IN_PROGRESS" }] }),
    };
    assert.equal(pickPlacementSheetCandidate([other, openActive], 2).sheet.id, 22);
  });

  it("E/F: completed cycle resolves COMPLETE and register shares Cycle 2 target", () => {
    assert.equal(deriveActionNeeded(assessment({ rsBalanceQty: 0, suggestedWoQty: 0 })).key, "COMPLETE");
    const pick = { sheet: { id: 22, cycleId: 2, docNo: "RS-26-0002" }, assessment: assessment() };
    const register = buildExecutionRegisterFieldsFromPick(1, pick);
    assert.equal(register.actionNeededKey, "PLACE_WO");
    assert.match(register.executionWorkspaceHref, /cycleId=2/);
    assert.match(register.executionWorkspaceHref, /sheetId=22/);
  });

  it("PLACE_WO register fields stay mutually consistent even when assessor says AWAITING_PROCUREMENT", () => {
    const pick = {
      sheet: { id: 22, cycleId: 2, docNo: "RS-26-0002" },
      assessment: assessment({
        placementStatus: "AWAITING_PROCUREMENT",
        readinessStatus: "AWAITING_PROCUREMENT",
        released: false,
      }),
    };
    const register = buildExecutionRegisterFieldsFromPick(171, pick);
    assert.equal(register.actionNeededKey, "PLACE_WO");
    assert.equal(register.actionNeededLabel, "Create Work Order");
    assert.equal(register.rmCoverageStatus, "READY");
    assert.equal(register.rmCoverageLabel, "Ready");
    assert.equal(register.ctaLabel, "Create Work Order");
    assert.equal(register.showProcurementPendingHint, false);
    assert.equal(register.rsBalanceQty, 9000);
    assert.equal(register.suggestedWoQty, 9000);
    assert.equal(register.placementRequirementSheetNo, "RS-26-0002");
    assert.equal(register.placementCycleId, 2);
    assert.match(register.executionWorkspaceHref, /sheetId=22/);
    assert.match(register.executionWorkspaceHref, /cycleId=2/);
    assert.match(register.executionWorkspaceHref, /focus=execution/);
    // CTA / RM / action must not drift into procurement-pending presentation
    assert.notEqual(register.ctaLabel, "View Planning Status");
    assert.notEqual(register.rmCoverageLabel, "Awaiting RM");
  });

  it("AWAIT_PROCUREMENT register fields stay mutually consistent", () => {
    const pick = {
      sheet: { id: 22, cycleId: 2, docNo: "RS-26-0002" },
      assessment: assessment({
        suggestedWoQty: 0,
        placementStatus: "AWAITING_PROCUREMENT",
        readinessStatus: "AWAITING_PROCUREMENT",
      }),
    };
    const register = buildExecutionRegisterFieldsFromPick(171, pick);
    assert.equal(register.actionNeededKey, "AWAIT_PROCUREMENT");
    assert.equal(register.actionNeededLabel, "Await Procurement");
    assert.equal(register.rmCoverageLabel, "Awaiting RM");
    assert.equal(register.ctaLabel, "View Planning Status");
    assert.equal(register.showProcurementPendingHint, true);
  });
});
