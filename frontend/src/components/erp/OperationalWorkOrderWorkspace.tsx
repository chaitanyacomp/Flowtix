import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { apiFetch } from "../../services/api";
import { cn } from "../../lib/utils";
import type { DashboardProductionStatusSource } from "../../lib/dashboardProductionStatus";
import {
  appendNavFrom,
  FROM_WORK_ORDER_WORKSPACE,
  workOrderHrefFromWorkOrderWorkspace,
} from "../../lib/operationalWorkspaceLinks";
import { NO_QTY_TERMS } from "../../lib/flowTerminology";
import { useErpRefreshTick } from "../../hooks/useErpRefreshTick";
import { displayWorkOrderTraceNo } from "../../lib/docNoDisplay";
import {
  buildWorkOrderWorkspaceSections,
  formatCycleHistoryOutcomeLine,
  formatOperationalOutcomeLine,
  type WoApiGroupInput,
  type WoWorkspaceGroup,
} from "../../lib/workOrderWorkspacePresentation";

type WoApiRow = {
  id: number;
  docNo?: string | null;
  status: string;
  salesOrderId: number;
  salesOrder?: { docNo?: string | null; orderType?: string | null } | null;
  cycle?: { cycleNo?: number | null } | null;
  lines: Array<{
    id: number;
    qty: string;
    fgItem: { itemName: string };
  }>;
};

function groupWorkOrdersFromApi(list: WoApiRow[]): WoApiGroupInput[] {
  const out: WoApiGroupInput[] = [];
  for (const wo of list) {
    const lines = (wo.lines ?? []).map((l) => ({
      fgName: l.fgItem?.itemName ?? "—",
      qty: l.qty,
      workOrderLineId: l.id,
    }));
    if (!lines.length) continue;
    out.push({
      woId: wo.id,
      woDocNo: wo.docNo ?? null,
      salesOrderId: wo.salesOrderId,
      soDocNo: wo.salesOrder?.docNo ?? null,
      orderType: wo.salesOrder?.orderType ?? null,
      cycleNo: wo.cycle?.cycleNo != null ? Number(wo.cycle.cycleNo) : null,
      status: wo.status,
      lines,
    });
  }
  return out;
}

function statusBadgeVariant(g: WoWorkspaceGroup): "success" | "warning" | "default" | "info" {
  if (g.statusTone === "carriedForward") return "default";
  if (g.statusTone === "idle" || g.presentationStatus === "Completed") return "success";
  if (g.statusTone === "qc" || g.statusTone === "dispatch" || g.statusTone === "carryForward") {
    return "warning";
  }
  if (g.statusTone === "regular") {
    return String(g.presentationStatus).toUpperCase() === "COMPLETED" ? "success" : "warning";
  }
  return "default";
}

function resolveRowHref(g: WoWorkspaceGroup): string {
  if (g.isMuted || g.actionLabel === "View Cycle") {
    return workOrderHrefFromWorkOrderWorkspace({
      orderType: g.orderType,
      salesOrderId: g.salesOrderId,
      workOrderId: g.woId,
      cycleId: g.cycleId ?? undefined,
    });
  }
  if (g.actionHref) {
    return appendNavFrom(g.actionHref, FROM_WORK_ORDER_WORKSPACE);
  }
  return workOrderHrefFromWorkOrderWorkspace({
    orderType: g.orderType,
    salesOrderId: g.salesOrderId,
    workOrderId: g.woId,
    cycleId: g.cycleId ?? undefined,
  });
}

function cycleWoLabel(g: WoWorkspaceGroup): string {
  const cycle = g.cycleNo != null ? `Cycle ${g.cycleNo}` : "Cycle —";
  return `${cycle} · ${displayWorkOrderTraceNo(g.woId)}`;
}

