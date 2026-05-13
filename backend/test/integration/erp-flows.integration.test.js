/**
 * Database integration tests (MySQL + Prisma + HTTP routes).
 *
 * Setup: backend/docs/INTEGRATION_TEST_DB.md
 *
 * Typical flow:
 *   1. Create empty DB (e.g. mini_erp_integration).
 *   2. NODE_ENV=test TEST_DATABASE_URL=... npm run test:integration:prepare
 *   3. NODE_ENV=test TEST_DATABASE_URL=... npm run test:integration:db
 *
 * Optional: copy .env.integration.example → .env.integration for local overrides.
 */

const { runIntegration } = require("./_integrationEnv");

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../../src/createApp");
const { Prisma } = require("../../src/prismaClientPackage");
const { prisma } = require("../../src/utils/prisma");
const { signAccessToken } = require("../../src/utils/jwt");
const { computeWorkOrderTrackingSummaryFromRows, assertWorkOrderTrackingSummaryMatches } = require("../../src/services/reportMetrics");
const { buildExceptionSummary } = require("../../src/services/operationsExceptionClassification");
const { QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT } = require("../../src/services/dashboardQueueSnapshots");

const d = runIntegration ? describe : describe.skip;

/** Human-readable drift vs prisma/schema.prisma (integration-critical objects only). */
async function integrationSchemaGaps() {
  const gaps = [];
  try {
    const col = async (tableVariants, columnName) => {
      const rows = await prisma.$queryRaw`
        SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND COLUMN_NAME = ${columnName}
          AND TABLE_NAME IN (${Prisma.join(tableVariants)})
      `;
      return Number(rows[0]?.c) > 0;
    };
    const table = async (names) => {
      const rows = await prisma.$queryRaw`
        SELECT COUNT(*) AS c FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${Prisma.join(names)})
      `;
      return Number(rows[0]?.c) > 0;
    };

    if (!(await col(["Dispatch", "dispatch"], "itemId"))) gaps.push("Dispatch.itemId");
    if (!(await col(["Dispatch", "dispatch"], "reversalOfId"))) gaps.push("Dispatch.reversalOfId");
    if (!(await col(["Dispatch", "dispatch"], "reversalReason"))) gaps.push("Dispatch.reversalReason");
    if (!(await col(["QcEntry", "qcentry"], "reversedAt"))) gaps.push("QcEntry.reversedAt");
    if (!(await table(["QcReversal", "qcreversal"]))) gaps.push("QcReversal table");
    if (!(await col(["ScrapRecord", "scraprecord"], "voidedAt"))) gaps.push("ScrapRecord.voidedAt");
    if (!(await col(["ScrapRecord", "scraprecord"], "qcEntryId"))) gaps.push("ScrapRecord.qcEntryId");
  } catch (e) {
    gaps.push(`information_schema check failed: ${e?.message || e}`);
  }
  return gaps;
}

function adminAuth() {
  const token = signAccessToken({
    userId: 999001,
    email: "integration-admin@test.local",
    role: "ADMIN",
    name: "Integration Admin",
  });
  return { Authorization: `Bearer ${token}` };
}

function storeAuth() {
  const token = signAccessToken({
    userId: 999002,
    email: "integration-store@test.local",
    role: "STORE",
    name: "Integration Store",
  });
  return { Authorization: `Bearer ${token}` };
}

