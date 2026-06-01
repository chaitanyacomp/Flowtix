import { cn } from "../../lib/utils";

export type OperationalDispatchSnapshotMetrics = {
  customerPending: number;
  producedApproved: number;
  totalDispatched: number;
  usableStockNow: number;
  canDispatchNow: number;
};

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n * 1000) / 1000;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return String(r);
}

type OperationalDispatchSnapshotProps = {
  metrics: OperationalDispatchSnapshotMetrics;
  className?: string;
  /** When true, show the simple Produced → Dispatch → Usable flow line. */
  showFlowHint?: boolean;
};

/**
 * Operator-facing dispatch numbers — no FIFO / entitlement / pool jargon.
 */
export function OperationalDispatchSnapshot({
  metrics,
  className,
  showFlowHint = true,
}: OperationalDispatchSnapshotProps) {
  const stockLimited =
    metrics.customerPending > metrics.usableStockNow + 1e-6 &&
    metrics.canDispatchNow <= metrics.usableStockNow + 1e-6;

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200/95 bg-gradient-to-br from-slate-50/95 to-white px-3 py-2.5 shadow-sm ring-1 ring-slate-100/80",
        className,
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Operational snapshot</div>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-md border border-slate-100 bg-white/90 px-2 py-1.5">
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Customer pending</dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums leading-none text-slate-900">{fmtQty(metrics.customerPending)}</dd>
        </div>
        <div className="rounded-md border border-slate-100 bg-white/90 px-2 py-1.5">
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Produced approved</dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums leading-none text-slate-900">{fmtQty(metrics.producedApproved)}</dd>
        </div>
        <div className="rounded-md border border-slate-100 bg-white/90 px-2 py-1.5">
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Total dispatched</dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums leading-none text-slate-900">{fmtQty(metrics.totalDispatched)}</dd>
        </div>
        <div className="rounded-md border border-amber-100/90 bg-amber-50/55 px-2 py-1.5">
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-amber-900/85">Usable stock now</dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums leading-none text-amber-950">{fmtQty(metrics.usableStockNow)}</dd>
        </div>
        <div className="rounded-md border border-sky-100/90 bg-sky-50/65 px-2 py-1.5 sm:col-span-2 lg:col-span-1">
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-sky-900/85">Can dispatch now</dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums leading-none text-sky-950">{fmtQty(metrics.canDispatchNow)}</dd>
        </div>
      </dl>
      {showFlowHint ? (
        <p className="mt-2 text-[10px] leading-snug text-slate-500">
          <span className="font-medium text-slate-600">Produced approved</span>
          <span className="mx-1 text-slate-400" aria-hidden>
            →
          </span>
          <span className="font-medium text-slate-600">Dispatch</span>
          <span className="mx-1 text-slate-400" aria-hidden>
            →
          </span>
          <span className="font-medium text-slate-600">Remaining usable</span>
        </p>
      ) : null}
      {stockLimited ? (
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
          Customer pending quantity is higher than current usable stock.
        </p>
      ) : null}
    </div>
  );
}
