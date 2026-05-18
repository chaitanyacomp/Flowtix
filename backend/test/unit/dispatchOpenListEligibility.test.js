const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isDispatchOpenListLineCandidate,
  isSalesOrderCommerciallyClosedForDispatch,
  shouldExcludeSalesOrderFromDispatchOpenList,
  filterLineStatsForDispatchOpenList,
} = require("../../src/services/dispatchOpenListEligibility");

describe("dispatchOpenListEligibility", () => {
  it("NORMAL: excludes fully confirmed line with no draft lock", () => {
    const line = {
      orderQty: 1000,
      dispatched: 1000,
      pendingDispatchQty: 0,
      dispatchPendingLock: 0,
      dispatchable: 0,
    };
    assert.equal(isDispatchOpenListLineCandidate(line, "NORMAL"), false);
  });

  it("NORMAL: keeps fully confirmed line when prepared draft lock remains", () => {
    const line = {
      orderQty: 1000,
      dispatched: 1000,
      pendingDispatchQty: 0,
      dispatchPendingLock: 50,
      dispatchable: 0,
    };
    assert.equal(isDispatchOpenListLineCandidate(line, "NORMAL"), true);
  });

  it("NORMAL: keeps partial pending with dispatchable headroom", () => {
    const line = {
      orderQty: 1000,
      dispatched: 400,
      pendingDispatchQty: 600,
      dispatchPendingLock: 0,
      dispatchable: 200,
    };
    assert.equal(isDispatchOpenListLineCandidate(line, "NORMAL"), true);
  });

  it("NORMAL: excludes blocked backlog with zero dispatchable and no lock", () => {
    const line = {
      orderQty: 1000,
      dispatched: 400,
      pendingDispatchQty: 600,
      dispatchPendingLock: 0,
      dispatchable: 0,
    };
    assert.equal(isDispatchOpenListLineCandidate(line, "NORMAL"), false);
  });

  it("NORMAL: excludes line when confirmed qty meets order even if pending field is stale", () => {
    const line = {
      orderQty: 1000,
      dispatched: 1000,
      pendingDispatchQty: 100,
      dispatchPendingLock: 0,
      dispatchable: 0,
    };
    assert.equal(isDispatchOpenListLineCandidate(line, "NORMAL"), false);
  });

  it("NO_QTY: keeps cycle row with dispatchable headroom", () => {
    const line = { pendingDispatchQty: 0, dispatchPendingLock: 0, dispatchable: 5 };
    assert.equal(isDispatchOpenListLineCandidate(line, "NO_QTY"), true);
  });

  it("commercially closed NORMAL SO is excluded at SO level", () => {
    const so = {
      orderType: "NORMAL",
      internalStatus: "IN_PROCESS",
      lines: [{ id: 1, itemId: 10, qty: 100, customerPoQty: 100 }],
      dispatch: [{ salesOrderLineId: 1, itemId: 10, dispatchedQty: 100, workflowStatus: "LOCKED" }],
    };
    assert.equal(isSalesOrderCommerciallyClosedForDispatch(so, 100), true);
    assert.equal(shouldExcludeSalesOrderFromDispatchOpenList(so, 100), true);
  });

  it("filterLineStatsForDispatchOpenList keeps only actionable NORMAL lines", () => {
    const stats = [
      { orderQty: 100, dispatched: 100, pendingDispatchQty: 0, dispatchPendingLock: 0, dispatchable: 0 },
      { orderQty: 100, dispatched: 40, pendingDispatchQty: 60, dispatchPendingLock: 0, dispatchable: 10 },
    ];
    const out = filterLineStatsForDispatchOpenList(stats, "NORMAL");
    assert.equal(out.length, 1);
    assert.equal(out[0].dispatched, 40);
  });
});
