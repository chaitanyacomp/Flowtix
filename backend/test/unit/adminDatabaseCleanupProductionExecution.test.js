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

describe("buildProductionExecutionCleanupSteps", () => {
  it("deletes carry-forward before shortfall audit and production execution", () => {
    const steps = buildProductionExecutionCleanupSteps({});
    assert.deepEqual(
      steps.map((s) => s.table),
      ["carryForwardPending", "productionShortfallResolution", "workOrderProductionExecution"],
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

    assert.ok(cfIdx >= 0, "carryForwardPending step present");
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
    assert.ok(mppIdx > names.indexOf("materialRequirement"), "monthly plans after material requirements");
    assert.ok(stockIdx > rmPoIdx, "stock ledger wiped after RM PO");
  });
});

describe("deleteProductionExecutionForScope", () => {
  it("scopes deletes to NO_QTY sales orders and work orders", async () => {
    const deleted = [];
    const tx = {
      $queryRaw: async () => [{ ok: 1 }],
      carryForwardPending: {
        deleteMany: async (args) => {
          deleted.push(["carryForwardPending", args]);
          return { count: 2 };
        },
      },
      productionShortfallResolution: {
        deleteMany: async (args) => {
          deleted.push(["productionShortfallResolution", args]);
          return { count: 3 };
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
    await deleteProductionExecutionForScope(tx, counts, {
      salesOrderIds: [10, 11],
      workOrderIds: [280, 283],
    });

    assert.equal(counts.carryForwardPending, 2);
    assert.equal(counts.productionShortfallResolution, 3);
    assert.equal(counts.workOrderProductionExecution, 1);
    assert.deepEqual(deleted[0][1], { where: { salesOrderId: { in: [10, 11] } } });
    assert.deepEqual(deleted[1][1], { where: { workOrderId: { in: [280, 283] } } });
    assert.deepEqual(deleted[2][1], { where: { workOrderId: { in: [280, 283] } } });
  });
});

describe("deleteProductionReportsForWorkOrders", () => {
  it("scopes deletes to production reports for the target work orders", async () => {
    const deleted = [];
    const tx = {
      productionWorkOrderReport: {
        findMany: async (args) => {
          assert.deepEqual(args, {
            where: { workOrderId: { in: [280, 283] } },
            select: { id: true },
          });
          return [{ id: 501 }, { id: 502 }];
        },
        deleteMany: async (args) => {
          deleted.push(["productionWorkOrderReport", args]);
          return { count: 2 };
        },
      },
      productionRmReturnPending: {
        deleteMany: async (args) => {
          deleted.push(["productionRmReturnPending", args]);
          return { count: 3 };
        },
      },
      productionWorkOrderReportLine: {
        deleteMany: async (args) => {
          deleted.push(["productionWorkOrderReportLine", args]);
          return { count: 4 };
        },
      },
    };

    const counts = {};
    await deleteProductionReportsForWorkOrders(tx, counts, { workOrderIds: [280, 283] });

    assert.equal(counts.productionRmReturnPending, 3);
    assert.equal(counts.productionWorkOrderReportLine, 4);
    assert.equal(counts.productionWorkOrderReport, 2);
    assert.deepEqual(deleted[0][1], {
      where: {
        OR: [{ workOrderId: { in: [280, 283] } }, { productionReportId: { in: [501, 502] } }],
      },
    });
    assert.deepEqual(deleted[1][1], { where: { productionReportId: { in: [501, 502] } } });
    assert.deepEqual(deleted[2][1], { where: { id: { in: [501, 502] } } });
  });
});
