import * as React from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../services/api";
import { type NoQtyFlowState } from "../../lib/noQtyFlowState";
import { resolveNoQtyDashboardContinuation } from "../../lib/noQtyDashboardContinuation";
import { resolveNoQtyDashboardActionLabel } from "../../lib/noQtyDashboardPresentation";
import { prepareNoQtyNextRequirementSheetAndNavigate } from "../../lib/noQtyPrepareNextRsNavigate";
import { useToast } from "../../contexts/ToastContext";
import { useDemoMode } from "../../contexts/DemoModeContext";
import {
  filterActionableDispatchBacklogRows,
  type DispatchBacklogRow,
  ROW_NUM_EPS,
} from "../../lib/dispatchBacklog";
import { useDashboardPendingActionsDesk } from "../../hooks/useDashboardPendingActionsDesk";
import { useErpCachedQuery } from "../../hooks/useErpCachedQuery";
import { StoreDispatchDashboard, type StoreDispatchActionRow } from "./StoreDispatchDashboard";
import type { ResolvedNoQtyContinuation } from "../../lib/noQtyDashboardContinuation";
import { ErpPageLoader } from "../../components/erp/foundation";
import { dashboardShell } from "../../lib/dashboardShell";
import { ERP_DASHBOARD_POLL_MS, useErpRefreshTick } from "../../hooks/useErpRefreshTick";
import { useRouteActive } from "../../hooks/useRouteActive";
import { endPerfMark, usePagePerf } from "../../lib/performanceTiming";
import {
  dedupeContinueWorkingBySalesOrder,
  enrichActionRequiredWithNoQtyPlanning,
  enforceUniqueSalesOrdersAcrossGroups,
  isNoQtyDashboardPlanningRow,
  partitionContinueWorkingForActions,
  primaryActionStageBySalesOrder,
  shouldHideOpenNoQtyForActionRequired,
  type ContinueWorkingRow,
} from "../../lib/dashboardActionQueue";

const DASH_SHELL = dashboardShell.page;
const DASH_MAX = dashboardShell.max;
const DASHBOARD_ROUTE = "/dashboard";
const DASH_NO_QTY_CONTINUATION_CAP = 5;
const STORE_ROLE = "STORE";

type DashboardSalesOrderHead = {
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  internalStatus: string;
  cycleId?: number | null;
  cycleNo?: number | null;
  planningPointerCycleId?: number | null;
  planningPointerCycleNo?: number | null;
  noQtyPlanningPointerAhead?: boolean;
  latestRequirementSheetId?: number | null;
  latestRequirementSheetDocNo?: string | null;
  latestRequirementSheetStatus?: string | null;
};

type OpenNoQtyContinuationRow = {
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  cycleNo?: number | null;
  cycleId?: number | null;
  planningPointerCycleNo?: number | null;
  planningPointerCycleId?: number | null;
  noQtyPlanningPointerAhead?: boolean;
  latestRequirementSheetId?: number | null;
  lastRsDocNo?: string | null;
  lastRsStatus?: string | null;
  lastShortageQty?: number | null;
  lastDispatchQty?: number | null;
  statusText: string;
};

function isExcludedInternalStatusForOpenNoQtyDashboard(internalStatus: string): boolean {
  return (
    internalStatus === "CLOSED" || internalStatus === "MANUALLY_CLOSED" || internalStatus === "CLOSED_WITH_WAIVER" ||
    internalStatus === "COMPLETED" ||
    internalStatus === "DRAFT"
  );
}

function isNoQtyResolvedRelevantForStore(resolved: ResolvedNoQtyContinuation): boolean {
  if (resolved.kind === "prepare_next_rs") return true;
  if (resolved.kind === "navigate") {
    const to = String(resolved.to ?? "");
    if (to.includes("/requirement-sheets") || to.includes("/no-qty-agreements") || to.includes("focus=execution")) {
      return true;
    }
  }
  return false;
}

