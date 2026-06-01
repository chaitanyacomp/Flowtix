import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { ApiRequestError, apiFetch } from "../../services/api";
import { cn } from "../../lib/utils";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import {
  formatNoQtyDashboardHistoryQty,
  isNoQtyHistoryCurrentCycleRow,
  type NoQtyDashboardCycleHistoryPayload,
  type NoQtyDashboardCycleHistoryRow,
} from "../../lib/noQtyDashboardCycleHistory";
import { Button } from "../ui/button";
import { ErpModal } from "./ErpModal";

function statusChipClass(status: string): string {
  const u = String(status).toUpperCase();
  if (u === "COMPLETED" || u === "CLOSED") {
    return "bg-emerald-50 text-emerald-900 ring-emerald-200";
  }
  if (u === "PLANNING PENDING" || u === "DRAFT") {
    return "bg-blue-50 text-blue-900 ring-blue-200";
  }
  if (u === "IN PROCESS") {
    return "bg-amber-50 text-amber-950 ring-amber-200";
  }
  return "bg-slate-50 text-slate-800 ring-slate-200";
}

export function NoQtyDashboardCycleHistoryDialog(props: {
  open: boolean;
  onClose: () => void;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName?: string | null;
}) {
  const { open, onClose, salesOrderId, salesOrderDocNo, customerName } = props;

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [payload, setPayload] = React.useState<NoQtyDashboardCycleHistoryPayload | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);

    (async () => {
      try {
        if (!Number.isFinite(Number(salesOrderId)) || Number(salesOrderId) <= 0) {
          if (!cancelled) {
            setPayload({
              salesOrderId: 0,
              cycles: [],
              currentCycle: null,
              currentCycleId: null,
              currentCycleNo: null,
              rows: [],
            });
          }
          return;
        }
        const data = await apiFetch<NoQtyDashboardCycleHistoryPayload>(
          `/api/dashboard/no-qty-cycle-history?soId=${encodeURIComponent(String(salesOrderId))}`,
        );
        if (!cancelled) setPayload(data ?? null);
      } catch (e) {
        if (!cancelled) {
          const backendDetail =
            e instanceof ApiRequestError &&
            e.message === "Dashboard failed" &&
            typeof e.body?.error === "string" &&
            e.body.error.trim()
              ? e.body.error.trim()
              : null;
          setError(backendDetail ?? (e instanceof Error ? e.message : "Failed to load cycle history"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, salesOrderId]);

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const rows = payload?.rows ?? [];

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <ErpModal
      onClose={onClose}
      closeOnBackdropClick
      backdropClassName="z-[60] items-center justify-center bg-black/40 p-4 sm:p-6"
      aria-labelledby="no-qty-cycle-history-title"
    >
      <div
        className={cn(
          "flex w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl",
          "max-h-[min(88vh,640px)]",
        )}
      >
        {/* Header — fixed height band, close aligned top-right */}
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 pr-1">
              <h2 id="no-qty-cycle-history-title" className="text-sm font-semibold tracking-tight text-slate-900">
                Cycle history
              </h2>
              <p className="mt-1 text-[11px] leading-snug text-slate-600">
                <span className="font-mono font-semibold tabular-nums text-slate-800">
                  {displaySalesOrderNo(salesOrderId, salesOrderDocNo ?? null)}
                </span>
                {customerName ? (
                  <>
                    <span className="mx-1.5 text-slate-300" aria-hidden>
                      ·
                    </span>
                    <span className="font-medium text-slate-700">{customerName}</span>
                  </>
                ) : null}
                {!loading && payload?.currentCycleNo != null ? (
                  <>
                    <span className="mx-1.5 text-slate-300" aria-hidden>
                      ·
                    </span>
                    <span className="font-semibold text-blue-900">Current cycle {payload.currentCycleNo}</span>
                  </>
                ) : null}
              </p>
              <p className="mt-1 text-[10px] leading-snug text-slate-500">
                Operational continuity — planned, produced, shortage, and carry-forward by cycle.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-slate-600 hover:text-slate-900"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Body — scrollable table / states */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto bg-white px-4 py-3">
          {loading ? (
            <div className="flex min-h-[8rem] items-center justify-center">
              <p className="text-[13px] text-slate-600">Loading cycle history…</p>
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-[13px] text-red-800">{error}</p>
            </div>
          ) : null}
          {!loading && !error && rows.length === 0 ? (
            <div className="flex min-h-[8rem] items-center justify-center">
              <p className="text-[13px] text-slate-600">No cycle history available yet.</p>
            </div>
          ) : null}
          {!loading && rows.length > 0 ? (
            <div className="erp-table-wrap overflow-hidden">
              <table className="erp-table w-full min-w-[680px] text-[12px]">
                <thead className="sticky top-0 z-[1] bg-slate-50/95 shadow-[0_1px_0_0_rgb(226_232_240)] backdrop-blur-[2px]">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Cycle</th>
                    <th className="px-2 py-1.5 text-left">RS</th>
                    <th className="px-2 py-1.5 text-right">Planned</th>
                    <th className="px-2 py-1.5 text-right">Produced</th>
                    <th className="px-2 py-1.5 text-right">Shortage</th>
                    <th className="px-2 py-1.5 text-right">CF added</th>
                    <th className="px-2 py-1.5 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <CycleHistoryTableRow
                      key={`cyc-hist-${r.cycleNo}-${r.cycleId}`}
                      row={r}
                      payload={payload}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <footer className="shrink-0 border-t border-slate-200 bg-slate-50/90 px-4 py-2.5">
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" className="min-w-[5.5rem]" onClick={onClose}>
              Close
            </Button>
          </div>
        </footer>
      </div>
    </ErpModal>,
    document.body,
  );
}

function CycleHistoryTableRow({
  row,
  payload,
}: {
  row: NoQtyDashboardCycleHistoryRow;
  payload: NoQtyDashboardCycleHistoryPayload | null;
}) {
  const isCurrent = payload ? isNoQtyHistoryCurrentCycleRow(row, payload) : false;
  return (
    <tr className={cn(isCurrent && "bg-blue-50/60", "border-t border-slate-100 first:border-t-0")}>
      <td className="px-2 py-1.5 font-semibold tabular-nums text-slate-900">
        {row.cycleNo}
        {isCurrent ? (
          <span className="ml-1.5 inline-flex rounded bg-blue-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-blue-900">
            Now
          </span>
        ) : null}
      </td>
      <td className="max-w-[12rem] truncate px-2 py-1.5 text-slate-800" title={row.rsLabel}>
        {row.rsLabel}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-900">
        {formatNoQtyDashboardHistoryQty(row.plannedQty)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-900">
        {formatNoQtyDashboardHistoryQty(row.producedQty)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-amber-900">
        {formatNoQtyDashboardHistoryQty(row.shortageQty)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">
        {formatNoQtyDashboardHistoryQty(row.carryForwardAddedQty)}
      </td>
      <td className="px-2 py-1.5">
        <span
          className={cn(
            "inline-flex rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1",
            statusChipClass(row.statusLabel),
          )}
        >
          {row.statusLabel}
        </span>
      </td>
    </tr>
  );
}
