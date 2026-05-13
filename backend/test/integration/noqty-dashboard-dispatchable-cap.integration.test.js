/**
 * Dashboard NO_QTY dispatchable qty must be capped by physical free USABLE stock.
 *
 * Regression: QC headroom can remain positive, but if ledger USABLE is 0 then dashboard must show 0
 * (no phantom optional dispatch).
 */
const { runIntegration } = require("./_integrationEnv");

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../../src/createApp");
const { prisma } = require("../../src/utils/prisma");
const { signAccessToken } = require("../../src/utils/jwt");

const d = runIntegration ? describe : describe.skip;

function adminAuth() {
  const token = signAccessToken({
    userId: 999003,
    email: "integration-admin3@test.local",
    role: "ADMIN",
    name: "Integration Admin 3",
  });
  return { Authorization: `Bearer ${token}` };
}

d("Dashboard NO_QTY dispatchable respects physical stock cap", () => {
  let app;
  let auth;
  /** @type {{ soId:number, itemId:number }} */
  let ctx;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    app = createApp();
    auth = adminAuth();

    const tag = `noqty_dash_cap_${Date.now()}`;
    const customer = await prisma.customer.create({ data: { name: `IntegCust_${tag}` } });
    const fg = await prisma.item.create({
      data: { itemName: `IntegFG_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
    });

    const so = await prisma.salesOrder.create({
      data: {
        customerId: customer.id,
        orderType: "NO_QTY",
        internalStatus: "IN_PROCESS",
        lines: { create: [{ itemId: fg.id, qty: "0", rate: "0" }] },
      },
      select: { id: true },
    });

    const cyc = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 1, status: "ACTIVE" },
      select: { id: true },
    });
    await prisma.salesOrder.update({ where: { id: so.id }, data: { currentCycleId: cyc.id } });

    // WO + QC accepted 100 => QC headroom positive on dashboard.
    const wo = await prisma.workOrder.create({
      data: { salesOrderId: so.id, cycleId: cyc.id, status: "APPROVED", docNo: `WO_${tag}` },
      select: { id: true },
    });
    const wol = await prisma.workOrderLine.create({
      data: { workOrderId: wo.id, fgItemId: fg.id, plannedQty: "0", qty: "1" },
      select: { id: true },
    });
    const pe = await prisma.productionEntry.create({
      data: { workOrderLineId: wol.id, workflowStatus: "APPROVED", producedQty: "0", qty: "0" },
      select: { id: true },
    });
    await prisma.qcEntry.create({
      data: { productionId: pe.id, acceptedQty: "100", rejectedQty: "0" },
    });

    // Physical USABLE exhausted: +100 then -100 dispatch.
    await prisma.stockTransaction.create({
      data: {
        itemId: fg.id,
        transactionType: "BUCKET_TRANSFER",
        stockBucket: "USABLE",
        qtyIn: "100",
        qtyOut: "0",
        reason: "Integration seed: recovery to usable",
      },
    });
    await prisma.stockTransaction.create({
      data: {
        itemId: fg.id,
        transactionType: "DISPATCH",
        stockBucket: "USABLE",
        qtyIn: "0",
        qtyOut: "100",
        reason: "Integration seed: already dispatched physical stock",
      },
    });

    ctx = { soId: so.id, itemId: fg.id };
  });

  it("does not show phantom NO_QTY dispatchable when physical usable is 0", async () => {
    const res = await request(app).get("/api/dashboard/production-queue").set(auth).expect(200);
    assert.ok(Array.isArray(res.body));
    const rows = res.body.filter((r) => Number(r.salesOrderId) === Number(ctx.soId) && Number(r.fgItemId) === Number(ctx.itemId));
    assert.ok(rows.length > 0, "expected at least one dashboard production-queue row for the NO_QTY WO line");
    for (const r of rows) {
      const dq = Number(r.dispatchableQty ?? 0);
      assert.equal(dq, 0);
    }
  });
});

