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

export type ProductionBatchQcRollupsSource = {
  producedQty?: string | number | null;
  qcAcceptedQty?: number | null;
  qcRejectedQty?: number | null;
  qcPendingQty?: number | null;
  qcEntries?: readonly QcEntryLike[] | null;
};

/**
 * Prefer backend rollups from GET /production-entries; fall back to active qcEntries only when absent.
 */
export function resolveProductionBatchQcRollups(
  row: ProductionBatchQcRollupsSource,
): { produced: number; accepted: number; rejected: number; pending: number } {
  const producedRaw = Number(row.producedQty ?? 0);
  const produced = Number.isFinite(producedRaw) ? producedRaw : 0;
  if (
    row.qcAcceptedQty != null &&
    row.qcRejectedQty != null &&
    row.qcPendingQty != null &&
    Number.isFinite(row.qcAcceptedQty) &&
    Number.isFinite(row.qcRejectedQty) &&
    Number.isFinite(row.qcPendingQty)
  ) {
    const accepted = n(row.qcAcceptedQty);
    const rejected = n(row.qcRejectedQty);
    const pending = n(row.qcPendingQty);
    return { produced, accepted, rejected, pending };
  }
  const accepted = sumActiveQcAcceptedQty(row.qcEntries);
  const rejected = sumActiveQcRejectedQty(row.qcEntries);
  const pending = getProductionBatchQcPendingQty(produced, accepted, rejected);
  return { produced, accepted, rejected, pending };
}

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
