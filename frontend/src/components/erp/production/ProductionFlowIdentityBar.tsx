import { OperationalContextBar, OpCtxSep } from "../OperationalWorkspaceChrome";
import { cn } from "../../../lib/utils";
import { type ProductionFlowParam, PRODUCTION_FLOW_NO_QTY } from "../../../lib/productionFlowContract";
import { ProductionFlowTypeBadge } from "./ProductionFlowTypeBadge";

type Props = {
  flow: ProductionFlowParam;
  soLabel: string;
  woLabel?: string | null;
  cycleNo?: number | null;
  rsLabel?: string | null;
  itemName?: string | null;
  className?: string;
};

/** P6B-1 — Always-visible flow identity (no inference from cycle alone). */
export function ProductionFlowIdentityBar({
  flow,
  soLabel,
  woLabel,
  cycleNo,
  rsLabel,
  itemName,
  className,
}: Props) {
  const isNoQty = flow === PRODUCTION_FLOW_NO_QTY;
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <ProductionFlowTypeBadge flow={flow} />
        {isNoQty ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Requirement Sheet → Work Order → Production
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Sales Order → Work Order → Production
          </span>
        )}
      </div>
      <OperationalContextBar className="rounded-md border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-2 py-1 text-[11px] shadow-sm">
        <span className="font-semibold text-slate-600">SO</span>
        <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-sky-900">
          {soLabel}
        </span>
        {isNoQty && cycleNo != null ? (
          <>
            <OpCtxSep />
            <span className="text-slate-500">Cycle</span>
            <span className="font-semibold tabular-nums text-slate-900">{cycleNo}</span>
          </>
        ) : null}
        {isNoQty && rsLabel ? (
          <>
            <OpCtxSep />
            <span className="text-slate-500">RS</span>
            <span className="rounded border border-violet-200 bg-violet-50/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-violet-950">
              {rsLabel}
            </span>
          </>
        ) : null}
        {woLabel ? (
          <>
            <OpCtxSep />
            <span className="font-semibold text-slate-600">WO</span>
            <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-900">{woLabel}</span>
          </>
        ) : null}
        {itemName ? (
          <>
            <OpCtxSep />
            <span className="text-slate-500">Item</span>
            <span className="max-w-[12rem] truncate font-semibold text-slate-900">{itemName}</span>
          </>
        ) : null}
      </OperationalContextBar>
    </div>
  );
}
