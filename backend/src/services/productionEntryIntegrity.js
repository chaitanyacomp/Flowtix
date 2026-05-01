/**
 * Production entry ↔ QC integrity (one ProductionEntry = one logical batch).
 * Multiple active QC rows per batch are allowed when pending QC remains (partial inspections).
 *
 * Draft batches may be updated/deleted via production routes; approved batches are locked.
 * This module centralizes QC-related guards for qty changes and deletes.
 */

const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const {
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("./reportMetrics");

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function countActiveQcEntriesForProduction(tx, productionId) {
  return tx.qcEntry.count({
    where: { productionId, ...QC_ENTRY_ACTIVE_WHERE },
  });
}

/**
 * Includes reversed QC rows (audit history).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function countAllQcEntriesForProduction(tx, productionId) {
  return tx.qcEntry.count({ where: { productionId } });
}

/**
 * Sum of active accepted + active rejected QC for this batch (cannot exceed producedQty).
 * @param {Array<{ acceptedQty?: unknown; rejectedQty?: unknown; reversedAt?: Date | string | null }>} qcEntries
 */
function getActiveQcProcessedTotal(qcEntries) {
  return (
    sumActiveQcAcceptedQty(qcEntries) + sumActiveQcRejectedQty(qcEntries)
  );
}

/**
 * Structural change or produced-qty reduction: block if any QC row ever existed (including reversed),
 * so production history stays aligned with QC audit trail.
 */
async function assertProductionEntryHasNoQcHistory(tx, productionId) {
  const n = await countAllQcEntriesForProduction(tx, productionId);
  if (n > 0) {
    const err = new Error(
      "This production batch cannot be removed or structurally changed because quality control history exists. Use QC reversal where applicable.",
    );
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Reducing produced qty: must stay at or above active accepted + active rejected.
 * Call with qcEntries loaded using `{ where: QC_ENTRY_ACTIVE_WHERE }` (or filter client-side).
 */
function assertProducedQtyCoversActiveQc(producedQty, qcEntries, eps = 1e-6) {
  const processed = getActiveQcProcessedTotal(qcEntries);
  if (producedQty + eps < processed) {
    const err = new Error(
      `Produced quantity cannot be less than the total already covered by quality control (accepted plus rejected: ${processed}).`,
    );
    err.statusCode = 400;
    throw err;
  }
}

module.exports = {
  countActiveQcEntriesForProduction,
  countAllQcEntriesForProduction,
  assertProductionEntryHasNoQcHistory,
  assertProducedQtyCoversActiveQc,
  getActiveQcProcessedTotal,
};
