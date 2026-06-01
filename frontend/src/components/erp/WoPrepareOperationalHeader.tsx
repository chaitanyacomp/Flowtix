import * as React from "react";
import { cn } from "../../lib/utils";

type FgSnapshot = {
  fgName: string;
  customerCommittedQty?: number;
  orderQty: number;
  productionBufferPercent?: number;
  productionBufferQty?: number;
  plannedProductionQty?: number;
  fgStockAdjustmentQty?: number;
  fgStock: number;
  rmPlanningQty?: number;
  toProduce: number;
  note?: string;
};

type Props = {
  soLabel: string;
  primaryFg: FgSnapshot | null;
  extraFgCount: number;
  loading?: boolean;
  soSelector?: React.ReactNode;
};

/** Compact SO summary — operational context only; workflow status lives in progress section below. */
export function WoPrepareOperationalHeader({
  soLabel,
  primaryFg,
  extraFgCount,
  loading,
  soSelector,
}: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm",
        loading && "opacity-80",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-base font-bold tracking-tight text-slate-950">{soLabel}</span>
          {primaryFg ? (
            <>
              <span className="hidden text-slate-300 sm:inline" aria-hidden>
                ·
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">FG</span>
              <span className="text-sm font-semibold text-slate-950">{primaryFg.fgName}</span>
              {extraFgCount > 0 ? (
                <span className="text-[11px] font-medium text-slate-600">+{extraFgCount} more</span>
              ) : null}
            </>
          ) : null}
        </div>
        {soSelector ? <div className="shrink-0">{soSelector}</div> : null}
      </div>
      {primaryFg?.note ? (
        <p className="mt-1 text-[11px] font-medium leading-snug text-amber-900">{primaryFg.note}</p>
      ) : null}
    </div>
  );
}
