import { cn } from "../../lib/utils";
import { StatBlock } from "./StatBlock";

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

type Props = {
  className?: string;
  fgItemName: string;
  workOrderId: number;
  salesOrderId: number;
  producedQty: number;
  qcDone: number;
  pendingQty: number;
  /** accepted + rejected for this posting (when both parse); for over-pending warning */
  draftCheckedTotal: number | null;
};

/**
 * Read-only QC context for the selected production batch (aligned with fast-entry forms).
 */
export function QcInfoPanel({
  className,
  fgItemName,
  workOrderId,
  salesOrderId,
  producedQty,
  qcDone,
  pendingQty,
  draftCheckedTotal,
}: Props) {
  const warnings: string[] = [];
  if (pendingQty <= 1e-9) {
    warnings.push("No pending QC quantity on this batch.");
  }
  if (draftCheckedTotal != null && pendingQty > 1e-9 && draftCheckedTotal > pendingQty + 1e-6) {
    warnings.push("Total exceeds pending QC quantity.");
  }

  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-sm font-semibold leading-snug text-slate-900">{fgItemName}</p>
      <p className="mt-0.5 text-xs text-slate-600">
        SO #{salesOrderId}
        <span className="text-slate-400"> · </span>
        WO #{workOrderId}
      </p>
      <div
        className="mt-2 flex flex-wrap gap-2"
        role="group"
        aria-label="Production batch QC summary"
      >
        <StatBlock label="Produced qty" value={fmtQty(producedQty)} />
        <StatBlock label="QC done" value={fmtQty(qcDone)} />
        <StatBlock label="Pending QC" value={fmtQty(pendingQty)} emphasis />
      </div>
      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs font-medium text-amber-900">
          {warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
