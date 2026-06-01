import * as React from "react";
import { cn } from "../../lib/utils";
import { WO_PROCUREMENT_WORKFLOW_STAGES, woProcurementStageIndex } from "../../lib/woProcurementContinuity";

type Props = {
  operationalKey: string;
  className?: string;
  /** Compact: single-line chips; default: labeled strip */
  variant?: "strip" | "compact";
};

export function WoProcurementContinuityStrip({ operationalKey, className, variant = "strip" }: Props) {
  const activeIdx = woProcurementStageIndex(operationalKey);

  if (variant === "compact") {
    return (
      <div className={cn("flex flex-wrap items-center gap-0.5 text-[9px] leading-snug", className)}>
        {WO_PROCUREMENT_WORKFLOW_STAGES.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 ? <span className="text-slate-300">→</span> : null}
            <span
              className={cn(
                "rounded px-1 py-0.5",
                i === activeIdx && "bg-violet-200 font-bold text-violet-950 ring-1 ring-violet-400",
                i < activeIdx && "text-emerald-800",
                i > activeIdx && "text-slate-400",
              )}
            >
              {label}
            </span>
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-center gap-1">
        {WO_PROCUREMENT_WORKFLOW_STAGES.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 ? (
              <span className="text-[10px] font-medium text-slate-300" aria-hidden>
                →
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                i === activeIdx && "border-violet-400 bg-violet-100 text-violet-950 shadow-sm",
                i < activeIdx && "border-emerald-200 bg-emerald-50/80 text-emerald-900",
                i > activeIdx && "border-slate-100 bg-slate-50 text-slate-400",
              )}
            >
              {label}
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
