import { cn } from "../../lib/utils";
import { ErpOperationalWorkflowStrip } from "./foundation/ErpOperationalWorkflowStrip";

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
  const closed = cycleStatus === "Closed Cycle";
  const stages = hideWorkOrderStep ? STAGES.filter((s) => s.key !== "WORK_ORDER") : STAGES;
  const curIdx = hideWorkOrderStep
    ? Math.max(0, stages.findIndex((s) => s.key === currentStage))
    : stageIndex(currentStage);

  return (
    <ErpOperationalWorkflowStrip
      stages={stages}
      currentIndex={curIdx}
      allComplete={closed}
      layout="vertical"
      leadingLabel="Steps"
      ariaLabel={ariaLabel}
      className={cn(className)}
    />
  );
}
