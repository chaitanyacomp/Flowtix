import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Boxes, ChevronRight, PackageMinus, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { buttonVariants } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import { ErpEmptyState } from "../../components/erp/foundation/ErpEmptyState";
import { ErpKpiStrip, ErpKpiSegment, ErpKpiLabel, ErpKpiValue } from "../../components/erp/foundation/ErpKpiStrip";
import { ErpActionButton } from "../../components/erp/foundation/ErpActionButton";
import type { DispatchBacklogRow } from "../../lib/dispatchBacklog";
import { dashboardShell } from "../../lib/dashboardShell";
import { REGULAR_TERMS } from "../../lib/flowTerminology";
import { purchaseGrnExecutionHref } from "../../lib/woPrepareOperationalStage";
import { DashboardOpsClearStrip, DashboardWorkspaceHeader } from "../../components/erp/foundation";
import { PendingActionsDashboardCard } from "../PendingActionsPage";
import type { PendingActionsDashboardProps } from "../../lib/pendingActionsApi";
import { StoreProcurementPulse } from "../../components/erp/StoreProcurementPulse";
import { erpKpi } from "../../lib/erpFoundationTokens";
import { apiFetch } from "../../services/api";
import { ERP_DASHBOARD_POLL_MS, useErpRefreshTick } from "../../hooks/useErpRefreshTick";

const DASH_SHELL = dashboardShell.page;
const DASH_MAX = dashboardShell.max;
const DASH_CARD = dashboardShell.card;
const DASH_CARD_PRIMARY = dashboardShell.cardPrimary;

export type StoreDispatchActionRow = {
  key: string;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  itemName: string;
  orderType?: string | null;
  metricQty: number;
  href: string;
};

type PurchaseSummaryRow = { purchaseOrderId: number; itemId: number; pendingQty: number };

