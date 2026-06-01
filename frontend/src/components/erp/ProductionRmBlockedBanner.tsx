import { Link } from "react-router-dom";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { buildRmControlCenterHref } from "../../lib/woProcurementContinuity";
import { productionRmOperationalStatus } from "../../lib/stockCommitmentVisibility";

type Props = {
  workOrderId: number;
  workOrderNo?: string | null;
  gate?: string | null;
  message?: string | null;
};

export function ProductionRmBlockedBanner({ workOrderId, workOrderNo, gate, message }: Props) {
  const ops = productionRmOperationalStatus(gate);

  return (
    <section className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-4 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-900">RM status</p>
      <h2 className="mt-1 text-lg font-extrabold text-amber-950">{ops.label}</h2>
      <p className="mt-2 text-sm font-medium text-amber-950">{message ?? ops.detail}</p>
      <p className="mt-2 text-xs text-amber-900">
        You cannot start production until Store completes this step. Work order:{" "}
        <span className="font-bold">{workOrderNo ?? `WO-${workOrderId}`}</span>
      </p>
      <Link
        to={buildRmControlCenterHref({ workOrderId, returnTo: "production-workspace" })}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "mt-4 inline-flex h-9 font-bold no-underline",
        )}
      >
        View RM status
      </Link>
    </section>
  );
}
