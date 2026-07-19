const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isDispatchOpenListLineCandidate,
  isDispatchBacklogActionableLine,
  filterDispatchBacklogActionableRows,
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

  it("NO_QTY: keeps cycle row with dispatchable headroom even when pendingDispatchQty is zero", () => {
    const line = { pendingDispatchQty: 0, dispatchPendingLock: 0, dispatchable: 5 };
    assert.equal(isDispatchOpenListLineCandidate(line, "NO_QTY"), true);
  });

  it("NO_QTY: partial QA acceptance uses dispatchable qty for backlog eligibility", () => {
    const partial = { pendingDispatchQty: 0, dispatchPendingLock: 0, dispatchable: 40, dispatchableQty: 40 };
    const none = { pendingDispatchQty: 0, dispatchPendingLock: 0, dispatchable: 0, dispatchableQty: 0 };
    assert.equal(isDispatchOpenListLineCandidate(partial, "NO_QTY"), true);
    assert.equal(isDispatchOpenListLineCandidate(none, "NO_QTY"), false);
  });

  it("NO_QTY: accumulated batches increase dispatchable headroom", () => {
    const batchOne = { pendingDispatchQty: 0, dispatchPendingLock: 0, dispatchable: 50 };
    const batchTwo = { pendingDispatchQty: 0, dispatchPendingLock: 0, dispatchable: 120 };
    assert.equal(isDispatchOpenListLineCandidate(batchOne, "NO_QTY"), true);
    assert.equal(isDispatchOpenListLineCandidate(batchTwo, "NO_QTY"), true);
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

  it("backlog KPI: three blocked lines with dispatchableQty=0 → backlog 0 (open-list may still show them for NO_QTY)", () => {
    const blocked = [
      { orderType: "NORMAL", pendingQty: 100, dispatchableNow: 0, itemName: "Square Box" },
      { orderType: "NORMAL", pendingQty: 50, dispatchableNow: 0, itemName: "Round Plate" },
      { orderType: "NORMAL", pendingQty: 25, dispatchableNow: 0, itemName: "PVC Angle" },
    ];
    for (const row of blocked) {
      assert.equal(isDispatchOpenListLineCandidate({
        pendingDispatchQty: row.pendingQty,
        dispatchable: row.dispatchableNow,
        orderQty: row.pendingQty,
        dispatched: 0,
        dispatchPendingLock: 0,
      }, "NORMAL"), false);
      assert.equal(isDispatchBacklogActionableLine(row, row.orderType), false);
    }
    assert.equal(filterDispatchBacklogActionableRows(blocked).length, 0);

    const noQtyBlocked = blocked.map((r) => ({ ...r, orderType: "NO_QTY" }));
    for (const row of noQtyBlocked) {
      assert.equal(
        isDispatchOpenListLineCandidate(
          { pendingDispatchQty: row.pendingQty, dispatchable: 0, dispatchPendingLock: 0 },
          "NO_QTY",
        ),
        true,
        "workspace open list may show Cannot prepare now",
      );
      assert.equal(isDispatchBacklogActionableLine(row, "NO_QTY"), false);
    }
    assert.equal(filterDispatchBacklogActionableRows(noQtyBlocked).length, 0);
  });

  it("backlog KPI: one line with positive QC/stock headroom → ready/backlog 1", () => {
    const rows = [
      { orderType: "NORMAL", pendingQty: 100, dispatchableNow: 0 },
      { orderType: "NORMAL", pendingQty: 80, dispatchableNow: 40 },
      { orderType: "NORMAL", pendingQty: 0, dispatchableNow: 0, orderedQty: 50, dispatchedQty: 50 },
    ];
    const out = filterDispatchBacklogActionableRows(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].dispatchableNow, 40);
    assert.equal(isDispatchBacklogActionableLine(out[0], "NORMAL"), true);
  });

  it("backlog KPI: historical/zero/fully-dispatched rows never increase backlog", () => {
    const rows = [
      { orderType: "NORMAL", pendingQty: 0, dispatchableNow: 0, orderedQty: 100, dispatchedQty: 100 },
      { orderType: "NORMAL", pendingQty: -1, dispatchableNow: 0 },
      { orderType: "NORMAL", pendingQty: 0, dispatchableNow: 5, orderedQty: 100, dispatchedQty: 100 },
      { orderType: "NO_QTY", pendingQty: 0, dispatchableNow: 0 },
    ];
    assert.equal(filterDispatchBacklogActionableRows(rows).length, 0);
  });

  it("backlog KPI matches Control Tower: only dispatchableNow > 0 counts", () => {
    const rows = [
      { orderType: "NO_QTY", pendingQty: 0, dispatchableNow: 12 },
      { orderType: "NORMAL", pendingQty: 30, dispatchableNow: 0 },
      { orderType: "NORMAL", pendingQty: 10, dispatchableNow: 10 },
    ];
    const out = filterDispatchBacklogActionableRows(rows);
    assert.equal(out.length, 2);
    assert.deepEqual(
      out.map((r) => r.dispatchableNow),
      [12, 10],
    );
  });
});
