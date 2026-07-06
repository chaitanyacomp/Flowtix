const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  movementActivityLabel,
  buildMovementFilterWhere,
  enrichMovementRows,
  MOVEMENT_FILTERS,
} = require("../../src/services/stockMovementLedgerService");
const { UNASSIGNED_LOCATION_LABEL } = require("../../src/services/grnLocationService");

const fgStoreLocation = {
  id: 10,
  locationCode: "LOC-FG-STORE",
  locationName: "FG Store",
  locationType: "FG_STORE",
  departmentOwner: "STORES",
  allowRm: false,
  allowFg: true,
  allowSfg: true,
  allowConsumable: false,
  isActive: true,
  isSystem: true,
};

function fgItem() {
  return { itemName: "Sample FG", itemType: "FG", unit: "PCS" };
}

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

  it("enrichMovementRows shows FG Store for QC accepted rows with locationId", async () => {
    const rows = [
      {
        id: 101,
        itemId: 1,
        locationId: fgStoreLocation.id,
        transactionType: "QC",
        refId: 55,
        stockBucket: "USABLE",
        qtyIn: 100,
        qtyOut: 0,
        date: new Date("2026-05-01"),
        reason: null,
        reversalOfId: null,
        item: fgItem(),
        location: fgStoreLocation,
      },
    ];
    const enriched = await enrichMovementRows(rows, { materialIssueNote: { findMany: async () => [] }, materialReturnNote: { findMany: async () => [] }, grnLine: { findMany: async () => [] }, stockTransaction: { findMany: async () => [] } });
    assert.equal(enriched[0].locationName, "FG Store");
    assert.notEqual(enriched[0].locationName, UNASSIGNED_LOCATION_LABEL);
  });

  it("enrichMovementRows shows FG Store for Dispatch qtyOut rows with locationId", async () => {
    const rows = [
      {
        id: 102,
        itemId: 1,
        locationId: fgStoreLocation.id,
        transactionType: "DISPATCH",
        refId: 77,
        stockBucket: "USABLE",
        qtyIn: 0,
        qtyOut: 40,
        date: new Date("2026-05-02"),
        reason: null,
        reversalOfId: null,
        item: fgItem(),
        location: fgStoreLocation,
      },
    ];
    const enriched = await enrichMovementRows(rows, { materialIssueNote: { findMany: async () => [] }, materialReturnNote: { findMany: async () => [] }, grnLine: { findMany: async () => [] }, stockTransaction: { findMany: async () => [] } });
    assert.equal(enriched[0].locationName, "FG Store");
    assert.notEqual(enriched[0].locationName, UNASSIGNED_LOCATION_LABEL);
  });

  it("enrichMovementRows keeps Unassigned Location for legacy null-location QC rows", async () => {
    const rows = [
      {
        id: 103,
        itemId: 1,
        locationId: null,
        transactionType: "QC",
        refId: 56,
        stockBucket: "USABLE",
        qtyIn: 50,
        qtyOut: 0,
        date: new Date("2026-05-01"),
        reason: null,
        reversalOfId: null,
        item: fgItem(),
        location: null,
      },
    ];
    const enriched = await enrichMovementRows(rows, { materialIssueNote: { findMany: async () => [] }, materialReturnNote: { findMany: async () => [] }, grnLine: { findMany: async () => [] }, stockTransaction: { findMany: async () => [] } });
    assert.equal(enriched[0].locationName, UNASSIGNED_LOCATION_LABEL);
  });
});
