import * as React from "react";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { displayWorkOrderTraceNo } from "../../../lib/docNoDisplay";

export type ProductionNoQtyWorkQueueRow = {
  id: number;
  workOrderId: number;
  cycleNo: number | null;
  balance: number;
  queueStatus: "ready" | "qc_pending" | "carry_forward";
  qty: number;
  approvedProducedQty?: number | null;
  fgItem: { itemName: string; unit?: string };
};

type Props = {
  rows: ProductionNoQtyWorkQueueRow[];
  selectedLineId: number;
  onSelect: (row: ProductionNoQtyWorkQueueRow) => void;
  fmtProdQty: (value: number, unit?: string | null) => string;
  className?: string;
};

/** Embedded work queue — premium empty state, no table chrome when idle. */
export function ProductionNoQtyWorkQueuePanel({
  rows,
  selectedLineId,
  onSelect,
  fmtProdQty,
  className,
}: Props) {
  const otherRows = React.useMemo(
    () => rows.filter((row) => row.id !== selectedLineId),
    [rows, selectedLineId],
  );

  if (otherRows.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-slate-200/90 bg-gradient-to-b from-slate-50/95 to-white px-4 py-3 shadow-sm",
          className,
        )}
        data-testid="production-workspace-empty"
      >
        <p className="text-[13px] font-medium leading-snug text-slate-700">
          No other work orders pending in this cycle.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Other work orders</h3>
        <span className="text-[11px] text-slate-400">Cycle · WO · Item</span>
      </div>
      <div className="max-h-[min(30%,200px)] overflow-auto rounded-lg border border-slate-200/90 bg-white shadow-sm">
        <table className="w-full table-fixed text-[11px]">
          <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
            <tr className="text-left text-[11px] text-slate-600">
              <th className="w-12 px-2 py-1 font-medium">Cycle</th>
              <th className="w-14 px-2 py-1 font-medium">WO</th>
              <th className="px-2 py-1 font-medium">Item</th>
              <th className="w-16 px-2 py-1 text-right font-medium">Planned</th>
              <th className="w-16 px-2 py-1 text-right font-medium">Produced</th>
              <th className="w-16 px-2 py-1 text-right font-medium">Balance</th>
              <th className="w-10 px-1 py-1 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {otherRows.map((row) => {
              const selected = selectedLineId === row.id;
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "border-t border-slate-100",
                    selected && "bg-emerald-50",
                    row.queueStatus === "qc_pending" && !selected && "bg-amber-50/40",
                  )}
                >
                  <td className="px-2 py-1 tabular-nums font-medium text-slate-800">
                    {row.cycleNo != null ? row.cycleNo : "—"}
                  </td>
                  <td className="px-2 py-1 tabular-nums">{displayWorkOrderTraceNo(row.workOrderId)}</td>
                  <td className="truncate px-2 py-1 font-medium" title={row.fgItem.itemName}>
                    {row.fgItem.itemName}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtProdQty(Number(row.qty), row.fgItem.unit)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {fmtProdQty(row.approvedProducedQty ?? 0, row.fgItem.unit)}
                  </td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtProdQty(row.balance, row.fgItem.unit)}</td>
                  <td className="px-1 py-1 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 shrink-0 p-0 text-[13px]"
                      onClick={() => onSelect(row)}
                      aria-label={`Select ${row.fgItem.itemName}`}
                    >
                      ▶
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
