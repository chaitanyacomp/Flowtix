/**
 * @jest-environment node
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  NO_QTY_RECOVERY_CLEANUP_TABLES,
  buildNoQtyRecoveryDependencyCleanupSteps,
  cleanupNoQtyRecoveryDependencies,
} = require("../../src/services/noQtyRecoveryCleanupService");
const {
  buildProductionExecutionCleanupSteps,
  buildResetTransactionDataCleanupSteps,
  deleteProductionExecutionForScope,
  RESET_TRANSACTION_VERIFY_TABLES,
} = require("../../src/routes/adminDatabaseCleanup");

describe("noQtyRecoveryCleanupService", () => {
  it("exposes reverse-FK table order", () => {
    assert.deepEqual([...NO_QTY_RECOVERY_CLEANUP_TABLES], [
      "recoveryAllocation",
      "noQtySoWaiverLine",
      "noQtySoWaiver",
      "carryForwardPending",
      "productionShortfallResolution",
    ]);
  });

  it("buildNoQtyRecoveryDependencyCleanupSteps follows child-first order", () => {
    const steps = buildNoQtyRecoveryDependencyCleanupSteps({});
    assert.deepEqual(
      steps.map((s) => s.table),
      [...NO_QTY_RECOVERY_CLEANUP_TABLES],
    );
  });

  it("cleanupNoQtyRecoveryDependencies deletes children before carry-forward", async () => {
    const order = [];
    const tx = {
      $queryRaw: async () => [{ ok: 1 }],
      recoveryAllocation: {
        deleteMany: async () => {
          order.push("recoveryAllocation");
          return { count: 1 };
        },
      },
      noQtySoWaiverLine: {
        deleteMany: async () => {
          order.push("noQtySoWaiverLine");
          return { count: 1 };
        },
      },
      noQtySoWaiver: {
        deleteMany: async () => {
          order.push("noQtySoWaiver");
          return { count: 1 };
        },
      },
      carryForwardPending: {
        deleteMany: async () => {
          order.push("carryForwardPending");
          return { count: 2 };
        },
      },
      productionShortfallResolution: {
        deleteMany: async () => {
          order.push("productionShortfallResolution");
          return { count: 1 };
        },
      },
    };

    const counts = await cleanupNoQtyRecoveryDependencies(tx, {});
    assert.deepEqual(order, [...NO_QTY_RECOVERY_CLEANUP_TABLES]);
    assert.equal(counts.recoveryAllocation, 1);
    assert.equal(counts.carryForwardPending, 2);
  });

  it("scoped cleanup passes salesOrder predicates to child deletes", async () => {
    /** @type {Record<string, object>} */
    const wheres = {};
    const tx = {
      $queryRaw: async () => [{ ok: 1 }],
      recoveryAllocation: {
        deleteMany: async (args) => {
          wheres.recoveryAllocation = args?.where ?? null;
          return { count: 1 };
        },
      },
      noQtySoWaiverLine: {
        deleteMany: async (args) => {
          wheres.noQtySoWaiverLine = args?.where ?? null;
          return { count: 1 };
        },
      },
      noQtySoWaiver: {
        deleteMany: async (args) => {
          wheres.noQtySoWaiver = args?.where ?? null;
          return { count: 1 };
        },
      },
      carryForwardPending: {
        deleteMany: async (args) => {
          wheres.carryForwardPending = args?.where ?? null;
          return { count: 1 };
        },
      },
      productionShortfallResolution: {
        deleteMany: async (args) => {
          wheres.productionShortfallResolution = args?.where ?? null;
          return { count: 0 };
        },
      },
    };

    await cleanupNoQtyRecoveryDependencies(tx, { salesOrderIds: [224], workOrderIds: [464] });
    assert.ok(wheres.recoveryAllocation?.OR);
    assert.equal(wheres.noQtySoWaiver.salesOrderId.in[0], 224);
    assert.equal(wheres.carryForwardPending.salesOrderId.in[0], 224);
    assert.equal(wheres.productionShortfallResolution.workOrderId.in[0], 464);
  });
});

describe("buildProductionExecutionCleanupSteps", () => {
  it("places recovery children before carry-forward and WO execution", () => {
    const names = buildProductionExecutionCleanupSteps({}).map((s) => s.table);
    assert.deepEqual(names.slice(0, 5), [...NO_QTY_RECOVERY_CLEANUP_TABLES]);
    assert.equal(names[names.length - 1], "workOrderProductionExecution");
    const cfIdx = names.indexOf("carryForwardPending");
    const raIdx = names.indexOf("recoveryAllocation");
    const waiverLineIdx = names.indexOf("noQtySoWaiverLine");
    assert.ok(raIdx < cfIdx);
    assert.ok(waiverLineIdx < cfIdx);
  });
});

describe("buildResetTransactionDataCleanupSteps", () => {
  it("includes recovery allocation before carry-forward and before requirement sheets", () => {
    const names = buildResetTransactionDataCleanupSteps({}).map((s) => s.table);
    const raIdx = names.indexOf("recoveryAllocation");
    const cfIdx = names.indexOf("carryForwardPending");
    const rsLineIdx = names.indexOf("requirementSheetLine");
    const woIdx = names.indexOf("workOrder");
    assert.ok(raIdx >= 0);
    assert.ok(raIdx < cfIdx);
    assert.ok(cfIdx < rsLineIdx);
    assert.ok(cfIdx < woIdx);
  });
});

describe("RESET_TRANSACTION_VERIFY_TABLES", () => {
  it("includes recovery and waiver tables", () => {
    for (const table of NO_QTY_RECOVERY_CLEANUP_TABLES) {
      assert.ok(RESET_TRANSACTION_VERIFY_TABLES.includes(table), `missing ${table}`);
    }
  });
});

describe("deleteProductionExecutionForScope", () => {
  it("scopes recovery cleanup then WO execution", async () => {
    const deleted = [];
    const counts = {};
    const tx = {
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
          return { count: 1 };
        },
      },
      noQtySoWaiver: {
        deleteMany: async (args) => {
          deleted.push(["noQtySoWaiver", args]);
          return { count: 1 };
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

    await deleteProductionExecutionForScope(tx, counts, {
      salesOrderIds: [10, 20],
      workOrderIds: [100],
    });

    assert.equal(deleted[0][0], "recoveryAllocation");
    assert.equal(deleted[3][0], "carryForwardPending");
    assert.deepEqual(deleted[3][1], { where: { salesOrderId: { in: [10, 20] } } });
    assert.equal(counts.carryForwardPending, 2);
    assert.equal(counts.recoveryAllocation, 1);
    assert.equal(counts.workOrderProductionExecution, 1);
  });
});
