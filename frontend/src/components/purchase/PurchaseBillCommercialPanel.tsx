import * as React from "react";
import { Button } from "../ui/button";
import type { ResolvedSupplierCommercial } from "../../pages/rmPurchase/rmPurchaseShared";

type Props = {
  commercial: ResolvedSupplierCommercial | null | undefined;
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

export function PurchaseBillCommercialPanel({ commercial, className = "" }: Props) {
  const [showAddress, setShowAddress] = React.useState(false);
  if (!commercial) return null;

  const registered = commercial.registeredSupplier;
  const supply = commercial.supplyLocation;
  const source = commercial.purchaseSource;

  return (
    <div className={`rounded-md border border-slate-200 bg-slate-50/70 p-2.5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-800">Commercial</div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
            {commercial.snapshotState ?? "LIVE"}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${gstModeChipClass(commercial.gstMode)}`}>
            {gstModeLabel(commercial.gstMode)}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
          <div className="text-[11px] font-medium text-slate-600">Registered supplier</div>
          <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{registered?.name ?? "—"}</div>
          <div className="mt-0.5 text-[12px] text-slate-600">
            {stateLine(registered?.stateCode, registered?.stateName)}
            {registered?.gstin ? (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                {registered.gstin}
              </span>
            ) : null}
          </div>
        </div>

        <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium text-slate-600">Supply from</div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowAddress((s) => !s)}
              aria-expanded={showAddress}
            >
              {showAddress ? "Hide address" : "View address"}
            </Button>
          </div>
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

      {showAddress ? (
        <div className="mt-2 space-y-1 rounded border border-slate-200 bg-white p-2 text-[12px] leading-snug text-slate-700">
          <div>
            <span className="font-medium text-slate-800">Registered address: </span>
            <span className="whitespace-pre-wrap break-words">{registered?.address?.trim() || "Not recorded on this bill"}</span>
          </div>
          <div>
            <span className="font-medium text-slate-800">Supply location address: </span>
            <span className="whitespace-pre-wrap break-words">{supply?.address?.trim() || "Not recorded on this bill"}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
