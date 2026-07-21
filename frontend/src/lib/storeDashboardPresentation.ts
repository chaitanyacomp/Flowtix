/**
 * Store Operations Dashboard — presentation helpers (tabs, section gates, actionable inbox).
 * Does not change backend permissions or workflow rules.
 */

import type { PendingAction } from "./pendingActionsApi";
import { isStoreOwnedNoQtyRsPendingAction } from "./pendingActionsApi";
import type { StoreProcurementMonitorMetrics, StoreRmccSummaryMetrics } from "./storeDashboardMetrics";

export type StoreWorkspaceNavKey =
  | "overview"
  | "no-qty"
  | "rm-control"
  | "material-issue"
  | "production-monitor"
  | "dispatch"
  | "procurement-grn"
  | "stock";

/** Only the selected in-dashboard workspace is active; navigate-away chips stay neutral. */
export function isStoreWorkspaceTabActive(
  key: StoreWorkspaceNavKey,
  selected: "overview" | "production-monitor",
): boolean {
  if (key === "production-monitor") return selected === "production-monitor";
  return false;
}

export function shouldShowStoreRmccSection(metrics: StoreRmccSummaryMetrics): boolean {
  return metrics.openCases > 0 || metrics.issueReadyWos > 0;
}

export function shouldShowStoreProcurementSection(metrics: StoreProcurementMonitorMetrics): boolean {
  return (
    metrics.awaitProcurement > 0 || metrics.grnPending > 0 || metrics.blockedProcurementCases > 0
  );
}

export function shouldShowStoreDispatchReadySection(dispatchReadyCount: number): boolean {
  return dispatchReadyCount > 0;
}

export function shouldShowStorePrepareHeadroomSection(
  dispatchBacklogCount: number,
  backlogPreviewLength: number,
): boolean {
  return dispatchBacklogCount > 0 || backlogPreviewLength > 0;
}

export function shouldShowStoreNoQtyQueueSection(hasActionableNoQtyRows: boolean): boolean {
  return hasActionableNoQtyRows;
}

/** Stable identity for Create Cycle N RS so the same SO/cycle cannot inflate the inbox. */
export function storeCreateRsPendingIdentity(action: PendingAction): string | null {
  if (!isStoreOwnedNoQtyRsPendingAction(action)) return null;
  const meta = action.metadata ?? {};
  const soId = Number(meta.salesOrderId ?? 0);
  const cycleId = Number(meta.cycleId ?? 0);
  const cycleNo = Number(meta.cycleNo ?? 0);
  if (soId > 0 && cycleId > 0) return `create-rs:so:${soId}:cycle:${cycleId}`;
  if (soId > 0 && cycleNo > 0) return `create-rs:so:${soId}:cycleNo:${cycleNo}`;
  if (soId > 0) return `create-rs:so:${soId}`;
  const id = String(action.id ?? "");
  const m = id.match(/^no-qty-create-next-rs:(\d+)/);
  if (m) return `create-rs:so:${m[1]}`;
  return `create-rs:doc:${String(action.documentNo ?? action.action)}`;
}

export function storePendingActionIdentity(action: PendingAction): string {
  return storeCreateRsPendingIdentity(action) ?? String(action.id ?? `${action.action}:${action.documentNo}`);
}

/**
 * Actionable Store inbox rows only — exclude monitoring-only and zero-qty dispatch noise.
 */
export function isStoreDashboardActionablePendingAction(action: PendingAction): boolean {
  if (String(action.ownerRole ?? "").trim().toUpperCase() !== "STORE") return false;
  if (!String(action.href ?? "").trim()) return false;

  const label = String(action.action ?? "").trim();
  if (!label) return false;

  const lower = label.toLowerCase();
  if (
    /\bmonitor\b/.test(lower) &&
    !/\b(create|place|issue|dispatch|receive|approve|prepare|open grn|confirm)\b/.test(lower)
  ) {
    return false;
  }

  if (/dispatch/i.test(label) && action.qty != null && Number(action.qty) <= 0) {
    return false;
  }

  return true;
}

export function countStoreDashboardActionablePendingActions(actions: PendingAction[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (const action of actions) {
    if (!isStoreDashboardActionablePendingAction(action)) continue;
    const key = storePendingActionIdentity(action);
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}
