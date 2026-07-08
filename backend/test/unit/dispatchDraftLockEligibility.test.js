const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveRegularDispatchDraftLockEligibility,
  resolveNoQtyDispatchDraftLockEligibility,
  attachDraftLockEligibilityToDispatchRows,
} = require("../../src/services/dispatchDraftLockEligibility");
const { mapSoLinesToDispatchFifoInputs } = require("../../src/services/regularSoBufferQty");

describe("dispatchDraftLockEligibility", () => {
  const lineInputs = mapSoLinesToDispatchFifoInputs(
    [{ id: 1, itemId: 10, qty: 500, customerPoQty: 500, bufferPercent: 0 }],
    "NORMAL",
  );

  it("REGULAR: draft above QC accepted is WAITING_QA (prepare allowed, lock blocked)", () => {
    const result = resolveRegularDispatchDraftLockEligibility({
      orderType: "NORMAL",
      internalStatus: "IN_PROCESS",
      itemId: 10,
      draftQty: 200,
      lineInputs,
      dispatchRecords: [],
      onHandUsable: 1000,
      qcAcceptedGross: 50,
    });
    assert.equal(result.state, "WAITING_QA");
    assert.match(result.reason, /QC-approved/i);
  });

  it("REGULAR: draft within QC but above USABLE is WAITING_STOCK", () => {
    const result = resolveRegularDispatchDraftLockEligibility({
      orderType: "NORMAL",
      internalStatus: "IN_PROCESS",
      itemId: 10,
      draftQty: 80,
      lineInputs,
      dispatchRecords: [],
      onHandUsable: 30,
      qcAcceptedGross: 100,
    });
    assert.equal(result.state, "WAITING_STOCK");
  });

  it("REGULAR: all gates pass → READY", () => {
    const result = resolveRegularDispatchDraftLockEligibility({
      orderType: "NORMAL",
      internalStatus: "IN_PROCESS",
      itemId: 10,
      draftQty: 40,
      lineInputs,
      dispatchRecords: [],
      onHandUsable: 100,
      qcAcceptedGross: 100,
    });
    assert.equal(result.state, "READY");
    assert.equal(result.reason, null);
  });

  it("REGULAR: unapproved SO → WAITING_APPROVAL", () => {
    const result = resolveRegularDispatchDraftLockEligibility({
      orderType: "NORMAL",
      internalStatus: "DRAFT",
      itemId: 10,
      draftQty: 10,
      lineInputs,
      dispatchRecords: [],
      onHandUsable: 100,
      qcAcceptedGross: 100,
    });
    assert.equal(result.state, "WAITING_APPROVAL");
  });

  it("REGULAR: draft exceeding SO line balance → WAITING_APPROVAL", () => {
    const result = resolveRegularDispatchDraftLockEligibility({
      orderType: "NORMAL",
      internalStatus: "IN_PROCESS",
      itemId: 10,
      draftQty: 600,
      lineInputs,
      dispatchRecords: [],
      onHandUsable: 1000,
      qcAcceptedGross: 1000,
    });
    assert.equal(result.state, "WAITING_APPROVAL");
    assert.match(result.reason, /remaining sales order line balance/i);
  });

  it("NO_QTY: draft above single-cycle QC but within cross-cycle pool → READY", () => {
    const draft = {
      id: 99,
      itemId: 10,
      dispatchedQty: 100,
      workflowStatus: "UNLOCKED",
      reversalOfId: null,
      cycleId: 6,
    };
    const result = resolveNoQtyDispatchDraftLockEligibility({
      internalStatus: "IN_PROCESS",
      soId: 1,
      itemId: 10,
      draftQty: 100,
      dispatchRecordsAll: [draft],
      cycleId: 6,
      onHandUsable: 500,
      noQtyQcMaps: {
        cycleQcAcceptedMap: new Map([
          ["1:5:10", 80],
          ["1:6:10", 30],
        ]),
        cycleRecheckAcceptedMap: new Map(),
        postCycleApprovalMap: new Map(),
      },
    });
    assert.equal(result.state, "READY");
    assert.equal(result.reason, null);
  });

  it("NO_QTY: draft above cross-cycle QC pool is blocked", () => {
    const result = resolveNoQtyDispatchDraftLockEligibility({
      internalStatus: "IN_PROCESS",
      soId: 1,
      itemId: 10,
      draftQty: 100,
      dispatchRecordsAll: [],
      cycleId: 5,
      onHandUsable: 500,
      noQtyQcMaps: {
        cycleQcAcceptedMap: new Map([["1:5:10", 80]]),
        cycleRecheckAcceptedMap: new Map(),
        postCycleApprovalMap: new Map(),
      },
    });
    assert.ok(result.state === "WAITING_QA" || result.state === "WAITING_STOCK");
  });

  it("attachDraftLockEligibilityToDispatchRows decorates UNLOCKED forwards only", () => {
    const rows = attachDraftLockEligibilityToDispatchRows(
      [
        { id: 1, itemId: 10, dispatchedQty: 80, workflowStatus: "UNLOCKED", reversalOfId: null },
        { id: 2, itemId: 10, dispatchedQty: 20, workflowStatus: "LOCKED", reversalOfId: null },
      ],
      {
        orderType: "NORMAL",
        internalStatus: "IN_PROCESS",
        soId: 1,
        lineInputs,
        dispatchRecords: [
          { id: 1, itemId: 10, dispatchedQty: 80, workflowStatus: "UNLOCKED", reversalOfId: null },
          { id: 2, itemId: 10, dispatchedQty: 20, workflowStatus: "LOCKED", reversalOfId: null },
        ],
        onHandByItemId: new Map([[10, 1000]]),
        qcAcceptedMap: new Map([["1:10", 100]]),
        replacementQcGrossBySoItem: new Map(),
      },
    );
    assert.equal(rows[0].draftLockEligibility, "READY");
    assert.equal(rows[1].draftLockEligibility, undefined);
  });
});
