const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRequirementSheetHref,
  resolveRsStatus,
  resolveLockedPeriodKey,
  sortInboxRows,
} = require("../../src/services/noQtyPlanningInboxService");
const {
  ACTION_NEEDED,
  buildExecutionRegisterFieldsFromPick,
  deriveActionNeeded,
  mapRmCoverage,
  pickPlacementSheetCandidate,
} = require("../../src/services/noQtyExecutionRegisterService");

function assessment(overrides = {}) {
  return {
    requirementSheetId: 10,
    rsBalanceQty: 0,
    suggestedWoQty: 0,
    placementStatus: null,
    readinessStatus: null,
    existingWoSummary: [],
    cycleId: 1,
    requirementSheetDocNo: "RS-26-0010",
    ...overrides,
  };
}

function sheetRow(id, cycleId, docNo = `RS-${id}`) {
  return { sheet: { id, cycleId, docNo, version: 1 }, assessment: assessment({ requirementSheetId: id }) };
}

describe("noQtyPlanningInboxService helpers", () => {
  it("resolveRsStatus prefers latest version on guided cycle", () => {
    const sheets = [
      { id: 1, cycleId: 10, version: 1, status: "LOCKED" },
      { id: 2, cycleId: 10, version: 2, status: "DRAFT" },
      { id: 3, cycleId: 11, version: 1, status: "LOCKED" },
    ];
    assert.equal(resolveRsStatus(sheets, 10), "Draft");
    assert.equal(resolveRsStatus(sheets, 11), "Locked");
    assert.equal(resolveRsStatus([], 10), "No RS");
  });

  it("resolveLockedPeriodKey returns periodKey from locked sheet on cycle", () => {
    const sheets = [
      { id: 1, cycleId: 10, version: 1, status: "DRAFT", periodKey: "2026-05" },
      { id: 2, cycleId: 10, version: 2, status: "LOCKED", periodKey: "2026-06" },
    ];
    assert.equal(resolveLockedPeriodKey(sheets, 10), "2026-06");
  });

  it("buildRequirementSheetHref adds execution focus query params", () => {
    const href = buildRequirementSheetHref(171, {
      sheetId: 261,
      cycleId: 301,
      focusExecution: true,
    });
    assert.match(href, /^\/sales-orders\/171\/requirement-sheets\?/);
    assert.match(href, /source=no_qty_so/);
    assert.match(href, /salesOrderId=171/);
    assert.match(href, /sheetId=261/);
    assert.match(href, /cycleId=301/);
    assert.match(href, /focus=execution/);
  });

  it("sortInboxRows prioritizes execution register actions then RS balance", () => {
    const rows = [
      { salesOrderId: 1, actionNeededKey: "COMPLETE", rsBalanceQty: 0, so: {}, cycleNo: 1 },
      { salesOrderId: 2, actionNeededKey: "PLACE_WO", rsBalanceQty: 100, so: {}, cycleNo: 1 },
      { salesOrderId: 3, actionNeededKey: "PLACE_WO", rsBalanceQty: 500, so: {}, cycleNo: 1 },
      { salesOrderId: 4, actionNeededKey: "ISSUE_RM", rsBalanceQty: 0, so: {}, cycleNo: 1 },
    ];
    const sorted = sortInboxRows(rows);
    assert.deepEqual(
      sorted.map((r) => r.salesOrderId),
      [3, 2, 4, 1],
    );
  });
});

