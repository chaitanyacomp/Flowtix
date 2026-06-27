/**
 * @jest-environment node
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  getEffectiveProductionPendingQty,
  blockReasonLabel,
  buildFinishSuccessMessage,
  finishProductionExecution,
  blockProductionExecution,
  resumeProductionExecution,
  applyWorkOrderExecutionOutcome,
  computeExecutionSummary,
  syncShortfallPendingAfterProductionApprove,
  reconcileShortfallPendingStatus,
  assertNoQtyProductionExecutionAllowsProduction,
  productionExecutionPendingActionLabel,
  deriveProductionQueueActionLabel,
  PRODUCTION_EXECUTION_PENDING_LABELS,
} = require("../../src/services/productionExecutionService");
const { getWoLineRemainingProductionQty } = require("../../src/services/reportMetrics");

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
      resumedAt: null,
    },
  };

  let executionStatus = "RUNNING";
  let woStatus = wo.status;
  const carryForwardRows = [];
  const auditRows = [];

  const tx = {
    workOrder: {
      findUnique: async () => ({
        ...wo,
        status: woStatus,
        productionExecution: { ...wo.productionExecution, executionStatus },
      }),
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
      findFirst: async () => ({ producedQty }),
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

  test("getEffectiveProductionPendingQty returns zero when shortfall decision is pending", () => {
    assert.equal(getEffectiveProductionPendingQty(500, 480, "SHORTFALL_PENDING"), 0);
  });

  test("syncShortfallPendingAfterProductionApprove marks execution SHORTFALL_PENDING", async () => {
    const { tx, getExecutionStatus } = createFinishMockTx({ plannedQty: 3000, producedQty: 2800 });
    await syncShortfallPendingAfterProductionApprove(tx, 280, 2800);
    assert.equal(getExecutionStatus(), "SHORTFALL_PENDING");
  });

  test("syncShortfallPendingAfterProductionApprove skips partial batches that do not trigger shortfall", async () => {
    const { tx, getExecutionStatus } = createFinishMockTx({ plannedQty: 3000, producedQty: 1000 });
    await syncShortfallPendingAfterProductionApprove(tx, 280, 1000);
    assert.equal(getExecutionStatus(), "RUNNING");
  });

  test("assertNoQtyProductionExecutionAllowsProduction blocks SHORTFALL_PENDING", async () => {
    const { tx } = createFinishMockTx({ plannedQty: 3000, producedQty: 2800 });
    await syncShortfallPendingAfterProductionApprove(tx, 280, 2800);
    tx.workOrder.findUnique = async () => ({
      id: 280,
      requirementSheetId: 7,
      cycleId: 3,
      status: "IN_PROGRESS",
      salesOrder: { orderType: "NO_QTY" },
      productionExecution: { executionStatus: "SHORTFALL_PENDING", blockReason: null },
    });
    await assert.rejects(
      () => assertNoQtyProductionExecutionAllowsProduction(tx, 280),
      (err) => err.code === "WO_EXEC_SHORTFALL_DECISION_REQUIRED" && err.statusCode === 409,
    );
  });

  test("blockProductionExecution from SHORTFALL_PENDING moves to BLOCKED for pause", async () => {
    const { tx, getExecutionStatus } = createFinishMockTx({ plannedQty: 3000, producedQty: 2800 });
    await syncShortfallPendingAfterProductionApprove(tx, 280, 2800);
    await blockProductionExecution(tx, 280, {
      blockReason: "MACHINE_BREAKDOWN",
      remarks: null,
      actorUserId: null,
      actorRole: null,
    });
    assert.equal(getExecutionStatus(), "BLOCKED");
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
    assert.equal(result.successMessage, "WO-280 closed. Remaining 300 qty carried forward.");
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

  test("finishProductionExecution WAIVE_BALANCE closes WO without CarryForwardPending", async () => {
    const { tx, carryForwardRows, auditRows, getExecutionStatus, getWoStatus } = createFinishMockTx();

    const result = await finishProductionExecution(
      tx,
      280,
      { shortfallOutcome: "WAIVE_BALANCE", resolutionReason: "MANAGEMENT_DECISION" },
      { actorUserId: null, actorRole: null },
    );

    assert.equal(result.outcome, "WAIVE_BALANCE");
    assert.equal(result.successMessage, "WO-280 closed. Remaining 300 qty waived/cancelled.");
    assert.equal(getExecutionStatus(), "COMPLETED");
    assert.equal(getWoStatus(), "COMPLETED");
    assert.equal(carryForwardRows.length, 0);
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].resolutionType, "WAIVE_BALANCE");
  });

  test("blockProductionExecution keeps WO open and does not create carry forward", async () => {
    const { tx, carryForwardRows, getExecutionStatus, getWoStatus } = createFinishMockTx({ producedQty: 500 });

    const result = await blockProductionExecution(tx, 280, {
      blockReason: "MACHINE_BREAKDOWN",
      remarks: "Line stopped",
      actorUserId: null,
      actorRole: null,
    });

    assert.equal(result.execution.executionStatus, "BLOCKED");
    assert.equal(getExecutionStatus(), "BLOCKED");
    assert.equal(getWoStatus(), "IN_PROGRESS");
    assert.equal(carryForwardRows.length, 0);
  });

  test("resume then finish with WAIVE_BALANCE closes WO after blocked pause", async () => {
    const { tx, carryForwardRows, getExecutionStatus, getWoStatus } = createFinishMockTx({ producedQty: 1200 });

    await blockProductionExecution(tx, 280, {
      blockReason: "MACHINE_BREAKDOWN",
      remarks: null,
      actorUserId: null,
      actorRole: null,
    });
    assert.equal(getExecutionStatus(), "BLOCKED");

    await resumeProductionExecution(tx, 280, { actorUserId: null, actorRole: null });
    assert.equal(getExecutionStatus(), "RUNNING");

    const result = await finishProductionExecution(
      tx,
      280,
      { shortfallOutcome: "WAIVE_BALANCE", resolutionReason: "CAPACITY_CONSTRAINT" },
      { actorUserId: null, actorRole: null },
    );

    assert.equal(result.outcome, "WAIVE_BALANCE");
    assert.equal(getExecutionStatus(), "COMPLETED");
    assert.equal(getWoStatus(), "COMPLETED");
    assert.equal(carryForwardRows.length, 0);
    assert.equal(result.successMessage, "WO-280 closed. Remaining 300 qty waived/cancelled.");
  });

  test("finishProductionExecution rejects when execution is blocked", async () => {
    const { tx } = createFinishMockTx({ producedQty: 500 });
    await blockProductionExecution(tx, 280, {
      blockReason: "MACHINE_BREAKDOWN",
      remarks: null,
      actorUserId: null,
      actorRole: null,
    });

    await assert.rejects(
      () => finishProductionExecution(tx, 280, {}, { actorUserId: null, actorRole: null }),
      (err) => err.code === "WO_EXEC_BLOCKED" && err.statusCode === 409,
    );
  });

  test("buildFinishSuccessMessage formats waive and carry-forward confirmations", () => {
    assert.equal(
      buildFinishSuccessMessage("WO-26-0004", 4, "WAIVE_BALANCE", 150),
      "WO-26-0004 closed. Remaining 150 qty waived/cancelled.",
    );
    assert.equal(
      buildFinishSuccessMessage("WO-26-0004", 4, "CARRY_FORWARD", 150),
      "WO-26-0004 closed. Remaining 150 qty carried forward.",
    );
  });

  test("production qty above WO remaining is not allowed via remaining helper", () => {
    const planned = 1500;
    const alreadyProduced = 1350;
    const remaining = getWoLineRemainingProductionQty(planned, alreadyProduced);
    assert.equal(remaining, 150);
    assert.ok(151 > remaining);
  });

  test("finishProductionExecution FULL_COMPLETE with surplus records audit and success message", async () => {
    const { tx, auditRows, getExecutionStatus, getWoStatus } = createFinishMockTx({
      plannedQty: 1500,
      producedQty: 1600,
    });

    const result = await finishProductionExecution(tx, 280, {}, { actorUserId: null, actorRole: null });

    assert.equal(result.outcome, "FULL_COMPLETE");
    assert.equal(result.surplusQty, 100);
    assert.equal(result.successMessage, "Production completed successfully. Extra Production: 100 Qty. Work Order WO-280 closed.");
    assert.equal(getExecutionStatus(), "COMPLETED");
    assert.equal(getWoStatus(), "COMPLETED");
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].resolutionType, "SURPLUS_PRODUCTION");
  });

  test("computeExecutionSummary includes surplus when produced exceeds planned", async () => {
    const { tx } = createFinishMockTx({ plannedQty: 1500, producedQty: 1600 });
    const wo = await tx.workOrder.findUnique();
    const summary = await computeExecutionSummary(tx, wo);
    assert.equal(summary.surplusQty, 100);
    assert.equal(summary.remainderQty, 0);
    assert.equal(summary.hasSurplus, true);
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

  test("computeExecutionSummary aggregates approved production into produced and remainder", async () => {
    const { tx } = createFinishMockTx({ plannedQty: 1500, producedQty: 1350 });
    const wo = await tx.workOrder.findUnique();
    const summary = await computeExecutionSummary(tx, wo);
    assert.equal(summary.plannedQty, 1500);
    assert.equal(summary.producedQty, 1350);
    assert.equal(summary.remainderQty, 150);
    assert.equal(summary.hasShortfall, true);
    assert.equal(summary.pendingShortfallResolution, false);
  });

  test("finishProductionExecution WAIVE_BALANCE from BLOCKED paused shortfall closes WO", async () => {
    const { tx, getExecutionStatus, getWoStatus } = createFinishMockTx({ plannedQty: 3000, producedQty: 2800 });
    await syncShortfallPendingAfterProductionApprove(tx, 280, 2800);
    await blockProductionExecution(tx, 280, {
      blockReason: "MACHINE_BREAKDOWN",
      remarks: null,
      actorUserId: null,
      actorRole: null,
    });
    assert.equal(getExecutionStatus(), "BLOCKED");

    const result = await finishProductionExecution(
      tx,
      280,
      { shortfallOutcome: "WAIVE_BALANCE", resolutionReason: "MANAGEMENT_DECISION" },
      { actorUserId: null, actorRole: null },
    );

    assert.equal(result.outcome, "WAIVE_BALANCE");
    assert.equal(getExecutionStatus(), "COMPLETED");
    assert.equal(getWoStatus(), "COMPLETED");
  });

  test("finishProductionExecution rejects auto complete while BLOCKED without shortfall outcome", async () => {
    const { tx } = createFinishMockTx({ plannedQty: 3000, producedQty: 2800 });
    await blockProductionExecution(tx, 280, {
      blockReason: "MACHINE_BREAKDOWN",
      remarks: null,
      actorUserId: null,
      actorRole: null,
    });
    await assert.rejects(
      () => finishProductionExecution(tx, 280, {}, { actorUserId: null, actorRole: null }),
      (err) => err.code === "WO_EXEC_BLOCKED" && err.statusCode === 409,
    );
  });

  test("pause shortfall then resume keeps RUNNING and allows remaining production", async () => {
    const { tx, getExecutionStatus } = createFinishMockTx({ plannedQty: 4000, producedQty: 3800 });
    await syncShortfallPendingAfterProductionApprove(tx, 280, 3800);
    assert.equal(getExecutionStatus(), "SHORTFALL_PENDING");

    await blockProductionExecution(tx, 280, {
      blockReason: "MACHINE_BREAKDOWN",
      remarks: null,
      actorUserId: null,
      actorRole: null,
    });
    assert.equal(getExecutionStatus(), "BLOCKED");

    await resumeProductionExecution(tx, 280, { actorUserId: null, actorRole: null });
    assert.equal(getExecutionStatus(), "RUNNING");

    const wo = await tx.workOrder.findUnique();
    const execAfterReconcile = await reconcileShortfallPendingStatus(tx, wo);
    assert.equal(execAfterReconcile.executionStatus, "RUNNING");
    assert.ok(execAfterReconcile.resumedAt != null);

    const summary = await computeExecutionSummary(tx, { ...wo, productionExecution: execAfterReconcile });
    assert.equal(summary.remainderQty, 200);
    assert.equal(summary.pendingShortfallResolution, false);

    await assert.doesNotReject(() => assertNoQtyProductionExecutionAllowsProduction(tx, 280));
  });

  test("reconcile still promotes legacy RUNNING shortfall without resume timestamp", async () => {
    const { tx, getExecutionStatus } = createFinishMockTx({ plannedQty: 4000, producedQty: 3800 });
    const wo = await tx.workOrder.findUnique();
    const exec = await reconcileShortfallPendingStatus(tx, wo);
    assert.equal(getExecutionStatus(), "SHORTFALL_PENDING");
    assert.equal(exec.executionStatus, "SHORTFALL_PENDING");
  });

  test("computeExecutionSummary exposes pendingShortfallResolution when execution is SHORTFALL_PENDING", async () => {
    const { tx } = createFinishMockTx({ plannedQty: 3000, producedQty: 2800 });
    await syncShortfallPendingAfterProductionApprove(tx, 280, 2800);
    const wo = await tx.workOrder.findUnique();
    wo.productionExecution.executionStatus = "SHORTFALL_PENDING";
    const summary = await computeExecutionSummary(tx, wo);
    assert.equal(summary.pendingShortfallResolution, true);
    assert.equal(summary.remainderQty, 200);
  });

  test("productionExecutionPendingActionLabel maps all execution states", () => {
    assert.equal(productionExecutionPendingActionLabel("NOT_STARTED"), PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED);
    assert.equal(productionExecutionPendingActionLabel("RUNNING"), PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING);
    assert.equal(
      productionExecutionPendingActionLabel("SHORTFALL_PENDING"),
      PRODUCTION_EXECUTION_PENDING_LABELS.SHORTFALL_PENDING,
    );
    assert.equal(productionExecutionPendingActionLabel("BLOCKED"), PRODUCTION_EXECUTION_PENDING_LABELS.BLOCKED);
    assert.equal(productionExecutionPendingActionLabel("COMPLETED"), null);
  });

  test("deriveProductionQueueActionLabel uses execution status for production work", () => {
    assert.equal(
      deriveProductionQueueActionLabel({ nextAction: "PRODUCTION_PENDING", execStatus: "BLOCKED" }),
      PRODUCTION_EXECUTION_PENDING_LABELS.BLOCKED,
    );
    assert.equal(
      deriveProductionQueueActionLabel({ nextAction: "PRODUCTION_PENDING", execStatus: "RUNNING" }),
      PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING,
    );
    assert.equal(deriveProductionQueueActionLabel({ nextAction: "QC_PENDING", execStatus: "RUNNING" }), "Complete QA");
  });
});
