import { formatProductionOperatorQty } from "../../../lib/productionOperatorUx";
import { cn } from "../../../lib/utils";

export type ProductionOperatorIdentityBarProps = {
  woLabel: string;
  itemName: string;
  flowLabel: string;
  flowContextLabel?: string | null;
  statusLabel: string;
  plannedQty?: number | null;
  producedQty?: number | null;
  remainingQty?: number | null;
  unit?: string | null;
  className?: string;
};

/** MES header band — WO identity + compact KPI strip (~80–100px). */
export function ProductionOperatorIdentityBar({
  woLabel,
  itemName,
  flowLabel,
  flowContextLabel,
  statusLabel,
  plannedQty,
  producedQty,
  remainingQty,
  unit,
  className,
}: ProductionOperatorIdentityBarProps) {
  const fmt = (value: number | null | undefined) => formatProductionOperatorQty(value, unit);
  const flowLine = flowContextLabel?.trim() || flowLabel;

  return (
    <div
      className={cn("min-w-0 border-b border-slate-300/80 bg-white", className)}
      data-testid="production-operator-identity-bar"
    >
      <div className="flex items-start justify-between gap-3 px-3 py-1.5">
        <div className="min-w-0">
          <div className="font-mono text-[20px] font-bold leading-none tabular-nums tracking-tight text-slate-950">
            {woLabel}
          </div>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-800" title={itemName}>
            {itemName}
          </p>
          <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-slate-600">
            {flowLine}
          </span>
        </div>
        <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
          {statusLabel}
        </span>
      </div>
      <dl
        className="grid grid-cols-3 divide-x divide-slate-200 border-t border-slate-200/90 bg-slate-50/60"
        data-testid="production-operator-kpi-strip"
      >
        {[
          { label: "Planned", value: fmt(plannedQty), emphasis: false },
          { label: "Produced", value: fmt(producedQty), emphasis: false },
          { label: "Remaining", value: fmt(remainingQty), emphasis: true },
        ].map((kpi) => (
          <div key={kpi.label} className="px-3 py-1">
            <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{kpi.label}</dt>
            <dd
              className={cn(
                "mt-0.5 truncate text-[13px] font-bold tabular-nums leading-none",
                kpi.emphasis ? "text-emerald-900" : "text-slate-900",
              )}
            >
              {kpi.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
