const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const adminDatabaseCleanupRouter = express.Router();

const resetSchema = z.object({
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

async function runDeleteSteps(tx, summary, steps) {
  for (const [name, fn] of steps) {
    try {
      summary.push(await deleteManySafe(tx, name, fn));
    } catch (err) {
      const msg = err && typeof err === "object" && "message" in err ? String(err.message) : "Delete failed";
      throw new CleanupStepError({ step: name, error: msg });
    }
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

module.exports = { adminDatabaseCleanupRouter };

