/**
 * Shared SO → WO → Production → QC → Dispatch trace table (read-only).
 * Owned by Customer Tracking Report (Production Journey). Presentation only (FT-PD-065 RPT-01).
 */
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export type SoDispatchTraceCell = {
  label: string | null;
  date: string | null;
  detailLines?: string[];
};

export type SoDispatchTraceRow = {
  rowKey: string;
  salesOrder: SoDispatchTraceCell;
  workOrder: SoDispatchTraceCell;
  production: SoDispatchTraceCell;
  qc: SoDispatchTraceCell;
  dispatch: SoDispatchTraceCell;
};

export type SoDispatchTraceSummaryItem = {
  salesOrderId: number;
  salesOrderNo: string;
  orderType?: string | null;
  cycleNo?: number | null;
  soQty: number | null;
  dispatchQty: number;
  balanceQty: number | null;
};

function formatSummaryQty(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const r = Math.round(n * 1000) / 1000;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return String(r);
}

function formatTraceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-GB", { month: "short" });
  const y = d.getFullYear();
  return `(${dd}-${mon}-${y})`;
}

export function SoDispatchTraceCellDisplay({ cell }: { cell: SoDispatchTraceCell }) {
  if (!cell.label) {
    return <span className="text-slate-400">—</span>;
  }
  const details = cell.detailLines ?? [];
  return (
    <div className="leading-tight">
      <div className="font-semibold text-slate-900">{cell.label}</div>
      {cell.date ? <div className="text-[11px] text-slate-500">{formatTraceDate(cell.date)}</div> : null}
      {details.map((line, i) => (
        <div key={i} className="text-xs text-slate-600">
          {line}
        </div>
      ))}
    </div>
  );
}

export type SoDispatchTraceTableProps = {
  rows: SoDispatchTraceRow[];
  loading?: boolean;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  soSummaries?: SoDispatchTraceSummaryItem[];
  showSoSummaryAside?: boolean;
  emptyMessage?: string;
  className?: string;
  compact?: boolean;
};

export function SoDispatchTraceTable({
  rows,
  loading = false,
  page = 1,
  pageSize = 50,
  total = 0,
  totalPages = 1,
  onPageChange,
  soSummaries = [],
  showSoSummaryAside = false,
  emptyMessage = "No production journey rows for this order yet.",
  className,
  compact = false,
}: SoDispatchTraceTableProps) {
  const showPager = Boolean(onPageChange) && totalPages > 1;

  return (
    <div className={cn("flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4", className)}>
      <div className="relative min-w-0 flex-1">
        {loading ? (
          <div
            className="pointer-events-none absolute inset-0 z-[1] flex items-start justify-center bg-white/55 pt-8"
            aria-busy
          >
            <span className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm">
              Loading…
            </span>
          </div>
        ) : null}
        <div className={cn("erp-table-wrap overflow-x-auto", loading ? "opacity-60" : "")}>
          <table className={cn("erp-table w-full text-sm", compact ? "min-w-[640px]" : "min-w-[720px]")}>
            <thead>
              <tr className="border-b text-left text-slate-600">
                <th className="py-2 pr-3 align-top">
                  <div className="font-semibold text-slate-800">Sales order</div>
                  {!compact ? (
                    <div className="text-[10px] font-normal normal-case text-slate-500">Doc · date · ordered qty</div>
                  ) : null}
                </th>
                <th className="py-2 pr-3 align-top">
                  <div className="font-semibold text-slate-800">Work order</div>
                </th>
                <th className="py-2 pr-3 align-top">
                  <div className="font-semibold text-slate-800">Production</div>
                </th>
                <th className="py-2 pr-3 align-top">
                  <div className="font-semibold text-slate-800">QC</div>
                </th>
                <th className="py-2 pr-3 align-top">
                  <div className="font-semibold text-slate-800">Dispatch</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-slate-600">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.rowKey} className="border-t border-slate-100">
                    <td className="align-top py-2 pr-3">
                      <SoDispatchTraceCellDisplay cell={r.salesOrder} />
                    </td>
                    <td className="align-top py-2 pr-3">
                      <SoDispatchTraceCellDisplay cell={r.workOrder} />
                    </td>
                    <td className="align-top py-2 pr-3">
                      <SoDispatchTraceCellDisplay cell={r.production} />
                    </td>
                    <td className="align-top py-2 pr-3">
                      <SoDispatchTraceCellDisplay cell={r.qc} />
                    </td>
                    <td className="align-top py-2 pr-3">
                      <SoDispatchTraceCellDisplay cell={r.dispatch} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {showPager ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
            <span>
              {total === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => onPageChange?.(Math.max(1, page - 1))}
              >
                Previous
              </Button>
              <span className="tabular-nums">
                Page {page} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => onPageChange?.(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {showSoSummaryAside ? (
        <aside className="w-full shrink-0 border-t border-slate-200 pt-3 lg:w-[min(100%,280px)] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <div className="mb-2 border-b border-slate-100 pb-2">
            <h3 className="text-sm font-semibold text-slate-800">SO summary</h3>
          </div>
          {soSummaries.length === 0 ? (
            <p className="text-xs text-slate-500">No sales orders in scope.</p>
          ) : (
            <ul className="space-y-2">
              {soSummaries.map((s) => {
                const isNoQty = s.orderType === "NO_QTY";
                const pending = !isNoQty && (s.balanceQty ?? 0) > 1e-9;
                return (
                  <li
                    key={s.salesOrderId}
                    className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">SO No</span>
                      <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-sky-900">
                        {s.salesOrderNo}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1 text-sm tabular-nums">
                      {isNoQty ? (
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-600">Total dispatched</span>
                          <span className="font-medium text-slate-900">{formatSummaryQty(s.dispatchQty)}</span>
                        </div>
                      ) : (
                        <>
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-600">SO Qty</span>
                            <span className="font-medium text-slate-900">{formatSummaryQty(s.soQty)}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-600">Dispatched</span>
                            <span className="font-medium text-slate-900">{formatSummaryQty(s.dispatchQty)}</span>
                          </div>
                          <div className={cn("flex justify-between gap-3", pending && "font-semibold text-amber-950")}>
                            <span className={pending ? "text-amber-900" : "text-slate-600"}>Balance</span>
                            <span>{formatSummaryQty(s.balanceQty)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      ) : null}
    </div>
  );
}
