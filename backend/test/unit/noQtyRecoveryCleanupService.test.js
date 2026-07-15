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
      "noQtyRsItemRecoveryDecisionLine",
      "noQtyRsItemRecoveryDecision",
      "recoveryAllocation",
      "noQtySoWaiverLine",
      "noQtySoWaiver",
      "noQtyAcceptedFgDisposition",
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
      noQtyRsItemRecoveryDecisionLine: {
        deleteMany: async () => {
          order.push("noQtyRsItemRecoveryDecisionLine");
          return { count: 1 };
        },
      },
      noQtyRsItemRecoveryDecision: {
        deleteMany: async () => {
          order.push("noQtyRsItemRecoveryDecision");
          return { count: 1 };
        },
      },
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
      noQtyAcceptedFgDisposition: {
        deleteMany: async () => {
          order.push("noQtyAcceptedFgDisposition");
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
    assert.equal(counts.noQtyRsItemRecoveryDecisionLine, 1);
    assert.equal(counts.carryForwardPending, 2);
  });

  it("scoped cleanup passes salesOrder predicates to child deletes", async () => {
    /** @type {Record<string, object>} */
    const wheres = {};
    const tx = {
      $queryRaw: async () => [{ ok: 1 }],
      noQtyRsItemRecoveryDecisionLine: {
        deleteMany: async (args) => {
          wheres.noQtyRsItemRecoveryDecisionLine = args?.where ?? null;
          return { count: 1 };
        },
      },
      noQtyRsItemRecoveryDecision: {
        deleteMany: async (args) => {
          wheres.noQtyRsItemRecoveryDecision = args?.where ?? null;
          return { count: 1 };
        },
      },
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
      noQtyAcceptedFgDisposition: {
        deleteMany: async (args) => {
          wheres.noQtyAcceptedFgDisposition = args?.where ?? null;
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
    assert.ok(wheres.noQtyRsItemRecoveryDecisionLine?.OR);
    assert.ok(wheres.recoveryAllocation?.OR);
    assert.equal(wheres.noQtySoWaiver.salesOrderId.in[0], 224);
    assert.equal(wheres.noQtyAcceptedFgDisposition.salesOrderId.in[0], 224);
    assert.equal(wheres.carryForwardPending.salesOrderId.in[0], 224);
    assert.equal(wheres.productionShortfallResolution.workOrderId.in[0], 464);
  });
});

describe("buildProductionExecutionCleanupSteps", () => {
  it("places recovery children before carry-forward and WO execution", () => {
    const names = buildProductionExecutionCleanupSteps({}).map((s) => s.table);
    assert.deepEqual(names.slice(0, NO_QTY_RECOVERY_CLEANUP_TABLES.length), [...NO_QTY_RECOVERY_CLEANUP_TABLES]);
    assert.equal(names[names.length - 1], "workOrderProductionExecution");
    const cfIdx = names.indexOf("carryForwardPending");
    const lineIdx = names.indexOf("noQtyRsItemRecoveryDecisionLine");
    const raIdx = names.indexOf("recoveryAllocation");
    const waiverLineIdx = names.indexOf("noQtySoWaiverLine");
    assert.ok(lineIdx < cfIdx);
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
    const emptyMany = (name) => ({
      deleteMany: async (args) => {
        deleted.push([name, args]);
        return { count: name === "carryForwardPending" ? 2 : 1 };
      },
    });
    const tx = {
      $queryRaw: async () => [{ ok: 1 }],
      noQtyRsItemRecoveryDecisionLine: emptyMany("noQtyRsItemRecoveryDecisionLine"),
      noQtyRsItemRecoveryDecision: emptyMany("noQtyRsItemRecoveryDecision"),
      recoveryAllocation: emptyMany("recoveryAllocation"),
      noQtySoWaiverLine: emptyMany("noQtySoWaiverLine"),
      noQtySoWaiver: emptyMany("noQtySoWaiver"),
      noQtyAcceptedFgDisposition: emptyMany("noQtyAcceptedFgDisposition"),
      carryForwardPending: emptyMany("carryForwardPending"),
      productionShortfallResolution: emptyMany("productionShortfallResolution"),
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

    assert.equal(deleted[0][0], "noQtyRsItemRecoveryDecisionLine");
    const cfStep = deleted.find((d) => d[0] === "carryForwardPending");
    assert.ok(cfStep);
    assert.deepEqual(cfStep[1], { where: { salesOrderId: { in: [10, 20] } } });
    assert.equal(counts.carryForwardPending, 2);
    assert.equal(counts.noQtyRsItemRecoveryDecisionLine, 1);
    assert.equal(counts.workOrderProductionExecution, 1);
  });
});
