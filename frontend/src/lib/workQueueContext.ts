import type { NavigateFunction } from "react-router-dom";
import type { PendingAction } from "./pendingActionsApi";

export const WORK_QUEUE_CREATE_SALES_BILL = "CREATE_SALES_BILL" as const;

export type WorkQueueType = typeof WORK_QUEUE_CREATE_SALES_BILL;

export type WorkQueueItem = {
  id: string;
  documentNo: string;
  href: string;
  dispatchId?: number;
  billId?: number;
};

export type WorkQueueContext = {
  queueType: WorkQueueType;
  queueItems: WorkQueueItem[];
  currentIndex: number;
  returnToPendingActions: boolean;
};

export const PENDING_ACTION_CREATE_SALES_BILL_KEY = "Create Sales Bill";

export function isCreateSalesBillPendingBucket(bucketKey: string): boolean {
  return String(bucketKey ?? "").trim() === PENDING_ACTION_CREATE_SALES_BILL_KEY;
}

export function parsePendingActionSalesBillTarget(href: string): {
  dispatchId?: number;
  billId?: number;
} {
  try {
    const url = new URL(href, "http://erp.local");
    const billMatch = url.pathname.match(/^\/sales-bills\/(\d+)$/);
    const billId = billMatch ? Number(billMatch[1]) : 0;
    const dispatchId = Number(url.searchParams.get("dispatchId") ?? 0);
    return {
      ...(billId > 0 ? { billId } : {}),
      ...(dispatchId > 0 ? { dispatchId } : {}),
    };
  } catch {
    return {};
  }
}

export function workQueueItemFromPendingAction(row: PendingAction): WorkQueueItem {
  const href = String(row.href ?? "").trim();
  const { dispatchId, billId } = parsePendingActionSalesBillTarget(href);
  const documentNo = String(row.documentNo ?? "").trim() || "—";
  const id = String(row.id ?? (href || documentNo));
  return {
    id,
    documentNo,
    href,
    ...(dispatchId != null ? { dispatchId } : {}),
    ...(billId != null ? { billId } : {}),
  };
}

export function buildCreateSalesBillWorkQueue(items: PendingAction[]): WorkQueueContext | null {
  if (!items.length) return null;
  return {
    queueType: WORK_QUEUE_CREATE_SALES_BILL,
    queueItems: items.map(workQueueItemFromPendingAction),
    currentIndex: 0,
    returnToPendingActions: true,
  };
}

export function isWorkQueueContext(value: unknown): value is WorkQueueContext {
  if (!value || typeof value !== "object") return false;
  const v = value as WorkQueueContext;
  return (
    v.queueType === WORK_QUEUE_CREATE_SALES_BILL &&
    Array.isArray(v.queueItems) &&
    v.queueItems.length > 0 &&
    Number.isFinite(Number(v.currentIndex)) &&
    Number(v.currentIndex) >= 0 &&
    Number(v.currentIndex) < v.queueItems.length
  );
}

export function readWorkQueueFromLocationState(state: unknown): WorkQueueContext | null {
  if (!state || typeof state !== "object") return null;
  const raw = (state as { workQueue?: unknown }).workQueue;
  return isWorkQueueContext(raw) ? raw : null;
}

export function remainingWorkQueueCount(queue: WorkQueueContext, afterCurrent = true): number {
  const base = afterCurrent ? queue.currentIndex + 1 : queue.currentIndex;
  return Math.max(0, queue.queueItems.length - base);
}

export function workQueuePositionLabel(queue: WorkQueueContext): string {
  return `Document ${queue.currentIndex + 1} of ${queue.queueItems.length}`;
}

export function ensurePendingActionsHref(href: string): string {
  try {
    const url = new URL(href, "http://erp.local");
    if (!url.searchParams.has("from")) {
      url.searchParams.set("from", "pending-actions");
    }
    const qs = url.searchParams.toString();
    return qs ? `${url.pathname}?${qs}` : url.pathname;
  } catch {
    return href.includes("from=") ? href : `${href}${href.includes("?") ? "&" : "?"}from=pending-actions`;
  }
}

export function withWorkQueueState(
  queue: WorkQueueContext,
  extra?: Record<string, unknown>,
): { workQueue: WorkQueueContext } & Record<string, unknown> {
  return { workQueue: queue, ...(extra ?? {}) };
}

export function navigateToWorkQueueIndex(
  navigate: NavigateFunction,
  queue: WorkQueueContext,
  index: number,
  opts?: { replace?: boolean },
): void {
  const clamped = Math.max(0, Math.min(index, queue.queueItems.length - 1));
  const item = queue.queueItems[clamped];
  if (!item) return;
  const nextQueue: WorkQueueContext = { ...queue, currentIndex: clamped };
  navigate(ensurePendingActionsHref(item.href), {
    state: withWorkQueueState(nextQueue),
    replace: opts?.replace ?? false,
  });
}

export function navigateOpenNextWorkQueueItem(
  navigate: NavigateFunction,
  queue: WorkQueueContext,
): boolean {
  const nextIndex = queue.currentIndex + 1;
  if (nextIndex >= queue.queueItems.length) return false;
  navigateToWorkQueueIndex(navigate, queue, nextIndex, { replace: true });
  return true;
}
