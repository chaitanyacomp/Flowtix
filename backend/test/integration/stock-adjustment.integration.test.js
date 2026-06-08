/**
 * Stock adjustment + reversal HTTP tests (MySQL + Prisma).
 * Run with: NODE_ENV=test TEST_DATABASE_URL=... npm run test:integration:db
 */

const { runIntegration } = require("./_integrationEnv");

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");

const { createApp } = require("../../src/createApp");
const { prisma } = require("../../src/utils/prisma");
const { signAccessToken } = require("../../src/utils/jwt");
const { setStrictInventoryControl } = require("../../src/services/appSettings");
const { MSG } = require("../../src/services/stockAdjustmentPolicy");
const {
  DEFAULT_RM_STORE_CODE,
  DEFAULT_FG_STORE_CODE,
  DEFAULT_CONSUMABLE_STORE_CODE,
  findActiveLocationIdByCode,
} = require("../../src/services/locationService");
const { getAvailableRmAtLocation } = require("../../src/services/materialIssueService");

const d = runIntegration ? describe : describe.skip;

function bearer(user) {
  const token = signAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  });
  return { Authorization: `Bearer ${token}` };
}

d("Stock adjustment API (immutable + reversal)", () => {
  const app = createApp();
  /** @type {{ admin: import("@prisma/client").User, sales: import("@prisma/client").User, itemId: number, forwardId?: number }} */
  let ctx;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const hash = await bcrypt.hash("x", 4);
    const admin = await prisma.user.upsert({
      where: { email: "stock_adj_integ_admin@test.local" },
      create: {
        email: "stock_adj_integ_admin@test.local",
        name: "SA Integ Admin",
        role: "ADMIN",
        passwordHash: hash,
        isActive: true,
      },
      update: { role: "ADMIN" },
    });
    const purchase = await prisma.user.upsert({
      where: { email: "stock_adj_integ_purchase@test.local" },
      create: {
        email: "stock_adj_integ_purchase@test.local",
        name: "SA Integ Purchase",
        role: "PURCHASE",
        passwordHash: hash,
        isActive: true,
      },
      update: { role: "PURCHASE" },
    });
    const store = await prisma.user.upsert({
      where: { email: "stock_adj_integ_store@test.local" },
      create: {
        email: "stock_adj_integ_store@test.local",
        name: "SA Integ Store",
        role: "STORE",
        passwordHash: hash,
        isActive: true,
      },
      update: { role: "STORE" },
    });
    const tag = `sa_${Date.now()}`;
    const item = await prisma.item.create({
      data: { itemName: `IntegAdj_${tag}`, itemType: "RM", unit: "KG", minStockLevel: "0" },
    });
    await setStrictInventoryControl(false);
    ctx = { admin, purchase, itemId: item.id };
  });

  after(async () => {
    if (!ctx?.itemId) return;
    await prisma.stockTransaction.deleteMany({ where: { itemId: ctx.itemId } });
    await prisma.item.delete({ where: { id: ctx.itemId } }).catch(() => {});
    await setStrictInventoryControl(false);
  });

  it("POST /api/stock/adjustment 201 with reason + createdBy", async () => {
    const res = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.itemId, qtyIn: 10, qtyOut: 0, reason: "cycle count" });
    assert.equal(res.status, 201);
    assert.equal(res.body?.transactionType, "ADJUSTMENT");
    assert.equal(Number(res.body?.qtyIn), 10);
    assert.equal(res.body?.reason, "cycle count");
    ctx.forwardId = res.body.id;
  });

  it("POST /api/stock-adjustment alias same validation (201)", async () => {
    const res = await request(app)
      .post("/api/stock-adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.itemId, qtyIn: 1, qtyOut: 0, reason: "alias check" });
    assert.equal(res.status, 201);
    assert.equal(res.body?.reason, "alias check");
  });

  it("POST adjustment 401 without auth", async () => {
    const res = await request(app).post("/api/stock/adjustment").send({
      itemId: ctx.itemId,
      qtyIn: 1,
      qtyOut: 0,
      reason: "x",
    });
    assert.equal(res.status, 401);
  });

  it("POST adjustment 403 PURCHASE", async () => {
    const res = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.purchase))
      .send({ itemId: ctx.itemId, qtyIn: 1, qtyOut: 0, reason: "nope" });
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.message, "Access denied. Only Admin and Store roles can post stock adjustments.");
  });

  it("POST adjustment 400 without reason", async () => {
    const res = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.itemId, qtyIn: 1, qtyOut: 0, reason: "   " });
    assert.equal(res.status, 400);
    assert.equal(res.body?.error?.message, "Reason is required");
  });

  it("POST adjustment 400 stock cannot go negative", async () => {
    const res = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.itemId, qtyIn: 0, qtyOut: 999999, reason: "drain" });
    assert.equal(res.status, 400);
    assert.equal(res.body?.error?.message, "Stock cannot go negative");
  });

  it("POST reverse 201", async () => {
    assert.ok(ctx.forwardId);
    const res = await request(app)
      .post(`/api/stock/adjustments/${ctx.forwardId}/reverse`)
      .set(bearer(ctx.admin))
      .send({ reason: "wrong qty" });
    assert.equal(res.status, 201);
    assert.ok(res.body?.original?.reversedAt);
    assert.equal(res.body?.reversal?.reversalOfId, ctx.forwardId);
  });

  it("POST reverse twice → Adjustment already reversed", async () => {
    const res = await request(app)
      .post(`/api/stock/adjustments/${ctx.forwardId}/reverse`)
      .set(bearer(ctx.admin))
      .send({ reason: "again" });
    assert.equal(res.status, 400);
    assert.equal(res.body?.error?.message, "Adjustment already reversed");
  });

  it("POST reverse on reversal row blocked", async () => {
    const rev = await prisma.stockTransaction.findFirst({
      where: { reversalOfId: ctx.forwardId },
    });
    assert.ok(rev);
    const res = await request(app)
      .post(`/api/stock/adjustments/${rev.id}/reverse`)
      .set(bearer(ctx.admin))
      .send({ reason: "nope" });
    assert.equal(res.status, 400);
    assert.equal(res.body?.error?.message, "Reversal not allowed for this transaction");
  });

  it("POST reverse non-ADJUSTMENT row blocked", async () => {
    const grn = await prisma.stockTransaction.create({
      data: {
        itemId: ctx.itemId,
        transactionType: "GRN",
        refId: 0,
        qtyIn: "1",
        qtyOut: "0",
      },
    });
    const res = await request(app)
      .post(`/api/stock/adjustments/${grn.id}/reverse`)
      .set(bearer(ctx.admin))
      .send({ reason: "x" });
    assert.equal(res.status, 400);
    assert.equal(res.body?.error?.message, "Reversal not allowed for this transaction");
    await prisma.stockTransaction.delete({ where: { id: grn.id } });
  });

  it("strict inventory blocks POST adjustment", async () => {
    await setStrictInventoryControl(true);
    const res = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.itemId, qtyIn: 1, qtyOut: 0, reason: "strict" });
    assert.equal(res.status, 403);
    assert.match(res.body?.error?.message ?? "", /strict inventory/i);
    await setStrictInventoryControl(false);
  });

  it("POST adjustment 403 STORE when create roles ADMIN_ONLY", async () => {
    await prisma.appSetting.update({
      where: { id: 1 },
      data: { stockAdjustmentCreateRoles: "ADMIN_ONLY" },
    });
    try {
      const res = await request(app)
        .post("/api/stock/adjustment")
        .set(bearer(ctx.store))
        .send({ itemId: ctx.itemId, qtyIn: 2, qtyOut: 0, reason: "store try" });
      assert.equal(res.status, 403);
      assert.equal(res.body?.error?.message, MSG.createRole);
    } finally {
      await resetStockAdjustmentPolicyDefaults();
    }
  });

  it("POST reverse 403 STORE when reverse roles ADMIN_ONLY", async () => {
    const create = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.itemId, qtyIn: 5, qtyOut: 0, reason: "for store reverse test" });
    assert.equal(create.status, 201);
    const fid = create.body.id;
    try {
      const res = await request(app)
        .post(`/api/stock/adjustments/${fid}/reverse`)
        .set(bearer(ctx.store))
        .send({ reason: "store reverse" });
      assert.equal(res.status, 403);
      assert.equal(res.body?.error?.message, MSG.reverseRole);
    } finally {
      await request(app)
        .post(`/api/stock/adjustments/${fid}/reverse`)
        .set(bearer(ctx.admin))
        .send({ reason: "cleanup" });
    }
  });

  it("POST reverse 201 STORE when reverse roles ADMIN_AND_STORE", async () => {
    await prisma.appSetting.update({
      where: { id: 1 },
      data: { stockAdjustmentReverseRoles: "ADMIN_AND_STORE" },
    });
    const create = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.itemId, qtyIn: 3, qtyOut: 0, reason: "for store reverse ok" });
    assert.equal(create.status, 201);
    const fid = create.body.id;
    try {
      const res = await request(app)
        .post(`/api/stock/adjustments/${fid}/reverse`)
        .set(bearer(ctx.store))
        .send({ reason: "store reverse ok" });
      assert.equal(res.status, 201);
      assert.ok(res.body?.original?.reversedAt);
    } finally {
      await resetStockAdjustmentPolicyDefaults();
    }
  });

  it("POST reverse 400 after HOURS window", async () => {
    await prisma.appSetting.update({
      where: { id: 1 },
      data: {
        stockAdjustmentReverseWindowType: "HOURS",
        stockAdjustmentReverseWindowValue: 1,
      },
    });
    const create = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.itemId, qtyIn: 1, qtyOut: 0, reason: "old adj" });
    assert.equal(create.status, 201);
    const fid = create.body.id;
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    await prisma.stockTransaction.update({
      where: { id: fid },
      data: { date: twoHoursAgo },
    });
    try {
      const res = await request(app)
        .post(`/api/stock/adjustments/${fid}/reverse`)
        .set(bearer(ctx.admin))
        .send({ reason: "late" });
      assert.equal(res.status, 400);
      assert.equal(res.body?.error?.message, MSG.hours);
    } finally {
      await prisma.appSetting.update({
        where: { id: 1 },
        data: { stockAdjustmentReverseWindowType: "NO_LIMIT" },
      });
      await request(app)
        .post(`/api/stock/adjustments/${fid}/reverse`)
        .set(bearer(ctx.admin))
        .send({ reason: "cleanup after window test" });
      await resetStockAdjustmentPolicyDefaults();
    }
  });
});

