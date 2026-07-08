/**
 * P16-13D — FG inventory dispatch: FIFO allocation + traceability (no DB).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeNoQtyFifoPrepareSlicesForItem, assertNoQtyDispatchLockQtyAllowed } = require("../../src/services/noQtyDispatchFifoAllocation");
const { allocateDispatchFifoAcrossWorkOrderLines } = require("../../src/services/reportMetrics");

describe("dispatchFgFifoAllocation", () => {
  const SO_ID = 1;
  const ITEM_ID = 501;

  function qcKey(cycleId) {
    return `${SO_ID}:${cycleId}:${ITEM_ID}`;
  }

  function baseSo(dispatchRows = []) {
    return { id: SO_ID, dispatch: dispatchRows };
  }

  it("allocates FIFO across oldest QC cycle first, then next cycle for same FG item", () => {
    const cyclesSorted = [
      { id: 10, cycleNo: 1 },
      { id: 20, cycleNo: 2 },
    ];
    const qcMap = new Map([
      [qcKey(10), 1000],
      [qcKey(20), 2000],
    ]);
    const fifo = computeNoQtyFifoPrepareSlicesForItem({
      so: baseSo(),
      itemId: ITEM_ID,
      requestedQty: 3000,
      cyclesSorted,
      qcMap,
      recheckMap: new Map(),
      postCycleMap: new Map(),
      usableStock: 5000,
      unlockedDraftReservedQty: 0,
      replaceableDraftQty: 0,
    });
    assert.equal(fifo.unallocated, 0);
    assert.deepEqual(fifo.slices, [
      { cycleId: 10, cycleNo: 1, qty: 1000 },
      { cycleId: 20, cycleNo: 2, qty: 2000 },
    ]);
    assert.equal(fifo.slices.reduce((s, x) => s + x.qty, 0), 3000);
  });

  it("respects prior locked dispatch in older cycle before taking from next batch", () => {
    const cyclesSorted = [{ id: 10, cycleNo: 1 }, { id: 20, cycleNo: 2 }];
    const qcMap = new Map([
      [qcKey(10), 1000],
      [qcKey(20), 1500],
    ]);
    const so = baseSo([
      {
        itemId: ITEM_ID,
        cycleId: 10,
        dispatchedQty: 700,
        reversalOfId: null,
        workflowStatus: "LOCKED",
      },
    ]);
    const fifo = computeNoQtyFifoPrepareSlicesForItem({
      so,
      itemId: ITEM_ID,
      requestedQty: 1000,
      cyclesSorted,
      qcMap,
      recheckMap: new Map(),
      postCycleMap: new Map(),
      usableStock: 2000,
      unlockedDraftReservedQty: 0,
      replaceableDraftQty: 0,
    });
    assert.deepEqual(fifo.slices, [
      { cycleId: 10, cycleNo: 1, qty: 300 },
      { cycleId: 20, cycleNo: 2, qty: 700 },
    ]);
  });

  it("caps allocation by physical usable stock even when QC headroom is higher", () => {
    const cyclesSorted = [{ id: 10, cycleNo: 1 }];
    const qcMap = new Map([[qcKey(10), 5000]]);
    const fifo = computeNoQtyFifoPrepareSlicesForItem({
      so: baseSo(),
      itemId: ITEM_ID,
      requestedQty: 4000,
      cyclesSorted,
      qcMap,
      recheckMap: new Map(),
      postCycleMap: new Map(),
      usableStock: 2500,
      unlockedDraftReservedQty: 0,
      replaceableDraftQty: 0,
    });
    assert.equal(fifo.totalAvailable, 2500);
    assert.equal(fifo.unallocated, 1500);
    assert.deepEqual(fifo.slices, [{ cycleId: 10, cycleNo: 1, qty: 2500 }]);
  });

  it("slice cycleId preserves traceability path to QC/production/WO batches", () => {
    const cyclesSorted = [
      { id: 101, cycleNo: 1 },
      { id: 102, cycleNo: 2 },
    ];
    const qcMap = new Map([
      [qcKey(101), 800],
      [qcKey(102), 600],
    ]);
    const fifo = computeNoQtyFifoPrepareSlicesForItem({
      so: baseSo(),
      itemId: ITEM_ID,
      requestedQty: 1200,
      cyclesSorted,
      qcMap,
      recheckMap: new Map(),
      postCycleMap: new Map(),
      usableStock: 2000,
      unlockedDraftReservedQty: 0,
      replaceableDraftQty: 0,
    });
    assert.equal(fifo.slices.length, 2);
    assert.equal(fifo.slices[0].cycleId, 101);
    assert.equal(fifo.slices[1].cycleId, 102);
    const woLines = [
      { lineId: 1, acceptedQty: 800 },
      { lineId: 2, acceptedQty: 600 },
    ];
    const woAlloc = allocateDispatchFifoAcrossWorkOrderLines(woLines, 1200);
    assert.equal(woAlloc.get(1), 800);
    assert.equal(woAlloc.get(2), 400);
  });

  it("allows updating open draft to same qty without double-reserving cycle headroom", () => {
    const cyclesSorted = [{ id: 10, cycleNo: 1 }];
    const qcMap = new Map([[qcKey(10), 2445]]);
    const so = baseSo([
      {
        id: 99,
        itemId: ITEM_ID,
        cycleId: 10,
        dispatchedQty: 2445,
        reversalOfId: null,
        workflowStatus: "UNLOCKED",
      },
    ]);
    const fifo = computeNoQtyFifoPrepareSlicesForItem({
      so,
      itemId: ITEM_ID,
      requestedQty: 2445,
      cyclesSorted,
      qcMap,
      recheckMap: new Map(),
      postCycleMap: new Map(),
      usableStock: 2445,
      unlockedDraftReservedQty: 2445,
      replaceableDraftQty: 2445,
    });
    assert.equal(fifo.unallocated, 0);
    assert.deepEqual(fifo.slices, [{ cycleId: 10, cycleNo: 1, qty: 2445 }]);
  });
});
