import { cn } from "../../../lib/utils";
import type { GreenLevelProductionQueueRow } from "../../../lib/greenLevelProductionExecution";
import { Badge } from "../../ui/badge";

type Props = {
  row: GreenLevelProductionQueueRow;
  fmtProdQty: (value: number) => string;
  className?: string;
};

/** Prominent header for the actively selected Green Level work order. */
export function GreenLevelProductionCurrentWoCard({ row, fmtProdQty, className }: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border border-emerald-300/90 bg-gradient-to-r from-emerald-50 to-white px-3 py-2.5 shadow-sm",
        className,
      )}
      data-testid="green-level-current-wo-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-emerald-300 bg-emerald-100 px-1.5 py-0 text-[9px] font-bold uppercase text-emerald-950">
              Current WO
            </Badge>
            <span className="font-mono text-[13px] font-bold tabular-nums text-emerald-950">{row.woLabel}</span>
            <span className="text-[11px] font-medium text-slate-500">{row.statusLabel}</span>
          </div>
          <p className="truncate text-[14px] font-semibold text-slate-900" title={row.itemName}>
            {row.itemName}
          </p>
        </div>
        <dl className="grid shrink-0 grid-cols-3 gap-x-3 gap-y-0.5 text-right text-[11px]">
          <div>
            <dt className="text-slate-500">Planned</dt>
            <dd className="font-bold tabular-nums text-slate-900">{fmtProdQty(row.plannedQty)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Produced</dt>
            <dd className="font-bold tabular-nums text-slate-900">{fmtProdQty(row.producedQty)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Balance</dt>
            <dd className="font-bold tabular-nums text-emerald-950">{fmtProdQty(row.balanceQty)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
