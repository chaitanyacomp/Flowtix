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

/** Executable lines for one work order (partial production may remain). */
export function executableLinesForWorkOrder<T extends ProductionQueueLine>(
  lines: T[],
  workOrderId: number,
): T[] {
  return filterExecutableProductionLines(lines.filter((l) => l.workOrderId === workOrderId));
}

/** FIFO next executable line on a different work order. */
export function pickNextExecutableProductionLineExcludingWorkOrder<T extends ProductionQueueLine>(
  lines: T[],
  excludeWorkOrderId: number,
): T | null {
  const fifo = sortProductionLinesFifo(filterExecutableProductionLines(lines));
  const seen = new Set<number>();
  for (const line of fifo) {
    if (line.workOrderId === excludeWorkOrderId) continue;
    if (seen.has(line.workOrderId)) continue;
    seen.add(line.workOrderId);
    return line;
  }
  return null;
}

export type PostProductionReportConfirmAdvance =
  | { kind: "stay"; line: ProductionQueueLine | null }
  | { kind: "advance"; line: ProductionQueueLine | null };

/**
 * After Production Report confirmation — mirror Material Issue auto-advance:
 * stay when same WO still has executable remaining qty; otherwise FIFO advance or empty.
 */
export function resolvePostProductionReportConfirmAdvance(input: {
  confirmedWorkOrderId: number;
  lines: ProductionQueueLine[];
  requiresShortfallDecision?: boolean;
  forceAdvanceFromConfirmedWorkOrder?: boolean;
}): PostProductionReportConfirmAdvance {
  const woId = Number(input.confirmedWorkOrderId);
  const sameWoNext = pickFirstExecutableProductionLine(executableLinesForWorkOrder(input.lines, woId));

  if (input.forceAdvanceFromConfirmedWorkOrder) {
    return {
      kind: "advance",
      line: pickNextExecutableProductionLineExcludingWorkOrder(input.lines, woId),
    };
  }

  if (input.requiresShortfallDecision) {
    return { kind: "stay", line: sameWoNext };
  }

  if (sameWoNext) {
    return { kind: "stay", line: sameWoNext };
  }

  return {
    kind: "advance",
    line: pickNextExecutableProductionLineExcludingWorkOrder(input.lines, woId),
  };
}

/** Scopes bumped after production report confirmation (queue + dashboards). */
export const PRODUCTION_REPORT_CONFIRM_REFRESH_SCOPES = [
  "production",
  "dashboard",
  "workorders",
  "reports",
  "stock",
  "pending-actions",
] as const;

/** Build QC-pending totals per WO line from refreshed production entries. */
export function buildQcPendingByWorkOrderLineId(
  entries: Array<{
    workOrderLine?: { id?: number };
    qcPendingQty?: number;
    workflowStatus?: string;
  }>,
): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of entries) {
    if ((e.workflowStatus ?? "APPROVED") !== "APPROVED") continue;
    const id = Number(e.workOrderLine?.id ?? 0);
    if (!(id > 0)) continue;
    const pending = Number(e.qcPendingQty ?? 0) || 0;
    m.set(id, (m.get(id) ?? 0) + Math.max(0, pending));
  }
  return m;
}

/** Map refreshed WO lines + entries into queue rows for post-confirm advance. */
export function buildProductionQueueLines(
  flatLines: Array<
    ProductionQueueLine & {
      remainingQty?: number;
      qcPendingQty?: number;
    }
  >,
  qcPendingByWolId: Map<number, number>,
): ProductionQueueLine[] {
  return flatLines.map((l) => ({
    id: l.id,
    workOrderId: l.workOrderId,
    remainingQty: lineRemainingQty(l),
    approvedProducedQty: l.approvedProducedQty,
    qcPendingQty: l.qcPendingQty ?? qcPendingByWolId.get(l.id) ?? 0,
  }));
}

export function hasExecutableProductionWork(lines: ProductionQueueLine[]): boolean {
  return filterExecutableProductionLines(lines).length > 0;
}

export function executableWorkOrderIds(lines: ProductionQueueLine[]): Set<number> {
  return new Set(filterExecutableProductionLines(lines).map((l) => l.workOrderId));
}
