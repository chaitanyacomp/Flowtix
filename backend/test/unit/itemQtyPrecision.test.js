const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  fgQtyDecimalPlaces,
  roundFgQty,
  capFgQtyFromRmAvailability,
} = require("../../src/services/itemQtyPrecision");

describe("itemQtyPrecision", () => {
  it("treats Nos/Pcs as integer FG units", () => {
    assert.equal(fgQtyDecimalPlaces("Nos"), 0);
    assert.equal(fgQtyDecimalPlaces("PCS"), 0);
    assert.equal(roundFgQty(328.571, "Nos", { mode: "floor" }), 328);
    assert.equal(roundFgQty(3171.429, "Nos", { mode: "floor" }), 3171);
  });

  it("keeps decimal precision for weight units", () => {
    assert.equal(fgQtyDecimalPlaces("Kg"), 3);
    assert.equal(roundFgQty(328.5714, "Kg"), 328.571);
  });

  it("caps RM-limited FG qty as whole numbers for integer units", () => {
    assert.equal(capFgQtyFromRmAvailability(2300, 7, "Nos"), 328);
    assert.equal(capFgQtyFromRmAvailability(22200, 7, "Nos"), 3171);
  });

  it("integer WO placements from RM split do not exceed RS balance sum", () => {
    const rsBalance = 3500;
    const capA = capFgQtyFromRmAvailability(2300, 7, "Nos");
    const capB = capFgQtyFromRmAvailability(22200, 7, "Nos");
    assert.ok(capA + capB <= rsBalance);
    assert.equal(Number.isInteger(capA), true);
    assert.equal(Number.isInteger(capB), true);
  });
});
