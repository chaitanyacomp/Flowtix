import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/utils";
import { buttonVariants } from "../ui/button";
import type { ProcurementPendingRow } from "./ProcurementPendingDashboardCard";
import type { DashboardProductionStatusSource } from "../../lib/dashboardProductionStatus";
import { buildDashboardProductionStatusRows } from "../../lib/dashboardProductionStatus";
import { buildRmControlCenterHref } from "../../lib/woProcurementContinuity";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import { REGULAR_TERMS } from "../../lib/flowTerminology";

type DashboardDataSlice = {
  pendingDispatchCount?: number;
  approvalPendingCount?: number;
  purchaseWaitingCount?: number;
  waitingGrnCount?: number;
  readyIssueCount?: number;
};

type RmRiskRow = {
  workOrderId?: number | null;
  workOrderNo?: string | null;
  salesOrderId?: number | null;
  /** Canonical SO doc no (e.g. SO-26-0001) from backend workspace payload. */
  salesOrderNo?: string | null;
  itemName?: string;
  fgItemName?: string | null;
  blockerReason?: string | null;
  href?: string | null;
};

type Props = {
  data: DashboardDataSlice | null;
  prodQueue: DashboardProductionStatusSource[] | null;
  prodWaitingWoCount: number;
  prodWaitingIssueCount: number;
  procurementPending: ProcurementPendingRow[] | null;
  qcBatchCount: number;
  qcHoldCount: number;
  qcReworkCount: number;
  qcRejectionPct: number;
  rmRisk?: RmRiskRow[] | null;
  className?: string;
};

function StatLine({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "warn" | "crit" | "ok";
}) {
  const valueTone =
    tone === "crit"
      ? "text-red-800"
      : tone === "warn"
        ? "text-amber-900"
        : tone === "ok"
          ? "text-emerald-800"
          : "text-slate-900";
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[13px]">
      <span className="text-slate-600">{label}</span>
      <span className={cn("font-semibold tabular-nums", valueTone)}>{value}</span>
    </div>
  );
}