describe("noQtyExecutionRegisterService", () => {
  it("1 — no WO + RM ready → PLACE_WO with suggestedWoQty > 0", () => {
    const action = deriveActionNeeded({
      rsBalanceQty: 10000,
      suggestedWoQty: 2500,
      placementStatus: "READY",
      readinessStatus: "READY_TO_PLACE_WO",
      existingWoSummary: [],
    });
    assert.equal(action.key, ACTION_NEEDED.PLACE_WO.key);
    assert.equal(action.label, "Place WO");

    const coverage = mapRmCoverage({
      placementStatus: "READY",
      readinessStatus: "READY_TO_PLACE_WO",
      rsBalanceQty: 10000,
    });
    assert.equal(coverage.key, "READY");
    assert.equal(coverage.label, "Ready");
  });

  it("2 — first WO exists + balance remains + RM ready → PLACE_WO", () => {
    const action = deriveActionNeeded({
      rsBalanceQty: 7000,
      suggestedWoQty: 2000,
      placementStatus: "READY",
      readinessStatus: "READY_TO_PLACE_WO",
      existingWoSummary: [{ woId: 91, woStatus: "PENDING", rmPendingIssueQty: 0 }],
    });
    assert.equal(action.key, "PLACE_WO");

    const fields = buildExecutionRegisterFieldsFromPick(15, {
      sheet: { id: 6, cycleId: 5, docNo: "RS-26-0006" },
      assessment: assessment({
        requirementSheetId: 6,
        rsBalanceQty: 7000,
        suggestedWoQty: 2000,
        placementStatus: "READY",
        readinessStatus: "READY_TO_PLACE_WO",
        existingWoSummary: [{ woId: 91, woStatus: "PENDING", rmPendingIssueQty: 0 }],
      }),
    });
    assert.equal(fields.actionNeededKey, "PLACE_WO");
    assert.equal(fields.suggestedWoQty, 2000);
    assert.equal(fields.rsBalanceQty, 7000);
    assert.match(fields.executionWorkspaceHref, /sheetId=6/);
    assert.match(fields.executionWorkspaceHref, /focus=execution/);
  });

  it("3 — balance remains + no RM → AWAIT_PROCUREMENT or BLOCKED", () => {
    const awaitAction = deriveActionNeeded({
      rsBalanceQty: 5000,
      suggestedWoQty: 0,
      placementStatus: "AWAITING_PROCUREMENT",
      readinessStatus: "AWAITING_PROCUREMENT",
      existingWoSummary: [],
    });
    assert.equal(awaitAction.key, "AWAIT_PROCUREMENT");

    const blockedAction = deriveActionNeeded({
      rsBalanceQty: 5000,
      suggestedWoQty: 0,
      placementStatus: "MISSING_BOM",
      readinessStatus: "BLOCKED",
      existingWoSummary: [],
    });
    assert.equal(blockedAction.key, "BLOCKED");
  });

  it("4 — balance = 0 + open WO pending RM issue → ISSUE_RM", () => {
    const action = deriveActionNeeded({
      rsBalanceQty: 0,
      suggestedWoQty: 0,
      placementStatus: null,
      readinessStatus: "EXISTING_WO_PENDING_RM_ISSUE",
      existingWoSummary: [{ woId: 91, woStatus: "PENDING", rmPendingIssueQty: 1200 }],
    });
    assert.equal(action.key, "ISSUE_RM");
    assert.equal(action.label, "Issue RM");
  });

  it("5 — balance = 0 + open WOs → MONITOR_WO", () => {
    const action = deriveActionNeeded({
      rsBalanceQty: 0,
      suggestedWoQty: 0,
      placementStatus: null,
      readinessStatus: "READY_TO_PLACE_WO",
      existingWoSummary: [{ woId: 91, woStatus: "PENDING", rmPendingIssueQty: 0 }],
    });
    assert.equal(action.key, "MONITOR_WO");
  });

  it("6 — balance = 0 + all WOs complete → COMPLETE", () => {
    const action = deriveActionNeeded({
      rsBalanceQty: 0,
      suggestedWoQty: 0,
      placementStatus: null,
      readinessStatus: null,
      existingWoSummary: [{ woId: 91, woStatus: "COMPLETED", rmPendingIssueQty: 0 }],
    });
    assert.equal(action.key, "COMPLETE");

    const coverage = mapRmCoverage({ placementStatus: null, readinessStatus: null, rsBalanceQty: 0 });
    assert.equal(coverage.key, "COMPLETE");
  });

  it("7 — prior-cycle locked RS still has balance → picks that RS over latest guided cycle", () => {
    const assessed = [
      {
        sheet: { id: 20, cycleId: 2, docNo: "RS-C2", version: 1 },
        assessment: assessment({
          requirementSheetId: 20,
          cycleId: 2,
          rsBalanceQty: 4000,
          suggestedWoQty: 1000,
          placementStatus: "READY",
          readinessStatus: "READY_TO_PLACE_WO",
        }),
      },
      {
        sheet: { id: 30, cycleId: 3, docNo: "RS-C3", version: 1 },
        assessment: assessment({
          requirementSheetId: 30,
          cycleId: 3,
          rsBalanceQty: 0,
          suggestedWoQty: 0,
          placementStatus: null,
          readinessStatus: null,
        }),
      },
    ];

    const pick = pickPlacementSheetCandidate(assessed, 3);
    assert.equal(pick.sheet.id, 20);
    assert.equal(pick.assessment.rsBalanceQty, 4000);

    const fields = buildExecutionRegisterFieldsFromPick(100, pick);
    assert.equal(fields.placementRequirementSheetId, 20);
    assert.equal(fields.placementRequirementSheetNo, "RS-C2");
    assert.equal(fields.actionNeededKey, "PLACE_WO");
    assert.match(fields.executionWorkspaceHref, /sheetId=20/);
    assert.match(fields.executionWorkspaceHref, /cycleId=2/);
  });
});
