import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";

export type ProductionOperatorOpenWoRow = {
  key: string | number;
  woLabel?: string | null;
  itemName: string;
  remainingLabel: string;
  statusLabel: string;
  selected?: boolean;
  onOpen: () => void;
  hideWoColumn?: boolean;
};

type Props = {
  rows: ProductionOperatorOpenWoRow[];
  title?: string;
  className?: string;
  emptyMessage?: string;
  /** Total open lines including the active WO (for operator context). */
  totalOpenCount?: number;
};

/** Bottom queue — WO · Item · Remaining · Status · Open */
export function ProductionOperatorOpenWoQueue({
  rows,
  title = "Other Open WOs",
  className,
  emptyMessage = "No other work orders pending.",
  totalOpenCount,
}: Props) {
  const hideWo = rows.length > 0 && rows.every((r) => r.hideWoColumn);

  return (
    <section className={cn("min-w-0", className)} data-testid="production-operator-open-wo-queue">
      <div className="mb-1 flex items-baseline justify-between gap-2 px-0.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</h3>
        {totalOpenCount != null && totalOpenCount > rows.length ? (
          <span className="text-[10px] tabular-nums text-slate-500">
            {rows.length} other · {totalOpenCount} open
          </span>
        ) : null}
      </div>
      <div className="max-h-[min(32vh,260px)] overflow-auto border border-slate-200 bg-white">
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-center text-[11px] text-slate-600">{emptyMessage}</p>
        ) : (
          <table className="w-full table-fixed text-[11px]">
            <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
              <tr className="text-left text-[9px] font-bold uppercase tracking-wide text-slate-500">
                {!hideWo ? <th className="w-[5.5rem] px-2 py-1">WO</th> : null}
                <th className="px-2 py-1">Item</th>
                <th className="w-[5.5rem] px-2 py-1 text-right">Remaining</th>
                <th className="w-[4.5rem] px-2 py-1">Status</th>
                <th className="w-[3.5rem] px-1 py-1 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={cn(
                    "border-t border-slate-100",
                    row.selected && "bg-sky-50/90 ring-1 ring-inset ring-sky-200/70",
                  )}
                >
                  {!hideWo ? (
                    <td className="px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-900">
                      {row.woLabel ?? "—"}
                    </td>
                  ) : null}
                  <td className="truncate px-2 py-0.5 font-medium text-slate-800" title={row.itemName}>
                    {row.itemName}
                  </td>
                  <td className="px-2 py-0.5 text-right font-semibold tabular-nums text-slate-900">
                    {row.remainingLabel}
                  </td>
                  <td className="px-2 py-0.5 text-[10px] text-slate-600">{row.statusLabel}</td>
                  <td className="px-1 py-0.5 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px] font-semibold text-sky-800 hover:bg-sky-50"
                      onClick={row.onOpen}
                    >
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
