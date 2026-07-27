const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  allocateNoQtyDispatchFifoAcrossQcLots,
  unwindNoQtyDispatchFifoAllocations,
  netTraceAllocatedQtyByLotKey,
  lotKeyFor,
} = require("../../src/services/noQtyDispatchWoTraceAllocation");
const {
  computeNoQtyFifoPrepareSlicesForItem,
  assertNoQtyDispatchLockQtyAllowed,
  resolveNoQtyFifoLockEligibility,
} = require("../../src/services/noQtyDispatchFifoAllocation");
const { resolveDispatchDraftReservation } = require("../../src/services/dispatchDraftReservationService");
const { computeNoQtyDispatchHeadroom } = require("../../src/services/noQtyDispatchHeadroom");
const { mapSoLinesToDispatchFifoInputs } = require("../../src/services/regularSoBufferQty");

describe("NO_QTY WO/QC FIFO trace allocation (rules 3–4, 7)", () => {
  const lots = [
    { qcEntryId: 11, productionId: 101, workOrderId: 1, acceptedQty: 1000, lotKey: "qc:11" },
    { qcEntryId: 12, productionId: 102, workOrderId: 2, acceptedQty: 800, lotKey: "qc:12" },
    { qcEntryId: 13, productionId: 103, workOrderId: 3, acceptedQty: 500, lotKey: "qc:13" },
  ];

  it("one dispatch consumes accepted FG from multiple WOs by FIFO", () => {
    const { slices, allocatedQty, unallocatedQty } = allocateNoQtyDispatchFifoAcrossQcLots({
      lots,
      requestedQty: 1500,
      itemId: 70,
      cycleId: 5,
    });
    assert.equal(allocatedQty, 1500);
    assert.equal(unallocatedQty, 0);
    assert.equal(slices.length, 2);
    assert.equal(slices[0].workOrderId, 1);
    assert.equal(slices[0].allocatedQty, 1000);
    assert.equal(slices[1].workOrderId, 2);
    assert.equal(slices[1].allocatedQty, 500);
  });

  it("partial dispatch leaves remaining lots available for a later draft", () => {
    const first = allocateNoQtyDispatchFifoAcrossQcLots({
      lots,
      requestedQty: 600,
      itemId: 70,
      cycleId: 5,
    });
    const prior = netTraceAllocatedQtyByLotKey(first.slices);
    const second = allocateNoQtyDispatchFifoAcrossQcLots({
      lots,
      previouslyConsumedByLotKey: prior,
      requestedQty: 900,
      itemId: 70,
      cycleId: 5,
    });
    assert.equal(second.slices[0].workOrderId, 1);
    assert.equal(second.slices[0].allocatedQty, 400);
    assert.equal(second.slices[1].workOrderId, 2);
    assert.equal(second.slices[1].allocatedQty, 500);
  });

  it("reversal restores exact underlying allocations LIFO", () => {
    const forward = allocateNoQtyDispatchFifoAcrossQcLots({
      lots,
      requestedQty: 1500,
      itemId: 70,
      cycleId: 5,
    });
    const unwind = unwindNoQtyDispatchFifoAllocations({
      originalAllocations: forward.slices,
      reverseQty: 500,
      itemId: 70,
      cycleId: 5,
    });
    assert.equal(unwind.restoredQty, 500);
    assert.equal(unwind.slices.length, 1);
    assert.equal(unwind.slices[0].workOrderId, 2);
    assert.equal(unwind.slices[0].allocatedQty, -500);

    const already = netTraceAllocatedQtyByLotKey(unwind.slices);
    // netTrace sums negatives; unwind expects abs already-reversed
    const absAlready = new Map([["qc:12", 500]]);
    const unwind2 = unwindNoQtyDispatchFifoAllocations({
      originalAllocations: forward.slices,
      alreadyReversedByLotKey: absAlready,
      reverseQty: 700,
      itemId: 70,
      cycleId: 5,
    });
    assert.equal(unwind2.slices[0].workOrderId, 1);
    assert.equal(unwind2.slices[0].allocatedQty, -700);
    assert.ok(already.get("qc:12") < 0);
  });

  it("lotKey prefers qc then production then work order", () => {
    assert.equal(lotKeyFor({ qcEntryId: 9, productionId: 1, workOrderId: 2 }), "qc:9");
    assert.equal(lotKeyFor({ productionId: 1, workOrderId: 2 }), "pe:1");
    assert.equal(lotKeyFor({ workOrderId: 2 }), "wo:2");
  });
});

