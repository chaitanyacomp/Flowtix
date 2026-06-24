import { Link } from "react-router-dom";
import { PackageSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";
import { rmControlCenterHref } from "../../lib/materialWorkflowLinks";
import { navContextRmControlCenterFromDashboard, navStateWithNavContext } from "../../lib/erpNavContext";
import type { StoreRmccSummaryMetrics } from "../../lib/storeDashboardMetrics";

function SummaryMetric({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: number;
  href: string;
  tone?: "default" | "warn";
}) {
  return (
    <Link
      to={href}
      state={{ from: "dashboard" }}
      className={cn(
        "flex min-w-[7.5rem] flex-1 flex-col gap-0.5 rounded-md border px-2.5 py-2 no-underline transition hover:border-slate-300 hover:shadow-sm",
        tone === "warn" && value > 0
          ? "border-violet-200/90 bg-violet-50/40"
          : "border-slate-200/90 bg-white",
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span
        className={cn(
          "text-xl font-extrabold tabular-nums leading-none",
          value > 0 && tone === "warn" ? "text-violet-950" : value > 0 ? "text-slate-950" : "text-slate-400",
        )}
      >
        {value}
      </span>
    </Link>
  );
}

export type StoreRmccSummaryCardProps = {
  metrics: StoreRmccSummaryMetrics;
  loading?: boolean;
};

export function StoreRmccSummaryCard({ metrics, loading }: StoreRmccSummaryCardProps) {
  const rmccHref = rmControlCenterHref({ returnTo: "dashboard" });
  const issueReadyHref = rmControlCenterHref({ onlyBlocked: true, returnTo: "dashboard" });

  return (
    <Card
      className="border-violet-200/80 bg-gradient-to-b from-violet-50/25 to-white shadow-sm ring-1 ring-violet-100/50"
      data-testid="store-rmcc-summary"
    >
      <CardHeader className="border-b border-violet-100/80 py-2 pb-1.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-[13px] font-extrabold text-slate-950">
              <PackageSearch className="h-4 w-4 text-violet-700" aria-hidden />
              {PROCUREMENT_TERMS.RM_CONTROL_CENTER_TITLE}
            </CardTitle>
            <p className="text-[11px] font-normal text-slate-600">
              Post–WO placement RM cases — issue RM from the control center queue.
            </p>
          </div>
          <Link
            to={rmccHref}
            state={navStateWithNavContext(navContextRmControlCenterFromDashboard())}
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-7 px-2.5 text-[10px] no-underline")}
            data-testid="store-open-rmcc"
          >
            {PROCUREMENT_TERMS.OPEN_RM_CONTROL_CENTER}
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-2.5 pt-2">
        {loading ? (
          <p className="text-xs text-slate-600">Loading RM Control Center summary…</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <SummaryMetric label="Open RMCC cases" value={metrics.openCases} href={rmccHref} tone="warn" />
            <SummaryMetric
              label="Issue-ready WOs"
              value={metrics.issueReadyWos}
              href={issueReadyHref}
              tone="warn"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
