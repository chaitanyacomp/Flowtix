import * as React from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../ui/badge";
import { Button, buttonVariants } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { displaySalesOrderNo } from "../../../lib/docNoDisplay";
import {
  formatPlanningInboxNextRsLine,
  planningInboxCustomerName,
} from "../../../lib/planningInboxPresentation";
import {
  resolveCycleManagementCurrentCycleStatus,
  resolveNoQtyCycleManagementPrimaryAction,
} from "../../../lib/noQtyCycleManagementPresentation";
import { useCanCreateNextRs, useCanOpenRequirementSheet } from "../../../hooks/useIsAdmin";
import type { NoQtyPlannerInboxRow } from "../../../hooks/useNoQtyPlannerInbox";
import { NoQtyMacroLifecycleStrip } from "../production/NoQtyMacroLifecycleStrip";
import { NoQtyPreviousCyclesSection } from "./NoQtyPreviousCyclesSection";

function rsStatusVariant(status: string): "success" | "warning" | "default" | "rejected" {
  if (status === "Locked") return "success";
  if (status === "Draft") return "warning";
  if (status === "Cancelled") return "rejected";
  if (status === "No RS") return "default";
  return "default";
}

function PrimaryActionControl({
  action,
}: {
  action: ReturnType<typeof resolveNoQtyCycleManagementPrimaryAction>;
}) {
  if (action.handoff) {
    return (
      <div
        className="rounded-md border border-slate-200 bg-slate-50 px-0.5 py-1 text-[11px] font-medium text-slate-700"
        data-testid="cycle-mgmt-primary-handoff"
      >
        {action.label}
      </div>
    );
  }

  if (action.disabled || !action.href) {
    return (
      <div className="space-y-1" data-testid="cycle-mgmt-primary-blocked">
        <Button type="button" size="sm" className="h-8 font-semibold" disabled>
          {action.label}
        </Button>
        {action.blockedReason ? (
          <p className="max-w-md text-[11px] leading-snug text-amber-950">
            <span className="font-semibold">Reason: </span>
            {action.blockedReason}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Link
      to={action.href}
      className={cn(buttonVariants({ size: "sm" }), "h-8 font-semibold")}
      data-testid="cycle-mgmt-primary-action"
    >
      {action.label}
    </Link>
  );
}

export function NoQtyCycleManagementWorkspace({
  row,
  compact = false,
}: {
  row: NoQtyPlannerInboxRow;
  compact?: boolean;
}) {
  const canOpenRs = useCanOpenRequirementSheet();
  const canCreateNextRs = useCanCreateNextRs();
  const { so, flowState, cycleNo } = row;

  const primaryAction = React.useMemo(
    () => resolveNoQtyCycleManagementPrimaryAction(row, { canOpenRs, canCreateNextRs }),
    [row, canOpenRs, canCreateNextRs],
  );

  const currentStatus = React.useMemo(() => resolveCycleManagementCurrentCycleStatus(row), [row]);
  const nextRs = formatPlanningInboxNextRsLine(so);

  return (
    <article
      className={cn(
        "rounded-md border border-slate-200 bg-white shadow-sm",
        compact ? "p-2" : "p-2.5",
      )}
      data-testid={`cycle-management-workspace-${so.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold tabular-nums text-slate-900">
              {displaySalesOrderNo(so.id, so.docNo ?? null)}
            </span>
            <Badge variant="info" className="text-[10px]">
              NO_QTY
            </Badge>
          </div>
          <p className="truncate text-[12px] text-slate-700" title={planningInboxCustomerName(so)}>
            {planningInboxCustomerName(so)}
          </p>
        </div>
        <PrimaryActionControl action={primaryAction} />
      </div>

      <section
        className="mt-2 rounded-md border border-violet-100 bg-violet-50/40 px-2 py-1.5"
        data-testid="cycle-mgmt-current-cycle-card"
        aria-label="Current cycle summary"
      >
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-violet-900">Current cycle</h3>
        <dl className="mt-1 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cycle</dt>
            <dd className="text-[12px] font-semibold text-violet-950">{currentStatus.cycle}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">RS status</dt>
            <dd>
              <Badge variant={rsStatusVariant(currentStatus.rsStatus)} className="text-[10px]">
                {currentStatus.rsStatus}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Monthly planning</dt>
            <dd className="text-[12px] font-semibold text-slate-900">{currentStatus.monthlyPlanning}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Procurement</dt>
            <dd className="text-[12px] font-semibold text-slate-900">{currentStatus.procurement}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Production</dt>
            <dd className="text-[12px] font-semibold text-slate-900">{currentStatus.production}</dd>
          </div>
        </dl>
      </section>

      <div className="mt-2 rounded-md border border-slate-200/90 bg-slate-50/70 px-2 py-1.5 text-[11px] text-slate-700">
        <span className="font-semibold text-slate-800">Next cycle: </span>
        <span className={cn("font-semibold", nextRs.tone === "ready" ? "text-emerald-900" : nextRs.tone === "blocked" ? "text-amber-950" : "text-slate-800")}>
          {nextRs.headline}
        </span>
        {nextRs.reason && primaryAction.key !== "next-rs-blocked" ? (
          <p className="mt-0.5 leading-snug text-slate-600">
            <span className="font-semibold">Reason: </span>
            {nextRs.reason}
          </p>
        ) : null}
      </div>

      {flowState ? (
        <NoQtyMacroLifecycleStrip flow={flowState} cycleNo={cycleNo} className="mt-2" />
      ) : null}

      <NoQtyPreviousCyclesSection salesOrderId={so.id} className="mt-2" />
    </article>
  );
}
