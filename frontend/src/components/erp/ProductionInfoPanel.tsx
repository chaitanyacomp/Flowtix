import { cn } from "../../lib/utils";
import { formatFgQuantity } from "../../lib/quantityDisplay";
import { StatBlock } from "./StatBlock";

type Props = {
  className?: string;
  /** Tighter strip (WO balance summary–style): emphasize stat row, less vertical chrome. */
  compact?: boolean;
  workOrderId: number;
  salesOrderId: number;
  itemName: string;
  /** FG item UOM from Item Master. */
  unit?: string | null;
  woLineQty: number;
  producedSoFar: number;
  remainingQty: number;
  /** Parsed draft qty from the input, when valid; used for exceed-remaining warning only. */
  draftProducedQty: number | null;
};

/**
 * Compact decision-support strip for production entry: refs, quantities, optional warnings.
 * Display-only; does not enforce business rules.
 */
export function ProductionInfoPanel({
  className,
  compact,
  workOrderId,
  salesOrderId,
  itemName,
  unit,
  woLineQty,
  producedSoFar,
  remainingQty,
  draftProducedQty,
}: Props) {
  const warnings: string[] = [];
  if (remainingQty <= 0) {
    warnings.push("No remaining quantity on this line.");
  }
  if (draftProducedQty != null && remainingQty > 0 && draftProducedQty > remainingQty) {
    warnings.push("Entered quantity exceeds remaining capacity.");
  }

  return (
    <div className={cn("min-w-0", className)}>
      {compact ? (
        <p className="mb-1.5 text-xs leading-snug text-slate-600">
          <span className="font-medium text-slate-800">{itemName}</span>
          <span className="text-slate-400"> · </span>
          SO #{salesOrderId}
          <span className="text-slate-400"> · </span>
          WO #{workOrderId}
        </p>
      ) : (
        <>
          <p className="text-sm font-semibold leading-snug text-slate-900">{itemName}</p>
          <p className="mt-0.5 text-xs text-slate-600">
            SO #{salesOrderId}
            <span className="text-slate-400"> · </span>
            WO #{workOrderId}
          </p>
        </>
      )}
      <div
        className={cn("flex flex-wrap gap-2", compact ? "mt-0" : "mt-2")}
        role="group"
        aria-label="Production quantities for selected work order line"
      >
        <StatBlock label="WO qty" value={formatFgQuantity(woLineQty, unit)} />
        <StatBlock label="Used" value={formatFgQuantity(producedSoFar, unit)} />
        <StatBlock label="Remaining" value={formatFgQuantity(remainingQty, unit)} emphasis />
      </div>
      {warnings.length > 0 ? (
        <ul className={cn("space-y-0.5 text-xs font-medium text-amber-900", compact ? "mt-1.5" : "mt-2")}>
          {warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
