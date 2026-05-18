import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  buildDashboardProductionStatusRows,
  formatProductionQty,
  type DashboardProductionStatusSource,
  type ProductionOperationalStatusTone,
} from "../../../lib/dashboardProductionStatus";
import { resolveNoQtyCycleDisplayStatus } from "../../../lib/noQtyCycleDisplayStatus";
import { noQtyOperatorThirdColumn } from "../../../lib/noQtyShortagePresentation";
import { DashboardViewAllLink } from "./DashboardControlColumn";
import { displayWorkOrderTraceNo } from "../../../lib/docNoDisplay";
import { productionHrefFromDashboardRow } from "../../../lib/operationalWorkspaceLinks";

const STATUS_TONE_CLASS: Record<ProductionOperationalStatusTone, string> = {
  running: "bg-emerald-100 text-emerald-950 ring-emerald-200/80",
  qc: "bg-amber-100 text-amber-950 ring-amber-200/80",
  partial: "bg-sky-100 text-sky-950 ring-sky-200/80",
  carryForward: "bg-amber-100 text-amber-950 ring-amber-300/80",
  carriedForward: "bg-slate-100 text-slate-700 ring-slate-200/80",
  dispatch: "bg-violet-100 text-violet-950 ring-violet-200/80",
  idle: "bg-slate-100 text-slate-700 ring-slate-200/80",
};

const PROGRESS_TONE_CLASS: Record<ProductionOperationalStatusTone, string> = {
  running: "bg-emerald-600",
  qc: "bg-amber-500",
  partial: "bg-sky-600",
  carryForward: "bg-amber-500",
  carriedForward: "bg-slate-400",
  dispatch: "bg-violet-600",
  idle: "bg-slate-400",
};

