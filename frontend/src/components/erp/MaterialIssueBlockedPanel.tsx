import { Link } from "react-router-dom";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { buildRmControlCenterHref } from "../../lib/woProcurementContinuity";
import { stockCommittedElsewhereSummary } from "../../lib/stockCommitmentVisibility";

type Props = {
  workOrderId?: number | null;
  rmItemId?: number | null;
  salesOrderId?: number | null;
  physicalQty?: number | null;
  freeQty?: number | null;
  unit?: string | null;
};

export function MaterialIssueBlockedPanel({
  workOrderId,
  rmItemId,
  salesOrderId,
  physicalQty = 0,
  freeQty = 0,
}: Props) {
  const physical = Number(physicalQty ?? 0);
  const free = Number(freeQty ?? 0);
  const committedElsewhere = physical > 0 && free <= 0;

  return (
    <section className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-4 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-900">Issue not available</p>
      <h2 className="mt-1 text-lg font-extrabold text-amber-950">
        {committedElsewhere ? "Stock exists but is committed elsewhere" : "No available stock to issue"}
      </h2>
      <p className="mt-2 text-sm font-medium text-amber-950">
        {committedElsewhere
          ? "Store stock exists physically but is committed to other work orders. Confirm allocation in RM Control Center before issuing."
          : "There is no free store stock for this material request. Follow the guided step in RM Control Center."}
      </p>
      <p className="mt-2 text-xs text-amber-900">{stockCommittedElsewhereSummary()}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to={buildRmControlCenterHref({
            workOrderId: workOrderId ?? undefined,
            rmItemId: rmItemId ?? undefined,
            salesOrderId: salesOrderId ?? undefined,
            returnTo: "rm-control-center",
          })}
          className={cn(
            buttonVariants({ size: "default" }),
            "h-10 bg-slate-900 px-5 font-bold text-white hover:bg-slate-800 no-underline",
          )}
        >
          View allocation details
        </Link>
      </div>
    </section>
  );
}
