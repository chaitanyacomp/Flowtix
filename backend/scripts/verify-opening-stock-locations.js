const { prisma } = require("../src/utils/prisma");
const { buildStockSummaryBucketsRows } = require("../src/services/stockService");
const { getMaterialAvailabilityByItems } = require("../src/services/materialAvailabilityService");
const { getDefaultRmStoreLocationId } = require("../src/services/locationService");
const { getAvailableRmAtLocation } = require("../src/services/materialIssueService");

(async () => {
  const rmStoreId = await getDefaultRmStoreLocationId(prisma);
  const summary = await buildStockSummaryBucketsRows(prisma);
  for (const name of ["PP", "Powder"]) {
    const item = await prisma.item.findFirst({ where: { itemName: name } });
    const id = item.id;
    const [availRm, issue] = await Promise.all([
      getMaterialAvailabilityByItems({
        db: prisma,
        itemIds: [id],
        locationScope: { locationId: rmStoreId },
        includeIncoming: false,
        includeIssued: false,
      }),
      getAvailableRmAtLocation(id, rmStoreId, prisma),
    ]);
    const sum = summary.find((r) => r.itemId === id);
    const loc = await prisma.stockTransaction.groupBy({
      by: ["locationId"],
      where: { itemId: id, stockBucket: "USABLE", reversedAt: null },
      _sum: { qtyIn: true, qtyOut: true },
    });
    console.log(
      JSON.stringify(
        {
          itemName: name,
          totalStock: sum?.usableQty,
          rmStoreStock: availRm[0].physicalUsableStockQty,
          committed: availRm[0].effectiveReservedQty,
          freeStock: availRm[0].freeStockQty,
          materialIssueAvailable: issue.available,
          locationBreakdown: loc.map((r) => ({
            locationId: r.locationId,
            net: Number(r._sum.qtyIn) - Number(r._sum.qtyOut),
          })),
        },
        null,
        2,
      ),
    );
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
