const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { prisma } = require("../../src/utils/prisma");
const {
  DEFAULT_RM_STORE_CODE,
  DEFAULT_FG_STORE_CODE,
  DEFAULT_CONSUMABLE_STORE_CODE,
  resolveAdjustmentLocationId,
  getDefaultRmStoreLocationId,
  findActiveLocationIdByCode,
} = require("../../src/services/locationService");
const { getAvailableRmAtLocation } = require("../../src/services/materialIssueService");

describe("stock adjustment location assignment", () => {
  /** @type {number[]} */
  const itemIds = [];
  /** @type {number[]} */
  const txnIds = [];

  async function locationIdForCode(code) {
    const id = await findActiveLocationIdByCode(prisma, code);
    assert.ok(id, `Expected active location ${code}`);
    return id;
  }

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  after(async () => {
    if (txnIds.length) {
      await prisma.stockTransaction.deleteMany({ where: { id: { in: txnIds } } });
    }
    if (itemIds.length) {
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    }
  });

  it("resolveAdjustmentLocationId preserves original locationId", async () => {
    const rmStoreId = await getDefaultRmStoreLocationId(prisma);
    const resolved = await resolveAdjustmentLocationId(prisma, {
      locationId: rmStoreId,
      itemType: "RM",
    });
    assert.equal(resolved, rmStoreId);
  });

  it("resolveAdjustmentLocationId resolves RM default when locationId is null", async () => {
    const rmStoreId = await getDefaultRmStoreLocationId(prisma);
    const resolved = await resolveAdjustmentLocationId(prisma, {
      locationId: null,
      itemType: "RM",
    });
    assert.equal(resolved, rmStoreId);
  });

  it("resolveAdjustmentLocationId resolves FG and CONSUMABLE defaults", async () => {
    const fgStoreId = await locationIdForCode(DEFAULT_FG_STORE_CODE);
    const consumableStoreId = await locationIdForCode(DEFAULT_CONSUMABLE_STORE_CODE);

    const fgResolved = await resolveAdjustmentLocationId(prisma, {
      locationId: null,
      itemType: "FG",
    });
    const consumableResolved = await resolveAdjustmentLocationId(prisma, {
      locationId: null,
      itemType: "CONSUMABLE",
    });

    assert.equal(fgResolved, fgStoreId);
    assert.equal(consumableResolved, consumableStoreId);
  });

  it("RM adjustment at RM Store is visible to Material Issue availability", async () => {
    const rmStoreId = await getDefaultRmStoreLocationId(prisma);
    const tag = `adj_loc_${Date.now()}`;
    const item = await prisma.item.create({
      data: { itemName: `AdjLoc_${tag}`, itemType: "RM", unit: "KG", minStockLevel: "0" },
    });
    itemIds.push(item.id);

    const txn = await prisma.stockTransaction.create({
      data: {
        itemId: item.id,
        locationId: rmStoreId,
        transactionType: "ADJUSTMENT",
        refId: 0,
        stockBucket: "USABLE",
        qtyIn: "25",
        qtyOut: "0",
        reason: "unit test",
      },
    });
    txnIds.push(txn.id);

    const availability = await getAvailableRmAtLocation(item.id, rmStoreId, prisma);
    assert.equal(availability.physicalUsableStockQty, 25);
    assert.equal(availability.available, 25);
  });

  it("legacy null-location RM adjustment is not visible at RM Store until repaired", async () => {
    const rmStoreId = await getDefaultRmStoreLocationId(prisma);
    const tag = `adj_null_${Date.now()}`;
    const item = await prisma.item.create({
      data: { itemName: `AdjNull_${tag}`, itemType: "RM", unit: "KG", minStockLevel: "0" },
    });
    itemIds.push(item.id);

    const txn = await prisma.stockTransaction.create({
      data: {
        itemId: item.id,
        locationId: null,
        transactionType: "ADJUSTMENT",
        refId: 0,
        stockBucket: "USABLE",
        qtyIn: "15",
        qtyOut: "0",
        reason: "legacy null fixture",
      },
    });
    txnIds.push(txn.id);

    const availability = await getAvailableRmAtLocation(item.id, rmStoreId, prisma);
    assert.equal(availability.physicalUsableStockQty, 0);
    assert.equal(availability.available, 0);
  });
});
