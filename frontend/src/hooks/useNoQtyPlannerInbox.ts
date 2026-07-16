import { apiFetch } from "../services/api";
import { useErpCachedQuery } from "./useErpCachedQuery";

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
  ctaLabel?: string | null;
  showProcurementPendingHint?: boolean;
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
  ctaLabel?: string | null;
  showProcurementPendingHint?: boolean;
  executionWorkspaceHref?: string | null;
};

const DEFAULT_ROLE = "STORE";
const DEFAULT_ROUTE = "/dashboard";

function mapInboxRows(payload: { rows: NoQtyPlanningInboxApiRow[] }): NoQtyPlannerInboxRow[] {
  return (Array.isArray(payload.rows) ? payload.rows : []).map((row) => ({
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
    ctaLabel: row.ctaLabel ?? null,
    showProcurementPendingHint: row.showProcurementPendingHint === true,
    executionWorkspaceHref: row.executionWorkspaceHref ?? null,
  }));
}

export function useNoQtyPlannerInbox(
  refreshKey = 0,
  opts?: { enabled?: boolean; role?: string; route?: string },
): {
  rows: NoQtyPlannerInboxRow[];
  loading: boolean;
  initialLoading: boolean;
  refreshing: boolean;
  firstLoadDone: boolean;
  error: string | null;
} {
  const enabled = opts?.enabled !== false;
  const role = opts?.role ?? DEFAULT_ROLE;
  const route = opts?.route ?? DEFAULT_ROUTE;

  const query = useErpCachedQuery({
    role,
    route,
    queryKey: "no-qty-inbox",
    apiPath: "/api/planning-dashboard/no-qty-inbox",
    enabled,
    refreshTick: refreshKey,
    fetcher: async () => {
      const payload = await apiFetch<{ rows: NoQtyPlanningInboxApiRow[] }>(
        "/api/planning-dashboard/no-qty-inbox",
      );
      return mapInboxRows(payload);
    },
  });

  return {
    rows: query.data ?? [],
    loading: query.busy,
    initialLoading: query.initialLoading,
    refreshing: query.refreshing,
    firstLoadDone: query.firstLoadDone,
    error: query.error,
  };
}
