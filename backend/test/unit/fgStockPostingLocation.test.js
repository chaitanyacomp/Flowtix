const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  clearFgStockPostingLocationCache,
  resolveFgQcStockPostingLocationId,
  resolveFgDispatchSourceLocationId,
  resolveStockTxnReversalLocationId,
  createFgQcStockLocationResolver,
} = require("../../src/services/fgStockPostingLocationService");

const mockLocations = [
  { id: 10, locationCode: "LOC-FG-STORE", locationName: "FG Store", locationType: "FG_STORE", isActive: true },
  { id: 20, locationCode: "LOC-SCRAP", locationName: "Scrap Yard", locationType: "SCRAP", isActive: true },
];

function mockLocationDb() {
  return {
    location: {
      findFirst: async ({ where }) => {
        if (where?.locationCode) {
          return mockLocations.find((l) => l.locationCode === where.locationCode && l.isActive !== false) ?? null;
        }
        if (where?.locationType === "SCRAP") {
          return mockLocations.find((l) => l.locationType === "SCRAP") ?? null;
        }
        return null;
      },
    },
  };
}

describe("fgStockPostingLocationService", () => {
  beforeEach(() => {
    clearFgStockPostingLocationCache();
  });

  it("resolveFgQcStockPostingLocationId maps USABLE to FG Store", async () => {
    const id = await resolveFgQcStockPostingLocationId(mockLocationDb(), "USABLE");
    assert.equal(id, 10);
  });

  it("resolveFgQcStockPostingLocationId maps QC_HOLD and REWORK to FG Store", async () => {
    const db = mockLocationDb();
    assert.equal(await resolveFgQcStockPostingLocationId(db, "QC_HOLD"), 10);
    assert.equal(await resolveFgQcStockPostingLocationId(db, "REWORK"), 10);
  });

  it("resolveFgQcStockPostingLocationId maps SCRAP to Scrap Yard", async () => {
    const id = await resolveFgQcStockPostingLocationId(mockLocationDb(), "SCRAP");
    assert.equal(id, 20);
  });

  it("resolveFgDispatchSourceLocationId returns FG Store", async () => {
    const id = await resolveFgDispatchSourceLocationId(mockLocationDb());
    assert.equal(id, 10);
  });

  it("resolveStockTxnReversalLocationId preserves forward location when set", async () => {
    const id = await resolveStockTxnReversalLocationId(mockLocationDb(), {
      forwardLocationId: 99,
      stockBucket: "USABLE",
    });
    assert.equal(id, 99);
  });

  it("resolveStockTxnReversalLocationId falls back to bucket default when forward is null", async () => {
    const id = await resolveStockTxnReversalLocationId(mockLocationDb(), {
      forwardLocationId: null,
      stockBucket: "USABLE",
    });
    assert.equal(id, 10);
  });

  it("createFgQcStockLocationResolver caches bucket lookups per transaction", async () => {
    let calls = 0;
    const db = {
      location: {
        findFirst: async ({ where }) => {
          calls += 1;
          if (where?.locationCode === "LOC-FG-STORE") return mockLocations[0];
          if (where?.locationCode === "LOC-SCRAP") return mockLocations[1];
          return null;
        },
      },
    };
    clearFgStockPostingLocationCache();
    const resolve = await createFgQcStockLocationResolver(db);
    assert.equal(await resolve("USABLE"), 10);
    assert.equal(await resolve("QC_HOLD"), 10);
    assert.equal(await resolve("SCRAP"), 20);
    assert.equal(calls, 2);
  });
});
