import type { ProductionNoQtyWoSummary } from "./ProductionNoQtyWoSummaryCard";
import { ProductionOperatorIdentityBar } from "./ProductionOperatorIdentityBar";
import { cn } from "../../../lib/utils";

/** @deprecated Prefer ProductionOperatorIdentityBar — kept for call-site compatibility. */
export function ProductionNoQtyOperatorContextBar({
  summary,
  flowLabel = "NO_QTY",
  flowContextLabel,
  statusLabel = "In progress",
  unit,
  className,
}: {
  summary: ProductionNoQtyWoSummary;
  flowLabel?: string;
  flowContextLabel?: string | null;
  statusLabel?: string;
  unit?: string | null;
  className?: string;
}) {
  return (
    <ProductionOperatorIdentityBar
      className={cn(className)}
      woLabel={summary.woLabel}
      itemName={summary.itemName}
      flowLabel={flowLabel}
      flowContextLabel={flowContextLabel}
      statusLabel={statusLabel}
      plannedQty={summary.plannedQty}
      producedQty={summary.producedQty}
      remainingQty={summary.remainingQty}
      unit={unit}
    />
  );
}
