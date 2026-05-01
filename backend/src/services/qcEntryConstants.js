/**
 * QC rows with reversedAt set are fully reversed (stock QC_REVERSAL posted, scrap voided).
 * They must be excluded from dispatch caps, dashboards, reports, and every QC total.
 *
 * Batch-level accepted/rejected/pending math (ProductionEntry): use
 * {@link ./reportMetrics.js} — sumActiveQcAcceptedQty, sumActiveQcRejectedQty,
 * getProductionBatchQcPendingQty (same formulas everywhere).
 */
const QC_ENTRY_ACTIVE_WHERE = { reversedAt: null };

/** @param {{ reversedAt?: Date | string | null } | null | undefined} row */
function isActiveQcEntry(row) {
  return row != null && row.reversedAt == null;
}

module.exports = { QC_ENTRY_ACTIVE_WHERE, isActiveQcEntry };
