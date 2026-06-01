import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { buildNoQtyGuidedHref, type NoQtyFlowState, type NoQtyFromStep } from "../../lib/noQtyFlowState";
import { useAuth } from "../../hooks/useAuth";
import { NEXT_RS_WRITE_ROLES } from "../../config/erpRoles";

type FlowPick = Pick<NoQtyFlowState, "createNextRsEligible" | "nextRsAlreadyCreatedDocNo">;

/**
 * Renders the "Create Next RS" CTA for a NO_QTY sales order.
 *
 * Ownership rule: only ADMIN can create Next RS (matches backend
 * `NEXT_RS_WRITE_ROLES`). For other roles we still surface the read-only
 * "already created" tag when applicable, but never the action button.
 * Callers may pass any role — the guard lives here.
 *
 * Eligibility is independent of QC / Dispatch / Sales bill completion:
 * NO_QTY rolling planning runs in parallel to shop-floor work for an open SO
 * with a locked current RS and no later locked RS.
 */
export function NoQtyCreateNextRsInline(props: {
  salesOrderId: number;
  cycleId: number | null;
  fromStep: NoQtyFromStep;
  flow: FlowPick | null | undefined;
  className?: string;
  /** Button label (default: Create Next RS) */
  buttonLabel?: string;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  buttonSize?: "default" | "sm" | "lg" | "icon";
}) {
  const {
    salesOrderId,
    cycleId,
    fromStep,
    flow,
    buttonLabel = "Create Next RS",
    buttonVariant = "outline",
    buttonSize = "sm",
  } = props;
  const { user } = useAuth();
  const role = (user?.role ?? "").trim();
  const canCreateNextRs = (NEXT_RS_WRITE_ROLES as readonly string[]).includes(role);

  if (!flow) return null;
  const { createNextRsEligible, nextRsAlreadyCreatedDocNo } = flow;
  if (!createNextRsEligible && !nextRsAlreadyCreatedDocNo) return null;
  const showButton = createNextRsEligible && canCreateNextRs;
  if (!showButton && !nextRsAlreadyCreatedDocNo) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", props.className)}>
      {showButton ? (
        <Link
          to={buildNoQtyGuidedHref({
            to: `/sales-orders/${salesOrderId}/requirement-sheets?intent=add`,
            salesOrderId,
            cycleId,
            fromStep,
          })}
          className="inline-flex"
          data-testid="no-qty-create-next-rs"
        >
          <Button type="button" size={buttonSize} variant={buttonVariant} className="font-semibold">
            {buttonLabel}
          </Button>
        </Link>
      ) : null}
      {nextRsAlreadyCreatedDocNo ? (
        <span className="text-[11px] leading-snug text-slate-600">
          Next RS already created: {nextRsAlreadyCreatedDocNo}
        </span>
      ) : null}
    </div>
  );
}
