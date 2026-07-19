import * as React from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../../services/api";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../foundation";
import type { DashboardProductionStatusSource } from "../../../lib/dashboardProductionStatus";
import {
  buildProductionWorkspaceStatusCounts,
  PRODUCTION_STATUS_CARD_LABELS,
  type ProductionWorkspaceStatusBucket,
} from "../../../lib/productionWorkspaceStatusCards";
import { isQueueReadyToStart } from "../../../lib/productionWorkspaceReadinessUx";
import { productionHrefFromDashboardRow } from "../../../lib/operationalWorkspaceLinks";
import { useErpRefreshTick } from "../../../hooks/useErpRefreshTick";
import { cn } from "../../../lib/utils";

type RmReturnPendingRow = {
  id: number;
  workOrderId: number;
  workOrderNo: string;
};

function firstRowForBucket(
  rows: DashboardProductionStatusSource[],
  bucket: ProductionWorkspaceStatusBucket,
): DashboardProductionStatusSource | null {
  for (const row of rows) {
    const woId = Number(row.workOrderId ?? 0);
    if (!(woId > 0)) continue;
    if (
      bucket === "pendingQa" &&
      (row.nextAction === "QC_PENDING" ||
        (row.hasPendingQc && String(row.productionExecutionStatus ?? "").toUpperCase() === "COMPLETED"))
    ) {
      return row;
    }
    if (
      bucket === "shortfallDecision" &&
      (row.nextAction === "PRODUCTION_SHORTFALL_DECISION" ||
        String(row.productionExecutionStatus ?? "").toUpperCase() === "SHORTFALL_PENDING")
    ) {
      return row;
    }
    if (bucket === "readyToStart" && isQueueReadyToStart(row)) {
      return row;
    }
  }
  return null;
}

export function ProductionWorkspaceStatusStrip({ className }: { className?: string }) {
  const navigate = useNavigate();
  const liveTick = useErpRefreshTick(["production", "dashboard"], { pollIntervalMs: 0 });
  const [queueRows, setQueueRows] = React.useState<DashboardProductionStatusSource[]>([]);
  const [rmPending, setRmPending] = React.useState<RmReturnPendingRow[]>([]);

  React.useEffect(() => {
    let mounted = true;
    void Promise.all([
      apiFetch<DashboardProductionStatusSource[]>("/api/dashboard/production-queue"),
      apiFetch<RmReturnPendingRow[]>("/api/production-material-returns/pending?status=PENDING"),
    ])
      .then(([queue, pending]) => {
        if (!mounted) return;
        setQueueRows(Array.isArray(queue) ? queue : []);
        setRmPending(Array.isArray(pending) ? pending : []);
      })
      .catch(() => {
        if (!mounted) {
          setQueueRows([]);
          setRmPending([]);
        }
      });
    return () => {
      mounted = false;
    };
  }, [liveTick]);

  const counts = React.useMemo(
    () => buildProductionWorkspaceStatusCounts(queueRows, rmPending),
    [queueRows, rmPending],
  );

  const buckets: ProductionWorkspaceStatusBucket[] = [
    "readyToStart",
    "shortfallDecision",
    "pendingQa",
  ];

  function openBucket(bucket: ProductionWorkspaceStatusBucket) {
    const row = firstRowForBucket(queueRows, bucket);
    if (row) navigate(productionHrefFromDashboardRow(row));
  }

  const total = buckets.reduce((sum, key) => sum + counts[key], 0);
  if (total <= 0) return null;

  return (
    <ErpKpiStrip className={cn("mb-2", className)}>
      {buckets.map((bucket) => (
        <ErpKpiSegment key={bucket}>
          <button
            type="button"
            className="text-left disabled:opacity-50"
            disabled={counts[bucket] <= 0}
            onClick={() => openBucket(bucket)}
          >
            <ErpKpiLabel>{PRODUCTION_STATUS_CARD_LABELS[bucket]}</ErpKpiLabel>
            <ErpKpiValue className={counts[bucket] > 0 ? "text-slate-900" : "text-slate-400"}>
              {counts[bucket]}
            </ErpKpiValue>
          </button>
        </ErpKpiSegment>
      ))}
    </ErpKpiStrip>
  );
}
