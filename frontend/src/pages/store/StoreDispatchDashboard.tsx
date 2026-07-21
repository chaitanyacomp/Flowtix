import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Boxes, ChevronRight, ClipboardList, Factory, PackageMinus, PackageSearch, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { buttonVariants } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import { ErpKpiStrip, ErpKpiSegment, ErpKpiLabel, ErpKpiValue } from "../../components/erp/foundation/ErpKpiStrip";
import { ErpActionButton } from "../../components/erp/foundation/ErpActionButton";
import type { DispatchBacklogRow } from "../../lib/dispatchBacklog";
import { dashboardShell } from "../../lib/dashboardShell";
import { DashboardOpsClearStrip, DashboardWorkspaceHeader } from "../../components/erp/foundation";
import { ErpRefreshingBadge } from "../../components/erp/foundation/ErpRefreshingBadge";
import { PendingActionsDashboardCard } from "../PendingActionsPage";
import type { PendingActionsDashboardProps } from "../../lib/pendingActionsApi";
import { prepareNoQtyNextRequirementSheetAndNavigate } from "../../lib/noQtyPrepareNextRsNavigate";
import { useToast } from "../../contexts/ToastContext";
import {
  NoQtyDashboardCompactPanel,
  type NoQtyDashboardCompactRow,
} from "../../components/erp/planning/NoQtyDashboardCompactPanel";
import type { NoQtyFlowState } from "../../lib/noQtyFlowState";
import type { ResolvedNoQtyContinuation } from "../../lib/noQtyDashboardContinuation";
import { erpKpi } from "../../lib/erpFoundationTokens";
import { ERP_DASHBOARD_POLL_MS, useErpRefreshTick } from "../../hooks/useErpRefreshTick";
import { useRouteActive } from "../../hooks/useRouteActive";
import { useUrlQueryState } from "../../hooks/useUrlQueryState";
import { useStoreDashboardOperationalData } from "../../hooks/useStoreDashboardOperationalData";
import {
  computeStoreDashboardKpiMetrics,
  computeStoreProcurementMonitorMetrics,
  computeStoreRmccSummaryMetrics,
} from "../../lib/storeDashboardMetrics";
import {
  isStoreWorkspaceTabActive,
  shouldShowStoreDispatchReadySection,
  shouldShowStoreNoQtyQueueSection,
  shouldShowStorePrepareHeadroomSection,
  shouldShowStoreProcurementSection,
  shouldShowStoreRmccSection,
  type StoreWorkspaceNavKey,
} from "../../lib/storeDashboardPresentation";
import { NO_QTY_AGREEMENTS_HREF } from "../../lib/noQtyStoreNavigation";
import { rmControlCenterHref } from "../../lib/materialWorkflowLinks";
import {
  navContextDispatchFromDashboard,
  navContextMaterialIssueFromDashboard,
  navContextNoQtyExecutionRegister,
  navContextRmControlCenterFromDashboard,
  navStateWithNavContext,
} from "../../lib/erpNavContext";
import { StoreRmccSummaryCard } from "../../components/erp/StoreRmccSummaryCard";
import { StoreProcurementMonitor } from "../../components/erp/StoreProcurementMonitor";
import { StoreProductionMonitorPanel } from "../../components/erp/store/StoreProductionMonitorPanel";

const STORE_TAB_OMIT = { storeTab: "overview" } as const;
type StoreDashboardTab = "overview" | "production-monitor";

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
            <p className="mt-0.5 text-[13px] leading-snug text-slate-700">{detail}</p>
          </div>
        </div>
        <span
          className={cn(
            buttonVariants({ variant: "default", size: "sm" }),
            "mt-1 h-8 shrink-0 rounded-md px-3 text-xs font-semibold shadow-none sm:mt-0",
          )}
        >
          {actionLabel}
          <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

