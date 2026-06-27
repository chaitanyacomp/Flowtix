/**
 * @jest-environment node
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductionExecutionCleanupSteps,
  buildResetTransactionDataCleanupSteps,
  deleteProductionExecutionForScope,
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

describe("buildResetTransactionDataCleanupSteps", () => {
  it("includes P16 execution cleanup before workOrderLine", () => {
    const names = buildResetTransactionDataCleanupSteps({}).map((s) => s.table);
    const cfIdx = names.indexOf("carryForwardPending");
    const resolutionIdx = names.indexOf("productionShortfallResolution");
    const execIdx = names.indexOf("workOrderProductionExecution");
    const woLineIdx = names.indexOf("workOrderLine");
    const woIdx = names.indexOf("workOrder");

    assert.ok(cfIdx >= 0, "carryForwardPending step present");
    assert.ok(resolutionIdx > cfIdx, "shortfall audit after carry-forward");
    assert.ok(execIdx > resolutionIdx, "production execution after shortfall audit");
    assert.ok(woLineIdx > execIdx, "workOrderLine after P16 tables");
    assert.ok(woIdx > woLineIdx, "workOrder after workOrderLine");
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
