import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/utils";
import { buttonVariants } from "../ui/button";
import type { DashboardProductionStatusSource } from "../../lib/dashboardProductionStatus";
import {
  liveFactoryMonitorHref,
  pickLiveFactoryHighlights,
  summarizeLiveFactoryCounters,
  type LiveFactoryBucket,
} from "../../lib/liveFactoryStatus";
import { formatQuantityWithUnit } from "../../lib/quantityDisplay";

type Props = {
  prodQueue: DashboardProductionStatusSource[] | null;
  className?: string;
};

function statusToneClass(status: LiveFactoryBucket): string {
  switch (status) {
    case "RUNNING":
      return "text-emerald-800";
    case "PAUSED":
      return "text-amber-900";
    case "BLOCKED":
      return "text-rose-800";
    case "AWAITING_REPORT":
      return "text-violet-800";
    case "PENDING_QC":
      return "text-orange-800";
    case "READY_TO_START":
      return "text-sky-900";
    default:
      return "text-slate-800";
  }
}

function formatLastActivity(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Admin Dashboard — compact read-only Live Factory Status.
 * Does not expose Production mutation actions.
 */
export function AdminLiveFactoryStatus({ prodQueue, className }: Props) {
  const counters = React.useMemo(() => summarizeLiveFactoryCounters(prodQueue), [prodQueue]);
  const highlights = React.useMemo(() => pickLiveFactoryHighlights(prodQueue, 5), [prodQueue]);
  const monitorHref = liveFactoryMonitorHref();

  const counterItems: Array<{ key: LiveFactoryBucket; label: string; value: number }> = [
    { key: "READY_TO_START", label: "Ready to Start", value: counters.readyToStart },
    { key: "RUNNING", label: "Running", value: counters.running },
    { key: "PAUSED", label: "Paused", value: counters.paused },
    { key: "BLOCKED", label: "Blocked", value: counters.blocked },
    { key: "AWAITING_REPORT", label: "Awaiting Production Report", value: counters.awaitingReport },
    { key: "PENDING_QC", label: "Pending QC", value: counters.pendingQc },
  ];

  return (
    <section
      aria-label="Live Factory Status"
      className={cn("overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm", className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div>
          <h2 className="text-[13px] font-bold text-slate-900">Live Factory Status</h2>
          <p className="text-[12px] text-slate-600">Read-only · same classification as Control Tower</p>
        </div>
        <Link
          to={monitorHref}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-8 text-[12px]")}
        >
          View Full Factory Monitor
        </Link>
      </header>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
        {counterItems.map((c) => (
          <div key={c.key}>
            <dt className="text-slate-500">{c.label}</dt>
            <dd className={cn("text-[18px] font-semibold tabular-nums", statusToneClass(c.key))}>{c.value}</dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-slate-100 px-3 py-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Operational highlights</h3>
        {highlights.length === 0 ? (
          <p className="mt-1 text-[13px] text-slate-600">No active work orders in factory queues.</p>
        ) : (
          <ul className="mt-1 divide-y divide-slate-100">
            {highlights.map((row) => (
              <li key={row.workOrderId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">
                    {row.workOrderNo}
                    <span className="font-normal text-slate-600"> · {row.product}</span>
                  </p>
                  <p className="tabular-nums text-slate-600">
                    {formatQuantityWithUnit(row.plannedQty, row.unit)} /{" "}
                    {formatQuantityWithUnit(row.producedQty, row.unit)} /{" "}
                    {formatQuantityWithUnit(row.remainingQty, row.unit)}
                    <span className="text-slate-400"> · planned / produced / remaining</span>
                  </p>
                  {row.blockerReason ? (
                    <p className="truncate text-[12px] text-rose-800">{row.blockerReason}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn("font-semibold", statusToneClass(row.status))}>{row.statusLabel}</p>
                  <p className="text-[11px] text-slate-500">{formatLastActivity(row.lastActivity)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
