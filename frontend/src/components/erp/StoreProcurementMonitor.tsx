import { Link } from "react-router-dom";
import { PackageSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";
import { purchaseGrnExecutionHref } from "../../lib/woPrepareOperationalStage";
import type { StoreProcurementMonitorMetrics } from "../../lib/storeDashboardMetrics";

function MonitorMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={cn(
        "flex min-w-[7.5rem] flex-1 flex-col gap-0.5 rounded-md border px-2.5 py-2",
        tone === "warn" && value > 0
          ? "border-amber-200/90 bg-amber-50/40"
          : "border-slate-200/90 bg-slate-50/70",
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span
        className={cn(
          "text-lg font-extrabold tabular-nums leading-none",
          value > 0 && tone === "warn" ? "text-amber-950" : value > 0 ? "text-slate-950" : "text-slate-400",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export type StoreProcurementMonitorProps = {
  metrics: StoreProcurementMonitorMetrics;
  loading?: boolean;
};

export function StoreProcurementMonitor({ metrics, loading }: StoreProcurementMonitorProps) {
  const workspaceHref = "/procurement-planning?returnTo=dashboard";
  const grnHref = purchaseGrnExecutionHref({ source: "dashboard" });

  return (
    <Card
      className="border-slate-200/90 bg-slate-50/40 shadow-sm"
      data-testid="store-procurement-monitor"
    >
      <CardHeader className="border-b border-slate-200/80 py-2 pb-1.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-[13px] font-extrabold text-slate-950">
              <PackageSearch className="h-4 w-4 text-slate-600" aria-hidden />
              {PROCUREMENT_TERMS.STORE_MONITOR_TITLE}
            </CardTitle>
            <p className="text-[11px] font-normal text-slate-600">{PROCUREMENT_TERMS.STORE_MONITOR_SUBTITLE}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              to={workspaceHref}
              state={{ from: "dashboard" }}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-7 px-2 text-[10px] no-underline",
              )}
            >
              {PROCUREMENT_TERMS.OPEN_PROCUREMENT_WORKSPACE}
            </Link>
            <Link
              to={grnHref}
              state={{ from: "dashboard" }}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-7 px-2 text-[10px] no-underline",
              )}
            >
              {PROCUREMENT_TERMS.OPEN_GRN}
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-2.5 pt-2">
        {loading ? (
          <p className="text-xs text-slate-600">{PROCUREMENT_TERMS.LOADING_PROCUREMENT}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <MonitorMetric label="Await procurement" value={metrics.awaitProcurement} tone="warn" />
            <MonitorMetric label="GRN pending" value={metrics.grnPending} tone="warn" />
            <MonitorMetric label="Blocked cases" value={metrics.blockedProcurementCases} tone="warn" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
