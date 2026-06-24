import * as React from "react";

import { apiFetch } from "../services/api";

import type { NoQtyFlowState } from "../lib/noQtyFlowState";

import type { PlanningInboxSoSummary } from "../lib/planningInboxPresentation";

export type NoQtyExecutionActionNeededKey =
  | "PLACE_WO"
  | "ISSUE_RM"
  | "AWAIT_PROCUREMENT"
  | "BLOCKED"
  | "MONITOR_WO"
  | "COMPLETE"
  | string;

export type NoQtyPlannerInboxRow = {
  so: PlanningInboxSoSummary;
  rsStatus: string;
  lockedPeriodKey: string | null;
  flowState: NoQtyFlowState | null;
  guidedCycleId: number | null;
  cycleNo: number | null;
  openExecutionBalanceQty?: number | null;
  requirementSheetHref?: string | null;
  pendingPlanningAction?: string | null;
  latestRsId?: number | null;
  latestRsNo?: string | null;
  executionRegisterEnabled?: boolean;
  placementRequirementSheetId?: number | null;
  placementRequirementSheetNo?: string | null;
  rsBalanceQty?: number | null;
  suggestedWoQty?: number | null;
  rmCoverageStatus?: string | null;
  rmCoverageLabel?: string | null;
  actionNeededKey?: NoQtyExecutionActionNeededKey | null;
  actionNeededLabel?: string | null;
  executionWorkspaceHref?: string | null;
};

type NoQtyPlanningInboxApiRow = {
  salesOrderId: number;
  soNumber?: string | null;
  customerName?: string | null;
  currentCycleNo?: number | null;
  activeCycleId?: number | null;
  latestRsId?: number | null;
  latestRsNo?: string | null;
  latestRsStatus?: string | null;
  rsStatus: string;
  lockedPeriodKey: string | null;
  pendingPlanningAction?: string | null;
  openExecutionBalanceQty?: number | null;
  requirementSheetHref?: string | null;
  so: PlanningInboxSoSummary;
  flowState: NoQtyFlowState | null;
  guidedCycleId: number | null;
  cycleNo: number | null;
  executionRegisterEnabled?: boolean;
  placementRequirementSheetId?: number | null;
  placementRequirementSheetNo?: string | null;
  rsBalanceQty?: number | null;
  suggestedWoQty?: number | null;
  rmCoverageStatus?: string | null;
  rmCoverageLabel?: string | null;
  actionNeededKey?: string | null;
  actionNeededLabel?: string | null;
  executionWorkspaceHref?: string | null;
};

export function useNoQtyPlannerInbox(refreshKey = 0): {
  rows: NoQtyPlannerInboxRow[];
  loading: boolean;
  error: string | null;
} {
  const [rows, setRows] = React.useState<NoQtyPlannerInboxRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const payload = await apiFetch<{ rows: NoQtyPlanningInboxApiRow[] }>(
          "/api/planning-dashboard/no-qty-inbox",
        );
        const mapped = (Array.isArray(payload.rows) ? payload.rows : []).map((row) => ({
          so: row.so,
          rsStatus: row.rsStatus,
          lockedPeriodKey: row.lockedPeriodKey,
          flowState: row.flowState ?? null,
          guidedCycleId: row.guidedCycleId,
          cycleNo: row.cycleNo,
          openExecutionBalanceQty: row.openExecutionBalanceQty ?? null,
          requirementSheetHref: row.requirementSheetHref ?? null,
          pendingPlanningAction: row.pendingPlanningAction ?? null,
          latestRsId: row.latestRsId ?? null,
          latestRsNo: row.latestRsNo ?? null,
          executionRegisterEnabled: row.executionRegisterEnabled ?? false,
          placementRequirementSheetId: row.placementRequirementSheetId ?? null,
          placementRequirementSheetNo: row.placementRequirementSheetNo ?? null,
          rsBalanceQty: row.rsBalanceQty ?? null,
          suggestedWoQty: row.suggestedWoQty ?? null,
          rmCoverageStatus: row.rmCoverageStatus ?? null,
          rmCoverageLabel: row.rmCoverageLabel ?? null,
          actionNeededKey: row.actionNeededKey ?? null,
          actionNeededLabel: row.actionNeededLabel ?? null,
          executionWorkspaceHref: row.executionWorkspaceHref ?? null,
        }));
        if (cancelled) return;
        setRows(mapped);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load planner inbox");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { rows, loading, error };
}
