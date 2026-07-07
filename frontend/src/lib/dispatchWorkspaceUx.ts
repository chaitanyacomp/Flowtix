/** Store compact dispatch execution — opened from Pending Actions SO queue. */

import { formatQtyNumber, formatFgQuantity } from "./quantityDisplay";



export const DISPATCH_COMPACT_PENDING_SOURCE = "pending-actions";



export const DISPATCH_DRAFT_DELETE_CONFIRM_MESSAGE =

  "Delete this dispatch draft?\n\nThis will restore the dispatch quantity.";



export const DISPATCH_SO_COMPLETE_MESSAGE = "All dispatches for this Sales Order are completed.";



export type DispatchCompactQueueRow = {
  lineId: number;
  itemId: number;
  itemName: string;
  /** Remaining dispatchable qty (backend remainingDispatchableQty). */
  readyQty: number;
  draftQty: number;
  dispatchedQty: number;
  originalReadyQty: number;
  statusLabel: string;
  /** True when row is visible only because an open draft reserves qty. */
  hasOpenDraft?: boolean;
};



export type DispatchDraftSnapshot = {

  id: number;

  itemId: number;

  dispatchedQty: number | string;

  workflowStatus?: string | null;

  reversalOfId?: number | null;

};



export function isDispatchCompactExecutionMode(source: string | null | undefined, from: string | null | undefined): boolean {

  const s = String(source ?? "").trim().toLowerCase();

  const f = String(from ?? "").trim().toLowerCase();

  return s === DISPATCH_COMPACT_PENDING_SOURCE || f === DISPATCH_COMPACT_PENDING_SOURCE;

}



export function formatDispatchCompactQty(qty: number, unit?: string | null): string {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) {
    return unit?.trim() ? formatFgQuantity(0, unit) : "0";
  }
  return unit?.trim() ? formatFgQuantity(n, unit) : formatQtyNumber(n, unit);
}



export function sumDispatchCompactQueueQty(rows: DispatchCompactQueueRow[]): number {
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row.readyQty ?? 0)), 0);
}



export function sumUnlockedDraftQtyForItem(drafts: DispatchDraftSnapshot[] | null | undefined, itemId: number): number {

  return (drafts ?? [])

    .filter(

      (d) =>

        Number(d.itemId) === Number(itemId) &&

        d.reversalOfId == null &&

        String(d.workflowStatus ?? "").toUpperCase() === "UNLOCKED",

    )

    .reduce((sum, d) => sum + Math.max(0, Number(d.dispatchedQty ?? 0)), 0);

}



export function findOldestUnlockedDraft(drafts: DispatchDraftSnapshot[] | null | undefined): DispatchDraftSnapshot | null {

  const open = (drafts ?? [])

    .filter((d) => d.reversalOfId == null && String(d.workflowStatus ?? "").toUpperCase() === "UNLOCKED")

    .sort((a, b) => Number(a.id) - Number(b.id));

  return open[0] ?? null;

}



/** Queue row stays visible when dispatchable headroom or an open draft exists. */
export function shouldIncludeCompactQueueRow(remainingQty: number, draftQty: number, eps = 1e-9): boolean {
  return remainingQty > eps || draftQty > eps;
}



export function deriveDispatchStatusLabelFromQuantities(
  remainingQty: number,
  draftQty: number,
  finalizedQty: number,
  eps = 1e-9,
): string {
  if (draftQty > eps && remainingQty <= eps) return "Draft Saved";
  if (draftQty > eps && remainingQty > eps) return "Partial Draft";
  if (remainingQty > eps) return "Dispatchable";
  if (finalizedQty > eps) return "Dispatched";
  return "—";
}

/** Pick the next FIFO queue row after dispatch — same item if partial qty remains. */
export function resolvePostCompactDispatchQueueRow(input: {

  queue: DispatchCompactQueueRow[];

  dispatchedItemId: number;

  sameItemRemainingQty: number;

  eps?: number;

}): DispatchCompactQueueRow | null {

  const eps = input.eps ?? 1e-9;

  const queue = input.queue ?? [];

  if (!queue.length) return null;

  if (input.sameItemRemainingQty > eps) {

    const same = queue.find((r) => r.itemId === input.dispatchedItemId);

    if (same) return same;

  }

  const idx = queue.findIndex((r) => r.itemId === input.dispatchedItemId);

  if (idx >= 0 && idx < queue.length - 1) return queue[idx + 1] ?? null;

  if (idx === queue.length - 1) return null;

  return queue[0] ?? null;

}



