const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyInventoryHealth,
  buildRmStockHealthAlerts,
  inventoryHealthToRmAlertBand,
} = require("../../src/services/inventoryHealthService");

describe("inventoryHealthService", () => {
  it("P10-A6B policy cases A–D", () => {
    // A: zero stock, no minimum → not critical
    assert.equal(classifyInventoryHealth({ currentQty: 0, minimumStock: 0, lowStockLevel: 0 }), "HEALTHY");
    assert.equal(classifyInventoryHealth({ currentQty: 0, minimumStock: null, lowStockLevel: 0 }), "HEALTHY");
    assert.equal(inventoryHealthToRmAlertBand(classifyInventoryHealth({ currentQty: 0, minimumStock: 0 })), null);

    // B: zero stock, min 100 → critical
    assert.equal(classifyInventoryHealth({ currentQty: 0, minimumStock: 100, lowStockLevel: 125 }), "CRITICAL");

    // C: 50 stock, min 100 → critical
    assert.equal(classifyInventoryHealth({ currentQty: 50, minimumStock: 100, lowStockLevel: 125 }), "CRITICAL");

    // D: 120 stock, min 100 → healthy or low by lowStockLevel
    assert.equal(classifyInventoryHealth({ currentQty: 120, minimumStock: 100, lowStockLevel: 125 }), "LOW");
    assert.equal(classifyInventoryHealth({ currentQty: 120, minimumStock: 100, lowStockLevel: 110 }), "HEALTHY");
  });

  it("splits RM dashboard alerts into critical and warning bands", () => {
    const stock = new Map([
      [1, 130],
      [2, 110],
      [3, 90],
      [4, 0],
      [5, 0],
    ]);
    const rmItems = [
      { id: 1, itemName: "A", minimumStockQty: 100, minStockLevel: 125 },
      { id: 2, itemName: "B", minimumStockQty: 100, minStockLevel: 125 },
      { id: 3, itemName: "C", minimumStockQty: 100, minStockLevel: 125 },
      { id: 4, itemName: "D", minimumStockQty: 100, minStockLevel: 125 },
      { id: 5, itemName: "E", minimumStockQty: 0, minStockLevel: 0 },
    ];
    const { rmStockCritical, rmStockWarning, rmStockAlert } = buildRmStockHealthAlerts(rmItems, stock);
    assert.equal(rmStockCritical.length, 2);
    assert.equal(rmStockWarning.length, 1);
    assert.equal(rmStockAlert.length, 3);
    assert.ok(rmStockCritical.every((r) => r.status === "CRITICAL"));
    assert.ok(rmStockWarning.every((r) => r.status === "LOW"));
    assert.ok(!rmStockCritical.some((r) => r.itemId === 5));
  });
});
