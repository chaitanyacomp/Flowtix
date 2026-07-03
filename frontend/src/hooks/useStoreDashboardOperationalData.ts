import * as React from "react";
import { useRouteActive } from "./useRouteActive";
import { useErpCachedQuery } from "./useErpCachedQuery";
import { apiFetch } from "../services/api";
import type { ProcurementPendingRow } from "../components/erp/ProcurementPendingDashboardCard";
import type { MaterialAvailabilitySummaryLike } from "../lib/storeDashboardMetrics";
import type { StoreProcurementWorkspaceLike } from "../lib/storeProcurementPulse";
import { useNoQtyPlannerInbox } from "./useNoQtyPlannerInbox";

const STORE_ROLE = "STORE";
const DASHBOARD_ROUTE = "/dashboard";

export type StoreOperationalMetrics = {
  materialIssuePendingCount: number;
  rmccSummary: MaterialAvailabilitySummaryLike | null;
  procurementWorkspace: StoreProcurementWorkspaceLike | null;
};

type Options = {
  enabled?: boolean;
  role?: string;
  refreshTick?: number;
};

export function useStoreDashboardOperationalData(refreshKey = 0, opts: Options = {}) {
  const isDashboardRoute = useRouteActive(DASHBOARD_ROUTE);
  const enabled = opts.enabled !== false && isDashboardRoute;
  const role = opts.role ?? STORE_ROLE;

  const inbox = useNoQtyPlannerInbox(refreshKey, { enabled, role, route: DASHBOARD_ROUTE });

  const operationalQuery = useErpCachedQuery<StoreOperationalMetrics>({
    role,
    route: DASHBOARD_ROUTE,
    queryKey: "store-operational-metrics",
    apiPath: "/api/dashboard/store-operational-metrics",
    enabled,
    refreshTick: refreshKey,
    fetcher: async () => {
      const [procPending, rmcc, procurement] = await Promise.all([
        apiFetch<{ storeIssuePending?: ProcurementPendingRow[] }>("/api/dashboard/procurement-pending").catch(
          () => ({ storeIssuePending: [] }),
        ),
        apiFetch<{ summary?: MaterialAvailabilitySummaryLike | null }>(
          "/api/material-availability/workspace",
        ).catch(() => ({
          summary: null,
        })),
        apiFetch<StoreProcurementWorkspaceLike>("/api/procurement-planning/workspace").catch(() => null),
      ]);
      return {
        materialIssuePendingCount: Array.isArray(procPending.storeIssuePending)
          ? procPending.storeIssuePending.length
          : 0,
        rmccSummary: rmcc.summary ?? null,
        procurementWorkspace: procurement,
      };
    },
  });

  const metrics = operationalQuery.data;
  const initialLoading = inbox.initialLoading || operationalQuery.initialLoading;
  const refreshing = inbox.refreshing || operationalQuery.refreshing;
  const loading = enabled && (inbox.loading || operationalQuery.busy);

  return {
    inboxRows: inbox.rows,
    inboxError: inbox.error,
    materialIssuePendingCount: metrics?.materialIssuePendingCount ?? 0,
    rmccSummary: metrics?.rmccSummary ?? null,
    procurementWorkspace: metrics?.procurementWorkspace ?? null,
    loading,
    initialLoading,
    refreshing,
    firstLoadDone: inbox.firstLoadDone && operationalQuery.firstLoadDone,
  };
}
