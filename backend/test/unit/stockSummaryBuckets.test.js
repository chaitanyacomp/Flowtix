const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { classifyInventoryHealth } = require("../../src/services/inventoryHealthService");

describe("stock summary / dashboard inventory health alignment", () => {
  it("qty at warning level is LOW not CRITICAL", () => {
    assert.equal(
      classifyInventoryHealth({ currentQty: 100, minimumStock: 100, lowStockLevel: 125 }),
      "LOW",
    );
  });

  it("qty above warning level is HEALTHY", () => {
    assert.equal(
      classifyInventoryHealth({ currentQty: 130, minimumStock: 100, lowStockLevel: 125 }),
      "HEALTHY",
    );
  });

  it("zero qty below configured minimum is CRITICAL", () => {
    assert.equal(
      classifyInventoryHealth({ currentQty: 0, minimumStock: 100, lowStockLevel: 125 }),
      "CRITICAL",
    );
  });

  it("zero qty with no minimum is HEALTHY", () => {
    assert.equal(
      classifyInventoryHealth({ currentQty: 0, minimumStock: 0, lowStockLevel: 0 }),
      "HEALTHY",
    );
  });
});
