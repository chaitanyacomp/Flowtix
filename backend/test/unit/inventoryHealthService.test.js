const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyInventoryHealth,
  buildRmStockHealthAlerts,
} = require("../../src/services/inventoryHealthService");

describe("inventoryHealthService", () => {
  it("classifies OUT_OF_STOCK before CRITICAL", () => {
    assert.equal(
      classifyInventoryHealth({ currentQty: 0, minimumStock: 100, lowStockLevel: 125 }),
      "OUT_OF_STOCK",
    );
  });

  it("splits RM dashboard alerts into critical and warning bands", () => {
    const stock = new Map([
      [1, 130],
      [2, 110],
      [3, 90],
      [4, 0],
    ]);
    const rmItems = [
      { id: 1, itemName: "A", minimumStockQty: 100, minStockLevel: 125 },
      { id: 2, itemName: "B", minimumStockQty: 100, minStockLevel: 125 },
      { id: 3, itemName: "C", minimumStockQty: 100, minStockLevel: 125 },
      { id: 4, itemName: "D", minimumStockQty: 100, minStockLevel: 125 },
    ];
    const { rmStockCritical, rmStockWarning, rmStockAlert } = buildRmStockHealthAlerts(rmItems, stock);
    assert.equal(rmStockCritical.length, 2);
    assert.equal(rmStockWarning.length, 1);
    assert.equal(rmStockAlert.length, 3);
    assert.ok(rmStockCritical.some((r) => r.status === "OUT_OF_STOCK"));
    assert.ok(rmStockCritical.some((r) => r.status === "CRITICAL"));
    assert.ok(rmStockWarning.every((r) => r.status === "LOW"));
  });
});
