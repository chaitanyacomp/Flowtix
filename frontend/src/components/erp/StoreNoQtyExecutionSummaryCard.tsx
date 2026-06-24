import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import type { NoQtyExecutionSummaryMetrics } from "../../lib/storeDashboardMetrics";
import { NO_QTY_AGREEMENTS_HREF } from "../../lib/noQtyStoreNavigation";
import { navContextNoQtyExecutionRegister, navStateWithNavContext } from "../../lib/erpNavContext";

function SummaryMetric({
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
          ? "border-amber-200/90 bg-amber-50/50"
          : "border-slate-200/90 bg-white",
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span
        className={cn(
          "text-xl font-extrabold tabular-nums leading-none",
          value > 0 && tone === "warn" ? "text-amber-950" : value > 0 ? "text-slate-950" : "text-slate-400",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export type StoreNoQtyExecutionSummaryCardProps = {
  metrics: NoQtyExecutionSummaryMetrics;
  loading?: boolean;
};

export function StoreNoQtyExecutionSummaryCard({ metrics, loading }: StoreNoQtyExecutionSummaryCardProps) {
  const registerHref = `${NO_QTY_AGREEMENTS_HREF}?source=dashboard`;

  return (
    <Card
      className="border-blue-200/80 bg-gradient-to-b from-blue-50/25 to-white shadow-sm ring-1 ring-blue-100/50"
      data-testid="store-no-qty-execution-summary"
    >
      <CardHeader className="border-b border-blue-100/80 py-2 pb-1.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-[13px] font-extrabold text-slate-950">
              <ClipboardList className="h-4 w-4 text-blue-700" aria-hidden />
              NO_QTY Execution
            </CardTitle>
            <p className="text-[11px] font-normal text-slate-600">
              Execution register summary — open the register for full queue and workspace handoff.
            </p>
          </div>
          <Link
            to={registerHref}
            state={navStateWithNavContext(navContextNoQtyExecutionRegister("dashboard"))}
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-7 px-2.5 text-[10px] no-underline")}
            data-testid="store-open-execution-register"
          >
            Open Execution Register
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-2.5 pt-2">
        {loading ? (
          <p className="text-xs text-slate-600">Loading execution summary…</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <SummaryMetric label="Ready for WO" value={metrics.readyForWo} tone="warn" />
            <SummaryMetric label="Open WOs" value={metrics.openWos} />
            <SummaryMetric label="Await procurement" value={metrics.awaitProcurement} tone="warn" />
            <SummaryMetric label="RS balance pending" value={metrics.rsBalancePending} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
