import { cn } from "../../lib/utils";
import {
  WO_PREPARE_WORKFLOW_STEPS,
  type WoPrepareWorkflowStepLabel,
  workflowStepIndex,
} from "../../lib/woPrepareWorkflowGuidance";

type Props = {
  activeStep: WoPrepareWorkflowStepLabel;
};

export function WoPrepareWorkflowProgress({ activeStep }: Props) {
  const activeIdx = workflowStepIndex(activeStep);

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Workflow Status</p>
      <ol className="mt-1 flex flex-wrap gap-1.5">
        {WO_PREPARE_WORKFLOW_STEPS.map((step, idx) => {
          const isActive = idx === activeIdx;
          const isDone = idx < activeIdx;
          return (
            <li
              key={step}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                isActive && "bg-slate-900 text-white ring-slate-900",
                isDone && !isActive && "bg-emerald-50 text-emerald-900 ring-emerald-300",
                !isActive && !isDone && "bg-slate-50 text-slate-500 ring-slate-200",
              )}
            >
              {step}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
