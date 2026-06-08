/**
 * Backfill locationId on ADJUSTMENT StockTransaction rows posted without a store.
 *
 * Usage:
 *   node scripts/repair-adjustment-null-locations.js
 *   node scripts/repair-adjustment-null-locations.js --dry-run
 */

const { prisma } = require("../src/utils/prisma");
const { resolveDefaultOpeningStockLocationId } = require("../src/services/locationService");

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await prisma.stockTransaction.findMany({
    where: {
      transactionType: "ADJUSTMENT",
      locationId: null,
    },
    select: {
      id: true,
      itemId: true,
      qtyIn: true,
      qtyOut: true,
      stockBucket: true,
      item: { select: { itemName: true, itemType: true } },
    },
    orderBy: { id: "asc" },
  });

  if (!rows.length) {
    console.log("No ADJUSTMENT rows with null locationId.");
    return;
  }

  console.log(`Found ${rows.length} ADJUSTMENT row(s) to repair${dryRun ? " (dry run)" : ""}.`);

  /** @type {Map<string, { count: number, locationIds: Set<number> }>} */
  const grouped = new Map();

  for (const row of rows) {
    const itemType = row.item?.itemType || "RM";
    const locationId = await resolveDefaultOpeningStockLocationId(prisma, itemType);
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { locationCode: true, locationName: true },
    });
    const groupKey = `${itemType} → ${location?.locationCode || locationId}`;
    const slot = grouped.get(groupKey) || { count: 0, locationIds: new Set() };
    slot.count += 1;
    slot.locationIds.add(locationId);
    grouped.set(groupKey, slot);

    console.log(
      JSON.stringify({
        stockTransactionId: row.id,
        itemId: row.itemId,
        itemName: row.item?.itemName,
        itemType,
        stockBucket: row.stockBucket,
        qtyIn: Number(row.qtyIn),
        qtyOut: Number(row.qtyOut),
        locationId,
        locationCode: location?.locationCode ?? null,
        locationName: location?.locationName ?? null,
      }),
    );

    if (!dryRun) {
      await prisma.stockTransaction.update({
        where: { id: row.id },
        data: { locationId },
      });
    }
  }

  console.log("Grouped summary:");
  for (const [key, { count, locationIds }] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${key}: ${count} row(s), locationId(s): ${[...locationIds].join(", ")}`);
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
