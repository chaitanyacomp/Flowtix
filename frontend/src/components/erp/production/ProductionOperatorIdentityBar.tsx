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

/** MES header band — WO identity + KPI tiles (FT-PD-066 operator prominence). */
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

  const kpis = [
    { label: "Planned", value: fmt(plannedQty), tone: "border-slate-200 bg-white text-slate-900" },
    { label: "Produced", value: fmt(producedQty), tone: "border-sky-200 bg-sky-50/80 text-sky-950" },
    {
      label: "Remaining",
      value: fmt(remainingQty),
      tone: "border-emerald-300 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200/80",
    },
  ];

  return (
    <div
      className={cn("min-w-0 border-b border-slate-300/80 bg-white", className)}
      data-testid="production-operator-identity-bar"
    >
      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="font-mono text-[22px] font-bold leading-none tabular-nums tracking-tight text-slate-950">
            {woLabel}
          </div>
          <p className="mt-1 truncate text-[15px] font-semibold leading-snug text-slate-800" title={itemName}>
            {itemName}
          </p>
          <span className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            {flowLine}
          </span>
        </div>
        <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] font-semibold text-slate-700">
          {statusLabel}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-slate-200/90 bg-slate-50/50 px-3 py-2" data-testid="production-operator-kpi-strip">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={cn("min-w-0 rounded-md border px-2.5 py-1.5 shadow-sm", kpi.tone)}>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{kpi.label}</dt>
            <dd className="mt-0.5 truncate text-[17px] font-bold tabular-nums leading-none">{kpi.value}</dd>
          </div>
        ))}
      </div>
    </div>
  );
}