function OperationalCycleCard({ g }: { g: WoWorkspaceGroup }) {
  const href = resolveRowHref(g);
  const itemLabel = g.lines.length > 1 ? `${g.itemName} (+${g.lines.length - 1})` : g.itemName;

  return (
    <li>
      <Link
        to={href}
        className="flex flex-col gap-1.5 rounded-md border border-blue-200/50 bg-white px-3 py-2.5 no-underline shadow-sm transition-colors hover:border-blue-300/60 hover:bg-slate-50/90 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold tracking-tight text-slate-900">{cycleWoLabel(g)}</p>
          <p className="mt-0.5 truncate text-[12px] font-medium text-slate-800">{itemLabel}</p>
          <p className="mt-1 text-[11px] tabular-nums leading-snug text-slate-600">
            {formatOperationalOutcomeLine(g.qtyTrace)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
          <Badge variant={statusBadgeVariant(g)} className="whitespace-nowrap text-[10px]">
            {g.presentationStatus}
          </Badge>
          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-blue-700">
            {g.actionLabel}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </div>
      </Link>
    </li>
  );
}

function CycleHistoryRow({ g }: { g: WoWorkspaceGroup }) {
  const href = resolveRowHref(g);
  const itemLabel = g.lines.length > 1 ? `${g.itemName} (+${g.lines.length - 1})` : g.itemName;

  return (
    <li className="border-t border-slate-100/80 px-2.5 py-2 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-slate-700">{cycleWoLabel(g)}</p>
          <p className="mt-0.5 truncate text-[12px] text-slate-600">{itemLabel}</p>
          <p className="mt-1 text-[11px] tabular-nums leading-snug text-slate-500">
            {formatCycleHistoryOutcomeLine(g.qtyTrace)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge variant={statusBadgeVariant(g)} className="h-5 text-[10px] font-normal">
            {g.presentationStatus}
          </Badge>
          <Link
            to={href}
            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500 no-underline hover:text-slate-700 hover:underline"
          >
            {g.actionLabel}
            <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          </Link>
        </div>
      </div>
    </li>
  );
}

export function OperationalWorkOrderWorkspace({ className }: { className?: string }) {
  const liveTick = useErpRefreshTick(["production", "dashboard", "workorders"], { pollIntervalMs: 0 });
  const [queueRows, setQueueRows] = React.useState<DashboardProductionStatusSource[] | null>(null);
  const [openGroups, setOpenGroups] = React.useState<WoApiGroupInput[] | null>(null);
  const [completedGroups, setCompletedGroups] = React.useState<WoApiGroupInput[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    void Promise.all([
      apiFetch<DashboardProductionStatusSource[]>("/api/dashboard/production-queue"),
      apiFetch<{ nonCompleted: WoApiRow[]; completed: WoApiRow[] }>(
        "/api/production/work-orders?listScope=all&completedPage=1&limit=15",
      ),
    ])
      .then(([queue, woBundle]) => {
        if (!mounted) return;
        setQueueRows(Array.isArray(queue) ? queue : []);
        setOpenGroups(groupWorkOrdersFromApi(woBundle?.nonCompleted ?? []));
        setCompletedGroups(groupWorkOrdersFromApi(woBundle?.completed ?? []));
        setError(null);
      })
      .catch((e) => {
        if (!mounted) return;
        setQueueRows([]);
        setOpenGroups([]);
        setCompletedGroups([]);
        setError(e instanceof Error ? e.message : "Failed to load work orders");
      });
    return () => {
      mounted = false;
    };
  }, [liveTick]);

  const sections = React.useMemo(
    () => buildWorkOrderWorkspaceSections(queueRows ?? [], openGroups ?? [], completedGroups ?? []),
    [queueRows, openGroups, completedGroups],
  );

  const loading = queueRows === null || openGroups === null || completedGroups === null;
  const hasOperational = sections.operationalOpen.length > 0;
  const hasHistory = sections.cycleHistory.length > 0;
  const hasAny = hasOperational || hasHistory;

  return (
    <Card className={cn("erp-op-workspace-primary min-w-0 overflow-hidden", className)}>
      <CardHeader className="border-b border-slate-100 bg-white px-2.5 py-1.5">
        <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Work Order Workspace</CardTitle>
        <p className="text-[11px] text-slate-500">
          Actionable cycles · cycle history below · {NO_QTY_TERMS.AGREEMENT_LABEL} and REGULAR
        </p>
      </CardHeader>
      <CardContent className="space-y-0 p-0">
        {error ? <p className="px-2.5 py-1.5 text-[12px] text-red-700">{error}</p> : null}
        {loading ? (
          <p className="px-2.5 py-3 text-[13px] text-slate-600">Loading…</p>
        ) : !hasAny ? (
          <p className="px-3 py-4 text-[13px] text-slate-600">No work orders found.</p>
        ) : (
          <div className="max-h-[min(52vh,440px)] overflow-y-auto">
            <section aria-label="Open Operational Cycles" className="bg-white">
              <div className="border-b border-slate-200 bg-gradient-to-b from-white to-slate-50/80 px-2.5 py-1.5">
                <h3 className="text-[12px] font-bold tracking-tight text-slate-900">Open Operational Cycles</h3>
                <p className="text-[10px] text-slate-500">Shop-floor and planning actions only</p>
              </div>
              {hasOperational ? (
                <ul className="list-none space-y-2 p-2.5">
                  {sections.operationalOpen.map((g) => (
                    <OperationalCycleCard key={g.woId} g={g} />
                  ))}
                </ul>
              ) : (
                <p className="border-b border-slate-200 px-3 py-2.5 text-[12px] text-slate-600">
                  No operational actions pending.
                </p>
              )}
            </section>

            {hasHistory ? (
              <section
                aria-label="Cycle history"
                className="erp-op-workspace-secondary border-t-2 border-slate-200/90 bg-slate-50/45"
              >
                <div className="border-b border-slate-200/70 px-2.5 py-1.5">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cycle history</h3>
                  <p className="text-[10px] text-slate-400">
                    Informational · carry-forward traceability and completed cycles
                  </p>
                </div>
                <ul className="list-none pb-1">
                  {sections.cycleHistory.map((g) => (
                    <CycleHistoryRow key={g.woId} g={g} />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
