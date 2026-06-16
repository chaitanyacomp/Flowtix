import { Link } from "react-router-dom";
import { Button, buttonVariants } from "../../ui/button";
import { cn } from "../../../lib/utils";
import {
  presentNoQtyNextRsStatus,
  type NoQtyNextRsBlockerInput,
} from "../../../lib/noQtyNextRsBlockerPresentation";
import { buildNoQtyGuidedHref, type NoQtyFromStep } from "../../../lib/noQtyFlowState";
import { useCanCreateNextRs } from "../../../hooks/useIsAdmin";
import { createNextRsButtonLabel } from "../../../lib/noQtyRsActionLabels";

type Props = {
  salesOrderId: number;
  cycleId: number | null;
  fromStep?: NoQtyFromStep;
  eligibility: NoQtyNextRsBlockerInput;
  className?: string;
  onPrepareNext?: () => void;
  prepareBusy?: boolean;
  /** P6B-4A — hide create CTA on monitoring/shortcut surfaces (SO page owns creation). */
  showCreateAction?: boolean;
  createButtonLabel?: string;
};

/** P6B-4A — Always show Next RS status; cycle-oriented business language. */
export function NoQtyNextRsStatusPanel({
  salesOrderId,
  cycleId,
  fromStep = "requirement",
  eligibility,
  className,
  onPrepareNext,
  prepareBusy,
  showCreateAction = true,
  createButtonLabel,
}: Props) {
  const canCreateNextRs = useCanCreateNextRs();
  const status = presentNoQtyNextRsStatus(eligibility);
  const createLabel = createButtonLabel ?? createNextRsButtonLabel(eligibility.nextCycleNo);

  if (status.canCreate && !canCreateNextRs) {
    return (
      <div
        className={cn("rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700", className)}
        data-testid="no-qty-next-rs-status"
      >
        <p className="font-semibold text-slate-900">{status.title}</p>
        <p className="mt-1">{status.detail ?? "Next cycle Requirement Sheet is ready for Store or Admin to create."}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-[12px]",
        status.canCreate ? "border-emerald-200 bg-emerald-50/80 text-emerald-950" : "border-amber-200 bg-amber-50/90 text-amber-950",
        className,
      )}
      data-testid="no-qty-next-rs-status"
    >
      <p className="font-semibold text-slate-900">{status.title}</p>
      {status.reason ? (
        <p className="mt-1 text-[11px] leading-snug">
          <span className="font-semibold">Reason: </span>
          {status.reason}
        </p>
      ) : null}
      {status.canCreate && canCreateNextRs && showCreateAction ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {onPrepareNext ? (
            <Button type="button" size="sm" disabled={prepareBusy} onClick={onPrepareNext}>
              {prepareBusy ? "…" : createLabel}
            </Button>
          ) : (
            <Link
              to={buildNoQtyGuidedHref({
                to: `/sales-orders/${salesOrderId}/requirement-sheets?intent=add`,
                salesOrderId,
                cycleId,
                fromStep,
              })}
              className={cn(buttonVariants({ size: "sm" }), "font-semibold")}
              data-testid="no-qty-create-next-rs"
            >
              {createLabel}
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
