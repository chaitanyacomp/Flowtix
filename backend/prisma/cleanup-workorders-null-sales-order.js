/**
 * One-time (or repeat-safe) cleanup: removes WorkOrder rows whose salesOrderId IS NULL,
 * including dependent WorkOrderLine / ProductionEntry / QcEntry / ScrapRecord data.
 *
 * Run BEFORE applying migration that sets WorkOrder.salesOrderId to NOT NULL if DB still allows NULL.
 *
 * Usage (from backend/):  node prisma/cleanup-workorders-null-sales-order.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const badRows = await prisma.$queryRaw`SELECT id FROM WorkOrder WHERE salesOrderId IS NULL`;
  const ids = badRows.map((r) => r.id);
  if (!ids.length) {
    // eslint-disable-next-line no-console
    console.log("[cleanup-null-so-wo] No WorkOrder rows with NULL salesOrderId. Nothing to do.");
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[cleanup-null-so-wo] Removing ${ids.length} work order(s) with NULL salesOrderId: ${ids.join(", ")}`);

  await prisma.$transaction(
    async (tx) => {
      const qc = await tx.qcEntry.deleteMany({
        where: { production: { workOrderLine: { workOrderId: { in: ids } } } },
      });
      // eslint-disable-next-line no-console
      console.log(`[cleanup-null-so-wo] QcEntry deleted: ${qc.count}`);

      const pe = await tx.productionEntry.deleteMany({
        where: { workOrderLine: { workOrderId: { in: ids } } },
      });
      // eslint-disable-next-line no-console
      console.log(`[cleanup-null-so-wo] ProductionEntry deleted: ${pe.count}`);

      const wol = await tx.workOrderLine.deleteMany({ where: { workOrderId: { in: ids } } });
      // eslint-disable-next-line no-console
      console.log(`[cleanup-null-so-wo] WorkOrderLine deleted: ${wol.count}`);

      const scrap = await tx.scrapRecord.deleteMany({ where: { workOrderId: { in: ids } } });
      // eslint-disable-next-line no-console
      console.log(`[cleanup-null-so-wo] ScrapRecord deleted: ${scrap.count}`);

      const wo = await tx.workOrder.deleteMany({ where: { id: { in: ids } } });
      // eslint-disable-next-line no-console
      console.log(`[cleanup-null-so-wo] WorkOrder deleted: ${wo.count}`);
    },
    { timeout: 120_000 },
  );

  // eslint-disable-next-line no-console
  console.log("[cleanup-null-so-wo] Done.");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[cleanup-null-so-wo] Failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
