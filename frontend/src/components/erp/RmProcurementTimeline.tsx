import * as React from "react";
import { cn } from "../../lib/utils";
import { timelineStepsForPhase } from "../../lib/rmGuidedWorkflow";
import { formatProcurementQty } from "../../lib/woProcurementContinuity";

type Props = {
  activeStepIndex: number;
  mrDocNo?: string | null;
  prLineCount?: number;
  poLineCount?: number;
  pendingGrnQty?: number;
  receivedGrnQty?: number;
  className?: string;
};

/** Read-only procurement progress — not an action center. */
export function RmProcurementTimeline({
  activeStepIndex,
  mrDocNo,
  prLineCount = 0,
  poLineCount = 0,
  pendingGrnQty = 0,
  receivedGrnQty = 0,
  className,
}: Props) {
  const steps = timelineStepsForPhase(activeStepIndex);

  return (
    <div className={cn("rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2.5", className)}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Procurement progress (read-only)</p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {steps.map((step, i) => (
          <React.Fragment key={step.label}>
            {i > 0 ? <span className="text-slate-300">→</span> : null}
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                step.active && "bg-violet-200 text-violet-950 ring-1 ring-violet-400",
                step.done && !step.active && "bg-emerald-100 text-emerald-900",
                !step.done && !step.active && "text-slate-400",
              )}
            >
              {step.label}
              {step.done ? " ✓" : ""}
            </span>
          </React.Fragment>
        ))}
      </div>
      <ul className="mt-2 space-y-0.5 text-[11px] font-medium text-slate-600">
        {mrDocNo ? <li>MR: {mrDocNo}</li> : null}
        {prLineCount > 0 ? <li>PR lines on case: {prLineCount}</li> : null}
        {poLineCount > 0 ? <li>PO lines on case: {poLineCount}</li> : null}
        {pendingGrnQty > 0 ? (
          <li className="font-bold text-blue-900">Pending GRN: {formatProcurementQty(pendingGrnQty)}</li>
        ) : null}
        {receivedGrnQty > 0 ? <li>GRN received: {formatProcurementQty(receivedGrnQty)}</li> : null}
      </ul>
    </div>
  );
}
