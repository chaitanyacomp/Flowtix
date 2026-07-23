const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseBulkIds,
  emptyBulkResult,
  runBulkIsActiveMutation,
  runBulkHardDelete,
  customerHasBlockingReferences,
  supplierHasBlockingReferences,
} = require("../../src/services/masterBulkMutationService");

function makeActiveFlagDb(seedRows) {
  const rows = seedRows.map((r) => ({ ...r }));
  return {
    rows,
    customer: {
      findMany: async ({ where }) => {
        const ids = where?.id?.in ?? [];
        return rows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, isActive: r.isActive }));
      },
      updateMany: async ({ where, data }) => {
        const ids = where?.id?.in ?? [];
        let count = 0;
        for (const r of rows) {
          if (ids.includes(r.id)) {
            Object.assign(r, data);
            count += 1;
          }
        }
        return { count };
      },
      delete: async ({ where }) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx < 0) {
          const err = new Error("Record to delete does not exist.");
          err.code = "P2025";
          throw err;
        }
        const [removed] = rows.splice(idx, 1);
        return removed;
      },
    },
    $transaction: async (fn) => fn({
      customer: {
        updateMany: async ({ where, data }) => {
          const ids = where?.id?.in ?? [];
          let count = 0;
          for (const r of rows) {
            if (ids.includes(r.id)) {
              Object.assign(r, data);
              count += 1;
            }
          }
          return { count };
        },
      },
    }),
  };
}

function makeDeleteDb({ existingIds, blockedIds = new Set(), p2003Ids = new Set() }) {
  const rows = existingIds.map((id) => ({ id }));
  return {
    customer: {
      findMany: async ({ where }) => {
        const ids = where?.id?.in ?? [];
        return rows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id }));
      },
      delete: async ({ where }) => {
        if (p2003Ids.has(where.id)) {
          const err = new Error("FK");
          err.code = "P2003";
          throw err;
        }
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx < 0) {
          const err = new Error("missing");
          err.code = "P2025";
          throw err;
        }
        rows.splice(idx, 1);
        return { id: where.id };
      },
    },
  };
}

describe("masterBulkMutationService", () => {
  it("parseBulkIds dedupes and validates", () => {
    assert.deepEqual(parseBulkIds({ ids: [3, 1, 3, 2] }), [3, 1, 2]);
    assert.throws(() => parseBulkIds({ ids: [] }));
    assert.throws(() => parseBulkIds({ ids: [0] }));
    assert.throws(() => parseBulkIds({}));
  });

  it("emptyBulkResult has stable shape", () => {
    assert.deepEqual(emptyBulkResult(2), {
      requested: 2,
      changed: [],
      skipped: [],
      blocked: [],
      failed: [],
    });
  });

  it("bulk activate is idempotent for already-active rows", async () => {
    const db = makeActiveFlagDb([
      { id: 1, isActive: true },
      { id: 2, isActive: false },
      { id: 3, isActive: false },
    ]);

    const first = await runBulkIsActiveMutation(db, {
      model: "customer",
      ids: [1, 2, 99],
      isActive: true,
      alreadyReason: "Customer is already active.",
      notFoundReason: "Customer not found.",
    });

    assert.equal(first.requested, 3);
    assert.deepEqual(first.changed, [2]);
    assert.deepEqual(first.skipped, [{ id: 1, reason: "Customer is already active." }]);
    assert.deepEqual(first.failed, [{ id: 99, reason: "Customer not found." }]);
    assert.equal(db.rows.find((r) => r.id === 2).isActive, true);

    const second = await runBulkIsActiveMutation(db, {
      model: "customer",
      ids: [1, 2],
      isActive: true,
      alreadyReason: "Customer is already active.",
      notFoundReason: "Customer not found.",
    });
    assert.deepEqual(second.changed, []);
    assert.equal(second.skipped.length, 2);
  });

  it("bulk delete returns partial results: changed + blocked + failed", async () => {
    const blocked = new Set([2]);
    const db = makeDeleteDb({ existingIds: [1, 2], blockedIds: blocked });

    const result = await runBulkHardDelete(db, {
      model: "customer",
      ids: [1, 2, 3],
      hasBlockingReferences: async (_db, id) => blocked.has(id),
      defaultBlockedReason: "Customer cannot be deleted because it is used in transactions.",
      notFoundReason: "Customer not found.",
    });

    assert.equal(result.requested, 3);
    assert.deepEqual(result.changed, [1]);
    assert.deepEqual(result.blocked, [
      { id: 2, reason: "Customer cannot be deleted because it is used in transactions." },
    ]);
    assert.deepEqual(result.failed, [{ id: 3, reason: "Customer not found." }]);
  });

  it("bulk delete treats late FK P2003 as blocked", async () => {
    const db = makeDeleteDb({ existingIds: [10], p2003Ids: new Set([10]) });
    const result = await runBulkHardDelete(db, {
      model: "customer",
      ids: [10],
      hasBlockingReferences: async () => false,
      defaultBlockedReason: "blocked",
      notFoundReason: "missing",
    });
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.blocked, [{ id: 10, reason: "blocked" }]);
  });

  it("customerHasBlockingReferences is true when any Restrict FK count > 0", async () => {
    const db = {
      enquiry: { count: async () => 0 },
      customerPO: { count: async () => 0 },
      salesOrder: { count: async () => 1 },
      rateContractLine: { count: async () => 0 },
      customerReturn: { count: async () => 0 },
      salesBill: { count: async () => 0 },
    };
    assert.equal(await customerHasBlockingReferences(db, 5), true);
  });

  it("customerHasBlockingReferences is false when unused", async () => {
    const db = {
      enquiry: { count: async () => 0 },
      customerPO: { count: async () => 0 },
      salesOrder: { count: async () => 0 },
      rateContractLine: { count: async () => 0 },
      customerReturn: { count: async () => 0 },
      salesBill: { count: async () => 0 },
    };
    assert.equal(await customerHasBlockingReferences(db, 5), false);
  });

  it("supplierHasBlockingReferences blocks on GRN even without RM PO", async () => {
    const db = {
      rmPurchaseOrder: { count: async () => 0 },
      purchaseBill: { count: async () => 0 },
      grn: { count: async () => 2 },
    };
    assert.equal(await supplierHasBlockingReferences(db, 9), true);
  });

  it("item bulk delete uses dependency summary message when blocked", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const db = {
      item: {
        findMany: async ({ where }) => {
          const ids = where?.id?.in ?? [];
          return rows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id }));
        },
        delete: async ({ where }) => {
          const idx = rows.findIndex((r) => r.id === where.id);
          if (idx < 0) throw Object.assign(new Error("missing"), { code: "P2025" });
          rows.splice(idx, 1);
          return { id: where.id };
        },
      },
    };

    const result = await runBulkHardDelete(db, {
      model: "item",
      ids: [1, 2],
      hasBlockingReferences: async (_db, id) =>
        id === 2
          ? "This item is used in orders, stock, or manufacturing and cannot be deleted."
          : false,
      defaultBlockedReason: "blocked",
      notFoundReason: "Item not found",
    });

    assert.deepEqual(result.changed, [1]);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].id, 2);
    assert.match(result.blocked[0].reason, /cannot be deleted/i);
  });
});