function formatQty(q: number): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function StoreDashCard({
  title,
  detail,
  actionLabel,
  href,
  icon,
}: {
  title: string;
  detail: string;
  actionLabel: string;
  href: string;
  icon?: React.ReactNode;
}) {
  return (
    <Link
      to={href}
      state={{ from: "dashboard" }}
      className={cn(
        "group block rounded-lg border border-slate-200/95 bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-slate-300 hover:shadow-md border-l-[3px] border-l-blue-600",
      )}
    >
      <div className="flex items-start gap-2 sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {icon ? <span className="mt-0.5 shrink-0 text-slate-500">{icon}</span> : null}
          <div className="min-w-0">
            <div className="text-[13px] font-bold leading-tight text-slate-950">{title}</div>
            <p className="mt-0.5 text-[12px] leading-snug text-slate-700">{detail}</p>
          </div>
        </div>
        <span className={cn(buttonVariants({ variant: "default", size: "sm" }), "mt-1 h-8 shrink-0 rounded-md px-3 text-xs font-semibold shadow-none sm:mt-0")}>
          {actionLabel}
          <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

export type StoreDispatchDashboardProps = {
  dispatchReady: StoreDispatchActionRow[];
  backlogPreview: DispatchBacklogRow[];
  fgStockTotal?: number;
  dispatchBacklogCount?: number;
  pendingActions?: PendingActionsDashboardProps;
};

export function StoreDispatchDashboard({
  dispatchReady,
  backlogPreview,
  fgStockTotal = 0,
  dispatchBacklogCount = 0,
  pendingActions,
}: StoreDispatchDashboardProps) {
  const navigate = useNavigate();
  const liveTick = useErpRefreshTick(["dashboard"], { pollIntervalMs: ERP_DASHBOARD_POLL_MS });
  const [grnPendingLines, setGrnPendingLines] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    apiFetch<PurchaseSummaryRow[]>("/api/dashboard/purchase-summary")
      .then((rows) => {
        if (!cancelled) setGrnPendingLines(Array.isArray(rows) ? rows.length : 0);
      })
      .catch(() => {
        if (!cancelled) setGrnPendingLines(0);
      });
    return () => {
      cancelled = true;
    };
  }, [liveTick]);

  const clickTo = (to: string) => ({
    onClick: () => navigate(to, { state: { from: "dashboard" } }),
  });

  const dispatchReadyCount = dispatchReady.length;
  const allQuiet = dispatchReadyCount === 0 && grnPendingLines === 0 && dispatchBacklogCount === 0;

  return (
    <div className={DASH_SHELL}>
      <div className={DASH_MAX}>
        <div className={dashboardShell.grid}>
          <DashboardWorkspaceHeader role="STORE" />

          {pendingActions ? (
            <PendingActionsDashboardCard
              count={pendingActions.count}
              loading={pendingActions.loading}
              error={pendingActions.error}
            />
          ) : null}

          <div className="erp-op-workspace-primary erp-card-surface flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/90 px-2.5 py-1.5 shadow-sm">
            <ErpActionButton tier="primary" className="gap-1.5" onClick={() => navigate("/dispatch?source=dashboard")}>
              <Truck className="h-3.5 w-3.5" aria-hidden />
              Dispatch
            </ErpActionButton>
            <ErpActionButton tier="secondary" className="gap-1.5" onClick={() => navigate("/material-issue?source=dashboard")}>
              <PackageMinus className="h-3.5 w-3.5" aria-hidden />
              Material issue
            </ErpActionButton>
            <ErpActionButton tier="secondary" className="gap-1.5" onClick={() => navigate("/rm-po-grn?source=dashboard")}>
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              GRN workspace
            </ErpActionButton>
            <ErpActionButton tier="secondary" className="gap-1.5" onClick={() => navigate("/stock?source=dashboard")}>
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              Stock
            </ErpActionButton>
          </div>

          <div className="max-w-full overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ErpKpiStrip className={erpKpi.stripCompact} role="toolbar" aria-label="Store operations metrics">
              <ErpKpiSegment type="button" {...clickTo("/dispatch")} aria-label="Ready to dispatch">
                <ErpKpiLabel>Ready to dispatch</ErpKpiLabel>
                <ErpKpiValue tone={dispatchReadyCount > 0 ? "warn" : "muted"}>{dispatchReadyCount}</ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment type="button" {...clickTo("/rm-po-grn?source=dashboard")} aria-label="GRN pending">
                <ErpKpiLabel>GRN pending</ErpKpiLabel>
                <ErpKpiValue tone={grnPendingLines > 0 ? "warn" : "muted"}>{grnPendingLines}</ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment type="button" {...clickTo("/stock")} aria-label="FG usable">
                <ErpKpiLabel>FG usable</ErpKpiLabel>
                <ErpKpiValue>{fgStockTotal.toFixed(2)}</ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment type="button" {...clickTo("/dispatch?source=dashboard")} aria-label="Dispatch backlog">
                <ErpKpiLabel>Dispatch backlog</ErpKpiLabel>
                <ErpKpiValue tone={dispatchBacklogCount > 0 ? "warn" : "muted"}>{dispatchBacklogCount}</ErpKpiValue>
              </ErpKpiSegment>
            </ErpKpiStrip>
          </div>

          {allQuiet ? <DashboardOpsClearStrip role="STORE" /> : null}

          <StoreProcurementPulse />

          <div className="grid gap-1.5 lg:grid-cols-2">
            <Card className={cn(dispatchReadyCount > 0 ? DASH_CARD_PRIMARY : DASH_CARD)}>
              <CardHeader className="border-b border-slate-100 p-2 pb-1.5">
                <CardTitle className="flex items-center gap-2 text-[13px] font-extrabold text-slate-950">
                  <Truck className="h-4 w-4 text-blue-700" aria-hidden />
                  Dispatch ready
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-2.5 pt-2">
                {dispatchReadyCount === 0 ? (
                  <ErpEmptyState variant="inline" title="No lines ready to ship" body="QC-passed stock will appear here when dispatchable." />
                ) : (
                  dispatchReady.slice(0, 6).map((d) => (
                    <StoreDashCard
                      key={d.key}
                      title={d.orderType === "NO_QTY" ? "Ready for shipment" : "Dispatch available"}
                      detail={`${displaySalesOrderNo(d.salesOrderId, d.salesOrderDocNo)} · ${d.customerName} · ${d.itemName} · ${formatQty(d.metricQty)}`}
                      actionLabel="Open dispatch"
                      href={d.href}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card className={DASH_CARD}>
              <CardHeader className="border-b border-slate-100 p-2.5 pb-2">
                <CardTitle className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
                  <Boxes className="h-4 w-4 text-emerald-700" aria-hidden />
                  Store queues
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-2.5 pt-2">
                {grnPendingLines > 0 ? (
                  <StoreDashCard
                    title="Material receipts pending"
                    detail={`${grnPendingLines} PO line(s) awaiting GRN`}
                    actionLabel={REGULAR_TERMS.OPEN_PURCHASE_AND_GRN}
                    href={purchaseGrnExecutionHref({ source: "dashboard" })}
                  />
                ) : null}
                {dispatchBacklogCount > 0 ? (
                  <StoreDashCard
                    title="Dispatch backlog"
                    detail={`${dispatchBacklogCount} line(s) in dispatch prep`}
                    actionLabel="Open dispatch"
                    href="/dispatch?source=dashboard"
                  />
                ) : null}
                {backlogPreview.length > 0 ? (
                  <div className="erp-op-workspace-secondary rounded-md border border-slate-200/90 bg-slate-50/80 px-2 py-1.5">
                    <div className="text-[10px] font-semibold text-slate-600">Recent dispatch-ready lines</div>
                    <ul className="mt-1 space-y-1 text-[11px] text-slate-800">
                      {backlogPreview.slice(0, 5).map((r) => (
                        <li key={`${r.salesOrderId}-${r.salesOrderLineId}`} className="truncate">
                          {displaySalesOrderNo(r.salesOrderId, r.salesOrderNo)} · {r.itemName} ·{" "}
                          <span className="tabular-nums font-medium">{formatQty(Number(r.dispatchableNow ?? 0))}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {grnPendingLines === 0 && dispatchBacklogCount === 0 && backlogPreview.length === 0 ? (
                  <ErpEmptyState variant="inline" title="Store operations are clear" body="GRN, issue, and dispatch queues are quiet." />
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
