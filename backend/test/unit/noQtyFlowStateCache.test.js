const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve: resolvePath } = require("node:path");
const { runWithQueryMetrics, getOrSetRequestCache } = require("../../src/utils/prismaQueryMetrics");

const engineSource = readFileSync(
  resolvePath(__dirname, "../../src/services/noQtyWorkflowEngine.js"),
  "utf8",
);

function makeFlowStateDb({ soId, cycleId, orderType = "NO_QTY" }) {
  return {
    salesOrder: {
      findUnique: async ({ where }) =>
        where.id === soId
          ? { id: soId, orderType, currentCycleId: cycleId, internalStatus: "OPEN" }
          : null,
      findMany: async () => [],
    },
    salesOrderCycle: {
      findFirst: async ({ where }) => {
        if (where.id === cycleId && where.salesOrderId === soId) {
          return {
            id: cycleId,
            cycleNo: 1,
            status: "ACTIVE",
            noQtyTreatFgAsOptionalStoreStock: false,
          };
        }
        if (where.salesOrderId === soId && where.status === "ACTIVE") {
          return { id: cycleId };
        }
        return null;
      },
      findMany: async () => [],
    },
    requirementSheet: {
      findMany: async () => [{ id: 1, status: "LOCKED" }],
      findFirst: async ({ where }) => {
        if (where?.salesOrderId === soId && where?.cycleId === cycleId) {
          return { id: 1, status: "LOCKED" };
        }
        if (where?.cycle?.cycleNo?.gt != null) return null;
        return null;
      },
      findUnique: async () => null,
    },
    workOrder: {
      findMany: async ({ where }) =>
        where?.salesOrderId === soId && where?.cycleId === cycleId ? [] : [],
      findFirst: async () => null,
    },
    productionEntry: { findFirst: async () => null, findMany: async () => [] },
    qcEntry: { findFirst: async () => null, findMany: async () => [] },
    dispatch: { findMany: async () => [] },
    salesBill: { findFirst: async () => null },
    qcRejectedDisposition: { count: async () => 0 },
  };
}

describe("no-qty-flow-state FT-PERF-002 regression", () => {
  it("imports normalizePositiveCycleId (prevents loadNoQtyDispatchableFacts ReferenceError)", () => {
    assert.match(engineSource, /require\("\.\.\/utils\/cycleIds"\)/);
    assert.match(engineSource, /normalizePositiveCycleId/);
  });

  it("cache key includes salesOrderId, cycleId, and role", () => {
    assert.match(
      engineSource,
      /no-qty-flow:\$\{soId\}:\$\{Number\.isFinite\(cycleId\) && cycleId > 0 \? cycleId : 0\}:\$\{userRole\}/,
    );
  });
});

describe("resolveNoQtyWorkflowState request cache + cycleId", () => {
  it("returns payload without explicit cycleId", async () => {
    const workflowPath = require.resolve("../../src/services/noQtyWorkflowEngine");
    delete require.cache[workflowPath];
    const { resolveNoQtyWorkflowState } = require("../../src/services/noQtyWorkflowEngine");

    const soId = 199;
    const cycleId = 334;
    const db = makeFlowStateDb({ soId, cycleId });

    const state = await runWithQueryMetrics(() =>
      resolveNoQtyWorkflowState(db, { salesOrderId: soId, cycleId: null, userRole: "ADMIN" }),
    );

    assert.equal(state.salesOrderId, soId);
    assert.equal(typeof state.primaryAction, "string");
  });

  it("returns payload for valid explicit cycleId", async () => {
    const { resolveNoQtyWorkflowState } = require("../../src/services/noQtyWorkflowEngine");
    const soId = 199;
    const cycleId = 334;
    const db = makeFlowStateDb({ soId, cycleId });

    const state = await runWithQueryMetrics(() =>
      resolveNoQtyWorkflowState(db, { salesOrderId: soId, cycleId, userRole: "ADMIN" }),
    );

    assert.equal(state.salesOrderId, soId);
    assert.equal(state.cycleId, cycleId);
    assert.equal(state.canonicalCycleId, cycleId);
  });

  it("falls back safely when cycleId is invalid for the SO", async () => {
    const { resolveNoQtyWorkflowState } = require("../../src/services/noQtyWorkflowEngine");
    const soId = 199;
    const cycleId = 334;
    const db = makeFlowStateDb({ soId, cycleId });

    const state = await runWithQueryMetrics(() =>
      resolveNoQtyWorkflowState(db, { salesOrderId: soId, cycleId: 99999, userRole: "ADMIN" }),
    );

    assert.equal(state.salesOrderId, soId);
    assert.equal(typeof state.primaryAction, "string");
  });

  it("does not cross-contaminate cache between two SOs in the same request", async () => {
    const { resolveNoQtyWorkflowState } = require("../../src/services/noQtyWorkflowEngine");
    const db199 = makeFlowStateDb({ soId: 199, cycleId: 334 });
    const db200 = makeFlowStateDb({ soId: 200, cycleId: 335 });

    const [a, b] = await runWithQueryMetrics(async () => {
      const s199 = await resolveNoQtyWorkflowState(db199, {
        salesOrderId: 199,
        cycleId: 334,
        userRole: "ADMIN",
      });
      const s200 = await resolveNoQtyWorkflowState(db200, {
        salesOrderId: 200,
        cycleId: 335,
        userRole: "ADMIN",
      });
      return [s199, s200];
    });

    assert.equal(a.salesOrderId, 199);
    assert.equal(a.cycleId, 334);
    assert.equal(b.salesOrderId, 200);
    assert.equal(b.cycleId, 335);
  });
});

describe("getOrSetRequestCache failure hygiene", () => {
  it("does not retain rejected promises in the request cache", async () => {
    await runWithQueryMetrics(async () => {
      let attempts = 0;
      await assert.rejects(() =>
        getOrSetRequestCache("fail-once", async () => {
          attempts += 1;
          throw new Error("boom");
        }),
      );
      const value = await getOrSetRequestCache("fail-once", async () => {
        attempts += 1;
        return "ok";
      });
      assert.equal(value, "ok");
      assert.equal(attempts, 2);
    });
  });
});
