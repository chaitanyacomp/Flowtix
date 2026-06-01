import type { ResolvedSupplierCommercial } from "../../pages/rmPurchase/rmPurchaseShared";

type Props = {
  commercial: ResolvedSupplierCommercial | null | undefined;
  /** Compact inline chip row only */
  compact?: boolean;
  /** Read-only supply-from block (GRN context) */
  readOnly?: boolean;
  className?: string;
};

function gstModeChipClass(mode: string | null | undefined): string {
  if (mode === "INTERSTATE") return "bg-purple-100 text-purple-900";
  if (mode === "LOCAL") return "bg-emerald-100 text-emerald-900";
  return "bg-slate-100 text-slate-700";
}

function gstModeLabel(mode: string | null | undefined): string {
  if (mode === "INTERSTATE") return "Interstate";
  if (mode === "LOCAL") return "Local";
  return "Source pending";
}

function stateLine(stateCode?: string | null, stateName?: string | null): string {
  const code = (stateCode ?? "").trim();
  const name = (stateName ?? "").trim();
  if (code && name) return `${code} · ${name}`;
  return code || name || "State not set";
}

export function RmPoCommercialSummary({ commercial, compact = false, readOnly = false, className = "" }: Props) {
  if (!commercial) return null;

  const supply = commercial.supplyLocation;
  const source = commercial.purchaseSource;
  const gstMode = commercial.gstMode;

  if (compact) {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <span className="text-sm text-slate-700">
          <span className="font-medium text-slate-800">Supply from:</span> {supply?.label ?? "—"}
        </span>
        {(source?.stateCode || source?.stateName) && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
            {stateLine(source.stateCode, source.stateName)}
          </span>
        )}
        {supply?.gstin ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{supply.gstin}</span>
        ) : null}
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${gstModeChipClass(gstMode)}`}>
          {gstModeLabel(gstMode)}
        </span>
      </div>
    );
  }

  return (
    <div className={`rounded-md border border-slate-200 bg-slate-50/70 p-2.5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-800">{readOnly ? "Supply From" : "Commercial"}</div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
            {commercial.snapshotState ?? "LIVE"}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${gstModeChipClass(gstMode)}`}>
            {gstModeLabel(gstMode)}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
          <div className="text-[11px] font-medium text-slate-600">Registered supplier</div>
          <div className="mt-0.5 text-[13px] font-semibold text-slate-900">
            {commercial.registeredSupplier?.name ?? "—"}
          </div>
          <div className="mt-0.5 text-[12px] text-slate-600">
            {stateLine(commercial.registeredSupplier?.stateCode, commercial.registeredSupplier?.stateName)}
            {commercial.registeredSupplier?.gstin ? (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                {commercial.registeredSupplier.gstin}
              </span>
            ) : null}
          </div>
        </div>

        <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
          <div className="text-[11px] font-medium text-slate-600">Supply location</div>
          <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{supply?.label ?? "—"}</div>
          <div className="mt-0.5 text-[12px] text-slate-600">
            {stateLine(supply?.stateCode, supply?.stateName)}
            {supply?.gstin ? (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                {supply.gstin}
              </span>
            ) : null}
          </div>
          {(source?.stateCode || source?.stateName) && (
            <div className="mt-1 text-[11px] text-slate-500">
              Purchase source: {stateLine(source.stateCode, source.stateName)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RmPoCommercialPreview({
  label,
  gstin,
  stateCode,
  stateName,
  gstMode,
}: {
  label?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  stateName?: string | null;
  gstMode?: string | null;
}) {
  if (!label) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2 text-xs text-slate-700">
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        {(stateCode || stateName) && (
          <span className="ml-2 rounded bg-white px-1.5 py-0.5 font-mono text-[11px]">{stateLine(stateCode, stateName)}</span>
        )}
        {gstin ? (
          <span className="ml-2 rounded bg-white px-1.5 py-0.5 font-mono text-[11px]">{gstin}</span>
        ) : null}
      </span>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${gstModeChipClass(gstMode)}`}>
        {gstModeLabel(gstMode)}
      </span>
    </div>
  );
}
