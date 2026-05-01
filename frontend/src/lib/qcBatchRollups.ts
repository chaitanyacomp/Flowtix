/**
 * Production-batch QC rollups (one ProductionEntry). Mirrors backend reportMetrics + qcEntryConstants:
 * only QC rows with reversedAt == null count toward accepted/rejected/pending.
 */

export type QcEntryLike = {
  acceptedQty?: string | number | null;
  rejectedQty?: string | number | null;
  reversedAt?: string | Date | null;
};

export function isActiveQcEntry(row: QcEntryLike | null | undefined): boolean {
  return row != null && row.reversedAt == null;
}

export function sumActiveQcAcceptedQty(qcEntries: readonly QcEntryLike[] | null | undefined): number {
  let a = 0;
  for (const q of qcEntries ?? []) {
    if (!isActiveQcEntry(q)) continue;
    a += Number(q.acceptedQty ?? 0);
  }
  return a;
}

export function sumActiveQcRejectedQty(qcEntries: readonly QcEntryLike[] | null | undefined): number {
  let r = 0;
  for (const q of qcEntries ?? []) {
    if (!isActiveQcEntry(q)) continue;
    r += Number(q.rejectedQty ?? 0);
  }
  return r;
}

/** max(0, produced − accepted − rejected) using active QC only */
export function getProductionBatchQcPendingQty(
  producedQty: number,
  acceptedQty: number,
  rejectedQty: number,
): number {
  return Math.max(0, producedQty - (acceptedQty + rejectedQty));
}
