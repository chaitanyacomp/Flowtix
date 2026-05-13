/**
 * NO_QTY Create Next RS: Dashboard/list eligibility must match prepare-next-requirement-sheet gates
 * (ACTIVE cycle + same computeNoQtyCreateNextRsEligibility), not SalesOrder.currentCycleId alone.
 */
const { runIntegration } = require("./_integrationEnv");

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../../src/createApp");
const { prisma } = require("../../src/utils/prisma");
const { signAccessToken } = require("../../src/utils/jwt");
const { repairNoQtyCycleIntegrity } = require("../../src/services/noQtyCycleLifecycle");
const {
  computeNoQtyCreateNextRsEligibility,
  computeNoQtyCreateNextRsEligibilityResolved,
} = require("../../src/services/noQtyCreateNextRsEligibility");

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

/** Same eligibility read as prepare-next-requirement-sheet after repair, without committing advance. */
async function peekPrepareNextRsEligibility(soId) {
  let peek = { eligible: false, reason: "NO_TX" };
  try {
    await prisma.$transaction(async (tx) => {
      await repairNoQtyCycleIntegrity(tx, soId);
      const active = await tx.salesOrderCycle.findFirst({
        where: { salesOrderId: soId, status: "ACTIVE" },
        orderBy: { cycleNo: "desc" },
        select: { id: true },
      });
      peek = active
        ? await computeNoQtyCreateNextRsEligibility(tx, { salesOrderId: soId, cycleId: active.id })
        : { eligible: false, reason: "NO_ACTIVE_CYCLE", existingNextRsDocNo: null, existingNextRsId: null };
      const err = new Error("__INTEGRATION_ABORT_TX__");
      err.code = "__INTEGRATION_ABORT_TX__";
      throw err;
    });
  } catch (e) {
    if (e.code !== "__INTEGRATION_ABORT_TX__") throw e;
  }
  return peek;
}

async function seedNoQtySoStalePointer({ staleMode }) {
  const tag = `nq_rs_${Date.now()}`;
  const customer = await prisma.customer.create({ data: { name: `IntegCust_${tag}` } });
  const fg = await prisma.item.create({
    data: { itemName: `IntegFG_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
  });

  const so = await prisma.salesOrder.create({
    data: {
      customerId: customer.id,
      orderType: "NO_QTY",
      internalStatus: "OPEN",
      lines: { create: [{ itemId: fg.id, qty: "0", rate: "0" }] },
    },
    select: { id: true },
  });

  const c1 = await prisma.salesOrderCycle.create({
    data: {
      salesOrderId: so.id,
      cycleNo: 1,
      status: "CLOSED",
      closedAt: new Date(),
    },
    select: { id: true },
  });

  const c2 = await prisma.salesOrderCycle.create({
    data: { salesOrderId: so.id, cycleNo: 2, status: "ACTIVE" },
    select: { id: true },
  });

  if (staleMode === "wrong_pointer") {
    await prisma.salesOrder.update({ where: { id: so.id }, data: { currentCycleId: c1.id } });
  } else if (staleMode === "null_pointer") {
    await prisma.salesOrder.update({ where: { id: so.id }, data: { currentCycleId: null } });
  }

  const periodKey = tag.slice(0, 16);
  const rs = await prisma.requirementSheet.create({
    data: {
      salesOrderId: so.id,
      cycleId: c2.id,
      periodKey,
      version: 1,
      status: "LOCKED",
      docNo: `RS_${tag}`,
    },
    select: { id: true },
  });

  const wo = await prisma.workOrder.create({
    data: {
      salesOrderId: so.id,
      cycleId: c2.id,
      requirementSheetId: rs.id,
      status: "IN_PROGRESS",
      docNo: `WO_${tag}`,
    },
    select: { id: true },
  });

  const wol = await prisma.workOrderLine.create({
    data: { workOrderId: wo.id, fgItemId: fg.id, plannedQty: "10", qty: "10" },
    select: { id: true },
  });

  const pe = await prisma.productionEntry.create({
    data: {
      workOrderLineId: wol.id,
      workflowStatus: "APPROVED",
      producedQty: "10",
    },
    select: { id: true },
  });

  await prisma.qcEntry.create({
    data: { productionId: pe.id, acceptedQty: "10", rejectedQty: "0", lossQty: "0" },
  });

  return { soId: so.id, cycle2Id: c2.id, staleMode };
}

d("NO_QTY Create Next RS eligibility (Dashboard vs prepare)", () => {
  let app;
  let auth;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    app = createApp();
    auth = adminAuth();
  });

  for (const staleMode of ["wrong_pointer", "null_pointer"]) {
    it(`GET /sales-orders matches prepare peek when currentCycleId is ${staleMode}`, async () => {
      const ctx = await seedNoQtySoStalePointer({ staleMode });

      const resolved = await computeNoQtyCreateNextRsEligibilityResolved(prisma, ctx.soId);
      const preparePeek = await peekPrepareNextRsEligibility(ctx.soId);

      assert.equal(
        resolved.eligible,
        preparePeek.eligible,
        `computeNoQtyCreateNextRsEligibilityResolved eligible (${resolved.reason}) vs prepare peek (${preparePeek.reason})`,
      );
      assert.equal(resolved.reason, preparePeek.reason);

      const listRes = await request(app).get("/api/sales-orders").set(auth).expect(200);
      const row = listRes.body.find((r) => Number(r.id) === Number(ctx.soId));
      assert.ok(row, "expected SO in sales order list");
      assert.equal(row.orderType, "NO_QTY");
      assert.equal(row.noQtyCreateNextRsEligible, preparePeek.eligible);
      assert.equal(row.noQtyCreateNextRsEligible, resolved.eligible);

      assert.equal(resolved.eligible, true, "seed must produce eligible next-RS state on ACTIVE cycle 2");
    });
  }
});
