const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const adminDatabaseCleanupRouter = express.Router();

const resetSchema = z.object({
  confirmText: z.string().optional(),
});

const fullDemoResetSchema = z.object({
  confirmText: z.string().optional(),
});

const noQtyResetSchema = z.object({
  confirmText: z.string().optional(),
});

async function tableExists(tx, candidates) {
  const names = Array.isArray(candidates) ? candidates : [candidates];
  for (const n of names) {
    const rows = await tx.$queryRaw`
      SELECT 1 as ok
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND LOWER(table_name) = LOWER(${String(n)})
      LIMIT 1
    `;
    if (Array.isArray(rows) && rows.length > 0) return true;
  }
  return false;
}

async function deleteManySafe(tx, label, deleter) {
  const res = await deleter();
  const count = typeof res?.count === "number" ? res.count : 0;
  return { table: label, deleted: count };
}

class CleanupStepError extends Error {
  /** @param {{ step: string; error: string }} input */
  constructor({ step, error }) {
    super(`FAILED at ${step}: ${error}`);
    this.name = "CleanupStepError";
    this.step = step;
    this.error = error;
  }
}

/**
 * Prefer readable copy for Prisma FK violations (P2003) instead of long engine messages.
 * @param {string} stepLabel
 * @param {unknown} err
 */
function formatCleanupDeleteError(stepLabel, err) {
  const fallback =
    err && typeof err === "object" && err !== null && "message" in err
      ? String(/** @type {{ message: unknown }} */ (err).message)
      : "Delete failed";

  if (!err || typeof err !== "object" || err === null) return fallback;

  const code = "code" in err ? String(/** @type {{ code?: unknown }} */ (err).code) : "";
  if (code !== "P2003") return fallback;

  const rawMeta = "meta" in err ? /** @type {{ meta?: unknown }} */ (err).meta : undefined;
  const meta = rawMeta && typeof rawMeta === "object" && rawMeta !== null ? /** @type {Record<string, unknown>} */ (rawMeta) : {};
  const modelName = typeof meta.model_name === "string" ? meta.model_name : null;
  const fieldName = typeof meta.field_name === "string" ? meta.field_name : null;

  if (stepLabel === "item" && modelName) {
    return `Cannot delete Items because dependent records still exist in ${modelName}.${fieldName ? ` (foreign key: ${fieldName})` : ""}`;
  }
  if (modelName) {
    return `This step is blocked: dependent records still exist in ${modelName}.${fieldName ? ` (foreign key: ${fieldName})` : ""}`;
  }

  return fallback;
}

async function runDeleteSteps(tx, summary, steps) {
  for (const [name, fn] of steps) {
    try {
      summary.push(await deleteManySafe(tx, name, fn));
    } catch (err) {
      const msg = formatCleanupDeleteError(name, err);
      throw new CleanupStepError({ step: name, error: msg });
    }
  }
}

/**
 * @param {Record<string, number>} deleted
 * @param {string} key
 * @param {() => Promise<{ count?: number }>} fn
 */
async function addDeleteCount(deleted, key, fn) {
  const res = await fn();
  const c = typeof res?.count === "number" ? res.count : 0;
  deleted[key] = (deleted[key] ?? 0) + c;
}

/**
 * Optional table (migration may not exist on older DBs).
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {Record<string, number>} deleted
 * @param {string[] | string} tableCandidates
 * @param {string} label
 * @param {() => Promise<{ count?: number }>} deleter
 */
async function tryOptionalTableDelete(tx, deleted, tableCandidates, label, deleter) {
  if (!(await tableExists(tx, tableCandidates))) {
    deleted[label] = 0;
    return;
  }
  await addDeleteCount(deleted, label, deleter);
}

/**
 * Deletes transactional rows for `SalesOrder.orderType = NO_QTY` only (masters preserved).
 * FK order follows admin reset conventions; self-FKs are cleared in a scoped way where possible.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @returns {Promise<Record<string, number>>}
 */
