/** Read-only accessors for backend dispatch quantity engine fields — no client-side operational math. */

import {
  deriveDispatchStatusLabelFromQuantities,
  shouldIncludeCompactQueueRow,
  type DispatchCompactQueueRow,
} from "./dispatchWorkspaceUx";

export type DispatchLineQuantityFields = {
  originalReadyQty?: number | null;
  dispatchDraftQty?: number | null;
  finalizedDispatchQty?: number | null;
  remainingDispatchableQty?: number | null;
  dispatchStatus?: string | null;
  dispatchStatusLabel?: string | null;
  /** Legacy aliases — read only when authoritative fields absent. */
  dispatchable?: number | null;
  dispatchableQty?: number | null;
  dispatchPendingLock?: number | null;
  dispatched?: number | null;
};

export type DispatchSoQuantityFields = {
  totalRemainingDispatchableQty?: number | null;
  lineStats?: DispatchLineQuantityFields[] | null;
};

export function readRemainingDispatchableQty(line: DispatchLineQuantityFields | null | undefined): number {
  if (!line) return 0;
  if (line.remainingDispatchableQty != null && Number.isFinite(Number(line.remainingDispatchableQty))) {
    return Math.max(0, Number(line.remainingDispatchableQty));
  }
  return Math.max(0, Number(line.dispatchable ?? line.dispatchableQty ?? 0) || 0);
}

export function readDispatchDraftQty(line: DispatchLineQuantityFields | null | undefined): number {
  if (!line) return 0;
  if (line.dispatchDraftQty != null && Number.isFinite(Number(line.dispatchDraftQty))) {
    return Math.max(0, Number(line.dispatchDraftQty));
  }
  return Math.max(0, Number(line.dispatchPendingLock ?? 0) || 0);
}

export function readFinalizedDispatchQty(line: DispatchLineQuantityFields | null | undefined): number {
  if (!line) return 0;
  if (line.finalizedDispatchQty != null && Number.isFinite(Number(line.finalizedDispatchQty))) {
    return Math.max(0, Number(line.finalizedDispatchQty));
  }
  return Math.max(0, Number(line.dispatched ?? 0) || 0);
}

export function readOriginalReadyQty(line: DispatchLineQuantityFields | null | undefined): number {
  if (!line) return 0;
  if (line.originalReadyQty != null && Number.isFinite(Number(line.originalReadyQty))) {
    return Math.max(0, Number(line.originalReadyQty));
  }
  return (
    readRemainingDispatchableQty(line) + readDispatchDraftQty(line) + readFinalizedDispatchQty(line)
  );
}

export function readDispatchStatusLabel(line: DispatchLineQuantityFields | null | undefined): string {
  const label = line?.dispatchStatusLabel?.trim();
  if (label) return label;
  return "—";
}

export function readSoTotalRemainingDispatchable(so: DispatchSoQuantityFields | null | undefined): number {
  if (!so) return 0;
  if (
    so.totalRemainingDispatchableQty != null &&
    Number.isFinite(Number(so.totalRemainingDispatchableQty))
  ) {
    return Math.max(0, Number(so.totalRemainingDispatchableQty));
  }
  return (so.lineStats ?? []).reduce((sum, ls) => sum + readRemainingDispatchableQty(ls), 0);
}

export function sumLineStatsRemainingDispatchable(
  lines: DispatchLineQuantityFields[] | null | undefined,
): number {
  return (lines ?? []).reduce((sum, ls) => sum + readRemainingDispatchableQty(ls), 0);
}

export function sumLineStatsDispatchDraftForItem(
  lines: Array<DispatchLineQuantityFields & { itemId?: number }> | null | undefined,
  itemId: number,
): number {
  return (lines ?? [])
    .filter((ls) => Number(ls.itemId) === Number(itemId))
    .reduce((sum, ls) => sum + readDispatchDraftQty(ls), 0);
}

export function sumLineStatsRemainingForItem(
  lines: Array<DispatchLineQuantityFields & { itemId?: number }> | null | undefined,
  itemId: number,
): number {
  return (lines ?? [])
    .filter((ls) => Number(ls.itemId) === Number(itemId))
    .reduce((sum, ls) => sum + readRemainingDispatchableQty(ls), 0);
}

type CompactQueueLineStat = DispatchLineQuantityFields & {
  lineId: number;
  itemId: number;
  itemName: string;
};

/** Build compact queue rows from backend line stats — presentation only, no operational math. */
export function buildCompactQueueRowsFromSo(so: {
  orderType?: string | null;
  lineStats?: CompactQueueLineStat[] | null;
}): DispatchCompactQueueRow[] {
  const lines = so.lineStats ?? [];
  if (so.orderType === "NO_QTY") {
    const byItem = new Map<number, DispatchCompactQueueRow>();
    for (const ls of lines) {
      const remaining = readRemainingDispatchableQty(ls);
      const draft = readDispatchDraftQty(ls);
      if (!shouldIncludeCompactQueueRow(remaining, draft)) continue;
      const finalized = readFinalizedDispatchQty(ls);
      const original = readOriginalReadyQty(ls);
      const existing = byItem.get(ls.itemId);
      if (existing) {
        existing.readyQty += remaining;
        existing.draftQty += draft;
        existing.dispatchedQty += finalized;
        existing.originalReadyQty += original;
        existing.hasOpenDraft = existing.hasOpenDraft || draft > 1e-9;
        existing.statusLabel = deriveDispatchStatusLabelFromQuantities(
          existing.readyQty,
          existing.draftQty,
          existing.dispatchedQty,
        );
      } else {
        byItem.set(ls.itemId, {
          lineId: ls.lineId,
          itemId: ls.itemId,
          itemName: ls.itemName,
          readyQty: remaining,
          draftQty: draft,
          dispatchedQty: finalized,
          originalReadyQty: original,
          statusLabel: readDispatchStatusLabel(ls),
          hasOpenDraft: draft > 1e-9,
        });
      }
    }
    return [...byItem.values()].sort(
      (a, b) => a.itemName.localeCompare(b.itemName) || a.itemId - b.itemId,
    );
  }
  return lines
    .map((ls) => {
      const remaining = readRemainingDispatchableQty(ls);
      const draft = readDispatchDraftQty(ls);
      return {
        lineId: ls.lineId,
        itemId: ls.itemId,
        itemName: ls.itemName,
        readyQty: remaining,
        draftQty: draft,
        dispatchedQty: readFinalizedDispatchQty(ls),
        originalReadyQty: readOriginalReadyQty(ls),
        statusLabel: readDispatchStatusLabel(ls),
        hasOpenDraft: draft > 1e-9,
      };
    })
    .filter((row) => shouldIncludeCompactQueueRow(row.readyQty, row.draftQty))
    .sort((a, b) => a.itemName.localeCompare(b.itemName) || a.itemId - b.itemId);
}
