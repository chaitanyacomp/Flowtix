/**
 * Regression: finalized production wastage must leave PRODUCTION USABLE stock.
 * UAT HDPE case: issued 281, consumed 266.76, returned 10, wastage 4.24 → At Production 0.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  aggregateItemOperationalFlows,
  PRODUCTION_LOCATION_TYPES,
  STORE_LOCATION_TYPES,
  WIP_LOCATION_TYPES,
} = require("../../src/services/stockVisibilityService");

function n(v) {
  return Number(v) || 0;
}

function netUsableAt(txns, locTypeById, types) {
  let net = 0;
  for (const t of txns) {
    if (String(t.stockBucket || "USABLE") !== "USABLE") continue;
    const lt = String(locTypeById.get(t.locationId) || "");
    if (!types.has(lt)) continue;
    net += n(t.qtyIn) - n(t.qtyOut);
  }
  return Math.round(net * 1000) / 1000;
}

describe("production wastage stock conservation (HDPE UAT)", () => {
  const RM_STORE = 1;
  const PRODUCTION = 2;
  const locTypeById = new Map([
    [RM_STORE, "RM_STORE"],
    [PRODUCTION, "PRODUCTION"],
  ]);

  const baseTxns = [
    { transactionType: "OPENING", locationId: RM_STORE, stockBucket: "USABLE", qtyIn: "500", qtyOut: "0" },
    { transactionType: "LOCATION_TRANSFER", locationId: RM_STORE, stockBucket: "USABLE", qtyIn: "0", qtyOut: "281" },
    { transactionType: "LOCATION_TRANSFER", locationId: PRODUCTION, stockBucket: "USABLE", qtyIn: "281", qtyOut: "0" },
    { transactionType: "ISSUE", locationId: PRODUCTION, stockBucket: "USABLE", qtyIn: "0", qtyOut: "266.76" },
    { transactionType: "LOCATION_TRANSFER", locationId: PRODUCTION, stockBucket: "USABLE", qtyIn: "0", qtyOut: "10" },
    { transactionType: "LOCATION_TRANSFER", locationId: RM_STORE, stockBucket: "USABLE", qtyIn: "10", qtyOut: "0" },
  ];

  it("before RM_WASTAGE posting, At Production retains finalized wastage qty", () => {
    const atProd = netUsableAt(baseTxns, locTypeById, new Set(["PRODUCTION", "WIP"]));
    const atStore = netUsableAt(baseTxns, locTypeById, new Set(["RM_STORE", "STORE"]));
    assert.equal(atProd, 4.24);
    assert.equal(atStore, 229);
  });

  it("after RM_WASTAGE qtyOut, At Production is 0 and Store stays 229", async () => {
    const withWastage = [
      ...baseTxns,
      {
        transactionType: "RM_WASTAGE",
        locationId: PRODUCTION,
        stockBucket: "USABLE",
        qtyIn: "0",
        qtyOut: "4.24",
      },
    ];
    const atProd = netUsableAt(withWastage, locTypeById, new Set(["PRODUCTION", "WIP"]));
    const atStore = netUsableAt(withWastage, locTypeById, new Set(["RM_STORE", "STORE"]));
    assert.equal(atProd, 0);
    assert.equal(atStore, 229);

    // Conservation: opening − consumption − wastage = store + production
    // 500 − 266.76 − 4.24 = 229; production residual 0.
    assert.equal(Math.round((500 - 266.76 - 4.24) * 1000) / 1000, 229);

    const db = {
      stockTransaction: {
        findMany: async () => withWastage,
      },
    };
    const flows = await aggregateItemOperationalFlows(db, 62, locTypeById);
    assert.equal(flows.issuedToProduction, 281);
    assert.equal(flows.consumedInProduction, 266.76);
    assert.equal(flows.returnedToStore, 10);
    assert.equal(flows.wastageInProduction, 4.24);
    // Wastage is not double-counted as consumption.
    assert.equal(flows.consumedInProduction + flows.wastageInProduction, 271);
  });

  it("exposes production location type sets used by Stock Summary", () => {
    assert.ok(PRODUCTION_LOCATION_TYPES.has("PRODUCTION"));
    assert.ok(STORE_LOCATION_TYPES.has("RM_STORE"));
    assert.ok(WIP_LOCATION_TYPES.has("WIP"));
  });
});
