import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export type NoQtyStageKey = "REQUIREMENT" | "WORK_ORDER" | "PRODUCTION" | "QC" | "DISPATCH" | "SALES_BILL";

const STAGES: Array<{ key: NoQtyStageKey; label: string }> = [
  { key: "REQUIREMENT", label: "Requirement" },
  { key: "WORK_ORDER", label: "Work Order" },
  { key: "PRODUCTION", label: "Production" },
  { key: "QC", label: "QC" },
  { key: "DISPATCH", label: "Dispatch" },
  { key: "SALES_BILL", label: "Sales Bill" },
];

function stageIndex(k: NoQtyStageKey): number {
  const ix = STAGES.findIndex((s) => s.key === k);
  return ix >= 0 ? ix : 0;
}

export function NoQtyFlowStepsCard({
  currentStage,
  cycleStatus,
  hideWorkOrderStep = false,
  className,
  ariaLabel = "No Qty workflow steps",
}: {
  currentStage: NoQtyStageKey;
  cycleStatus: "Active Cycle" | "Closed Cycle";
  /** NO_QTY operational cycle flow skips Work Order as an operator step. */
  hideWorkOrderStep?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const cur = stageIndex(currentStage);
  const closed = cycleStatus === "Closed Cycle";
  const stages = hideWorkOrderStep ? STAGES.filter((s) => s.key !== "WORK_ORDER") : STAGES;
  const curIdx = hideWorkOrderStep
    ? Math.max(0, stages.findIndex((s) => s.key === currentStage))
    : cur;

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("rounded-md border border-slate-200 bg-white p-3 shadow-sm", className)}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Steps</div>
      <ol className="mt-2 space-y-1">
        {stages.map((s, idx) => {
          const done = closed ? idx <= stages.length - 1 : idx < curIdx;
          const active = idx === curIdx;
          return (
            <li key={s.key}>
              <div
                className={cn(
                  "flex items-center gap-2 rounded px-2 py-1 text-[13px]",
                  active && "bg-sky-50 text-sky-950 ring-1 ring-sky-200/70",
                  done && !active && "bg-emerald-50/60 text-emerald-950",
                  !done && !active && "text-slate-700",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                    done && "border-emerald-200 bg-emerald-50 text-emerald-800",
                    active && "border-sky-200 bg-sky-50 text-sky-900",
                    !done && !active && "border-slate-200 bg-slate-100 text-slate-700",
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : idx + 1}
                </span>
                <span className={cn("min-w-0 truncate", active && "font-semibold")}>{s.label}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

