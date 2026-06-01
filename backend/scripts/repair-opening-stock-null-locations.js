/**
 * Backfill locationId on OPENING StockTransaction rows that were posted without a store.
 *
 * Usage:
 *   node scripts/repair-opening-stock-null-locations.js
 *   node scripts/repair-opening-stock-null-locations.js --dry-run
 */

const { prisma } = require("../src/utils/prisma");
const { resolveDefaultOpeningStockLocationId } = require("../src/services/locationService");

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await prisma.stockTransaction.findMany({
    where: {
      transactionType: "OPENING",
      locationId: null,
      stockBucket: "USABLE",
    },
    select: {
      id: true,
      itemId: true,
      qtyIn: true,
      refId: true,
      item: { select: { itemName: true, itemType: true } },
    },
    orderBy: { id: "asc" },
  });

  if (!rows.length) {
    console.log("No OPENING USABLE rows with null locationId.");
    return;
  }

  console.log(`Found ${rows.length} row(s) to repair${dryRun ? " (dry run)" : ""}.`);

  for (const row of rows) {
    const locationId = await resolveDefaultOpeningStockLocationId(prisma, row.item.itemType);
    console.log(
      JSON.stringify({
        stockTransactionId: row.id,
        itemId: row.itemId,
        itemName: row.item.itemName,
        itemType: row.item.itemType,
        qtyIn: Number(row.qtyIn),
        locationId,
      }),
    );
    if (!dryRun) {
      await prisma.stockTransaction.update({
        where: { id: row.id },
        data: { locationId },
      });
    }
  }

  console.log(dryRun ? "Dry run complete — no rows updated." : "Repair complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
