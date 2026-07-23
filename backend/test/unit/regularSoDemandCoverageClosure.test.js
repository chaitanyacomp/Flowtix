const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateWorkOrderCompletion,
  completeWorkOrder,
  COMPLETION_TYPES,
  MISSING_CONDITIONS,
} = require("../../src/services/workOrderCompletionService");

function createRegularCoverageMockTx({
  producedQty = 10087,
  plannedQty = 10100,
  soDemandQty = 10000,
  reportConfirmed = true,
  openReturnPendingCount = 0,
  woStatus = "IN_PROGRESS",
  otherProduced = 0,
} = {}) {
  let status = woStatus;
  const lineId = 10;
  const fgItemId = 55;
  const salesOrderId = 1;
  const tx = {
    workOrder: {
      findUnique: async () => ({
        id: 5,
        docNo: "WO-5",
        status,
        sourceType: null,
        requirementSheetId: null,
        cycleId: null,
        salesOrderId,
        shortfallQty: null,
        lines: [{ id: lineId, qty: String(plannedQty), plannedQty: String(plannedQty), fgItemId, shortfallQty: null }],
        salesOrder: { id: salesOrderId, orderType: "NORMAL", docNo: "SO-26-0001" },
        productionExecution: { executionStatus: "SHORTFALL_PENDING" },
      }),
      update: async ({ data }) => {
        status = data.status ?? status;
        return {
          id: 5,
          docNo: "WO-5",
          status,
          lines: [{ id: lineId, qty: String(plannedQty), fgItem: { id: fgItemId, itemName: "FG" } }],
          salesOrder: { id: salesOrderId, orderType: "NORMAL" },
        };
      },
    },
    workOrderLine: {
      findMany: async () => (otherProduced > 0 ? [{ id: 99 }] : []),
      update: async ({ data }) => ({ id: lineId, shortfallQty: data.shortfallQty }),
    },
    salesOrder: {
      findUnique: async () => ({
        orderType: "NORMAL",
        lines: [{ qty: soDemandQty, customerPoQty: soDemandQty, itemId: fgItemId }],
      }),
    },
    productionWorkOrderReport: {
      findUnique: async () => (reportConfirmed ? { id: 99, status: "CONFIRMED", remainingQty: "0" } : null),
    },
    productionRmReturnPending: {
      count: async () => openReturnPendingCount,
    },
    productionEntry: {
      groupBy: async ({ where }) => {
        if (where?.workOrderLineId?.in?.includes?.(99)) {
          return [{ workOrderLineId: 99, _sum: { producedQty: otherProduced } }];
        }
        return [{ workOrderLineId: lineId, _sum: { producedQty: producedQty } }];
      },
    },
    workOrderProductionExecution: {
      upsert: async () => ({ workOrderId: 5, executionStatus: "COMPLETED" }),
    },
    auditLog: {
      create: async () => ({ id: 1 }),
    },
  };
  return { tx, getStatus: () => status };
}

describe("REGULAR SO demand coverage closure", () => {
  it("permits COMPLETED when produced covers SO demand below WO plan (after report)", async () => {
    const { tx } = createRegularCoverageMockTx({
      producedQty: 10087,
      plannedQty: 10100,
      soDemandQty: 10000,
      reportConfirmed: true,
    });
    const evaluation = await evaluateWorkOrderCompletion(tx, 5);
    assert.equal(evaluation.eligible, true);
    assert.equal(evaluation.completionType, COMPLETION_TYPES.COMPLETED);
    assert.ok(!evaluation.missingConditions.includes(MISSING_CONDITIONS.PRODUCTION_INCOMPLETE));
  });

  it("blocks COMPLETED before Production Report confirmation", async () => {
    const { tx } = createRegularCoverageMockTx({ reportConfirmed: false });
    const evaluation = await evaluateWorkOrderCompletion(tx, 5);
    assert.equal(evaluation.eligible, false);
    assert.ok(evaluation.missingConditions.includes(MISSING_CONDITIONS.PRODUCTION_REPORT_NOT_CONFIRMED));
  });

  it("blocks COMPLETED when produced is below remaining SO demand", async () => {
    const { tx } = createRegularCoverageMockTx({
      producedQty: 9000,
      plannedQty: 10100,
      soDemandQty: 10000,
      reportConfirmed: true,
    });
    const evaluation = await evaluateWorkOrderCompletion(tx, 5);
    assert.equal(evaluation.eligible, false);
    assert.ok(evaluation.missingConditions.includes(MISSING_CONDITIONS.PRODUCTION_INCOMPLETE));
  });

  it("rejects SHORTFALL_CLOSE when SO demand is already covered (WO-plan remainder is not shortage)", async () => {
    const { tx } = createRegularCoverageMockTx({
      producedQty: 10087,
      plannedQty: 10100,
      soDemandQty: 10000,
      reportConfirmed: true,
    });
    const evaluation = await evaluateWorkOrderCompletion(tx, 5, {
      intent: "SHORTFALL_CLOSE",
      closureReason: "Closing unused WO buffer",
    });
    assert.equal(evaluation.eligible, false);
    assert.ok(evaluation.missingConditions.includes(MISSING_CONDITIONS.NO_SHORTFALL_BALANCE));
  });

  it("allows SHORTFALL_CLOSE for true SO-demand shortage after report", async () => {
    const { tx, getStatus } = createRegularCoverageMockTx({
      producedQty: 9000,
      plannedQty: 10100,
      soDemandQty: 10000,
      reportConfirmed: true,
    });
    const evaluation = await evaluateWorkOrderCompletion(tx, 5, {
      intent: "SHORTFALL_CLOSE",
      closureReason: "Customer accepted partial",
    });
    assert.equal(evaluation.eligible, true);
    assert.equal(evaluation.shortfallQty, 1000);

    const result = await completeWorkOrder(tx, 5, {
      completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
      closureReason: "Customer accepted partial",
      actorUserId: 1,
      actorRole: "PRODUCTION",
      evaluation,
    });
    assert.equal(result.completionType, COMPLETION_TYPES.CLOSED_WITH_SHORTFALL);
    assert.equal(result.shortfallQty, 1000);
    assert.equal(getStatus(), "CLOSED_WITH_SHORTFALL");
  });

  it("completes WO as COMPLETED after report when SO demand covered with WO remainder", async () => {
    const { tx, getStatus } = createRegularCoverageMockTx({
      producedQty: 10087,
      plannedQty: 10100,
      soDemandQty: 10000,
    });
    const result = await completeWorkOrder(tx, 5, {
      completionType: COMPLETION_TYPES.COMPLETED,
      actorUserId: 1,
      actorRole: "PRODUCTION",
      source: "TEST",
    });
    assert.equal(result.completionType, COMPLETION_TYPES.COMPLETED);
    assert.equal(getStatus(), "COMPLETED");
  });
});