function StoreNavBadge({ count }: { count: number }) {
  if (!(count > 0)) return null;
  return (
    <span
      className="ml-1 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold tabular-nums text-white"
      data-testid="store-nav-badge"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function StoreWorkspaceNavButton({
  navKey,
  selectedTab,
  label,
  icon,
  testId,
  badgeCount = 0,
  onClick,
}: {
  navKey: StoreWorkspaceNavKey;
  selectedTab: StoreDashboardTab;
  label: string;
  icon: React.ReactNode;
  testId: string;
  badgeCount?: number;
  onClick: () => void;
}) {
  const active = isStoreWorkspaceTabActive(navKey, selectedTab);
  return (
    <ErpActionButton
      tier={active ? "primary" : "tertiary"}
      className={cn("gap-1.5 text-[13px]", active && "ring-2 ring-blue-300")}
      data-testid={testId}
      aria-selected={active || undefined}
      onClick={onClick}
    >
      {icon}
      {label}
      <StoreNavBadge count={badgeCount} />
    </ErpActionButton>
  );
}

export type StoreDispatchDashboardProps = {
  dispatchReady: StoreDispatchActionRow[];
  backlogPreview: DispatchBacklogRow[];
  fgStockTotal?: number;
  dispatchBacklogCount?: number;
  pendingActions?: PendingActionsDashboardProps;
  /** @deprecated Pending RS card removed — NO_QTY compact table is the single Create RS surface. */
  pendingRsActions?: unknown[];
  /** Parent dashboard refresh tick — avoids duplicate poll timers when embedded in DashboardPage. */
  refreshTick?: number;
  /** Background revalidation — keep stale UI visible. */
  refreshing?: boolean;
  noQtyContinuationRows?: NoQtyDashboardCompactRow[];
  noQtyFlowBySo?: Record<number, NoQtyFlowState | null | undefined>;
  noQtyContinuationTruncated?: boolean;
  onNoQtyPrimaryAction?: (args: {
    row: NoQtyDashboardCompactRow;
    resolved: ResolvedNoQtyContinuation;
  }) => void;
};

export function StoreDispatchDashboard({
  dispatchReady,
  backlogPreview,
  fgStockTotal = 0,
  dispatchBacklogCount = 0,
  pendingActions,
  refreshTick,
  refreshing = false,
  noQtyContinuationRows = [],
  noQtyFlowBySo = {},
  noQtyContinuationTruncated = false,
  onNoQtyPrimaryAction,
}: StoreDispatchDashboardProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const isDashboardRoute = useRouteActive("/dashboard");
  const { read, patch } = useUrlQueryState(STORE_TAB_OMIT);
  const storeTab = read.enum("storeTab", ["overview", "operations", "production-monitor"] as const, "overview");
  const selectedTab: StoreDashboardTab =
    storeTab === "production-monitor" ? "production-monitor" : "overview";
  const setStoreTab = React.useCallback(
    (tab: StoreDashboardTab) => {
      patch({ storeTab: tab === "overview" ? null : tab });
    },
    [patch],
  );
  const internalTick = useErpRefreshTick(["dashboard"], {
    pollIntervalMs: ERP_DASHBOARD_POLL_MS,
    enabled: isDashboardRoute && refreshTick == null,
  });
  const liveTick = refreshTick ?? internalTick;
  const operational = useStoreDashboardOperationalData(liveTick, {
    enabled: isDashboardRoute,
  });

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
  const hasNoQtyContinuation = shouldShowStoreNoQtyQueueSection(noQtyContinuationRows.length > 0);
  const showRmcc = shouldShowStoreRmccSection(rmccMetrics);
  const showProcurement = shouldShowStoreProcurementSection(procurementMonitorMetrics);
  const showDispatchReady = shouldShowStoreDispatchReadySection(dispatchReadyCount);
  const showPrepareHeadroom = shouldShowStorePrepareHeadroomSection(
    dispatchBacklogCount,
    backlogPreview.length,
  );

  const executionRegisterHref = NO_QTY_AGREEMENTS_HREF;
  const rmccHref = rmControlCenterHref({ returnTo: "dashboard" });
  const materialIssueHref = "/material-issue?source=dashboard";
  const procurementGrnHref = "/procurement-planning?returnTo=dashboard";
  const dashboardNav = navStateWithNavContext(navContextNoQtyExecutionRegister("dashboard"));
  const dashboardRmccNav = navStateWithNavContext(navContextRmControlCenterFromDashboard());
  const dashboardMaterialIssueNav = navStateWithNavContext(navContextMaterialIssueFromDashboard());
  const dashboardDispatchNav = navStateWithNavContext(navContextDispatchFromDashboard());

  const allQuiet =
    !operational.loading &&
    !refreshing &&
    kpiMetrics.readyForWo === 0 &&
    kpiMetrics.materialIssuePending === 0 &&
    kpiMetrics.rmccCases === 0 &&
    kpiMetrics.awaitProcurementOrGrn === 0 &&
    dispatchReadyCount === 0 &&
    dispatchBacklogCount === 0 &&
    !hasNoQtyContinuation;

  return (
    <div className={DASH_SHELL} data-testid="store-dispatch-dashboard">
      <div className={DASH_MAX}>
        <div className={dashboardShell.grid}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <DashboardWorkspaceHeader role="STORE" />
            {refreshing || operational.refreshing ? (
              <ErpRefreshingBadge className="shrink-0" />
            ) : null}
          </div>

          {pendingActions && selectedTab === "overview" ? (
            <PendingActionsDashboardCard
              count={pendingActions.count}
              loading={pendingActions.loading}
              error={pendingActions.error}
            />
          ) : null}

          <div
            className="erp-op-workspace-primary erp-card-surface flex flex-col gap-1 rounded-lg border border-slate-200/90 px-2.5 py-1.5 shadow-sm"
            role="tablist"
            aria-label="Store Operations workspace tabs"
            data-testid="store-workspace-tabs"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <StoreWorkspaceNavButton
                navKey="no-qty"
                selectedTab={selectedTab}
                label="NO_QTY Execution"
                icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden />}
                testId="store-quick-no-qty-execution"
                badgeCount={kpiMetrics.readyForWo}
                onClick={() => navigate(executionRegisterHref, { state: dashboardNav })}
              />
              <StoreWorkspaceNavButton
                navKey="rm-control"
                selectedTab={selectedTab}
                label="RM Control"
                icon={<PackageSearch className="h-3.5 w-3.5" aria-hidden />}
                testId="store-quick-rmcc"
                badgeCount={kpiMetrics.rmccCases}
                onClick={() => navigate(rmccHref, { state: dashboardRmccNav })}
              />
              <StoreWorkspaceNavButton
                navKey="material-issue"
                selectedTab={selectedTab}
                label="Material Issue"
                icon={<PackageMinus className="h-3.5 w-3.5" aria-hidden />}
                testId="store-quick-material-issue"
                badgeCount={kpiMetrics.materialIssuePending}
                onClick={() => navigate(materialIssueHref, { state: dashboardMaterialIssueNav })}
              />
              <StoreWorkspaceNavButton
                navKey="production-monitor"
                selectedTab={selectedTab}
                label="Production Monitor"
                icon={<Factory className="h-3.5 w-3.5" aria-hidden />}
                testId="store-quick-production-monitor"
                onClick={() => setStoreTab("production-monitor")}
              />
              <StoreWorkspaceNavButton
                navKey="dispatch"
                selectedTab={selectedTab}
                label="Dispatch"
                icon={<Truck className="h-3.5 w-3.5" aria-hidden />}
                testId="store-quick-dispatch"
                badgeCount={dispatchReadyCount}
                onClick={() => navigate("/dispatch?source=dashboard", { state: dashboardDispatchNav })}
              />
              <StoreWorkspaceNavButton
                navKey="procurement-grn"
                selectedTab={selectedTab}
                label="Procurement & GRN"
                icon={<Boxes className="h-3.5 w-3.5" aria-hidden />}
                testId="store-quick-procurement-grn"
                badgeCount={kpiMetrics.awaitProcurementOrGrn}
                onClick={() => navigate(procurementGrnHref)}
              />
              <StoreWorkspaceNavButton
                navKey="stock"
                selectedTab={selectedTab}
                label="Stock"
                icon={<Boxes className="h-3.5 w-3.5" aria-hidden />}
                testId="store-quick-stock"
                onClick={() => navigate("/stock?source=dashboard")}
              />
            </div>
          </div>

          {selectedTab === "production-monitor" ? (
            <StoreProductionMonitorPanel refreshTick={liveTick} />
          ) : null}

          {selectedTab === "overview" ? (
            <>
              <ErpKpiStrip
                className={cn(erpKpi.stripCompact, "text-[13px]")}
                role="toolbar"
                aria-label="Store execution metrics"
                data-testid="store-kpi-execution"
              >
                <ErpKpiSegment
                  type="button"
                  {...clickTo(executionRegisterHref, dashboardNav)}
                  aria-label="Ready for WO"
                >
                  <ErpKpiLabel>Ready for WO</ErpKpiLabel>
                  <ErpKpiValue tone={kpiMetrics.readyForWo > 0 ? "warn" : "muted"}>
                    {kpiMetrics.readyForWo}
                  </ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment
                  type="button"
                  {...clickTo(materialIssueHref, dashboardMaterialIssueNav)}
                  aria-label="Material Issue Pending"
                >
                  <ErpKpiLabel>Material Issue Pending</ErpKpiLabel>
                  <ErpKpiValue tone={kpiMetrics.materialIssuePending > 0 ? "warn" : "muted"}>
                    {kpiMetrics.materialIssuePending}
                  </ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment type="button" {...clickTo(rmccHref, dashboardRmccNav)} aria-label="RMCC Cases">
                  <ErpKpiLabel>RMCC Cases</ErpKpiLabel>
                  <ErpKpiValue tone={kpiMetrics.rmccCases > 0 ? "warn" : "muted"}>
                    {kpiMetrics.rmccCases}
                  </ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment
                  type="button"
                  {...clickTo(procurementGrnHref)}
                  aria-label="Await Procurement / GRN"
                >
                  <ErpKpiLabel>Await Procurement / GRN</ErpKpiLabel>
                  <ErpKpiValue tone={kpiMetrics.awaitProcurementOrGrn > 0 ? "warn" : "muted"}>
                    {kpiMetrics.awaitProcurementOrGrn}
                  </ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment
                  type="button"
                  {...clickTo("/dispatch?source=dashboard", dashboardDispatchNav)}
                  aria-label="Dispatch Ready"
                >
                  <ErpKpiLabel>Dispatch Ready</ErpKpiLabel>
                  <ErpKpiValue tone={dispatchReadyCount > 0 ? "warn" : "muted"}>
                    {dispatchReadyCount}
                  </ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment type="button" {...clickTo("/stock")} aria-label="Usable FG">
                  <ErpKpiLabel>Usable FG</ErpKpiLabel>
                  <ErpKpiValue>{formatQty(fgStockTotal)}</ErpKpiValue>
                </ErpKpiSegment>
              </ErpKpiStrip>

              {allQuiet ? <DashboardOpsClearStrip role="STORE" /> : null}

              {hasNoQtyContinuation && onNoQtyPrimaryAction ? (
                <NoQtyDashboardCompactPanel
                  rows={noQtyContinuationRows.slice(0, 5)}
                  allRows={noQtyContinuationRows}
                  flowBySo={noQtyFlowBySo}
                  viewerRole="STORE"
                  dispatchReadyCount={dispatchReadyCount}
                  truncated={noQtyContinuationTruncated}
                  viewAllHref="/no-qty-agreements?source=dashboard"
                  maxVisible={5}
                  onPrimaryAction={({ row, resolved }) => {
                    if (resolved.kind === "prepare_next_rs") {
                      void prepareNoQtyNextRequirementSheetAndNavigate({
                        salesOrderId: row.salesOrderId,
                        navigate,
                        toast,
                        navigateState: { from: "dashboard" },
                      });
                      return;
                    }
                    onNoQtyPrimaryAction({ row, resolved });
                  }}
                />
              ) : null}

              {showRmcc ? (
                <StoreRmccSummaryCard metrics={rmccMetrics} loading={operational.initialLoading} />
              ) : null}

              {showProcurement ? (
                <StoreProcurementMonitor
                  metrics={procurementMonitorMetrics}
                  loading={operational.initialLoading}
                />
              ) : null}

              {showDispatchReady ? (
                <Card className={cn(DASH_CARD_PRIMARY)} data-testid="store-dispatch-ready">
                  <CardHeader className="border-b border-slate-100 p-2 pb-1.5">
                    <CardTitle className="flex items-center gap-2 text-[14px] font-extrabold text-slate-950">
                      <Truck className="h-4 w-4 text-blue-700" aria-hidden />
                      Dispatch ready
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 p-2.5 pt-2">
                    {dispatchReady.slice(0, 6).map((d) => (
                      <StoreDashCard
                        key={d.key}
                        title={d.orderType === "NO_QTY" ? "Ready for shipment" : "Dispatch available"}
                        detail={`${displaySalesOrderNo(d.salesOrderId, d.salesOrderDocNo)} · ${d.customerName} · ${d.itemName} · ${formatQty(d.metricQty)}`}
                        actionLabel="Open dispatch"
                        href={d.href}
                        navState={d.href.includes("/dispatch") ? dashboardDispatchNav : undefined}
                      />
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {showPrepareHeadroom ? (
                <Card className={DASH_CARD} data-testid="store-dispatch-backlog">
                  <CardHeader className="border-b border-slate-100 p-2.5 pb-2">
                    <CardTitle className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
                      <Truck className="h-4 w-4 text-slate-600" aria-hidden />
                      Prepare headroom
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 p-2.5 pt-2">
                    {dispatchBacklogCount > 0 ? (
                      <StoreDashCard
                        title="Prepare headroom"
                        detail={`${dispatchBacklogCount} line(s) with positive dispatchable qty`}
                        actionLabel="Open dispatch"
                        href="/dispatch?source=dashboard"
                        navState={dashboardDispatchNav}
                      />
                    ) : null}
                    {backlogPreview.length > 0 ? (
                      <div className="erp-op-workspace-secondary rounded-md border border-slate-200/90 bg-slate-50/80 px-2 py-1.5">
                        <div className="text-[12px] font-semibold text-slate-600">
                          Lines with prepare headroom
                        </div>
                        <ul className="mt-1 space-y-1 text-[13px] text-slate-800">
                          {backlogPreview.slice(0, 5).map((r) => (
                            <li
                              key={`${r.salesOrderId}-${r.salesOrderLineId ?? r.itemId}-${r.cycleId ?? "x"}`}
                              className="truncate"
                            >
                              {displaySalesOrderNo(r.salesOrderId, r.salesOrderNo)} · {r.itemName} ·{" "}
                              <span className="tabular-nums font-medium">
                                {formatQty(Number(r.dispatchableNow ?? 0))}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
