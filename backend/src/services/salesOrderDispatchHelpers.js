const DISPATCH_COMPLETE_EPS = 1e-6;
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("./salesOrderDispatchAllocation");
const { lockSalesOrderForUpdate } = require("./dispatchWriteLocks");
const {
  computeSalesOrderDispatchLineStats,
  getSalesOrderDispatchCompletionPercent,
} = require("./reportMetrics");
const { aggregateSoDispatchCommitmentQtyByItemId } = require("./regularSoBufferQty");

/**
 * True when confirmed (LOCKED forward + reversals) net dispatch covers ordered qty per item.
 * Draft UNLOCKED rows are ignored.
 * @param {{ internalStatus?: string; lines: { itemId: number; qty: unknown }[]; dispatch: { itemId: number; dispatchedQty: unknown }[] }} so
 */
function isSalesOrderConfirmedDispatchComplete(so) {
  const lines = so.lines ?? [];
  const dispatch = so.dispatch ?? [];
  const orderedByItem = aggregateSoDispatchCommitmentQtyByItemId(lines, so.orderType);
  const netDisp = netDispatchedByItemId(dispatch, DISPATCH_ALLOC_MODE.CONFIRMED);
  for (const [itemId, ordered] of orderedByItem) {
    const dispatched = netDisp.get(itemId) ?? 0;
    if (dispatched + DISPATCH_COMPLETE_EPS < ordered) return false;
  }
  return true;
}

/**
 * @param {{ lines: { id: number; itemId: number; qty: import("@prisma/client").Decimal | string }[]; dispatch: { itemId: number; dispatchedQty: import("@prisma/client").Decimal | string }[] }} so
 */
function assertCanMarkSalesOrderCompleted(so) {
  if (!isSalesOrderConfirmedDispatchComplete(so)) {
    const err = new Error("Cannot mark as COMPLETED. Dispatch is still pending.");
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Block new drafts, locks, and draft deletes when the SO is completed (read-only).
 * @param {{ internalStatus?: string | null }} so
 */
function assertSalesOrderNotCompletedForDispatch(so) {
  if (so.orderType === "NO_QTY") {
    if (so.internalStatus === "COMPLETED") {
      const err = new Error("This sales order is completed. Dispatch is view-only.");
      err.statusCode = 409;
      throw err;
    }
    if (so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED") {
      const err = new Error("This sales order is closed. Dispatch is view-only.");
      err.statusCode = 409;
      throw err;
    }
    return;
  }
  if (so.internalStatus === "COMPLETED") {
    const err = new Error("This sales order is completed. No further dispatch is allowed.");
    err.statusCode = 409;
    throw err;
  }
}

/**
 * After a dispatch reversal, if the SO was COMPLETED but confirmed dispatch no longer covers ordered qty, reopen to IN_PROCESS.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} soId
 */
async function reopenSalesOrderIfConfirmedDispatchIncomplete(tx, soId) {
  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    include: { lines: true, dispatch: true },
  });
  if (!so || so.internalStatus !== "COMPLETED") return;
  if (!isSalesOrderConfirmedDispatchComplete(so)) {
    await tx.salesOrder.update({
      where: { id: soId },
      data: { internalStatus: "IN_PROCESS" },
    });
  }
}

/**
 * COMPLETED transitions: lock the sales order (same lock dispatch writers take), re-read lines + dispatch
 * inside the transaction, then validate. Call only from prisma.$transaction.
 */
async function lockSalesOrderAndAssertCanComplete(tx, soId) {
  await lockSalesOrderForUpdate(tx, soId);
  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    include: { lines: true, dispatch: true },
  });
  if (!so) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }
  assertCanMarkSalesOrderCompleted(so);
}

/**
 * Adds dispatchLineStats + dispatchSummary for API responses (list/detail).
 * @param {object} so — sales order with lines + dispatch included
 */
function enrichSalesOrderWithDispatchStats(so) {
  const lines = so.lines ?? [];
  const dispatch = so.dispatch ?? [];
  const { dispatchLineStats, dispatchSummary } = computeSalesOrderDispatchLineStats(lines, dispatch, so.orderType);

  return {
    ...so,
    dispatchLineStats,
    dispatchSummary,
    dispatchProgressPercent: getSalesOrderDispatchCompletionPercent(dispatchLineStats),
  };
}

module.exports = {
  DISPATCH_COMPLETE_EPS,
  isSalesOrderConfirmedDispatchComplete,
  assertCanMarkSalesOrderCompleted,
  assertSalesOrderNotCompletedForDispatch,
  reopenSalesOrderIfConfirmedDispatchIncomplete,
  lockSalesOrderAndAssertCanComplete,
  enrichSalesOrderWithDispatchStats,
};
