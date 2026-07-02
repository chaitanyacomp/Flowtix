const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isProductionSourceLocation,
  isStoreDestinationLocation,
  computeUnusedIssuedRmQty,
  computePhysicalReturnableQty,
  buildReturnableLinesForWorkOrder,
} = require("../../src/services/materialReturnService");
const { floorFgQty } = require("../../src/services/productionRmReadinessService");

describe("materialReturnService location rules", () => {
  it("allows PRODUCTION/WIP → RM_STORE/CONSUMABLE", () => {
    assert.equal(isProductionSourceLocation({ locationType: "PRODUCTION" }), true);
    assert.equal(isProductionSourceLocation({ locationType: "WIP" }), true);
    assert.equal(isStoreDestinationLocation({ locationType: "RM_STORE" }), true);
    assert.equal(isStoreDestinationLocation({ locationType: "CONSUMABLE" }), true);
    assert.equal(isProductionSourceLocation({ locationType: "RM_STORE" }), false);
    assert.equal(isStoreDestinationLocation({ locationType: "PRODUCTION" }), false);
  });
});

describe("computeUnusedIssuedRmQty", () => {
  it("PP factory example — unused after partial production", () => {
    assert.equal(computeUnusedIssuedRmQty(5200, 3120, 0), 2080);
  });

  it("PP factory example — after partial return to store", () => {
    assert.equal(computeUnusedIssuedRmQty(5200, 3120, 1000), 1080);
  });

  it("without wastage arg behaves as before (default 0)", () => {
    assert.equal(computeUnusedIssuedRmQty(5200, 3120, 1000, undefined), 1080);
  });

  it("consumed qty is not reduced by return (return is not consumption reversal)", () => {
    const consumed = 3120;
    assert.equal(computeUnusedIssuedRmQty(5200, consumed, 1000), 1080);
    assert.equal(consumed, 3120);
  });
});

describe("computePhysicalReturnableQty", () => {
  it("returnable = unused logical qty capped by on-hand", () => {
    assert.equal(computePhysicalReturnableQty(100, 70, 0, 30), 30);
    assert.equal(computePhysicalReturnableQty(100, 70, 0, 50), 30);
  });

  it("partial return 1000 of 2080 unused PP when on-hand allows", () => {
    assert.equal(computePhysicalReturnableQty(5200, 3120, 0, 2080), 2080);
    const afterReturn = computePhysicalReturnableQty(5200, 3120, 1000, 1080);
    assert.equal(afterReturn, 1080);
  });

  it("blocks when return exceeds returnable", () => {
    const returnable = computePhysicalReturnableQty(5200, 3120, 0, 2080);
    const attempt = 2500;
    assert.ok(attempt > returnable);
  });
});

describe("resolveSuggestedRmReturnLocations", () => {
  it("infers production and store locations from latest material issue for item", async () => {
    const { resolveSuggestedRmReturnLocations } = require("../../src/services/materialReturnService");
    const db = {
      materialIssueNote: {
        findMany: async () => [
          {
            id: 5,
            fromLocationId: 2,
            toLocationId: 3,
            lines: [{ itemId: 7 }],
          },
        ],
        findFirst: async () => null,
      },
      location: {
        findUnique: async ({ where }) => {
          if (where.id === 3) {
            return {
              id: 3,
              locationCode: "PROD-A",
              locationName: "Production Floor A",
              locationType: "PRODUCTION",
              isActive: true,
              allowRm: true,
              allowSfg: false,
              allowFg: false,
              allowConsumable: false,
            };
          }
          return {
            id: 2,
            locationCode: "RM-STORE",
            locationName: "RM Store",
            locationType: "RM_STORE",
            isActive: true,
            allowRm: true,
            allowSfg: false,
            allowFg: false,
            allowConsumable: false,
          };
        },
        findFirst: async () => null,
      },
    };
    const resolved = await resolveSuggestedRmReturnLocations(db, { workOrderId: 10, itemId: 7 });
    assert.equal(resolved.locationResolved, true);
    assert.equal(resolved.suggestedFromLocationId, 3);
    assert.equal(resolved.suggestedToLocationId, 2);
    assert.equal(resolved.fromLocationName, "Production Floor A");
    assert.equal(resolved.toLocationName, "RM Store");
  });
});

describe("buildReturnableLinesForWorkOrder", () => {
  it("returns unused RM as returnable after partial approved production", async () => {
    const db = {
      workOrder: {
        findUnique: async () => ({ id: 10, docNo: "WO-TEST" }),
      },
      productionMaterialRequest: {
        findMany: async () => [
          {
            id: 20,
            status: "FULLY_ISSUED",
            lines: [{ itemId: 1, issuedQty: "5200" }],
          },
        ],
      },
      materialIssueNote: {
        findMany: async (args) => {
          if (args?.take === 1) return [];
          return args?.where?.productionMaterialRequestId === null
            ? []
            : [{ toLocationId: 3, fromLocationId: 2, lines: [{ itemId: 1 }] }];
        },
      },
      productionEntry: {
        findMany: async () => [{ id: 30 }],
      },
      stockTransaction: {
        findMany: async () => [{ itemId: 1, qtyIn: "0", qtyOut: "3120" }],
        aggregate: async () => ({ _sum: { qtyIn: "2080", qtyOut: "0" } }),
      },
      materialReturnNote: {
        findMany: async () => [],
      },
      item: {
        findMany: async () => [{ id: 1, itemName: "PP", unit: "KG", itemType: "RM" }],
      },
      location: {
        findFirst: async () => ({ id: 2, locationCode: "RM", locationName: "RM Store", locationType: "RM_STORE", isActive: true, allowRm: true, allowSfg: false, allowFg: false, allowConsumable: false }),
        findUnique: async ({ where }) => {
          if (where.id === 3) {
            return { id: 3, locationCode: "PROD", locationName: "Production", locationType: "PRODUCTION", isActive: true, allowRm: true, allowSfg: false, allowFg: false, allowConsumable: false };
          }
          return { id: 2, locationCode: "RM", locationName: "RM Store", locationType: "RM_STORE", isActive: true, allowRm: true, allowSfg: false, allowFg: false, allowConsumable: false };
        },
      },
    };

    const ctx = await buildReturnableLinesForWorkOrder(db, { workOrderId: 10 });
    assert.equal(ctx.lines.length, 1);
    assert.equal(ctx.lines[0].grossIssuedQty, 5200);
    assert.equal(ctx.lines[0].consumedQty, 3120);
    assert.equal(ctx.lines[0].returnedQty, 0);
    assert.equal(ctx.lines[0].unusedQty, 2080);
    assert.equal(ctx.lines[0].netIssuedQty, 5200);
    assert.equal(ctx.lines[0].returnableQty, 2080);
    assert.equal(ctx.lines[0].canReturn, true);
  });
});

describe("production cap after RM return (readiness math)", () => {
  it("recalculates max FG from remaining production-held RM", () => {
    const perUnitPp = 5200 / 5000;
    const availableAfterReturn = computeUnusedIssuedRmQty(5200, 3120, 1000);
    assert.equal(availableAfterReturn, 1080);
    const maxFg = floorFgQty(availableAfterReturn, perUnitPp);
    assert.ok(maxFg < 3000);
    assert.ok(maxFg > 0);
  });
});
