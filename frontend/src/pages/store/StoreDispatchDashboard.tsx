import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Boxes, ChevronRight, ClipboardList, PackageMinus, PackageSearch, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { buttonVariants } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import { ErpEmptyState } from "../../components/erp/foundation/ErpEmptyState";
import { ErpKpiStrip, ErpKpiSegment, ErpKpiLabel, ErpKpiValue } from "../../components/erp/foundation/ErpKpiStrip";
import { ErpActionButton } from "../../components/erp/foundation/ErpActionButton";
import type { DispatchBacklogRow } from "../../lib/dispatchBacklog";
import { dashboardShell } from "../../lib/dashboardShell";
import { purchaseGrnExecutionHref } from "../../lib/woPrepareOperationalStage";
import { DashboardOpsClearStrip, DashboardWorkspaceHeader } from "../../components/erp/foundation";
import { PendingActionsDashboardCard } from "../PendingActionsPage";
import type { PendingActionsDashboardProps } from "../../lib/pendingActionsApi";
import { erpKpi } from "../../lib/erpFoundationTokens";
import { ERP_DASHBOARD_POLL_MS, useErpRefreshTick } from "../../hooks/useErpRefreshTick";
import { useStoreDashboardOperationalData } from "../../hooks/useStoreDashboardOperationalData";
import {
  computeNoQtyExecutionSummaryMetrics,
  computeStoreDashboardKpiMetrics,
  computeStoreProcurementMonitorMetrics,
  computeStoreRmccSummaryMetrics,
} from "../../lib/storeDashboardMetrics";
import { NO_QTY_AGREEMENTS_HREF } from "../../lib/noQtyStoreNavigation";
import { rmControlCenterHref } from "../../lib/materialWorkflowLinks";
import {
  navContextDispatchFromDashboard,
  navContextMaterialIssueFromDashboard,
  navContextNoQtyExecutionRegister,
  navContextRmControlCenterFromDashboard,
  navStateWithNavContext,
} from "../../lib/erpNavContext";
import { StoreNoQtyExecutionSummaryCard } from "../../components/erp/StoreNoQtyExecutionSummaryCard";
import { StoreRmccSummaryCard } from "../../components/erp/StoreRmccSummaryCard";
import { StoreProcurementMonitor } from "../../components/erp/StoreProcurementMonitor";

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
  navState,
}: {
  title: string;
  detail: string;
  actionLabel: string;
  href: string;
  icon?: React.ReactNode;
  navState?: ReturnType<typeof navStateWithNavContext>;
}) {
  return (
    <Link
      to={href}
      state={navState ?? { from: "dashboard" }}
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
  const operational = useStoreDashboardOperationalData(liveTick);

  const executionMetrics = React.useMemo(
    () => computeNoQtyExecutionSummaryMetrics(operational.inboxRows),
    [operational.inboxRows],
  );
  const kpiMetrics = React.useMemo(
    () =>
      computeStoreDashboardKpiMetrics({
        inboxRows: operational.inboxRows,
        materialIssuePendingCount: operational.materialIssuePendingCount,
        rmccSummary: operational.rmccSummary,
        procurementWorkspace: operational.procurementWorkspace,
      }),
    [
      operational.inboxRows,
      operational.materialIssuePendingCount,
      operational.rmccSummary,
      operational.procurementWorkspace,
    ],
  );
  const rmccMetrics = React.useMemo(
    () => computeStoreRmccSummaryMetrics(operational.rmccSummary),
    [operational.rmccSummary],
  );
  const procurementMonitorMetrics = React.useMemo(
    () => computeStoreProcurementMonitorMetrics(operational.procurementWorkspace, operational.inboxRows),
    [operational.procurementWorkspace, operational.inboxRows],
  );

  const clickTo = (to: string, navContext?: ReturnType<typeof navStateWithNavContext>) => ({
    onClick: () =>
      navigate(to, navContext ? { state: navContext } : { state: { from: "dashboard" } }),
  });

  const dispatchReadyCount = dispatchReady.length;
  const executionRegisterHref = NO_QTY_AGREEMENTS_HREF;
  const rmccHref = rmControlCenterHref({ returnTo: "dashboard" });
  const materialIssueHref = "/material-issue?source=dashboard";
  const procurementAwaitHref = "/procurement-planning?returnTo=dashboard";
  const dashboardNav = navStateWithNavContext(navContextNoQtyExecutionRegister("dashboard"));
  const dashboardRmccNav = navStateWithNavContext(navContextRmControlCenterFromDashboard());
  const dashboardMaterialIssueNav = navStateWithNavContext(navContextMaterialIssueFromDashboard());
  const dashboardDispatchNav = navStateWithNavContext(navContextDispatchFromDashboard());

  const allQuiet =
    !operational.loading &&
    kpiMetrics.readyForWo === 0 &&
    kpiMetrics.materialIssuePending === 0 &&
    kpiMetrics.rmccCases === 0 &&
    kpiMetrics.awaitProcurement === 0 &&
    dispatchReadyCount === 0 &&
    dispatchBacklogCount === 0 &&
    procurementMonitorMetrics.grnPending === 0;

  return (
    <div className={DASH_SHELL} data-testid="store-dispatch-dashboard">
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
            <ErpActionButton
              tier="primary"
              className="gap-1.5"
              data-testid="store-quick-no-qty-execution"
              onClick={() => navigate(executionRegisterHref, dashboardNav)}
            >
              <ClipboardList className="h-3.5 w-3.5" aria-hidden />
              NO_QTY Execution
            </ErpActionButton>
            <ErpActionButton
              tier="primary"
              className="gap-1.5"
              data-testid="store-quick-rmcc"
              onClick={() => navigate(rmccHref, dashboardRmccNav)}
            >
              <PackageSearch className="h-3.5 w-3.5" aria-hidden />
              RM Control Center
            </ErpActionButton>
            <ErpActionButton
              tier="primary"
              className="gap-1.5"
              data-testid="store-quick-material-issue"
              onClick={() => navigate(materialIssueHref, dashboardMaterialIssueNav)}
            >
              <PackageMinus className="h-3.5 w-3.5" aria-hidden />
              Material Issue
            </ErpActionButton>
            <ErpActionButton
              tier="primary"
              className="gap-1.5"
              data-testid="store-quick-dispatch"
              onClick={() => navigate("/dispatch?source=dashboard", dashboardDispatchNav)}
            >
              <Truck className="h-3.5 w-3.5" aria-hidden />
              Dispatch
            </ErpActionButton>
            <span className="mx-0.5 hidden h-5 w-px bg-slate-200 sm:inline-block" aria-hidden />
            <ErpActionButton
              tier="tertiary"
              className="gap-1.5"
              data-testid="store-quick-grn"
              onClick={() => navigate(purchaseGrnExecutionHref({ source: "dashboard" }))}
            >
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              GRN Workspace
            </ErpActionButton>
            <ErpActionButton
              tier="tertiary"
              className="gap-1.5"
              data-testid="store-quick-stock"
              onClick={() => navigate("/stock?source=dashboard")}
            >
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              Stock
            </ErpActionButton>
          </div>

          <div className="max-w-full overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ErpKpiStrip
              className={erpKpi.stripCompact}
              role="toolbar"
              aria-label="Store execution metrics"
              data-testid="store-kpi-execution"
            >
              <ErpKpiSegment type="button" {...clickTo(executionRegisterHref, dashboardNav)} aria-label="Ready for WO">
                <ErpKpiLabel>Ready for WO</ErpKpiLabel>
                <ErpKpiValue tone={kpiMetrics.readyForWo > 0 ? "warn" : "muted"}>{kpiMetrics.readyForWo}</ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment type="button" {...clickTo(materialIssueHref, dashboardMaterialIssueNav)} aria-label="Material issue pending">
                <ErpKpiLabel>Material issue pending</ErpKpiLabel>
                <ErpKpiValue tone={kpiMetrics.materialIssuePending > 0 ? "warn" : "muted"}>
                  {kpiMetrics.materialIssuePending}
                </ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment type="button" {...clickTo(rmccHref, dashboardRmccNav)} aria-label="RMCC cases">
                <ErpKpiLabel>RMCC cases</ErpKpiLabel>
                <ErpKpiValue tone={kpiMetrics.rmccCases > 0 ? "warn" : "muted"}>{kpiMetrics.rmccCases}</ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment type="button" {...clickTo(procurementAwaitHref)} aria-label="Await procurement">
                <ErpKpiLabel>Await procurement</ErpKpiLabel>
                <ErpKpiValue tone={kpiMetrics.awaitProcurement > 0 ? "warn" : "muted"}>
                  {kpiMetrics.awaitProcurement}
                </ErpKpiValue>
              </ErpKpiSegment>
            </ErpKpiStrip>
          </div>

          <div className="max-w-full overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ErpKpiStrip
              className={cn(erpKpi.stripCompact, "opacity-90")}
              role="toolbar"
              aria-label="Store informational metrics"
              data-testid="store-kpi-secondary"
            >
              <ErpKpiSegment type="button" {...clickTo("/dispatch?source=dashboard", dashboardDispatchNav)} aria-label="Dispatch ready">
                <ErpKpiLabel>Dispatch ready</ErpKpiLabel>
                <ErpKpiValue tone={dispatchReadyCount > 0 ? "warn" : "muted"}>{dispatchReadyCount}</ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment type="button" {...clickTo("/stock")} aria-label="FG usable">
                <ErpKpiLabel>FG usable</ErpKpiLabel>
                <ErpKpiValue>{fgStockTotal.toFixed(2)}</ErpKpiValue>
              </ErpKpiSegment>
            </ErpKpiStrip>
          </div>

          {allQuiet ? <DashboardOpsClearStrip role="STORE" /> : null}

          <StoreNoQtyExecutionSummaryCard metrics={executionMetrics} loading={operational.loading} />
          <StoreRmccSummaryCard metrics={rmccMetrics} loading={operational.loading} />

          <StoreProcurementMonitor metrics={procurementMonitorMetrics} loading={operational.loading} />

          <div className="grid gap-1.5 lg:grid-cols-2">
            <Card className={cn(dispatchReadyCount > 0 ? DASH_CARD_PRIMARY : DASH_CARD)} data-testid="store-dispatch-ready">
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
                      navState={d.href.includes("/dispatch") ? dashboardDispatchNav : undefined}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card className={DASH_CARD} data-testid="store-dispatch-backlog">
              <CardHeader className="border-b border-slate-100 p-2.5 pb-2">
                <CardTitle className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
                  <Truck className="h-4 w-4 text-slate-600" aria-hidden />
                  Dispatch backlog
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-2.5 pt-2">
                {dispatchBacklogCount === 0 && backlogPreview.length === 0 ? (
                  <ErpEmptyState variant="inline" title="No dispatch backlog" body="Lines in dispatch prep will appear here." />
                ) : (
                  <>
                    {dispatchBacklogCount > 0 ? (
                      <StoreDashCard
                        title="Dispatch backlog"
                        detail={`${dispatchBacklogCount} line(s) in dispatch prep`}
                        actionLabel="Open dispatch"
                        href="/dispatch?source=dashboard"
                        navState={dashboardDispatchNav}
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
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