export function StoreDashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const demo = useDemoMode();
  const isDashboardRoute = useRouteActive("/dashboard");
  const liveTick = useErpRefreshTick(["dashboard"], {
    pollIntervalMs: ERP_DASHBOARD_POLL_MS,
    enabled: isDashboardRoute,
  });

  const { deskProps: pendingActionsDeskProps, storePendingRsActions, initialLoading: pendingInitialLoading, refreshing: pendingRefreshing } =
    useDashboardPendingActionsDesk({
      filterStorePendingRs: true,
    });

  const fetchEnabled = isDashboardRoute && !demo.enabled;

  const continueWorkingQuery = useErpCachedQuery<ContinueWorkingRow[]>({
    role: STORE_ROLE,
    route: DASHBOARD_ROUTE,
    queryKey: "continue-working",
    apiPath: "/api/dashboard/continue-working?limit=50",
    enabled: fetchEnabled,
    refreshTick: liveTick,
    fetcher: async () => {
      try {
        const rows = await apiFetch<ContinueWorkingRow[]>("/api/dashboard/continue-working?limit=50");
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    },
  });

  const backlogQuery = useErpCachedQuery<DispatchBacklogRow[]>({
    role: STORE_ROLE,
    route: DASHBOARD_ROUTE,
    queryKey: "dispatch-backlog",
    apiPath: "/api/dashboard/dispatch-backlog",
    enabled: fetchEnabled,
    refreshTick: liveTick,
    fetcher: async () => {
      try {
        const rows = await apiFetch<DispatchBacklogRow[]>("/api/dashboard/dispatch-backlog");
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    },
  });

  const salesOrdersQuery = useErpCachedQuery<DashboardSalesOrderHead[]>({
    role: STORE_ROLE,
    route: DASHBOARD_ROUTE,
    queryKey: "no-qty-active",
    apiPath: "/api/dashboard/no-qty-active?limit=50",
    enabled: fetchEnabled,
    refreshTick: liveTick,
    fetcher: async () => {
      try {
        const rows = await apiFetch<DashboardSalesOrderHead[]>("/api/dashboard/no-qty-active?limit=50");
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    },
  });

  const continueWorking = continueWorkingQuery.data;
  const backlog = backlogQuery.data;
  const salesOrdersForDashboard = salesOrdersQuery.data;

  const storeInitialLoading =
    continueWorkingQuery.initialLoading ||
    backlogQuery.initialLoading ||
    pendingInitialLoading ||
    (salesOrdersQuery.initialLoading && !salesOrdersQuery.hasDisplayData);
  const storeRefreshing =
    continueWorkingQuery.refreshing ||
    backlogQuery.refreshing ||
    salesOrdersQuery.refreshing ||
    pendingRefreshing;
  const storePerfReady = !storeInitialLoading;
  usePagePerf("dashboard", storePerfReady, { role: STORE_ROLE, usesDedicatedRoleDesk: true });

  React.useEffect(() => {
    if (!storePerfReady) return;
    try {
      if (sessionStorage.getItem("erp:loginDashboardMark") === "1") {
        endPerfMark("login-dashboard-ready", "login-dashboard-ready", { role: STORE_ROLE });
        sessionStorage.removeItem("erp:loginDashboardMark");
      }
    } catch {
      // ignore
    }
  }, [storePerfReady]);

  const noQtyMetricsBySoId = React.useMemo(() => {
    const m = new Map<number, { shortage?: number; dispatch?: number }>();
    if (continueWorking) {
      for (const r of continueWorking) {
        if (r.orderType !== "NO_QTY" || r.stageKey !== "NEXT_RS") continue;
        const cur = m.get(r.salesOrderId) ?? {};
        if (cur.shortage == null) {
          const sq = Number(r.metricQty ?? 0);
          if (Number.isFinite(sq) && sq > ROW_NUM_EPS) cur.shortage = sq;
        }
        m.set(r.salesOrderId, cur);
      }
    }
    return m;
  }, [continueWorking]);

  const openNoQtyContinuationRows = React.useMemo((): OpenNoQtyContinuationRow[] => {
    if (demo.enabled || !salesOrdersQuery.hasDisplayData || !salesOrdersForDashboard) return [];
    const out: OpenNoQtyContinuationRow[] = [];
    for (const so of salesOrdersForDashboard) {
      if (isExcludedInternalStatusForOpenNoQtyDashboard(so.internalStatus)) continue;
      const metrics = noQtyMetricsBySoId.get(so.salesOrderId);
      const shortage = metrics?.shortage ?? null;
      const dispatch = metrics?.dispatch ?? null;
      const statusText =
        String(so.latestRequirementSheetStatus ?? "").toUpperCase() === "DRAFT"
          ? "Draft RS"
          : shortage != null && shortage > ROW_NUM_EPS
            ? "Shortage"
            : "";
      const hintDoc = so.latestRequirementSheetDocNo?.trim();
      out.push({
        salesOrderId: so.salesOrderId,
        salesOrderDocNo: so.salesOrderDocNo ?? null,
        customerName: so.customerName?.trim() ? so.customerName : "-",
        cycleNo: so.cycleNo ?? null,
        cycleId: so.cycleId ?? null,
        planningPointerCycleNo: so.planningPointerCycleNo ?? null,
        planningPointerCycleId: so.planningPointerCycleId ?? null,
        noQtyPlanningPointerAhead: Boolean(so.noQtyPlanningPointerAhead),
        latestRequirementSheetId: so.latestRequirementSheetId ?? null,
        lastRsDocNo: hintDoc ? hintDoc : null,
        lastRsStatus: so.latestRequirementSheetStatus ?? null,
        lastShortageQty: shortage,
        lastDispatchQty: dispatch,
        statusText,
      });
    }
    out.sort((a, b) => a.salesOrderId - b.salesOrderId);
    return out;
  }, [demo.enabled, salesOrdersForDashboard, salesOrdersQuery.hasDisplayData, noQtyMetricsBySoId]);

  const openNoQtyFlowFetchIds = React.useMemo(
    () => openNoQtyContinuationRows.slice(0, DASH_NO_QTY_CONTINUATION_CAP).map((r) => r.salesOrderId),
    [openNoQtyContinuationRows],
  );

  const openNoQtyFlowCycleBySoId = React.useMemo(() => {
    const map = new Map<number, number | null>();
    for (const row of openNoQtyContinuationRows.slice(0, DASH_NO_QTY_CONTINUATION_CAP)) {
      const cid =
        row.noQtyPlanningPointerAhead &&
        row.planningPointerCycleId != null &&
        Number(row.planningPointerCycleId) > 0
          ? Number(row.planningPointerCycleId)
          : row.cycleId != null && Number(row.cycleId) > 0
            ? Number(row.cycleId)
            : null;
      map.set(row.salesOrderId, cid);
    }
    return map;
  }, [openNoQtyContinuationRows]);

  const openNoQtyFlowFetchKey = openNoQtyFlowFetchIds.join(",");

  const openNoQtyFlowCycleBySoIdRef = React.useRef(openNoQtyFlowCycleBySoId);
  openNoQtyFlowCycleBySoIdRef.current = openNoQtyFlowCycleBySoId;

  const noQtyFlowQuery = useErpCachedQuery<Record<number, NoQtyFlowState | null>>({
    role: STORE_ROLE,
    route: DASHBOARD_ROUTE,
    queryKey: `no-qty-flow:${openNoQtyFlowFetchKey || "none"}`,
    apiPath: `/api/dashboard/no-qty-flow-state-batch:${openNoQtyFlowFetchKey || "none"}`,
    enabled: fetchEnabled && openNoQtyFlowFetchIds.length > 0,
    refreshTick: liveTick,
    fetcher: async () => {
      const ids = openNoQtyFlowFetchIds;
      const cycleMap = openNoQtyFlowCycleBySoIdRef.current;
      const pairs = await Promise.all(
        ids.map(async (id) => {
          try {
            const cid = cycleMap.get(id) ?? null;
            const qs = cid != null ? `?cycleId=${encodeURIComponent(String(cid))}` : "";
            const st = await apiFetch<NoQtyFlowState>(`/api/sales-orders/${id}/no-qty-flow-state${qs}`);
            return [id, st] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      return Object.fromEntries(pairs);
    },
  });

  const noQtyFlowBySo = noQtyFlowQuery.data ?? {};

  const hasNoQtyContinuationInActionRequired = !demo.enabled && openNoQtyContinuationRows.length > 0;

  const noQtyPlanningEnrichInputs = React.useMemo(() => {
    return openNoQtyContinuationRows.map((row) => {
      const flow = noQtyFlowBySo[row.salesOrderId];
      const ownerCycleId =
        row.noQtyPlanningPointerAhead &&
        row.planningPointerCycleId != null &&
        Number(row.planningPointerCycleId) > 0
          ? Number(row.planningPointerCycleId)
          : row.cycleId;
      const ownerCycleNo =
        row.noQtyPlanningPointerAhead &&
        row.planningPointerCycleNo != null &&
        Number.isFinite(Number(row.planningPointerCycleNo))
          ? Number(row.planningPointerCycleNo)
          : row.cycleNo;
      return {
        salesOrderId: row.salesOrderId,
        salesOrderDocNo: row.salesOrderDocNo,
        customerName: row.customerName,
        itemName: row.customerName,
        cycleNo: ownerCycleNo,
        cycleId: ownerCycleId,
        createNextRsEligible: Boolean(flow?.createNextRsEligible),
        lastShortageQty: row.lastShortageQty ?? null,
      };
    });
  }, [openNoQtyContinuationRows, noQtyFlowBySo]);

  const actionRequiredGroups = React.useMemo(() => {
    const base =
      continueWorkingQuery.hasDisplayData && continueWorking
        ? enforceUniqueSalesOrdersAcrossGroups(
            partitionContinueWorkingForActions(dedupeContinueWorkingBySalesOrder(continueWorking), {
              role: STORE_ROLE,
            }),
          )
        : { dispatch: [], production: [], qc: [], salesBill: [], nextRs: [], noQtyPlanning: [] };
    return enrichActionRequiredWithNoQtyPlanning(base, noQtyPlanningEnrichInputs, { role: STORE_ROLE });
  }, [continueWorking, continueWorkingQuery.hasDisplayData, noQtyPlanningEnrichInputs]);

  const primaryActionBySo = React.useMemo(
    () => primaryActionStageBySalesOrder(actionRequiredGroups),
    [actionRequiredGroups],
  );

  const visibleOpenNoQtyContinuationRows = React.useMemo(() => {
    if (!hasNoQtyContinuationInActionRequired) return [] as OpenNoQtyContinuationRow[];
    return openNoQtyContinuationRows.filter((row) => {
      const flow = noQtyFlowBySo[row.salesOrderId] ?? null;
      const ownerCycleId =
        row.noQtyPlanningPointerAhead &&
        row.planningPointerCycleId != null &&
        Number(row.planningPointerCycleId) > 0
          ? Number(row.planningPointerCycleId)
          : row.cycleId;
      const resolved = resolveNoQtyDashboardContinuation({
        salesOrderId: row.salesOrderId,
        cycleId: ownerCycleId,
        latestRequirementSheetId: row.latestRequirementSheetId,
        lastRsStatus: row.lastRsStatus,
        flow,
        noQtyPlanningPointerAhead: row.noQtyPlanningPointerAhead,
        planningPointerCycleId: row.planningPointerCycleId,
        viewerRole: STORE_ROLE,
        commercialContinuation: true,
      });
      if (!isNoQtyResolvedRelevantForStore(resolved)) return false;
      if (!isNoQtyDashboardPlanningRow(flow, resolved)) return false;
      const hasRs =
        (row.latestRequirementSheetId != null && Number(row.latestRequirementSheetId) > 0) ||
        ["DRAFT", "LOCKED", "CANCELLED"].includes(String(row.lastRsStatus ?? "").trim().toUpperCase()) ||
        Boolean(flow?.requirementExists);
      const label = resolveNoQtyDashboardActionLabel({
        resolved,
        currentCycleNo: row.cycleNo,
        planningPointerCycleNo: row.planningPointerCycleNo,
        noQtyPlanningPointerAhead: row.noQtyPlanningPointerAhead,
        lastRsStatus: row.lastRsStatus,
        hasRs,
      });
      if (shouldHideOpenNoQtyForActionRequired(row.salesOrderId, label, primaryActionBySo)) return false;
      return true;
    });
  }, [
    hasNoQtyContinuationInActionRequired,
    openNoQtyContinuationRows,
    noQtyFlowBySo,
    primaryActionBySo,
  ]);

  const noQtyContinuationTruncated =
    visibleOpenNoQtyContinuationRows.length > DASH_NO_QTY_CONTINUATION_CAP;

  React.useEffect(() => {
    if (import.meta.env.DEV && !demo.enabled) {
      // eslint-disable-next-line no-console
      console.debug("[store-dashboard] continuation derived", {
        openNoQtyContinuationRows: openNoQtyContinuationRows.length,
        visibleOpenNoQtyContinuationRows: visibleOpenNoQtyContinuationRows.length,
        pendingRsRows: storePendingRsActions.length,
        hasNoQtyContinuationInActionRequired,
      });
    }
  }, [
    demo.enabled,
    openNoQtyContinuationRows.length,
    visibleOpenNoQtyContinuationRows.length,
    storePendingRsActions.length,
    hasNoQtyContinuationInActionRequired,
  ]);

  if (demo.enabled) {
    return (
      <StoreDispatchDashboard
        refreshTick={liveTick}
        dispatchReady={[]}
        backlogPreview={[]}
        fgStockTotal={0}
        dispatchBacklogCount={0}
      />
    );
  }

  if (storeInitialLoading) {
    return (
      <div className={DASH_SHELL}>
        <div className={DASH_MAX}>
          <ErpPageLoader variant="dashboard" hint="Loading dashboard…" />
        </div>
      </div>
    );
  }

  const storeDispatchReady: StoreDispatchActionRow[] = actionRequiredGroups.dispatch.map((d) => ({
    key: d.key,
    salesOrderId: d.salesOrderId,
    salesOrderDocNo: d.salesOrderDocNo,
    customerName: d.customerName,
    itemName: d.itemName,
    orderType: d.orderType,
    metricQty: d.metricQty,
    href: d.href,
  }));

  // Backend already filters to dispatchableNow > 0; keep a defensive client filter so
  // zero-headroom / blocked lines never inflate backlog or preview qty.
  const actionableBacklog = filterActionableDispatchBacklogRows(backlog ?? []);

  return (
    <StoreDispatchDashboard
      refreshTick={liveTick}
      refreshing={storeRefreshing || noQtyFlowQuery.refreshing}
      dispatchReady={storeDispatchReady}
      backlogPreview={actionableBacklog}
      fgStockTotal={0}
      dispatchBacklogCount={actionableBacklog.length}
      pendingActions={pendingActionsDeskProps}
      pendingRsActions={storePendingRsActions}
      noQtyContinuationRows={visibleOpenNoQtyContinuationRows}
      noQtyFlowBySo={noQtyFlowBySo}
      noQtyContinuationTruncated={noQtyContinuationTruncated}
      onNoQtyPrimaryAction={({ row, resolved }) => {
        const appendFromDashboard = (to: string) => {
          const sep = to.includes("?") ? "&" : "?";
          return `${to}${sep}fromDashboard=1`;
        };
        if (resolved.kind === "prepare_next_rs") {
          void prepareNoQtyNextRequirementSheetAndNavigate({
            salesOrderId: row.salesOrderId,
            navigate,
            toast,
            navigateState: { from: "dashboard" },
          });
        } else {
          navigate(appendFromDashboard(resolved.to), { state: { from: "dashboard" } });
        }
      }}
    />
  );
}
