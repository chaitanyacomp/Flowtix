/**
 * Shared checks so upstream documents are not mutated when downstream reality would break.
 */

const { STOCK_EPS } = require("./stockService");

/**
 * Draft SO qty floor: count WO line qty on all non-rejected statuses that still represent a line-level commitment.
 * (WO “remaining headroom” for *new* planning uses only PENDING+IN_PROGRESS — see workOrderSoValidation.)
 * @type {import("@prisma/client").SimpleStatus[]}
 */
const WORK_ORDER_STATUSES_FOR_DRAFT_FLOOR_PLANNED = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "HOLD",
];

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} salesOrderId
 * @param {number} fgItemId
 */
async function netDispatchedForSoItem(tx, salesOrderId, fgItemId) {
  const rows = await tx.dispatch.findMany({
    where: { soId: salesOrderId, itemId: fgItemId },
    select: { dispatchedQty: true },
  });
  return rows.reduce((s, d) => s + Number(d.dispatchedQty), 0);
}

/**
 * Net dispatched for QC/stock consumption rules: LOCKED rows only (forward confirms + reversal rows).
 * UNLOCKED draft forwards do not reduce QC-approved availability until locked.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function netLockedDispatchedForSoItem(tx, salesOrderId, fgItemId) {
  const rows = await tx.dispatch.findMany({
    where: { soId: salesOrderId, itemId: fgItemId, workflowStatus: "LOCKED" },
    select: { dispatchedQty: true },
  });
  return rows.reduce((s, d) => s + Number(d.dispatchedQty), 0);
}

/**
 * Total planned WO quantity (SO-required `qty`) for this FG on this sales order.
 * Planned qty on work orders for draft SO line floors (includes COMPLETED lines).
 * For **new** WO planning caps against remaining SO+FG qty, see `workOrderSoValidation.js`
 * (PENDING + IN_PROGRESS only; COMPLETED does not reduce that headroom).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function totalWoPlannedQtyForSoItem(tx, salesOrderId, fgItemId) {
  const agg = await tx.workOrderLine.aggregate({
    where: {
      fgItemId,
      workOrder: {
        salesOrderId,
        status: { in: WORK_ORDER_STATUSES_FOR_DRAFT_FLOOR_PLANNED },
      },
    },
    _sum: { qty: true },
  });
  return Number(agg._sum.qty ?? 0);
}

/**
 * Total production recorded for this FG on this sales order (all WO lines on SO).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function totalProducedQtyForSoItem(tx, salesOrderId, fgItemId) {
  const agg = await tx.productionEntry.aggregate({
    where: {
      workOrderLine: {
        fgItemId,
        workOrder: { salesOrderId },
      },
    },
    _sum: { producedQty: true },
  });
  return Number(agg._sum.producedQty ?? 0);
}

/**
 * Any work order line on this SO for this FG (blocks removing SO line).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function workOrderLineExistsForSoItem(tx, salesOrderId, fgItemId) {
  const n = await tx.workOrderLine.count({
    where: { fgItemId, workOrder: { salesOrderId } },
  });
  return n > 0;
}

/**
 * Scrap records tied to this work order (non-voided or any — keep WO if any audit row exists).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function scrapRecordCountForWorkOrder(tx, workOrderId) {
  return tx.scrapRecord.count({ where: { workOrderId } });
}

/**
 * Production and QC are tied to WorkOrderLine → ProductionEntry; scrap/loss rows tie to the WorkOrder.
 * Use DB counts (not relation includes) so checks stay consistent under concurrency.
 *
 * @returns {Promise<{ salesOrderId: number }>}
 */
async function assertWorkOrderAllowsStructuralEdit(tx, workOrderId) {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, salesOrderId: true, status: true },
  });
  if (!wo || wo.salesOrderId == null) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (wo.status === "REJECTED") {
    const err = new Error(
      "This work order is marked rejected and cannot be edited or deleted. It is kept for audit and traceability.",
    );
    err.statusCode = 400;
    throw err;
  }
  const peCount = await tx.productionEntry.count({
    where: { workOrderLine: { workOrderId }, workflowStatus: "APPROVED" },
  });
  if (peCount > 0) {
    const err = new Error(
      "This work order cannot be structurally changed because approved production has been recorded. Delete or adjust draft batches only on the Production page, or use QC reversal where applicable.",
    );
    err.statusCode = 400;
    throw err;
  }
  const scrapN = await scrapRecordCountForWorkOrder(tx, workOrderId);
  if (scrapN > 0) {
    const err = new Error(
      "This work order cannot be changed while scrap or loss records exist. Keep it for audit, or reverse related QC where applicable.",
    );
    err.statusCode = 400;
    throw err;
  }
  return { salesOrderId: wo.salesOrderId };
}

module.exports = {
  STOCK_EPS,
  netDispatchedForSoItem,
  netLockedDispatchedForSoItem,
  totalWoPlannedQtyForSoItem,
  totalProducedQtyForSoItem,
  workOrderLineExistsForSoItem,
  scrapRecordCountForWorkOrder,
  assertWorkOrderAllowsStructuralEdit,
};
