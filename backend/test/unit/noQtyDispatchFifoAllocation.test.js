const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertNoQtyDispatchLockQtyAllowed,
  computeNoQtyFifoPrepareSlicesForItem,
} = require("../../src/services/noQtyDispatchFifoAllocation");

describe("noQtyDispatchFifoAllocation", () => {
  const cyclesSorted = [
    { id: 5, cycleNo: 1 },
    { id: 6, cycleNo: 2 },
  ];
  const qcMap = new Map([
    ["1:5:10", 3000],
    ["1:6:10", 500],
  ]);
  const recheckMap = new Map();
  const postCycleMap = new Map();

  it("assertNoQtyDispatchLockQtyAllowed passes when qty fits cross-cycle FIFO (not current cycle alone)", () => {
    const so = {
      id: 1,
      dispatch: [
        {
          id: 99,
          itemId: 10,
          dispatchedQty: "3495",
          workflowStatus: "UNLOCKED",
          reversalOfId: null,
          cycleId: 6,
        },
      ],
    };
    assert.doesNotThrow(() =>
      assertNoQtyDispatchLockQtyAllowed(
        {
          so,
          itemId: 10,
          qty: 3495,
          cycleId: 6,
          cyclesSorted,
          qcMap,
          recheckMap,
          postCycleMap,
          usableStock: 6484,
        },
        (message, statusCode) => {
          const err = new Error(message);
          err.statusCode = statusCode;
          return err;
        },
      ),
    );
  });

  it("assertNoQtyDispatchLockQtyAllowed rejects when qty exceeds FIFO total", () => {
    const so = { id: 1, dispatch: [] };
    assert.throws(
      () =>
        assertNoQtyDispatchLockQtyAllowed(
          {
            so,
            itemId: 10,
            qty: 4000,
            cycleId: 6,
            cyclesSorted,
            qcMap,
            recheckMap,
            postCycleMap,
            usableStock: 6484,
          },
          (message) => new Error(message),
        ),
      /usable stock|dispatchable quantity/i,
    );
  });

  it("computeNoQtyFifoPrepareSlicesForItem allocates oldest cycle first", () => {
    const so = { id: 1, dispatch: [] };
    const fifo = computeNoQtyFifoPrepareSlicesForItem({
      so,
      itemId: 10,
      requestedQty: 3200,
      cyclesSorted,
      qcMap,
      recheckMap,
      postCycleMap,
      usableStock: 5000,
      unlockedDraftReservedQty: 0,
      replaceableDraftQty: 0,
    });
    assert.equal(fifo.slices.length, 2);
    assert.equal(fifo.slices[0].cycleId, 5);
    assert.equal(fifo.slices[0].qty, 3000);
    assert.equal(fifo.slices[1].cycleId, 6);
    assert.equal(fifo.slices[1].qty, 200);
    assert.equal(fifo.unallocated, 0);
  });

  it("does not allocate QC-accepted excess after the cycle customer obligation is dispatched", () => {
    const so = { id: 1, dispatch: [{ itemId: 10, cycleId: 5, dispatchedQty: 6000, workflowStatus: "LOCKED", reversalOfId: null }] };
    const fifo = computeNoQtyFifoPrepareSlicesForItem({
      so,
      itemId: 10,
      requestedQty: 500,
      cyclesSorted: [{ id: 5, cycleNo: 1 }],
      qcMap: new Map([["1:5:10", 6500]]),
      recheckMap,
      postCycleMap,
      demandByCycleItem: new Map([["5:10", 6000]]),
      usableStock: 500,
      unlockedDraftReservedQty: 0,
      replaceableDraftQty: 0,
    });
    assert.equal(fifo.totalAvailable, 0);
    assert.equal(fifo.slices.length, 0);
    assert.equal(fifo.unallocated, 500);
  });
});
