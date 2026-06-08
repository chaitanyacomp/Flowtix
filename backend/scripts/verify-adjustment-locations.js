/**
 * Verify ADJUSTMENT ledger rows have a physical location assigned.
 *
 * Usage:
 *   node scripts/verify-adjustment-locations.js
 */

const { prisma } = require("../src/utils/prisma");

async function main() {
  const nullRows = await prisma.stockTransaction.findMany({
    where: {
      transactionType: "ADJUSTMENT",
      locationId: null,
    },
    select: {
      id: true,
      itemId: true,
      qtyIn: true,
      qtyOut: true,
      item: { select: { itemName: true, itemType: true } },
    },
    orderBy: { id: "asc" },
  });

  if (!nullRows.length) {
    console.log("OK: 0 ADJUSTMENT rows with locationId IS NULL.");
    return;
  }

  console.error(`FAIL: ${nullRows.length} ADJUSTMENT row(s) still have locationId IS NULL:`);
  for (const row of nullRows) {
    console.error(
      JSON.stringify({
        stockTransactionId: row.id,
        itemId: row.itemId,
        itemName: row.item?.itemName,
        itemType: row.item?.itemType,
        qtyIn: Number(row.qtyIn),
        qtyOut: Number(row.qtyOut),
      }),
    );
  }
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
