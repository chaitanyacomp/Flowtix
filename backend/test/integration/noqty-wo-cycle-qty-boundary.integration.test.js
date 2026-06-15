/**
 * NO_QTY WO qty boundary: cycle-wise executable qty (requirementQty) vs cumulative planning (suggestedWoQtySnapshot).
 */
const { runIntegration } = require("./_integrationEnv");

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../../src/createApp");
const { prisma } = require("../../src/utils/prisma");
const { signAccessToken } = require("../../src/utils/jwt");
const { getRequirementComposition } = require("../../src/services/monthlyPlanningRequirementCompositionService");
const { getRsSuggestionsForPeriod } = require("../../src/services/monthlyPlanningRsSuggestionsService");
const { createWorkOrdersForPeriodRelease } = require("../../src/services/noQtyExecutionReleaseService");

const d = runIntegration ? describe : describe.skip;

function adminAuth() {
  const token = signAccessToken({
    userId: 999050,
    email: "noqty-wo-boundary@test.local",
    role: "ADMIN",
    name: "NO_QTY WO Boundary Admin",
  });
  return { Authorization: `Bearer ${token}` };
}

d("NO_QTY WO cycle-wise executable qty boundary", () => {
  let app;
  let auth;
  /** @type {{ customerId:number; fgId:number; soId:number; c1Id:number; c2Id:number; c1SheetId:number; c1WoId:number; c2SheetId:number }} */
  let ctx;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    app = createApp();
    auth = adminAuth();

    const tag = `noqty_wo_boundary_${Date.now()}`;
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

    const c1 = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 1, status: "ACTIVE" },
      select: { id: true },
    });
    await prisma.salesOrder.update({ where: { id: so.id }, data: { currentCycleId: c1.id } });

    const createRes = await request(app)
      .post(`/api/sales-orders/${so.id}/requirement-sheets`)
      .set(auth)
      .send({ periodKey: "2026-07", itemIds: [fg.id] })
      .expect(201);
    const c1SheetId = Number(createRes.body?.id ?? createRes.body?.sheetId ?? createRes.body?.requirementSheetId);
    assert.ok(Number.isFinite(c1SheetId) && c1SheetId > 0, "cycle 1 RS created");

    await request(app)
      .post(`/api/requirement-sheets/${c1SheetId}/recalculate`)
      .set(auth)
      .send({ lines: [{ itemId: fg.id, requirementQty: 10000 }] })
      .expect(200);

    await request(app).post(`/api/requirement-sheets/${c1SheetId}/lock`).set(auth).expect(200);

    const c1WoBeforeRelease = await prisma.workOrder.findFirst({
      where: { salesOrderId: so.id, cycleId: c1.id, requirementSheetId: c1SheetId },
    });
    assert.equal(c1WoBeforeRelease, null, "no WO at RS lock before plan release");

    await prisma.monthlyProductionPlan.create({
      data: {
        periodKey: "2026-07",
        planSequenceNo: 1,
        status: "APPROVED",
        currentRevision: 1,
        releasedAt: new Date(),
      },
    });

    await prisma.$transaction(async (tx) => createWorkOrdersForPeriodRelease(tx, { periodKey: "2026-07" }));

    const c1Wo = await prisma.workOrder.findFirst({
      where: { salesOrderId: so.id, cycleId: c1.id, requirementSheetId: c1SheetId },
      include: { lines: true },
    });
    assert.ok(c1Wo, "cycle 1 WO created at plan release");
    assert.equal(Number(c1Wo.lines[0].qty), 10000);

    const c1Line = await prisma.requirementSheetLine.findFirst({
      where: { sheetId: c1SheetId, itemId: fg.id },
    });
    assert.equal(Number(c1Line.requirementQty), 10000);
    assert.equal(Number(c1Line.suggestedWoQtySnapshot), 10000);

    await prisma.salesOrderCycle.update({
      where: { id: c1.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    const c2 = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 2, status: "ACTIVE" },
      select: { id: true },
    });
    await prisma.salesOrder.update({ where: { id: so.id }, data: { currentCycleId: c2.id } });

    const createC2 = await request(app)
      .post(`/api/sales-orders/${so.id}/requirement-sheets`)
      .set(auth)
      .send({ periodKey: "2026-07", itemIds: [fg.id] })
      .expect(201);
    const c2SheetId = Number(createC2.body?.id ?? createC2.body?.sheetId ?? createC2.body?.requirementSheetId);
    assert.ok(Number.isFinite(c2SheetId) && c2SheetId > 0, "cycle 2 RS created");

    await request(app)
      .post(`/api/requirement-sheets/${c2SheetId}/recalculate`)
      .set(auth)
      .send({ lines: [{ itemId: fg.id, requirementQty: 10000 }] })
      .expect(200);

    await request(app).post(`/api/requirement-sheets/${c2SheetId}/lock`).set(auth).expect(200);

    await prisma.$transaction(async (tx) => createWorkOrdersForPeriodRelease(tx, { periodKey: "2026-07" }));

    const c2WoCheck = await prisma.workOrder.findFirst({
      where: { salesOrderId: so.id, cycleId: c2.id, requirementSheetId: c2SheetId },
    });
    assert.ok(c2WoCheck, "cycle 2 WO created at plan release");

    ctx = {
      customerId: customer.id,
      fgId: fg.id,
      soId: so.id,
      c1Id: c1.id,
      c2Id: c2.id,
      c1SheetId,
      c1WoId: c1Wo.id,
      c2SheetId,
    };
  });

  after(async () => {
    if (!ctx) return;
    await prisma.monthlyProductionPlan.deleteMany({ where: { periodKey: "2026-07" } }).catch(() => {});
    await prisma.workOrderLine.deleteMany({
      where: { workOrder: { salesOrderId: ctx.soId } },
    });
    await prisma.workOrder.deleteMany({ where: { salesOrderId: ctx.soId } }).catch(() => {});
    await prisma.requirementSheetLine.deleteMany({
      where: { sheet: { salesOrderId: ctx.soId } },
    });
    await prisma.requirementSheet.deleteMany({ where: { salesOrderId: ctx.soId } }).catch(() => {});
    await prisma.salesOrderCycle.deleteMany({ where: { salesOrderId: ctx.soId } }).catch(() => {});
    await prisma.salesOrder.delete({ where: { id: ctx.soId } }).catch(() => {});
    await prisma.item.delete({ where: { id: ctx.fgId } }).catch(() => {});
    await prisma.customer.delete({ where: { id: ctx.customerId } }).catch(() => {});
  });

  it("Cycle 1 WO = 10,000 after plan release", async () => {
    const wo = await prisma.workOrder.findUnique({
      where: { id: ctx.c1WoId },
      include: { lines: true },
    });
    assert.equal(Number(wo.lines[0].qty), 10000);
    assert.equal(wo.status, "PENDING");
  });

  it("Cycle 2 WO = 10,000 while Cycle 1 WO still open (not 20,000)", async () => {
    const c1Wo = await prisma.workOrder.findUnique({ where: { id: ctx.c1WoId } });
    assert.equal(c1Wo.status, "PENDING");

    const c2Wo = await prisma.workOrder.findFirst({
      where: { salesOrderId: ctx.soId, cycleId: ctx.c2Id, requirementSheetId: ctx.c2SheetId },
      include: { lines: true },
    });
    assert.ok(c2Wo, "cycle 2 WO exists");
    assert.equal(Number(c2Wo.lines[0].qty), 10000);

    const c2Line = await prisma.requirementSheetLine.findFirst({
      where: { sheetId: ctx.c2SheetId, itemId: ctx.fgId },
    });
    assert.equal(Number(c2Line.requirementQty), 10000);
    assert.equal(Number(c2Line.suggestedWoQtySnapshot), 20000);
  });

  it("wo-prefill returns 10k executable qty, not cumulative 20k", async () => {
    const res = await request(app)
      .get(`/api/requirement-sheets/${ctx.c2SheetId}/wo-prefill`)
      .set(auth)
      .expect(200);
    const line = (res.body?.lines || []).find((l) => Number(l.fgItemId) === ctx.fgId);
    assert.ok(line);
    assert.equal(Number(line.qty), 10000);
  });

  it("manual create-wo is blocked when WO already exists from release", async () => {
    const res = await request(app)
      .post(`/api/requirement-sheets/${ctx.c2SheetId}/create-wo`)
      .set(auth)
      .expect(409);
    assert.match(String(res.body?.error?.message ?? res.body?.message ?? ""), /already created/i);

    const woCount = await prisma.workOrder.count({
      where: { salesOrderId: ctx.soId, cycleId: ctx.c2Id, requirementSheetId: ctx.c2SheetId },
    });
    assert.equal(woCount, 1);
    const wo = await prisma.workOrder.findFirst({
      where: { salesOrderId: ctx.soId, cycleId: ctx.c2Id, requirementSheetId: ctx.c2SheetId },
      include: { lines: true },
    });
    assert.equal(Number(wo.lines[0].qty), 10000);
  });

  it("MPRS cumulative suggested production remains 20,000", async () => {
    const db = {
      requirementSheet: {
        findMany: async () => {
          const sheets = await prisma.requirementSheet.findMany({
            where: {
              salesOrderId: ctx.soId,
              status: "LOCKED",
              periodKey: "2026-07",
            },
            include: {
              salesOrder: { select: { id: true, docNo: true, orderType: true } },
              cycle: { select: { id: true, cycleNo: true } },
              lines: {
                include: { item: { select: { id: true, itemName: true, itemType: true, unit: true } } },
              },
            },
            orderBy: [{ salesOrderId: "asc" }, { version: "desc" }],
          });
          return sheets;
        },
      },
    };
    const comp = await getRequirementComposition({
      db,
      periodKey: "2026-07",
      loadRsSuggestions: (opts) => getRsSuggestionsForPeriod(opts),
      loadGreenLevels: async () => ({ periodKey: "2026-07", items: [] }),
    });
    const item = comp.items.find((i) => i.itemId === ctx.fgId);
    assert.ok(item, "MPRS item row");
    assert.equal(item.suggestedProduction, 20000);
  });
});
