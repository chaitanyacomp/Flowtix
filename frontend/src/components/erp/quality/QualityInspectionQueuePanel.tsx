import * as React from "react";
import { cn } from "../../../lib/utils";
import { PRODUCTION_QA_TERMS } from "../../../lib/productionQaTerminology";
import type { QualityQueueRow } from "../../../lib/qcWorkspaceUx";

const PAGE_SIZE = 6;

type Props = {
  rows: QualityQueueRow[];
  activeRowId?: string | null;
  onSelectRow: (row: QualityQueueRow) => void;
  loading?: boolean;
  className?: string;
  /** Optional search filter applied to label/subtitle. */
  filterText?: string;
  onFilterTextChange?: (value: string) => void;
};

/**
 * Single Quality Queue — left workbench panel.
 * Rows identify batches by Production Entry / Batch ID, not only WO + product.
 */
export function QualityInspectionQueuePanel({
  rows,
  activeRowId,
  onSelectRow,
  loading,
  className,
  filterText = "",
  onFilterTextChange,
}: Props) {
  const q = filterText.trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (r) =>
          r.label.toLowerCase().includes(q) ||
          r.subtitle.toLowerCase().includes(q) ||
          String(r.productionDocNo ?? "").toLowerCase().includes(q) ||
          String(r.workOrderLabel ?? "").toLowerCase().includes(q),
      )
    : rows;

  const [page, setPage] = React.useState(0);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  React.useEffect(() => {
    setPage(0);
  }, [filterText, rows.length]);

  React.useEffect(() => {
    if (!activeRowId) return;
    const idx = visible.findIndex((r) => r.id === activeRowId);
    if (idx < 0) return;
    const target = Math.floor(idx / PAGE_SIZE);
    setPage((cur) => (cur === target ? cur : target));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- page by active id within current filter
  }, [activeRowId, filterText, rows]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm",
        className,
      )}
      data-testid="quality-inspection-queue"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <h2 className="text-[14px] font-semibold text-slate-900">{PRODUCTION_QA_TERMS.QUALITY_QUEUE}</h2>
        {!loading ? (
          <span className="text-[13px] font-semibold tabular-nums text-slate-700">{visible.length} open</span>
        ) : null}
      </div>
      {onFilterTextChange ? (
        <div className="shrink-0 border-b border-slate-100 px-2.5 py-1.5">
          <input
            type="search"
            value={filterText}
            onChange={(e) => onFilterTextChange(e.target.value)}
            placeholder="Search PE, WO, item…"
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400"
            aria-label="Filter quality queue"
            data-testid="quality-queue-filter"
          />
        </div>
      ) : null}
      {loading ? (
        <p className="px-3 py-3 text-[13px] text-slate-600">Loading quality queue…</p>
      ) : visible.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-slate-600">No pending QC inspections.</p>
      ) : (
        <>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" data-testid="quality-queue-list">
            {pageRows.map((row) => {
              const active = activeRowId === row.id;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    data-testid={`quality-queue-row-${row.kind}`}
                    data-production-id={row.productionId ?? undefined}
                    aria-selected={active}
                    className={cn(
                      "flex min-h-[52px] w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                      active
                        ? "border-sky-500 bg-sky-50 ring-2 ring-sky-300/70"
                        : "border-slate-200 bg-white hover:border-sky-300 hover:bg-slate-50",
                    )}
                    onClick={() => onSelectRow(row)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-slate-900">{row.label}</div>
                      <div className="mt-0.5 truncate text-[13px] text-slate-600">{row.subtitle}</div>
                      {row.batchDate ? (
                        <div className="mt-0.5 text-[12px] tabular-nums text-slate-500">{row.batchDate}</div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      {row.statusLabel ? (
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                          {row.statusLabel}
                        </div>
                      ) : null}
                      <div className="text-[15px] font-bold tabular-nums text-slate-900">{row.qtyLabel}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {pageCount > 1 ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 px-2.5 py-1.5">
              <button
                type="button"
                className="h-8 rounded-md border border-slate-200 px-2.5 text-[13px] font-medium text-slate-700 disabled:opacity-40"
                disabled={safePage <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                data-testid="quality-queue-prev"
              >
                Prev
              </button>
              <span className="text-[13px] tabular-nums text-slate-600">
                {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="h-8 rounded-md border border-slate-200 px-2.5 text-[13px] font-medium text-slate-700 disabled:opacity-40"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                data-testid="quality-queue-next"
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
