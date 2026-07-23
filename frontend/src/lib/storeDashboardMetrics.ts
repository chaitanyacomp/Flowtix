import type { NoQtyPlannerInboxRow } from "../hooks/useNoQtyPlannerInbox";
import {
  computeStoreProcurementPulseMetrics,
  type StoreProcurementWorkspaceLike,
} from "./storeProcurementPulse";

const QTY_EPS = 1e-6;

export type NoQtyExecutionSummaryMetrics = {
  readyForWo: number;
  openWos: number;
  awaitProcurement: number;
  rsBalancePending: number;
};

export type StoreDashboardKpiMetrics = {
  readyForWo: number;
  materialIssuePending: number;
  rmccCases: number;
  /** Awaiting procurement (PR/PO / inbox await). */
  awaitProcurement: number;
  /** GRN lines waiting receive. */
  grnPending: number;
  /** Combined Await Procurement / GRN KPI. */
  awaitProcurementOrGrn: number;
};

export type StoreRmccSummaryMetrics = {
  openCases: number;
  issueReadyWos: number;
};

export type StoreProcurementMonitorMetrics = {
  awaitProcurement: number;
  grnPending: number;
  blockedProcurementCases: number;
};

export type MaterialAvailabilitySummaryLike = {
  queueCount?: number;
  readyIssueCount?: number;
  purchaseWaitingCount?: number;
  /** REGULAR_SO cases with RM received / ready — Create Work Order in Prepare WO. */
  rmReceivedCreateWoCount?: number;
};

export function computeNoQtyExecutionSummaryMetrics(
  rows: NoQtyPlannerInboxRow[],
): NoQtyExecutionSummaryMetrics {
  const active = rows.filter((r) => r.executionRegisterEnabled);
  return {
    readyForWo: active.filter((r) => r.actionNeededKey === "PLACE_WO").length,
    openWos: active.filter(
      (r) => r.actionNeededKey === "MONITOR_WO" || r.actionNeededKey === "ISSUE_RM",
    ).length,
    awaitProcurement: active.filter((r) => r.actionNeededKey === "AWAIT_PROCUREMENT").length,
    rsBalancePending: active.filter((r) => Number(r.rsBalanceQty ?? 0) > QTY_EPS).length,
  };
}

export function computeStoreRmccSummaryMetrics(
  summary: MaterialAvailabilitySummaryLike | null | undefined,
): StoreRmccSummaryMetrics {
  return {
    openCases: Number(summary?.queueCount ?? 0),
    issueReadyWos: Number(summary?.readyIssueCount ?? 0),
  };
}

/** RM Control Center is actionable only after WO placement creates RMCC / issue-ready work. */
export function isStoreRmccActionAvailable(metrics: StoreRmccSummaryMetrics): boolean {
  return metrics.openCases > 0 || metrics.issueReadyWos > 0;
}

export const STORE_RMCC_UNAVAILABLE_HINT = "Available after WO is placed / RM issue is ready.";

export function countBlockedProcurementCases(ws: StoreProcurementWorkspaceLike | null | undefined): number {
  const mrs = ws?.sections?.pendingMaterialRequirements ?? [];
  return mrs.filter((m) => {
    const key = String(m.operationalKey ?? "").toUpperCase();
    if (key.includes("BLOCKED") || key === "MISSING_BOM") return true;
    return String(m.nextActionKey ?? "").toUpperCase() === "BLOCKED";
  }).length;
}

export function computeStoreProcurementMonitorMetrics(
  ws: StoreProcurementWorkspaceLike | null | undefined,
  inboxRows: NoQtyPlannerInboxRow[],
): StoreProcurementMonitorMetrics {
  const pulse = computeStoreProcurementPulseMetrics(ws);
  const inboxAwait = inboxRows.filter(
    (r) => r.executionRegisterEnabled && r.actionNeededKey === "AWAIT_PROCUREMENT",
  ).length;
  const inboxBlocked = inboxRows.filter(
    (r) => r.executionRegisterEnabled && r.actionNeededKey === "BLOCKED",
  ).length;
  const workspaceBlocked = countBlockedProcurementCases(ws);

  return {
    awaitProcurement: inboxAwait + pulse.awaitingPr + pulse.awaitingPo,
    grnPending: pulse.grnPending,
    blockedProcurementCases: inboxBlocked + workspaceBlocked,
  };
}

export function computeStoreDashboardKpiMetrics(input: {
  inboxRows: NoQtyPlannerInboxRow[];
  materialIssuePendingCount: number;
  rmccSummary: MaterialAvailabilitySummaryLike | null | undefined;
  procurementWorkspace: StoreProcurementWorkspaceLike | null | undefined;
}): StoreDashboardKpiMetrics {
  const execution = computeNoQtyExecutionSummaryMetrics(input.inboxRows);
  const monitor = computeStoreProcurementMonitorMetrics(input.procurementWorkspace, input.inboxRows);
  const rmcc = computeStoreRmccSummaryMetrics(input.rmccSummary);
  /** Same Regular SO eligibility as RM Control Center / Pending Actions (RM_RECEIVED_CREATE_WO). */
  const regularReadyForWo = Math.max(0, Number(input.rmccSummary?.rmReceivedCreateWoCount ?? 0));

  const awaitProcurement = monitor.awaitProcurement;
  const grnPending = monitor.grnPending;
  return {
    readyForWo: execution.readyForWo + regularReadyForWo,
    materialIssuePending: input.materialIssuePendingCount,
    rmccCases: rmcc.openCases,
    awaitProcurement,
    grnPending,
    awaitProcurementOrGrn: awaitProcurement + grnPending,
  };
}
