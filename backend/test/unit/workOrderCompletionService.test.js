const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateWorkOrderCompletion,
  completeWorkOrder,
  reconcileWorkOrderStatusFromProduction,
  COMPLETION_TYPES,
  MISSING_CONDITIONS,
} = require("../../src/services/workOrderCompletionService");

function createCompletionMockTx({
  orderType = "NORMAL",
  woStatus = "IN_PROGRESS",
  executionStatus = "RUNNING",
  producedQty = 100,
  plannedQty = 100,
  reportConfirmed = true,
  openReturnPendingCount = 0,
  greenLevel = false,
} = {}) {
  let status = woStatus;
  const lineId = 10;
  const tx = {
    workOrder: {
      findUnique: async () => ({
        id: 5,
        docNo: "WO-5",
        status,
        sourceType: greenLevel ? "GREEN_LEVEL_REPLENISHMENT" : null,
        requirementSheetId: null,
        cycleId: null,
        lines: [{ id: lineId, qty: String(plannedQty), shortfallQty: null }],
        salesOrder: greenLevel ? null : { id: 1, orderType, docNo: "SO-1" },
        productionExecution: { executionStatus },
      }),
      update: async ({ data }) => {
        status = data.status ?? status;
        return {
          id: 5,
          docNo: "WO-5",
          status,
          lines: [{ id: lineId, qty: String(plannedQty), fgItem: { id: 1, itemName: "FG" } }],
          salesOrder: greenLevel ? null : { id: 1, orderType },
        };
      },
    },
    workOrderLine: {
      update: async ({ data }) => ({ id: lineId, shortfallQty: data.shortfallQty }),
    },
    productionWorkOrderReport: {
      findUnique: async () => (reportConfirmed ? { id: 99, status: "CONFIRMED", remainingQty: "0" } : null),
    },
    productionRmReturnPending: {
      count: async () => openReturnPendingCount,
    },
    productionEntry: {
      groupBy: async () => [{ workOrderLineId: lineId, _sum: { producedQty } }],
    },
    auditLog: {
      create: async () => ({ id: 1 }),
    },
  };
  return { tx, getStatus: () => status };
}

describe("workOrderCompletionService", () => {
  it("evaluateWorkOrderCompletion blocks REGULAR completion without confirmed report", async () => {
    const { tx } = createCompletionMockTx({ reportConfirmed: false });
    const evaluation = await evaluateWorkOrderCompletion(tx, 5);
    assert.equal(evaluation.eligible, false);
    assert.equal(evaluation.completionType, COMPLETION_TYPES.NONE);
    assert.ok(evaluation.missingConditions.includes(MISSING_CONDITIONS.PRODUCTION_REPORT_NOT_CONFIRMED));
  });

  it("evaluateWorkOrderCompletion blocks REGULAR completion while RM return pending", async () => {
    const { tx } = createCompletionMockTx({ openReturnPendingCount: 2 });
    const evaluation = await evaluateWorkOrderCompletion(tx, 5);
    assert.equal(evaluation.eligible, false);
    assert.ok(evaluation.missingConditions.includes(MISSING_CONDITIONS.RM_RETURN_PENDING));
  });

  it("completeWorkOrder marks REGULAR work order COMPLETED when eligible", async () => {
    const { tx, getStatus } = createCompletionMockTx();
    const result = await completeWorkOrder(tx, 5, {
      completionType: COMPLETION_TYPES.COMPLETED,
      actorUserId: 1,
      actorRole: "PRODUCTION",
      source: "TEST",
    });
    assert.equal(result.completionType, COMPLETION_TYPES.COMPLETED);
    assert.equal(getStatus(), "COMPLETED");
  });

  it("reconcileWorkOrderStatusFromProduction sets IN_PROGRESS when production started but incomplete", async () => {
    const { tx, getStatus } = createCompletionMockTx({
      woStatus: "PENDING",
      producedQty: 40,
      plannedQty: 100,
      reportConfirmed: false,
    });
    const result = await reconcileWorkOrderStatusFromProduction(tx, 5);
    assert.equal(result.changed, true);
    assert.equal(result.status, "IN_PROGRESS");
    assert.equal(getStatus(), "IN_PROGRESS");
  });

  it("completeWorkOrder closes REGULAR work order with shortfall", async () => {
    const { tx, getStatus } = createCompletionMockTx({ producedQty: 70, plannedQty: 100 });
    const result = await completeWorkOrder(tx, 5, {
      completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
      closureReason: "Customer accepted partial delivery",
      actorUserId: 1,
      actorRole: "PRODUCTION",
    });
    assert.equal(result.completionType, COMPLETION_TYPES.CLOSED_WITH_SHORTFALL);
    assert.equal(result.shortfallQty, 30);
    assert.equal(getStatus(), "CLOSED_WITH_SHORTFALL");
  });

  it("evaluateWorkOrderCompletion requires execution completion for NO_QTY mirror", async () => {
    const { tx } = createCompletionMockTx({
      orderType: "NO_QTY",
      executionStatus: "RUNNING",
      producedQty: 100,
    });
    const evaluation = await evaluateWorkOrderCompletion(tx, 5);
    assert.equal(evaluation.eligible, false);
    assert.ok(evaluation.missingConditions.includes(MISSING_CONDITIONS.EXECUTION_NOT_COMPLETED));
  });
});
