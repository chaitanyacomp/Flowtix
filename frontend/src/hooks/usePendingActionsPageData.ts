import { useAuth } from "./useAuth";
import { useErpCachedQuery } from "./useErpCachedQuery";
import { useErpRefreshTick } from "./useErpRefreshTick";
import { useRouteActive } from "./useRouteActive";
import { fetchPendingActions, type PendingAction } from "../lib/pendingActionsApi";

const PENDING_ACTIONS_POLL_MS = 60_000;
const PENDING_ACTIONS_ROUTE = "/pending-actions";

/**
 * Pending Actions page data — isolated from dashboard refresh scopes.
 * Stale-while-revalidate: cached buckets render immediately on return visits.
 */
export function usePendingActionsPageData() {
  const auth = useAuth();
  const role = String(auth.user?.role ?? "").trim().toUpperCase();
  const isActive = useRouteActive(PENDING_ACTIONS_ROUTE);
  const liveTick = useErpRefreshTick(["pending-actions"], {
    pollIntervalMs: PENDING_ACTIONS_POLL_MS,
    enabled: isActive,
  });

  const query = useErpCachedQuery({
    role,
    route: PENDING_ACTIONS_ROUTE,
    queryKey: "list",
    apiPath: "/api/pending-actions",
    enabled: isActive,
    refreshTick: liveTick,
    fetcher: fetchPendingActions,
  });

  const payload = query.data;
  const count = Number(payload?.count ?? payload?.actions?.length ?? 0);
  const actions: PendingAction[] = Array.isArray(payload?.actions) ? payload.actions : [];

  return {
    isActive,
    firstLoadDone: query.firstLoadDone,
    initialLoading: query.initialLoading,
    refreshing: query.refreshing,
    error: query.error,
    count,
    actions,
  };
}
