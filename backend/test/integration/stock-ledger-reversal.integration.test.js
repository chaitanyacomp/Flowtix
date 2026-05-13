/**
 * Stock ledger + summary consistency when dispatch / QC are reversed (MySQL + Prisma + HTTP).
 * Run with: NODE_ENV=test TEST_DATABASE_URL=... npm run test:integration:db
 */

const { runIntegration } = require("./_integrationEnv");

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");

const { createApp } = require("../../src/createApp");
const { prisma } = require("../../src/utils/prisma");
const { signAccessToken } = require("../../src/utils/jwt");

const d = runIntegration ? describe : describe.skip;

const EPS = 1e-4;

/**
 * @param {{ id: number; email: string; role: string; name: string }} user
 */
function bearer(user) {
  const token = signAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  });
  return { Authorization: `Bearer ${token}` };
}

/**
 * @param {import('supertest').SuperTest<import('supertest').Test>} app
 */
async function getLedgerAsc(app, auth, itemId) {
  const res = await request(app)
    .get("/api/stock/ledger")
    .query({ itemId, sort: "asc", pageSize: 200 })
    .set(auth)
    .expect(200);
  return res.body;
}

/**
 * @param {import('supertest').SuperTest<import('supertest').Test>} app
 */
async function getUsableFromSummary(app, auth, itemId) {
  const res = await request(app).get("/api/stock/summary-buckets").set(auth).expect(200);
  const row = res.body.find((r) => Number(r.itemId) === Number(itemId));
  return row ? Number(row.usableQty) : 0;
}

/**
 * Net qtyIn − qtyOut for ledger rows matching filters (full ledger; no reversedAt filter).
 * @param {Array<{ transactionType: string; stockBucket?: string; qtyIn: unknown; qtyOut: unknown }>} items
 */
function netFor(items, { transactionTypes, stockBucket } = {}) {
  let s = 0;
  for (const r of items) {
    if (transactionTypes && !transactionTypes.has(r.transactionType)) continue;
    if (stockBucket && String(r.stockBucket) !== stockBucket) continue;
    s += Number(r.qtyIn || 0) - Number(r.qtyOut || 0);
  }
  return s;
}

/**
 * Net qty by stockBucket from ledger rows (includes all rows; no reversedAt filter — matches summary-buckets).
 * @param {Array<{ stockBucket?: string; qtyIn: unknown; qtyOut: unknown }>} items
 */
function ledgerNetByBucket(items) {
  const b = { USABLE: 0, QC_HOLD: 0, QC_PENDING: 0, REWORK: 0, SCRAP: 0 };
  for (const r of items || []) {
    const key = String(r.stockBucket || "USABLE");
    if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
    b[key] += Number(r.qtyIn || 0) - Number(r.qtyOut || 0);
  }
  return b;
}

/** StockTransaction self-FK on reversalOfId: delete reversal rows before originals. */
async function deleteStockTransactionsForItem(itemId) {
  await prisma.stockTransaction.deleteMany({
    where: { itemId, reversalOfId: { not: null } },
  });
  await prisma.stockTransaction.deleteMany({ where: { itemId } });
}

/** Dispatch self-FK on reversalOfId: delete reversal rows before forwards. */
async function deleteDispatchesForSo(soId) {
  await prisma.dispatch.deleteMany({
    where: { soId, reversalOfId: { not: null } },
  });
  await prisma.dispatch.deleteMany({ where: { soId } });
}

