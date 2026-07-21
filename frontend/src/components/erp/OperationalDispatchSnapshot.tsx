import { cn } from "../../lib/utils";
import { formatDispatchQuantity } from "../../lib/quantityDisplay";

export type OperationalDispatchSnapshotMetrics = {
  customerPending: number;
  producedApproved: number;
  totalDispatched: number;
  usableStockNow: number;
  canDispatchNow: number;
};

type OperationalDispatchSnapshotProps = {
  metrics: OperationalDispatchSnapshotMetrics;
  /** FG item UOM when metrics share one unit. */
  unit?: string | null;
  className?: string;
  /** When true, show the simple Produced → Dispatch → Usable flow line. */
  showFlowHint?: boolean;
  /** Tighter padding / grid for Current Dispatch workbench. */
  compact?: boolean;
};

/**
 * Operator-facing dispatch numbers — no FIFO / entitlement / pool jargon.
 */
export function OperationalDispatchSnapshot({
  metrics,
  unit,
  className,
  showFlowHint = true,
  compact = false,
}: OperationalDispatchSnapshotProps) {
  const fmtQty = (n: number) => formatDispatchQuantity(n, unit);
  const stockLimited =
    metrics.customerPending > metrics.usableStockNow + 1e-6 &&
    metrics.canDispatchNow <= metrics.usableStockNow + 1e-6;

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200/95 bg-gradient-to-br from-slate-50/95 to-white shadow-sm ring-1 ring-slate-100/80",
        compact ? "px-2.5 py-1.5" : "px-3 py-2.5",
        className,
      )}
      data-testid="operational-dispatch-snapshot"
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Operational snapshot</div>
      <dl className={cn("mt-1.5 grid gap-1.5", compact ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-5 gap-2")}>
        <div className={cn("rounded-md border border-slate-100 bg-white/90", compact ? "px-1.5 py-1" : "px-2 py-1.5")}>
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Allocated to SO</dt>
          <dd className={cn("font-bold tabular-nums leading-none text-slate-900", compact ? "mt-0.5 text-[15px]" : "mt-0.5 text-lg")}>
            {fmtQty(metrics.customerPending)}
          </dd>
        </div>
        <div className={cn("rounded-md border border-slate-100 bg-white/90", compact ? "px-1.5 py-1" : "px-2 py-1.5")}>
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Produced approved</dt>
          <dd className={cn("font-bold tabular-nums leading-none text-slate-900", compact ? "mt-0.5 text-[15px]" : "mt-0.5 text-lg")}>
            {fmtQty(metrics.producedApproved)}
          </dd>
        </div>
        <div className={cn("rounded-md border border-slate-100 bg-white/90", compact ? "px-1.5 py-1" : "px-2 py-1.5")}>
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Total dispatched</dt>
          <dd className={cn("font-bold tabular-nums leading-none text-slate-900", compact ? "mt-0.5 text-[15px]" : "mt-0.5 text-lg")}>
            {fmtQty(metrics.totalDispatched)}
          </dd>
        </div>
        <div className={cn("rounded-md border border-amber-100/90 bg-amber-50/55", compact ? "px-1.5 py-1" : "px-2 py-1.5")}>
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-amber-900/85">Available FG stock</dt>
          <dd className={cn("font-bold tabular-nums leading-none text-amber-950", compact ? "mt-0.5 text-[15px]" : "mt-0.5 text-lg")}>
            {fmtQty(metrics.usableStockNow)}
          </dd>
        </div>
        <div
          className={cn(
            "rounded-md border border-sky-100/90 bg-sky-50/65 sm:col-span-2 lg:col-span-1",
            compact ? "px-1.5 py-1" : "px-2 py-1.5",
          )}
        >
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-sky-900/85">Dispatchable qty</dt>
          <dd className={cn("font-bold tabular-nums leading-none text-sky-950", compact ? "mt-0.5 text-[15px]" : "mt-0.5 text-lg")}>
            {fmtQty(metrics.canDispatchNow)}
          </dd>
        </div>
      </dl>
      {showFlowHint && !compact ? (
        <p className="mt-2 text-[10px] leading-snug text-slate-500">
          <span className="font-medium text-slate-600">Produced approved</span>
          <span className="mx-1 text-slate-400" aria-hidden>
            →
          </span>
          <span className="font-medium text-slate-600">Dispatch</span>
          <span className="mx-1 text-slate-400" aria-hidden>
            →
          </span>
          <span className="font-medium text-slate-600">Available FG stock</span>
        </p>
      ) : null}
      {stockLimited ? (
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
          Allocated to SO quantity is higher than current available FG stock.
        </p>
      ) : null}
    </div>
  );
}