async function runResetNoQtyTransactionalDeletes(tx) {
  /** @type {Record<string, number>} */
  const deletedCounts = {};

  const noQtySoIds = (
    await tx.salesOrder.findMany({
      where: { orderType: "NO_QTY" },
      select: { id: true },
    })
  ).map((r) => r.id);

  if (noQtySoIds.length === 0) {
    return deletedCounts;
  }

  const woIds = (
    await tx.workOrder.findMany({
      where: { salesOrderId: { in: noQtySoIds } },
      select: { id: true },
    })
  ).map((r) => r.id);

  const wolIds =
    woIds.length === 0
      ? []
      : (
          await tx.workOrderLine.findMany({
            where: { workOrderId: { in: woIds } },
            select: { id: true },
          })
        ).map((r) => r.id);

  const peIds =
    wolIds.length === 0
      ? []
      : (
          await tx.productionEntry.findMany({
            where: { workOrderLineId: { in: wolIds } },
            select: { id: true },
          })
        ).map((r) => r.id);

  const qcIds =
    peIds.length === 0
      ? []
      : (
          await tx.qcEntry.findMany({
            where: { productionId: { in: peIds } },
            select: { id: true },
          })
        ).map((r) => r.id);

  const qcRevIds =
    qcIds.length === 0
      ? []
      : (
          await tx.qcReversal.findMany({
            where: { qcEntryId: { in: qcIds } },
            select: { id: true },
          })
        ).map((r) => r.id);

  const dispatchIds = (
    await tx.dispatch.findMany({
      where: { soId: { in: noQtySoIds } },
      select: { id: true },
    })
  ).map((r) => r.id);

  const customerReturnIds = (
    await tx.customerReturn.findMany({
      where: { salesOrderId: { in: noQtySoIds } },
      select: { id: true },
    })
  ).map((r) => r.id);

  const dispositionIds =
    woIds.length === 0
      ? []
      : (
          await tx.qcRejectedDisposition.findMany({
            where: { workOrderId: { in: woIds } },
            select: { id: true },
          })
        ).map((r) => r.id);

  const saqcRows = await tx.stockAdjustmentQcEntry.findMany({
    where: { salesOrderId: { in: noQtySoIds } },
    select: { stockTransactionId: true },
  });
  const adjustmentTxnIdsFromSaQc = [...new Set(saqcRows.map((r) => r.stockTransactionId))];

  // 1) Break self-references (scoped to NO_QTY dispatch / disposition trees).
  await tx.dispatch.updateMany({
    where: { soId: { in: noQtySoIds } },
    data: { reversalOfId: null },
  });
  if (woIds.length > 0) {
    await tx.qcRejectedDisposition.updateMany({
      where: { workOrderId: { in: woIds } },
      data: { parentDispositionId: null },
    });
  }

  // 2–3 Sales bills (via dispatches for these SOs)
  const salesBillIds =
    dispatchIds.length === 0
      ? []
      : (
          await tx.salesBill.findMany({
            where: { dispatchId: { in: dispatchIds } },
            select: { id: true },
          })
        ).map((r) => r.id);

  if (salesBillIds.length > 0) {
    await addDeleteCount(deletedCounts, "salesBillLine", () =>
      tx.salesBillLine.deleteMany({ where: { salesBillId: { in: salesBillIds } } }),
    );
    await addDeleteCount(deletedCounts, "salesBill", () => tx.salesBill.deleteMany({ where: { id: { in: salesBillIds } } }));
  } else {
    deletedCounts.salesBillLine = 0;
    deletedCounts.salesBill = 0;
  }

  // Replacement SO rows must release FK to CustomerReturn before returns are removed.
  if (customerReturnIds.length > 0) {
    await tx.salesOrder.updateMany({
      where: { customerReturnId: { in: customerReturnIds } },
      data: { customerReturnId: null },
    });
  }

  await addDeleteCount(deletedCounts, "customerReturn", () =>
    tx.customerReturn.deleteMany({ where: { salesOrderId: { in: noQtySoIds } } }),
  );

  await addDeleteCount(deletedCounts, "dispatch", () =>
    tx.dispatch.deleteMany({ where: { soId: { in: noQtySoIds } } }),
  );

  if (await tableExists(tx, ["qclegacyrejectedclassification", "QcLegacyRejectedClassification"])) {
    /** @type {Record<string, unknown>[]} */
    const qcLegacyOr = [];
    if (qcIds.length > 0) qcLegacyOr.push({ sourceQcEntryId: { in: qcIds } });
    if (woIds.length > 0) qcLegacyOr.push({ workOrderId: { in: woIds } });
    if (qcLegacyOr.length > 0) {
      await addDeleteCount(deletedCounts, "qcLegacyRejectedClassification", () =>
        tx.qcLegacyRejectedClassification.deleteMany({ where: { OR: qcLegacyOr } }),
      );
    } else {
      deletedCounts.qcLegacyRejectedClassification = 0;
    }
  } else {
    deletedCounts.qcLegacyRejectedClassification = 0;
  }

  if (dispositionIds.length > 0) {
    await addDeleteCount(deletedCounts, "qcRejectedDisposition", () =>
      tx.qcRejectedDisposition.deleteMany({ where: { id: { in: dispositionIds } } }),
    );
  } else {
    deletedCounts.qcRejectedDisposition = 0;
  }

  if (qcRevIds.length > 0) {
    await addDeleteCount(deletedCounts, "qcReversal", () => tx.qcReversal.deleteMany({ where: { id: { in: qcRevIds } } }));
  } else {
    deletedCounts.qcReversal = 0;
  }

  if (woIds.length > 0) {
    await addDeleteCount(deletedCounts, "scrapRecord", () =>
      tx.scrapRecord.deleteMany({ where: { workOrderId: { in: woIds } } }),
    );
  } else {
    deletedCounts.scrapRecord = 0;
  }

  if (qcIds.length > 0) {
    await addDeleteCount(deletedCounts, "qcEntry", () => tx.qcEntry.deleteMany({ where: { id: { in: qcIds } } }));
  } else {
    deletedCounts.qcEntry = 0;
  }

  if (peIds.length > 0) {
    await addDeleteCount(deletedCounts, "productionEntry", () =>
      tx.productionEntry.deleteMany({ where: { id: { in: peIds } } }),
    );
  } else {
    deletedCounts.productionEntry = 0;
  }

  if (woIds.length > 0) {
    await addDeleteCount(deletedCounts, "workOrderLine", () =>
      tx.workOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } }),
    );
    await addDeleteCount(deletedCounts, "workOrder", () =>
      tx.workOrder.deleteMany({ where: { salesOrderId: { in: noQtySoIds } } }),
    );
  } else {
    deletedCounts.workOrderLine = 0;
    deletedCounts.workOrder = 0;
  }

  const rsIds = (
    await tx.requirementSheet.findMany({
      where: { salesOrderId: { in: noQtySoIds } },
      select: { id: true },
    })
  ).map((r) => r.id);

  if (rsIds.length > 0) {
    await addDeleteCount(deletedCounts, "requirementSheetLine", () =>
      tx.requirementSheetLine.deleteMany({ where: { sheetId: { in: rsIds } } }),
    );
  } else {
    deletedCounts.requirementSheetLine = 0;
  }

  await addDeleteCount(deletedCounts, "requirementSheet", () =>
    tx.requirementSheet.deleteMany({ where: { salesOrderId: { in: noQtySoIds } } }),
  );

  await tx.salesOrder.updateMany({
    where: { id: { in: noQtySoIds } },
    data: { currentCycleId: null },
  });

  await addDeleteCount(deletedCounts, "salesOrderCycle", () =>
    tx.salesOrderCycle.deleteMany({ where: { salesOrderId: { in: noQtySoIds } } }),
  );

  await addDeleteCount(deletedCounts, "salesOrderLine", () =>
    tx.salesOrderLine.deleteMany({ where: { soId: { in: noQtySoIds } } }),
  );

  await addDeleteCount(deletedCounts, "stockAdjustmentQcEntry", () =>
    tx.stockAdjustmentQcEntry.deleteMany({ where: { salesOrderId: { in: noQtySoIds } } }),
  );

  /** @type {Record<string, unknown>[]} */
  const stockOr = [];
  if (dispatchIds.length > 0) {
    stockOr.push({ transactionType: "DISPATCH", refId: { in: dispatchIds } });
    stockOr.push({ transactionType: "DISPATCH_REVERSAL", refId: { in: dispatchIds } });
  }
  if (peIds.length > 0) {
    stockOr.push({ transactionType: "ISSUE", refId: { in: peIds } });
    stockOr.push({ transactionType: "PRODUCTION", refId: { in: peIds } });
  }
  if (qcIds.length > 0) {
    stockOr.push({ transactionType: "QC", refId: { in: qcIds } });
  }
  if (qcRevIds.length > 0) {
    stockOr.push({ transactionType: "QC_REVERSAL", refId: { in: qcRevIds } });
  }
  if (customerReturnIds.length > 0) {
    stockOr.push({ transactionType: "CUSTOMER_RETURN", refId: { in: customerReturnIds } });
    stockOr.push({ transactionType: "SCRAP", refId: { in: customerReturnIds } });
  }
  if (dispositionIds.length > 0) {
    stockOr.push({ qcRejectedDispositionId: { in: dispositionIds } });
    stockOr.push({ transactionType: "BUCKET_TRANSFER", refId: { in: dispositionIds } });
  }
  if (adjustmentTxnIdsFromSaQc.length > 0) {
    stockOr.push({ transactionType: "ADJUSTMENT", id: { in: adjustmentTxnIdsFromSaQc } });
  }

  if (stockOr.length > 0) {
    const stockWhere = { OR: stockOr };
    const stockTxnIds = (
      await tx.stockTransaction.findMany({
        where: stockWhere,
        select: { id: true },
      })
    ).map((r) => r.id);
    if (stockTxnIds.length > 0) {
      await tx.stockTransaction.updateMany({
        where: { reversalOfId: { in: stockTxnIds } },
        data: { reversalOfId: null },
      });
      await tx.stockTransaction.updateMany({
        where: { id: { in: stockTxnIds } },
        data: { reversalOfId: null },
      });
    }
    await addDeleteCount(deletedCounts, "stockTransaction", () => tx.stockTransaction.deleteMany({ where: stockWhere }));
  } else {
    deletedCounts.stockTransaction = 0;
  }

  await addDeleteCount(deletedCounts, "salesOrder", () =>
    tx.salesOrder.deleteMany({
      where: { id: { in: noQtySoIds }, orderType: "NO_QTY" },
    }),
  );

  return deletedCounts;
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {Record<string, number>} deleted
 */