/**
 * Stabilize compact dispatch selection across refresh:
 * keep active row when still in queue, else oldest draft, else first FIFO row.
 */
export function resolveCompactDispatchSelection(input: {
  queue: DispatchCompactQueueRow[];
  activeItemId: number | null | undefined;
  drafts?: DispatchDraftSnapshot[] | null;
}): DispatchCompactQueueRow | null {
  const queue = input.queue ?? [];
  if (!queue.length) return null;
  const activeId = Number(input.activeItemId ?? 0);
  if (Number.isFinite(activeId) && activeId > 0) {
    const active = queue.find((r) => r.itemId === activeId);
    if (active) return active;
  }
  const oldestDraft = findOldestUnlockedDraft(input.drafts);
  if (oldestDraft) {
    const draftRow = queue.find((r) => r.itemId === Number(oldestDraft.itemId));
    if (draftRow) return draftRow;
  }
  return queue[0] ?? null;
}



export function collectPreparedDispatchIdsFromPrepResponse(prepRes: unknown): number[] {

  const body = prepRes as {

    dispatch?: { id?: number | null } | null;

    dispatches?: Array<{ id?: number | null }> | null;

  } | null;

  if (!body) return [];

  const ids = new Set<number>();

  const push = (id: unknown) => {

    const n = Number(id);

    if (Number.isFinite(n) && n > 0) ids.add(n);

  };

  if (Array.isArray(body.dispatches)) {

    for (const row of body.dispatches) push(row?.id);

  }

  push(body.dispatch?.id);

  return [...ids];

}



/** Headroom restored when an unlocked draft row is deleted (draft reserved qty returns). */

export function headroomAfterDraftDelete(headroomWithDraft: number, draftQty: number): number {

  return Math.max(0, Number(headroomWithDraft ?? 0) + Math.max(0, Number(draftQty ?? 0)));

}



/** Max prepare qty — existing draft is replaceable, not additive reservation. */

export function dispatchPrepareQtyCap(input: {

  existingDraftQty: number;

  headroomToPrepare: number;

  usableStockCap?: number | null;

  eps?: number;

}): number {

  const eps = input.eps ?? 1e-9;

  const headroom = Math.max(0, Number(input.headroomToPrepare ?? 0));

  const draft = Math.max(0, Number(input.existingDraftQty ?? 0));

  const base = draft > eps ? draft + headroom : headroom;

  const cap = input.usableStockCap;

  if (cap != null && Number.isFinite(Number(cap))) {

    return Math.min(base, Math.max(0, Number(cap)));

  }

  return base;

}



/** Dispatch Full target — total dispatchable including replaceable open draft. */

export function dispatchFullTargetQty(input: {

  existingDraftQty: number;

  headroomToPrepare: number;

  eps?: number;

}): number {

  return dispatchPrepareQtyCap({

    existingDraftQty: input.existingDraftQty,

    headroomToPrepare: input.headroomToPrepare,

    eps: input.eps,

  });

}



export function draftQtyMatchesDispatchQty(

  existingDraftQty: number,

  dispatchQty: number,

  eps = 1e-9,

): boolean {

  return (

    existingDraftQty > eps &&

    Number.isFinite(dispatchQty) &&

    Math.abs(existingDraftQty - dispatchQty) <= eps

  );

}



/** Skip POST /dispatches when prepare qty equals the open draft (no double reservation). */

export function shouldSkipDispatchPrepareAsDuplicate(input: {

  existingDraftQty: number;

  dispatchQty: number;

  eps?: number;

}): boolean {

  return draftQtyMatchesDispatchQty(input.existingDraftQty, input.dispatchQty, input.eps);

}



export type DispatchFullPrepareAction = "prepare" | "skip_duplicate";



/** Compact Dispatch Full — save draft once; never finalize from this action. */