d("Stock ledger reversal consistency", () => {
  const app = createApp();

  /** @type {{ admin: import("@prisma/client").User }} */
  let authCtx;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const hash = await bcrypt.hash("x", 4);
    const admin = await prisma.user.upsert({
      where: { email: "stock_ledger_rev_integ_admin@test.local" },
      create: {
        email: "stock_ledger_rev_integ_admin@test.local",
        name: "Ledger Rev Integ Admin",
        role: "ADMIN",
        passwordHash: hash,
        isActive: true,
      },
      update: { role: "ADMIN" },
    });
    authCtx = { admin };
  });

  it("Test 1: FG opening + dispatch 30 + full reverse → USABLE 100, ledger + reversalOfId", async () => {
    const tag = `t1_${Date.now()}`;
    const customer = await prisma.customer.create({ data: { name: `LRev_${tag}` } });
    const fg = await prisma.item.create({
      data: { itemName: `FG_LRev1_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
    });
    const so = await prisma.salesOrder.create({
      data: {
        customerId: customer.id,
        internalStatus: "APPROVED",
        lines: {
          create: [{ itemId: fg.id, qty: "500", customerPoQty: "500" }],
        },
      },
    });

    const os = await prisma.openingStockEntry.create({
      data: {
        itemId: fg.id,
        stockBucket: "USABLE",
        openingQty: "100",
        status: "DRAFT",
      },
    });
    await request(app)
      .post(`/api/opening-stock/${os.id}/approve`)
      .set(bearer(authCtx.admin))
      .send({ adminPassword: "x" })
      .expect(200);

    const draft = await request(app)
      .post("/api/dispatch/dispatches")
      .set(bearer(authCtx.admin))
      .send({ soId: so.id, itemId: fg.id, dispatchedQty: 30 })
      .expect(201);
    const dispatchId = draft.body.dispatch.id;

    await request(app)
      .post(`/api/dispatch/dispatches/${dispatchId}/lock`)
      .set(bearer(authCtx.admin))
      .expect(200);

    await request(app)
      .post("/api/dispatch/reverse")
      .set(bearer(authCtx.admin))
      .send({ dispatchId, reverseQty: 30, reason: "integration full reverse" })
      .expect(201);

    const usable = await getUsableFromSummary(app, bearer(authCtx.admin), fg.id);
    assert.ok(Math.abs(usable - 100) < EPS, `expected usable ~100, got ${usable}`);

    const ledger = await getLedgerAsc(app, bearer(authCtx.admin), fg.id);
    const items = ledger.items || [];
    const types = new Set(items.map((r) => r.transactionType));
    assert.ok(types.has("OPENING"), `missing OPENING, got ${[...types].join(",")}`);
    assert.ok(types.has("DISPATCH"), "missing DISPATCH");
    assert.ok(types.has("DISPATCH_REVERSAL"), "missing DISPATCH_REVERSAL");

    const last = items[items.length - 1];
    assert.ok(last?.runningUsableAfter != null);
    assert.ok(Math.abs(Number(last.runningUsableAfter) - 100) < EPS);

    const revSt = await prisma.stockTransaction.findFirst({
      where: { itemId: fg.id, transactionType: "DISPATCH_REVERSAL" },
    });
    assert.ok(revSt);
    assert.ok(revSt.reversalOfId != null);

    await deleteStockTransactionsForItem(fg.id);
    await prisma.openingStockEntry.deleteMany({ where: { itemId: fg.id } });
    await deleteDispatchesForSo(so.id);
    await prisma.salesOrder.delete({ where: { id: so.id } });
    await prisma.item.delete({ where: { id: fg.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
  });

  it("Test 2: QC accept + reject (QC_HOLD) + qc-reverse → net QC buckets 0, reversalOfId set", async () => {
    const tag = `t2_${Date.now()}`;
    const customer = await prisma.customer.create({ data: { name: `LRev2_${tag}` } });
    const fg = await prisma.item.create({
      data: { itemName: `FG_LRev2_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
    });
    const so = await prisma.salesOrder.create({
      data: {
        customerId: customer.id,
        internalStatus: "APPROVED",
        lines: {
          create: [{ itemId: fg.id, qty: "200", customerPoQty: "200" }],
        },
      },
    });
    const wo = await prisma.workOrder.create({
      data: {
        salesOrderId: so.id,
        status: "PENDING",
        lines: { create: [{ fgItemId: fg.id, qty: "100", plannedQty: "100" }] },
      },
      include: { lines: true },
    });
    const wol = wo.lines[0];

    const peRes = await request(app)
      .post("/api/production/production-entries")
      .set(bearer(authCtx.admin))
      .send({ workOrderLineId: wol.id, producedQty: 50 })
      .expect(201);
    const peId = peRes.body.prod?.id;
    assert.ok(peId, "production entry id");

    await request(app)
      .post(`/api/production/production-entries/${peId}/approve`)
      .set(bearer(authCtx.admin))
      .expect(200);

    const qcRes = await request(app)
      .post("/api/production/qc-entries")
      .set(bearer(authCtx.admin))
      .send({
        productionId: peId,
        checkedQty: 50,
        rejectedQty: 5,
        rejectedStockBucket: "QC_HOLD",
        reason: "integ",
      })
      .expect(201);
    const qcEntryId = qcRes.body.id;

    const ledgerBefore = await getLedgerAsc(app, bearer(authCtx.admin), fg.id);
    const netUsableQcBefore = netFor(ledgerBefore.items || [], {
      transactionTypes: new Set(["QC", "QC_REVERSAL"]),
      stockBucket: "USABLE",
    });
    const netHoldQcBefore = netFor(ledgerBefore.items || [], {
      transactionTypes: new Set(["QC", "QC_REVERSAL"]),
      stockBucket: "QC_HOLD",
    });
    assert.ok(Math.abs(netUsableQcBefore - 45) < EPS, `before reverse USABLE QC net ${netUsableQcBefore}`);
    assert.ok(Math.abs(netHoldQcBefore - 5) < EPS, `before reverse QC_HOLD QC net ${netHoldQcBefore}`);

    await request(app)
      .post("/api/production/qc-reverse")
      .set(bearer(authCtx.admin))
      .send({ qcEntryId, reason: "integration qc reverse" })
      .expect(201);

    const ledgerAfter = await getLedgerAsc(app, bearer(authCtx.admin), fg.id);
    const items = ledgerAfter.items || [];
    const types = new Set(items.map((r) => r.transactionType));
    assert.ok(types.has("QC"), "missing QC");
    assert.ok(types.has("QC_REVERSAL"), "missing QC_REVERSAL");

    const netUsable = netFor(items, {
      transactionTypes: new Set(["QC", "QC_REVERSAL"]),
      stockBucket: "USABLE",
    });
    const netHold = netFor(items, {
      transactionTypes: new Set(["QC", "QC_REVERSAL"]),
      stockBucket: "QC_HOLD",
    });
    assert.ok(Math.abs(netUsable) < EPS, `USABLE QC+QC_REVERSAL net ${netUsable}`);
    assert.ok(Math.abs(netHold) < EPS, `QC_HOLD QC+QC_REVERSAL net ${netHold}`);

    const sumRes = await request(app).get("/api/stock/summary-buckets").set(bearer(authCtx.admin)).expect(200);
    const sumRow = sumRes.body.find((r) => Number(r.itemId) === Number(fg.id));
    assert.ok(sumRow, "summary row for FG");
    assert.ok(Math.abs(Number(sumRow.usableQty || 0)) < EPS, `summary USABLE after reverse ${sumRow.usableQty}`);
    assert.ok(Math.abs(Number(sumRow.qcHoldQty || 0)) < EPS, `summary QC_HOLD after reverse ${sumRow.qcHoldQty}`);

    const revRows = await prisma.stockTransaction.findMany({
      where: { itemId: fg.id, transactionType: "QC_REVERSAL" },
    });
    assert.equal(revRows.length >= 1, true);
    for (const r of revRows) {
      assert.ok(r.reversalOfId != null, "QC_REVERSAL must link reversalOfId");
    }

    await deleteStockTransactionsForItem(fg.id);
    await prisma.qcEntry.deleteMany({ where: { productionId: peId } });
    await prisma.productionEntry.deleteMany({ where: { id: peId } });
    await prisma.workOrder.delete({ where: { id: wo.id } });
    await prisma.salesOrder.delete({ where: { id: so.id } });
    await prisma.item.delete({ where: { id: fg.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
  });

  it("Test 3: partial dispatch reverse → full reverse; reversedAt only after full cover", async () => {
    const tag = `t3_${Date.now()}`;
    const customer = await prisma.customer.create({ data: { name: `LRev3_${tag}` } });
    const fg = await prisma.item.create({
      data: { itemName: `FG_LRev3_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
    });
    const so = await prisma.salesOrder.create({
      data: {
        customerId: customer.id,
        internalStatus: "APPROVED",
        lines: {
          create: [{ itemId: fg.id, qty: "500", customerPoQty: "500" }],
        },
      },
    });

    const os = await prisma.openingStockEntry.create({
      data: {
        itemId: fg.id,
        stockBucket: "USABLE",
        openingQty: "100",
        status: "DRAFT",
      },
    });
    await request(app)
      .post(`/api/opening-stock/${os.id}/approve`)
      .set(bearer(authCtx.admin))
      .send({ adminPassword: "x" })
      .expect(200);

    const draft = await request(app)
      .post("/api/dispatch/dispatches")
      .set(bearer(authCtx.admin))
      .send({ soId: so.id, itemId: fg.id, dispatchedQty: 40 })
      .expect(201);
    const dispatchId = draft.body.dispatch.id;

    await request(app)
      .post(`/api/dispatch/dispatches/${dispatchId}/lock`)
      .set(bearer(authCtx.admin))
      .expect(200);

    const forwardStock = await prisma.stockTransaction.findFirst({
      where: { itemId: fg.id, transactionType: "DISPATCH", refId: dispatchId },
    });
    assert.ok(forwardStock);

    await request(app)
      .post("/api/dispatch/reverse")
      .set(bearer(authCtx.admin))
      .send({ dispatchId, reverseQty: 10, reason: "partial reverse 10" })
      .expect(201);

    const usable70 = await getUsableFromSummary(app, bearer(authCtx.admin), fg.id);
    assert.ok(Math.abs(usable70 - 70) < EPS, `after partial reverse expected ~70, got ${usable70}`);

    const fwdAfterPartial = await prisma.stockTransaction.findUnique({
      where: { id: forwardStock.id },
      select: { reversedAt: true },
    });
    assert.equal(fwdAfterPartial?.reversedAt, null);

    await request(app)
      .post("/api/dispatch/reverse")
      .set(bearer(authCtx.admin))
      .send({ dispatchId, reverseQty: 30, reason: "complete reverse" })
      .expect(201);

    const usable100 = await getUsableFromSummary(app, bearer(authCtx.admin), fg.id);
    assert.ok(Math.abs(usable100 - 100) < EPS, `after full reverse expected ~100, got ${usable100}`);

    const fwdFinal = await prisma.stockTransaction.findUnique({
      where: { id: forwardStock.id },
      select: { reversedAt: true },
    });
    assert.ok(fwdFinal?.reversedAt != null);

    await deleteStockTransactionsForItem(fg.id);
    await prisma.openingStockEntry.deleteMany({ where: { itemId: fg.id } });
    await deleteDispatchesForSo(so.id);
    await prisma.salesOrder.delete({ where: { id: so.id } });
    await prisma.item.delete({ where: { id: fg.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
  });

  it("Opening stock OPENING_REVERSAL: summary 100→0, ledger types, re-approve, RM reversal filter, guard consumption", async () => {
    const tag = `os_${Date.now()}`;
    const rm = await prisma.item.create({
      data: { itemName: `RM_OS_${tag}`, itemType: "RM", unit: "KG", minStockLevel: "0" },
    });

    const os1 = await prisma.openingStockEntry.create({
      data: {
        itemId: rm.id,
        stockBucket: "USABLE",
        openingQty: "100",
        status: "DRAFT",
      },
    });
    await request(app)
      .post(`/api/opening-stock/${os1.id}/approve`)
      .set(bearer(authCtx.admin))
      .send({ adminPassword: "x" })
      .expect(200);

    let usable = await getUsableFromSummary(app, bearer(authCtx.admin), rm.id);
    assert.ok(Math.abs(usable - 100) < EPS, `after approve expected ~100, got ${usable}`);

    await request(app)
      .post(`/api/opening-stock/${os1.id}/reverse`)
      .set(bearer(authCtx.admin))
      .send({ reason: "integration opening reverse", adminPassword: "x" })
      .expect(201);

    usable = await getUsableFromSummary(app, bearer(authCtx.admin), rm.id);
    assert.ok(Math.abs(usable - 0) < EPS, `after reverse expected ~0, got ${usable}`);

    const ledgerAll = await getLedgerAsc(app, bearer(authCtx.admin), rm.id);
    const types = new Set((ledgerAll.items || []).map((r) => r.transactionType));
    assert.ok(types.has("OPENING"), "ledger should include OPENING");
    assert.ok(types.has("OPENING_REVERSAL"), "ledger should include OPENING_REVERSAL");

    const openingFwd = await prisma.stockTransaction.findFirst({
      where: { itemId: rm.id, transactionType: "OPENING", refId: os1.id },
    });
    assert.ok(openingFwd?.reversedAt != null, "forward OPENING should have reversedAt");

    const openingRev = await prisma.stockTransaction.findFirst({
      where: { itemId: rm.id, transactionType: "OPENING_REVERSAL" },
    });
    assert.ok(openingRev != null);
    assert.equal(openingRev.reversalOfId, openingFwd?.id);

    const ledgerFiltered = await request(app)
      .get("/api/stock/ledger")
      .query({ itemId: rm.id, transactionType: "OPENING_REVERSAL", sort: "asc", pageSize: 50 })
      .set(bearer(authCtx.admin))
      .expect(200);
    assert.ok(
      (ledgerFiltered.body.items || []).some((r) => r.transactionType === "OPENING_REVERSAL"),
      "ledger filter OPENING_REVERSAL",
    );

    const rmRev = await request(app)
      .get("/api/stock/rm-ledger")
      .query({ itemId: rm.id, movement: "REVERSAL", sort: "asc", pageSize: 50 })
      .set(bearer(authCtx.admin))
      .expect(200);
    assert.ok(
      (rmRev.body.items || []).some((r) => r.transactionType === "OPENING_REVERSAL"),
      "RM ledger REVERSAL movement should include OPENING_REVERSAL",
    );

    const os2 = await prisma.openingStockEntry.create({
      data: {
        itemId: rm.id,
        stockBucket: "USABLE",
        openingQty: "50",
        status: "DRAFT",
      },
    });
    await request(app)
      .post(`/api/opening-stock/${os2.id}/approve`)
      .set(bearer(authCtx.admin))
      .send({ adminPassword: "x" })
      .expect(200);
    usable = await getUsableFromSummary(app, bearer(authCtx.admin), rm.id);
    assert.ok(Math.abs(usable - 50) < EPS, `second approve expected ~50, got ${usable}`);

    await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(authCtx.admin))
      .send({ itemId: rm.id, qtyIn: 0, qtyOut: 45, reason: "consume before reverse guard" })
      .expect(201);

    const os3 = await prisma.openingStockEntry.create({
      data: {
        itemId: rm.id,
        stockBucket: "USABLE",
        openingQty: "30",
        status: "DRAFT",
      },
    });
    await request(app)
      .post(`/api/opening-stock/${os3.id}/approve`)
      .set(bearer(authCtx.admin))
      .send({ adminPassword: "x" })
      .expect(200);

    await request(app)
      .post("/api/stock/adjustment")
      .set(bearer(authCtx.admin))
      .send({ itemId: rm.id, qtyIn: 0, qtyOut: 10, reason: "reduce below reversal qty" })
      .expect(201);

    const revFail = await request(app)
      .post(`/api/opening-stock/${os3.id}/reverse`)
      .set(bearer(authCtx.admin))
      .send({ reason: "should fail insufficient bucket", adminPassword: "x" });
    assert.equal(revFail.status, 400);

    await deleteStockTransactionsForItem(rm.id);
    await prisma.openingStockEntry.deleteMany({ where: { itemId: rm.id } });
    await prisma.item.delete({ where: { id: rm.id } });
  });

  it("Full FG journey: production → QC → bucket moves → rework QC → dispatch → reverse; summary/ledger/reversal invariants", async () => {
    const tag = `fgj_${Date.now()}`;
    const customer = await prisma.customer.create({ data: { name: `FGJ_${tag}` } });
    const fg = await prisma.item.create({
      data: { itemName: `FG_JOURNEY_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
    });
    const so = await prisma.salesOrder.create({
      data: {
        customerId: customer.id,
        internalStatus: "APPROVED",
        lines: {
          create: [{ itemId: fg.id, qty: "500", customerPoQty: "500" }],
        },
      },
    });
    const wo = await prisma.workOrder.create({
      data: {
        salesOrderId: so.id,
        status: "PENDING",
        lines: { create: [{ fgItemId: fg.id, qty: "500", plannedQty: "500" }] },
      },
      include: { lines: true },
    });
    const wol = wo.lines[0];

    const peRes = await request(app)
      .post("/api/production/production-entries")
      .set(bearer(authCtx.admin))
      .send({ workOrderLineId: wol.id, producedQty: 100 })
      .expect(201);
    const peId = peRes.body.prod?.id;
    assert.ok(peId);

    await request(app)
      .post(`/api/production/production-entries/${peId}/approve`)
      .set(bearer(authCtx.admin))
      .expect(200);

    const fgProdTxn = await prisma.stockTransaction.findMany({
      where: { itemId: fg.id, transactionType: "PRODUCTION" },
    });
    assert.equal(fgProdTxn.length, 0, "FG production approve must not post PRODUCTION stock rows");

    await request(app)
      .post("/api/production/qc-entries")
      .set(bearer(authCtx.admin))
      .send({
        productionId: peId,
        checkedQty: 100,
        rejectedQty: 20,
        rejectedStockBucket: "QC_HOLD",
        reason: "fg journey integ",
      })
      .expect(201);

    await request(app)
      .post("/api/stock/bucket-transfer")
      .set(bearer(authCtx.admin))
      .send({
        itemId: fg.id,
        qty: 10,
        fromBucket: "QC_HOLD",
        toBucket: "REWORK",
        reason: "hold to rework",
      })
      .expect(201);

    await request(app)
      .post("/api/stock/bucket-transfer")
      .set(bearer(authCtx.admin))
      .send({
        itemId: fg.id,
        qty: 5,
        fromBucket: "QC_HOLD",
        toBucket: "SCRAP",
        reason: "hold to scrap",
      })
      .expect(201);

    await request(app)
      .post("/api/stock/process-rework")
      .set(bearer(authCtx.admin))
      .send({
        itemId: fg.id,
        qty: 10,
        action: "SEND_TO_QC",
        remarks: "send rework lot to qc pending",
      })
      .expect(201);

    await request(app)
      .post("/api/stock/complete-rework-qc")
      .set(bearer(authCtx.admin))
      .send({
        itemId: fg.id,
        checkedQty: 10,
        rejectedQty: 2,
        rejectedStockBucket: "SCRAP",
        reason: "rework final qc",
      })
      .expect(201);

    const draft = await request(app)
      .post("/api/dispatch/dispatches")
      .set(bearer(authCtx.admin))
      .send({ soId: so.id, itemId: fg.id, dispatchedQty: 50 })
      .expect(201);
    const dispatchId = draft.body.dispatch.id;

    await request(app)
      .post(`/api/dispatch/dispatches/${dispatchId}/lock`)
      .set(bearer(authCtx.admin))
      .expect(200);

    await request(app)
      .post("/api/dispatch/reverse")
      .set(bearer(authCtx.admin))
      .send({ dispatchId, reverseQty: 50, reason: "fg journey reverse" })
      .expect(201);

    const summaryRes = await request(app).get("/api/stock/summary-buckets").set(bearer(authCtx.admin)).expect(200);
    const summaryRow = summaryRes.body.find((r) => Number(r.itemId) === fg.id);
    assert.ok(summaryRow);
    assert.ok(Math.abs(Number(summaryRow.usableQty) - 88) < EPS, `usable ${summaryRow.usableQty}`);
    assert.ok(Math.abs(Number(summaryRow.qcHoldQty) - 5) < EPS, `qc_hold ${summaryRow.qcHoldQty}`);
    assert.ok(Math.abs(Number(summaryRow.reworkQty) - 0) < EPS, `rework ${summaryRow.reworkQty}`);
    assert.ok(Math.abs(Number(summaryRow.scrapQty) - 7) < EPS, `scrap ${summaryRow.scrapQty}`);
    assert.ok(Math.abs(Number(summaryRow.qcPendingQty) - 0) < EPS, `qc_pending ${summaryRow.qcPendingQty}`);

    const ledgerBody = await getLedgerAsc(app, bearer(authCtx.admin), fg.id);
    const items = ledgerBody.items || [];
    const net = ledgerNetByBucket(items);
    assert.ok(Math.abs(net.USABLE - 88) < EPS, `ledger net USABLE ${net.USABLE}`);
    assert.ok(Math.abs(net.QC_HOLD - 5) < EPS);
    assert.ok(Math.abs(net.REWORK - 0) < EPS);
    assert.ok(Math.abs(net.SCRAP - 7) < EPS);
    assert.ok(Math.abs(net.QC_PENDING - 0) < EPS);
    assert.ok(Math.abs(Number(summaryRow.usableQty) - Math.max(0, net.USABLE)) < EPS);
    assert.ok(Math.abs(Number(summaryRow.qcHoldQty) - net.QC_HOLD) < EPS);
    assert.ok(Math.abs(Number(summaryRow.scrapQty) - net.SCRAP) < EPS);

    const prismaRows = await prisma.stockTransaction.findMany({
      where: { itemId: fg.id, transactionType: { in: ["DISPATCH", "DISPATCH_REVERSAL"] } },
    });
    for (const row of prismaRows) {
      assert.equal(String(row.stockBucket), "USABLE", `dispatch-related row ${row.transactionType} must be USABLE`);
    }
    const dispFwd = prismaRows.find((r) => r.transactionType === "DISPATCH");
    const dispRev = prismaRows.find((r) => r.transactionType === "DISPATCH_REVERSAL");
    assert.ok(dispFwd && dispRev);
    assert.ok(dispRev.reversalOfId === dispFwd.id);

    await deleteStockTransactionsForItem(fg.id);
    await prisma.qcEntry.deleteMany({ where: { productionId: peId } });
    await prisma.productionEntry.deleteMany({ where: { id: peId } });
    await prisma.workOrder.delete({ where: { id: wo.id } });
    await deleteDispatchesForSo(so.id);
    await prisma.salesOrder.delete({ where: { id: so.id } });
    await prisma.item.delete({ where: { id: fg.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
  });
});
