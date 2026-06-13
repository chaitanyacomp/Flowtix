import { cn } from "../../../lib/utils";
import {
  formatRsCycleSummaryStatus,
  type NoQtyRsCycleSummaryEntry,
} from "../../../lib/noQtyRsCycleSummary";

function fmtQty(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) <= 1e-9) return "0";
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : String(r);
}

export function NoQtyRsCycleSummaryPanel({
  entries,
  loading,
  className,
}: {
  entries: NoQtyRsCycleSummaryEntry[];
  loading?: boolean;
  className?: string;
}) {
  const total = entries.reduce((s, e) => s + e.totalNewRequirementQty, 0);

  return (
    <div
      className={cn("rounded-md border border-violet-200 bg-violet-50/50 px-3 py-2", className)}
      role="region"
      aria-label="RS cycle summary"
    >
      <div className="text-[12px] font-semibold text-violet-950">RS Cycle Summary</div>
      {loading ? (
        <p className="mt-1 text-[11px] text-slate-600">Loading cycle totals…</p>
      ) : entries.length === 0 ? (
        <p className="mt-1 text-[11px] text-slate-600">No requirement sheets on this agreement yet.</p>
      ) : (
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-violet-200/80 text-left text-[10px] font-semibold uppercase tracking-wide text-violet-800/80">
                <th className="py-1 pr-3">Cycle</th>
                <th className="py-1 pr-3 text-right">RS qty</th>
                <th className="py-1 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr key={`${row.cycleId}-${row.sheetId}`} className="border-b border-violet-100/80 text-slate-800">
                  <td className="py-1 pr-3 font-medium tabular-nums">
                    Cycle {row.cycleNo > 0 ? row.cycleNo : "—"}
                    {row.docNo ? (
                      <span className="ml-1.5 font-normal text-slate-500">{row.docNo}</span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-3 text-right font-semibold tabular-nums">{fmtQty(row.totalNewRequirementQty)}</td>
                  <td className="py-1 text-right text-slate-600">{formatRsCycleSummaryStatus(row.status)}</td>
                </tr>
              ))}
              <tr className="font-semibold text-violet-950">
                <td className="pt-1.5 pr-3">Total</td>
                <td className="pt-1.5 pr-3 text-right tabular-nums">{fmtQty(total)}</td>
                <td className="pt-1.5" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