async function runFullDemoResetDeletes(tx, deleted) {
  /** @type {Array<[string, () => Promise<void>]>} */
  const steps = [
    [
      "stockTransaction:clearReversalRefs",
      async () => {
        await tx.stockTransaction.updateMany({ data: { reversalOfId: null } });
      },
    ],
    [
      "dispatch:clearReversalRefs",
      async () => {
        await tx.dispatch.updateMany({ data: { reversalOfId: null } });
      },
    ],
    ["salesBillLine", async () => addDeleteCount(deleted, "salesBillLine", () => tx.salesBillLine.deleteMany({}))],
    ["salesBill", async () => addDeleteCount(deleted, "salesBill", () => tx.salesBill.deleteMany({}))],
    ["customerReturn", async () => addDeleteCount(deleted, "customerReturn", () => tx.customerReturn.deleteMany({}))],
    [
      "dispatch",
      async () =>
        addDeleteCount(deleted, "dispatch", async () => {
          await tx.dispatch.updateMany({ data: { reversalOfId: null } });
          return tx.dispatch.deleteMany({});
        }),
    ],
    [
      "qcRejectedDisposition:clearParentRefs",
      async () => {
        await tx.qcRejectedDisposition.updateMany({ data: { parentDispositionId: null } });
      },
    ],
    ["qcRejectedDisposition", async () => addDeleteCount(deleted, "qcRejectedDisposition", () => tx.qcRejectedDisposition.deleteMany({}))],
    [
      "qcLegacyRejectedClassification",
      async () =>
        tryOptionalTableDelete(tx, deleted, ["qclegacyrejectedclassification", "QcLegacyRejectedClassification"], "qcLegacyRejectedClassification", () =>
          tx.qcLegacyRejectedClassification.deleteMany({}),
        ),
    ],
    [
      "stockAdjustmentQcEntry",
      async () =>
        tryOptionalTableDelete(tx, deleted, ["stockadjustmentqcentry", "StockAdjustmentQcEntry"], "stockAdjustmentQcEntry", () =>
          tx.stockAdjustmentQcEntry.deleteMany({}),
        ),
    ],
    ["qcEntry", async () => addDeleteCount(deleted, "qcEntry", () => tx.qcEntry.deleteMany({}))],
    ["productionEntry", async () => addDeleteCount(deleted, "productionEntry", () => tx.productionEntry.deleteMany({}))],
    ["scrapRecord", async () => addDeleteCount(deleted, "scrapRecord", () => tx.scrapRecord.deleteMany({}))],
    ["workOrderLine", async () => addDeleteCount(deleted, "workOrderLine", () => tx.workOrderLine.deleteMany({}))],
    ["workOrder", async () => addDeleteCount(deleted, "workOrder", () => tx.workOrder.deleteMany({}))],
    ["requirementSheetLine", async () => addDeleteCount(deleted, "requirementSheetLine", () => tx.requirementSheetLine.deleteMany({}))],
    ["requirementSheet", async () => addDeleteCount(deleted, "requirementSheet", () => tx.requirementSheet.deleteMany({}))],
    [
      "salesOrder:clearCurrentCycle",
      async () => {
        await tx.salesOrder.updateMany({ data: { currentCycleId: null } });
      },
    ],
    ["salesOrderCycle", async () => addDeleteCount(deleted, "salesOrderCycle", () => tx.salesOrderCycle.deleteMany({}))],
    ["salesOrderLine", async () => addDeleteCount(deleted, "salesOrderLine", () => tx.salesOrderLine.deleteMany({}))],
    ["salesOrder", async () => addDeleteCount(deleted, "salesOrder", () => tx.salesOrder.deleteMany({}))],
    ["quotationLine", async () => addDeleteCount(deleted, "quotationLine", () => tx.quotationLine.deleteMany({}))],
    ["quotation", async () => addDeleteCount(deleted, "quotation", () => tx.quotation.deleteMany({}))],
    ["enquiryLine", async () => addDeleteCount(deleted, "enquiryLine", () => tx.enquiryLine.deleteMany({}))],
    ["enquiry", async () => addDeleteCount(deleted, "enquiry", () => tx.enquiry.deleteMany({}))],
    ["purchaseBillLine", async () => addDeleteCount(deleted, "purchaseBillLine", () => tx.purchaseBillLine.deleteMany({}))],
    ["purchaseBill", async () => addDeleteCount(deleted, "purchaseBill", () => tx.purchaseBill.deleteMany({}))],
    ["grnLine", async () => addDeleteCount(deleted, "grnLine", () => tx.grnLine.deleteMany({}))],
    ["grn", async () => addDeleteCount(deleted, "grn", () => tx.grn.deleteMany({}))],
    ["rmPurchaseOrderLine", async () => addDeleteCount(deleted, "rmPurchaseOrderLine", () => tx.rmPurchaseOrderLine.deleteMany({}))],
    ["rmPurchaseOrder", async () => addDeleteCount(deleted, "rmPurchaseOrder", () => tx.rmPurchaseOrder.deleteMany({}))],
    [
      "stockTransaction",
      async () =>
        addDeleteCount(deleted, "stockTransaction", async () => {
          await tx.stockTransaction.updateMany({ data: { reversalOfId: null } });
          return tx.stockTransaction.deleteMany({});
        }),
    ],
    ["idempotencyRecord", async () => addDeleteCount(deleted, "idempotencyRecord", () => tx.idempotencyRecord.deleteMany({}))],
    ["bomLine", async () => addDeleteCount(deleted, "bomLine", () => tx.bomLine.deleteMany({}))],
    ["bom", async () => addDeleteCount(deleted, "bom", () => tx.bom.deleteMany({}))],
    ["openingStockEntry", async () => addDeleteCount(deleted, "openingStockEntry", () => tx.openingStockEntry.deleteMany({}))],
    ["customerPOLine", async () => addDeleteCount(deleted, "customerPOLine", () => tx.customerPOLine.deleteMany({}))],
    ["customerPO", async () => addDeleteCount(deleted, "customerPO", () => tx.customerPO.deleteMany({}))],
    [
      "rateContractLine",
      async () =>
        tryOptionalTableDelete(tx, deleted, ["ratecontractline", "RateContractLine"], "rateContractLine", () =>
          tx.rateContractLine.deleteMany({}),
        ),
    ],
    ["item", async () => addDeleteCount(deleted, "item", () => tx.item.deleteMany({}))],
    ["supplier", async () => addDeleteCount(deleted, "supplier", () => tx.supplier.deleteMany({}))],
    ["customer", async () => addDeleteCount(deleted, "customer", () => tx.customer.deleteMany({}))],
    ["unit", async () => addDeleteCount(deleted, "unit", () => tx.unit.deleteMany({}))],
  ];

  for (const [label, fn] of steps) {
    try {
      await fn();
    } catch (err) {
      const msg = formatCleanupDeleteError(label, err);
      throw new CleanupStepError({ step: label, error: msg });
    }
  }

  if (await tableExists(tx, ["docsequence", "DocSequence"])) {
    await addDeleteCount(deleted, "docSequence", () => tx.docSequence.deleteMany({}));
  } else {
    deleted.docSequence = 0;
  }
}

