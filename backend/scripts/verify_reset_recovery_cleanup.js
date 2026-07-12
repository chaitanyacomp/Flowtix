/**
 * Runtime acceptance: Reset Transaction Data with recovery/waiver children present.
 */
const { prisma } = require("../src/utils/prisma");
const { runResetTransactionDataInTransaction } = require("../src/routes/adminDatabaseCleanup");

async function counts() {
  return {
    recoveryAllocation: await prisma.recoveryAllocation.count(),
    noQtySoWaiverLine: await prisma.noQtySoWaiverLine.count(),
    noQtySoWaiver: await prisma.noQtySoWaiver.count(),
    carryForwardPending: await prisma.carryForwardPending.count(),
    productionShortfallResolution: await prisma.productionShortfallResolution.count(),
    salesOrder: await prisma.salesOrder.count(),
    item: await prisma.item.count(),
    customer: await prisma.customer.count(),
    user: await prisma.user.count(),
  };
}

async function main() {
  const before = await counts();
  console.log(JSON.stringify({ phase: "before", before }, null, 2));

  const summary1 = await prisma.$transaction((tx) => runResetTransactionDataInTransaction(tx), {
    timeout: 180_000,
  });
  const after1 = await counts();

  const summary2 = await prisma.$transaction((tx) => runResetTransactionDataInTransaction(tx), {
    timeout: 180_000,
  });
  const after2 = await counts();

  const transactionalZero =
    after1.recoveryAllocation === 0 &&
    after1.noQtySoWaiverLine === 0 &&
    after1.noQtySoWaiver === 0 &&
    after1.carryForwardPending === 0 &&
    after1.productionShortfallResolution === 0 &&
    after1.salesOrder === 0;

  const mastersPreserved =
    after1.item === before.item &&
    after1.customer === before.customer &&
    after1.user === before.user &&
    after2.item === before.item;

  const ok = transactionalZero && mastersPreserved && after2.salesOrder === 0;

  console.log(
    JSON.stringify(
      {
        ok,
        before,
        afterFirstReset: after1,
        afterSecondReset: after2,
        deletedCarryForward:
          summary1.find((s) => s.table === "carryForwardPending")?.deleted ?? null,
        deletedRecoveryAllocation:
          summary1.find((s) => s.table === "recoveryAllocation")?.deleted ?? null,
        mastersPreserved,
        idempotent: after2.carryForwardPending === 0,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 2;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
