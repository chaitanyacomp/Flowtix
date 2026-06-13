import type { NoQtyFlowState } from "../../../lib/noQtyFlowState";
import type { ProductionConciseRmLabel } from "../../../lib/productionRmConciseStatus";
import { cn } from "../../../lib/utils";

export type MacroLifecycleStage = {
  key: string;
  label: string;
  status: "done" | "current" | "pending";
};

type Props = {
  flow: NoQtyFlowState | null;
  rmLabel?: ProductionConciseRmLabel | null;
  cycleNo?: number | null;
  className?: string;
};

/**
 * P6B-2 — read-only NO_QTY macro lifecycle (RS → Monthly Planning → Procurement → Production).
 * Visualization only; uses existing flow-state signals.
 */
export function deriveNoQtyMacroLifecycleStages(
  flow: NoQtyFlowState | null,
  rmLabel?: ProductionConciseRmLabel | null,
): MacroLifecycleStage[] {
  const rsDone = Boolean(flow?.requirementLocked);
  const woReady = Boolean(flow?.workOrderExists);
  const prodStarted = Boolean(flow?.productionExists);
  const rmReady = rmLabel === "READY";
  const rmWaiting = rmLabel === "WAITING RM" || rmLabel === "PARTIAL";

  let rs: MacroLifecycleStage["status"] = "pending";
  if (rsDone) rs = "done";
  else if (flow?.requirementExists) rs = "current";

  let mp: MacroLifecycleStage["status"] = "pending";
  if (woReady) mp = "done";
  else if (rsDone) mp = "current";

  let proc: MacroLifecycleStage["status"] = "pending";
  if (rmReady && woReady) proc = "done";
  else if (woReady && rmWaiting) proc = "current";
  else if (woReady && !rmLabel) proc = "current";

  let prod: MacroLifecycleStage["status"] = "pending";
  if (prodStarted) prod = "current";
  else if (rmReady && woReady) prod = "current";

  if (flow?.primaryAction === "PRODUCTION" || flow?.nextAction === "PRODUCTION") {
    prod = "current";
  }

  return [
    { key: "rs", label: "Requirement Sheet", status: rs },
    { key: "mp", label: "Monthly Planning", status: mp },
    { key: "proc", label: "Procurement", status: proc },
    { key: "prod", label: "Production", status: prod },
  ];
}

function stageClass(status: MacroLifecycleStage["status"]): string {
  if (status === "done") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (status === "current") return "border-sky-300 bg-sky-50 text-sky-950 ring-1 ring-sky-200";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

export function NoQtyMacroLifecycleStrip({ flow, rmLabel, cycleNo, className }: Props) {
  const stages = deriveNoQtyMacroLifecycleStages(flow, rmLabel);
  return (
    <div
      className={cn("rounded-md border border-slate-200 bg-white px-2 py-1.5", className)}
      data-testid="no-qty-macro-lifecycle"
      aria-label="NO_QTY process stages"
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Process stage</span>
        {cycleNo != null ? (
          <span className="text-[10px] font-semibold text-violet-900">
            Cycle <span className="tabular-nums">{cycleNo}</span>
          </span>
        ) : null}
      </div>
      <ol className="flex min-w-0 flex-wrap items-center gap-1">
        {stages.map((stage, idx) => (
          <li key={stage.key} className="flex items-center gap-1">
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                stageClass(stage.status),
              )}
            >
              {stage.label}
            </span>
            {idx < stages.length - 1 ? (
              <span className="text-[10px] text-slate-300" aria-hidden>
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