function StatBlock({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-slate-500">{title}</h3>
        {href ? (
          <Link to={href} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 px-1.5 text-[10px]")}>
            Open
          </Link>
        ) : null}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function MicroQueue({
  title,
  href,
  emptyLabel,
  rows,
}: {
  title: string;
  href?: string;
  emptyLabel: string;
  rows: Array<{ key: string; primary: string; secondary?: string; meta?: string; to?: string }>;
}) {
  return (
    <div className="min-w-0 bg-slate-50/50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</h4>
        {href ? (
          <Link to={href} className="text-[10px] font-semibold text-blue-800 no-underline hover:underline">
            View all
          </Link>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="mt-1 text-[12px] text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-200/80">
          {rows.map((row) => (
            <li key={row.key} className="py-1">
              {row.to ? (
                <Link to={row.to} className="block no-underline hover:bg-white/60">
                  <p className="truncate text-[13px] font-semibold text-slate-900">{row.primary}</p>
                  {row.secondary ? <p className="truncate text-[12px] text-slate-600">{row.secondary}</p> : null}
                  {row.meta ? <p className="text-[11px] font-medium text-blue-900">{row.meta}</p> : null}
                </Link>
              ) : (
                <>
                  <p className="truncate text-[13px] font-semibold text-slate-900">{row.primary}</p>
                  {row.secondary ? <p className="truncate text-[12px] text-slate-600">{row.secondary}</p> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DashboardLiveFactoryPanel({
  data,
  prodQueue,
  prodWaitingWoCount,
  prodWaitingIssueCount,
  procurementPending,
  qcBatchCount,
  qcHoldCount,
  qcReworkCount,
  qcRejectionPct,
  rmRisk,
  className,
}: Props) {
  const prodStats = buildDashboardProductionStatusRows(prodQueue ?? [], { limit: 200 });
  const running = prodStats.visible.filter((r) => r.operationalStatus.tone === "running");
  const waitingQcProd = prodStats.visible.filter((r) => r.operationalStatus.tone === "qc");
  const procurementRows = procurementPending ?? [];
  const pendingApproval = procurementRows.filter((r) =>
    String(r.operationalKey ?? r.nextActionKey ?? "")
      .toUpperCase()
      .includes("APPROVAL"),
  ).length;
  const pendingPo = procurementRows.filter(
    (r) => r.pendingPoStatus && r.pendingPoStatus !== "NONE" && r.pendingPoStatus !== "COMPLETE",
  ).length;

  const runningRows = running.slice(0, 5).map((r) => ({
    key: `${r.workOrderId}-${r.flowLabel}`,
    primary: r.workOrderNo ?? `WO #${r.workOrderId}`,
    secondary: r.itemName ?? r.customerName ?? undefined,
    meta: r.operationalStatus.label,
    to: r.workOrderId ? `/production?workOrderId=${r.workOrderId}` : "/production",
  }));

  const blockedRows = React.useMemo(() => {
    const src = rmRisk ?? [];
    if (!src.length) return [];
    const byCase = new Map<
      string,
      {
        key: string;
        workOrderId: number | null;
        workOrderNo: string | null;
        salesOrderId: number | null;
        salesOrderNo: string | null;
        fgItemName: string | null;
        blockerReason: string | null;
        rmLineCount: number;
      }
    >();
    for (const row of src) {
      const woId = row.workOrderId != null && Number(row.workOrderId) > 0 ? Number(row.workOrderId) : null;
      const soId = row.salesOrderId != null && Number(row.salesOrderId) > 0 ? Number(row.salesOrderId) : null;
      const caseKey = woId != null ? `wo-${woId}` : soId != null ? `so-${soId}` : `rm-${row.workOrderNo ?? "case"}`;
      const cur = byCase.get(caseKey);
      const next = cur ?? {
        key: caseKey,
        workOrderId: woId,
        workOrderNo: row.workOrderNo ?? null,
        salesOrderId: soId,
        salesOrderNo: row.salesOrderNo ?? null,
        fgItemName: row.fgItemName ?? null,
        blockerReason: row.blockerReason ?? null,
        rmLineCount: 0,
      };
      next.rmLineCount += 1;
      if (!next.blockerReason && row.blockerReason) next.blockerReason = row.blockerReason;
      if (!next.fgItemName && row.fgItemName) next.fgItemName = row.fgItemName;
      if (!next.salesOrderNo && row.salesOrderNo) next.salesOrderNo = row.salesOrderNo;
      byCase.set(caseKey, next);
    }

    const rows = Array.from(byCase.values())
      .sort((a, b) => (b.rmLineCount || 0) - (a.rmLineCount || 0))
      .slice(0, 5)
      .map((c) => {
        const soLabel =
          c.salesOrderId != null
            ? displaySalesOrderNo(c.salesOrderId, c.salesOrderNo ?? null)
            : c.salesOrderNo ?? "RM case";
        const primary = [soLabel, c.fgItemName].filter(Boolean).join(" · ");
        const meta =
          c.rmLineCount > 0
            ? `${c.rmLineCount} RM shortage line${c.rmLineCount === 1 ? "" : "s"}`
            : c.blockerReason ?? "Blocked";
        const to =
          c.workOrderId != null
            ? buildRmControlCenterHref({ workOrderId: c.workOrderId, onlyBlocked: true, returnTo: "dashboard" })
            : c.salesOrderId != null
              ? buildRmControlCenterHref({ salesOrderId: c.salesOrderId, onlyBlocked: true, returnTo: "dashboard" })
              : undefined;
        return {
          key: c.key,
          primary,
          meta,
          to,
        };
      });
    return rows;
  }, [rmRisk]);

  const grnRows = procurementRows
    .filter((r) => (r.pendingGrnQty ?? 0) > 0)
    .slice(0, 5)
    .map((r) => ({
      key: `grn-${r.materialRequirementId}`,
      primary: r.docNo ?? `MR #${r.materialRequirementId}`,
      secondary:
        r.primaryFgName ??
        (r.salesOrderId != null ? displaySalesOrderNo(r.salesOrderId, r.salesOrderDocNo) : r.salesOrderDocNo ?? undefined),
      meta: `GRN pending · ${r.pendingGrnQty ?? 0}`,
      to: buildRmControlCenterHref({
        materialRequirementId: r.materialRequirementId,
        salesOrderId: r.salesOrderId ?? undefined,
        returnTo: "dashboard",
      }),
    }));

  return (
    <section aria-label="Live factory operations" className={cn("shrink-0 space-y-1.5", className)}>
      <h2 className="text-[20px] font-bold tracking-tight text-slate-900">Live factory</h2>
      <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200/90">
        <div className="grid divide-y divide-slate-200/80 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <StatBlock title="Production" href="/production?source=dashboard">
            <StatLine label="Running" value={running.length} tone="ok" />
            <StatLine label="Blocked" value={prodWaitingWoCount} tone={prodWaitingWoCount > 0 ? "warn" : "default"} />
            <StatLine label="Waiting RM" value={prodWaitingIssueCount} tone={prodWaitingIssueCount > 0 ? "warn" : "default"} />
            <StatLine label="Waiting QC" value={waitingQcProd.length + qcBatchCount} tone={qcBatchCount > 0 ? "warn" : "default"} />
          </StatBlock>
          <StatBlock title="RM procurement" href={buildRmControlCenterHref({ returnTo: "dashboard" })}>
            <StatLine
              label="Pending approval"
              value={data?.approvalPendingCount ?? pendingApproval}
              tone={(data?.approvalPendingCount ?? pendingApproval) > 0 ? "warn" : "default"}
            />
            <StatLine label="Pending PO" value={pendingPo || (data?.purchaseWaitingCount ?? 0)} />
            <StatLine label="Waiting GRN" value={data?.waitingGrnCount ?? 0} />
          </StatBlock>
          <StatBlock title="Dispatch" href="/dispatch?source=dashboard">
            <StatLine label="Prep pending" value={data?.pendingDispatchCount ?? 0} tone={(data?.pendingDispatchCount ?? 0) > 0 ? "warn" : "default"} />
            <StatLine label="Ready issue" value={data?.readyIssueCount ?? 0} tone="ok" />
          </StatBlock>
          <StatBlock title="QC" href="/qc-entry?source=dashboard">
            <StatLine label="Pending" value={qcBatchCount} tone={qcBatchCount > 0 ? "warn" : "default"} />
            <StatLine label="Hold" value={qcHoldCount} tone={qcHoldCount > 0 ? "warn" : "default"} />
            <StatLine label="Rework" value={qcReworkCount} />
            <StatLine label="Rejection %" value={`${qcRejectionPct.toFixed(1)}%`} tone={qcRejectionPct >= 12 ? "crit" : "default"} />
          </StatBlock>
        </div>

        <div className="grid border-t border-slate-200/80 lg:grid-cols-2 xl:grid-cols-4">
          <MicroQueue title="Running production" href="/production" emptyLabel="No active runs" rows={runningRows} />
          <MicroQueue
            title="Blocked WOs"
            href={buildRmControlCenterHref({ onlyBlocked: true, returnTo: "dashboard" })}
            emptyLabel={REGULAR_TERMS.DASHBOARD_NO_WO_RM_BLOCKERS_LABEL}
            rows={blockedRows}
          />
          <MicroQueue
            title="Waiting GRN"
            href="/rm-po-grn?focus=pending-requests"
            emptyLabel="No pending GRN"
            rows={grnRows}
          />
          <MicroQueue title="QC pending" href="/qc-entry" emptyLabel="QC clear" rows={[]} />
        </div>
      </div>
    </section>
  );
}
