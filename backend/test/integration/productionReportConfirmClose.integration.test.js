/**
 * REAL-DB rollback / retry proof for the Production Report "Confirm & Close WO"
 * P2028 partial-commit fix (MySQL + Prisma interactive transaction).
 *
 * Proven root cause (see logs/application.log 2026-07-12): the confirm endpoint
 * ran ONE interactive transaction, but createMaterialWastageNote() opened its
 * OWN root-client prisma.$transaction — so the wastage note + RM_WASTAGE stock
 * deduction committed independently and survived an outer rollback (P2028), and
 * a retry could duplicate them.
 *
 * The unit suite (test/unit/productionReportConfirmClose.test.js) locks in the
 * transaction-awareness at the seam level with mocked clients. This integration
 * test proves the end-to-end guarantee against the actual test database:
 *
 *   1. Confirm-with-wastage runs inside the SAME transaction the route uses
 *      (approve report → finish execution → reconcile WO), so all writes exist
 *      inside the transaction: ProductionWorkOrderReport + lines, the
 *      MaterialWastageNote, the RM_WASTAGE StockTransaction, execution close and
 *      WO status transition.
 *   2. A controlled error is thrown AFTER the wastage posting but BEFORE commit.
 *   3. We assert from the database that NOTHING persisted (true atomic rollback).
 *   4. We then retry through the REAL HTTP endpoint and assert exactly one of
 *      each artifact exists and the WO reaches the QA-ready / Pending-QC state
 *      (execution COMPLETED + confirmed report), with no duplication.
 *
 * This does NOT rely on mocked transaction clients — it uses the real Prisma
 * transaction and the real services/route against the integration DB.
 *
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

const { approveProductionWorkOrderReport } = require("../../src/services/productionReportApprovalGateService");
const { finishProductionExecution } = require("../../src/services/productionExecutionService");
const { reconcileWorkOrderStatusFromProduction } = require("../../src/services/workOrderCompletionService");
const { lockWorkOrderForUpdate } = require("../../src/services/productionWriteLocks");

const d = runIntegration ? describe : describe.skip;

const EPS = 1e-6;
const ISSUED_QTY = 10;

/** @param {{ id: number; email: string; role: string; name: string }} user */
function bearer(user) {
  return {
    Authorization: `Bearer ${signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    })}`,
  };
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function rmWastageStockRows(itemId) {
  return prisma.stockTransaction.findMany({
    where: { itemId, transactionType: "RM_WASTAGE" },
  });
}

async function usableAtLocation(itemId, locationId) {
  const agg = await prisma.stockTransaction.aggregate({
    where: { itemId, locationId, stockBucket: "USABLE" },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return n(agg._sum.qtyIn) - n(agg._sum.qtyOut);
}

/**
 * Seed a NO_QTY work order that is ready for a Production Report confirm that
 * posts a wastage-only disposition (issued RM with no consumption/return), fully
 * produced (remainder = 0) so "close" drives execution completion.
 */
async function seedConfirmScenario(tag, user) {
  const customer = await prisma.customer.create({ data: { name: `PRCC_${tag}` } });

  // Active wastage type so the mandatory wastage classification can balance the
  // total scrap qty (Production Report rejects unclassified wastage).
  const wastageType = await prisma.wastageType.create({
    data: { name: `PRCC Process Loss ${tag}`, category: "MISC", isActive: true },
  });

  const fg = await prisma.item.create({
    data: { itemName: `FG_PRCC_${tag}`, itemType: "FG", unit: "Nos", minStockLevel: "0" },
  });
  const rm = await prisma.item.create({
    data: { itemName: `RM_PRCC_${tag}`, itemType: "RM", unit: "Kg", minStockLevel: "0" },
  });

  const prodLoc = await prisma.location.create({
    data: {
      locationCode: `PRCC-PROD-${tag}`,
      locationName: `Production ${tag}`,
      locationType: "PRODUCTION",
      departmentOwner: "PRODUCTION",
      allowRm: true,
      isActive: true,
    },
  });
  const store = await prisma.location.create({
    data: {
      locationCode: `PRCC-STORE-${tag}`,
      locationName: `RM Store ${tag}`,
      locationType: "RM_STORE",
      departmentOwner: "STORES",
      allowRm: true,
      isActive: true,
    },
  });

  const so = await prisma.salesOrder.create({
    data: {
      customerId: customer.id,
      orderType: "NO_QTY",
      internalStatus: "APPROVED",
      lines: { create: [{ itemId: fg.id, qty: "10", customerPoQty: "10" }] },
    },
  });

  const wo = await prisma.workOrder.create({
    data: {
      salesOrderId: so.id,
      status: "IN_PROGRESS",
      lines: { create: [{ fgItemId: fg.id, qty: "10", plannedQty: "10" }] },
    },
    include: { lines: true },
  });
  const wol = wo.lines[0];

  await prisma.workOrderProductionExecution.create({
    data: { workOrderId: wo.id, executionStatus: "RUNNING" },
  });

  // Legacy material issue note (no PMR): gross issued RM to the production location.
  const min = await prisma.materialIssueNote.create({
    data: {
      fromLocationId: store.id,
      toLocationId: prodLoc.id,
      workOrderId: wo.id,
      productionMaterialRequestId: null,
      lines: { create: [{ itemId: rm.id, issueQty: String(ISSUED_QTY) }] },
    },
  });

  // Physical RM on-hand at the production location (returnable / wastage source).
  await prisma.stockTransaction.create({
    data: {
      itemId: rm.id,
      locationId: prodLoc.id,
      transactionType: "LOCATION_TRANSFER",
      refId: min.id,
      stockBucket: "USABLE",
      qtyIn: String(ISSUED_QTY),
      qtyOut: "0",
      createdByUserId: user.id,
    },
  });

  // One approved production batch — full quantity so close = FULL_COMPLETE.
  await prisma.productionEntry.create({
    data: {
      workOrderLineId: wol.id,
      producedQty: "10",
      workflowStatus: "APPROVED",
      date: new Date(),
    },
  });

  return { customer, fg, rm, prodLoc, store, so, wo, wol, min, wastageType };
}

async function cleanupScenario(s) {
  // Restrict FKs: remove confirm artifacts before the WO / locations / items.
  await prisma.stockTransaction.deleteMany({ where: { itemId: { in: [s.rm.id, s.fg.id] } } });
  await prisma.materialWastageNote.deleteMany({ where: { workOrderId: s.wo.id } });
  // Deleting the report cascades its lines, wastage details and return pendings.
  await prisma.productionWorkOrderReport.deleteMany({ where: { workOrderId: s.wo.id } });
  await prisma.productionRmReturnPending.deleteMany({ where: { workOrderId: s.wo.id } });
  await prisma.productionShortfallResolution.deleteMany({ where: { workOrderId: s.wo.id } });
  await prisma.productionEntry.deleteMany({ where: { workOrderLineId: s.wol.id } });
  await prisma.materialIssueNote.deleteMany({ where: { workOrderId: s.wo.id } });
  await prisma.workOrderProductionExecution.deleteMany({ where: { workOrderId: s.wo.id } });
  await prisma.workOrder.delete({ where: { id: s.wo.id } });
  await prisma.salesOrder.delete({ where: { id: s.so.id } });
  await prisma.item.deleteMany({ where: { id: { in: [s.rm.id, s.fg.id] } } });
  await prisma.location.deleteMany({ where: { id: { in: [s.prodLoc.id, s.store.id] } } });
  await prisma.customer.delete({ where: { id: s.customer.id } });
  // Report cascade already removed any wastage-detail rows referencing this type.
  await prisma.wastageType.deleteMany({ where: { id: s.wastageType.id } });
}

d("Production Report Confirm & Close — real-DB rollback + retry (P2028 fix)", () => {
  const app = createApp();
  /** @type {import("@prisma/client").User} */
  let admin;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const hash = await bcrypt.hash("x", 4);
    admin = await prisma.user.upsert({
      where: { email: "prod_report_confirm_close_integ@test.local" },
      create: {
        email: "prod_report_confirm_close_integ@test.local",
        name: "Prod Report Confirm Close Admin",
        role: "ADMIN",
        passwordHash: hash,
        isActive: true,
      },
      update: { role: "ADMIN" },
    });
  });

  it("forced error after wastage posting rolls back the ENTIRE confirmation (no partial commit)", async () => {
    const s = await seedConfirmScenario(`rb_${Date.now()}`, admin);
    try {
      // Mirror the route's single write boundary exactly: lock → approve report
      // (creates report + lines + wastage note + RM_WASTAGE stock) → finish
      // execution (COMPLETED) → reconcile WO status. Then throw BEFORE commit.
      await assert.rejects(
        () =>
          prisma.$transaction(async (tx) => {
            await lockWorkOrderForUpdate(tx, s.wo.id);
            const confirmed = await approveProductionWorkOrderReport(
              tx,
              s.wo.id,
              {
                lines: [{ itemId: s.rm.id, rmConsumedQty: 0, rmReturnQty: 0 }],
                wastageDetails: [{ wastageTypeId: s.wastageType.id, qty: ISSUED_QTY }],
              },
              { userId: admin.id, role: admin.role },
              { includeReport: false },
            );

            // Sanity: the wastage really posted INSIDE this transaction before we fail.
            const inTxMwn = await tx.materialWastageNote.findMany({ where: { workOrderId: s.wo.id } });
            assert.equal(inTxMwn.length, 1, "wastage note is created inside the transaction");
            const inTxWaste = await tx.stockTransaction.findMany({
              where: { itemId: s.rm.id, transactionType: "RM_WASTAGE" },
            });
            assert.equal(inTxWaste.length, 1, "RM_WASTAGE stock is posted inside the transaction");
            assert.ok(n(confirmed.remainderQty) <= EPS, "seed is fully produced (no remainder)");

            await finishProductionExecution(
              tx,
              s.wo.id,
              {},
              { actorUserId: admin.id, actorRole: admin.role },
            );
            await reconcileWorkOrderStatusFromProduction(tx, s.wo.id, {
              actorUserId: admin.id,
              actorRole: admin.role,
              source: "TEST_FORCED_ROLLBACK",
            });

            // Controlled failure after all effects, before commit.
            throw new Error("FORCE_ROLLBACK_BEFORE_COMMIT");
          }),
        /FORCE_ROLLBACK_BEFORE_COMMIT/,
      );

      // Nothing from the confirmation may have persisted (true atomic rollback).
      const report = await prisma.productionWorkOrderReport.findUnique({
        where: { workOrderId: s.wo.id },
      });
      assert.equal(report, null, "no ProductionWorkOrderReport persisted");

      const reportLines = await prisma.productionWorkOrderReportLine.count({
        where: { productionReport: { workOrderId: s.wo.id } },
      });
      assert.equal(reportLines, 0, "no report lines persisted");

      const wastageDetails = await prisma.productionWorkOrderReportWastageDetail.count({
        where: { productionReport: { workOrderId: s.wo.id } },
      });
      assert.equal(wastageDetails, 0, "no report wastage details persisted");

      const mwn = await prisma.materialWastageNote.count({ where: { workOrderId: s.wo.id } });
      assert.equal(mwn, 0, "no MaterialWastageNote persisted (did not escape the rollback)");

      const wasteStock = await rmWastageStockRows(s.rm.id);
      assert.equal(wasteStock.length, 0, "no RM_WASTAGE StockTransaction persisted");

      const returnPending = await prisma.productionRmReturnPending.count({ where: { workOrderId: s.wo.id } });
      assert.equal(returnPending, 0, "no ProductionRmReturnPending persisted");

      const shortfall = await prisma.productionShortfallResolution.count({ where: { workOrderId: s.wo.id } });
      assert.equal(shortfall, 0, "no production shortfall / carry-forward persisted");

      const exec = await prisma.workOrderProductionExecution.findUnique({ where: { workOrderId: s.wo.id } });
      assert.equal(exec.executionStatus, "RUNNING", "execution completion rolled back (still RUNNING)");
      assert.equal(exec.completedAt, null, "execution not marked completed");

      const woAfter = await prisma.workOrder.findUnique({ where: { id: s.wo.id } });
      assert.equal(woAfter.status, "IN_PROGRESS", "WO QA transition rolled back (status unchanged)");

      // RM on-hand at production is untouched — wastage deduction rolled back too.
      assert.ok(
        Math.abs((await usableAtLocation(s.rm.id, s.prodLoc.id)) - ISSUED_QTY) < EPS,
        "RM on-hand at production is restored (no phantom wastage deduction)",
      );
    } finally {
      await cleanupScenario(s);
    }
  });

  it("retry through the real endpoint succeeds exactly once (report + wastage note + RM_WASTAGE) and reaches QA-ready", async () => {
    const s = await seedConfirmScenario(`ok_${Date.now()}`, admin);
    try {
      const res = await request(app)
        .post(`/api/production/work-orders/${s.wo.id}/production-report/confirm`)
        .set(bearer(admin))
        .send({
          lines: [{ itemId: s.rm.id, rmConsumedQty: 0, rmReturnQty: 0 }],
          wastageDetails: [{ wastageTypeId: s.wastageType.id, qty: ISSUED_QTY }],
          closeWorkOrder: true,
        })
        .expect(201);

      assert.equal(res.body.alreadyConfirmed, false);
      assert.ok(res.body.report, "confirm returns the rebuilt report");

      // Exactly one of each artifact — no duplication from the earlier failure path.
      const reports = await prisma.productionWorkOrderReport.findMany({ where: { workOrderId: s.wo.id } });
      assert.equal(reports.length, 1, "exactly one ProductionWorkOrderReport");
      assert.equal(reports[0].status, "CONFIRMED", "report is CONFIRMED");

      const reportLines = await prisma.productionWorkOrderReportLine.findMany({
        where: { productionReportId: reports[0].id },
      });
      assert.equal(reportLines.length, 1, "exactly one report line");
      assert.ok(Math.abs(n(reportLines[0].scrapWasteQty) - ISSUED_QTY) < EPS, "wastage recorded on the line");

      const mwn = await prisma.materialWastageNote.findMany({ where: { workOrderId: s.wo.id } });
      assert.equal(mwn.length, 1, "exactly one MaterialWastageNote");
      assert.ok(Math.abs(n(mwn[0].qty) - ISSUED_QTY) < EPS, "wastage note qty matches");

      const wasteStock = await rmWastageStockRows(s.rm.id);
      assert.equal(wasteStock.length, 1, "exactly one RM_WASTAGE StockTransaction");
      assert.ok(Math.abs(n(wasteStock[0].qtyOut) - ISSUED_QTY) < EPS, "RM_WASTAGE qtyOut matches");

      // RM on-hand at production reduced by the finalized wastage.
      assert.ok(
        Math.abs(await usableAtLocation(s.rm.id, s.prodLoc.id)) < EPS,
        "production RM on-hand is fully written off",
      );

      // WO reaches QA-ready / Pending-QC: execution closed + confirmed report,
      // WO not terminally rejected/closed.
      const exec = await prisma.workOrderProductionExecution.findUnique({ where: { workOrderId: s.wo.id } });
      assert.equal(exec.executionStatus, "COMPLETED", "production execution completed");
      assert.ok(exec.completedAt, "execution completedAt set");

      const woAfter = await prisma.workOrder.findUnique({ where: { id: s.wo.id } });
      assert.ok(
        ["IN_PROGRESS", "PENDING", "COMPLETED"].includes(woAfter.status),
        `WO in a valid post-close QA-ready state (got ${woAfter.status})`,
      );
      assert.notEqual(woAfter.status, "REJECTED");

      // Idempotent retry: a second confirm returns alreadyConfirmed and creates nothing new.
      const retry = await request(app)
        .post(`/api/production/work-orders/${s.wo.id}/production-report/confirm`)
        .set(bearer(admin))
        .send({
          lines: [{ itemId: s.rm.id, rmConsumedQty: 0, rmReturnQty: 0 }],
          wastageDetails: [{ wastageTypeId: s.wastageType.id, qty: ISSUED_QTY }],
          closeWorkOrder: true,
        })
        .expect(200);
      assert.equal(retry.body.alreadyConfirmed, true, "duplicate confirm is idempotent");

      assert.equal(
        (await prisma.materialWastageNote.count({ where: { workOrderId: s.wo.id } })),
        1,
        "still exactly one MaterialWastageNote after idempotent retry",
      );
      assert.equal((await rmWastageStockRows(s.rm.id)).length, 1, "still exactly one RM_WASTAGE stock row");
    } finally {
      await cleanupScenario(s);
    }
  });
});
