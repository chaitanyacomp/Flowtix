import * as React from "react";
import { ApiRequestError, apiFetch } from "../services/api";
import type { NoQtyDashboardCycleHistoryPayload } from "../lib/noQtyDashboardCycleHistory";

export function useNoQtyCycleHistory(salesOrderId: number | null | undefined, refreshKey = 0) {
  const [payload, setPayload] = React.useState<NoQtyDashboardCycleHistoryPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const sid = Number(salesOrderId);
    if (!Number.isFinite(sid) || sid <= 0) {
      setPayload(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void apiFetch<NoQtyDashboardCycleHistoryPayload>(
      `/api/dashboard/no-qty-cycle-history?soId=${encodeURIComponent(String(sid))}`,
    )
      .then((data) => {
        if (!cancelled) setPayload(data ?? null);
      })
      .catch((e) => {
        if (!cancelled) {
          const backendDetail =
            e instanceof ApiRequestError &&
            e.message === "Dashboard failed" &&
            typeof e.body?.error === "string" &&
            e.body.error.trim()
              ? e.body.error.trim()
              : null;
          setError(backendDetail ?? (e instanceof Error ? e.message : "Failed to load cycle history"));
          setPayload(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [salesOrderId, refreshKey]);

  return { payload, loading, error };
}
