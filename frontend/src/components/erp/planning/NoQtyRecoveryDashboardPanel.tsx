import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../../lib/utils";

export type NoQtyRecoveryDashboardSnapshot = {
  generatedAt: string;
  kpis: {
    productionShortfallPendingQty: number;
    qcRecoveryAvailableQty: number;
    recoveryWaitingForRsQty: number;
    soWaitingForWaiver: number;
    acceptedFgDispositionPending: number;
    blockedNoQtySoClosures: number;
    closedWithWaiver: number;
  };
  storePlanning: {
    productionShortfallPending: { qty: number; itemCount: number };
    qcRecoveryAvailable: { qty: number; itemCount: number };
    recoveryWaitingForRs: { qty: number; itemCount: number };
    recoveryAgeing: Array<{
      key: string;
      label: string;
      qty: number;
      itemCount: number;
      sourceCount: number;
      uom: string | null;
    }>;
  };
  admin: {
    soWaitingForWaiver: number;
    acceptedFgDispositionPending: number;
    blockedNoQtySoClosures: number;
    closedWithWaiver: number;
  };
};

function Kpi({
  label,
  qty,
  itemCount,
  tone,
}: {
  label: string;
  qty: number;
  itemCount?: number;
  tone?: "warn" | "muted";
}) {
  return (
    <div className="min-w-0 px-1.5 py-0.5">
      <div className="truncate text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={cn(
          "text-[13px] font-extrabold tabular-nums leading-none",
          tone === "warn" ? "text-amber-900" : tone === "muted" ? "text-slate-500" : "text-slate-900",
        )}
      >
        {Math.round(qty * 1000) / 1000}
      </div>
      {itemCount != null ? (
        <div className="text-[10px] tabular-nums text-slate-500">{itemCount} items</div>
      ) : null}
    </div>
  );
}

export function NoQtyRecoveryDashboardPanel({
  snapshot,
  isAdmin,
  className,
}: {
  snapshot: NoQtyRecoveryDashboardSnapshot | null;
  isAdmin: boolean;
  className?: string;
}) {
  if (!snapshot) return null;
  const sp = snapshot.storePlanning;
  const k = snapshot.kpis;

  return (
    <section
      className={cn(
        "rounded-md border border-slate-200 bg-white px-2.5 py-2 shadow-sm",
        className,
      )}
      aria-label="NO_QTY recovery dashboard"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
          NO_QTY recovery
        </h2>
        <Link
          to="/reports/no-qty-recovery-trace"
          className="text-[10px] font-semibold text-sky-800 hover:underline"
        >
          Recovery trace
        </Link>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-slate-100 pb-1.5">
        <Kpi
          label="Prod shortfall pending"
          qty={sp.productionShortfallPending.qty}
          itemCount={sp.productionShortfallPending.itemCount}
          tone={sp.productionShortfallPending.qty > 0 ? "warn" : "muted"}
        />
        <Kpi
          label="QC recovery available"
          qty={sp.qcRecoveryAvailable.qty}
          itemCount={sp.qcRecoveryAvailable.itemCount}
          tone={sp.qcRecoveryAvailable.qty > 0 ? "warn" : "muted"}
        />
        <Kpi
          label="Waiting for RS"
          qty={sp.recoveryWaitingForRs.qty}
          itemCount={sp.recoveryWaitingForRs.itemCount}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
        {sp.recoveryAgeing.map((b) => (
          <div key={b.key} className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700">
            <span className="font-semibold">{b.label}</span>
            <span className="ml-1 tabular-nums">
              {b.qty}
              {b.uom && b.uom !== "MIXED" ? ` ${b.uom}` : ""} · {b.itemCount} items
            </span>
          </div>
        ))}
      </div>
      {isAdmin ? (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-1.5">
          <Kpi label="Waiting waiver" qty={k.soWaitingForWaiver} tone={k.soWaitingForWaiver > 0 ? "warn" : "muted"} />
          <Kpi
            label="FG disposition"
            qty={k.acceptedFgDispositionPending}
            tone={k.acceptedFgDispositionPending > 0 ? "warn" : "muted"}
          />
          <Kpi label="Blocked closes" qty={k.blockedNoQtySoClosures} tone={k.blockedNoQtySoClosures > 0 ? "warn" : "muted"} />
          <Kpi label="Closed w/ waiver" qty={k.closedWithWaiver} />
        </div>
      ) : null}
    </section>
  );
}
