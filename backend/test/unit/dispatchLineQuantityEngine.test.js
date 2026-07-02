const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  enrichDispatchLineQuantities,
  enrichSalesOrderDispatchQuantities,
  resolveDispatchLineStatus,
} = require("../../src/services/dispatchLineQuantityEngine.js");

describe("dispatchLineQuantityEngine", () => {
  it("fully drafted line shows remaining 0 and DRAFT_CREATED", () => {
    const row = enrichDispatchLineQuantities({
      lineId: 1,
      itemId: 10,
      dispatchable: 0,
      dispatchPendingLock: 1855,
      dispatched: 0,
    });
    assert.equal(row.originalReadyQty, 1855);
    assert.equal(row.remainingDispatchableQty, 0);
    assert.equal(row.dispatchDraftQty, 1855);
    assert.equal(row.finalizedDispatchQty, 0);
    assert.equal(row.dispatchStatus, "DRAFT_CREATED");
    assert.equal(row.dispatchStatusLabel, "Draft Saved");
  });

  it("partial draft shows remaining 1711 and PARTIALLY_DRAFTED", () => {
    const row = enrichDispatchLineQuantities({
      lineId: 2,
      itemId: 11,
      dispatchable: 1711,
      dispatchPendingLock: 144,
      dispatched: 0,
    });
    assert.equal(row.originalReadyQty, 1855);
    assert.equal(row.remainingDispatchableQty, 1711);
    assert.equal(row.dispatchDraftQty, 144);
    assert.equal(row.dispatchStatus, "PARTIALLY_DRAFTED");
    assert.equal(row.dispatchStatusLabel, "Partial Draft");
  });

  it("ready line with no draft", () => {
    const row = enrichDispatchLineQuantities({
      dispatchable: 1855,
      dispatchPendingLock: 0,
      dispatched: 0,
    });
    assert.equal(row.dispatchStatus, "READY");
    assert.equal(row.remainingDispatchableQty, 1855);
  });

  it("sums SO total remaining dispatchable", () => {
    const so = enrichSalesOrderDispatchQuantities({
      id: 26,
      lineStats: [
        { dispatchable: 0, dispatchPendingLock: 1855, dispatched: 0 },
        { dispatchable: 1711, dispatchPendingLock: 144, dispatched: 0 },
      ],
    });
    assert.equal(so.totalRemainingDispatchableQty, 1711);
  });

  it("resolveDispatchLineStatus dispatched when finalized only", () => {
    assert.equal(resolveDispatchLineStatus(0, 0, 100), "DISPATCHED");
  });
});
