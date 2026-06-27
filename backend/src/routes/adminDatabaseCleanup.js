const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { DocType } = require("../prismaClientPackage");
const {
  MPRS_RESET_CONFIRM_TEXT,
  MprsResetStepError,
  runMprsTestReset,
} = require("../services/mprsTestResetService");

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

const mprsResetSchema = z.object({
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

function logCleanup(message, payload) {
  // eslint-disable-next-line no-console
  console.log(`[database-cleanup] ${message}`, payload ?? "");
}

async function countRowsSafe(label, counter) {
  try {
    return await counter();
  } catch (err) {
    logCleanup("remaining-count-failed", { table: label, error: err?.message || String(err) });
    throw err;
  }
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

function getCleanupFkFailureTable(err) {
  if (!err || typeof err !== "object" || err === null) return null;
  const code = "code" in err ? String(/** @type {{ code?: unknown }} */ (err).code) : "";
  if (code !== "P2003") return null;
  const rawMeta = "meta" in err ? /** @type {{ meta?: unknown }} */ (err).meta : undefined;
  const meta = rawMeta && typeof rawMeta === "object" && rawMeta !== null ? /** @type {Record<string, unknown>} */ (rawMeta) : {};
  const modelName = typeof meta.model_name === "string" ? meta.model_name : null;
  const fieldName = typeof meta.field_name === "string" ? meta.field_name : null;
  return [modelName, fieldName].filter(Boolean).join(".");
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
 * @param {{ table: string; deleted: number; remaining: number }[]} summary
 * @param {{ table: string; delete: () => Promise<{ count?: number }>; count: () => Promise<number> }} step
 */
async function runLoggedCleanupStep(summary, step) {
  try {
    const res = await step.delete();
    const deleted = typeof res?.count === "number" ? res.count : 0;
    const remaining = await countRowsSafe(step.table, step.count);
    logCleanup("delete", { table: step.table, deleted, remaining });
    summary.push({ table: step.table, deleted, remaining });
    if (remaining > 0) {
      throw new CleanupStepError({
        step: step.table,
        error: `Delete step finished but ${remaining} row(s) still remain in ${step.table}. A later pass should not be required.`,
      });
    }
  } catch (err) {
    const fkFailureTable = getCleanupFkFailureTable(err);
    logCleanup("delete-failed", {
      table: step.table,
      fkFailureTable,
      error: formatCleanupDeleteError(step.table, err),
    });
    throw new CleanupStepError({ step: step.table, error: formatCleanupDeleteError(step.table, err) });
  }
}

/**
 * @param {{ table: string; deleted: number; remaining: number }[]} summary
 * @param {{ table: string; candidates: string[] | string; delete: () => Promise<{ count?: number }>; count: () => Promise<number> }} step
 */
async function runOptionalLoggedCleanupStep(tx, summary, step) {
  if (!(await tableExists(tx, step.candidates))) {
    logCleanup("skip-missing-table", { table: step.table });
    summary.push({ table: step.table, deleted: 0, remaining: 0 });
    return;
  }
  await runLoggedCleanupStep(summary, step);
}

async function runLoggedCleanupAction(label, action) {
  try {
    await action();
    logCleanup("action", { step: label });
  } catch (err) {
    const fkFailureTable = getCleanupFkFailureTable(err);
    logCleanup("action-failed", {
      step: label,
      fkFailureTable,
      error: formatCleanupDeleteError(label, err),
    });
    throw new CleanupStepError({ step: label, error: formatCleanupDeleteError(label, err) });
  }
}

/**
 * @param {Array<{ table: string; count: () => Promise<number> }>} checks
 */
async function verifyCleanupComplete(checks) {
  const remaining = [];
  for (const check of checks) {
    const count = await countRowsSafe(check.table, check.count);
    logCleanup("verify", { table: check.table, remaining: count });
    if (count > 0) remaining.push({ table: check.table, count });
  }
  if (remaining.length > 0) {
    logCleanup("verification-failed", { remaining });
    throw new CleanupStepError({
      step: "verification",
      error: `Rows remain after cleanup: ${remaining.map((r) => `${r.table}=${r.count}`).join(", ")}`,
    });
  }
}

/** Doc types cleared on transaction reset (masters such as BOM keep their own sequences). */
const RESET_TRANSACTION_DOC_TYPES = [
  "SALES_ORDER",
  "WORK_ORDER",
  "PRODUCTION_ENTRY",
  "QC_ENTRY",
  "DISPATCH",
  "SALES_BILL",
  "REQUIREMENT_SHEET",
  "PRODUCTION_MATERIAL_REQUEST",
  "MATERIAL_ISSUE_NOTE",
  "MATERIAL_RETURN_NOTE",
  "MATERIAL_WASTAGE_NOTE",
  "MATERIAL_REQUIREMENT",
  "PURCHASE_REQUEST",
];

const VALID_DOC_TYPES = new Set(Object.values(DocType));

function assertResetTransactionDocTypesValid() {
  const invalid = RESET_TRANSACTION_DOC_TYPES.filter((docType) => !VALID_DOC_TYPES.has(docType));
  if (invalid.length > 0) {
    throw new Error(
      `RESET_TRANSACTION_DOC_TYPES contains invalid DocType value(s): ${invalid.join(", ")}. ` +
        `Valid DocType values: ${[...VALID_DOC_TYPES].join(", ")}`,
    );
  }
}

assertResetTransactionDocTypesValid();

/** Shown after successful Reset Transaction Data (opening stock aligned with zero ledger). */
const RESET_TRANSACTION_OPENING_STOCK_MESSAGE =
  "Approved Opening Stock entries were reverted to DRAFT. Re-approve Opening Stock to restore inventory.";

/**
 * Transaction tables that must be empty after a successful reset (final verification + sweep).
 * Masters (Item, Customer, BOM, OpeningStockEntry, Location, etc.) are intentionally excluded.
 */
const RESET_TRANSACTION_VERIFY_TABLES = [
  "salesBillReceipt",
  "salesBillLine",
  "salesBill",
  "customerReturn",
  "dispatch",
  "stockAdjustmentQcEntry",
  "stockTransaction",
  "qcReversal",
  "scrapRecord",
  "qcRejectedDisposition",
  "qcEntry",
  "productionEntryRmConsumption",
  "productionEntry",
  "materialReturnLine",
  "materialReturnNote",
  "materialIssueLine",
  "materialIssueNote",
  "materialWastageNote",
  "productionMaterialRequestLine",
  "productionMaterialRequest",
  "materialAllocation",
  "carryForwardPending",
  "productionShortfallResolution",
  "workOrderProductionExecution",
  "workOrderLine",
  "workOrder",
  "requirementSheetLine",
  "requirementSheet",
  "noQtySoClosedShortageLine",
  "noQtySoCloseSnapshot",
  "salesOrderCycle",
  "regularSoPlanningSnapshotLine",
  "regularSoPlanningSnapshot",
  "salesOrderLine",
  "salesOrder",
  "rmPoLineProcurementLink",
  "purchaseRequestLineSourceLink",
  "materialRequirementLine",
  "materialRequirement",
  "purchaseRequestLine",
  "purchaseRequest",
  "quotationLine",
  "quotation",
  "feasibility",
  "enquiryLine",
  "enquiry",
  "purchaseBillPayment",
  "purchaseBillLine",
  "purchaseBill",
  "grnLine",
  "grn",
  "rmPurchaseOrderLine",
  "rmPurchaseOrder",
  "customerPOLine",
  "customerPO",
];

/**
 * Store procurement planning (MR → PR → RM PO traceability). Must run before rmPurchaseOrderLine
 * because RmPoLineProcurementLink.purchaseRequestLineId and .materialRequirementLineId use Restrict.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
function buildProcurementPlanningCleanupSteps(tx) {
  return [
    {
      table: "rmPoLineProcurementLink",
      delete: () => tx.rmPoLineProcurementLink.deleteMany({}),
      count: () => tx.rmPoLineProcurementLink.count(),
    },
    {
      table: "purchaseRequestLineSourceLink",
      delete: () => tx.purchaseRequestLineSourceLink.deleteMany({}),
      count: () => tx.purchaseRequestLineSourceLink.count(),
    },
    {
      table: "materialRequirementLine",
      delete: () => tx.materialRequirementLine.deleteMany({}),
      count: () => tx.materialRequirementLine.count(),
    },
    {
      table: "materialRequirement",
      delete: () => tx.materialRequirement.deleteMany({}),
      count: () => tx.materialRequirement.count(),
    },
    {
      table: "purchaseRequestLine",
      delete: () => tx.purchaseRequestLine.deleteMany({}),
      count: () => tx.purchaseRequestLine.count(),
    },
    {
      table: "purchaseRequest",
      delete: () => tx.purchaseRequest.deleteMany({}),
      count: () => tx.purchaseRequest.count(),
    },
  ];
}

/**
 * FK-safe delete order for Settings → Reset Transaction Data (single transaction).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
function buildResetTransactionDataCleanupSteps(tx) {
  return [
    { table: "salesBillReceipt", delete: () => tx.salesBillReceipt.deleteMany({}), count: () => tx.salesBillReceipt.count() },
    { table: "salesBillLine", delete: () => tx.salesBillLine.deleteMany({}), count: () => tx.salesBillLine.count() },
    { table: "salesBill", delete: () => tx.salesBill.deleteMany({}), count: () => tx.salesBill.count() },
    { table: "customerReturn", delete: () => tx.customerReturn.deleteMany({}), count: () => tx.customerReturn.count() },
    { table: "STORE", delete: () => tx.dispatch.deleteMany({}), count: () => tx.dispatch.count() },
    {
      table: "stockAdjustmentQcEntry",
      delete: () => tx.stockAdjustmentQcEntry.deleteMany({}),
      count: () => tx.stockAdjustmentQcEntry.count(),
    },
    { table: "stockTransaction", delete: () => tx.stockTransaction.deleteMany({}), count: () => tx.stockTransaction.count() },
    {
      table: "openingStockEntry:revertApproved",
      delete: () => revertApprovedOpeningStockAfterLedgerWipe(tx),
      count: () => tx.openingStockEntry.count({ where: { status: "APPROVED" } }),
    },
    { table: "qcReversal", delete: () => tx.qcReversal.deleteMany({}), count: () => tx.qcReversal.count() },
    { table: "scrapRecord", delete: () => tx.scrapRecord.deleteMany({}), count: () => tx.scrapRecord.count() },
    {
      table: "qcRejectedDisposition",
      delete: () => tx.qcRejectedDisposition.deleteMany({}),
      count: () => tx.qcRejectedDisposition.count(),
    },
    { table: "qcEntry", delete: () => tx.qcEntry.deleteMany({}), count: () => tx.qcEntry.count() },
    {
      table: "productionEntryRmConsumption",
      delete: () => tx.productionEntryRmConsumption.deleteMany({}),
      count: () => tx.productionEntryRmConsumption.count(),
    },
    { table: "productionEntry", delete: () => tx.productionEntry.deleteMany({}), count: () => tx.productionEntry.count() },
    ...buildProductionRmFlowCleanupSteps(tx),
    ...buildProductionExecutionCleanupSteps(tx),
    { table: "workOrderLine", delete: () => tx.workOrderLine.deleteMany({}), count: () => tx.workOrderLine.count() },
    { table: "workOrder", delete: () => tx.workOrder.deleteMany({}), count: () => tx.workOrder.count() },
    {
      table: "requirementSheetLine",
      delete: () => tx.requirementSheetLine.deleteMany({}),
      count: () => tx.requirementSheetLine.count(),
    },
    { table: "requirementSheet", delete: () => tx.requirementSheet.deleteMany({}), count: () => tx.requirementSheet.count() },
    {
      table: "noQtySoClosedShortageLine",
      delete: () => tx.noQtySoClosedShortageLine.deleteMany({}),
      count: () => tx.noQtySoClosedShortageLine.count(),
    },
    {
      table: "noQtySoCloseSnapshot",
      delete: () => tx.noQtySoCloseSnapshot.deleteMany({}),
      count: () => tx.noQtySoCloseSnapshot.count(),
    },
    {
      table: "salesOrderCycle",
      delete: async () => {
        await tx.salesOrder.updateMany({ data: { currentCycleId: null } });
        return tx.salesOrderCycle.deleteMany({});
      },
      count: () => tx.salesOrderCycle.count(),
    },
    {
      table: "regularSoPlanningSnapshotLine",
      delete: () => tx.regularSoPlanningSnapshotLine.deleteMany({}),
      count: () => tx.regularSoPlanningSnapshotLine.count(),
    },
    {
      table: "regularSoPlanningSnapshot",
      delete: () => tx.regularSoPlanningSnapshot.deleteMany({}),
      count: () => tx.regularSoPlanningSnapshot.count(),
    },
    { table: "salesOrderLine", delete: () => tx.salesOrderLine.deleteMany({}), count: () => tx.salesOrderLine.count() },
    { table: "salesOrder", delete: () => tx.salesOrder.deleteMany({}), count: () => tx.salesOrder.count() },
    { table: "quotationLine", delete: () => tx.quotationLine.deleteMany({}), count: () => tx.quotationLine.count() },
    { table: "quotation", delete: () => tx.quotation.deleteMany({}), count: () => tx.quotation.count() },
    { table: "feasibility", delete: () => tx.feasibility.deleteMany({}), count: () => tx.feasibility.count() },
    { table: "enquiryLine", delete: () => tx.enquiryLine.deleteMany({}), count: () => tx.enquiryLine.count() },
    { table: "enquiry", delete: () => tx.enquiry.deleteMany({}), count: () => tx.enquiry.count() },
    {
      table: "purchaseBillPayment",
      delete: () => tx.purchaseBillPayment.deleteMany({}),
      count: () => tx.purchaseBillPayment.count(),
    },
    { table: "purchaseBillLine", delete: () => tx.purchaseBillLine.deleteMany({}), count: () => tx.purchaseBillLine.count() },
    { table: "purchaseBill", delete: () => tx.purchaseBill.deleteMany({}), count: () => tx.purchaseBill.count() },
    { table: "grnLine", delete: () => tx.grnLine.deleteMany({}), count: () => tx.grnLine.count() },
    { table: "grn", delete: () => tx.grn.deleteMany({}), count: () => tx.grn.count() },
    ...buildProcurementPlanningCleanupSteps(tx),
    { table: "rmPurchaseOrderLine", delete: () => tx.rmPurchaseOrderLine.deleteMany({}), count: () => tx.rmPurchaseOrderLine.count() },
    { table: "rmPurchaseOrder", delete: () => tx.rmPurchaseOrder.deleteMany({}), count: () => tx.rmPurchaseOrder.count() },
    { table: "customerPOLine", delete: () => tx.customerPOLine.deleteMany({}), count: () => tx.customerPOLine.count() },
    { table: "customerPO", delete: () => tx.customerPO.deleteMany({}), count: () => tx.customerPO.count() },
  ];
}

/**
 * Second pass in the same transaction: re-delete anything still present if FK order left orphans.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
async function runFinalTransactionResetSweep(tx) {
  await tx.stockTransaction.updateMany({ data: { reversalOfId: null } });
  await tx.dispatch.updateMany({ data: { reversalOfId: null } });
  await tx.qcRejectedDisposition.updateMany({ data: { parentDispositionId: null } });
  await tx.salesOrder.updateMany({ where: { customerReturnId: { not: null } }, data: { customerReturnId: null } });

  if (await tableExists(tx, ["qclegacyrejectedclassification", "QcLegacyRejectedClassification"])) {
    await tx.qcLegacyRejectedClassification.deleteMany({});
  }
  for (const step of buildResetTransactionDataCleanupSteps(tx)) {
    await step.delete();
  }
}

/**
 * After the stock ledger is wiped, demote approved opening stock so masters match zero inventory.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
async function revertApprovedOpeningStockAfterLedgerWipe(tx) {
  return tx.openingStockEntry.updateMany({
    where: { status: "APPROVED" },
    data: {
      status: "DRAFT",
      approvedAt: null,
      approvedByUserId: null,
    },
  });
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
async function verifyTransactionResetComplete(tx) {
  /** @type {Array<{ table: string; count: () => Promise<number> }>} */
  const checks = [];
  for (const table of RESET_TRANSACTION_VERIFY_TABLES) {
    if (table === "materialWastageNote") {
      if (!(await tableExists(tx, ["materialwastagenote", "MaterialWastageNote"]))) continue;
    }
    if (table === "dispatch") {
      checks.push({ table: "dispatch", count: () => tx.dispatch.count() });
    } else {
      checks.push({ table, count: () => tx[table].count() });
    }
  }

  if (await tableExists(tx, ["qclegacyrejectedclassification", "QcLegacyRejectedClassification"])) {
    checks.push({
      table: "qcLegacyRejectedClassification",
      count: () => tx.qcLegacyRejectedClassification.count(),
    });
  }
  if (await tableExists(tx, ["docsequence", "DocSequence"])) {
    checks.push({
      table: "docSequence(transactional)",
      count: () => tx.docSequence.count({ where: { docType: { in: RESET_TRANSACTION_DOC_TYPES } } }),
    });
  }
  if (await tableExists(tx, ["openingstockentry", "OpeningStockEntry"])) {
    checks.push({
      table: "openingStockEntry(APPROVED)",
      count: () => tx.openingStockEntry.count({ where: { status: "APPROVED" } }),
    });
  }

  await verifyCleanupComplete(checks);
}

/**
 * Phase 3 RM issuance/return/wastage (PMR → MIN → MRN → MWN).
 * Must run after stockTransaction is cleared and before workOrder:
 * - ProductionMaterialRequest.workOrderId → WorkOrder (onDelete: Restrict) blocks workOrder.deleteMany.
 * - MaterialWastageNote.workOrderId → WorkOrder (onDelete: Restrict) blocks workOrder.deleteMany.
 * - MaterialIssueNote / MaterialReturnNote use SetNull on WO/PMR; lines cascade from parent notes.
 * - LOCATION_TRANSFER stock rows reference MIN/MRN ids via refId (no DB FK); wiped with stockTransaction.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @returns {Array<{ table: string; delete: () => Promise<{ count?: number }>; count: () => Promise<number> }>}
 */
function buildProductionRmFlowCleanupSteps(tx) {
  return [
    { table: "materialIssueLine", delete: () => tx.materialIssueLine.deleteMany({}), count: () => tx.materialIssueLine.count() },
    { table: "materialIssueNote", delete: () => tx.materialIssueNote.deleteMany({}), count: () => tx.materialIssueNote.count() },
    { table: "materialReturnLine", delete: () => tx.materialReturnLine.deleteMany({}), count: () => tx.materialReturnLine.count() },
    { table: "materialReturnNote", delete: () => tx.materialReturnNote.deleteMany({}), count: () => tx.materialReturnNote.count() },
    {
      table: "materialWastageNote",
      delete: () => tx.materialWastageNote.deleteMany({}),
      count: () => tx.materialWastageNote.count(),
    },
    {
      table: "productionMaterialRequestLine",
      delete: () => tx.productionMaterialRequestLine.deleteMany({}),
      count: () => tx.productionMaterialRequestLine.count(),
    },
    {
      table: "productionMaterialRequest",
      delete: () => tx.productionMaterialRequest.deleteMany({}),
      count: () => tx.productionMaterialRequest.count(),
    },
    {
      table: "materialAllocation",
      delete: () => tx.materialAllocation.deleteMany({}),
      count: () => tx.materialAllocation.count(),
    },
  ];
}

/**
 * P16 Production Execution shortfall tables.
 * CarryForwardPending.sourceWorkOrderId → WorkOrder (Restrict) must be cleared before workOrder.deleteMany.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @returns {Array<{ table: string; delete: () => Promise<{ count?: number }>; count: () => Promise<number> }>}
 */
function buildProductionExecutionCleanupSteps(tx) {
  return [
    {
      table: "carryForwardPending",
      delete: () => tx.carryForwardPending.deleteMany({}),
      count: () => tx.carryForwardPending.count(),
    },
    {
      table: "productionShortfallResolution",
      delete: () => tx.productionShortfallResolution.deleteMany({}),
      count: () => tx.productionShortfallResolution.count(),
    },
    {
      table: "workOrderProductionExecution",
      delete: () => tx.workOrderProductionExecution.deleteMany({}),
      count: () => tx.workOrderProductionExecution.count(),
    },
  ];
}

/**
 * Scoped P16 deletes for NO_QTY reset (same order as buildProductionExecutionCleanupSteps).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {Record<string, number>} deletedCounts
 * @param {{ salesOrderIds: number[]; workOrderIds: number[] }} scope
 */
async function deleteProductionExecutionForScope(tx, deletedCounts, { salesOrderIds, workOrderIds }) {
  const soIds = (salesOrderIds || []).filter((id) => Number.isFinite(id) && id > 0);
  const woIds = (workOrderIds || []).filter((id) => Number.isFinite(id) && id > 0);

  if (!(await tableExists(tx, ["carryforwardpending", "CarryForwardPending"]))) {
    deletedCounts.carryForwardPending = 0;
    deletedCounts.productionShortfallResolution = 0;
    deletedCounts.workOrderProductionExecution = 0;
    return;
  }

  if (soIds.length > 0) {
    await addDeleteCountStep(deletedCounts, "carryForwardPending", () =>
      tx.carryForwardPending.deleteMany({ where: { salesOrderId: { in: soIds } } }),
    );
  } else {
    deletedCounts.carryForwardPending = 0;
  }

  if (!(await tableExists(tx, ["productionshortfallresolution", "ProductionShortfallResolution"]))) {
    deletedCounts.productionShortfallResolution = 0;
  } else if (woIds.length > 0) {
    await addDeleteCountStep(deletedCounts, "productionShortfallResolution", () =>
      tx.productionShortfallResolution.deleteMany({ where: { workOrderId: { in: woIds } } }),
    );
  } else {
    deletedCounts.productionShortfallResolution = 0;
  }

  if (!(await tableExists(tx, ["workorderproductionexecution", "WorkOrderProductionExecution"]))) {
    deletedCounts.workOrderProductionExecution = 0;
  } else if (woIds.length > 0) {
    await addDeleteCountStep(deletedCounts, "workOrderProductionExecution", () =>
      tx.workOrderProductionExecution.deleteMany({ where: { workOrderId: { in: woIds } } }),
    );
  } else {
    deletedCounts.workOrderProductionExecution = 0;
  }
}

/**
 * Scoped PMR/MIN/MRN deletes for NO_QTY reset (same FK order as buildProductionRmFlowCleanupSteps).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {Record<string, number>} deletedCounts
 * @param {{ workOrderIds: number[] }} scope
 */
async function deleteProductionRmFlowForWorkOrders(tx, deletedCounts, { workOrderIds }) {
  if (workOrderIds.length === 0) {
    deletedCounts.materialIssueLine = 0;
    deletedCounts.materialIssueNote = 0;
    deletedCounts.materialReturnLine = 0;
    deletedCounts.materialReturnNote = 0;
    deletedCounts.materialWastageNote = 0;
    deletedCounts.productionMaterialRequestLine = 0;
    deletedCounts.productionMaterialRequest = 0;
    deletedCounts.materialAllocation = 0;
    return;
  }

  const pmrIds = (
    await tx.productionMaterialRequest.findMany({
      where: { workOrderId: { in: workOrderIds } },
      select: { id: true },
    })
  ).map((r) => r.id);

  /** @type {Record<string, unknown>[]} */
  const noteOr = [{ workOrderId: { in: workOrderIds } }];
  if (pmrIds.length > 0) {
    noteOr.push({ productionMaterialRequestId: { in: pmrIds } });
  }
  const noteWhere = { OR: noteOr };

  await addDeleteCountStep(deletedCounts, "materialIssueLine", () =>
    tx.materialIssueLine.deleteMany({ where: { materialIssueNote: noteWhere } }),
  );
  await addDeleteCountStep(deletedCounts, "materialIssueNote", () => tx.materialIssueNote.deleteMany({ where: noteWhere }));
  await addDeleteCountStep(deletedCounts, "materialReturnLine", () =>
    tx.materialReturnLine.deleteMany({ where: { materialReturnNote: noteWhere } }),
  );
  await addDeleteCountStep(deletedCounts, "materialReturnNote", () => tx.materialReturnNote.deleteMany({ where: noteWhere }));

  if (await tableExists(tx, ["materialwastagenote", "MaterialWastageNote"])) {
    await addDeleteCountStep(deletedCounts, "materialWastageNote", () =>
      tx.materialWastageNote.deleteMany({ where: { workOrderId: { in: workOrderIds } } }),
    );
  } else {
    deletedCounts.materialWastageNote = 0;
  }

  if (pmrIds.length > 0) {
    await addDeleteCountStep(deletedCounts, "productionMaterialRequestLine", () =>
      tx.productionMaterialRequestLine.deleteMany({ where: { productionMaterialRequestId: { in: pmrIds } } }),
    );
    await addDeleteCountStep(deletedCounts, "productionMaterialRequest", () =>
      tx.productionMaterialRequest.deleteMany({ where: { id: { in: pmrIds } } }),
    );
  } else {
    deletedCounts.productionMaterialRequestLine = 0;
    deletedCounts.productionMaterialRequest = 0;
  }

  const allocationWhere = {
    OR: [
      { workOrderId: { in: workOrderIds } },
      { workOrderLine: { workOrderId: { in: workOrderIds } } },
      ...(pmrIds.length > 0 ? [{ productionMaterialRequestId: { in: pmrIds } }] : []),
    ],
  };
  await addDeleteCountStep(deletedCounts, "materialAllocation", () =>
    tx.materialAllocation.deleteMany({ where: allocationWhere }),
  );
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

async function addDeleteCountStep(deleted, key, fn) {
  try {
    await addDeleteCount(deleted, key, fn);
  } catch (err) {
    const fkFailureTable = getCleanupFkFailureTable(err);
    logCleanup("delete-failed", {
      table: key,
      fkFailureTable,
      error: formatCleanupDeleteError(key, err),
    });
    throw new CleanupStepError({ step: key, error: formatCleanupDeleteError(key, err) });
  }
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

  const noQtyMaterialRequirementIds = (
    await tx.materialRequirement.findMany({
      where: {
        OR: [
          { salesOrderId: { in: noQtySoIds } },
          ...(woIds.length > 0 ? [{ workOrderId: { in: woIds } }] : []),
        ],
      },
      select: { id: true },
    })
  ).map((r) => r.id);
  const noQtyMaterialRequirementLineIds =
    noQtyMaterialRequirementIds.length === 0
      ? []
      : (
          await tx.materialRequirementLine.findMany({
            where: { materialRequirementId: { in: noQtyMaterialRequirementIds } },
            select: { id: true },
          })
        ).map((r) => r.id);
  const noQtyPurchaseRequestLineIds =
    noQtyMaterialRequirementLineIds.length === 0
      ? []
      : [
          ...new Set(
            (
              await tx.purchaseRequestLineSourceLink.findMany({
                where: { materialRequirementLineId: { in: noQtyMaterialRequirementLineIds } },
                select: { purchaseRequestLineId: true },
              })
            ).map((r) => r.purchaseRequestLineId),
          ),
        ];

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
    await addDeleteCountStep(deletedCounts, "salesBillReceipt", () =>
      tx.salesBillReceipt.deleteMany({ where: { salesBillId: { in: salesBillIds } } }),
    );
    await addDeleteCount(deletedCounts, "salesBillLine", () =>
      tx.salesBillLine.deleteMany({ where: { salesBillId: { in: salesBillIds } } }),
    );
    await addDeleteCount(deletedCounts, "salesBill", () => tx.salesBill.deleteMany({ where: { id: { in: salesBillIds } } }));
  } else {
    deletedCounts.salesBillReceipt = 0;
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

  await addDeleteCount(deletedCounts, "STORE", () =>
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
    await addDeleteCount(deletedCounts, "productionEntryRmConsumption", () =>
      tx.productionEntryRmConsumption.deleteMany({ where: { productionEntryId: { in: peIds } } }),
    );
    await addDeleteCount(deletedCounts, "productionEntry", () =>
      tx.productionEntry.deleteMany({ where: { id: { in: peIds } } }),
    );
  } else {
    deletedCounts.productionEntryRmConsumption = 0;
    deletedCounts.productionEntry = 0;
  }

  if (noQtyMaterialRequirementLineIds.length > 0) {
    await addDeleteCountStep(deletedCounts, "rmPoLineProcurementLink", () =>
      tx.rmPoLineProcurementLink.deleteMany({
        where: {
          OR: [
            { materialRequirementLineId: { in: noQtyMaterialRequirementLineIds } },
            ...(noQtyPurchaseRequestLineIds.length > 0 ? [{ purchaseRequestLineId: { in: noQtyPurchaseRequestLineIds } }] : []),
          ],
        },
      }),
    );
    await addDeleteCountStep(deletedCounts, "purchaseRequestLineSourceLink", () =>
      tx.purchaseRequestLineSourceLink.deleteMany({
        where: { materialRequirementLineId: { in: noQtyMaterialRequirementLineIds } },
      }),
    );
    if (noQtyPurchaseRequestLineIds.length > 0) {
      await addDeleteCountStep(deletedCounts, "purchaseRequestLine", () =>
        tx.purchaseRequestLine.deleteMany({
          where: {
            id: { in: noQtyPurchaseRequestLineIds },
            sourceLinks: { none: {} },
            poLinks: { none: {} },
          },
        }),
      );
    } else {
      deletedCounts.purchaseRequestLine = 0;
    }
    await addDeleteCountStep(deletedCounts, "materialRequirementLine", () =>
      tx.materialRequirementLine.deleteMany({ where: { id: { in: noQtyMaterialRequirementLineIds } } }),
    );
  } else {
    deletedCounts.rmPoLineProcurementLink = 0;
    deletedCounts.purchaseRequestLineSourceLink = 0;
    deletedCounts.purchaseRequestLine = 0;
    deletedCounts.materialRequirementLine = 0;
  }
  if (noQtyMaterialRequirementIds.length > 0) {
    await addDeleteCountStep(deletedCounts, "materialRequirement", () =>
      tx.materialRequirement.deleteMany({ where: { id: { in: noQtyMaterialRequirementIds } } }),
    );
  } else {
    deletedCounts.materialRequirement = 0;
  }

  await addDeleteCountStep(deletedCounts, "materialAllocation", () =>
    tx.materialAllocation.deleteMany({ where: { salesOrderId: { in: noQtySoIds } } }),
  );

  await deleteProductionExecutionForScope(tx, deletedCounts, {
    salesOrderIds: noQtySoIds,
    workOrderIds: woIds,
  });

  if (woIds.length > 0) {
    await deleteProductionRmFlowForWorkOrders(tx, deletedCounts, { workOrderIds: woIds });
    await addDeleteCount(deletedCounts, "workOrderLine", () =>
      tx.workOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } }),
    );
    await addDeleteCount(deletedCounts, "workOrder", () =>
      tx.workOrder.deleteMany({ where: { salesOrderId: { in: noQtySoIds } } }),
    );
  } else {
    if (deletedCounts.materialAllocation == null) deletedCounts.materialAllocation = 0;
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

  await addDeleteCountStep(deletedCounts, "noQtySoClosedShortageLine", () =>
    tx.noQtySoClosedShortageLine.deleteMany({ where: { salesOrderId: { in: noQtySoIds } } }),
  );
  await addDeleteCountStep(deletedCounts, "noQtySoCloseSnapshot", () =>
    tx.noQtySoCloseSnapshot.deleteMany({ where: { salesOrderId: { in: noQtySoIds } } }),
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
    ["salesBillReceipt", async () => addDeleteCount(deleted, "salesBillReceipt", () => tx.salesBillReceipt.deleteMany({}))],
    ["salesBillLine", async () => addDeleteCount(deleted, "salesBillLine", () => tx.salesBillLine.deleteMany({}))],
    ["salesBill", async () => addDeleteCount(deleted, "salesBill", () => tx.salesBill.deleteMany({}))],
    ["customerReturn", async () => addDeleteCount(deleted, "customerReturn", () => tx.customerReturn.deleteMany({}))],
    [
      "STORE",
      async () =>
        addDeleteCount(deleted, "STORE", async () => {
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
    [
      "productionEntryRmConsumption",
      async () => addDeleteCount(deleted, "productionEntryRmConsumption", () => tx.productionEntryRmConsumption.deleteMany({})),
    ],
    ["productionEntry", async () => addDeleteCount(deleted, "productionEntry", () => tx.productionEntry.deleteMany({}))],
    ["scrapRecord", async () => addDeleteCount(deleted, "scrapRecord", () => tx.scrapRecord.deleteMany({}))],
    ["materialIssueLine", async () => addDeleteCount(deleted, "materialIssueLine", () => tx.materialIssueLine.deleteMany({}))],
    ["materialIssueNote", async () => addDeleteCount(deleted, "materialIssueNote", () => tx.materialIssueNote.deleteMany({}))],
    [
      "materialReturnLine",
      async () => addDeleteCount(deleted, "materialReturnLine", () => tx.materialReturnLine.deleteMany({})),
    ],
    ["materialReturnNote", async () => addDeleteCount(deleted, "materialReturnNote", () => tx.materialReturnNote.deleteMany({}))],
    [
      "materialWastageNote",
      async () =>
        tryOptionalTableDelete(tx, deleted, ["materialwastagenote", "MaterialWastageNote"], "materialWastageNote", () =>
          tx.materialWastageNote.deleteMany({}),
        ),
    ],
    [
      "productionMaterialRequestLine",
      async () =>
        addDeleteCount(deleted, "productionMaterialRequestLine", () => tx.productionMaterialRequestLine.deleteMany({})),
    ],
    [
      "productionMaterialRequest",
      async () => addDeleteCount(deleted, "productionMaterialRequest", () => tx.productionMaterialRequest.deleteMany({})),
    ],
    ["materialAllocation", async () => addDeleteCount(deleted, "materialAllocation", () => tx.materialAllocation.deleteMany({}))],
    [
      "rmPoLineProcurementLink",
      async () => addDeleteCount(deleted, "rmPoLineProcurementLink", () => tx.rmPoLineProcurementLink.deleteMany({})),
    ],
    [
      "purchaseRequestLineSourceLink",
      async () =>
        addDeleteCount(deleted, "purchaseRequestLineSourceLink", () => tx.purchaseRequestLineSourceLink.deleteMany({})),
    ],
    [
      "materialRequirementLine",
      async () => addDeleteCount(deleted, "materialRequirementLine", () => tx.materialRequirementLine.deleteMany({})),
    ],
    [
      "materialRequirement",
      async () => addDeleteCount(deleted, "materialRequirement", () => tx.materialRequirement.deleteMany({})),
    ],
    [
      "purchaseRequestLine",
      async () => addDeleteCount(deleted, "purchaseRequestLine", () => tx.purchaseRequestLine.deleteMany({})),
    ],
    ["purchaseRequest", async () => addDeleteCount(deleted, "purchaseRequest", () => tx.purchaseRequest.deleteMany({}))],
    [
      "carryForwardPending",
      async () =>
        tryOptionalTableDelete(tx, deleted, ["carryforwardpending", "CarryForwardPending"], "carryForwardPending", () =>
          tx.carryForwardPending.deleteMany({}),
        ),
    ],
    [
      "productionShortfallResolution",
      async () =>
        tryOptionalTableDelete(
          tx,
          deleted,
          ["productionshortfallresolution", "ProductionShortfallResolution"],
          "productionShortfallResolution",
          () => tx.productionShortfallResolution.deleteMany({}),
        ),
    ],
    [
      "workOrderProductionExecution",
      async () =>
        tryOptionalTableDelete(
          tx,
          deleted,
          ["workorderproductionexecution", "WorkOrderProductionExecution"],
          "workOrderProductionExecution",
          () => tx.workOrderProductionExecution.deleteMany({}),
        ),
    ],
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
    [
      "regularSoPlanningSnapshotLine",
      async () => addDeleteCount(deleted, "regularSoPlanningSnapshotLine", () => tx.regularSoPlanningSnapshotLine.deleteMany({})),
    ],
    [
      "regularSoPlanningSnapshot",
      async () => addDeleteCount(deleted, "regularSoPlanningSnapshot", () => tx.regularSoPlanningSnapshot.deleteMany({})),
    ],
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
      logCleanup("full-demo-reset-step-failed", {
        step: label,
        fkFailureTable: getCleanupFkFailureTable(err),
        error: msg,
      });
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
            /** @type {{ table: string; deleted: number; remaining: number }[]} */
            const summary = [];

            await runLoggedCleanupAction("stockTransaction:clearReversalRefs", () =>
              tx.stockTransaction.updateMany({ data: { reversalOfId: null } }),
            );
            await runLoggedCleanupAction("dispatch:clearReversalRefs", () => tx.dispatch.updateMany({ data: { reversalOfId: null } }));
            await runLoggedCleanupAction("qcRejectedDisposition:clearParentRefs", () =>
              tx.qcRejectedDisposition.updateMany({ data: { parentDispositionId: null } }),
            );
            await runLoggedCleanupAction("salesOrder:clearCustomerReturnRefs", () =>
              tx.salesOrder.updateMany({ where: { customerReturnId: { not: null } }, data: { customerReturnId: null } }),
            );

            const cleanupSteps = buildResetTransactionDataCleanupSteps(tx);

            let qcLegacyChecked = false;
            for (const step of cleanupSteps) {
              if (step.table === "qcEntry" && !qcLegacyChecked) {
                await runOptionalLoggedCleanupStep(tx, summary, {
                  table: "qcLegacyRejectedClassification",
                  candidates: ["qclegacyrejectedclassification", "QcLegacyRejectedClassification"],
                  delete: () => tx.qcLegacyRejectedClassification.deleteMany({}),
                  count: () => tx.qcLegacyRejectedClassification.count(),
                });
                qcLegacyChecked = true;
              }
              await runLoggedCleanupStep(summary, step);
            }

            await runOptionalLoggedCleanupStep(tx, summary, {
              table: "docSequence",
              candidates: ["docsequence", "DocSequence"],
              delete: () =>
                tx.docSequence.deleteMany({
                  where: { docType: { in: RESET_TRANSACTION_DOC_TYPES } },
                }),
              count: () => tx.docSequence.count({ where: { docType: { in: RESET_TRANSACTION_DOC_TYPES } } }),
            });

            await runLoggedCleanupAction("finalTransactionResetSweep", () => runFinalTransactionResetSweep(tx));
            await verifyTransactionResetComplete(tx);

            return summary;
          },
          { timeout: 120_000 },
        );

        return res.json({
          ok: true,
          summary: results,
          message: RESET_TRANSACTION_OPENING_STOCK_MESSAGE,
          preservedMasterData: [
            "rateContractLine (customer/item billing rates)",
            "customers",
            "items",
            "suppliers",
            "units",
            "BOM",
            "opening stock (draft entries only; approved postings reverted to draft)",
            "users",
            "roles",
            "app settings",
          ],
          note: "Transaction reset does not clear rate contracts or other master data. Use Full Demo Reset to wipe rate contracts, or deactivate future-dated contracts from Rate Contracts.",
        });
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

/**
 * Admin-only: MPRS / Monthly Planning test reset — clears plans, snapshots, RS, and monthly-plan procurement.
 * Does not alter Reset Transaction Data or Full Demo Reset behavior.
 * POST body must include `{ "confirmText": "RESET MPRS" }`.
 */
adminDatabaseCleanupRouter.post(
  "/database-cleanup/reset-mprs-test-data",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can run MPRS test reset."),
  async (req, res, next) => {
    try {
      const body = mprsResetSchema.parse(req.body ?? {});
      if ((body.confirmText ?? "").trim().toUpperCase() !== MPRS_RESET_CONFIRM_TEXT) {
        return res.status(400).json({
          error: { message: `Confirmation text must be ${MPRS_RESET_CONFIRM_TEXT}. No changes were made.` },
        });
      }

      try {
        const result = await prisma.$transaction(async (tx) => runMprsTestReset(tx), { timeout: 120_000 });
        return res.json({
          ok: true,
          message: "MPRS test reset completed.",
          counts: result.counts,
          deleted: result.deleted,
          preservedMasterData: [
            "items",
            "BOM",
            "customers",
            "suppliers",
            "locations",
            "users",
            "roles",
            "app settings",
            "non-monthly-plan material requirements and procurement",
          ],
        });
      } catch (e) {
        if (e instanceof MprsResetStepError) {
          return res.status(500).json({ message: "MPRS test reset failed", step: e.step, error: e.error });
        }
        throw e;
      }
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = {
  adminDatabaseCleanupRouter,
  buildProductionExecutionCleanupSteps,
  buildResetTransactionDataCleanupSteps,
  deleteProductionExecutionForScope,
};
