const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateSalesOrderOperationalCompletion,
  assertSalesOrderOperationalCompletion,
  completeSalesOrderOperationally,
  operationalCompletionBlockMessage,
  summarizeRegularClosedShortQuantities,
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

  it("uses customer PO quantity, not buffered WO target, for permanent customer shortage", () => {
    const rows = summarizeRegularClosedShortQuantities({
      lines: [{ itemId: 10, customerPoQty: "15000", qty: "15075" }],
      workOrders: [{
        status: "CLOSED_WITH_SHORTFALL",
        lines: [{
          fgItemId: 10,
          productions: [{
            workflowStatus: "APPROVED",
            producedQty: "1530",
            qcEntries: [{ acceptedQty: "1515", reversedAt: null }],
          }],
        }],
      }],
      dispatch: [{ itemId: 10, dispatchedQty: "1515", workflowStatus: "LOCKED", reversalOfId: null }],
    });
    assert.deepEqual(rows[0], {
      itemId: 10,
      orderedQty: 15000,
      producedQty: 1530,
      acceptedQty: 1515,
      dispatchedQty: 1515,
      usableFgPendingDispatchQty: 0,
      permanentlyClosedShortQty: 13485,
    });
  });

  it("closes a Regular SO after all accepted FG from a permanent short close is dispatched", async () => {
    const tx = makeTx({
      tx: {
        salesOrder: {
          findUnique: async ({ include }) => {
            if (!include?.lines) {
              return { id: 1, docNo: "SO-1", orderType: "NORMAL", internalStatus: "IN_PROCESS", currentCycleId: null };
            }
            return {
              id: 1,
              orderType: "NORMAL",
              lines: [{ itemId: 10, customerPoQty: "15000", qty: "15075" }],
              dispatch: [{ itemId: 10, dispatchedQty: "1515", workflowStatus: "LOCKED", reversalOfId: null }],
              workOrders: [{
                status: "CLOSED_WITH_SHORTFALL",
                lines: [{
                  fgItemId: 10,
                  productions: [{
                    workflowStatus: "APPROVED",
                    producedQty: "1530",
                    qcEntries: [{ acceptedQty: "1515", reversedAt: null }],
                  }],
                }],
              }],
            };
          },
        },
      },
    });
    const result = await evaluateSalesOrderOperationalCompletion(tx, 1);
    assert.equal(result.eligible, true);
    assert.equal(result.flow.closedWithShortage, true);
    assert.equal(result.flow.quantitySummary[0].permanentlyClosedShortQty, 13485);
  });

  it("keeps the Regular SO operationally open while accepted FG remains dispatchable", async () => {
    const tx = makeTx({
      tx: {
        salesOrder: {
          findUnique: async ({ include }) => include?.lines
            ? {
                id: 1,
                orderType: "NORMAL",
                lines: [{ itemId: 10, customerPoQty: "15000", qty: "15075" }],
                dispatch: [{ itemId: 10, dispatchedQty: "1500", workflowStatus: "LOCKED", reversalOfId: null }],
                workOrders: [{
                  status: "CLOSED_WITH_SHORTFALL",
                  lines: [{
                    fgItemId: 10,
                    productions: [{
                      workflowStatus: "APPROVED",
                      producedQty: "1530",
                      qcEntries: [{ acceptedQty: "1515", reversedAt: null }],
                    }],
                  }],
                }],
              }
            : { id: 1, docNo: "SO-1", orderType: "NORMAL", internalStatus: "IN_PROCESS", currentCycleId: null },
        },
      },
    });
    const result = await evaluateSalesOrderOperationalCompletion(tx, 1);
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "PENDING_DISPATCH");
    assert.equal(result.flow, undefined);
  });

  it("does not close a permanently short Regular SO while QC is pending", async () => {
    const tx = makeTx({
      workOrders: [{
        id: 10,
        status: "CLOSED_WITH_SHORTFALL",
        productionExecution: { executionStatus: "COMPLETED" },
        lines: [{ id: 100, qty: "15075" }],
      }],
      tx: {
        productionEntry: {
          groupBy: async () => [{ workOrderLineId: 100, _sum: { producedQty: "1530" } }],
          findMany: async () => [{
            producedQty: "1530",
            workOrderLine: { workOrderId: 10 },
            qcEntries: [{ acceptedQty: "1000", rejectedQty: "0", reversedAt: null }],
          }],
        },
      },
    });
    const result = await evaluateSalesOrderOperationalCompletion(tx, 1);
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "PENDING_QC");
  });

  it("does not close while an active dispatch draft owns accepted FG", async () => {
    const tx = makeTx({
      tx: {
        salesOrder: {
          findUnique: async ({ include }) => include?.lines
            ? {
                id: 1,
                orderType: "NORMAL",
                lines: [{ itemId: 10, customerPoQty: "15000", qty: "15075" }],
                dispatch: [{ itemId: 10, dispatchedQty: "1515", workflowStatus: "UNLOCKED", reversalOfId: null }],
                workOrders: [{
                  status: "CLOSED_WITH_SHORTFALL",
                  lines: [{
                    fgItemId: 10,
                    productions: [{
                      workflowStatus: "APPROVED",
                      producedQty: "1530",
                      qcEntries: [{ acceptedQty: "1515", rejectedQty: "15", reversedAt: null }],
                    }],
                  }],
                }],
              }
            : { id: 1, docNo: "SO-1", orderType: "NORMAL", internalStatus: "IN_PROCESS", currentCycleId: null },
        },
      },
    });
    const result = await evaluateSalesOrderOperationalCompletion(tx, 1);
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "DRAFT_DISPATCH_EXISTS");
  });

  it("does not close while rejected FG still has an open disposition that may return to QC", async () => {
    const tx = makeTx({
      workOrders: [{
        id: 10,
        status: "CLOSED_WITH_SHORTFALL",
        productionExecution: { executionStatus: "COMPLETED" },
        lines: [{ id: 100, qty: "100" }],
      }],
      tx: {
        productionEntry: {
          groupBy: async () => [{ workOrderLineId: 100, _sum: { producedQty: "100" } }],
          findMany: async () => [],
        },
        qcRejectedDisposition: { count: async () => 1 },
      },
    });
    const result = await evaluateSalesOrderOperationalCompletion(tx, 1);
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "PENDING_QC_DISPOSITION");
  });

  it("allows final short close after terminal QC rejection leaves no accepted FG or open disposition", async () => {
    const tx = makeTx({
      tx: {
        salesOrder: {
          findUnique: async ({ include }) => include?.lines
            ? {
                id: 1,
                orderType: "NORMAL",
                lines: [{ itemId: 10, customerPoQty: "15000", qty: "15075" }],
                dispatch: [],
                workOrders: [{
                  status: "CLOSED_WITH_SHORTFALL",
                  lines: [{
                    fgItemId: 10,
                    productions: [{
                      workflowStatus: "APPROVED",
                      producedQty: "1530",
                      qcEntries: [{ acceptedQty: "0", rejectedQty: "1530", reversedAt: null }],
                    }],
                  }],
                }],
              }
            : { id: 1, docNo: "SO-1", orderType: "NORMAL", internalStatus: "IN_PROCESS", currentCycleId: null },
        },
      },
    });
    const result = await evaluateSalesOrderOperationalCompletion(tx, 1);
    assert.equal(result.eligible, true);
    assert.equal(result.flow.closedWithShortage, true);
    assert.equal(result.flow.quantitySummary[0].permanentlyClosedShortQty, 15000);
  });
});
