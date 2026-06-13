const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  remainingAfterPurchaseRequests,
  loadTotalPurchaseRequestAllocByMrLineId,
} = require("../../src/services/purchaseRequestService");
const {
  deriveMrProcurementOperationalStatus,
} = require("../../src/services/procurementWorkspaceService");

describe("monthlyPlanningProcurementHandoff", () => {
  it("remainingAfterPurchaseRequests exposes rev5 PP and Powder deltas", () => {
    const pp = { id: 101, shortageQty: 330.87, requiredQty: 330.87 };
    const powder = { id: 102, shortageQty: 10.25, requiredQty: 10.25 };
    const alloc = new Map([
      [101, 185.61],
      [102, 5.75],
    ]);
    assert.equal(remainingAfterPurchaseRequests(pp, alloc), 145.26);
    assert.equal(remainingAfterPurchaseRequests(powder, alloc), 4.5);
  });

  it("deriveMrProcurementOperationalStatus shows procurement pending when PR handoff is short", () => {
    const mr = {
      status: "FULLY_PROCURED",
      lines: [
        { id: 101, shortageQty: 330.87, requiredQty: 330.87, procuredQty: 200 },
        { id: 102, shortageQty: 10.25, requiredQty: 10.25, procuredQty: 10 },
      ],
    };
    const alloc = new Map([
      [101, 185.61],
      [102, 5.75],
    ]);
    const op = deriveMrProcurementOperationalStatus(mr, alloc, {
      hasOpenPo: false,
      hasGrnPending: false,
      prPendingCount: 0,
    });
    assert.equal(op.key, "PROCUREMENT_PENDING");
  });
});

describe("loadTotalPurchaseRequestAllocByMrLineId", () => {
  it("is exported for workspace handoff calculations", () => {
    assert.equal(typeof loadTotalPurchaseRequestAllocByMrLineId, "function");
  });
});
