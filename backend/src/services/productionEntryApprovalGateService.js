/**
 * Batch 2B — Gate G2 orchestrator: Production Entry approval → Production ledger posting.
 *
 * Orchestrator only — business rules live in lifecycle/domain services.
 *
 * ## Authoritative sequence (do not reorder without owner-doc review)
 *
 * 1. **Production entry identity** — entry exists; linked WO line / WO valid
 * 2. **Production entry approvable** — DRAFT only; no QC history; ledger not posted
 * 3. **Gate G1 re-validation** — {@link assertProductionEntryAllowed}
 * 4. **RM consumption resolution** — {@link postProductionEntryLedgerOnApproval}
 * 5. **Production entry status** — workflowStatus → APPROVED
 *
 * WO-level Production Report confirmation is a separate orchestrator (Batch 2B G3).
 */

const { assertProductionEntryAllowed } = require("./productionEntryGateService");
const {
  assertProductionEntryHasNoQcHistory,
  countAllQcEntriesForProduction,
} = require("./productionEntryIntegrity");
const { postProductionEntryLedgerOnApproval } = require("./productionRmConsumptionService");
const {
  ensureProductionExecutionRecord,
  syncShortfallPendingAfterProductionApprove,
} = require("./productionExecutionService");

const PE_DRAFT = "DRAFT";
const PE_APPROVED = "APPROVED";

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} productionEntryId
 */
async function resolveProductionEntryApprovalContext(tx, productionEntryId) {
  const id = Number(productionEntryId);
  const prod = await tx.productionEntry.findUnique({
    where: { id },
    include: {
      workOrderLine: {
        include: {
          workOrder: {
            select: {
              id: true,
              docNo: true,
              sourceType: true,
              salesOrderId: true,
              salesOrder: { select: { orderType: true } },
            },
          },
          fgItem: true,
        },
      },
    },
  });
  if (!prod) {
    const err = new Error("Production entry not found");
    err.statusCode = 404;
    err.code = "PRODUCTION_ENTRY_NOT_FOUND";
    throw err;
  }
  if (!prod.workOrderLine?.workOrder) {
    const err = new Error("Production requires a valid work order line.");
    err.statusCode = 400;
    err.code = "WOL_NOT_FOUND";
    throw err;
  }
  return { prod, wol: prod.workOrderLine, wo: prod.workOrderLine.workOrder };
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} productionEntryId
 */
async function assertProductionEntryApprovable(tx, productionEntryId) {
  const { prod } = await resolveProductionEntryApprovalContext(tx, productionEntryId);
  if (prod.workflowStatus !== PE_DRAFT) {
    const err = new Error("This production batch is already approved.");
    err.statusCode = 409;
    err.code = "PRODUCTION_ENTRY_ALREADY_APPROVED";
    throw err;
  }
  await assertProductionEntryHasNoQcHistory(tx, productionEntryId);
  const qcAny = await countAllQcEntriesForProduction(tx, productionEntryId);
  if (qcAny > 0) {
    const err = new Error("Cannot approve a batch that already has QC history.");
    err.statusCode = 409;
    err.code = "PRODUCTION_ENTRY_QC_HISTORY";
    throw err;
  }
  return prod;
}

/**
 * Approve a production entry and post RM consumption ledger (MFG-07).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{
 *   productionEntryId: number;
 *   consumptionLines?: Array<{ itemId: number; actualQty: number; remarks?: string | null; consumptionType?: string | null }>;
 *   woQtyToleranceMessageBuilder?: (args: object) => string;
 * }} input
 */
async function approveProductionEntryWithLedgerPosting(tx, input) {
  const productionEntryId = Number(input.productionEntryId);
  const prod = await assertProductionEntryApprovable(tx, productionEntryId);
  const wol = prod.workOrderLine;
  const orderType = wol.workOrder?.salesOrder?.orderType;
  const isRegular = orderType != null && orderType !== "NO_QTY";

  await assertProductionEntryAllowed(tx, {
    workOrderLineId: wol.id,
    producedQty: prod.producedQty,
    excludeProductionId: productionEntryId,
    woQtyToleranceMessageBuilder: input.woQtyToleranceMessageBuilder,
  });

  const ledger = await postProductionEntryLedgerOnApproval(tx, {
    productionId: productionEntryId,
    prod,
    isRegular,
    consumptionLines: input.consumptionLines,
  });

  await tx.productionEntry.update({
    where: { id: productionEntryId },
    data: { workflowStatus: PE_APPROVED },
  });

  if (!isRegular) {
    await ensureProductionExecutionRecord(tx, wol.workOrderId);
    await syncShortfallPendingAfterProductionApprove(tx, wol.workOrderId, ledger.producedQtyNum);
  }

  return {
    prod,
    wol,
    wo: wol.workOrder,
    isRegular,
    ...ledger,
  };
}

module.exports = {
  PE_DRAFT,
  PE_APPROVED,
  resolveProductionEntryApprovalContext,
  assertProductionEntryApprovable,
  approveProductionEntryWithLedgerPosting,
};
