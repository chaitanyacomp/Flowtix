const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertNoLockedOrCancelledSheetForCyclePeriod,
  evaluateRequirementSheetCancellation,
  RequirementSheetLifecycleError,
  cycleLockedCreateMessage,
  RS_LIFECYCLE_MESSAGES,
} = require("../../src/services/requirementSheetLifecycleService");

function mockTx(overrides = {}) {
  return {
    salesOrderCycle: {
      findUnique: async ({ where }) => {
        if (where.id === 10) return { cycleNo: 1 };
        if (where.id === 20) return { cycleNo: 2 };
        return null;
      },
    },
    requirementSheet: {
      findFirst: async ({ where }) => {
        if (where.status === "LOCKED" && where.cycleId === 10) {
          return { id: 100, docNo: "RS-26-0100" };
        }
        if (where.status === "CANCELLED" && where.cycleId === 11) {
          return { id: 101 };
        }
        return null;
      },
      ...overrides.requirementSheet,
    },
    ...overrides,
  };
}

describe("requirementSheetLifecycleService.assertNoLockedOrCancelledSheetForCyclePeriod", () => {
  it("blocks when LOCKED sheet exists for cycle+period", async () => {
    const tx = mockTx();
    await assert.rejects(
      () =>
        assertNoLockedOrCancelledSheetForCyclePeriod(tx, {
          salesOrderId: 5,
          cycleId: 10,
          periodKey: "2026-06",
        }),
      (e) => {
        assert.ok(e instanceof RequirementSheetLifecycleError);
        assert.equal(e.code, "CYCLE_ALREADY_LOCKED");
        assert.match(e.message, /Cycle 1 is already locked/);
        return true;
      },
    );
  });

  it("blocks when CANCELLED sheet exists for cycle+period", async () => {
    const tx = mockTx();
    await assert.rejects(
      () =>
        assertNoLockedOrCancelledSheetForCyclePeriod(tx, {
          salesOrderId: 5,
          cycleId: 11,
          periodKey: "2026-06",
        }),
      (e) => {
        assert.ok(e instanceof RequirementSheetLifecycleError);
        assert.equal(e.code, "CYCLE_DEMAND_CANCELLED");
        return true;
      },
    );
  });

  it("allows create when no terminal sheet on cycle+period", async () => {
    const tx = mockTx({
      requirementSheet: {
        findFirst: async () => null,
      },
    });
    await assertNoLockedOrCancelledSheetForCyclePeriod(tx, {
      salesOrderId: 5,
      cycleId: 20,
      periodKey: "2026-06",
    });
  });
});

describe("requirementSheetLifecycleService.cycleLockedCreateMessage", () => {
  it("includes cycle number in user message", () => {
    const msg = cycleLockedCreateMessage(1);
    assert.match(msg, /Cycle 1 is already locked/);
    assert.match(msg, /Create the next cycle instead/);
  });
});

describe("requirementSheetLifecycleService.evaluateRequirementSheetCancellation", () => {
  it("rejects non-LOCKED sheets", async () => {
    const db = {
      requirementSheet: {
        findUnique: async () => ({
          id: 1,
          status: "DRAFT",
          salesOrderId: 5,
          periodKey: "2026-06",
          cycleId: 10,
          salesOrder: { orderType: "NO_QTY" },
        }),
      },
    };
    const res = await evaluateRequirementSheetCancellation(db, 1);
    assert.equal(res.allowed, false);
    assert.equal(res.code, "NOT_LOCKED");
  });

  it("allows cancel when no downstream activity", async () => {
    const db = {
      requirementSheet: {
        findUnique: async () => ({
          id: 1,
          status: "LOCKED",
          salesOrderId: 5,
          periodKey: "2026-06",
          cycleId: 10,
          salesOrder: { orderType: "NO_QTY" },
        }),
      },
      workOrder: { findMany: async () => [] },
      dispatch: { count: async () => 0 },
      salesBill: { count: async () => 0 },
      monthlyProductionPlan: { findMany: async () => [] },
      rmPoLineProcurementLink: { findFirst: async () => null },
      grn: { count: async () => 0 },
    };
    const res = await evaluateRequirementSheetCancellation(db, 1);
    assert.equal(res.allowed, true);
    assert.equal(res.message, RS_LIFECYCLE_MESSAGES.CANCEL_SUCCESS);
  });

  it("blocks when procurement released for period", async () => {
    const db = {
      requirementSheet: {
        findUnique: async () => ({
          id: 1,
          status: "LOCKED",
          salesOrderId: 5,
          periodKey: "2026-06",
          cycleId: 10,
          salesOrder: { orderType: "NO_QTY" },
        }),
      },
      workOrder: { findMany: async () => [] },
      dispatch: { count: async () => 0 },
      salesBill: { count: async () => 0 },
      monthlyProductionPlan: {
        findMany: async () => [{ id: 9, docNo: "MPP-26-0001", status: "APPROVED", releasedAt: new Date() }],
      },
      rmPoLineProcurementLink: { findFirst: async () => null },
      grn: { count: async () => 0 },
    };
    const res = await evaluateRequirementSheetCancellation(db, 1);
    assert.equal(res.allowed, false);
    assert.equal(res.code, "PROCUREMENT_RELEASED");
  });

  it("blocks when production started", async () => {
    const db = {
      requirementSheet: {
        findUnique: async () => ({
          id: 1,
          status: "LOCKED",
          salesOrderId: 5,
          periodKey: "2026-06",
          cycleId: 10,
          salesOrder: { orderType: "NO_QTY" },
        }),
      },
      workOrder: { findMany: async () => [{ id: 50, cycleId: 10 }] },
      productionEntry: { count: async () => 1 },
      productionMaterialRequest: { findFirst: async () => null },
      materialIssueNote: { count: async () => 0 },
      dispatch: { count: async () => 0 },
      salesBill: { count: async () => 0 },
      monthlyProductionPlan: { findMany: async () => [] },
      rmPoLineProcurementLink: { findFirst: async () => null },
      grn: { count: async () => 0 },
    };
    const res = await evaluateRequirementSheetCancellation(db, 1);
    assert.equal(res.allowed, false);
    assert.equal(res.code, "PRODUCTION_STARTED");
  });

  it("blocks cancellation when any active linked WO exists even without production", async () => {
    const db = {
      requirementSheet: {
        findUnique: async () => ({
          id: 1,
          status: "LOCKED",
          salesOrderId: 5,
          periodKey: "2026-06",
          cycleId: 10,
          salesOrder: { orderType: "NO_QTY" },
        }),
      },
      workOrder: { findMany: async () => [{ id: 50, cycleId: 10 }, { id: 51, cycleId: 10 }] },
      productionEntry: { count: async () => 0 },
      productionMaterialRequest: { findFirst: async () => null },
      materialIssueNote: { count: async () => 0 },
      dispatch: { count: async () => 0 },
      salesBill: { count: async () => 0 },
      monthlyProductionPlan: { findMany: async () => [] },
      rmPoLineProcurementLink: { findFirst: async () => null },
      grn: { count: async () => 0 },
    };
    const res = await evaluateRequirementSheetCancellation(db, 1);
    assert.equal(res.allowed, false);
    assert.equal(res.code, "WORK_ORDER_EXISTS");
    assert.deepEqual(res.details.workOrderIds, [50, 51]);
  });
});
