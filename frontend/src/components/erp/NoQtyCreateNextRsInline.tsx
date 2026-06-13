import { NoQtyNextRsStatusPanel } from "./production/NoQtyNextRsStatusPanel";
import type { NoQtyFlowState, NoQtyFromStep } from "../../lib/noQtyFlowState";

type FlowPick = Pick<
  NoQtyFlowState,
  "createNextRsEligible" | "nextRsAlreadyCreatedDocNo" | "blockedReasons"
> & {
  noQtyCreateNextRsBlockReason?: string | null;
  noQtyCreateNextRsBlockingPmrDocNo?: string | null;
};

/**
 * Renders Next RS status for a NO_QTY sales order (P6B-1 — always visible).
 */
export function NoQtyCreateNextRsInline(props: {
  salesOrderId: number;
  cycleId: number | null;
  fromStep: NoQtyFromStep;
  flow: FlowPick | null | undefined;
  className?: string;
  buttonLabel?: string;
}) {
  const { salesOrderId, cycleId, fromStep, flow, className } = props;
  if (!flow) return null;

  const reason =
    flow.noQtyCreateNextRsBlockReason ??
    (Array.isArray(flow.blockedReasons) && flow.blockedReasons.length ? flow.blockedReasons[0] : null);

  return (
    <NoQtyNextRsStatusPanel
      salesOrderId={salesOrderId}
      cycleId={cycleId}
      fromStep={fromStep}
      className={className}
      eligibility={{
        eligible: flow.createNextRsEligible,
        reason,
        blockingPmrDocNo: flow.noQtyCreateNextRsBlockingPmrDocNo ?? null,
        existingNextRsDocNo: flow.nextRsAlreadyCreatedDocNo,
      }}
    />
  );
}