d("Stock adjustment location posting", () => {
  const app = createApp();
  /** @type {{ admin: import("@prisma/client").User, rmItemId: number, fgItemId: number, consumableItemId: number }} */
  let ctx;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const hash = await bcrypt.hash("x", 4);
    const admin = await prisma.user.upsert({
      where: { email: "stock_adj_loc_admin@test.local" },
      create: {
        email: "stock_adj_loc_admin@test.local",
        name: "SA Loc Admin",
        role: "ADMIN",
        passwordHash: hash,
        isActive: true,
      },
      update: { role: "ADMIN" },
    });
    const tag = `adjloc_${Date.now()}`;
    const [rmItem, fgItem, consumableItem] = await Promise.all([
      prisma.item.create({
        data: { itemName: `AdjLocRm_${tag}`, itemType: "RM", unit: "KG", minStockLevel: "0" },
      }),
      prisma.item.create({
        data: { itemName: `AdjLocFg_${tag}`, itemType: "FG", unit: "NOS", minStockLevel: "0" },
      }),
      prisma.item.create({
        data: { itemName: `AdjLocCon_${tag}`, itemType: "CONSUMABLE", unit: "NOS", minStockLevel: "0" },
      }),
    ]);
    await setStrictInventoryControl(false);
    ctx = { admin, rmItemId: rmItem.id, fgItemId: fgItem.id, consumableItemId: consumableItem.id };
  });

  after(async () => {
    if (!ctx) return;
    const ids = [ctx.rmItemId, ctx.fgItemId, ctx.consumableItemId];
    await prisma.stockTransaction.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.item.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  });

  it("POST adjustment assigns RM Store for RM items", async () => {
    const rmStoreId = await findActiveLocationIdByCode(prisma, DEFAULT_RM_STORE_CODE);
    assert.ok(rmStoreId);
    const res = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.rmItemId, qtyIn: 12, qtyOut: 0, reason: "rm loc" });
    assert.equal(res.status, 201);
    assert.equal(res.body?.locationId, rmStoreId);
  });

  it("POST adjustment assigns FG Store for FG items", async () => {
    const fgStoreId = await findActiveLocationIdByCode(prisma, DEFAULT_FG_STORE_CODE);
    assert.ok(fgStoreId);
    const res = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.fgItemId, qtyIn: 4, qtyOut: 0, reason: "fg loc" });
    assert.equal(res.status, 201);
    assert.equal(res.body?.locationId, fgStoreId);
  });

  it("POST adjustment assigns Consumable Store for CONSUMABLE items", async () => {
    const consumableStoreId = await findActiveLocationIdByCode(prisma, DEFAULT_CONSUMABLE_STORE_CODE);
    assert.ok(consumableStoreId);
    const res = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.consumableItemId, qtyIn: 6, qtyOut: 0, reason: "consumable loc" });
    assert.equal(res.status, 201);
    assert.equal(res.body?.locationId, consumableStoreId);
  });

  it("POST reverse copies forward adjustment locationId", async () => {
    const rmStoreId = await findActiveLocationIdByCode(prisma, DEFAULT_RM_STORE_CODE);
    const create = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.admin))
      .send({ itemId: ctx.rmItemId, qtyIn: 7, qtyOut: 0, reason: "reverse loc forward" });
    assert.equal(create.status, 201);
    assert.equal(create.body?.locationId, rmStoreId);
    const reverse = await request(app)
      .post(`/api/stock/adjustments/${create.body.id}/reverse`)
      .set(bearer(ctx.admin))
      .send({ reason: "reverse loc" });
    assert.equal(reverse.status, 201);
    assert.equal(reverse.body?.reversal?.locationId, rmStoreId);
  });

  it("POST reverse on legacy null forward resolves default RM Store location", async () => {
    const rmStoreId = await findActiveLocationIdByCode(prisma, DEFAULT_RM_STORE_CODE);
    const forward = await prisma.stockTransaction.create({
      data: {
        itemId: ctx.rmItemId,
        locationId: null,
        transactionType: "ADJUSTMENT",
        refId: 0,
        stockBucket: "USABLE",
        qtyIn: "9",
        qtyOut: "0",
        reason: "legacy null forward",
      },
    });
    const reverse = await request(app)
      .post(`/api/stock/adjustments/${forward.id}/reverse`)
      .set(bearer(ctx.admin))
      .send({ reason: "legacy null reverse" });
    assert.equal(reverse.status, 201);
    assert.equal(reverse.body?.reversal?.locationId, rmStoreId);
  });

  it("RM adjustment at RM Store is visible to material issue availability", async () => {
    const rmStoreId = await findActiveLocationIdByCode(prisma, DEFAULT_RM_STORE_CODE);
    const tag = `mi_avail_${Date.now()}`;
    const item = await prisma.item.create({
      data: { itemName: `AdjMi_${tag}`, itemType: "RM", unit: "KG", minStockLevel: "0" },
    });
    try {
      const create = await request(app)
        .post("/api/stock/adjustment")
        .set(bearer(ctx.admin))
        .send({ itemId: item.id, qtyIn: 18, qtyOut: 0, reason: "mi avail" });
      assert.equal(create.status, 201);
      assert.equal(create.body?.locationId, rmStoreId);
      const availability = await getAvailableRmAtLocation(item.id, rmStoreId, prisma);
      assert.equal(availability.physicalUsableStockQty, 18);
      assert.equal(availability.available, 18);
    } finally {
      await prisma.stockTransaction.deleteMany({ where: { itemId: item.id } });
      await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    }
  });
});
