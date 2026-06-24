import * as React from "react";
import { apiFetch } from "../services/api";
import type { ProcurementPendingRow } from "../components/erp/ProcurementPendingDashboardCard";
import type { MaterialAvailabilitySummaryLike } from "../lib/storeDashboardMetrics";
import type { StoreProcurementWorkspaceLike } from "../lib/storeProcurementPulse";
import { useNoQtyPlannerInbox } from "./useNoQtyPlannerInbox";

type MaterialAvailabilityWorkspaceResponse = {
  summary?: MaterialAvailabilitySummaryLike;
};

export function useStoreDashboardOperationalData(refreshKey = 0) {
  const inbox = useNoQtyPlannerInbox(refreshKey);
  const [materialIssuePendingCount, setMaterialIssuePendingCount] = React.useState(0);
  const [rmccSummary, setRmccSummary] = React.useState<MaterialAvailabilitySummaryLike | null>(null);
  const [procurementWorkspace, setProcurementWorkspace] = React.useState<StoreProcurementWorkspaceLike | null>(
    null,
  );
  const [operationalLoading, setOperationalLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setOperationalLoading(true);

    void (async () => {
      try {
        const [procPending, rmcc, procurement] = await Promise.all([
          apiFetch<{ storeIssuePending?: ProcurementPendingRow[] }>("/api/dashboard/procurement-pending").catch(
            () => ({ storeIssuePending: [] }),
          ),
          apiFetch<MaterialAvailabilityWorkspaceResponse>("/api/material-availability/workspace").catch(() => ({
            summary: null,
          })),
          apiFetch<StoreProcurementWorkspaceLike>("/api/procurement-planning/workspace").catch(() => null),
        ]);

        if (cancelled) return;
        setMaterialIssuePendingCount(
          Array.isArray(procPending.storeIssuePending) ? procPending.storeIssuePending.length : 0,
        );
        setRmccSummary(rmcc.summary ?? null);
        setProcurementWorkspace(procurement);
      } finally {
        if (!cancelled) setOperationalLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const loading = inbox.loading || operationalLoading;

  return {
    inboxRows: inbox.rows,
    inboxError: inbox.error,
    materialIssuePendingCount,
    rmccSummary,
    procurementWorkspace,
    loading,
  };
}
