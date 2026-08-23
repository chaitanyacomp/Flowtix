import * as React from "react";
import {
  blockReasonDisplayLabel,
  fetchCarryForwardPending,
  type CarryForwardPendingRow,
} from "../../../lib/productionExecutionApi";
import { useAuth } from "../../../hooks/useAuth";
import { CARRY_FORWARD_PENDING_ROLES, hasErpRole } from "../../../config/erpRoles";

type Props = {
  /** When false, render nothing and do not call the API. */
  enabled?: boolean;
};

export function CarryForwardPendingSection({ enabled }: Props = {}) {
  const { user } = useAuth();
  const allowed = enabled ?? hasErpRole(user?.role, CARRY_FORWARD_PENDING_ROLES);
  const [rows, setRows] = React.useState<CarryForwardPendingRow[]>([]);
  const [loading, setLoading] = React.useState(allowed);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!allowed) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCarryForwardPending();
        if (!cancelled) setRows(data.rows ?? []);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load carry forward pending.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  if (!allowed) return null;

  if (loading) {
    return <div className="text-sm text-slate-600">Loading carry forward pending…</div>;
  }
  if (error) {
    return <div className="text-sm text-red-700">{error}</div>;
  }
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
        No carry forward pending quantities. These appear when Production finishes execution with Carry Forward Balance.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200" data-testid="carry-forward-pending-table">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Customer</th>
            <th className="px-3 py-2">Sales Order</th>
            <th className="px-3 py-2">Source RS</th>
            <th className="px-3 py-2">Source WO</th>
            <th className="px-3 py-2 text-right">Remaining Qty</th>
            <th className="px-3 py-2">Reason</th>
            <th className="px-3 py-2 text-right">Age (days)</th>
            <th className="px-3 py-2">Planned Next RS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium">{r.itemName ?? `#${r.itemId}`}</td>
              <td className="px-3 py-2">{r.customerName ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.salesOrderDocNo ?? `SO-${r.salesOrderId}`}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.sourceRequirementSheetDocNo ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.sourceWorkOrderDocNo ?? `WO-${r.sourceWorkOrderId}`}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.remainingQty}</td>
              <td className="px-3 py-2">
                {blockReasonDisplayLabel(r.resolutionReason)}
                {r.resolutionReasonOther ? ` — ${r.resolutionReasonOther}` : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.ageDays}</td>
              <td className="px-3 py-2">{r.plannedNextRsHint ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
