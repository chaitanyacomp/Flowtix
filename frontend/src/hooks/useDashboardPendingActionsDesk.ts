import * as React from "react";
import { useDemoMode } from "../contexts/DemoModeContext";
import {
  isStoreOwnedNoQtyRsPendingAction,
  fetchPendingActions,
  type PendingAction,
  type PendingActionsDashboardProps,
} from "../lib/pendingActionsApi";
import { countStoreDashboardActionablePendingActions } from "../lib/storeDashboardPresentation";
import { useAuth } from "./useAuth";
import { useErpCachedQuery } from "./useErpCachedQuery";
import { useRouteActive } from "./useRouteActive";
import { useErpRefreshTick } from "./useErpRefreshTick";
import { ERP_DASHBOARD_POLL_MS } from "./useErpRefreshTick";

const DASHBOARD_ROUTE = "/dashboard";

export function useDashboardPendingActionsDesk(options?: {
  filterStorePendingRs?: boolean;
  fetchDelayMs?: number;
}): {
  deskProps: PendingActionsDashboardProps | undefined;
  storePendingRsActions: PendingAction[];
  initialLoading: boolean;
  refreshing: boolean;
} {
  const auth = useAuth();
  const role = String(auth.user?.role ?? "").trim().toUpperCase();
  const demo = useDemoMode();
  const isDashboardRoute = useRouteActive(DASHBOARD_ROUTE);
  const liveTick = useErpRefreshTick(["dashboard", "pending-actions"], {
    pollIntervalMs: ERP_DASHBOARD_POLL_MS,
    enabled: isDashboardRoute,
  });

  const [delayTick, setDelayTick] = React.useState(0);
  React.useEffect(() => {
    if (!isDashboardRoute || demo.enabled) return;
    const ms = options?.fetchDelayMs ?? 150;
    if (ms <= 0) {
      setDelayTick((t) => t + 1);
      return;
    }
    const timer = setTimeout(() => setDelayTick((t) => t + 1), ms);
    return () => clearTimeout(timer);
  }, [isDashboardRoute, demo.enabled, liveTick, options?.fetchDelayMs]);

  const query = useErpCachedQuery({
    role,
    route: DASHBOARD_ROUTE,
    queryKey: options?.filterStorePendingRs ? "pending-actions-store-rs" : "pending-actions-desk",
    apiPath: "/api/pending-actions",
    enabled: isDashboardRoute && !demo.enabled,
    refreshTick: delayTick + liveTick,
    fetcher: fetchPendingActions,
  });

  const payload = query.data;
  const actionsList = payload?.actions;
  const count = React.useMemo(() => {
    const list = actionsList ?? [];
    if (role === "STORE") {
      return countStoreDashboardActionablePendingActions(list);
    }
    return Number(payload?.count ?? list.length ?? 0);
  }, [role, payload?.count, actionsList]);
  const storePendingRsActions = React.useMemo(() => {
    if (!options?.filterStorePendingRs) return [] as PendingAction[];
    return (actionsList ?? []).filter((a) => isStoreOwnedNoQtyRsPendingAction(a));
  }, [options?.filterStorePendingRs, actionsList]);

  const deskProps: PendingActionsDashboardProps | undefined = !demo.enabled
    ? {
        count,
        loading: query.initialLoading,
        refreshing: query.refreshing,
        error: query.error,
        actions: actionsList ?? [],
      }
    : undefined;

  return {
    deskProps,
    storePendingRsActions,
    initialLoading: query.initialLoading,
    refreshing: query.refreshing,
  };
}
