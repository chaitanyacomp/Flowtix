const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  formatQuantityWithUnit,
  formatRmQuantity,
  formatFgQuantity,
  formatScrapQuantity,
  qtyDecimalPlacesFromUnit,
} = require("../../src/services/quantityDisplayService");

describe("quantityDisplayService", () => {
  it("formats meter quantities with unit", () => {
    assert.equal(formatQuantityWithUnit(523.809, "m"), "523.809 m");
  });

  it("formats integer FG units", () => {
    assert.equal(formatFgQuantity(250, "Nos"), "250 Nos");
  });

  it("formats RM weight", () => {
    assert.equal(formatRmQuantity(12.5, "Kg"), "12.5 Kg");
  });

  it("formats scrap with item unit", () => {
    assert.equal(formatScrapQuantity(2, "Nos"), "2 Nos");
  });

  it("derives precision from unit token", () => {
    assert.equal(qtyDecimalPlacesFromUnit("Nos"), 0);
    assert.equal(qtyDecimalPlacesFromUnit("Kg"), 3);
  });
});
