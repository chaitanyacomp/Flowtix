import { cn } from "../../../lib/utils";
import {
  NO_QTY_ERP_ADJUSTED_PLANNING_LABEL,
  NO_QTY_ERP_ADJUSTED_PLANNING_TOOLTIP,
} from "../../../lib/noQtyShortagePresentation";
import { useIsAdmin } from "../../../hooks/useIsAdmin";

function fmtQty(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 1e-9) return "0";
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : String(r);
}

/**
 * Collapsed admin-only reconciliation qty — never shown to normal operators by default.
 */
export function NoQtyErpPlanningAuditDetail({
  qty,
  className,
}: {
  qty: number | null | undefined;
  className?: string;
}) {
  const isAdmin = useIsAdmin();
  const n = Number(qty ?? 0);
  if (!isAdmin || !Number.isFinite(n) || n <= 1e-9) return null;

  return (
    <details
      className={cn(
        "rounded border border-slate-200/90 bg-slate-50/80 px-2 py-1 text-[11px] text-slate-700",
        className,
      )}
    >
      <summary
        className="cursor-pointer select-none font-medium text-slate-600"
        title={NO_QTY_ERP_ADJUSTED_PLANNING_TOOLTIP}
      >
        {NO_QTY_ERP_ADJUSTED_PLANNING_LABEL}:{" "}
        <span className="font-semibold tabular-nums text-slate-900">{fmtQty(n)}</span>
      </summary>
      <p className="mt-1 leading-snug text-slate-600">{NO_QTY_ERP_ADJUSTED_PLANNING_TOOLTIP}</p>
    </details>
  );
}
