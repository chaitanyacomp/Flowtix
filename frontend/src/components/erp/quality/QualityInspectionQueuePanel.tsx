import { cn } from "../../../lib/utils";
import { PRODUCTION_QA_TERMS } from "../../../lib/productionQaTerminology";
import type { QualityQueueRow } from "../../../lib/qcWorkspaceUx";

type Props = {
  rows: QualityQueueRow[];
  activeRowId?: string | null;
  onSelectRow: (row: QualityQueueRow) => void;
  loading?: boolean;
};

export function QualityInspectionQueuePanel({ rows, activeRowId, onSelectRow, loading }: Props) {
  return (
    <div
      className="rounded-md border border-violet-200/90 bg-violet-50/40 px-2.5 py-2 shadow-sm"
      data-testid="quality-inspection-queue"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-violet-950">
          {PRODUCTION_QA_TERMS.QUALITY_QUEUE}
        </h2>
        {!loading ? (
          <span className="text-[10px] font-medium tabular-nums text-violet-800">{rows.length} open</span>
        ) : null}
      </div>
      {loading ? (
        <p className="text-[11px] text-slate-600">Loading quality queue…</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-slate-600">No pending quality inspections.</p>
      ) : (
        <ul className="max-h-[min(360px,42vh)] space-y-1 overflow-y-auto">
          {rows.map((row) => {
            const active = activeRowId === row.id;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  data-testid={`quality-queue-row-${row.kind}`}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left transition-colors",
                    active
                      ? "border-violet-500 bg-white ring-2 ring-violet-300/80"
                      : "border-slate-200/90 bg-white hover:border-violet-300 hover:bg-violet-50/50",
                  )}
                  onClick={() => onSelectRow(row)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-slate-900">{row.label}</div>
                    <div className="truncate text-[10px] text-slate-600">{row.subtitle}</div>
                  </div>
                  <span className="shrink-0 text-[10px] font-bold tabular-nums text-violet-950">{row.qtyLabel}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
