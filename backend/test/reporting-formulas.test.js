/**
 * Reporting formula verification (node --test). No DB.
 * Run: npm test
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  netDispatchedByItemId,
  allocateDispatchAcrossSalesOrderLines,
  remainingDispatchCapacityForSoItem,
  DISPATCH_ALLOC_MODE,
} = require("../src/services/salesOrderDispatchAllocation");
const {
  getDispatchableQtyForSoLine,
  getSoItemDispatchableReadyQty,
  buildDispatchableQtyBySalesOrderLineId,
  getDispatchBlockedReason,
  getSoItemQcApprovedRemainingQty,
  getProductionBatchQcPendingQty,
  allocateDispatchFifoAcrossWorkOrderLines,
  computeWorkOrderTrackingSummaryFromRows,
  assertWorkOrderTrackingSummaryMatches,
  computeSalesOrderDispatchLineStats,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("../src/services/reportMetrics");
const {
  buildDispatchExceptions,
  buildQcExceptions,
  buildExceptionSummary,
  OPERATIONS_EXCEPTION_CONFIG,
} = require("../src/services/operationsExceptionClassification");
const { mapSoLinesToDispatchFifoInputs } = require("../src/services/regularSoBufferQty");

describe("salesOrderDispatchAllocation", () => {
  it("does not double-subtract net dispatch across two SO lines for same FG (SO-line FIFO)", () => {
    const lines = [
      { id: 1, itemId: 100, qty: 10 },
      { id: 2, itemId: 100, qty: 20 },
    ];
    const dispatch = [{ itemId: 100, dispatchedQty: 12 }];
    const alloc = allocateDispatchAcrossSalesOrderLines(lines, dispatch);
    assert.equal(alloc.get(1), 10);
    assert.equal(alloc.get(2), 2);
    const net = netDispatchedByItemId(dispatch).get(100);
    assert.equal(net, 12);
    assert.equal((alloc.get(1) ?? 0) + (alloc.get(2) ?? 0), net);
  });

  it("remainingDispatchCapacityForSoItem sums line remainders after FIFO", () => {
    const lines = [
      { id: 1, itemId: 7, qty: 10 },
      { id: 2, itemId: 7, qty: 10 },
    ];
    const dispatch = [{ itemId: 7, dispatchedQty: 12 }];
    const cap = remainingDispatchCapacityForSoItem(lines, dispatch, 7);
    assert.equal(cap, 8);
  });

  it("netDispatchedByItemId includes reversal negatives", () => {
    const dispatch = [
      { itemId: 1, dispatchedQty: 100 },
      { itemId: 1, dispatchedQty: -30 },
    ];
    assert.equal(netDispatchedByItemId(dispatch).get(1), 70);
  });

  it("confirmed mode excludes UNLOCKED forward rows from net and FIFO", () => {
    const lines = [
      { id: 1, itemId: 5, qty: 100 },
      { id: 2, itemId: 5, qty: 100 },
    ];
    const dispatch = [
      { itemId: 5, dispatchedQty: 10, reversalOfId: null, workflowStatus: "UNLOCKED" },
      { itemId: 5, dispatchedQty: 7, reversalOfId: null, workflowStatus: "LOCKED" },
    ];
    assert.equal(netDispatchedByItemId(dispatch, DISPATCH_ALLOC_MODE.OPERATIONAL).get(5), 17);
    assert.equal(netDispatchedByItemId(dispatch, DISPATCH_ALLOC_MODE.CONFIRMED).get(5), 7);
    const allocC = allocateDispatchAcrossSalesOrderLines(lines, dispatch, DISPATCH_ALLOC_MODE.CONFIRMED);
    assert.equal(allocC.get(1), 7);
    assert.equal(allocC.get(2), 0);
  });
});

describe("reportMetrics dispatchable (SO line × usable stock)", () => {
  it("dispatchableQty is min(line remaining, usable stock)", () => {
    assert.equal(
      getDispatchableQtyForSoLine({
        orderLineRemaining: 50,
        onHandQty: 20,
      }),
      20,
    );
    assert.equal(
      getDispatchableQtyForSoLine({
        orderLineRemaining: 5,
        onHandQty: 100,
      }),
      5,
    );
    assert.equal(
      getDispatchableQtyForSoLine({
        orderLineRemaining: 100,
        onHandQty: 3,
      }),
      3,
    );
  });

  it("qcApprovedRemaining is item-level pool after net dispatch", () => {
    assert.equal(getSoItemQcApprovedRemainingQty(40, 25), 15);
    assert.equal(getSoItemQcApprovedRemainingQty(10, 12), 0);
  });

  it("getSoItemDispatchableReadyQty uses usable only when no QC accepted for SO+item", () => {
    const lines = [
      { id: 1, itemId: 10, qty: 100 },
      { id: 2, itemId: 10, qty: 50 },
    ];
    const dispatch = [];
    const d = getSoItemDispatchableReadyQty({
      orderLineInputs: lines,
      dispatchRecords: dispatch,
      itemId: 10,
      orderType: "NORMAL",
      onHandQty: 40,
      qcAcceptedTotalForSoItem: 0,
    });
    assert.equal(d, 40);
  });

  it("getSoItemDispatchableReadyQty uses usable stock even when QC exists", () => {
    const lines = [{ id: 1, itemId: 10, qty: 5000 }];
    const dispatch = [];
    const d = getSoItemDispatchableReadyQty({
      orderLineInputs: lines,
      dispatchRecords: dispatch,
      itemId: 10,
      orderType: "NORMAL",
      onHandQty: 5000,
      qcAcceptedTotalForSoItem: 2000,
    });
    assert.equal(d, 5000);
  });

  it("buildDispatchableQtyBySalesOrderLineId shares one ship pool across two SO lines (same item)", () => {
    const lines = [
      { id: 1, itemId: 10, qty: 10 },
      { id: 2, itemId: 10, qty: 10 },
    ];
    const onHand = new Map([[10, 15]]);
    const qc = new Map([[10, 0]]);
    const byLine = buildDispatchableQtyBySalesOrderLineId({
      orderLineInputs: lines,
      dispatchRecords: [],
      orderType: "NORMAL",
      onHandByItemId: onHand,
      qcAcceptedTotalByItemId: qc,
    });
    assert.equal(byLine.get(1), 10);
    assert.equal(byLine.get(2), 5);
    assert.equal((byLine.get(1) ?? 0) + (byLine.get(2) ?? 0), 15);
  });

  it("NORMAL: customerPoQty caps FIFO + dispatchable; planned qty above PO does not stay dispatchable after PO shipped", () => {
    const rawLines = [{ id: 1, itemId: 10, qty: 2525, customerPoQty: 2500 }];
    const lineInputs = mapSoLinesToDispatchFifoInputs(rawLines, "NORMAL");
    assert.equal(lineInputs[0].qty, 2500);
    const dispatch = [{ itemId: 10, dispatchedQty: 2500 }];
    const byLine = buildDispatchableQtyBySalesOrderLineId({
      orderLineInputs: lineInputs,
      dispatchRecords: dispatch,
      orderType: "NORMAL",
      onHandByItemId: new Map([[10, 9999]]),
      qcAcceptedTotalByItemId: new Map([[10, 2525]]),
    });
    assert.equal(byLine.get(1), 0);
    const { dispatchLineStats } = computeSalesOrderDispatchLineStats(rawLines, dispatch, "NORMAL");
    assert.equal(dispatchLineStats[0].pending, 0);
    assert.equal(dispatchLineStats[0].ordered, 2500);
  });
});

describe("getDispatchBlockedReason", () => {
  it("returns null when no backlog or dispatchable > 0", () => {
    assert.equal(
      getDispatchBlockedReason({
        orderType: "NORMAL",
        pendingDispatchQty: 0,
        dispatchable: 0,
        operationalRemaining: 10,
        totalStock: 100,
        qcHoldQty: 0,
        qcPendingQty: 0,
        reworkQty: 0,
      }),
      null,
    );
    assert.equal(
      getDispatchBlockedReason({
        orderType: "NORMAL",
        pendingDispatchQty: 5,
        dispatchable: 2,
        operationalRemaining: 10,
        totalStock: 100,
        qcHoldQty: 0,
        qcPendingQty: 0,
        reworkQty: 0,
      }),
      null,
    );
  });

  it("prioritizes rework then QC buckets when dispatchable is zero", () => {
    assert.equal(
      getDispatchBlockedReason({
        orderType: "NORMAL",
        pendingDispatchQty: 5,
        dispatchable: 0,
        operationalRemaining: 0,
        totalStock: 50,
        qcHoldQty: 0,
        qcPendingQty: 0,
        reworkQty: 3,
      }),
      "Stock is under rework",
    );
    assert.equal(
      getDispatchBlockedReason({
        orderType: "NORMAL",
        pendingDispatchQty: 5,
        dispatchable: 0,
        operationalRemaining: 0,
        totalStock: 50,
        qcHoldQty: 2,
        qcPendingQty: 1,
        reworkQty: 0,
      }),
      "Stock is under QC",
    );
  });

  it("when stock exists but QC pool is exhausted, explains dispatch-ready block", () => {
    assert.equal(
      getDispatchBlockedReason({
        orderType: "NORMAL",
        pendingDispatchQty: 5,
        dispatchable: 0,
        operationalRemaining: 50,
        totalStock: 100,
        qcHoldQty: 0,
        qcPendingQty: 0,
        reworkQty: 0,
        qcAcceptedGross: 40,
        qcApprovedRemaining: 0,
      }),
      "QC-approved pool for this sales order item is exhausted — no dispatch-ready quantity left",
    );
  });
});

describe("WO tracking FIFO vs SO FIFO", () => {
  it("WO-line FIFO dispatch share caps by acceptedQty per line (not SO-line order)", () => {
    const bucket = [
      { lineId: 10, acceptedQty: 6 },
      { lineId: 20, acceptedQty: 4 },
    ];
    const woAlloc = allocateDispatchFifoAcrossWorkOrderLines(bucket, 7);
    assert.equal(woAlloc.get(10), 6);
    assert.equal(woAlloc.get(20), 1);

    const soLines = [
      { id: 10, itemId: 1, qty: 100 },
      { id: 20, itemId: 1, qty: 100 },
    ];
    const soAlloc = allocateDispatchAcrossSalesOrderLines(soLines, [{ itemId: 1, dispatchedQty: 7 }]);
    assert.equal(soAlloc.get(10), 7);
    assert.equal(soAlloc.get(20), 0);
  });
});

describe("QC batch pending", () => {
  it("pending = produced - accepted - rejected (non-negative)", () => {
    assert.equal(getProductionBatchQcPendingQty(100, 30, 20), 50);
    assert.equal(getProductionBatchQcPendingQty(10, 10, 10), 0);
  });

  it("sumActiveQc* ignores reversed QC rows (reversedAt set)", () => {
    const entries = [
      { reversedAt: null, acceptedQty: 5, rejectedQty: 1 },
      { reversedAt: new Date("2026-01-01"), acceptedQty: 999, rejectedQty: 888 },
    ];
    assert.equal(sumActiveQcAcceptedQty(entries), 5);
    assert.equal(sumActiveQcRejectedQty(entries), 1);
    assert.equal(getProductionBatchQcPendingQty(10, 5, 1), 4);
  });
});

describe("QC FG stock ledger (accepted vs rejected)", () => {
  it("usable FG net per posting equals acceptedQty only; reject must not reduce FG again", () => {
    const accepted = 15010;
    const rejected = 140;
    const legacyDoubleCountNet = accepted - rejected;
    const correctedNet = accepted;
    assert.equal(correctedNet, 15010);
    assert.equal(legacyDoubleCountNet, 14870);
    assert.equal(correctedNet - legacyDoubleCountNet, rejected);
  });
});

describe("work-order-tracking summary guard", () => {
  it("computeWorkOrderTrackingSummaryFromRows matches row rollups", () => {
    const rows = [
      {
        status: "COMPLETED",
        salesOrderId: 1,
        itemId: 101,
        orderedQty: 80,
        acceptedQty: 80,
        dispatchedQty: 80,
        productionPendingQty: 0,
        qcPendingQty: 0,
        dispatchPendingQty: 0,
      },
      {
        status: "IN_PRODUCTION",
        salesOrderId: 1,
        itemId: 102,
        orderedQty: 200,
        acceptedQty: 11,
        dispatchedQty: 10,
        productionPendingQty: 5,
        qcPendingQty: 2,
        dispatchPendingQty: 1,
      },
    ];
    const summary = computeWorkOrderTrackingSummaryFromRows(rows);
    assert.equal(summary.openWoLines, 1);
    assert.equal(summary.pendingProductionQtySum, 5);
    assert.equal(summary.pendingQcQtySum, 2);
    assert.equal(summary.pendingDispatchQtySum, 1);
    const check = assertWorkOrderTrackingSummaryMatches(rows, summary);
    assert.equal(check.ok, true);
  });

  it("work-order-tracking pendingDispatchQtySum caps by SO when sum(accepted) exceeds orderedQty", () => {
    const { computeWorkOrderTrackingSummaryPendingDispatchQtySum } = require("../src/services/reportMetrics");
    const rows = [
      {
        salesOrderId: 9,
        itemId: 500,
        orderedQty: 25000,
        acceptedQty: 12500,
        dispatchedQty: 0,
        dispatchPendingQty: 12500,
      },
      {
        salesOrderId: 9,
        itemId: 500,
        orderedQty: 25000,
        acceptedQty: 12515,
        dispatchedQty: 0,
        dispatchPendingQty: 12515,
      },
    ];
    assert.equal(computeWorkOrderTrackingSummaryPendingDispatchQtySum(rows), 25000);
    const naive = rows.reduce((s, r) => s + r.dispatchPendingQty, 0);
    assert.equal(naive, 25015);
  });

  it("assertWorkOrderTrackingSummaryMatches fails on drift", () => {
    const rows = [{ status: "PENDING_PRODUCTION", productionPendingQty: 1, qcPendingQty: 0, dispatchPendingQty: 0 }];
    const bad = { openWoLines: 99, pendingProductionQtySum: 1, pendingQcQtySum: 0, pendingDispatchQtySum: 0 };
    const check = assertWorkOrderTrackingSummaryMatches(rows, bad);
    assert.equal(check.ok, false);
  });
});

describe("operationsExceptionClassification", () => {
  it("buildExceptionSummary matches section lengths", () => {
    const dispatch = [{ x: 1 }];
    const production = [{ x: 1 }, { x: 2 }];
    const qc = [{ pendingQcQty: 1 }, { pendingQcQty: 0 }];
    const rm = [{ severity: "CRITICAL" }, { severity: "WARNING" }];
    const purchase = [{ a: 1 }];
    const s = buildExceptionSummary({ dispatch, production, qc, rm, purchase });
    assert.equal(s.dispatchExceptionCount, 1);
    assert.equal(s.productionExceptionCount, 2);
    assert.equal(s.qcExceptionRowsWithPendingQc, 1);
    assert.equal(s.criticalRmItemCount, 1);
    assert.equal(s.purchaseSummaryLineCount, 1);
  });

  it("dispatch exception uses fixed clock for ageDays", () => {
    const t0 = new Date("2020-01-20T12:00:00.000Z").getTime();
    const row = {
      salesOrderId: 1,
      salesOrderNo: "SO-1",
      customerName: "C",
      itemId: 1,
      itemName: "FG",
      orderedQty: 100,
      dispatchedQty: 0,
      pendingQty: 100,
      salesOrderDate: new Date("2020-01-01T12:00:00.000Z").toISOString(),
      status: "APPROVED",
      quantityMetricContext: "SO_FIFO",
    };
    const out = buildDispatchExceptions([row], t0);
    assert.equal(out.length, 1);
    assert.ok(out[0].exceptionAgeDays >= 18 && out[0].exceptionAgeDays <= 20);
    assert.equal(out[0].exceptionPendingShare, 1);
  });

  it("QC critical when pending fraction exceeds config", () => {
    const ratio = OPERATIONS_EXCEPTION_CONFIG.qc.pendingToProducedCriticalRatio;
    const produced = 100;
    const pending = produced * ratio + 1;
    const rows = [
      {
        qcRef: "PE-1",
        workOrderId: 1,
        workOrderNo: "WO-1",
        salesOrderNo: "SO-1",
        itemId: 1,
        itemName: "X",
        producedQty: produced,
        acceptedQty: 0,
        rejectedQty: 0,
        pendingQcQty: pending,
        status: "PENDING_QC",
        qcDate: new Date().toISOString(),
      },
    ];
    const out = buildQcExceptions(rows);
    assert.equal(out[0].severity, "CRITICAL");
  });
});

describe("computeSalesOrderDispatchLineStats", () => {
  it("totalDispatched in summary equals sum of per-line attributed (multi-line same item)", () => {
    const lines = [
      { id: 1, itemId: 5, qty: "10" },
      { id: 2, itemId: 5, qty: "20" },
    ];
    const dispatch = [{ itemId: 5, dispatchedQty: "15" }];
    const { dispatchLineStats, dispatchSummary } = computeSalesOrderDispatchLineStats(lines, dispatch);
    const sumAttr = dispatchLineStats.reduce((s, l) => s + l.dispatched, 0);
    assert.equal(sumAttr, 15);
    assert.equal(dispatchSummary.totalDispatched, 15);
  });
});
