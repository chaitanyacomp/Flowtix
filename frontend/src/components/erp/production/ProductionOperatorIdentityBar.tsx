import { formatProductionOperatorQty } from "../../../lib/productionOperatorUx";
import { cn } from "../../../lib/utils";

export type ProductionOperatorIdentityBarProps = {
  woLabel: string;
  itemName: string;
  flowLabel: string;
  flowContextLabel?: string | null;
  statusLabel: string;
  plannedQty?: number | null;
  /** Approved / finalized produced only. */
  finalizedProducedQty?: number | null;
  /** @deprecated Prefer finalizedProducedQty — kept for call sites without draft awareness. */
  producedQty?: number | null;
  activeDraftQty?: number | null;
  remainingQty?: number | null;
  /** Defaults to "Remaining"; use "Target Remaining" when RM surplus is shown separately. */
  remainingLabel?: string;
  extraRmCapacityQty?: number | null;
  /** When draft exists: projected extra beyond plan after approval. */
  projectedExtraQty?: number | null;
  /** Remaining RM-supported capacity after draft reservation. */
  remainingRmCapacityAfterDraftQty?: number | null;
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
  finalizedProducedQty,
  producedQty,
  activeDraftQty,
  remainingQty,
  remainingLabel = "Remaining",
  extraRmCapacityQty,
  projectedExtraQty,
  remainingRmCapacityAfterDraftQty,
  unit,
  className,
}: ProductionOperatorIdentityBarProps) {
  const fmt = (value: number | null | undefined) => formatProductionOperatorQty(value, unit);
  const flowLine = flowContextLabel?.trim() || flowLabel;
  const draftQty = Number(activeDraftQty ?? 0);
  const hasDraft = draftQty > 1e-6;
  const finalized =
    finalizedProducedQty != null && Number.isFinite(Number(finalizedProducedQty))
      ? Number(finalizedProducedQty)
      : Number(producedQty ?? 0);
  const showExtraRm = extraRmCapacityQty != null && Number.isFinite(Number(extraRmCapacityQty));

  const kpis = hasDraft
    ? [
        { label: "Planned", value: fmt(plannedQty), tone: "border-slate-200 bg-white text-slate-900" },
        {
          label: "Finalized Produced",
          value: fmt(finalized),
          tone: "border-sky-200 bg-sky-50/80 text-sky-950",
        },
        {
          label: "Draft Awaiting Approval",
          value: fmt(draftQty),
          tone: "border-amber-300 bg-amber-50 text-amber-950 ring-1 ring-amber-200/80",
        },
        {
          label: remainingLabel === "Remaining" ? "Target Remaining" : remainingLabel,
          value: fmt(remainingQty),
          tone: "border-emerald-300 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200/80",
        },
        ...(showExtraRm
          ? [
              {
                label: "Extra RM Capacity",
                value: fmt(extraRmCapacityQty),
                tone: "border-slate-200 bg-white text-slate-800",
              },
            ]
          : []),
        {
          label: "Draft Result",
          value:
            Number(projectedExtraQty ?? 0) > 1e-6
              ? `${fmt(projectedExtraQty)} above target`
              : "Within target",
          tone: "border-violet-200 bg-violet-50/80 text-violet-950",
        },
        ...(remainingRmCapacityAfterDraftQty != null
          ? [
              {
                label: "RM Capacity After Draft",
                value: fmt(remainingRmCapacityAfterDraftQty),
                tone: "border-slate-200 bg-slate-50 text-slate-800",
              },
            ]
          : []),
      ]
    : [
        { label: "Planned", value: fmt(plannedQty), tone: "border-slate-200 bg-white text-slate-900" },
        {
          label: "Finalized Produced",
          value: fmt(finalized),
          tone: "border-sky-200 bg-sky-50/80 text-sky-950",
        },
        {
          label: remainingLabel,
          value: fmt(remainingQty),
          tone: "border-emerald-300 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200/80",
        },
        ...(showExtraRm
          ? [
              {
                label: "Extra RM Capacity",
                value: fmt(extraRmCapacityQty),
                tone: "border-amber-200 bg-amber-50/80 text-amber-950",
              },
            ]
          : []),
      ];

  const cols =
    kpis.length >= 6 ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : kpis.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3";

  return (
    <div
      className={cn("min-w-0 border-b border-slate-300/80 bg-white", className)}
      data-testid="production-operator-identity-bar"
      data-has-active-draft={hasDraft ? "1" : "0"}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-1.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <div className="font-mono text-[20px] font-bold leading-none tabular-nums tracking-tight text-slate-950">
              {woLabel}
            </div>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
              {flowLine}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[14px] font-semibold leading-snug text-slate-800" title={itemName}>
            {itemName}
          </p>
        </div>
        <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[12px] font-semibold text-slate-700">
          {statusLabel}
        </span>
      </div>
      <div
        className={cn("grid gap-2 border-t border-slate-200/90 bg-slate-50/60 px-3 py-1.5", cols)}
        data-testid="production-operator-kpi-strip"
      >
        {kpis.map((kpi) => (
          <div key={kpi.label} className={cn("min-w-0 rounded-md border px-2.5 py-1.5 shadow-sm", kpi.tone)}>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{kpi.label}</dt>
            <dd className="mt-0.5 truncate text-[15px] font-bold tabular-nums leading-none sm:text-[17px]">{kpi.value}</dd>
          </div>
        ))}
      </div>
      {hasDraft ? (
        <p className="border-t border-amber-100 bg-amber-50/50 px-3 py-1 text-[11px] text-amber-950" data-testid="production-draft-projection-hint">
          After approval: Finalized Produced {fmt(finalized + draftQty)}
          {Number(projectedExtraQty ?? 0) > 1e-6 ? ` · Extra beyond target ${fmt(projectedExtraQty)}` : ""}
          {remainingRmCapacityAfterDraftQty != null
            ? ` · Remaining RM-supported capacity ${fmt(remainingRmCapacityAfterDraftQty)}`
            : ""}
          . Target Remaining stays {fmt(remainingQty)} until this draft is approved.
        </p>
      ) : null}
    </div>
  );
}
