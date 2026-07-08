const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_RM_STORE_CODE,
  itemTypeFlagsFromCheckboxes,
  assertAtLeastOneItemType,
  resolveLocationReadScope,
  clearDefaultRmLocationCache,
} = require("../../src/services/locationService");
const { getItemStockQty } = require("../../src/services/stockService");
const {
  resolveFgQcStockPostingLocationId,
  clearFgStockPostingLocationCache,
} = require("../../src/services/fgStockPostingLocationService");

describe("locationService helpers", () => {
  it("DEFAULT_RM_STORE_CODE is LOC-RM-STORE", () => {
    assert.equal(DEFAULT_RM_STORE_CODE, "LOC-RM-STORE");
  });

  it("requires at least one allowed item type", () => {
    assert.throws(() => assertAtLeastOneItemType(itemTypeFlagsFromCheckboxes({})), /at least one/i);
    assert.doesNotThrow(() =>
      assertAtLeastOneItemType(itemTypeFlagsFromCheckboxes({ allowRm: true })),
    );
  });
});

describe("stockService location scope (unit)", () => {
  beforeEach(() => {
    clearDefaultRmLocationCache();
    clearFgStockPostingLocationCache();
  });

  it("allLocations returns empty scope object", async () => {
    const scope = await resolveLocationReadScope(
      { location: { findFirst: async () => ({ id: 1 }) } },
      { allLocations: true },
    );
    assert.deepEqual(scope, {});
  });

  it("default stock read scope is RM Store (+ null); FG QC REWORK posts are invisible without locationId", async () => {
    const RM_ID = 1;
    const FG_ID = 10;
    const ITEM_ID = 42;
    const SPLIT_REWORK = 13;

    const locations = [
      { id: RM_ID, locationCode: "LOC-RM-STORE", isActive: true },
      { id: FG_ID, locationCode: "LOC-FG-STORE", isActive: true },
      { id: 20, locationCode: "LOC-SCRAP", locationType: "SCRAP", isActive: true },
    ];

    /** Ledger rows after a QC split rework post (qtyIn on FG Store / REWORK). */
    const ledger = [
      {
        itemId: ITEM_ID,
        locationId: FG_ID,
        stockBucket: "REWORK",
        qcRejectedDispositionId: 99,
        qtyIn: SPLIT_REWORK,
        qtyOut: 0,
        reversedAt: null,
      },
    ];

    const db = {
      location: {
        findFirst: async ({ where }) => {
          if (where?.locationCode) {
            return locations.find((l) => l.locationCode === where.locationCode && l.isActive) ?? null;
          }
          if (where?.locationType === "SCRAP") {
            return locations.find((l) => l.locationType === "SCRAP") ?? null;
          }
          return null;
        },
      },
      stockTransaction: {
        aggregate: async ({ where }) => {
          let rows = ledger.filter((r) => r.itemId === where.itemId);
          if (where.stockBucket) rows = rows.filter((r) => r.stockBucket === where.stockBucket);
          if (where.qcRejectedDispositionId) {
            rows = rows.filter((r) => r.qcRejectedDispositionId === where.qcRejectedDispositionId);
          }
          if (where.locationId != null) {
            rows = rows.filter((r) => r.locationId === where.locationId);
          } else if (where.OR) {
            // Default RM scope: RM store OR null — FG Store credit is excluded.
            rows = rows.filter((r) =>
              where.OR.some(
                (clause) =>
                  Object.prototype.hasOwnProperty.call(clause, "locationId") &&
                  (clause.locationId === null
                    ? r.locationId == null
                    : r.locationId === clause.locationId),
              ),
            );
          }
          const qtyIn = rows.reduce((s, r) => s + Number(r.qtyIn || 0), 0);
          const qtyOut = rows.reduce((s, r) => s + Number(r.qtyOut || 0), 0);
          return { _sum: { qtyIn, qtyOut } };
        },
      },
    };

    const fgLoc = await resolveFgQcStockPostingLocationId(db, "REWORK");
    assert.equal(fgLoc, FG_ID);

    // Bug reproduction: assertion used default scope → delta 0 even though FG txn exists.
    const beforeDefault = 0;
    const afterDefault = await getItemStockQty(ITEM_ID, db, { stockBucket: "REWORK" });
    assert.equal(afterDefault - beforeDefault, 0, "RM-scoped read must miss FG Store REWORK credit");

    // Fix: read at the same locationId used for QC FG posting.
    const afterFg = await getItemStockQty(ITEM_ID, db, { stockBucket: "REWORK", locationId: fgLoc });
    assert.equal(afterFg - beforeDefault, SPLIT_REWORK);

    const owned = await getItemStockQty(ITEM_ID, db, {
      stockBucket: "REWORK",
      locationId: fgLoc,
      qcRejectedDispositionId: 99,
    });
    assert.equal(owned, SPLIT_REWORK);
  });
});
