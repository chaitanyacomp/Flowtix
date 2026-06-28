/**
 * Production workspace queue helpers — FIFO pick and executable-line filters (presentation only).
 */

export type ProductionQueueLine = {
  id: number;
  workOrderId: number;
  remainingQty?: number;
  approvedProducedQty?: number;
  qcPendingQty?: number;
};

const EPS = 1e-6;

export function lineRemainingQty(line: ProductionQueueLine): number {
  if (line.remainingQty != null && Number.isFinite(Number(line.remainingQty))) {
    return Math.max(0, Number(line.remainingQty));
  }
  return 0;
}

/** FIFO — oldest work order / line first (matches production work-orders API ordering). */
export function sortProductionLinesFifo<T extends ProductionQueueLine>(lines: T[]): T[] {
  return [...lines].sort((a, b) => {
    if (a.workOrderId !== b.workOrderId) return a.workOrderId - b.workOrderId;
    return a.id - b.id;
  });
}

/** Lines that still accept production entry (not QC-only or closed). */
export function filterExecutableProductionLines<T extends ProductionQueueLine>(lines: T[]): T[] {
  return lines.filter((l) => {
    const rem = lineRemainingQty(l);
    if (rem <= EPS) return false;
    const qcPending = Number(l.qcPendingQty ?? 0);
    if (qcPending > EPS && rem <= EPS) return false;
    return true;
  });
}

export function pickFirstExecutableProductionLine<T extends ProductionQueueLine>(
  lines: T[],
): T | null {
  const fifo = sortProductionLinesFifo(filterExecutableProductionLines(lines));
  return fifo[0] ?? null;
}