export function DashboardCurrentProductionStatus({
  rows,
  loading,
  error,
  rowLimit = 8,
  className,
}: {
  rows: DashboardProductionStatusSource[] | null;
  loading?: boolean;
  error?: string | null;
  rowLimit?: number;
  className?: string;
}) {
  const { visible, activeCount, carriedForwardCount, totalInQueue } = React.useMemo(
    () => buildDashboardProductionStatusRows(rows ?? [], { limit: rowLimit }),
    [rows, rowLimit],
  );

  return (
    <section
      aria-label="Current Production Status"
      className={cn(
        "erp-dash-production-status rounded-lg border border-slate-300/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04]",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-gradient-to-r from-slate-50/95 to-white px-2.5 py-1.5">
        <div className="min-w-0">
          <h2 className="text-[14px] font-extrabold tracking-tight text-slate-950">Current Production Status</h2>
          <p className="text-[12px] font-medium text-slate-600">Live shop-floor · newest WO first</p>
        </div>
        {totalInQueue > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-bold tabular-nums text-slate-800">
              {activeCount} active
            </span>
            {carriedForwardCount > 0 ? (
              <span className="rounded-md bg-slate-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600 ring-1 ring-slate-200/80">
                {carriedForwardCount} carried
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="p-1.5 md:p-2">
        {error ? (
          <p className="rounded-md border border-amber-200/80 bg-amber-50/60 px-2 py-1.5 text-[12px] text-amber-950">
            {error}
          </p>
        ) : null}
        {loading && rows === null ? (
          <p className="px-1 py-2 text-[13px] text-slate-600">Loading production status…</p>
        ) : null}
        {!loading && rows !== null && visible.length === 0 ? (
          <p className="px-1 py-2 text-[13px] text-slate-600">No production lines in queue.</p>
        ) : null}
        {!loading && rows !== null && visible.length > 0 && activeCount === 0 ? (
          <p className="mb-1 px-1 text-[12px] text-slate-600">No shop-floor actions pending — carried-forward history below.</p>
        ) : null}
        {visible.length > 0 ? (
          <ul className="divide-y divide-slate-200/80">
            {visible.map((row) => {
              const href = productionHrefFromDashboardRow({
                orderType: row.orderType,
                salesOrderId: row.salesOrderId,
                workOrderId: row.workOrderId,
                workOrderLineId: row.workOrderLineId,
                cycleId: row.cycleId ?? null,
                actionHref: row.actionHref,
              });
              const key = `${row.workOrderId}-${row.workOrderLineId ?? row.itemName}`;
              const thirdCol = noQtyOperatorThirdColumn({
                orderType: row.orderType,
                lastShortageQty: row.lastShortageQty,
                nextAction: row.nextAction,
                operationalStatus: row.operationalStatus,
                remainingQty: row.remainingQty,
                requiredQty: row.requiredQty,
                producedQty: row.producedQty,
              });
              const thirdQty = thirdCol.qty;
              const isCarried = !row.countsAsActive;
              const statusLabel =
                row.orderType === "NO_QTY"
                  ? resolveNoQtyCycleDisplayStatus({ ...row, allQueueRows: rows ?? [] }).label
                  : row.operationalStatus.label;
              return (
                <li key={key} className={cn(isCarried && "bg-slate-50/50")}>
                  <Link
                    to={href}
                    state={{ from: "dashboard" }}
                    className="group grid grid-cols-1 gap-2 rounded-md px-1.5 py-1.5 no-underline transition-colors hover:bg-slate-50/90 sm:grid-cols-[minmax(0,1fr)_minmax(10.5rem,auto)_minmax(7.5rem,auto)] sm:items-center sm:gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[13px] font-bold tabular-nums text-slate-950">
                          {displayWorkOrderTraceNo(row.workOrderId)}
                        </span>
                        <span className="text-slate-300" aria-hidden>
                          ·
                        </span>
                        <span className="max-w-[10rem] truncate text-[13px] font-semibold text-slate-800">
                          {row.customerName ?? "—"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-slate-700">
                        <span className="max-w-[14rem] truncate font-medium" title={row.itemName}>
                          {row.itemName}
                        </span>
                        <span className="text-slate-400" aria-hidden>
                          ·
                        </span>
                        <span className="font-semibold text-slate-600">{row.flowLabel}</span>
                      </div>
                      {row.operationalStatus.contextHint ? (
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{row.operationalStatus.contextHint}</p>
                      ) : null}
                    </div>

                    <div className="min-w-[10.5rem] shrink-0 sm:text-right">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {row.orderType === "NO_QTY" ? "Planned / Prod / Pending" : "Planned / Prod / Rem"}
                      </div>
                      <div className="whitespace-nowrap text-[12px] font-bold tabular-nums text-slate-900">
                        {formatProductionQty(row.requiredQty)} / {formatProductionQty(row.producedQty)} /{" "}
                        {formatProductionQty(thirdQty)}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-start justify-end gap-1.5 sm:items-center">
                      <div className="flex min-w-[7.25rem] max-w-[8.5rem] flex-col items-end gap-0.5">
                        <span
                          className={cn(
                            "inline-flex max-w-full shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-tight ring-1 sm:text-[11px]",
                            STATUS_TONE_CLASS[row.operationalStatus.tone],
                          )}
                        >
                          {statusLabel}
                        </span>
                        {row.showProgressBar ? (
                          <div className="h-1.5 w-full min-w-[4.5rem] overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                PROGRESS_TONE_CLASS[row.operationalStatus.tone],
                              )}
                              style={{ width: `${row.progressPct}%` }}
                            />
                          </div>
                        ) : null}
                      </div>
                      <ChevronRight
                        className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-700 sm:mt-0"
                        aria-hidden
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        {totalInQueue > rowLimit ? (
          <footer className="mt-1 border-t border-slate-100 pt-1">
            <DashboardViewAllLink href="/production?source=dashboard" label={`View all ${totalInQueue} lines`} />
          </footer>
        ) : null}
      </div>
    </section>
  );
}