describe("NO_QTY cycle cap + partial + reservation (rules 2, 5, 6, 8)", () => {
  it("headroom is min(demand remaining, QC remaining, stock)", () => {
    assert.equal(
      computeNoQtyDispatchHeadroom({
        alreadyOpNet: 100,
        customerDemandQty: 1000,
        qcAcceptedThisCycle: 500,
        availableFgStock: 200,
      }),
      200,
    );
    assert.equal(
      computeNoQtyDispatchHeadroom({
        alreadyOpNet: 100,
        customerDemandQty: 1000,
        qcAcceptedThisCycle: 500,
        availableFgStock: 800,
      }),
      400,
    );
  });

  it("allows any positive partial up to FIFO totalAvailable", () => {
    const so = { id: 1, dispatch: [] };
    const fifo = computeNoQtyFifoPrepareSlicesForItem({
      so,
      itemId: 10,
      requestedQty: 250,
      cyclesSorted: [{ id: 5, cycleNo: 1 }],
      qcMap: new Map([["1:5:10", 1000]]),
      recheckMap: new Map(),
      postCycleMap: new Map(),
      demandByCycleItem: new Map([["5:10", 1000]]),
      usableStock: 1000,
      unlockedDraftReservedQty: 0,
      replaceableDraftQty: 0,
    });
    assert.equal(fifo.totalAvailable, 1000);
    assert.equal(fifo.slices[0].qty, 250);
    assert.equal(fifo.unallocated, 0);
  });

  it("cycle customer obligation caps excess QC", () => {
    const so = {
      id: 1,
      dispatch: [{ itemId: 10, cycleId: 5, dispatchedQty: 6000, workflowStatus: "LOCKED", reversalOfId: null }],
    };
    const fifo = computeNoQtyFifoPrepareSlicesForItem({
      so,
      itemId: 10,
      requestedQty: 100,
      cyclesSorted: [{ id: 5, cycleNo: 1 }],
      qcMap: new Map([["1:5:10", 6500]]),
      recheckMap: new Map(),
      postCycleMap: new Map(),
      demandByCycleItem: new Map([["5:10", 6000]]),
      usableStock: 500,
      unlockedDraftReservedQty: 0,
      replaceableDraftQty: 0,
    });
    assert.equal(fifo.totalAvailable, 0);
  });

  it("global draft reservation blocks oversubscribe across SOs (concurrency / reservation)", () => {
    const result = resolveDispatchDraftReservation({
      dispatchId: 2,
      itemId: 10,
      requestedQty: 400,
      physicalUsableQty: 1000,
      dispatchRows: [
        { id: 1, itemId: 10, dispatchedQty: 700, workflowStatus: "UNLOCKED", reversalOfId: null },
        { id: 2, itemId: 10, dispatchedQty: 200, workflowStatus: "UNLOCKED", reversalOfId: null },
      ],
    });
    assert.equal(result.otherReservedQty, 700);
    assert.equal(result.availableToThisDraftQty, 300);
    assert.equal(result.allowed, false);
  });

  it("lock assert accepts global unlockedDraftReservedQty override", () => {
    const so = {
      id: 1,
      dispatch: [{ id: 9, itemId: 10, cycleId: 5, dispatchedQty: 200, workflowStatus: "UNLOCKED", reversalOfId: null }],
    };
    assert.throws(
      () =>
        assertNoQtyDispatchLockQtyAllowed(
          {
            so,
            itemId: 10,
            qty: 300,
            cycleId: 5,
            cyclesSorted: [{ id: 5, cycleNo: 1 }],
            qcMap: new Map([["1:5:10", 1000]]),
            recheckMap: new Map(),
            postCycleMap: new Map(),
            demandByCycleItem: new Map([["5:10", 1000]]),
            usableStock: 400,
            // Other drafts reserve 500; replaceable 200 → free physical 100 < 300.
            unlockedDraftReservedQty: 500,
            replaceableDraftQty: 200,
          },
          (message) => new Error(message),
        ),
      /usable stock|dispatchable/i,
    );
  });

  it("eligibility respects demandByCycleItem (finalized cycle entitlement)", () => {
    const so = {
      id: 1,
      dispatch: [{ id: 9, itemId: 10, cycleId: 5, dispatchedQty: 6000, workflowStatus: "LOCKED", reversalOfId: null }],
    };
    const elig = resolveNoQtyFifoLockEligibility({
      so,
      soId: 1,
      itemId: 10,
      draftQty: 100,
      cycleId: 5,
      cyclesSorted: [{ id: 5, cycleNo: 1 }],
      onHandUsable: 500,
      noQtyQcMaps: {
        cycleQcAcceptedMap: new Map([["1:5:10", 6500]]),
        cycleRecheckAcceptedMap: new Map(),
        postCycleApprovalMap: new Map(),
      },
      demandByCycleItem: new Map([["5:10", 6000]]),
    });
    assert.notEqual(elig.state, "READY");
    assert.match(String(elig.reason || elig.state), /stock|dispatchable|QC|quantity/i);
  });
});

describe("NO_QTY vs REGULAR_SO isolation (rule 9)", () => {
  it("REGULAR buffer mapping is unused by NO_QTY FIFO helpers", () => {
    const regularLines = mapSoLinesToDispatchFifoInputs(
      [{ id: 1, itemId: 10, qty: 100, customerPoQty: 100 }],
      "NORMAL",
    );
    assert.ok(Array.isArray(regularLines));
    assert.ok(regularLines.length >= 1);
    assert.ok(regularLines[0].lineId === 1 || regularLines[0].id === 1 || regularLines[0].itemId === 10);

    const noQtyFifo = computeNoQtyFifoPrepareSlicesForItem({
      so: { id: 99, dispatch: [] },
      itemId: 10,
      requestedQty: 50,
      cyclesSorted: [{ id: 7, cycleNo: 1 }],
      qcMap: new Map([["99:7:10", 50]]),
      recheckMap: new Map(),
      postCycleMap: new Map(),
      demandByCycleItem: new Map([["7:10", 50]]),
      usableStock: 50,
      unlockedDraftReservedQty: 0,
      replaceableDraftQty: 0,
    });
    assert.equal(noQtyFifo.slices[0].cycleId, 7);
    assert.equal(noQtyFifo.slices[0].qty, 50);
    // REGULAR line inputs never appear in NO_QTY cycle slices.
    assert.equal(noQtyFifo.slices[0].lineId, undefined);
  });
});