d("Draft sales order PUT/PATCH (DB + routes)", () => {
  const app = createApp();
  /** @type {{ customerId: number, fgId: number, soId: number, l1: number, l2: number }} */
  let ctx;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const gaps = await integrationSchemaGaps();
    if (gaps.length) {
      throw new Error(
        `Database schema drift (missing: ${gaps.join(", ")}). ` +
          "Use an empty integration database and run: npm run test:integration:prepare " +
          "(see backend/docs/INTEGRATION_TEST_DB.md).",
      );
    }
    const tag = `draft_${Date.now()}`;
    const customer = await prisma.customer.create({
      data: { name: `IntegCust_${tag}` },
    });
    const fg = await prisma.item.create({
      data: { itemName: `IntegFG_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
    });
    const so = await prisma.salesOrder.create({
      data: {
        customerId: customer.id,
        internalStatus: "DRAFT",
        lines: {
          create: [
            { itemId: fg.id, qty: "100" },
            { itemId: fg.id, qty: "100" },
          ],
        },
      },
      include: { lines: { orderBy: { id: "asc" } } },
    });
    const [line1, line2] = so.lines;
    await prisma.dispatch.create({
      data: { soId: so.id, itemId: fg.id, dispatchedQty: "50", workflowStatus: "LOCKED" },
    });
    ctx = { customerId: customer.id, fgId: fg.id, soId: so.id, l1: line1.id, l2: line2.id };
  });

  after(async () => {
    if (!ctx) return;
    await prisma.dispatch.deleteMany({ where: { soId: ctx.soId } });
    await prisma.salesOrder.delete({ where: { id: ctx.soId } }).catch(() => {});
    await prisma.item.delete({ where: { id: ctx.fgId } }).catch(() => {});
    await prisma.customer.delete({ where: { id: ctx.customerId } }).catch(() => {});
  });

  it("PUT valid redistribution 10+90 passes summed floor (net dispatch 50)", async () => {
    const res = await request(app)
      .put(`/api/sales-orders/${ctx.soId}`)
      .set(adminAuth())
      .send({
        lines: [
          { lineId: ctx.l1, qty: 10 },
          { lineId: ctx.l2, qty: 90 },
        ],
      });
    assert.equal(res.status, 200);
    const lines = res.body.lines.sort((a, b) => a.id - b.id);
    assert.equal(Number(lines[0].qty), 10);
    assert.equal(Number(lines[1].qty), 90);
  });

  it("PUT invalid summed qty fails with floor message", async () => {
    const res = await request(app)
      .put(`/api/sales-orders/${ctx.soId}`)
      .set(adminAuth())
      .send({
        lines: [
          { lineId: ctx.l1, qty: 15 },
          { lineId: ctx.l2, qty: 25 },
        ],
      })
      .expect(400);
    assert.match(res.body?.error?.message ?? "", /Minimum total for this item: 50/);
  });

  it("PATCH /lines partial payload keeps DB qty for untouched line in sum", async () => {
    await request(app)
      .put(`/api/sales-orders/${ctx.soId}`)
      .set(adminAuth())
      .send({
        lines: [
          { lineId: ctx.l1, qty: 100 },
          { lineId: ctx.l2, qty: 100 },
        ],
      })
      .expect(200);

    const res = await request(app)
      .patch(`/api/sales-orders/${ctx.soId}/lines`)
      .set(storeAuth())
      .send({ lines: [{ lineId: ctx.l1, qty: 10 }] })
      .expect(200);
    const byId = new Map(res.body.lines.map((l) => [l.id, Number(l.qty)]));
    assert.equal(byId.get(ctx.l1), 10);
    assert.equal(byId.get(ctx.l2), 100);
  });

  it("PUT dropping a duplicate-FG line while item has dispatch fails (no silent delete)", async () => {
    const res = await request(app)
      .put(`/api/sales-orders/${ctx.soId}`)
      .set(adminAuth())
      .send({ lines: [{ lineId: ctx.l1, qty: 100 }] })
      .expect(400);
    assert.match(res.body?.error?.message ?? "", /dispatch activity/i);
  });
});

d("Reporting + dispatch integration (seeded chain)", () => {
  const app = createApp();
  /** @type {Record<string, number>} */
  let ids;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const gaps = await integrationSchemaGaps();
    if (gaps.length) {
      throw new Error(
        `Database schema drift (missing: ${gaps.join(", ")}). ` +
          "Use an empty integration database and run: npm run test:integration:prepare " +
          "(see backend/docs/INTEGRATION_TEST_DB.md).",
      );
    }
    const tag = `rep_${Date.now()}`;

    const customer = await prisma.customer.create({ data: { name: `Rep_${tag}` } });
    const supplier = await prisma.supplier.create({
      data: { name: `Sup_${tag}`, contact: "c" },
    });
    const rm = await prisma.item.create({
      data: { itemName: `RM_${tag}`, itemType: "RM", unit: "KG", minStockLevel: "0" },
    });
    const fg = await prisma.item.create({
      data: { itemName: `FG_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
    });
    const bom = await prisma.bom.create({
      data: {
        fgItemId: fg.id,
        lines: {
          create: [{ rmItemId: rm.id, baseQty: "1", wastagePercent: "0" }],
        },
      },
    });

    const oldDate = new Date("2019-06-01T10:00:00.000Z");
    const so = await prisma.salesOrder.create({
      data: {
        customerId: customer.id,
        internalStatus: "APPROVED",
        createdAt: oldDate,
        lines: {
          create: [
            { itemId: fg.id, qty: "60" },
            { itemId: fg.id, qty: "40" },
          ],
        },
      },
      include: { lines: { orderBy: { id: "asc" } } },
    });

    const wo = await prisma.workOrder.create({
      data: {
        salesOrderId: so.id,
        status: "PENDING",
        // plannedQty column still exists for DB compatibility; WO contract now uses qty only.
        lines: { create: [{ fgItemId: fg.id, qty: "100", plannedQty: "100" }] },
      },
      include: { lines: true },
    });
    const wol = wo.lines[0];

    const pe = await prisma.productionEntry.create({
      data: {
        workOrderLineId: wol.id,
        producedQty: "60",
        date: oldDate,
        workflowStatus: "APPROVED",
      },
    });

    await prisma.qcEntry.create({
      data: {
        productionId: pe.id,
        acceptedQty: "45",
        rejectedQty: "5",
        lossQty: "5",
      },
    });

    const forward = await prisma.dispatch.create({
      data: { soId: so.id, itemId: fg.id, dispatchedQty: "25", workflowStatus: "LOCKED" },
    });
    await prisma.dispatch.create({
      data: {
        soId: so.id,
        itemId: fg.id,
        dispatchedQty: "-10",
        reversalOfId: forward.id,
        workflowStatus: "LOCKED",
      },
    });

    await prisma.stockTransaction.create({
      data: {
        itemId: fg.id,
        transactionType: "ADJUSTMENT",
        refId: pe.id,
        qtyIn: "500",
        qtyOut: "0",
      },
    });

    await prisma.rmPurchaseOrder.create({
      data: {
        supplierId: supplier.id,
        status: "PENDING",
        lines: { create: [{ itemId: rm.id, qty: "200", rate: "1" }] },
      },
    });

    ids = {
      customerId: customer.id,
      supplierId: supplier.id,
      rmId: rm.id,
      fgId: fg.id,
      bomId: bom.id,
      soId: so.id,
      woId: wo.id,
      wolId: wol.id,
      peId: pe.id,
      forwardDispatchId: forward.id,
    };
  });

  after(async () => {
    if (!ids) return;
    await prisma.stockTransaction.deleteMany({ where: { itemId: { in: [ids.fgId, ids.rmId] } } });
    await prisma.dispatch.deleteMany({ where: { soId: ids.soId } });
    await prisma.qcEntry.deleteMany({ where: { productionId: ids.peId } });
    await prisma.productionEntry.deleteMany({ where: { id: ids.peId } });
    await prisma.workOrder.delete({ where: { id: ids.woId } }).catch(() => {});
    await prisma.salesOrder.delete({ where: { id: ids.soId } }).catch(() => {});
    await prisma.bomLine.deleteMany({ where: { bomId: ids.bomId } });
    await prisma.bom.delete({ where: { id: ids.bomId } }).catch(() => {});
    await prisma.rmPurchaseOrder.deleteMany({ where: { supplierId: ids.supplierId } });
    await prisma.supplier.delete({ where: { id: ids.supplierId } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: [ids.fgId, ids.rmId] } } });
    await prisma.customer.delete({ where: { id: ids.customerId } }).catch(() => {});
  });

  it("GET /api/reports/work-order-tracking — shape, quantities, summary vs rows, contexts", async () => {
    const res = await request(app).get("/api/reports/work-order-tracking").set(adminAuth()).expect(200);
    assert.ok(res.body.rows);
    assert.ok(res.body.summary);
    assert.ok(res.body.reportMetricHints);
    const row = res.body.rows.find((r) => r.workOrderLineId === ids.wolId);
    assert.ok(row, "expected WO line row");
    assert.equal(row.salesOrderId, ids.soId);
    assert.equal(row.orderedQty, 100);
    assert.equal(row.workOrderQty, 100);
    assert.equal(row.requiredQty, 100);
    assert.equal(row.producedQty, 60);
    assert.equal(row.acceptedQty, 45);
    assert.equal(row.rejectedQty, 5);
    assert.equal(row.dispatchedQty, 15);
    assert.equal(row.quantityContexts?.so?.metricContext, "SO_ITEM_TOTAL");
    assert.equal(row.quantityContexts?.wo?.metricContext, "WO_LINE");
    assert.equal(row.quantityContexts?.dispatchAllocation, "WO_FIFO");
    assert.equal(row.status, "IN_PRODUCTION");

    const check = assertWorkOrderTrackingSummaryMatches(res.body.rows, res.body.summary);
    assert.equal(check.ok, true);
    const computed = computeWorkOrderTrackingSummaryFromRows(res.body.rows);
    assert.deepEqual(computed, res.body.summary);
  });

  it("GET dashboard queue endpoints — quantityMetricContext + seeded quantities", async () => {
    const backlogRes = await request(app).get("/api/dashboard/dispatch-backlog").set(adminAuth()).expect(200);
    const oursBacklog = backlogRes.body.filter((r) => r.salesOrderId === ids.soId);
    assert.ok(oursBacklog.length >= 1);
    for (const r of oursBacklog) {
      assert.equal(r.quantityMetricContext, QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.dispatchBacklog);
    }
    const b0 = oursBacklog.find((r) => r.orderedQty === 60);
    assert.ok(b0);
    assert.equal(b0.pendingQty, 45);
    assert.equal(b0.dispatchedQty, 15);

    const prodRes = await request(app).get("/api/dashboard/production-queue").set(adminAuth()).expect(200);
    const oursProd = prodRes.body.filter((r) => r.workOrderId === ids.woId);
    assert.equal(oursProd.length, 1);
    assert.equal(oursProd[0].quantityMetricContext, QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.productionQueue);
    assert.equal(oursProd[0].balanceQty, 40);

    const qcRes = await request(app).get("/api/dashboard/qc-queue").set(adminAuth()).expect(200);
    const oursQc = qcRes.body.filter((r) => r.workOrderId === ids.woId);
    assert.equal(oursQc.length, 1);
    assert.equal(oursQc[0].quantityMetricContext, QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.qcQueue);
    assert.equal(oursQc[0].pendingQcQty, 10);
    assert.equal(Number(oursQc[0].salesOrderId), ids.soId);

    const cwRes = await request(app).get("/api/dashboard/continue-working?limit=10").set(adminAuth()).expect(200);
    assert.ok(Array.isArray(cwRes.body));
    const oursCw = cwRes.body.filter((r) => r.salesOrderId === ids.soId);
    assert.ok(oursCw.length >= 1);
    for (const r of oursCw) {
      assert.ok(r.key && typeof r.href === "string" && r.href.includes("salesOrderId="));
      assert.ok(r.actionLabel && r.stageLabel && r.customerName && r.itemName);
    }

    const rmRes = await request(app).get("/api/dashboard/rm-risk").set(adminAuth()).expect(200);
    const oursRm = rmRes.body.filter((r) => r.itemId === ids.rmId);
    assert.ok(oursRm.length >= 1);
    assert.equal(oursRm[0].quantityMetricContext, QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.rmRisk);

    const purRes = await request(app).get("/api/dashboard/purchase-summary").set(adminAuth()).expect(200);
    const oursPur = purRes.body.filter((r) => r.itemId === ids.rmId && r.pendingQty > 0);
    assert.ok(oursPur.length >= 1);
    assert.equal(oursPur[0].quantityMetricContext, QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.purchaseSummary);
  });

  it("GET /api/dashboard — pendingDispatchCount includes seeded SO when backlog exists", async () => {
    const res = await request(app).get("/api/dashboard").set(adminAuth()).expect(200);
    assert.ok(typeof res.body.pendingDispatchCount === "number");
    const backlog = await request(app).get("/api/dashboard/dispatch-backlog").set(adminAuth()).expect(200);
    const hasOurs = backlog.body.some((r) => r.salesOrderId === ids.soId);
    if (hasOurs) {
      assert.ok(res.body.pendingDispatchCount >= 1);
    }
  });

  it("GET /api/reports/operations-exceptions — sections + summary matches row counts", async () => {
    const res = await request(app).get("/api/reports/operations-exceptions").set(adminAuth()).expect(200);
    assert.ok(Array.isArray(res.body.dispatch));
    assert.ok(Array.isArray(res.body.production));
    assert.ok(Array.isArray(res.body.qc));
    assert.ok(Array.isArray(res.body.rm));
    assert.ok(Array.isArray(res.body.purchase));
    assert.ok(res.body.summary);
    const localSummary = buildExceptionSummary({
      dispatch: res.body.dispatch,
      production: res.body.production,
      qc: res.body.qc,
      rm: res.body.rm,
      purchase: res.body.purchase,
    });
    assert.deepEqual(localSummary, res.body.summary);
    const oursDisp = res.body.dispatch.filter((r) => r.salesOrderId === ids.soId);
    assert.ok(oursDisp.length >= 1);
    assert.ok(oursDisp[0].severity === "WARNING" || oursDisp[0].severity === "CRITICAL");
    assert.ok(oursDisp[0].exceptionClassificationContext);
  });

  it("GET /api/dispatch/sales-orders — lineStats, qc pool, dispatchable, ledger maxReversibleQty", async () => {
    const res = await request(app).get("/api/dispatch/sales-orders").set(adminAuth()).expect(200);
    const so = res.body.find((r) => r.id === ids.soId);
    assert.ok(so, "SO in dispatch list");
    assert.ok(Array.isArray(so.lineStats));
    assert.equal(so.lineStats.length, 2);
    const sumDisp = so.lineStats.reduce((s, l) => s + l.dispatched, 0);
    assert.equal(sumDisp, 15);
    const l60 = so.lineStats.find((l) => l.orderQty === 60);
    assert.ok(l60);
    assert.equal(l60.quantityContexts?.soLineRemaining?.metricContext, "SO_FIFO");
    assert.equal(l60.quantityContexts?.qcPoolRemaining?.metricContext, "QC_POOL");
    assert.equal(l60.quantityContexts?.dispatchableQty?.metricContext, "DISPATCHABLE_MIN");
    assert.ok(typeof l60.qcApprovedRemaining === "number");
    assert.ok(typeof l60.dispatchable === "number");
    assert.equal(l60.totalStock, l60.onHand);
    assert.equal(l60.qcApprovedStock, l60.qcAccepted);
    assert.equal(l60.dispatchableQty, l60.dispatchable);
    assert.ok("dispatchBlockedReason" in l60);
    assert.ok(typeof l60.inQcReworkQty === "number");

    const dispRows = so.dispatch;
    assert.ok(Array.isArray(dispRows));
    const forward = dispRows.find((d) => d.id === ids.forwardDispatchId);
    assert.ok(forward);
    assert.equal(forward.maxReversibleQty, 15);
    assert.equal(forward.ledgerMetricContext, "DISPATCH_LEDGER");
    const rev = dispRows.find((d) => Number(d.dispatchedQty) < 0);
    assert.ok(rev);
    assert.equal(rev.maxReversibleQty, null);
  });
});

