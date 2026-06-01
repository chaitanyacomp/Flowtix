import { Link } from "react-router-dom";
import { AlertTriangle, Clock3, Package, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { buildRmControlCenterHref } from "../../lib/woProcurementContinuity";
import { GUIDED_WORKFLOW_CTA } from "../../lib/rmGuidedWorkflow";
import type { ProcurementPendingRow } from "./ProcurementPendingDashboardCard";

type RmRiskLike = {
  workOrderId?: number | null;
  blockerReason?: string | null;
  recommendedAction?: string | null;
};

type Props = {
  rmRisk: RmRiskLike[] | null;
  procurementPending: ProcurementPendingRow[] | null;
  loading?: boolean;
};

function uniqueWoIds(rows: RmRiskLike[]): number[] {
  const ids = new Set<number>();
  for (const r of rows) {
    const id = Number(r.workOrderId ?? 0);
    if (id > 0) ids.add(id);
  }
  return [...ids];
}

function SummaryTile({
  label,
  count,
  href,
  tone = "default",
  icon,
}: {
  label: string;
  count: number;
  href: string;
  tone?: "default" | "warn" | "info";
  icon: React.ReactNode;
}) {
  const border =
    tone === "warn"
      ? "border-amber-200/90 bg-amber-50/40"
      : tone === "info"
        ? "border-blue-200/90 bg-blue-50/40"
        : "border-slate-200/90 bg-white";
  return (
    <Link
      to={href}
      state={{ from: "dashboard" }}
      className={cn(
        "flex min-w-[9rem] flex-1 items-center justify-between gap-2 rounded-md border px-2.5 py-2 no-underline transition hover:border-slate-300 hover:shadow-sm",
        border,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0 text-slate-500">{icon}</span>
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-slate-800">{label}</div>
          <div
            className={cn(
              "text-xl font-extrabold tabular-nums",
              count > 0 && tone === "warn" && "text-amber-950",
              count > 0 && tone === "info" && "text-blue-950",
              count === 0 && "text-slate-400",
            )}
          >
            {count}
          </div>
        </div>
      </div>
      <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 shrink-0 px-2 text-[10px]")}>
        View
      </span>
    </Link>
  );
}

export function StoreRmOperationalSummary({ rmRisk, procurementPending, loading }: Props) {
  const risk = rmRisk ?? [];
  const proc = procurementPending ?? [];

  const blockedWoIds = uniqueWoIds(risk);
  const waitingIssueRows = risk.filter(
    (r) =>
      String(r.blockerReason ?? "").toLowerCase().includes("issue") ||
      String(r.recommendedAction ?? "").toLowerCase().includes("issue"),
  );
  const waitingIssueWoIds = uniqueWoIds(waitingIssueRows);

  const procurementActive = proc.filter((r) =>
    ["PROCUREMENT_PENDING", "PR_PENDING_PO", "SUPPLIER_PENDING"].includes(String(r.operationalKey ?? "")),
  ).length;
  const waitingGrn = proc.filter(
    (r) => Number(r.pendingGrnQty ?? 0) > 0 || String(r.operationalKey ?? "") === "GRN_PENDING",
  ).length;

  const firstBlockedWo = risk.find((r) => Number(r.workOrderId ?? 0) > 0);
  const firstIssueWo = waitingIssueRows.find((r) => Number(r.workOrderId ?? 0) > 0);
  const firstProc = proc.find((r) => Number(r.workOrderId ?? 0) > 0 || Number(r.materialRequirementId ?? 0) > 0);
  const firstGrn = proc.find((r) => Number(r.pendingGrnQty ?? 0) > 0 && Number(r.workOrderId ?? 0) > 0);
  const rmHref =
    firstBlockedWo?.workOrderId && firstBlockedWo.workOrderId > 0
      ? buildRmControlCenterHref({ workOrderId: firstBlockedWo.workOrderId, returnTo: "dashboard" })
      : "/reports/rm-shortage?returnTo=dashboard&onlyBlocked=true";
  const issueHref =
    firstIssueWo?.workOrderId && firstIssueWo.workOrderId > 0
      ? buildRmControlCenterHref({ workOrderId: firstIssueWo.workOrderId, returnTo: "dashboard" })
      : "/reports/rm-shortage?returnTo=dashboard";
  const procHref =
    firstProc
      ? buildRmControlCenterHref({
          workOrderId: firstProc.workOrderId ?? undefined,
          salesOrderId: firstProc.salesOrderId ?? undefined,
          materialRequirementId: firstProc.materialRequirementId,
          returnTo: "dashboard",
        })
      : "/reports/rm-shortage?returnTo=dashboard";
  const grnHref =
    firstGrn?.workOrderId && firstGrn.workOrderId > 0
      ? buildRmControlCenterHref({ workOrderId: firstGrn.workOrderId, salesOrderId: firstGrn.salesOrderId, returnTo: "dashboard" })
      : procHref;
  const continueHref =
    blockedWoIds.length > 0
      ? rmHref
      : waitingIssueWoIds.length > 0
        ? issueHref
        : waitingGrn > 0
          ? grnHref
          : procurementActive > 0
            ? procHref
            : rmHref;

  if (loading) {
    return (
      <Card className="border-slate-200/90 shadow-sm">
        <CardContent className="py-3 text-sm text-slate-600">Loading RM operations…</CardContent>
      </Card>
    );
  }

  const allQuiet =
    blockedWoIds.length === 0 && waitingIssueWoIds.length === 0 && procurementActive === 0 && waitingGrn === 0;

  return (
    <Card className="border-violet-200/80 bg-gradient-to-b from-violet-50/25 to-white shadow-sm ring-1 ring-violet-100/50">
      <CardHeader className="border-b border-violet-100/80 py-2 pb-1.5">
        <CardTitle className="flex items-center gap-2 text-[13px] font-extrabold text-slate-950">
          <Package className="h-4 w-4 text-violet-700" aria-hidden />
          RM operations
        </CardTitle>
        <p className="text-[11px] font-normal text-slate-600">
          Work-order material blockers and procurement — use RM Control Center for the guided next step.
        </p>
      </CardHeader>
      <CardContent className="p-2.5 pt-2">
        {allQuiet ? (
          <p className="text-xs text-slate-600">No RM allocation / issue blockers on the desk right now.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <SummaryTile
              label="Blocked WOs"
              count={blockedWoIds.length}
              href={rmHref}
              tone={blockedWoIds.length > 0 ? "warn" : "default"}
              icon={<AlertTriangle className="h-4 w-4 text-amber-700" />}
            />
            <SummaryTile
              label="Waiting issue"
              count={waitingIssueWoIds.length}
              href={issueHref}
              tone={waitingIssueWoIds.length > 0 ? "warn" : "default"}
              icon={<Truck className="h-4 w-4 text-amber-700" />}
            />
            <SummaryTile
              label="RM incoming"
              count={procurementActive}
              href={procHref}
              tone={procurementActive > 0 ? "info" : "default"}
              icon={<Package className="h-4 w-4 text-violet-700" />}
            />
            <SummaryTile
              label="Incoming GRN"
              count={waitingGrn}
              href={waitingGrn > 0 && proc[0]?.workOrderId ? grnHref : procHref}
              tone={waitingGrn > 0 ? "info" : "default"}
              icon={<Clock3 className="h-4 w-4 text-blue-700" />}
            />
          </div>
        )}
        <div className="mt-2 text-right">
          <Link
            to={continueHref}
            className="text-[11px] font-bold text-violet-900 hover:underline"
            state={{ from: "dashboard" }}
          >
            {GUIDED_WORKFLOW_CTA.DASHBOARD_CONTINUE} →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