/**
 * Admin-only destructive endpoint to clear transactional rows for process testing.
 * Master data (users/roles/items/customers/suppliers/units/settings/etc.) is preserved.
 */
adminDatabaseCleanupRouter.post(
  "/database-cleanup/reset-transaction-data",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can reset transaction data."),
  async (req, res, next) => {
    try {
      const body = resetSchema.parse(req.body ?? {});
      if ((body.confirmText ?? "").trim().toUpperCase() !== "RESET") {
        return res.status(400).json({ error: { message: "Confirmation text must be RESET. No changes were made." } });
      }

      try {
        const results = await prisma.$transaction(
          async (tx) => {
            /** @type {{ table: string; deleted: number }[]} */
            const summary = [];

            // Delete transactional data in FK-safe order (do not add masters here).
            const steps = [
              ["salesBillLine", () => tx.salesBillLine.deleteMany({})],
              ["salesBill", () => tx.salesBill.deleteMany({})],
              [
                "dispatch",
                async () => {
                  // Dispatch has a self-referencing FK (reversalOfId). Break it before deleteMany().
                  await tx.dispatch.updateMany({ data: { reversalOfId: null } });
                  return await tx.dispatch.deleteMany({});
                },
              ],
              ["customerReturn", () => tx.customerReturn.deleteMany({})],
              ["qcRejectedDisposition", () => tx.qcRejectedDisposition.deleteMany({})],
            ];

            await runDeleteSteps(tx, summary, steps);

            // Optional table: older DBs may not have this migration applied.
            if (await tableExists(tx, ["qclegacyrejectedclassification", "QcLegacyRejectedClassification"])) {
              await runDeleteSteps(tx, summary, [
                ["qcLegacyRejectedClassification", () => tx.qcLegacyRejectedClassification.deleteMany({})],
              ]);
            } else {
              summary.push({ table: "qcLegacyRejectedClassification", deleted: 0 });
            }

            await runDeleteSteps(tx, summary, [
              ["qcEntry", () => tx.qcEntry.deleteMany({})],
              ["productionEntry", () => tx.productionEntry.deleteMany({})],
              ["workOrderLine", () => tx.workOrderLine.deleteMany({})],
              ["workOrder", () => tx.workOrder.deleteMany({})],
              ["requirementSheetLine", () => tx.requirementSheetLine.deleteMany({})],
              ["requirementSheet", () => tx.requirementSheet.deleteMany({})],
              ["salesOrderLine", () => tx.salesOrderLine.deleteMany({})],
              ["salesOrder", () => tx.salesOrder.deleteMany({})],
              ["quotationLine", () => tx.quotationLine.deleteMany({})],
              ["quotation", () => tx.quotation.deleteMany({})],
              ["enquiry", () => tx.enquiry.deleteMany({})],
              ["purchaseBillLine", () => tx.purchaseBillLine.deleteMany({})],
              ["purchaseBill", () => tx.purchaseBill.deleteMany({})],
              ["grnLine", () => tx.grnLine.deleteMany({})],
              ["grn", () => tx.grn.deleteMany({})],
              ["rmPurchaseOrderLine", () => tx.rmPurchaseOrderLine.deleteMany({})],
              ["rmPurchaseOrder", () => tx.rmPurchaseOrder.deleteMany({})],
            ]);

            // Reset DocSequence entries related to transactional doc types (if table exists).
            // Current schema supports: SO, WO, PROD, QC, D, SB, RS.
            if (await tableExists(tx, ["docsequence", "DocSequence"])) {
              const r = await tx.docSequence.deleteMany({
                where: {
                  docType: {
                    in: [
                      "SALES_ORDER",
                      "WORK_ORDER",
                      "PRODUCTION_ENTRY",
                      "QC_ENTRY",
                      "DISPATCH",
                      "SALES_BILL",
                      "REQUIREMENT_SHEET",
                    ],
                  },
                },
              });
              summary.push({ table: "docSequence", deleted: typeof r?.count === "number" ? r.count : 0 });
            } else {
              summary.push({ table: "docSequence", deleted: 0 });
            }

            // IMPORTANT: keep StockTransaction delete as the very last step (highest fan-in for references).
            await runDeleteSteps(tx, summary, [
              [
                "stockTransaction",
                async () => {
                  // StockTransaction has a self-referencing FK (reversalOfId). Break it before deleteMany().
                  await tx.stockTransaction.updateMany({ data: { reversalOfId: null } });
                  return await tx.stockTransaction.deleteMany({});
                },
              ],
            ]);

            return summary;
          },
          { timeout: 120_000 },
        );

        return res.json({ ok: true, summary: results });
      } catch (e) {
        if (e instanceof CleanupStepError) {
          return res.status(500).json({ message: "Database cleanup failed", step: e.step, error: e.error });
        }
        throw e;
      }
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * Admin-only: remove transactional rows for NO_QTY sales orders only (masters preserved).
 * POST body must include `{ "confirmText": "RESET" }`.
 */
adminDatabaseCleanupRouter.post(
  "/reset-noqty-data",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can reset NO_QTY transactional data."),
  async (req, res, next) => {
    try {
      const body = noQtyResetSchema.parse(req.body ?? {});
      if ((body.confirmText ?? "").trim().toUpperCase() !== "RESET") {
        return res.status(400).json({ error: { message: "Confirmation text must be RESET. No changes were made." } });
      }

      try {
        const deletedCounts = await prisma.$transaction(async (tx) => runResetNoQtyTransactionalDeletes(tx), {
          timeout: 300_000,
        });
        return res.json({ success: true, deletedCounts });
      } catch (e) {
        if (e instanceof CleanupStepError) {
          return res.status(500).json({ message: "NO_QTY reset failed", step: e.step, error: e.error });
        }
        throw e;
      }
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * Admin-only **full wipe**: transactions + masters (items/customers/suppliers/units/BOM/opening stock/customer PO, etc.).
 * Preserves users/auth rows and app settings (AppSetting, State, Tally-related settings); does not delete AuditLog/ActivityLog.
 */
adminDatabaseCleanupRouter.post(
  "/database-cleanup/full-demo-reset",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can run full demo reset."),
  async (req, res, next) => {
    try {
      const body = fullDemoResetSchema.parse(req.body ?? {});
      if ((body.confirmText ?? "").trim().toUpperCase() !== "FULL RESET") {
        return res.status(400).json({ error: { message: 'Confirmation text must be FULL RESET. No changes were made.' } });
      }

      try {
        /** @type {Record<string, number>} */
        const deleted = {};

        await prisma.$transaction(
          async (tx) => {
            await runFullDemoResetDeletes(tx, deleted);
          },
          { timeout: 300_000 },
        );

        return res.json({
          success: true,
          message: "Full demo reset completed",
          deleted,
        });
      } catch (e) {
        if (e instanceof CleanupStepError) {
          return res.status(500).json({ message: "Full demo reset failed", step: e.step, error: e.error });
        }
        throw e;
      }
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { adminDatabaseCleanupRouter };

