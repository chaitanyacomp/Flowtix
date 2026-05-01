/** Compact label + value for operational quantity strips (WO, production, QC, etc.). */
export function StatBlock({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? "min-w-[5.5rem] rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1.5 shadow-sm"
          : "min-w-[5.5rem] rounded-md border border-slate-200 bg-white px-2 py-1.5"
      }
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`tabular-nums text-sm font-semibold ${emphasis ? "text-emerald-950" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
