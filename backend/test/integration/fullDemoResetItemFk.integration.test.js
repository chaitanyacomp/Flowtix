/**
 * Full Demo Reset — Item FK (rmItemId) + preserve/rollback integration.
 *
 * Seeds RmPlanLine (rmItemId → Item Restrict) and related recent models, then
 * asserts Full Demo Reset deletes children before Item without FK violation,
 * preserves users/AppSetting/State, and rolls back on forced mid-reset failure.
 *
 * Run: NODE_ENV=test TEST_DATABASE_URL=... npm run test:integration:db
 */

const { runIntegration } = require("./_integrationEnv");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { prisma } = require("../../src/utils/prisma");
const { runFullDemoResetDeletes, runResetTransactionDataInTransaction } = require("../../src/routes/adminDatabaseCleanup");

const d = runIntegration ? describe : describe.skip;

d("Full Demo Reset — rmItemId / Item FK coverage", () => {
  /** @type {{ itemId: number, rmItemId: number, userId: number, customerId: number, supplierId: number, appSettingId: number|null, stateId: number|null, soRegularId: number, planId: number, rmPlanId: number, tallyTransportationLedger: string|null } | null} */
  let seeded = null;

  before(async () => {
    const tag = `fdemo_${Date.now()}`;
    const periodKey = `2099-${String((Date.now() % 12) + 1).padStart(2, "0")}`;

    const unit =
      (await prisma.unit.findFirst({ select: { id: true, unitName: true } })) ||
      (await prisma.unit.create({ data: { unitName: `U-${tag}`, unitCode: `U${Date.now() % 10000}` } }));
    const unitLabel = unit.unitName || "PCS";

    const fg = await prisma.item.create({
      data: {
        itemName: `FullDemo FG ${tag}`,
        itemType: "FG",
        unit: unitLabel,
        minStockLevel: "0",
      },
    });
    const rm = await prisma.item.create({
      data: {
        itemName: `FullDemo RM ${tag}`,
        itemType: "RM",
        unit: unitLabel,
        minStockLevel: "0",
      },
    });

    const user =
      (await prisma.user.findFirst({ select: { id: true } })) ||
      (await prisma.user.create({
        data: {
          email: `fdemo-${tag}@test.local`,
          name: "FullDemo Tester",
          passwordHash: "x",
          role: "ADMIN",
        },
      }));

    const customer = await prisma.customer.create({
      data: { name: `FullDemo Cust ${tag}` },
    });
    const supplier = await prisma.supplier.create({
      data: { name: `FullDemo Sup ${tag}` },
    });

    const appSetting = await prisma.appSetting.findFirst({
      select: { id: true, tallyTransportationLedger: true },
    });
    const state = await prisma.state.findFirst({ select: { id: true } });

    const soRegular = await prisma.salesOrder.create({
      data: {
        orderType: "NORMAL",
        customerId: customer.id,
        internalStatus: "IN_PROCESS",
        lines: { create: [{ itemId: fg.id, qty: "2", rate: "10" }] },
      },
    });

    const plan = await prisma.monthlyProductionPlan.create({
      data: {
        periodKey,
        planSequenceNo: 9000 + (Date.now() % 1000),
        status: "DRAFT",
        lines: {
          create: [{ fgItemId: fg.id, plannedFgQty: 5, suggestedFgQty: 5 }],
        },
      },
    });

    const rmPlan = await prisma.rmPlan.create({
      data: {
        planId: plan.id,
        revision: 1,
        totalFgPlannedQty: 5,
        lines: {
          create: [
            {
              rmItemId: rm.id,
              grossDemandQty: 10,
              freeStockSnapshot: 0,
              reservedSnapshot: 0,
              incomingPoSnapshot: 0,
              minStockTopUpQty: 0,
              netRequirementQty: 10,
            },
          ],
        },
      },
    });

    // Previous Full Demo stage before Item — RateContractLine Restrict → Item
    await prisma.rateContractLine.create({
      data: {
        customerId: customer.id,
        itemId: fg.id,
        rate: "11",
        gstRate: "18",
        effectiveFrom: new Date("2099-01-01"),
        status: "APPROVED",
      },
    });

    seeded = {
      itemId: fg.id,
      rmItemId: rm.id,
      userId: user.id,
      customerId: customer.id,
      supplierId: supplier.id,
      appSettingId: appSetting?.id ?? null,
      stateId: state?.id ?? null,
      soRegularId: soRegular.id,
      planId: plan.id,
      rmPlanId: rmPlan.id,
      tallyTransportationLedger: appSetting?.tallyTransportationLedger ?? null,
    };
  });

  it("1–3. Full Demo deletes RmPlanLine before Item and completes with recent models", async () => {
    assert.ok(seeded);
    assert.ok((await prisma.rmPlanLine.count({ where: { rmItemId: seeded.rmItemId } })) >= 1);

    /** @type {Record<string, number>} */
    const deleted = {};
    await prisma.$transaction(async (tx) => runFullDemoResetDeletes(tx, deleted), { timeout: 300_000 });

    assert.equal(await prisma.rmPlanLine.count(), 0);
    assert.equal(await prisma.item.count({ where: { id: { in: [seeded.itemId, seeded.rmItemId] } } }), 0);
    assert.equal(await prisma.customer.count({ where: { id: seeded.customerId } }), 0);
    assert.equal(await prisma.supplier.count({ where: { id: seeded.supplierId } }), 0);
    assert.ok((deleted.item ?? 0) >= 1);
    assert.ok((deleted.rmPlanLine ?? 0) >= 1);

    // 5. Users survive
    assert.ok(await prisma.user.findUnique({ where: { id: seeded.userId } }));

    // 6. AppSetting (incl. tallyTransportationLedger) survives
    if (seeded.appSettingId != null) {
      const setting = await prisma.appSetting.findUnique({ where: { id: seeded.appSettingId } });
      assert.ok(setting);
      assert.equal(setting.tallyTransportationLedger, seeded.tallyTransportationLedger);
    }

    // 7. State survives when present
    if (seeded.stateId != null) {
      assert.ok(await prisma.state.findUnique({ where: { id: seeded.stateId } }));
    }
  });

  it("4. Forced mid-reset failure rolls back earlier deletions", async () => {
    const tag = `rb_${Date.now()}`;
    const unit =
      (await prisma.unit.findFirst()) ||
      (await prisma.unit.create({ data: { unitName: `UR-${tag}`, unitCode: `R${Date.now() % 10000}` } }));
    const item = await prisma.item.create({
      data: { itemName: `RB Item ${tag}`, itemType: "RM", unit: unit.unitName || "PCS", minStockLevel: "0" },
    });
    const customer = await prisma.customer.create({ data: { name: `RB Cust ${tag}` } });

    let rolledBack = false;
    try {
      await prisma.$transaction(async (tx) => {
        /** @type {Record<string, number>} */
        const deleted = {};
        await runFullDemoResetDeletes(tx, deleted);
        throw Object.assign(new Error("forced full-demo rollback"), { code: "FORCED_FULL_DEMO_ROLLBACK" });
      });
    } catch (e) {
      assert.equal(e && e.code, "FORCED_FULL_DEMO_ROLLBACK");
      rolledBack = true;
    }
    assert.equal(rolledBack, true);
    assert.equal(await prisma.item.count({ where: { id: item.id } }), 1);
    assert.equal(await prisma.customer.count({ where: { id: customer.id } }), 1);

    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
  });

  it("8. Transaction Reset preserves Items after seeding a transactional SO", async () => {
    const tag = `txp_${Date.now()}`;
    const unit = await prisma.unit.findFirst();
    assert.ok(unit);
    const item = await prisma.item.create({
      data: { itemName: `TxPreserve ${tag}`, itemType: "FG", unit: unit.unitName || "PCS", minStockLevel: "0" },
    });
    const customer = await prisma.customer.create({ data: { name: `TxPreserve Cust ${tag}` } });
    const so = await prisma.salesOrder.create({
      data: {
        orderType: "NO_QTY",
        customerId: customer.id,
        internalStatus: "IN_PROCESS",
        lines: { create: [{ itemId: item.id, qty: "0", rate: "0" }] },
      },
    });

    await prisma.$transaction(async (tx) => runResetTransactionDataInTransaction(tx), { timeout: 180_000 });

    assert.equal(await prisma.salesOrder.count({ where: { id: so.id } }), 0);
    assert.ok(await prisma.item.findUnique({ where: { id: item.id } }));
    assert.ok(await prisma.customer.findUnique({ where: { id: customer.id } }));
  });
});
