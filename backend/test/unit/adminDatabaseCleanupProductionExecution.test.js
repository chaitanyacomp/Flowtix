/**
 * @jest-environment node
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductionExecutionCleanupSteps,
  buildProductionReportCleanupSteps,
  buildResetTransactionDataCleanupSteps,
  deleteProductionExecutionForScope,
  deleteProductionReportsForWorkOrders,
} = require("../../src/routes/adminDatabaseCleanup");
const { NO_QTY_RECOVERY_CLEANUP_TABLES } = require("../../src/services/noQtyRecoveryCleanupService");

describe("buildProductionExecutionCleanupSteps", () => {
  it("deletes recovery children before carry-forward, shortfall, and production execution", () => {
    const steps = buildProductionExecutionCleanupSteps({});
    assert.deepEqual(
      steps.map((s) => s.table),
      [...NO_QTY_RECOVERY_CLEANUP_TABLES, "workOrderProductionExecution"],
    );
  });
});

describe("buildProductionReportCleanupSteps", () => {
  it("deletes return pending and report lines before production reports", () => {
    const steps = buildProductionReportCleanupSteps({});
    assert.deepEqual(
      steps.map((s) => s.table),
      ["productionRmReturnPending", "productionWorkOrderReportLine", "productionWorkOrderReport"],
    );
  });
});

describe("buildResetTransactionDataCleanupSteps", () => {
  it("includes P16 execution and production report cleanup before workOrderLine", () => {
    const names = buildResetTransactionDataCleanupSteps({}).map((s) => s.table);
    const raIdx = names.indexOf("recoveryAllocation");
    const cfIdx = names.indexOf("carryForwardPending");
    const resolutionIdx = names.indexOf("productionShortfallResolution");
    const execIdx = names.indexOf("workOrderProductionExecution");
    const returnPendingIdx = names.indexOf("productionRmReturnPending");
    const reportLineIdx = names.indexOf("productionWorkOrderReportLine");
    const reportIdx = names.indexOf("productionWorkOrderReport");
    const minIdx = names.indexOf("materialIssueNote");
    const mrnIdx = names.indexOf("materialReturnNote");
    const allocationIdx = names.indexOf("materialAllocation");
    const pmrIdx = names.indexOf("productionMaterialRequest");
    const woLineIdx = names.indexOf("workOrderLine");
    const woIdx = names.indexOf("workOrder");
    const stockIdx = names.indexOf("stockTransaction");
    const rmPoIdx = names.indexOf("rmPurchaseOrder");
    const mppIdx = names.indexOf("monthlyProductionPlan");
    const rsLineIdx = names.indexOf("requirementSheetLine");

    assert.ok(raIdx >= 0, "recoveryAllocation step present");
    assert.ok(cfIdx >= 0, "carryForwardPending step present");
    assert.ok(raIdx < cfIdx, "recoveryAllocation before carryForwardPending");
    assert.ok(returnPendingIdx >= 0, "production return pending step present");
    assert.ok(reportLineIdx > returnPendingIdx, "production report lines after return pending");
    assert.ok(reportIdx > reportLineIdx, "production report after report lines");
    assert.ok(resolutionIdx > cfIdx, "shortfall audit after carry-forward");
    assert.ok(execIdx > resolutionIdx, "production execution after shortfall audit");
    assert.ok(minIdx > reportIdx, "material issue notes after production reports");
    assert.ok(allocationIdx > minIdx, "material allocation after material issue notes");
    assert.ok(allocationIdx < pmrIdx, "material allocation before PMR");
    assert.ok(mrnIdx > returnPendingIdx, "material return notes after production return pending");
    assert.ok(woLineIdx > execIdx, "workOrderLine after P16 execution tables");
    assert.ok(woLineIdx > reportIdx, "workOrderLine after production report tables");
    assert.ok(woIdx > woLineIdx, "workOrder after workOrderLine");
    assert.ok(cfIdx < rsLineIdx, "carry-forward before requirement sheet lines");
    assert.ok(mppIdx > names.indexOf("materialRequirement"), "monthly plans after material requirements");
    assert.ok(stockIdx > rmPoIdx, "stock ledger wiped after RM PO");
  });
});

describe("deleteProductionExecutionForScope", () => {
  it("scopes deletes to NO_QTY sales orders and work orders", async () => {
    const deleted = [];
    const db = {
      $queryRaw: async () => [{ ok: 1 }],
      recoveryAllocation: {
        deleteMany: async (args) => {
          deleted.push(["recoveryAllocation", args]);
          return { count: 1 };
        },
      },
      noQtySoWaiverLine: {
        deleteMany: async (args) => {
          deleted.push(["noQtySoWaiverLine", args]);
          return { count: 0 };
        },
      },
      noQtySoWaiver: {
        deleteMany: async (args) => {
          deleted.push(["noQtySoWaiver", args]);
          return { count: 0 };
        },
      },
      carryForwardPending: {
        deleteMany: async (args) => {
          deleted.push(["carryForwardPending", args]);
          return { count: 2 };
        },
      },
      productionShortfallResolution: {
        deleteMany: async (args) => {
          deleted.push(["productionShortfallResolution", args]);
          return { count: 1 };
        },
      },
      workOrderProductionExecution: {
        deleteMany: async (args) => {
          deleted.push(["workOrderProductionExecution", args]);
          return { count: 1 };
        },
      },
    };
    const counts = {};
    await deleteProductionExecutionForScope(db, counts, {
      salesOrderIds: [10, 20],
      workOrderIds: [100],
    });
    assert.equal(counts.carryForwardPending, 2);
    assert.equal(counts.recoveryAllocation, 1);
    assert.deepEqual(deleted.find((d) => d[0] === "carryForwardPending")?.[1], {
      where: { salesOrderId: { in: [10, 20] } },
    });
    assert.deepEqual(deleted.find((d) => d[0] === "workOrderProductionExecution")?.[1], {
      where: { workOrderId: { in: [100] } },
    });
  });
});

describe("deleteProductionReportsForWorkOrders", () => {
  it("scopes report deletes to work orders", async () => {
    const deleted = [];
    const db = {
      productionWorkOrderReport: {
        findMany: async () => [{ id: 5 }],
        deleteMany: async (args) => {
          deleted.push(["productionWorkOrderReport", args]);
          return { count: 1 };
        },
      },
      productionRmReturnPending: {
        deleteMany: async (args) => {
          deleted.push(["productionRmReturnPending", args]);
          return { count: 1 };
        },
      },
      productionWorkOrderReportLine: {
        deleteMany: async (args) => {
          deleted.push(["productionWorkOrderReportLine", args]);
          return { count: 2 };
        },
      },
    };
    const counts = {};
    await deleteProductionReportsForWorkOrders(db, counts, { workOrderIds: [100] });
    assert.equal(counts.productionRmReturnPending, 1);
    assert.equal(counts.productionWorkOrderReportLine, 2);
    assert.equal(counts.productionWorkOrderReport, 1);
  });
});
