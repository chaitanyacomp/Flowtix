import { Link } from "react-router-dom";
import { buttonVariants } from "../../ui/button";
import { cn } from "../../../lib/utils";
import {
  formatDispatchCompactQty,
  type CompactDispatchHistoryRow,
} from "../../../lib/dispatchWorkspaceUx";
import { displayDispatchNo } from "../../../lib/docNoDisplay";

export type DispatchCompactHistoryPanelProps = {
  rows: CompactDispatchHistoryRow[];
  totalDispatched: number;
  registerHref: string;
  className?: string;
};

export function DispatchCompactHistoryPanel({
  rows,
  totalDispatched,
  registerHref,
  className,
}: DispatchCompactHistoryPanelProps) {
  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-testid="dispatch-compact-history-panel"
      id="dispatch-compact-history"
    >
      <div className="overflow-auto rounded border border-slate-200 bg-white">
        <table className="w-full min-w-[28rem] text-left text-[12px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-2 py-1.5 font-medium">Dispatch No</th>
              <th className="px-2 py-1.5 font-medium">Date</th>
              <th className="px-2 py-1.5 font-medium">Item</th>
              <th className="px-2 py-1.5 text-right font-medium">Qty</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
              <th className="px-2 py-1.5 font-medium">Why split</th>
              <th className="px-2 py-1.5 font-medium">User</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-slate-100"
                  data-testid={`dispatch-compact-history-row-${row.id}`}
                >
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] font-medium text-slate-900">
                    {displayDispatchNo(row.id, row.docNo)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">{row.dateLabel}</td>
                  <td className="max-w-[10rem] truncate px-2 py-1.5 font-medium text-slate-900" title={row.itemName}>
                    {row.itemName}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">
                    {formatDispatchCompactQty(row.qty)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span
                      className={cn(
                        "inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold",
                        row.statusLabel === "Finalized"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-amber-200 bg-amber-50 text-amber-950",
                      )}
                    >
                      {row.statusLabel}
                    </span>
                  </td>
                  <td
                    className="max-w-[9rem] truncate px-2 py-1.5 text-[11px] text-slate-600"
                    title={row.splitReason ?? undefined}
                  >
                    {row.splitReason ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{row.userLabel}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-2 py-3 text-center text-[12px] text-slate-500">
                  No dispatch records for this sales order yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
        <div className="text-[13px] text-slate-800">
          Total dispatched:{" "}
          <span className="font-semibold tabular-nums text-emerald-900">{formatDispatchCompactQty(totalDispatched)}</span>
        </div>
        <Link
          to={registerHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          data-testid="dispatch-compact-view-register"
        >
          View Dispatch Register
        </Link>
      </div>
    </div>
  );
}
