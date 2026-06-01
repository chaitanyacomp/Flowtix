import * as React from "react";
import { Link } from "react-router-dom";
import { PlayCircle } from "lucide-react";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { useToast } from "../../../contexts/ToastContext";
import { formatProductionQty } from "../../../lib/dashboardProductionStatus";
import { displayWorkOrderTraceNo } from "../../../lib/docNoDisplay";
import { resumeWorkOrderApi } from "../../../lib/workOrderLifecycle";
import { productionHrefFromDashboardRow } from "../../../lib/operationalWorkspaceLinks";

export type PausedWorkOrderRow = {
  workOrderId: number;
  workOrderNo?: string | null;
  workOrderLineId: number;
  salesOrderId: number;
  salesOrderNo?: string | null;
  customerName?: string | null;
  itemName: string;
  plannedQty: number;
  producedQty: number;
  qcAcceptedQty: number;
  dispatchedQty: number;
  reservedFgQty: number;
  customerPendingQty: number;
  remainingProductionQty: number;
  pausedAt?: string | null;
  actionHref?: string | null;
};

export function DashboardPausedWorkOrders({
  rows,
  loading,
  error,
  rowLimit = 6,
  className,
  onResumed,
}: {
  rows: PausedWorkOrderRow[] | null;
  loading?: boolean;
  error?: string | null;
  rowLimit?: number;
  className?: string;
  onResumed?: () => void;
}) {
  const { showSuccess, showError } = useToast();
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const visible = (rows ?? []).slice(0, rowLimit);
  const total = rows?.length ?? 0;

  if (!loading && !error && rows !== null && total === 0) {
    return null;
  }

  async function handleResume(workOrderId: number) {
    setBusyId(workOrderId);
    try {
      await resumeWorkOrderApi(workOrderId);
      showSuccess("Work order resumed.");
      onResumed?.();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Resume failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      aria-label="Paused Work Orders"
      className={cn(
        "erp-dash-paused-work-orders rounded-lg border border-amber-200/80 bg-amber-50/40 shadow-sm",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/70 px-2.5 py-1">
        <div className="min-w-0">
          <h2 className="text-[13px] font-extrabold tracking-tight text-amber-950">Paused Work Orders</h2>
          <p className="text-[11px] text-amber-900/80">Accepted FG is reserved to the originating sales order.</p>
        </div>
        {total > 0 ? (
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[12px] font-bold tabular-nums text-amber-950">
            {total}
          </span>
        ) : null}
      </header>

      <div className="px-2.5 py-1">
        {error ? (
          <p className="rounded-md border border-amber-200/80 bg-white px-2 py-1 text-[12px] text-amber-950">{error}</p>
        ) : null}
        {loading && rows === null ? <p className="py-1 text-[12px] text-amber-900/80">Loading…</p> : null}
        {visible.length > 0 ? (
          <ul className="divide-y divide-amber-200/70">
            {visible.map((row) => {
              const href = productionHrefFromDashboardRow({
                orderType: "NORMAL",
                salesOrderId: row.salesOrderId,
                workOrderId: row.workOrderId,
                workOrderLineId: row.workOrderLineId,
                actionHref: row.actionHref ?? undefined,
              });
              const key = `${row.workOrderId}-${row.workOrderLineId}`;
              return (
                <li key={key} className="py-1.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Link to={href} className="text-[13px] font-bold tabular-nums text-amber-950 no-underline hover:underline">
                          {row.workOrderNo ?? displayWorkOrderTraceNo(row.workOrderId)}
                        </Link>
                        <span className="text-amber-400" aria-hidden>
                          ·
                        </span>
                        <span className="text-[12px] font-semibold text-amber-900">{row.salesOrderNo ?? `SO-${row.salesOrderId}`}</span>
                        <span className="text-amber-400" aria-hidden>
                          ·
                        </span>
                        <span className="max-w-[10rem] truncate text-[12px] text-amber-900">{row.customerName ?? "—"}</span>
                      </div>
                      <div className="mt-0.5 text-[12px] font-medium text-amber-950">{row.itemName}</div>
                      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-amber-900 sm:grid-cols-3">
                        <div>
                          <dt className="text-amber-800/80">Reserved FG</dt>
                          <dd className="font-bold tabular-nums">{formatProductionQty(row.reservedFgQty)}</dd>
                        </div>
                        <div>
                          <dt className="text-amber-800/80">Customer pending</dt>
                          <dd className="font-bold tabular-nums">{formatProductionQty(row.customerPendingQty)}</dd>
                        </div>
                        <div>
                          <dt className="text-amber-800/80">Remaining production</dt>
                          <dd className="font-bold tabular-nums">{formatProductionQty(row.remainingProductionQty)}</dd>
                        </div>
                        <div>
                          <dt className="text-amber-800/80">Produced</dt>
                          <dd className="font-semibold tabular-nums">{formatProductionQty(row.producedQty)}</dd>
                        </div>
                        <div>
                          <dt className="text-amber-800/80">QC accepted</dt>
                          <dd className="font-semibold tabular-nums">{formatProductionQty(row.qcAcceptedQty)}</dd>
                        </div>
                        <div>
                          <dt className="text-amber-800/80">Dispatched</dt>
                          <dd className="font-semibold tabular-nums">{formatProductionQty(row.dispatchedQty)}</dd>
                        </div>
                      </dl>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 shrink-0 gap-1 bg-amber-800 text-white hover:bg-amber-900"
                      disabled={busyId != null}
                      onClick={() => void handleResume(row.workOrderId)}
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                      {busyId === row.workOrderId ? "Resuming…" : "Resume Production"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
