const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateSalesOrderOperationalCompletion,
  assertSalesOrderOperationalCompletion,
  completeSalesOrderOperationally,
  operationalCompletionBlockMessage,
} = require("../../src/services/salesOrderOperationalAutoClose");

function makeTx(overrides = {}) {
  const baseSo = {
    id: 1,
    docNo: "SO-26-0001",
    orderType: "NORMAL",
    internalStatus: "IN_PROCESS",
    currentCycleId: null,
  };
  const fullSo = {
    ...baseSo,
    lines: [{ itemId: 10, qty: "100" }],
    dispatch: [{ itemId: 10, dispatchedQty: "100", reversalOfId: null, workflowStatus: "LOCKED" }],
  };

  return {
    $queryRaw: async () => [{ id: 1 }],
    salesOrder: {
      findUnique: async ({ where, include }) => {
        if (overrides.soNotFound) return null;
        if (include?.lines) return fullSo;
        return { ...baseSo, ...(overrides.so ?? {}) };
      },
      update: async ({ data }) => ({ ...baseSo, ...data }),
    },
    salesOrderCycle: { count: async () => overrides.activeCycleCount ?? 0 },
    requirementSheet: { count: async () => overrides.openSheetCount ?? 0 },
    dispatch: { count: async () => overrides.unlockedDispatchCount ?? 0 },
    workOrder: { findMany: async () => overrides.workOrders ?? [] },
    productionEntry: { findMany: async () => [] },
    qcRejectedDisposition: { count: async () => 0 },
    ...overrides.tx,
  };
}

describe("salesOrderOperationalAutoClose", () => {
  it("maps block reasons to operator-readable messages", () => {
    assert.match(operationalCompletionBlockMessage("PENDING_DISPATCH"), /Dispatch is still pending/);
    assert.match(operationalCompletionBlockMessage("ACTIVE_CYCLE_EXISTS"), /NO_QTY cycle/);
  });

  it("blocks completion when confirmed dispatch is incomplete", async () => {
    const tx = makeTx({
      tx: {
        salesOrder: {
          findUnique: async ({ include }) => {
            if (include?.lines) {
              return {
                id: 1,
                orderType: "NORMAL",
                lines: [{ itemId: 10, qty: "100" }],
                dispatch: [{ itemId: 10, dispatchedQty: "40", reversalOfId: null, workflowStatus: "LOCKED" }],
              };
            }
            return {
              id: 1,
              docNo: "SO-1",
              orderType: "NORMAL",
              internalStatus: "IN_PROCESS",
              currentCycleId: null,
            };
          },
        },
      },
    });
    const result = await evaluateSalesOrderOperationalCompletion(tx, 1);
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "PENDING_DISPATCH");
  });

  it("allows completion when dispatch is fully confirmed and no production/QC pending", async () => {
    const tx = makeTx();
    const result = await evaluateSalesOrderOperationalCompletion(tx, 1);
    assert.equal(result.eligible, true);
    assert.equal(result.reason, null);
  });

  it("assertSalesOrderOperationalCompletion throws with status code for blocked close", async () => {
    const tx = makeTx({
      tx: {
        salesOrder: {
          findUnique: async ({ include }) => {
            if (include?.lines) {
              return {
                id: 1,
                orderType: "NORMAL",
                lines: [{ itemId: 10, qty: "100" }],
                dispatch: [],
              };
            }
            return {
              id: 1,
              docNo: "SO-1",
              orderType: "NORMAL",
              internalStatus: "IN_PROCESS",
              currentCycleId: null,
            };
          },
        },
      },
    });
    await assert.rejects(
      () => assertSalesOrderOperationalCompletion(tx, 1),
      (err) => err.statusCode === 400 && /Dispatch is still pending/.test(err.message),
    );
  });

  it("completeSalesOrderOperationally is idempotent when already closed", async () => {
    const tx = makeTx({ so: { internalStatus: "COMPLETED" } });
    const result = await completeSalesOrderOperationally(tx, 1, { actorUserId: 9 });
    assert.equal(result.closed, false);
    assert.equal(result.reason, "ALREADY_CLOSED");
  });
});
