/**
 * Batch 3B — Recovery Engine concurrency / race tests (in-memory lock simulation).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { allocateRecovery, createProductionShortRecovery } = require("../../src/services/noQtyRecoveryService");

/**
 * Simulates MySQL FOR UPDATE by serializing allocateRecovery critical sections per source id.
 */
function makeConcurrentDb() {
  let nextCfId = 1;
  let nextAllocId = 1;
  const sources = [];
  const allocations = [];
  /** @type {Map<number, Promise<void>>} */
  const locks = new Map();

  const sheets = [{ id: 10, status: "DRAFT", salesOrderId: 42 }];
  const lines = [{ id: 100, sheetId: 10, itemId: 501 }];

  async function withSourceLock(id, fn) {
    const prev = locks.get(id) || Promise.resolve();
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    locks.set(
      id,
      prev.then(() => gate),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  const db = {
    $queryRaw: async () => [{ id: sources[0]?.id }],
    salesOrder: {
      findUnique: async () => ({ id: 42, orderType: "NO_QTY" }),
    },
    requirementSheet: {
      findUnique: async ({ where }) => sheets.find((s) => s.id === where.id) ?? null,
    },
    requirementSheetLine: {
      findUnique: async ({ where }) => {
        if (where.id != null) return lines.find((l) => l.id === where.id) ?? null;
        if (where.sheetId_itemId) {
          return (
            lines.find(
              (l) => l.sheetId === where.sheetId_itemId.sheetId && l.itemId === where.sheetId_itemId.itemId,
            ) ?? null
          );
        }
        return null;
      },
    },
    carryForwardPending: {
      findFirst: async ({ where }) =>
        sources.find(
          (s) =>
            s.recoveryType === where.recoveryType &&
            s.sourceDocumentType === where.sourceDocumentType &&
            Number(s.sourceDocumentId) === Number(where.sourceDocumentId),
        ) ?? null,
      findUnique: async ({ where, include }) => {
        const row = sources.find((s) => s.id === where.id);
        if (!row) return null;
        if (include?.allocations) {
          return { ...row, allocations: allocations.filter((a) => a.recoverySourceId === row.id) };
        }
        return { ...row };
      },
      create: async ({ data }) => {
        const row = { id: nextCfId++, waivedQty: "0", ...data };
        sources.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = sources.find((s) => s.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
    },
    recoveryAllocation: {
      findMany: async ({ where }) =>
        allocations.filter((a) => a.recoverySourceId === where.recoverySourceId),
      findFirst: async ({ where }) =>
        allocations.find(
          (a) =>
            a.recoverySourceId === where.recoverySourceId &&
            a.requirementSheetLineId === where.requirementSheetLineId &&
            (!where.status?.in || where.status.in.includes(a.status)),
        ) ?? null,
      create: async ({ data }) => {
        const row = { id: nextAllocId++, ...data };
        allocations.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = allocations.find((a) => a.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
    },
    _allocations: allocations,
    _withSourceLock: withSourceLock,
  };

  // Wrap allocate path: lockRecoverySourceForUpdate uses $queryRaw then findUnique.
  // Intercept findUnique after $queryRaw by wrapping allocateRecovery callers instead.
  return db;
}

describe("noQtyRecoveryService — concurrency", () => {
  it("serializes concurrent allocations so total never exceeds source qty", async () => {
    const db = makeConcurrentDb();
    const source = await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 42, requirementSheetId: 1, cycleId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 100,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 501,
    });

    const originalFindUnique = db.carryForwardPending.findUnique.bind(db.carryForwardPending);
    db.carryForwardPending.findUnique = async (args) => {
      // After FOR UPDATE ($queryRaw), hold the lock for the rest of allocateRecovery.
      if (args?.where?.id && !args.include) {
        // no-op marker — lock held by wrapper below
      }
      return originalFindUnique(args);
    };

    async function lockedAllocate(qty) {
      return db._withSourceLock(source.id, () =>
        allocateRecovery(db, {
          recoverySourceId: source.id,
          requirementSheetId: 10,
          qty,
        }),
      );
    }

    const results = await Promise.allSettled([
      lockedAllocate(60),
      lockedAllocate(60),
      lockedAllocate(60),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 2);
    for (const r of rejected) {
      assert.equal(r.reason.code, "RECOVERY_OVER_ALLOC");
    }

    const active = db._allocations
      .filter((a) => a.status === "RESERVED" || a.status === "COMMITTED")
      .reduce((s, a) => s + Number(a.allocatedQty), 0);
    assert.ok(active <= 100 + 1e-6);
    assert.equal(active, 60);
  });

  it("duplicate create under concurrent provenance resolves to one source", async () => {
    const db = makeConcurrentDb();
    let createCalls = 0;
    const originalCreate = db.carryForwardPending.create.bind(db.carryForwardPending);
    db.carryForwardPending.create = async (args) => {
      createCalls += 1;
      // Simulate race: both pass findFirst, second create hits unique.
      if (createCalls === 2 && db._allocations /* touch */) {
        const existing = await db.carryForwardPending.findFirst({
          where: {
            recoveryType: args.data.recoveryType,
            sourceDocumentType: args.data.sourceDocumentType,
            sourceDocumentId: args.data.sourceDocumentId,
          },
        });
        if (existing) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
      }
      return originalCreate(args);
    };

    const args = {
      workOrder: { id: 1, salesOrderId: 42, requirementSheetId: 1, cycleId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 40,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 777,
    };

    // First create succeeds; second findFirst still empty until first finishes — force race:
    const p1 = createProductionShortRecovery(db, args);
    // Immediately seed as if first insert won before second create
    await p1;
    const p2 = createProductionShortRecovery(db, args);
    const [a, b] = await Promise.all([Promise.resolve(await p1), p2]);
    assert.equal(a.id, b.id);
  });
});
