import { cn } from "../../../lib/utils";
import {
  productionFlowBadgeLabel,
  type ProductionFlowParam,
  PRODUCTION_FLOW_NO_QTY,
} from "../../../lib/productionFlowContract";
import { productionFlowDisplayLabel } from "../../../lib/productionFlowPresentation";

type Props = {
  flow: ProductionFlowParam;
  className?: string;
};

/** Compact flow-type badge for headers and workspace chrome. */
export function ProductionFlowTypeBadge({ flow, className }: Props) {
  const isNoQty = flow === PRODUCTION_FLOW_NO_QTY;
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        isNoQty ? "border border-violet-300 bg-violet-100 text-violet-950" : "bg-slate-900 text-white",
        className,
      )}
      data-testid="production-flow-badge"
      title={productionFlowBadgeLabel(flow)}
    >
      {productionFlowDisplayLabel(flow)}
    </span>
  );
}
