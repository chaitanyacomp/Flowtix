/**
 * NO_QTY dispatchable must be capped by physical free USABLE stock.
 *
 * Regression: cycle QC headroom can remain positive due to cycle attribution mismatches,
 * but physical USABLE may already be exhausted by dispatch. In that case, Optional Dispatch
 * must be 0 (no phantom availability).
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
    userId: 999002,
    email: "integration-admin2@test.local",
    role: "ADMIN",
    name: "Integration Admin 2",
  });
  return { Authorization: `Bearer ${token}` };
}

d("NO_QTY dispatchable capped by physical USABLE", () => {
  let app;
  let auth;
  /** @type {{ soId:number, itemId:number, cycleId:number }} */
  let ctx;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    app = createApp();
    auth = adminAuth();

    const tag = `noqty_disp_cap_${Date.now()}`;
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

    // Create a work order + production + QC accepted 100 (creates QC headroom).
    const wo = await prisma.workOrder.create({
      data: { salesOrderId: so.id, cycleId: cyc.id, status: "APPROVED", docNo: `WO_${tag}` },
      select: { id: true },
    });
    const wol = await prisma.workOrderLine.create({
      data: { workOrderId: wo.id, fgItemId: fg.id, plannedQty: "0", qty: "0" },
      select: { id: true },
    });
    const pe = await prisma.productionEntry.create({
      data: { workOrderLineId: wol.id, workflowStatus: "APPROVED", qty: "0" },
      select: { id: true },
    });
    await prisma.qcEntry.create({
      data: { productionId: pe.id, acceptedQty: "100", rejectedQty: "0" },
    });

    // Physical stock is already exhausted: +100 to USABLE then -100 DISPATCH.
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

    ctx = { soId: so.id, itemId: fg.id, cycleId: cyc.id };
  });

  it("caps NO_QTY cycle dispatchable by free physical USABLE", async () => {
    const res = await request(app)
      .get(`/api/dispatch/no-qty-cycles?soId=${ctx.soId}`)
      .set(auth)
      .expect(200);

    assert.ok(res.body);
    assert.ok(Array.isArray(res.body.cycles));
    const cyc = res.body.cycles.find((c) => Number(c.cycleId) === Number(ctx.cycleId));
    assert.ok(cyc, "expected active cycle in /no-qty-cycles response");

    // QC headroom is 100, but physical USABLE is 0 => must show 0.
    assert.equal(Number(cyc.dispatchableQty), 0);
  });
});

