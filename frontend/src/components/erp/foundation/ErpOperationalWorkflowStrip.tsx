import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../../lib/utils";

export type ErpWorkflowStripStage = { key: string; label: string };

export type ErpWorkflowStageState = "done" | "active" | "upcoming";

function resolveStageState(
  index: number,
  currentIndex: number,
  options?: { allComplete?: boolean },
): ErpWorkflowStageState {
  if (options?.allComplete) return "done";
  if (index < currentIndex) return "done";
  if (index === currentIndex) return "active";
  return "upcoming";
}

export type ErpOperationalWorkflowStripProps = {
  stages: ErpWorkflowStripStage[];
  /** Index of the current operational stage. */
  currentIndex: number;
  /** When true, every stage reads as completed (e.g. closed NO_QTY cycle). */
  allComplete?: boolean;
  layout?: "horizontal" | "vertical";
  /** Optional leading label (e.g. "Flow") — kept compact. */
  leadingLabel?: string;
  className?: string;
  ariaLabel?: string;
  dense?: boolean;
};

/**
 * Unified operational workflow strip — Production → QC → Dispatch → Sales Bill,
 * NO_QTY cycle steps, and similar stage progressions share one visual language.
 */
export function ErpOperationalWorkflowStrip({
  stages,
  currentIndex,
  allComplete = false,
  layout = "horizontal",
  leadingLabel,
  className,
  ariaLabel = "Workflow progress",
  dense = false,
}: ErpOperationalWorkflowStripProps) {
  const cur = Math.max(0, Math.min(currentIndex, Math.max(0, stages.length - 1)));

  if (layout === "vertical") {
    return (
      <nav aria-label={ariaLabel} className={cn("erp-workflow-strip erp-workflow-strip--vertical", className)}>
        {leadingLabel ? <div className="erp-workflow-strip__leading">{leadingLabel}</div> : null}
        <ol className="erp-workflow-strip__list-vertical">
          {stages.map((s, idx) => {
            const state = resolveStageState(idx, cur, { allComplete });
            return (
              <li key={s.key}>
                <span className={cn("erp-workflow-strip__stage", `erp-workflow-strip__stage--${state}`)}>
                  <span className="erp-workflow-strip__bullet" aria-hidden>
                    {state === "done" ? "✓" : idx + 1}
                  </span>
                  <span className="erp-workflow-strip__label">{s.label}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("erp-workflow-strip erp-workflow-strip--horizontal", dense && "erp-workflow-strip--dense", className)}
    >
      {leadingLabel ? <span className="erp-workflow-strip__leading">{leadingLabel}</span> : null}
      <div className="erp-workflow-strip__track">
        {stages.map((s, idx) => {
          const state = resolveStageState(idx, cur, { allComplete });
          return (
            <React.Fragment key={s.key}>
              {idx > 0 ? <ChevronRight className="erp-workflow-strip__sep" aria-hidden /> : null}
              <span className={cn("erp-workflow-strip__stage", `erp-workflow-strip__stage--${state}`)}>
                <span className="erp-workflow-strip__label">{s.label}</span>
                {state === "done" ? (
                  <span className="ml-0.5 font-semibold text-emerald-700/95" aria-hidden>
                    ✓
                  </span>
                ) : null}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
}
