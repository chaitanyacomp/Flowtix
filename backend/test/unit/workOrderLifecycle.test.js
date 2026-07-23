const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  effectiveLinePlanQty,
  shouldFreezeStatusSync,
  HOLD_REASONS,
  WO_PRODUCTION_BLOCKED,
  closeWorkOrderWithShortfall,
} = require("../../src/services/workOrderLifecycleService");

describe("workOrderLifecycleService", () => {
  it("effectiveLinePlanQty releases shortfall on CLOSED_WITH_SHORTFALL", () => {
    const line = { qty: "5000", shortfallQty: "2000" };
    assert.equal(effectiveLinePlanQty(line, "CLOSED_WITH_SHORTFALL"), 3000);
    assert.equal(effectiveLinePlanQty(line, "IN_PROGRESS"), 5000);
  });

  it("freezes auto status sync for HOLD, PAUSED and shortfall closed", () => {
    assert.equal(shouldFreezeStatusSync("HOLD"), true);
    assert.equal(shouldFreezeStatusSync("PAUSED"), true);
    assert.equal(shouldFreezeStatusSync("CLOSED_WITH_SHORTFALL"), true);
    assert.equal(shouldFreezeStatusSync("IN_PROGRESS"), false);
  });

  it("exports hold reasons including production pause", () => {
    assert.ok(HOLD_REASONS.includes("RM_SHORTAGE"));
    assert.ok(HOLD_REASONS.includes("MANAGEMENT_HOLD"));
    assert.ok(HOLD_REASONS.includes("PRODUCTION_PAUSE"));
  });

  it("blocks production for PAUSED status", () => {
    assert.ok(WO_PRODUCTION_BLOCKED.has("PAUSED"));
    assert.ok(!WO_PRODUCTION_BLOCKED.has("IN_PROGRESS"));
  });

  it("closes with shortfall without waiting for Store RM return acknowledgement", async () => {
    const tx = {
      workOrder: {
        findUnique: async () => ({
          id: 10,
          docNo: "WO-10",
          status: "IN_PROGRESS",
          requirementSheetId: null,
          cycleId: null,
          salesOrderId: 1,
          sourceType: null,
          salesOrder: { id: 1, orderType: "NORMAL", docNo: "SO-1" },
          lines: [{ id: 100, qty: "100", plannedQty: "100", fgItemId: 7, fgItem: { id: 7, itemName: "FG" } }],
          productionExecution: null,
        }),
        update: async ({ data }) => ({ id: 10, docNo: "WO-10", ...data }),
      },
      salesOrder: {
        findUnique: async () => ({
          orderType: "NORMAL",
          lines: [{ qty: 100, customerPoQty: 100, itemId: 7 }],
        }),
      },
      productionWorkOrderReport: {
        findUnique: async () => ({ id: 20, status: "CONFIRMED" }),
      },
      productionEntry: {
        groupBy: async () => [{ workOrderLineId: 100, _sum: { producedQty: "70" } }],
      },
      productionRmReturnPending: {
        count: async () => {
          throw new Error("RM return pending must remain a parallel Store task");
        },
      },
      workOrderLine: {
        findMany: async () => [],
        update: async () => ({}),
      },
      workOrderProductionExecution: {
        upsert: async () => ({ workOrderId: 10, executionStatus: "COMPLETED" }),
      },
    };

    const result = await closeWorkOrderWithShortfall(tx, 10, {
      closureReason: "Customer accepted shortfall",
      actorUserId: null,
      actorRole: null,
    });
    assert.equal(result.shortfallQty, 30);
    assert.equal(result.workOrder.status, "CLOSED_WITH_SHORTFALL");
  });
});
