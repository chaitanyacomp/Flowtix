import { cn } from "../../../lib/utils";

export type ProductionNoQtyWoSummary = {
  woLabel: string;
  soLabel: string;
  itemName: string;
  customerName?: string | null;
  plannedQty: number | null;
  producedQty: number | null;
  remainingQty: number | null;
};

function fmtQty(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : String(r);
}

export function ProductionNoQtyWoSummaryCard({
  summary,
  className,
  compact = false,
  metricsOnly = false,
}: {
  summary: ProductionNoQtyWoSummary;
  className?: string;
  compact?: boolean;
  /** Context bar already shows SO/WO/Item — left panel shows qty metrics only. */
  metricsOnly?: boolean;
}) {
  const metricsGrid = (
    <dl
      className={cn(
        "grid grid-cols-3 gap-1.5 rounded-md border border-slate-200 bg-slate-50/90 px-2.5 py-1.5",
        compact || metricsOnly ? "text-[11px]" : "text-[12px]",
        !metricsOnly && "mt-2.5 gap-2 rounded-lg px-3 py-2",
      )}
    >
      <div>
        <dt className="font-semibold uppercase tracking-wide text-slate-500">Planned</dt>
        <dd
          className={cn(
            "mt-0.5 font-bold tabular-nums leading-none text-slate-900",
            compact || metricsOnly ? "text-[14px]" : "text-[17px]",
          )}
        >
          {fmtQty(summary.plannedQty)}
        </dd>
      </div>
      <div>
        <dt className="font-semibold uppercase tracking-wide text-slate-500">Produced</dt>
        <dd
          className={cn(
            "mt-0.5 font-bold tabular-nums leading-none text-slate-900",
            compact || metricsOnly ? "text-[14px]" : "text-[17px]",
          )}
        >
          {fmtQty(summary.producedQty)}
        </dd>
      </div>
      <div>
        <dt className="font-semibold uppercase tracking-wide text-slate-500">Remaining</dt>
        <dd
          className={cn(
            "mt-0.5 font-bold tabular-nums leading-none text-slate-900",
            compact || metricsOnly ? "text-[14px]" : "text-[17px]",
          )}
        >
          {fmtQty(summary.remainingQty)}
        </dd>
      </div>
    </dl>
  );

  if (metricsOnly) {
    return (
      <div className={cn("min-w-0", className)} data-testid="production-no-qty-wo-summary">
        {metricsGrid}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200/90 bg-white shadow-sm",
        compact ? "p-2" : "p-3.5",
        className,
      )}
      data-testid="production-no-qty-wo-summary"
    >
      <div className="min-w-0 space-y-0.5">
        <div className={cn("font-bold tracking-tight text-slate-900", compact ? "text-[14px]" : "text-[15px]")}>
          {summary.woLabel}
        </div>
        <div className={cn("font-semibold text-slate-800", compact ? "text-[12px]" : "text-[13px]")}>
          {summary.soLabel}
        </div>
        {summary.customerName ? (
          <div className="text-[12px] font-medium text-slate-600">{summary.customerName}</div>
        ) : null}
        <div
          className={cn("truncate font-medium text-slate-900", compact ? "text-[12px]" : "text-[13px]")}
          title={summary.itemName}
        >
          {summary.itemName}
        </div>
      </div>
      {metricsGrid}
    </div>
  );
}