d("NO_QTY requirement sheet shortfall carry-forward (QC-based, no WO duplication)", () => {
  const app = createApp();
  /** @type {Record<string, number>} */
  let ids;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const gaps = await integrationSchemaGaps();
    if (gaps.length) {
      throw new Error(
        `Database schema drift (missing: ${gaps.join(", ")}). ` +
          "Use an empty integration database and run: npm run test:integration:prepare " +
          "(see backend/docs/INTEGRATION_TEST_DB.md).",
      );
    }

    const tag = `noqty_rs_${Date.now()}`;
    const customer = await prisma.customer.create({ data: { name: `NoQtyCust_${tag}` } });
    const fg = await prisma.item.create({
      data: { itemName: `NoQtyFG_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
    });

    const so = await prisma.salesOrder.create({
      data: {
        customerId: customer.id,
        orderType: "NO_QTY",
        internalStatus: "IN_PROCESS",
        lines: { create: [{ itemId: fg.id, qty: "0" }] },
      },
    });

    const cycle1 = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 1, status: "ACTIVE" },
    });

    // Completed WO planned = 5000, QC accepted = 4300 -> shortfall 700 (cycle 1)
    const wo = await prisma.workOrder.create({
      data: {
        salesOrderId: so.id,
        cycleId: cycle1.id,
        status: "COMPLETED",
        lines: { create: [{ fgItemId: fg.id, qty: "5000", plannedQty: "5000" }] },
      },
      include: { lines: true },
    });
    const wol = wo.lines[0];
    const pe = await prisma.productionEntry.create({
      data: { workOrderLineId: wol.id, producedQty: "5000", date: new Date(), workflowStatus: "APPROVED" },
    });
    await prisma.qcEntry.create({
      data: { productionId: pe.id, acceptedQty: "4300", rejectedQty: "700", lossQty: "0" },
    });

    // Usable stock available = 300
    await prisma.stockTransaction.create({
      data: { itemId: fg.id, transactionType: "ADJUSTMENT", refId: pe.id, qtyIn: "300", qtyOut: "0", stockBucket: "USABLE" },
    });

    // Locked RS defines cycle 1 planned qty (5000). Carry-forward shortfall = 5000 − 4300 QC accepted = 700.
    await prisma.requirementSheet.create({
      data: {
        salesOrderId: so.id,
        cycleId: cycle1.id,
        periodKey: "2026-04",
        version: 1,
        status: "LOCKED",
        lines: { create: [{ itemId: fg.id, requirementQty: "5000" }] },
      },
    });

    await prisma.salesOrderCycle.update({
      where: { id: cycle1.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    const cycle2 = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 2, status: "ACTIVE" },
    });
    await prisma.salesOrder.update({ where: { id: so.id }, data: { currentCycleId: cycle2.id } });

    // Draft requirement sheet on cycle 2 — carry-forward from closed cycle 1
    const sheet = await prisma.requirementSheet.create({
      data: {
        salesOrderId: so.id,
        cycleId: cycle2.id,
        periodKey: "2026-05",
        version: 1,
        status: "DRAFT",
        lines: { create: [{ itemId: fg.id, requirementQty: "1000" }] },
      },
    });

    ids = {
      customerId: customer.id,
      fgId: fg.id,
      soId: so.id,
      cycleId: cycle2.id,
      woId: wo.id,
      wolId: wol.id,
      peId: pe.id,
      sheetId: sheet.id,
    };
  });

  after(async () => {
    if (!ids) return;
    await prisma.stockTransaction.deleteMany({ where: { itemId: ids.fgId } });
    await prisma.qcEntry.deleteMany({ where: { productionId: ids.peId } });
    await prisma.productionEntry.deleteMany({ where: { id: ids.peId } });
    await prisma.workOrder.delete({ where: { id: ids.woId } }).catch(() => {});
    await prisma.requirementSheet.deleteMany({ where: { salesOrderId: ids.soId } }).catch(() => {});
    await prisma.salesOrderCycle.deleteMany({ where: { salesOrderId: ids.soId } }).catch(() => {});
    await prisma.salesOrder.delete({ where: { id: ids.soId } }).catch(() => {});
    await prisma.item.delete({ where: { id: ids.fgId } }).catch(() => {});
    await prisma.customer.delete({ where: { id: ids.customerId } }).catch(() => {});
  });

  it("draft requirement sheet shows last shortage qty = 700 (carry from closed cycle 1) and total to produce = 1700 (700+1000; NO_QTY draft free stock = 0)", async () => {
    const res = await request(app)
      .get(`/api/requirement-sheets/${ids.sheetId}`)
      .set(adminAuth())
      .expect(200);

    const line = (res.body?.lines || []).find((l) => Number(l.itemId) === ids.fgId);
    assert.ok(line, "expected requirement sheet line");
    assert.equal(Number(line.shortfallQty), 700);
    assert.equal(Number(line.pendingQcDispositionQty ?? 0), 0);
    assert.equal(Number(line.fulfillmentQty), 1700);
    assert.equal(Number(line.availableStockQty), 0);
    assert.equal(Number(line.totalWoQty), 1700);
  });
});

d("NO_QTY carry-forward guard: do not freeze shortage while QC pending", () => {
  const app = createApp();
  /** @type {Record<string, number>} */
  let ids;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const gaps = await integrationSchemaGaps();
    if (gaps.length) {
      throw new Error(
        `Database schema drift (missing: ${gaps.join(", ")}). ` +
          "Use an empty integration database and run: npm run test:integration:prepare " +
          "(see backend/docs/INTEGRATION_TEST_DB.md).",
      );
    }

    const tag = `noqty_qc_pending_${Date.now()}`;
    const customer = await prisma.customer.create({ data: { name: `NoQtyCust_${tag}` } });
    const fg = await prisma.item.create({
      data: { itemName: `NoQtyFG_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
    });
    const so = await prisma.salesOrder.create({
      data: {
        customerId: customer.id,
        orderType: "NO_QTY",
        internalStatus: "IN_PROCESS",
        lines: { create: [{ itemId: fg.id, qty: "0" }] },
      },
    });
    const cycle1 = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 1, status: "ACTIVE" },
    });

    // WO is production-complete, but QC is only partially checked (pending QC exists).
    const wo = await prisma.workOrder.create({
      data: {
        salesOrderId: so.id,
        cycleId: cycle1.id,
        status: "COMPLETED",
        lines: { create: [{ fgItemId: fg.id, qty: "5000", plannedQty: "5000" }] },
      },
      include: { lines: true },
    });
    const wol = wo.lines[0];
    const pe = await prisma.productionEntry.create({
      data: { workOrderLineId: wol.id, producedQty: "5000", date: new Date(), workflowStatus: "APPROVED" },
    });
    // QC checked only 2200 (accepted), nothing rejected yet => pending QC = 2800
    await prisma.qcEntry.create({
      data: { productionId: pe.id, acceptedQty: "2200", rejectedQty: "0", lossQty: "0" },
    });

    await prisma.requirementSheet.create({
      data: {
        salesOrderId: so.id,
        cycleId: cycle1.id,
        periodKey: "2026-04",
        version: 1,
        status: "LOCKED",
        lines: { create: [{ itemId: fg.id, requirementQty: "5000" }] },
      },
    });

    await prisma.salesOrderCycle.update({
      where: { id: cycle1.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    const cycle2 = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 2, status: "ACTIVE" },
    });
    await prisma.salesOrder.update({ where: { id: so.id }, data: { currentCycleId: cycle2.id } });

    const sheet = await prisma.requirementSheet.create({
      data: {
        salesOrderId: so.id,
        cycleId: cycle2.id,
        periodKey: "2026-05",
        version: 1,
        status: "DRAFT",
        lines: { create: [{ itemId: fg.id, requirementQty: "0" }] },
      },
    });

    ids = {
      customerId: customer.id,
      fgId: fg.id,
      soId: so.id,
      cycleId: cycle2.id,
      woId: wo.id,
      wolId: wol.id,
      peId: pe.id,
      sheetId: sheet.id,
    };
  });

  after(async () => {
    if (!ids) return;
    await prisma.qcEntry.deleteMany({ where: { productionId: ids.peId } });
    await prisma.productionEntry.deleteMany({ where: { id: ids.peId } });
    await prisma.workOrder.delete({ where: { id: ids.woId } }).catch(() => {});
    await prisma.requirementSheet.deleteMany({ where: { salesOrderId: ids.soId } }).catch(() => {});
    await prisma.salesOrderCycle.deleteMany({ where: { salesOrderId: ids.soId } }).catch(() => {});
    await prisma.salesOrder.delete({ where: { id: ids.soId } }).catch(() => {});
    await prisma.item.delete({ where: { id: ids.fgId } }).catch(() => {});
    await prisma.customer.delete({ where: { id: ids.customerId } }).catch(() => {});
  });

  it("shows running shortfall while QC is pending (planned - accepted so far)", async () => {
    const res = await request(app)
      .get(`/api/requirement-sheets/${ids.sheetId}`)
      .set(adminAuth())
      .expect(200);

    const line = (res.body?.lines || []).find((l) => Number(l.itemId) === ids.fgId);
    assert.ok(line, "expected requirement sheet line");
    // planned=5000, accepted=2200 => carry-forward shortfall=2800 (confirmed; no disposition rows)
    assert.equal(Number(line.shortfallQty), 2800);
    assert.equal(Number(line.pendingQcDispositionQty ?? 0), 0);
    assert.equal(Number(line.fulfillmentQty), 2800);
    assert.equal(Number(line.totalWoQty), 2800);
  });
});