export function resolveDispatchFullPrepareAction(input: {

  existingDraftQty: number;

  headroomToPrepare: number;

  eps?: number;

}): DispatchFullPrepareAction {

  const targetQty = dispatchFullTargetQty({

    existingDraftQty: input.existingDraftQty,

    headroomToPrepare: input.headroomToPrepare,

    eps: input.eps,

  });

  const eps = input.eps ?? 1e-9;

  if (!(targetQty > eps)) return "skip_duplicate";

  if (

    shouldSkipDispatchPrepareAsDuplicate({

      existingDraftQty: input.existingDraftQty,

      dispatchQty: targetQty,

      eps,

    })

  ) {

    return "skip_duplicate";

  }

  return "prepare";

}



/** Enable Dispatch Full / Update draft when headroom remains or draft qty was edited. */

export function canCompactDispatchFull(input: {

  headroomToPrepare: number;

  existingDraftQty: number;

  dispatchQty: number | null;

  dispatchQtyValid: boolean;

  eps?: number;

}): boolean {

  const eps = input.eps ?? 1e-9;

  if (input.headroomToPrepare > eps) return true;

  return (

    input.existingDraftQty > eps &&

    input.dispatchQtyValid &&

    input.dispatchQty != null &&

    input.dispatchQty > eps &&

    !draftQtyMatchesDispatchQty(input.existingDraftQty, input.dispatchQty, eps)

  );

}



/** After draft is saved with no remaining ready qty, show finalize/delete only. */

export function isCompactDraftSavedIdleState(input: {

  hasOpenDraft: boolean;

  headroomToPrepare: number;

  dispatchQty: number | null;

  dispatchQtyValid: boolean;

  existingDraftQty: number;

  eps?: number;

}): boolean {

  if (!input.hasOpenDraft) return false;

  const eps = input.eps ?? 1e-9;

  if (input.headroomToPrepare > eps) return false;

  return !canCompactDispatchFull({

    headroomToPrepare: input.headroomToPrepare,

    existingDraftQty: input.existingDraftQty,

    dispatchQty: input.dispatchQty,

    dispatchQtyValid: input.dispatchQtyValid,

    eps,

  });

}



export const DISPATCH_FINALIZE_API_SUFFIX = "/lock";



export type CompactDispatchHistoryInput = {

  id: number;

  docNo?: string | null;

  date: string;

  itemName: string | null;

  dispatchedQty: string | number;

  reversalOfId: number | null;

  workflowStatus: "UNLOCKED" | "LOCKED";

};



export type CompactDispatchHistoryRow = {

  id: number;

  docNo: string | null;

  dateLabel: string;

  itemName: string;

  qty: number;

  statusLabel: "Draft" | "Finalized";

  userLabel: string;

};



/** dd-Mon label for compact dispatch history (e.g. 01-Jul). */

export function formatCompactDispatchHistoryDate(iso: string): string {

  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return "—";

  const day = String(d.getUTCDate()).padStart(2, "0");

  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });

  return `${day}-${month}`;

}



export function buildCompactDispatchHistoryRows(

  rows: CompactDispatchHistoryInput[],

): CompactDispatchHistoryRow[] {

  return rows

    .filter((r) => r.reversalOfId == null)

    .slice()

    .sort((a, b) => {

      const ta = new Date(a.date).getTime();

      const tb = new Date(b.date).getTime();

      if (ta !== tb) return ta - tb;

      return a.id - b.id;

    })

    .map((r) => ({

      id: r.id,

      docNo: r.docNo?.trim() || null,

      dateLabel: formatCompactDispatchHistoryDate(r.date),

      itemName: r.itemName?.trim() || "—",

      qty: Math.max(0, Number(r.dispatchedQty) || 0),

      statusLabel: r.workflowStatus === "LOCKED" ? "Finalized" : "Draft",

      userLabel: "—",

    }));

}



export function sumCompactDispatchHistoryFinalizedQty(rows: CompactDispatchHistoryRow[]): number {

  return rows.reduce((sum, r) => (r.statusLabel === "Finalized" ? sum + r.qty : sum), 0);

}



export function buildDispatchSoCompleteMessage(soLabel: string): string {

  const label = soLabel?.trim() || "this Sales Order";

  return `✓ All dispatches for Sales Order ${label} have been completed.`;

}


