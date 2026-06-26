/**
 * @jest-environment node
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  getEffectiveProductionPendingQty,
  blockReasonLabel,
  finishProductionExecution,
  applyWorkOrderExecutionOutcome,
} = require("../../src/services/productionExecutionService");

function createFinishMockTx({ workOrderId = 280, plannedQty = 1500, producedQty = 1200 } = {}) {
  const opOrder = [];
  const lineId = 1001;
  const fgItemId = 501;
  const wo = {
    id: workOrderId,
    docNo: `WO-${workOrderId}`,
    status: "IN_PROGRESS",
    salesOrderId: 42,
    requirementSheetId: 7,
    cycleId: 3,
    lines: [
      {
        id: lineId,
        fgItemId,
        qty: plannedQty,
        plannedQty,
        executionWaivedQty: null,
        fgItem: { id: fgItemId, itemName: "FG Widget" },
      },
    ],
    salesOrder: { id: 42, docNo: "SO-42", orderType: "NO_QTY", customerId: 1 },
    productionExecution: {
      workOrderId,
      executionStatus: "RUNNING",
      blockReason: null,
      blockRemarks: null,
      blockedAt: null,
    },
  };

  let executionStatus = "RUNNING";
  let woStatus = wo.status;
  const carryForwardRows = [];
  const auditRows = [];

  const tx = {
    workOrder: {
      findUnique: async () => ({ ...wo, status: woStatus, productionExecution: { ...wo.productionExecution, executionStatus } }),
      update: async ({ data }) => {
        opOrder.push("workOrder.update");
        woStatus = data.status ?? woStatus;
        return { ...wo, status: woStatus };
      },
    },
    workOrderProductionExecution: {
      findUnique: async () => ({ workOrderId, executionStatus }),
      create: async ({ data }) => {
        opOrder.push("execution.create");
        executionStatus = data.executionStatus ?? "RUNNING";
        return { workOrderId, executionStatus };
      },
      update: async ({ data }) => {
        opOrder.push("execution.update");
        if (data.executionStatus === "COMPLETED") {
          const exec = wo.productionExecution;
          if (exec.executionStatus === "COMPLETED") {
            const err = new Error("Production execution is already completed.");
            err.statusCode = 409;
            throw err;
          }
        }
        executionStatus = data.executionStatus ?? executionStatus;
        wo.productionExecution = { ...wo.productionExecution, executionStatus, ...data };
        return wo.productionExecution;
      },
    },
    productionEntry: {
      groupBy: async ({ where }) => {
        const lineIds = where.workOrderLineId?.in ?? [];
        return lineIds.map((id) => ({
          workOrderLineId: id,
          _sum: { producedQty: producedQty },
        }));
      },
    },
    productionShortfallResolution: {
      create: async ({ data }) => {
        opOrder.push("shortfallResolution.create");
        const row = { id: auditRows.length + 1, ...data };
        auditRows.push(row);
        return row;
      },
    },
    carryForwardPending: {
      create: async ({ data }) => {
        opOrder.push("carryForwardPending.create");
        const row = { id: carryForwardRows.length + 1, ...data };
        carryForwardRows.push(row);
        return row;
      },
    },
    workOrderLine: {
      update: async ({ data }) => ({ executionWaivedQty: data.executionWaivedQty }),
    },
  };

  return { tx, opOrder, carryForwardRows, auditRows, getExecutionStatus: () => executionStatus, getWoStatus: () => woStatus };
}

describe("productionExecutionService", () => {
  test("getEffectiveProductionPendingQty returns zero when execution is completed", () => {
    assert.equal(getEffectiveProductionPendingQty(500, 480, "COMPLETED"), 0);
  });

  test("getEffectiveProductionPendingQty returns remainder when running", () => {
    assert.equal(getEffectiveProductionPendingQty(500, 480, "RUNNING"), 20);
  });

  test("getEffectiveProductionPendingQty returns remainder when blocked", () => {
    assert.equal(getEffectiveProductionPendingQty(500, 480, "BLOCKED"), 20);
  });

  test("blockReasonLabel formats enum values for display", () => {
    assert.equal(blockReasonLabel("WAITING_FOR_RM"), "Waiting For Rm");
  });

  test("applyWorkOrderExecutionOutcome rejects when execution already COMPLETED", async () => {
    const { tx } = createFinishMockTx();
    tx.workOrder.findUnique = async () => ({
      id: 280,
      docNo: "WO-280",
      status: "IN_PROGRESS",
      salesOrderId: 42,
      requirementSheetId: 7,
      cycleId: 3,
      lines: [],
      salesOrder: { id: 42, docNo: "SO-42", orderType: "NO_QTY", customerId: 1 },
      productionExecution: { executionStatus: "COMPLETED" },
    });
    await assert.rejects(
      () => applyWorkOrderExecutionOutcome(tx, 280, { outcome: "CARRY_FORWARD" }),
      (err) => err.message === "Production execution is already completed." && err.statusCode === 409,
    );
  });

  test("finishProductionExecution CARRY_FORWARD creates CF and audit before marking execution COMPLETED", async () => {
    const { tx, opOrder, carryForwardRows, auditRows, getExecutionStatus, getWoStatus } = createFinishMockTx();

    const result = await finishProductionExecution(
      tx,
      280,
      { shortfallOutcome: "CARRY_FORWARD", resolutionReason: "CAPACITY_CONSTRAINT" },
      { actorUserId: null, actorRole: null },
    );

    assert.equal(result.outcome, "CARRY_FORWARD");
    assert.equal(getExecutionStatus(), "COMPLETED");
    assert.equal(getWoStatus(), "COMPLETED");
    assert.equal(carryForwardRows.length, 1);
    assert.equal(Number(carryForwardRows[0].remainingQty), 300);
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].resolutionType, "CARRY_FORWARD");

    const cfIdx = opOrder.indexOf("carryForwardPending.create");
    const auditIdx = opOrder.indexOf("shortfallResolution.create");
    const woIdx = opOrder.indexOf("workOrder.update");
    const execIdx = opOrder.indexOf("execution.update");
    assert.ok(auditIdx >= 0 && cfIdx > auditIdx, "audit before carry forward");
    assert.ok(woIdx > cfIdx, "WO completion after carry forward");
    assert.ok(execIdx > woIdx, "execution COMPLETED after WO completion");
  });

  test("finishProductionExecution FULL_COMPLETE marks WO before execution COMPLETED", async () => {
    const { tx, opOrder, getExecutionStatus, getWoStatus } = createFinishMockTx({ producedQty: 1500 });
    const result = await finishProductionExecution(tx, 280, {}, { actorUserId: null, actorRole: null });
    assert.equal(result.outcome, "FULL_COMPLETE");
    assert.equal(getExecutionStatus(), "COMPLETED");
    assert.equal(getWoStatus(), "COMPLETED");
    const woIdx = opOrder.indexOf("workOrder.update");
    const execIdx = opOrder.indexOf("execution.update");
    assert.ok(woIdx >= 0 && execIdx > woIdx, "execution COMPLETED after WO completion");
  });
});
