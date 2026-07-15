/**
 * Reset Transaction Data — recovery cluster + rollback integration proof.
 *
 * Seeds Phase 2B Keep/Waive dependency rows (decision lines Restrict → CFP) and
 * asserts Reset Transaction Data deletes without FK violation, preserves masters,
 * and rolls back the whole wipe when verification fails mid-transaction.
 *
 * Run: NODE_ENV=test TEST_DATABASE_URL=... npm run test:integration:db
 */

const { runIntegration } = require("./_integrationEnv");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { prisma } = require("../../src/utils/prisma");
const { runResetTransactionDataInTransaction } = require("../../src/routes/adminDatabaseCleanup");
const { NO_QTY_RECOVERY_CLEANUP_TABLES } = require("../../src/services/noQtyRecoveryCleanupService");

const d = runIntegration ? describe : describe.skip;

d("Reset Transaction Data — cleanup registry integration", () => {
  /** @type {{ itemId: number, userId: number, customerId: number, soId: number, sheetId: number, cfId: number } | null} */
  let seeded = null;

  before(async () => {
    const tag = `cleanup_${Date.now()}`;

    const item = await prisma.item.create({
      data: {
        itemName: `Cleanup FG ${tag}`,
        itemType: "FG",
        unit: "PCS",
        minStockLevel: "0",
      },
    });

    const user =
      (await prisma.user.findFirst({ select: { id: true } })) ||
      (await prisma.user.create({
        data: {
          email: `cleanup-${tag}@test.local`,
          name: "Cleanup Tester",
          passwordHash: "x",
          role: "ADMIN",
        },
      }));

    const customer = await prisma.customer.create({
      data: { name: `Cleanup Cust ${tag}` },
    });

    const so = await prisma.salesOrder.create({
      data: {
        orderType: "NO_QTY",
        customerId: customer.id,
        internalStatus: "IN_PROCESS",
        lines: { create: [{ itemId: item.id, qty: "0", rate: "0" }] },
      },
    });

    const cycle = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 1, status: "ACTIVE" },
    });

    await prisma.salesOrder.update({
      where: { id: so.id },
      data: { currentCycleId: cycle.id },
    });

    const sheet = await prisma.requirementSheet.create({
      data: {
        salesOrderId: so.id,
        cycleId: cycle.id,
        periodKey: "2099-01",
        version: 1,
        status: "DRAFT",
        lines: {
          create: [
            {
              itemId: item.id,
              requirementQty: 10,
              baseDemandQty: 10,
              totalRsQty: 10,
            },
          ],
        },
      },
    });

    const line = await prisma.requirementSheetLine.findFirst({
      where: { sheetId: sheet.id, itemId: item.id },
    });

    const cf = await prisma.carryForwardPending.create({
      data: {
        salesOrderId: so.id,
        itemId: item.id,
        cycleId: cycle.id,
        recoveryType: "PRODUCTION_SHORTFALL",
        sourceDocumentType: "PRODUCTION_SHORTFALL_RESOLUTION",
        sourceDocumentId: 9_000_001 + (Date.now() % 100000),
        sourceQty: 5,
        remainingQty: 5,
        recoveryStatus: "OPEN",
        status: "PENDING",
      },
    });

    const decision = await prisma.noQtyRsItemRecoveryDecision.create({
      data: {
        requirementSheetId: sheet.id,
        itemId: item.id,
        status: "PENDING",
        productionShortfallQty: 5,
        qcFinalRejectionQty: 0,
        pendingRecoveryQty: 5,
      },
    });

    await prisma.noQtyRsItemRecoveryDecisionLine.create({
      data: {
        decisionId: decision.id,
        recoverySourceId: cf.id,
        recoveryType: "PRODUCTION_SHORTFALL",
        qty: 5,
        effect: "KEEP",
      },
    });

    await prisma.recoveryAllocation.create({
      data: {
        recoverySourceId: cf.id,
        requirementSheetId: sheet.id,
        requirementSheetLineId: line.id,
        allocatedQty: 1,
        status: "RESERVED",
      },
    });

    seeded = {
      itemId: item.id,
      userId: user.id,
      customerId: customer.id,
      soId: so.id,
      sheetId: sheet.id,
      cfId: cf.id,
    };
  });

  it("deletes Phase 2B recovery children before CFP without FK violation", async () => {
    assert.ok(seeded);
    assert.ok((await prisma.noQtyRsItemRecoveryDecisionLine.count()) >= 1);
    assert.ok((await prisma.carryForwardPending.count({ where: { id: seeded.cfId } })) === 1);

    await prisma.$transaction(async (tx) => runResetTransactionDataInTransaction(tx), {
      timeout: 180_000,
    });

    for (const table of NO_QTY_RECOVERY_CLEANUP_TABLES) {
      if (typeof prisma[table]?.count === "function") {
        assert.equal(await prisma[table].count(), 0, `${table} must be empty`);
      }
    }
    assert.equal(await prisma.salesOrder.count({ where: { id: seeded.soId } }), 0);
    assert.equal(await prisma.requirementSheet.count({ where: { id: seeded.sheetId } }), 0);

    assert.ok(await prisma.item.findUnique({ where: { id: seeded.itemId } }));
    assert.ok(await prisma.user.findUnique({ where: { id: seeded.userId } }));
    assert.ok(await prisma.customer.findUnique({ where: { id: seeded.customerId } }));
  });

  it("rolls back transactional wipe when an intentional failure is thrown inside the transaction", async () => {
    const item = await prisma.item.findFirst({ where: { itemType: "FG" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ select: { id: true } });
    assert.ok(item && customer);

    const so = await prisma.salesOrder.create({
      data: {
        orderType: "NO_QTY",
        customerId: customer.id,
        internalStatus: "IN_PROCESS",
      },
    });

    let rolledBack = false;
    try {
      await prisma.$transaction(async (tx) => {
        await runResetTransactionDataInTransaction(tx);
        throw Object.assign(new Error("forced cleanup rollback"), { code: "FORCED_CLEANUP_ROLLBACK" });
      });
    } catch (e) {
      assert.equal(e && e.code, "FORCED_CLEANUP_ROLLBACK");
      rolledBack = true;
    }
    assert.equal(rolledBack, true);
    assert.equal(await prisma.salesOrder.count({ where: { id: so.id } }), 1);
    await prisma.salesOrder.delete({ where: { id: so.id } });
  });
});
