/**
 * Removes all business / transactional / master data in FK-safe order.
 * Preserves User and AppSetting. Safe to run multiple times (idempotent).
 *
 * Usage (from backend/):  node prisma/reset-business-data.js
 * Or:                     npm run db:reset-business
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function logStep(name, promise) {
  const result = await promise;
  const count = result?.count ?? 0;
  // eslint-disable-next-line no-console
  console.log(`[reset-business] ${name}: deleted ${count} row(s)`);
  return count;
}

async function main() {
  // eslint-disable-next-line no-console
  console.log("[reset-business] Starting transaction (User + AppSetting preserved)…");

  await prisma.$transaction(
    async (tx) => {
      await logStep("QcReversal", tx.qcReversal.deleteMany({}));
      await logStep("QcEntry", tx.qcEntry.deleteMany({}));
      await logStep("ProductionEntry", tx.productionEntry.deleteMany({}));
      await logStep("WorkOrderLine", tx.workOrderLine.deleteMany({}));
      await logStep("ScrapRecord", tx.scrapRecord.deleteMany({}));
      await logStep("WorkOrder", tx.workOrder.deleteMany({}));
      await logStep("Dispatch", tx.dispatch.deleteMany({}));
      await logStep("SalesOrderLine", tx.salesOrderLine.deleteMany({}));
      await logStep("SalesOrder", tx.salesOrder.deleteMany({}));
      await logStep("CustomerPOLine", tx.customerPOLine.deleteMany({}));
      await logStep("CustomerPO", tx.customerPO.deleteMany({}));
      await logStep("QuotationLine", tx.quotationLine.deleteMany({}));
      await logStep("Quotation", tx.quotation.deleteMany({}));
      await logStep("Feasibility", tx.feasibility.deleteMany({}));
      await logStep("EnquiryLine", tx.enquiryLine.deleteMany({}));
      await logStep("Enquiry", tx.enquiry.deleteMany({}));
      await logStep("GrnLine", tx.grnLine.deleteMany({}));
      await logStep("Grn", tx.grn.deleteMany({}));
      await logStep("RmPurchaseOrderLine", tx.rmPurchaseOrderLine.deleteMany({}));
      await logStep("RmPurchaseOrder", tx.rmPurchaseOrder.deleteMany({}));
      await logStep("BomLine", tx.bomLine.deleteMany({}));
      await logStep("Bom", tx.bom.deleteMany({}));
      await logStep("StockTransaction", tx.stockTransaction.deleteMany({}));
      await logStep("Item", tx.item.deleteMany({}));
      await logStep("Customer", tx.customer.deleteMany({}));
      await logStep("Supplier", tx.supplier.deleteMany({}));
    },
    { timeout: 120_000 },
  );

  // eslint-disable-next-line no-console
  console.log("[reset-business] Done.");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[reset-business] Failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
