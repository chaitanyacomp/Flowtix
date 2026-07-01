/**
 * @jest-environment node
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildResetTransactionDataCleanupSteps,
  RESET_TRANSACTION_VERIFY_TABLES,
  runFinalTransactionResetSweep,
  runResetTransactionDataInTransaction,
} = require("../../src/routes/adminDatabaseCleanup");

/** @param {Record<string, number>} initial */
function createZeroableMockTx(initial) {
  /** @type {Record<string, number>} */
  const rows = { ...initial };

  const makeModel = (key) => ({
    deleteMany: async () => {
      const deleted = rows[key] ?? 0;
      rows[key] = 0;
      return { count: deleted };
    },
    count: async (args) => {
      if (key === "openingStockEntry" && args?.where?.status === "APPROVED") {
        return rows.openingStockEntryApproved ?? 0;
      }
      if (key === "docSequence" && args?.where?.docType?.in) {
        return rows.docSequenceTransactional ?? 0;
      }
      return rows[key] ?? 0;
    },
    updateMany: async (args) => {
      if (key === "openingStockEntry" && args?.where?.status === "APPROVED") {
        const count = rows.openingStockEntryApproved ?? 0;
        rows.openingStockEntryApproved = 0;
        return { count };
      }
      return { count: 0 };
    },
  });

  /** @type {Record<string, unknown>} */
  const tx = {
    $queryRaw: async () => [{ ok: 1 }],
    salesOrder: {
      ...makeModel("salesOrder"),
      updateMany: async () => ({ count: 0 }),
    },
    stockTransaction: {
      ...makeModel("stockTransaction"),
      updateMany: async () => ({ count: 0 }),
    },
    dispatch: {
      ...makeModel("dispatch"),
      updateMany: async () => ({ count: 0 }),
    },
    qcRejectedDisposition: {
      ...makeModel("qcRejectedDisposition"),
      updateMany: async () => ({ count: 0 }),
    },
    openingStockEntry: {
      deleteMany: async () => ({ count: 0 }),
      count: async (args) => {
        if (args?.where?.status === "APPROVED") return rows.openingStockEntryApproved ?? 0;
        return rows.openingStockEntry ?? 0;
      },
      updateMany: async (args) => {
        if (args?.where?.status === "APPROVED") {
          const count = rows.openingStockEntryApproved ?? 0;
          rows.openingStockEntryApproved = 0;
          return { count };
        }
        return { count: 0 };
      },
    },
    docSequence: {
      deleteMany: async () => {
        const deleted = rows.docSequenceTransactional ?? 0;
        rows.docSequenceTransactional = 0;
        return { count: deleted };
      },
      count: async (args) => {
        if (args?.where?.docType?.in) return rows.docSequenceTransactional ?? 0;
        return rows.docSequence ?? 0;
      },
    },
    qcLegacyRejectedClassification: makeModel("qcLegacyRejectedClassification"),
  };

  for (const step of buildResetTransactionDataCleanupSteps(tx)) {
    const table = step.table;
    if (table === "STORE") {
      if (!tx.dispatch) tx.dispatch = makeModel("dispatch");
      continue;
    }
    if (table === "openingStockEntry:revertApproved") continue;
    const modelKey = table.split(":")[0];
    if (!tx[modelKey]) tx[modelKey] = makeModel(modelKey);
  }

  for (const table of RESET_TRANSACTION_VERIFY_TABLES) {
    const modelKey = table === "dispatch" ? "dispatch" : table;
    if (!tx[modelKey]) tx[modelKey] = makeModel(modelKey);
  }

  return { tx, rows };
}

describe("runResetTransactionDataInTransaction idempotency", () => {
  it("first pass clears all transaction tables; second pass deletes zero rows", async () => {
    /** @type {Record<string, number>} */
    const initial = {};
    for (const step of buildResetTransactionDataCleanupSteps({})) {
      if (step.table === "STORE") {
        initial.dispatch = 4;
        continue;
      }
      if (step.table === "openingStockEntry:revertApproved") {
        initial.openingStockEntryApproved = 2;
        continue;
      }
      initial[step.table] = 3;
    }
    initial.qcLegacyRejectedClassification = 1;
    initial.docSequenceTransactional = 5;
    for (const table of RESET_TRANSACTION_VERIFY_TABLES) {
      if (table === "dispatch") {
        if (initial.dispatch == null) initial.dispatch = 3;
        continue;
      }
      if (initial[table] == null) initial[table] = 2;
    }
    initial.openingStockEntryApproved = 2;

    const { tx, rows } = createZeroableMockTx(initial);

    const summary1 = await runResetTransactionDataInTransaction(tx);
    const deletedFirstPass = summary1.reduce((sum, row) => sum + row.deleted, 0);
    assert.ok(deletedFirstPass > 0, "first pass should delete transactional rows");

    for (const [key, count] of Object.entries(rows)) {
      assert.equal(count, 0, `expected ${key} count 0 after first pass`);
    }

    const summary2 = await runResetTransactionDataInTransaction(tx);
    const deletedSecondPass = summary2.reduce((sum, row) => sum + row.deleted, 0);
    assert.equal(deletedSecondPass, 0, "second pass should delete zero rows");
  });
});

describe("runFinalTransactionResetSweep", () => {
  it("stops after one pass when cleanup steps leave no rows", async () => {
    const { tx } = createZeroableMockTx({ workOrder: 0, stockTransaction: 0 });
    await runFinalTransactionResetSweep(tx, { maxPasses: 3 });
  });
});
