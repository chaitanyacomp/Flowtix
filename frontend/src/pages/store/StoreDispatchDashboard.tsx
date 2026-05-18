import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Boxes,
  ChevronRight,
  Clock,
  FileText,
  Package,
  Receipt,
  Truck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { buttonVariants } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import { ErpEmptyState } from "../../components/erp/foundation/ErpEmptyState";
import { ErpKpiStrip, ErpKpiSegment, ErpKpiLabel, ErpKpiValue } from "../../components/erp/foundation/ErpKpiStrip";
import { ErpActionButton } from "../../components/erp/foundation/ErpActionButton";
import type { DispatchBacklogRow } from "../../lib/dispatchBacklog";
import { dashboardShell } from "../../lib/dashboardShell";
import { DashboardOpsClearStrip, DashboardWorkspaceHeader } from "../../components/erp/foundation";
import { erpKpi } from "../../lib/erpFoundationTokens";

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

type StoreDashboardSummary = {
  fgStockTotalQty: number;
  pendingDispatchCount: number;
  purchasePending: number;
  fgStock: { itemId: number; itemName: string; qty: number }[];
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
  tier = "ready",
  icon,
}: {
  title: string;
  detail: string;
  actionLabel: string;
  href: string;
  tier?: "ready" | "supply";
  icon?: React.ReactNode;
}) {
  const tierClass =
    tier === "supply"
      ? "border-violet-200/75 bg-violet-50/35 border-l-[3px] border-l-violet-500"
      : "border-slate-200/95 bg-white border-l-[3px] border-l-blue-600";

  return (
    <Link
      to={href}
      state={{ from: "dashboard" }}
      className={cn(
        "group block rounded-lg border px-3 py-2.5 shadow-sm transition-colors hover:border-slate-300 hover:shadow-md",
        tierClass,
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

export type StoreDispatchDashboardProps = {
  summary: StoreDashboardSummary | null;
  dispatchReady: StoreDispatchActionRow[];
  billingPending: StoreDispatchActionRow[];
  backlogPreview: DispatchBacklogRow[];
  purchaseLineCount: number;
  rmAlertCount: number;
};

export function StoreDispatchDashboard({
  summary,
  dispatchReady,
  billingPending,
  backlogPreview,
  purchaseLineCount,
  rmAlertCount,
}: StoreDispatchDashboardProps) {
  const navigate = useNavigate();

  const clickTo = (to: string) => ({
    onClick: () => navigate(to, { state: { from: "dashboard" } }),
  });

  const dispatchReadyCount = dispatchReady.length;
  const billingCount = billingPending.length;
  const fgTotal = summary?.fgStockTotalQty ?? 0;
  const dispatchBacklog = summary?.pendingDispatchCount ?? 0;
  const topFg = summary?.fgStock?.slice(0, 5) ?? [];

  const allQuiet =
    dispatchReadyCount === 0 &&
    billingCount === 0 &&
    dispatchBacklog === 0 &&
    purchaseLineCount === 0;

  return (
    <div className={DASH_SHELL}>
      <div className={DASH_MAX}>
        <div className={dashboardShell.grid}>
          <DashboardWorkspaceHeader role="STORE" />

          <div className="erp-op-workspace-primary erp-card-surface flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/90 px-2.5 py-1.5 shadow-sm">
            <ErpActionButton tier="primary" className="gap-1.5" onClick={() => navigate("/dispatch?source=dashboard")}>
              <Truck className="h-3.5 w-3.5" aria-hidden />
              Open dispatch
            </ErpActionButton>
            <ErpActionButton
              tier="secondary"
              className="gap-1.5"
              onClick={() => navigate("/sales-bills?source=dashboard")}
            >
              <Receipt className="h-3.5 w-3.5" aria-hidden />
              Pending sales bills
            </ErpActionButton>
            <ErpActionButton tier="secondary" className="gap-1.5" onClick={() => navigate("/stock?source=dashboard")}>
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              FG stock overview
            </ErpActionButton>
          </div>

          {summary ? (
            <div className="max-w-full overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ErpKpiStrip className={erpKpi.stripCompact} role="toolbar" aria-label="Dispatch desk metrics">
                <ErpKpiSegment type="button" {...clickTo("/dispatch")} aria-label="Ready to dispatch">
                  <ErpKpiLabel>Ready to dispatch</ErpKpiLabel>
                  <ErpKpiValue tone={dispatchReadyCount > 0 ? "warn" : "muted"}>{dispatchReadyCount}</ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment type="button" {...clickTo("/sales-bills?source=dashboard")} aria-label="Pending billing">
                  <ErpKpiLabel>Pending billing</ErpKpiLabel>
                  <ErpKpiValue tone={billingCount > 0 ? "warn" : "muted"}>{billingCount}</ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment type="button" {...clickTo("/stock")} aria-label="FG usable">
                  <ErpKpiLabel>FG usable</ErpKpiLabel>
                  <ErpKpiValue>{fgTotal.toFixed(2)}</ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment type="button" {...clickTo("/reports/dispatch-summary")} aria-label="Dispatch backlog">
                  <ErpKpiLabel>Dispatch backlog</ErpKpiLabel>
                  <ErpKpiValue tone={dispatchBacklog > 0 ? "warn" : "muted"}>{dispatchBacklog}</ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment type="button" {...clickTo("/stock?source=dashboard")} aria-label="RM alerts">
                  <ErpKpiLabel>RM alerts</ErpKpiLabel>
                  <ErpKpiValue tone={rmAlertCount > 0 ? "crit" : "muted"}>{rmAlertCount}</ErpKpiValue>
                </ErpKpiSegment>
              </ErpKpiStrip>
            </div>
          ) : null}

          {allQuiet ? <DashboardOpsClearStrip role="STORE" /> : null}

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
                  <ErpEmptyState
                    variant="inline"
                    title="No lines ready to ship"
                    body="QC-passed stock will appear here when dispatchable."
                  />
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

            <Card className={cn(billingCount > 0 ? DASH_CARD_PRIMARY : DASH_CARD)}>
              <CardHeader className="border-b border-slate-100 p-2 pb-1.5">
                <CardTitle className="flex items-center gap-2 text-[13px] font-extrabold text-slate-950">
                  <Receipt className="h-4 w-4 text-violet-700" aria-hidden />
                  Sales billing pending
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-2.5 pt-2">
                {billingCount === 0 ? (
                  <ErpEmptyState
                    variant="inline"
                    title="No finalized dispatches awaiting billing"
                    body="Locked dispatches without a sales bill will appear here."
                  />
                ) : (
                  billingPending.slice(0, 6).map((b) => (
                    <StoreDashCard
                      key={b.key}
                      tier="supply"
                      icon={<FileText className="h-4 w-4" />}
                      title="Create sales bill"
                      detail={`${displaySalesOrderNo(b.salesOrderId, b.salesOrderDocNo)} · ${b.customerName} · ${b.itemName}`}
                      actionLabel="Open billing"
                      href={b.href}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card className={DASH_CARD}>
              <CardHeader className="border-b border-slate-100 p-2.5 pb-2">
                <CardTitle className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
                  <Package className="h-4 w-4 text-emerald-700" aria-hidden />
                  FG usable snapshot
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2.5 pt-2">
                {topFg.length === 0 ? (
                  <ErpEmptyState variant="inline" title="Finished goods stock is currently stable" body="No FG rows in snapshot." />
                ) : (
                  <div className="overflow-hidden rounded-md border border-slate-200">
                    <table className="erp-table erp-table-dense w-full text-[12px]">
                      <thead>
                        <tr>
                          <th className="text-left">Item</th>
                          <th className="text-right">Usable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topFg.map((fg) => (
                          <tr key={fg.itemId}>
                            <td className="max-w-[12rem] truncate text-slate-800" title={fg.itemName}>
                              {fg.itemName}
                            </td>
                            <td className="text-right tabular-nums font-semibold">{fg.qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-2 text-right">
                  <Link
                    to="/stock?source=dashboard"
                    className="text-[11px] font-semibold text-sky-800 hover:underline"
                    state={{ from: "dashboard" }}
                  >
                    Full stock overview →
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className={DASH_CARD}>
              <CardHeader className="border-b border-slate-100 p-2.5 pb-2">
                <CardTitle className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
                  <Clock className="h-4 w-4 text-slate-600" aria-hidden />
                  Dispatch queues
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-2.5 pt-2">
                {purchaseLineCount > 0 ? (
                  <StoreDashCard
                    tier="supply"
                    title="Material receipts pending"
                    detail={`${purchaseLineCount} PO line(s) awaiting GRN`}
                    actionLabel="Material planning"
                    href="/rm-po-grn?source=dashboard"
                  />
                ) : null}
                {dispatchBacklog > 0 ? (
                  <StoreDashCard
                    title="Dispatch backlog"
                    detail={`${dispatchBacklog} line(s) in dispatch prep`}
                    actionLabel="Dispatch summary"
                    href="/reports/dispatch-summary"
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
                {purchaseLineCount === 0 && dispatchBacklog === 0 && backlogPreview.length === 0 ? (
                  <ErpEmptyState variant="inline" title="Dispatch operations are clear" body="No prep queues or receipts pending." />
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
