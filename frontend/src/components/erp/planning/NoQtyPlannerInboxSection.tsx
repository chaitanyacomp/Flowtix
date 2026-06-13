import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../../ui/badge";
import { Button, buttonVariants } from "../../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { cn } from "../../../lib/utils";
import { displaySalesOrderNo } from "../../../lib/docNoDisplay";
import { buildNoQtyGuidedHref } from "../../../lib/noQtyFlowState";
import {
  formatPlanningInboxNextRsLine,
  planningInboxCustomerName,
  planningInboxCycleLabel,
} from "../../../lib/planningInboxPresentation";
import {
  noQtyBusinessWorkflowStage,
  noQtyCurrentCycleLabel,
  noQtyNextCycleLabel,
  noQtySoListHref,
  openCurrentRsButtonLabel,
} from "../../../lib/noQtyRsActionLabels";
import { useCanOpenRequirementSheet } from "../../../hooks/useIsAdmin";
import type { NoQtyPlannerInboxRow } from "../../../hooks/useNoQtyPlannerInbox";
import { NoQtyMacroLifecycleStrip } from "../production/NoQtyMacroLifecycleStrip";

type Props = {
  rows: NoQtyPlannerInboxRow[];
  loading: boolean;
  error: string | null;
  className?: string;
};

function rsStatusVariant(status: string): "success" | "warning" | "default" | "rejected" {
  if (status === "Locked") return "success";
  if (status === "Draft") return "warning";
  if (status === "Cancelled") return "rejected";
  if (status === "No RS") return "default";
  return "default";
}

function nextRsToneClass(tone: ReturnType<typeof formatPlanningInboxNextRsLine>["tone"]): string {
  if (tone === "ready") return "text-emerald-900";
  if (tone === "exists") return "text-slate-700";
  return "text-amber-950";
}

function InboxRowCard({ row }: { row: NoQtyPlannerInboxRow }) {
  const canOpenRs = useCanOpenRequirementSheet();

  const { so, rsStatus, flowState, guidedCycleId, cycleNo } = row;
  const nextRs = formatPlanningInboxNextRsLine(so);
  const workflowStage = noQtyBusinessWorkflowStage({
    processStageKey: so.processStage?.key,
    processStageLabel: so.processStage?.label,
    rsStatus,
    hasRs: rsStatus !== "No RS",
  });
  const rsHref = buildNoQtyGuidedHref({
    to: `/sales-orders/${so.id}/requirement-sheets`,
    salesOrderId: so.id,
    cycleId: guidedCycleId,
    fromStep: "requirement",
  });
  const soHref = noQtySoListHref(so.id);
  const nextCycleNo =
    (so as { noQtyNextPossibleCycleNo?: number | null }).noQtyNextPossibleCycleNo ??
    (cycleNo != null ? cycleNo + 1 : null);

  return (
    <article
      className="rounded-md border border-slate-200 bg-white p-2.5 shadow-sm"
      data-testid={`planner-inbox-row-${so.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
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
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <Link to={soHref} className={cn(buttonVariants({ size: "sm" }), "h-8 text-[11px] font-semibold")}>
            Open NO_QTY SO
          </Link>
          {canOpenRs ? (
            <Link to={rsHref} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-8 text-[11px]")}>
              {openCurrentRsButtonLabel()}
            </Link>
          ) : null}
        </div>
      </div>

      <dl className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Current cycle</dt>
          <dd className="text-[12px] font-semibold text-violet-950">{planningInboxCycleLabel(so)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Current stage</dt>
          <dd className="text-[12px] font-semibold text-slate-900">{workflowStage}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">RS status</dt>
          <dd>
            <Badge variant={rsStatusVariant(rsStatus)} className="text-[10px]">
              {rsStatus}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Next cycle</dt>
          <dd className="text-[12px] font-semibold text-slate-900">{noQtyNextCycleLabel(nextCycleNo)}</dd>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Next RS</dt>
          <dd className={cn("text-[12px] font-semibold", nextRsToneClass(nextRs.tone))}>{nextRs.headline}</dd>
          {nextRs.reason ? (
            <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
              <span className="font-semibold text-slate-700">Reason: </span>
              {nextRs.reason}
            </p>
          ) : null}
        </div>
      </dl>

      {flowState ? (
        <NoQtyMacroLifecycleStrip flow={flowState} cycleNo={cycleNo} className="mt-2" />
      ) : null}
    </article>
  );
}

/** P6B-4A — planner inbox (signals + shortcuts; SO owns RS creation). */
export function NoQtyPlannerInboxSection({ rows, loading, error, className }: Props) {
  const attentionCount = rows.filter(
    (r) =>
      r.so.noQtyCreateNextRsEligible ||
      r.rsStatus === "Draft" ||
      r.rsStatus === "No RS" ||
      r.rsStatus === "Cancelled",
  ).length;

  return (
    <Card className={cn("min-w-0 overflow-hidden border-violet-200/80 shadow-sm", className)} data-testid="no-qty-planner-inbox">
      <CardHeader className="space-y-1 border-b border-violet-100 bg-gradient-to-r from-violet-50/90 to-white px-3.5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">NO_QTY Action Required</CardTitle>
          {!loading ? (
            <span className="text-[11px] tabular-nums text-slate-600">
              {rows.length} active · {attentionCount} need attention
            </span>
          ) : null}
        </div>
        <p className="text-[11px] leading-snug text-slate-600">
          Planner signals only — open the NO_QTY Agreement to create or edit cycle Requirement Sheets.
        </p>
      </CardHeader>
      <CardContent className="space-y-2 px-2.5 py-2.5">
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-900">{error}</div>
        ) : null}
        {loading ? (
          <p className="text-[12px] text-slate-600" aria-live="polite">
            Loading NO_QTY agreements…
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] text-slate-700">
            No active NO_QTY agreements require planning attention right now.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <InboxRowCard key={row.so.id} row={row} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
