import { cn } from "../../lib/utils";
import { StatBlock } from "./StatBlock";

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

type FgWoBalanceItem = {
  soOrderedQty: number;
  customerCommittedQty?: number;
  plannedProductionQty?: number;
  /** Confirmed (locked) net dispatched for this SO + FG — matches planning remainder math on server. */
  dispatchedQty?: number;
  plannedOnOtherWorkOrdersQty: number;
  /** Net carry-forward from previous COMPLETED WO shortfall (planned − QC accepted), computed server-side. */
  carryForwardShortfallQty?: number;
  /** APPROVED production summed across WO lines for this SO + FG (informational). */
  producedQty?: number;
  /** Remaining for WO planning: planned production qty − dispatched − planned on other WOs. */
  balanceQty: number;
  /** Prefill hint — matches balanceQty (planning remainder). */
  suggestedWoQty?: number;
  /** Operational remainder to fulfill on this SO (SO-line FIFO dispatch), same basis as Dispatch. */
  pendingSoQty?: number;
  /** Usable FG on-hand (global for SKU). */
  stockAvailableQty?: number;
  /** Gross QC accepted tied to this SO + FG (production + adjustment QC). */
  qcAcceptedGross?: number;
  /** QC pool not yet attributed to net dispatch for this SO + item. */
  qcApprovedRemaining?: number;
  /** Same dispatch-ready qty as Dispatch screen (item-level for this FG on the SO). */
  dispatchableQty?: number;
  /** max(0, pending SO − dispatchable). */
  shortageQty?: number;
};

type Props = {
  className?: string;
  balance: FgWoBalanceItem | undefined;
  fallbackSoOrdered?: number;
  /** Sum of WO qty draft for this FG across all lines (same item may appear on multiple rows). */
  draftEntryQty: number | null;
  /** When editing a WO, planned qty is only on *other* work orders — label reflects that. */
  isEditingWorkOrder?: boolean;
  /**
   * REGULAR SO shortfall / buffer: draft may exceed planning remainder intentionally — do not warn.
   * Does not apply to NO_QTY.
   */
  relaxPlanningDraftOverCap?: boolean;
};

/**
 * Read-only WO planning context (StatBlocks): planning caps plus dispatch-ready alignment (same basis as Dispatch).
 */
export function WoInfoPanel({
  className,
  balance,
  fallbackSoOrdered,
  draftEntryQty,
  isEditingWorkOrder,
  relaxPlanningDraftOverCap,
}: Props) {
  if (balance) {
    const produced = balance.producedQty ?? 0;
    const hasDispatchMetrics =
      balance.pendingSoQty != null && balance.dispatchableQty != null && balance.shortageQty != null;
    const dispatched = balance.dispatchedQty ?? 0;
    const suggested = balance.suggestedWoQty ?? balance.balanceQty;
    const customerQty = balance.customerCommittedQty ?? balance.soOrderedQty;
    const plannedQty = balance.plannedProductionQty ?? balance.balanceQty + balance.plannedOnOtherWorkOrdersQty;
    const carry = balance.carryForwardShortfallQty ?? 0;
    const warnings: string[] = [];
    if (balance.balanceQty <= 1e-9) {
      warnings.push("No remaining quantity for WO planning on this FG.");
    }
    if (balance.plannedOnOtherWorkOrdersQty > 0 && balance.balanceQty <= 1e-9) {
      warnings.push(isEditingWorkOrder ? "Other work orders already use the rest of this FG." : "Already fully planned on work orders.");
    }
    if (
      !relaxPlanningDraftOverCap &&
      draftEntryQty != null &&
      draftEntryQty > balance.balanceQty + 1e-6
    ) {
      warnings.push("Exceeds allowed quantity for planning.");
    }

    const plannedLabel = isEditingWorkOrder ? "Planned (other WOs)" : "Already planned (WO)";

    return (
      <div className={cn("min-w-0", className)}>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Sales order finished good: work order planning quantities"
        >
          <StatBlock label="Customer qty" value={fmtQty(customerQty)} />
          <StatBlock label="Dispatched qty" value={fmtQty(dispatched)} />
          <StatBlock label="Planned production qty" value={fmtQty(plannedQty)} />
          <StatBlock label="Remaining (planning)" value={fmtQty(balance.balanceQty)} emphasis />
          <StatBlock label="Suggested WO qty" value={fmtQty(suggested)} />
        </div>
        <div
          className="mt-1.5 flex flex-wrap gap-2"
          role="group"
          aria-label="Additional production context"
        >
          <StatBlock label={plannedLabel} value={fmtQty(balance.plannedOnOtherWorkOrdersQty)} />
          <StatBlock label="Produced qty" value={fmtQty(produced)} />
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
          Remaining (planning) = max(0, planned production qty − total QC accepted − already planned on other work orders).
          Pending SO / dispatch-ready row uses operational rules like the Dispatch screen.
        </p>
        {carry > 1e-9 ? (
          <p className="mt-1 text-[11px] leading-snug text-slate-600">
            Includes <span className="font-medium tabular-nums">{fmtQty(carry)}</span> qty from previous WO shortfall.
          </p>
        ) : null}
        {hasDispatchMetrics ? (
          <div
            className="mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-2"
            role="group"
            aria-label="Dispatch-ready quantities for this finished good"
          >
            <StatBlock label="Pending SO" value={fmtQty(balance.pendingSoQty!)} />
            <StatBlock label="Dispatchable" value={fmtQty(balance.dispatchableQty!)} />
            <StatBlock label="Shortage" value={fmtQty(balance.shortageQty!)} />
            {balance.stockAvailableQty != null ? (
              <StatBlock label="Stock available" value={fmtQty(balance.stockAvailableQty)} />
            ) : null}
            {balance.qcAcceptedGross != null ? (
              <StatBlock label="QC approved (gross)" value={fmtQty(balance.qcAcceptedGross)} />
            ) : null}
            {balance.qcApprovedRemaining != null ? (
              <StatBlock label="QC pool left" value={fmtQty(balance.qcApprovedRemaining)} />
            ) : null}
          </div>
        ) : null}
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

  if (fallbackSoOrdered != null && Number.isFinite(fallbackSoOrdered)) {
    return (
      <p className={cn("text-left text-sm leading-snug text-slate-500 sm:text-right", className)}>
        Customer qty: <span className="font-medium tabular-nums text-slate-800">{fmtQty(fallbackSoOrdered)}</span>
        <span className="text-slate-500"> · Balance details load after FG is selected.</span>
      </p>
    );
  }

  return (
    <p className={cn("text-left text-sm leading-snug text-slate-500 sm:text-right", className)}>
      Select sales order and finished good to see planning quantities and limits.
    </p>
  );
}
