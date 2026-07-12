/* eslint-disable no-console */
/**
 * SAFE FULL TRANSACTION RESET
 *
 * Delegates to the authoritative Settings → Reset Transaction Data path
 * (`runResetTransactionDataInTransaction`) so FK order stays in sync —
 * including NO_QTY recovery / waiver / carry-forward children.
 *
 * Usage:
 *   node backend/scripts/resetTransactions.js
 */

const { prisma } = require("../src/utils/prisma");
const { runResetTransactionDataInTransaction } = require("../src/routes/adminDatabaseCleanup");

async function main() {
  const startedAt = Date.now();
  const summary = await prisma.$transaction(async (tx) => runResetTransactionDataInTransaction(tx), {
    timeout: 120_000,
  });
  const elapsedMs = Date.now() - startedAt;
  console.log("All transactional data deleted successfully.");
  console.log(`Elapsed: ${elapsedMs}ms`);
  console.log(
    "Deleted counts:",
    Object.fromEntries(summary.map((s) => [s.table, s.deleted])),
  );
  console.log("Master tables preserved: Item, Unit, Customer, Supplier, Users, Roles, BOM, Settings");
}

main()
  .catch((e) => {
    console.error("Reset failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
