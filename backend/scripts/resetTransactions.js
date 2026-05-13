/* eslint-disable no-console */
/**
 * SAFE FULL TRANSACTION RESET
 *
 * Deletes transactional data while keeping master data:
 * - Keeps: Item, Unit, Customer, Supplier (and other master/config tables)
 * - Deletes: sales/prod/qc/dispatch/purchase/stock txns + logs + doc sequences + idempotency records
 *
 * Usage:
 *   node backend/scripts/resetTransactions.js
 *
 * Notes:
 * - Runs deletes inside a single Prisma transaction (atomic for DML).
 * - Auto-increment reset is intentionally NOT done by default (MySQL DDL like TRUNCATE/ALTER may auto-commit).
 */

const { PrismaClient } = require("../prisma/generated/client");

const prisma = new PrismaClient();

async function main() {
  const startedAt = Date.now();

  const result = await prisma.$transaction(async (tx) => {
    /** @type {Record<string, number>} */
    const counts = {};
    async function del(modelName, fn) {
      const r = await fn();
      counts[modelName] = typeof r?.count === "number" ? r.count : 0;
      return r;
    }

    // ============================================================
    // Logs / idempotency first (usually reference many entities)
    // ============================================================
    await del("AuditLog", () => tx.auditLog.deleteMany());
    await del("ActivityLog", () => tx.activityLog.deleteMany());
    await del("IdempotencyRecord", () => tx.idempotencyRecord.deleteMany());

    // ============================================================
    // Stock-related transactional tables
    // ============================================================
    await del("StockAdjustmentQcEntry", () => tx.stockAdjustmentQcEntry.deleteMany());
    // StockTransaction has a self-FK (reversalOfId). Delete children (reversals) first.
    await del("StockTransaction (reversals)", () => tx.stockTransaction.deleteMany({ where: { reversalOfId: { not: null } } }));
    await del("StockTransaction", () => tx.stockTransaction.deleteMany());

    // ============================================================
    // QC / Production
    // ============================================================
    await del("QcRejectedDisposition", () => tx.qcRejectedDisposition.deleteMany());
    // QcEntry is referenced by QC reversal / legacy classification / scrap records.
    await del("QcReversal", () => tx.qcReversal.deleteMany());
    await del("ScrapRecord", () => tx.scrapRecord.deleteMany());
    await del("QcLegacyRejectedClassification", () => tx.qcLegacyRejectedClassification.deleteMany());
    await del("QcEntry", () => tx.qcEntry.deleteMany());
    await del("ProductionEntry", () => tx.productionEntry.deleteMany());

    // ============================================================
    // Dispatch / Billing
    // ============================================================
    await del("SalesBillLine", () => tx.salesBillLine.deleteMany());
    await del("SalesBill", () => tx.salesBill.deleteMany());
    await del("CustomerReturn", () => tx.customerReturn.deleteMany());
    // Dispatch has a self-FK (reversalOfId). Delete reversal rows first.
    await del("Dispatch (reversals)", () => tx.dispatch.deleteMany({ where: { reversalOfId: { not: null } } }));
    await del("Dispatch", () => tx.dispatch.deleteMany());

    // ============================================================
    // Requirement + Work orders
    // ============================================================
    await del("RequirementSheetLine", () => tx.requirementSheetLine.deleteMany());
    await del("RequirementSheet", () => tx.requirementSheet.deleteMany());
    await del("WorkOrderLine", () => tx.workOrderLine.deleteMany());
    await del("WorkOrder", () => tx.workOrder.deleteMany());

    // ============================================================
    // Purchase flow
    // ============================================================
    await del("PurchaseBillLine", () => tx.purchaseBillLine.deleteMany());
    await del("PurchaseBill", () => tx.purchaseBill.deleteMany());
    await del("GrnLine", () => tx.grnLine.deleteMany());
    await del("Grn", () => tx.grn.deleteMany());
    await del("RmPurchaseOrderLine", () => tx.rmPurchaseOrderLine.deleteMany());
    await del("RmPurchaseOrder", () => tx.rmPurchaseOrder.deleteMany());

    // ============================================================
    // Sales flow (SO)
    // ============================================================
    await del("SalesOrderLine", () => tx.salesOrderLine.deleteMany());
    await del("SalesOrderCycle", () => tx.salesOrderCycle.deleteMany());
    await del("SalesOrder", () => tx.salesOrder.deleteMany());

    // ============================================================
    // Sales funnel transactional data (not master)
    // ============================================================
    await del("QuotationLine", () => tx.quotationLine.deleteMany());
    await del("Quotation", () => tx.quotation.deleteMany());
    await del("Enquiry", () => tx.enquiry.deleteMany());
    await del("CustomerPO", () => tx.customerPO.deleteMany());

    // ============================================================
    // Doc sequences
    // ============================================================
    await del("DocSequence", () => tx.docSequence.deleteMany());

    return counts;
  });

  const elapsedMs = Date.now() - startedAt;
  console.log("All transactional data deleted successfully.");
  console.log(`Elapsed: ${elapsedMs}ms`);
  console.log("Deleted counts:", result);
  console.log("Master tables preserved: Item, Unit, Customer, Supplier");
}

main()
  .catch((e) => {
    console.error("Reset failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

