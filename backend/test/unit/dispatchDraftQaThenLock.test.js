/**
 * Batch 2D — REGULAR draft prepared before QA; becomes lock-eligible after QC without recreating draft.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveRegularDispatchDraftLockEligibility,
} = require("../../src/services/dispatchDraftLockEligibility");
const { mapSoLinesToDispatchFifoInputs } = require("../../src/services/regularSoBufferQty");

describe("dispatchDraftQaThenLock", () => {
  const lineInputs = mapSoLinesToDispatchFifoInputs(
    [{ id: 1, itemId: 10, qty: 500, customerPoQty: 500, bufferPercent: 0 }],
    "NORMAL",
  );

  it("draft while QA pending is WAITING_QA, then READY after QC accepts sufficient qty", () => {
    const draftQty = 80;
    const dispatchRecords = [
      { id: 1, itemId: 10, dispatchedQty: draftQty, workflowStatus: "UNLOCKED", reversalOfId: null },
    ];

    const beforeQa = resolveRegularDispatchDraftLockEligibility({
      orderType: "NORMAL",
      internalStatus: "IN_PROCESS",
      itemId: 10,
      draftQty,
      lineInputs,
      dispatchRecords: [],
      onHandUsable: 200,
      qcAcceptedGross: 0,
    });
    assert.equal(beforeQa.state, "WAITING_QA");

    const afterQa = resolveRegularDispatchDraftLockEligibility({
      orderType: "NORMAL",
      internalStatus: "IN_PROCESS",
      itemId: 10,
      draftQty,
      lineInputs,
      dispatchRecords: [],
      onHandUsable: 200,
      qcAcceptedGross: 100,
    });
    assert.equal(afterQa.state, "READY");
    assert.equal(afterQa.reason, null);
  });

  it("operational net from other drafts reduces QC headroom for lock eligibility", () => {
    const otherDraft = {
      id: 2,
      itemId: 10,
      dispatchedQty: 60,
      workflowStatus: "UNLOCKED",
      reversalOfId: null,
    };
    const result = resolveRegularDispatchDraftLockEligibility({
      orderType: "NORMAL",
      internalStatus: "IN_PROCESS",
      itemId: 10,
      draftQty: 50,
      lineInputs,
      dispatchRecords: [otherDraft],
      onHandUsable: 500,
      qcAcceptedGross: 100,
    });
    assert.equal(result.state, "WAITING_QA");
  });
});
