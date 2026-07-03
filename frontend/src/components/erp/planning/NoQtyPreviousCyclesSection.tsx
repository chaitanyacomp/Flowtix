import * as React from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../ui/badge";
import { buttonVariants } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { buildNoQtyGuidedHref } from "../../../lib/noQtyFlowState";
import {
  formatNoQtyDashboardHistoryQty,
  isNoQtyHistoryCurrentCycleRow,
  type NoQtyDashboardCycleHistoryPayload,
  type NoQtyDashboardCycleHistoryRow,
} from "../../../lib/noQtyDashboardCycleHistory";
import { useNoQtyCycleHistory } from "../../../hooks/useNoQtyCycleHistory";

function historyStatusVariant(status: string): "success" | "warning" | "default" | "info" {
  const u = String(status).toUpperCase();
  if (u === "COMPLETED" || u === "CLOSED") return "success";
  if (u === "IN PROCESS" || u === "PLANNING PENDING") return "warning";
  if (u === "DRAFT") return "info";
  return "default";
}

function PreviousCycleCard({
  row,
  salesOrderId,
}: {
  row: NoQtyDashboardCycleHistoryRow;
  salesOrderId: number;
}) {
  const viewHref = buildNoQtyGuidedHref({
    to: `/sales-orders/${salesOrderId}/requirement-sheets`,
    salesOrderId,
    cycleId: row.cycleId,
    fromStep: "requirement",
  });
  const woCreated = Number(row.producedQty) > 1e-6;
  const completed = ["COMPLETED", "CLOSED"].includes(String(row.statusLabel).toUpperCase());

  return (
    <article
      className="rounded-md border border-slate-200 bg-white px-2.5 py-2"
      data-testid={`cycle-history-card-${row.cycleNo}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-bold tabular-nums text-violet-950">Cycle {row.cycleNo}</span>
            <Badge variant={historyStatusVariant(row.statusLabel)} className="text-[10px]">
              {row.statusLabel}
            </Badge>
          </div>
          <dl className="grid gap-0.5 text-[11px] text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">RS</dt>
              <dd className="truncate font-medium text-slate-900" title={row.rsLabel}>
                {row.rsLabel}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Planned qty</dt>
              <dd className="font-semibold tabular-nums">{formatNoQtyDashboardHistoryQty(row.plannedQty)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">WO</dt>
              <dd className="font-medium">{woCreated ? "Created" : "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cycle outcome</dt>
              <dd className="font-medium">{completed ? "Completed" : row.statusLabel}</dd>
            </div>
          </dl>
        </div>
        <Link
          to={viewHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 shrink-0 text-[11px]")}
          data-testid={`cycle-history-view-${row.cycleNo}`}
        >
          View Details
        </Link>
      </div>
    </article>
  );
}

export function NoQtyPreviousCyclesSection({
  salesOrderId,
  className,
}: {
  salesOrderId: number;
  className?: string;
}) {
  const { payload, loading, error } = useNoQtyCycleHistory(salesOrderId);

  const previousRows = React.useMemo(() => {
    if (!payload?.rows?.length) return [];
    return payload.rows.filter((row) => !isNoQtyHistoryCurrentCycleRow(row, payload));
  }, [payload]);

  if (loading) {
    return (
      <section className={cn("space-y-1", className)} data-testid="cycle-history-section">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Previous cycles</h3>
        <p className="text-[11px] text-slate-600">Loading cycle history…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className={cn("space-y-1", className)} data-testid="cycle-history-section">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Previous cycles</h3>
        <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">{error}</p>
      </section>
    );
  }

  if (previousRows.length === 0) {
    return null;
  }

  return (
    <section className={cn("space-y-1.5", className)} data-testid="cycle-history-section">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Previous cycles</h3>
      <p className="text-[10px] leading-snug text-slate-500">
        Historical cycles are view-only. Open details to review locked requirement sheets.
      </p>
      <div className="space-y-1.5">
        {previousRows.map((row) => (
          <PreviousCycleCard key={`prev-cycle-${row.cycleId}`} row={row} salesOrderId={salesOrderId} />
        ))}
      </div>
    </section>
  );
}

export type { NoQtyDashboardCycleHistoryPayload };
