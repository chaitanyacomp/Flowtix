const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  movementActivityLabel,
  buildMovementFilterWhere,
  MOVEMENT_FILTERS,
} = require("../../src/services/stockMovementLedgerService");

describe("stockMovementLedgerService", () => {
  it("labels LOCATION_TRANSFER as Material Transfer", () => {
    assert.equal(
      movementActivityLabel({ transactionType: "LOCATION_TRANSFER", qtyIn: 100, qtyOut: 0 }),
      "Material Transfer",
    );
  });

  it("labels ISSUE out as Production Consumption", () => {
    assert.equal(
      movementActivityLabel({ transactionType: "ISSUE", qtyIn: 0, qtyOut: 50 }),
      "Production Consumption",
    );
  });

  it("labels GRN as Goods Receipt", () => {
    assert.equal(movementActivityLabel({ transactionType: "GRN", qtyIn: 10, qtyOut: 0 }), "Goods Receipt");
  });

  it("buildMovementFilterWhere maps LOCATION_TRANSFER filter", () => {
    assert.deepEqual(buildMovementFilterWhere("LOCATION_TRANSFER"), {
      transactionType: "LOCATION_TRANSFER",
    });
  });

  it("includes LOCATION_TRANSFER in movement filters", () => {
    assert.ok(MOVEMENT_FILTERS.has("LOCATION_TRANSFER"));
    assert.ok(MOVEMENT_FILTERS.has("GRN"));
  });
});
