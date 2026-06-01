import { cn } from "../../lib/utils";
import {
  REGULAR_SO_BUFFER_PERCENT_MAX,
  type ProductionPlanningMetrics,
} from "../../lib/regularSoProductionPlanning";

export type ProductionPlanningFgLine = {
  lineId: number;
  fgName: string;
  customerCommittedQty: number;
  fgStockAdjustmentQty: number;
};

type Props = {
  soLevelBuffer?: boolean;
  primaryLine: ProductionPlanningFgLine;
  extraLines?: ProductionPlanningFgLine[];
  metrics: ProductionPlanningMetrics;
  suggestedBufferPercent?: number | null;
  bufferPercentInput: string;
  onBufferPercentInputChange: (value: string) => void;
  bufferInputInvalid?: boolean;
  saving?: boolean;
  disabled?: boolean;
  className?: string;
};

export function WoPrepareProductionPlanningPanel({
  primaryLine,
  extraLines = [],
  metrics,
  suggestedBufferPercent,
  bufferPercentInput,
  onBufferPercentInputChange,
  bufferInputInvalid,
  saving,
  disabled,
  className,
}: Props) {
  const suggested =
    suggestedBufferPercent != null && Number.isFinite(suggestedBufferPercent)
      ? Math.min(REGULAR_SO_BUFFER_PERCENT_MAX, Math.max(0, Math.round(suggestedBufferPercent)))
      : null;
  const allLines = [primaryLine, ...extraLines];

  return (
    <section
      className={cn(
        "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm",
        className,
      )}
      aria-labelledby="wo-prepare-production-planning-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1">
        <h2
          id="wo-prepare-production-planning-title"
          className="text-[11px] font-bold uppercase tracking-wider text-slate-700"
        >
          Production Planning
        </h2>
        {saving ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Updating…</span>
        ) : null}
      </div>

      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <ReadOnlyMetric label="Customer Qty" value={metrics.customerCommittedQty} emphasize />
        {suggested != null ? (
          <ReadOnlyMetric label="Suggested Buffer" value={suggested} suffix="%" muted />
        ) : null}
        <div>
          <label
            htmlFor="fg-buffer-percent"
            className="text-[10px] font-semibold uppercase tracking-wider text-slate-600"
          >
            Applied Buffer %
          </label>
          <input
            id="fg-buffer-percent"
            type="text"
            inputMode="decimal"
            className={cn(
              "mt-0.5 h-8 w-full max-w-[5.5rem] rounded border bg-white px-2 text-sm font-semibold tabular-nums text-slate-950",
              bufferInputInvalid ? "border-red-400" : "border-slate-300",
            )}
            value={bufferPercentInput}
            disabled={disabled || saving}
            onChange={(e) => onBufferPercentInputChange(e.target.value)}
            aria-invalid={bufferInputInvalid || undefined}
          />
          <p className="mt-0.5 text-[10px] text-slate-500">0–{REGULAR_SO_BUFFER_PERCENT_MAX}%</p>
        </div>
        <ReadOnlyMetric label="Buffer Qty" value={metrics.productionBufferQty} />
        <ReadOnlyMetric label="Planned Production Qty" value={metrics.plannedProductionQty} emphasize />
        <ReadOnlyMetric label="FG Stock Adjustment" value={metrics.fgStockAdjustmentQty} muted />
        <ReadOnlyMetric label="RM Planning Qty" value={metrics.rmPlanningQty} emphasize />
      </div>

      {extraLines.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                <th className="py-1 pr-2">FG</th>
                <th className="py-1 text-right">Customer Qty</th>
                <th className="py-1 text-right">FG Stock</th>
                <th className="py-1 text-right">RM Planning Qty</th>
              </tr>
            </thead>
            <tbody>
              {allLines.map((line) => {
                const lineMetrics = computeLineMetrics(line, metrics.productionBufferPercent);
                return (
                  <tr key={line.lineId} className="border-b border-slate-100">
                    <td className="py-1 pr-2 font-medium text-slate-900">{line.fgName}</td>
                    <td className="py-1 text-right tabular-nums">{lineMetrics.customerCommittedQty}</td>
                    <td className="py-1 text-right tabular-nums">{lineMetrics.fgStockAdjustmentQty}</td>
                    <td className="py-1 text-right tabular-nums font-semibold">{lineMetrics.rmPlanningQty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] leading-snug text-slate-600">
          <span className="font-medium text-slate-800">{primaryLine.fgName}</span>
          {" · "}
          Buffer increases RM planning and production quantity for operational safety. Dispatch remains capped at
          customer commitment only.
        </p>
      )}
    </section>
  );
}

function computeLineMetrics(line: ProductionPlanningFgLine, bufferPercent: number) {
  const customer = Math.max(0, Math.floor(Number(line.customerCommittedQty) || 0));
  const pct = Math.min(REGULAR_SO_BUFFER_PERCENT_MAX, Math.max(0, Math.round(bufferPercent)));
  const bufferQty = Math.ceil((customer * pct) / 100);
  const planned = customer + bufferQty;
  const fgStock = Math.max(0, Number(line.fgStockAdjustmentQty) || 0);
  return {
    customerCommittedQty: customer,
    fgStockAdjustmentQty: fgStock,
    rmPlanningQty: Math.max(0, planned - fgStock),
  };
}

function ReadOnlyMetric({
  label,
  value,
  suffix,
  emphasize,
  muted,
}: {
  label: string;
  value: number;
  suffix?: string;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{label}</span>
      <div
        className={cn(
          "tabular-nums font-bold text-slate-950",
          emphasize && "text-base",
          muted && "text-slate-600",
        )}
      >
        {value}
        {suffix ?? ""}
      </div>
    </div>
  );
}
