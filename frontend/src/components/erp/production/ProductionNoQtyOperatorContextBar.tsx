import { OperationalContextBar, OpCtxSep } from "../OperationalWorkspaceChrome";
import type { ProductionNoQtyWoSummary } from "./ProductionNoQtyWoSummaryCard";
import { cn } from "../../../lib/utils";

function fmtQty(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : String(r);
}

/** P16-18H/I — single operator context line for NO_QTY production workstation. */
export function ProductionNoQtyOperatorContextBar({
  summary,
  className,
}: {
  summary: ProductionNoQtyWoSummary;
  className?: string;
}) {
  return (
    <div data-testid="production-no-qty-operator-context">
      <OperationalContextBar
        className={cn(
          "rounded-lg border border-slate-200/95 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-3 py-2 text-[12px] text-slate-800 shadow-[0_2px_8px_0_rgb(15_23_42_/0.06)]",
          className,
        )}
      >
        <span className="font-mono text-[12px] font-semibold tabular-nums text-slate-900">{summary.soLabel}</span>
        {summary.customerName ? (
          <>
            <OpCtxSep />
            <span className="max-w-[11rem] truncate font-medium text-slate-700" title={summary.customerName}>
              {summary.customerName}
            </span>
          </>
        ) : null}
        <OpCtxSep />
        <span className="font-mono text-[12px] font-semibold tabular-nums text-slate-900">{summary.woLabel}</span>
        <OpCtxSep />
        <span className="max-w-[13rem] truncate font-semibold text-slate-900" title={summary.itemName}>
          {summary.itemName}
        </span>
        <OpCtxSep />
        <span className="text-slate-500">Planned</span>
        <span className="font-bold tabular-nums text-slate-950">{fmtQty(summary.plannedQty)}</span>
        <OpCtxSep />
        <span className="text-slate-500">Produced</span>
        <span className="font-bold tabular-nums text-slate-950">{fmtQty(summary.producedQty)}</span>
        <OpCtxSep />
        <span className="text-slate-500">Remaining</span>
        <span className="font-bold tabular-nums text-slate-950">{fmtQty(summary.remainingQty)}</span>
      </OperationalContextBar>
    </div>
  );
}
