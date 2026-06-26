/**
 * @jest-environment node
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { resolveNoQtyCarryForwardDemandQty } = require("../../src/routes/requirementSheets");
const { loadPendingCarryForwardQtyByItem } = require("../../src/services/carryForwardPendingService");

describe("resolveNoQtyCarryForwardDemandQty", () => {
  test("returns pending carry-forward qty when pool has demand", () => {
    assert.equal(
      resolveNoQtyCarryForwardDemandQty({
        cfPendingQty: 300,
        operatorShortfall: 300,
        executionCompleted: true,
        hadCarryForwardResolution: true,
      }),
      300,
    );
  });

  test("returns zero when shortfall was waived (execution completed without CF)", () => {
    assert.equal(
      resolveNoQtyCarryForwardDemandQty({
        cfPendingQty: 0,
        operatorShortfall: 20,
        executionCompleted: true,
        hadCarryForwardResolution: false,
      }),
      0,
    );
  });

  test("returns operator shortfall for legacy cycles without execution resolution", () => {
    assert.equal(
      resolveNoQtyCarryForwardDemandQty({
        cfPendingQty: 0,
        operatorShortfall: 100,
        executionCompleted: false,
        hadCarryForwardResolution: false,
      }),
      100,
    );
  });

  test("P16-A2: carry-forward item keeps demand; waived item does not leak", () => {
    const dummyPlug = resolveNoQtyCarryForwardDemandQty({
      cfPendingQty: 300,
      operatorShortfall: 300,
      executionCompleted: true,
      hadCarryForwardResolution: true,
    });
    const squareBox = resolveNoQtyCarryForwardDemandQty({
      cfPendingQty: 0,
      operatorShortfall: 20,
      executionCompleted: true,
      hadCarryForwardResolution: false,
    });
    assert.equal(dummyPlug, 300);
    assert.equal(squareBox, 0);
  });
});

describe("loadPendingCarryForwardQtyByItem", () => {
  test("sums pending qty for prior cycles only", async () => {
    const db = {
      salesOrderCycle: {
        findUnique: async () => ({ salesOrderId: 10, cycleNo: 2 }),
        findMany: async () => [{ id: 101 }],
      },
      carryForwardPending: {
        findMany: async () => [
          { itemId: 1, remainingQty: "300", cycleId: 101 },
          { itemId: 2, remainingQty: "20", cycleId: 101 },
          { itemId: 3, remainingQty: "50", cycleId: 999 },
        ],
      },
    };
    const map = await loadPendingCarryForwardQtyByItem(db, { salesOrderId: 10, currentCycleId: 200 });
    assert.equal(map.get(1), 300);
    assert.equal(map.get(2), 20);
    assert.equal(map.has(3), false);
  });
});
