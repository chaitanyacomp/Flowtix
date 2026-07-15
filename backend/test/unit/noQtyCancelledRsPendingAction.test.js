const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeStoreCreateNextRsPendingEligibility,
} = require("../../src/services/noQtyCreateNextRsEligibility");
const {
  fetchStoreNoQtyCreateNextRsPendingActions,
} = require("../../src/services/pendingActionsService");

function dbFor({ status = "CANCELLED", version = 1, closed = false } = {}) {
  const activeRow = status ? { id: 101, status, version, docNo: `RS-${version}`, updatedAt: new Date("2026-07-15") } : null;
  return {
    salesOrder: {
      findUnique: async () => ({ orderType: "NO_QTY", internalStatus: closed ? "CLOSED" : "OPEN", currentCycleId: 9 }),
      findMany: async () => closed ? [] : [{ id: 7, docNo: "SO-7", updatedAt: new Date("2026-07-15"), currentCycleId: 9 }],
    },
    salesOrderCycle: {
      findFirst: async ({ where }) => where.status === "ACTIVE" ? { id: 9, cycleNo: 1 } : null,
    },
    requirementSheet: {
      findMany: async () => [],
      findFirst: async ({ where }) => {
        if (where.status?.not === "CANCELLED") return activeRow?.status === "CANCELLED" ? null : activeRow;
        if (where.status === "CANCELLED") return activeRow?.status === "CANCELLED" ? activeRow : null;
        if (where.status === "LOCKED") return activeRow?.status === "LOCKED" ? activeRow : null;
        return activeRow;
      },
    },
    workOrder: { findMany: async () => [], findFirst: async () => null },
  };
}

describe("cancelled NO_QTY RS Store creation obligation", () => {
  it("A/C/D. cancelled RS is audit-only and yields same-cycle next version", async () => {
    const result = await computeStoreCreateNextRsPendingEligibility(dbFor({ status: "CANCELLED", version: 4 }), 7);
    assert.equal(result.eligible, true);
    assert.equal(result.resolution, "SAME_CYCLE_CANCELLED_REPLACEMENT");
    assert.equal(result.targetCycleId, 9);
    assert.equal(result.targetCycleNo, 1);
    assert.equal(result.targetVersion, 5);
  });

  it("A. emits exactly one Create Requirement Sheet action with direct same-cycle navigation", async () => {
    const actions = await fetchStoreNoQtyCreateNextRsPendingActions(dbFor());
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Create Requirement Sheet");
    assert.match(actions[0].href, /^\/sales-orders\/7\/requirement-sheets\?/);
    assert.match(actions[0].href, /intent=add/);
    assert.match(actions[0].href, /cycleId=9/);
    assert.doesNotMatch(actions[0].href, /create-next-rs/);
  });

  it("B. cancelled history plus a replacement draft emits no duplicate action", async () => {
    const actions = await fetchStoreNoQtyCreateNextRsPendingActions(dbFor({ status: "DRAFT", version: 2 }));
    assert.equal(actions.length, 0);
  });

  it("F. closed SO emits no Create RS action", async () => {
    const eligibility = await computeStoreCreateNextRsPendingEligibility(dbFor({ closed: true }), 7);
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.reason, "SO_CLOSED");
    assert.deepEqual(await fetchStoreNoQtyCreateNextRsPendingActions(dbFor({ closed: true })), []);
  });

  it("E. Sales Order Next RS readiness uses the same same-cycle replacement resolution", async () => {
    const dispatchPath = require.resolve("../../src/routes/dispatch");
    const executionPath = require.resolve("../../src/services/requirementSheetExecutionService");
    const enginePath = require.resolve("../../src/services/noQtyWorkflowEngine");
    const dispatch = require(dispatchPath);
    const execution = require(executionPath);
    const originalQcMap = dispatch.loadNoQtyCycleQcAcceptedMap;
    const originalPlacement = execution.assessNoQtyPlacementStageForCycle;
    dispatch.loadNoQtyCycleQcAcceptedMap = async () => new Map();
    execution.assessNoQtyPlacementStageForCycle = async () => ({ readyToPlaceWo: false });
    delete require.cache[enginePath];

    const db = dbFor({ status: "CANCELLED", version: 3 });
    db.salesOrder.findUnique = async () => ({ id: 7, orderType: "NO_QTY", internalStatus: "OPEN", currentCycleId: 9 });
    db.salesOrderCycle.findMany = async () => [];
    db.requirementSheet.findMany = async () => [{ id: 101, status: "CANCELLED" }];
    db.workOrder.findMany = async () => [];
    db.productionEntry = { findFirst: async () => null, findMany: async () => [] };
    db.qcEntry = { findFirst: async () => null, findMany: async () => [] };
    db.dispatch = { findMany: async () => [] };
    db.salesBill = { findFirst: async () => null };
    db.qcRejectedDisposition = { count: async () => 0 };

    try {
      const { resolveNoQtyWorkflowState } = require(enginePath);
      const state = await resolveNoQtyWorkflowState(db, { salesOrderId: 7, cycleId: 9, userRole: "STORE" });
      assert.equal(state.createNextRsEligible, true);
      assert.equal(state.requirementExists, false);
      assert.equal(state.requirementLocked, false);
      assert.equal(state.requirementSheetCreationResolution, "SAME_CYCLE_CANCELLED_REPLACEMENT");
      assert.equal(state.requirementSheetTargetCycleId, 9);
      assert.equal(state.requirementSheetTargetVersion, 4);
      assert.match(state.actionHref, /cycleId=9/);
    } finally {
      dispatch.loadNoQtyCycleQcAcceptedMap = originalQcMap;
      execution.assessNoQtyPlacementStageForCycle = originalPlacement;
      delete require.cache[enginePath];
    }
  });
});
