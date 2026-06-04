const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeNoQtyManualCloseEligibility,
} = require("../../src/services/noQtySoManualCloseEligibility");
const { assertCanMarkSalesOrderCompleted } = require("../../src/services/salesOrderDispatchHelpers");

const SO_ID = 1;
const CYCLE_ID = 10;

function baseNoQtySo(overrides = {}) {
  return { orderType: "NO_QTY", internalStatus: "OPEN", ...overrides };
}

function makeDb(handlers) {
  return {
    salesOrder: { findUnique: async () => handlers.so ?? baseNoQtySo() },
    salesOrderCycle: {
      findFirst: async () => handlers.activeCycle ?? null,
    },
    dispatch: { count: async () => handlers.unlockedDispatchCount ?? 0 },
    requirementSheet: {
      count: async (args) => {
        if (args?.where?.status === "DRAFT") return handlers.draftRsCount ?? 0;
        return 0;
      },
      findFirst: async (args) => {
        if (args?.where?.status === "LOCKED") return handlers.lockedRsWithLines ?? handlers.lockedRs ?? null;
        return null;
      },
    },
    workOrder: {
      findMany: async () => handlers.workOrders ?? [],
      count: async () => handlers.woCount ?? 0,
    },
    productionEntry: {
      groupBy: async () => handlers.productionGroupBy ?? [],
      findMany: async () => handlers.prodEntries ?? [],
    },
    qcRejectedDisposition: { count: async () => handlers.openDispositionCount ?? 0 },
    productionMaterialRequest: { findFirst: async () => handlers.openPmr ?? null },
    dispatch_findMany: handlers.cycleDispatch ?? [],
  };
}

function dbWithCycleDispatch(db, cycleDispatch) {
  const inner = db;
  return {
    ...inner,
    dispatch: {
      count: inner.dispatch.count,
      findMany: async (args) => {
        if (args?.where?.workflowStatus === "LOCKED") return cycleDispatch;
        return [];
      },
    },
  };
}

describe("noQtySoManualCloseEligibility", () => {
  it("blocks when RS locked, WO exists, no dispatch (PENDING_DISPATCH)", async () => {
    const db = dbWithCycleDispatch(
      makeDb({
        activeCycle: { id: CYCLE_ID, cycleNo: 1 },
        lockedRsWithLines: {
          id: 1,
          lines: [{ itemId: 63, suggestedWoQtySnapshot: 1000, requirementQty: 1000 }],
        },
        woCount: 1,
        workOrders: [{ id: 5, status: "APPROVED", lines: [{ id: 50, qty: 1000 }] }],
        productionGroupBy: [{ workOrderLineId: 50, _sum: { producedQty: 1000 } }],
        prodEntries: [
          {
            producedQty: 1000,
            qcEntries: [{ acceptedQty: 1000, rejectedQty: 0, reversedAt: null }],
          },
        ],
        cycleDispatch: [],
      }),
      [],
    );
    const r = await computeNoQtyManualCloseEligibility(db, SO_ID);
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "PENDING_DISPATCH");
    assert.match(r.message, /dispatch is pending/i);
  });

  it("blocks when production is still pending", async () => {
    const db = makeDb({
      activeCycle: { id: CYCLE_ID, cycleNo: 1 },
      lockedRs: { id: 1 },
      woCount: 1,
      workOrders: [{ id: 5, status: "APPROVED", lines: [{ id: 50, qty: 1000 }] }],
      productionGroupBy: [],
      prodEntries: [],
    });
    const r = await computeNoQtyManualCloseEligibility(db, SO_ID);
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "PENDING_PRODUCTION");
    assert.match(r.message, /production is still pending/i);
  });

  it("blocks when production done but QA pending", async () => {
    const db = makeDb({
      activeCycle: { id: CYCLE_ID, cycleNo: 1 },
      lockedRs: { id: 1 },
      woCount: 1,
      workOrders: [{ id: 5, status: "APPROVED", lines: [{ id: 50, qty: 1000 }] }],
      productionGroupBy: [{ workOrderLineId: 50, _sum: { producedQty: 1000 } }],
      prodEntries: [
        {
          producedQty: 1000,
          qcEntries: [{ acceptedQty: 500, rejectedQty: 0, reversedAt: null }],
        },
      ],
    });
    const r = await computeNoQtyManualCloseEligibility(db, SO_ID);
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "PENDING_QC");
    assert.match(r.message, /QA is pending/i);
  });

  it("blocks when unlocked dispatch draft exists", async () => {
    const db = makeDb({
      unlockedDispatchCount: 1,
      activeCycle: null,
    });
    const r = await computeNoQtyManualCloseEligibility(db, SO_ID);
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "DRAFT_DISPATCH_EXISTS");
    assert.match(r.message, /dispatch draft/i);
  });

  it("allows when dispatch cap met and billing would be pending (no active cycle)", async () => {
    const db = makeDb({ activeCycle: null });
    const r = await computeNoQtyManualCloseEligibility(db, SO_ID);
    assert.equal(r.eligible, true);
    assert.equal(r.reason, "OK");
  });

  it("allows when dispatch finalized on active cycle (sales bill not checked)", async () => {
    const lockedSheet = {
      id: 1,
      lines: [{ itemId: 63, suggestedWoQtySnapshot: 1000, requirementQty: 1000 }],
    };
    const lockedDispatch = [
      {
        id: 1,
        itemId: 63,
        dispatchedQty: "1000",
        reversalOfId: null,
        workflowStatus: "LOCKED",
      },
    ];
    const db = dbWithCycleDispatch(
      makeDb({
        activeCycle: { id: CYCLE_ID, cycleNo: 1 },
        lockedRsWithLines: lockedSheet,
        woCount: 1,
        workOrders: [{ id: 5, status: "COMPLETED", lines: [{ id: 50, qty: 1000 }] }],
        productionGroupBy: [{ workOrderLineId: 50, _sum: { producedQty: 1000 } }],
        prodEntries: [
          {
            producedQty: 1000,
            qcEntries: [{ acceptedQty: 1000, rejectedQty: 0, reversedAt: null }],
          },
        ],
        cycleDispatch: lockedDispatch,
      }),
      lockedDispatch,
    );
    const r = await computeNoQtyManualCloseEligibility(db, SO_ID);
    assert.equal(r.eligible, true);
    assert.equal(r.reason, "OK");
  });

  it("returns NOT_NO_QTY for REGULAR sales orders (REGULAR completion path unchanged)", async () => {
    const db = makeDb({ so: { orderType: "NORMAL", internalStatus: "IN_PROCESS" } });
    const r = await computeNoQtyManualCloseEligibility(db, SO_ID);
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "NOT_NO_QTY");
  });
});

describe("REGULAR SO completion guard unchanged", () => {
  it("still rejects COMPLETED when dispatch is incomplete", () => {
    assert.throws(
      () =>
        assertCanMarkSalesOrderCompleted({
          orderType: "NORMAL",
          lines: [{ itemId: 1, qty: 100, customerPoQty: 100 }],
          dispatch: [],
        }),
      (err) => {
        assert.match(String(err.message), /Dispatch is still pending/i);
        return true;
      },
    );
  });
});
