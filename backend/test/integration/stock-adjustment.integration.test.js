/**
 * Stock adjustment + reversal HTTP tests (MySQL + Prisma).
 * Run with: ERP_RUN_DB_INTEGRATION=1 INTEGRATION_DATABASE_URL=... npm run test:integration
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
require("dotenv").config({ path: path.join(__dirname, "../../.env.integration") });

if (process.env.ERP_RUN_DB_INTEGRATION === "1" && process.env.INTEGRATION_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
}

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");

const { createApp } = require("../../src/createApp");
const { prisma } = require("../../src/utils/prisma");
const { signAccessToken } = require("../../src/utils/jwt");
const { setStrictInventoryControl } = require("../../src/services/appSettings");
const { MSG } = require("../../src/services/stockAdjustmentPolicy");

const runIntegration = process.env.ERP_RUN_DB_INTEGRATION === "1";
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
    const sales = await prisma.user.upsert({
      where: { email: "stock_adj_integ_sales@test.local" },
      create: {
        email: "stock_adj_integ_sales@test.local",
        name: "SA Integ Sales",
        role: "SALES",
        passwordHash: hash,
        isActive: true,
      },
      update: { role: "SALES" },
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
    ctx = { admin, sales, itemId: item.id };
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

  it("POST adjustment 403 SALES", async () => {
    const res = await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(ctx.sales))
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
