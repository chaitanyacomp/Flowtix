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
  awaitProcurement: number;
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

  return {
    readyForWo: execution.readyForWo,
    materialIssuePending: input.materialIssuePendingCount,
    rmccCases: rmcc.openCases,
    awaitProcurement: monitor.awaitProcurement,
  };
}
