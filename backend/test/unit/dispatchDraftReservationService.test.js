const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveDispatchDraftReservation,
} = require("../../src/services/dispatchDraftReservationService");

const ITEM_ID = 7;
const ownDraft = {
  id: 101,
  itemId: ITEM_ID,
  dispatchedQty: 1500,
  workflowStatus: "UNLOCKED",
  reversalOfId: null,
};

function snapshot(requestedQty, rows = [ownDraft], physicalUsableQty = 1515) {
  return resolveDispatchDraftReservation({
    dispatchId: ownDraft.id,
    itemId: ITEM_ID,
    requestedQty,
    physicalUsableQty,
    dispatchRows: rows,
  });
}

describe("dispatch draft reservation ownership", () => {
  it("reproduces DT-26-0001: 1515 usable, own 1500 reservation, 15 unreserved", () => {
    const result = snapshot(1500);
    assert.deepEqual(result, {
      ownReservedQty: 1500,
      otherReservedQty: 0,
      unreservedQty: 15,
      availableToThisDraftQty: 1515,
      requestedQty: 1500,
      incrementalQtyRequired: 0,
      releasedQty: 0,
      allowed: true,
    });
  });

  it("reopen and finalize uses the draft's own reservation", () => {
    assert.equal(snapshot(1500).allowed, true);
    assert.equal(snapshot(1500).availableToThisDraftQty, 1515);
  });

  it("another draft cannot consume this draft's reservation", () => {
    const other = { ...ownDraft, id: 202, dispatchedQty: 15 };
    const result = resolveDispatchDraftReservation({
      dispatchId: other.id,
      itemId: ITEM_ID,
      requestedQty: 16,
      physicalUsableQty: 1515,
      dispatchRows: [ownDraft, other],
    });
    assert.equal(result.ownReservedQty, 15);
    assert.equal(result.otherReservedQty, 1500);
    assert.equal(result.availableToThisDraftQty, 15);
    assert.equal(result.allowed, false);
  });

  it("quantity increase requires only incremental unreserved stock", () => {
    const result = snapshot(1510);
    assert.equal(result.incrementalQtyRequired, 10);
    assert.equal(result.allowed, true);
    assert.equal(snapshot(1516).allowed, false);
  });

  it("quantity reduction releases excess reservation", () => {
    const result = snapshot(1200);
    assert.equal(result.releasedQty, 300);
    assert.equal(result.allowed, true);
  });

  it("cancellation releases the full reservation", () => {
    const result = snapshot(0);
    assert.equal(result.releasedQty, 1500);
  });

  it("a locked/finalized row is no longer an active reservation", () => {
    const result = snapshot(1500, [{ ...ownDraft, workflowStatus: "LOCKED" }]);
    assert.equal(result.ownReservedQty, 0);
    assert.equal(result.incrementalQtyRequired, 1500);
  });

  it("concurrent competing drafts cannot both reserve beyond physical stock", () => {
    const first = { ...ownDraft, dispatchedQty: 1500 };
    const secondAttempt = resolveDispatchDraftReservation({
      dispatchId: 202,
      itemId: ITEM_ID,
      requestedQty: 20,
      physicalUsableQty: 1515,
      dispatchRows: [first],
    });
    assert.equal(secondAttempt.availableToThisDraftQty, 15);
    assert.equal(secondAttempt.allowed, false);
  });

  it("genuine physical shortage remains blocked", () => {
    assert.equal(snapshot(1500, [ownDraft], 1499).allowed, false);
  });
});
