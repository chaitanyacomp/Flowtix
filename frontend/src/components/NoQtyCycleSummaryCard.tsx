import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ErpStatusChip } from "./erp/foundation/ErpStatusChip";
import { ErpOperationalWorkflowStrip } from "./erp/foundation/ErpOperationalWorkflowStrip";
import { cn } from "../lib/utils";
import { displaySalesOrderNo } from "../lib/docNoDisplay";

export type NoQtyStageKey = "REQUIREMENT" | "WORK_ORDER" | "PRODUCTION" | "QC" | "DISPATCH" | "SALES_BILL";

type Metric = {
  label:
    | "Planned Qty"
    | "QC Passed Qty"
    | "Dispatched Qty"
    | "QC Accepted Remaining"
    | "Usable Stock Available"
    | "Dispatchable Now";
  value: number;
  subtle?: boolean;
};

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : String(r);
}

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

export function NoQtyCycleSummaryCard({
  soId,
  soDocNo,
  customerName,
  cycleNo,
  cycleStatus,
  currentStage,
  nextStep,
  nextStepHelp,
  belowMetricsNote,
  metrics,
  showSteps = true,
  showNextStepCard = true,
  inlineStepStrip = false,
  hideWorkOrderStep = false,
  density = "default",
  className,
}: {
  soId: number;
  soDocNo?: string | null;
  customerName: string;
  cycleNo: number | null;
  cycleStatus: "Active Cycle" | "Closed Cycle";
  currentStage: NoQtyStageKey;
  nextStep: string;
  nextStepHelp?: string | null;
  belowMetricsNote?: string | null;
  metrics?: Metric[];
  showSteps?: boolean;
  showNextStepCard?: boolean;
  inlineStepStrip?: boolean;
  hideWorkOrderStep?: boolean;
  density?: "default" | "compact";
  className?: string;
}) {
  const cur = stageIndex(currentStage);
  const closed = cycleStatus === "Closed Cycle";
  const list = (metrics ?? []).filter((m) => Number.isFinite(m.value));
  const stagesForUi = hideWorkOrderStep ? STAGES.filter((s) => s.key !== "WORK_ORDER") : STAGES;
  const curIdxUi = hideWorkOrderStep ? Math.max(0, stagesForUi.findIndex((s) => s.key === currentStage)) : cur;

  return (
    <Card className={cn("border-slate-200", className)}>
      <CardHeader className={cn(density === "compact" ? "px-3 pb-1 pt-2" : "pb-2")}>
        <CardTitle className={cn("font-semibold text-slate-900", density === "compact" ? "text-sm" : "text-base")}>
          No Qty cycle
        </CardTitle>
      </CardHeader>
      <CardContent className={cn(density === "compact" ? "px-3 pb-2 pt-0" : "pt-0")}>
        <div className={cn("flex flex-col sm:flex-row sm:items-start sm:justify-between", density === "compact" ? "gap-2" : "gap-3")}>
          <div className="min-w-0">
            <div className="erp-context-inline">
              <span className="font-semibold text-slate-600">SO</span>
              <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-sky-900">
                {displaySalesOrderNo(soId, soDocNo ?? null)}
              </span>
              <span className="text-slate-300">|</span>
              <span className="truncate font-medium text-slate-800">{customerName || "—"}</span>
              <span className="text-slate-300">|</span>
              <ErpStatusChip tone={closed ? "info" : "success"} density="compact">
                Cycle {cycleNo ?? "—"} · {closed ? "Closed" : "Active"}
              </ErpStatusChip>
            </div>
          </div>

          {showNextStepCard ? (
            <div
              className={cn(
                "shrink-0 rounded border border-slate-200 bg-slate-50",
                density === "compact" ? "px-2 py-1" : "px-2.5 py-1.5",
              )}
            >
              <div className="erp-type-workflow-label text-slate-500">Next</div>
              <div className={cn(density === "compact" ? "text-[12px]" : "text-[13px]", "font-semibold leading-tight text-slate-900")}>
                {nextStep}
              </div>
              {nextStepHelp ? <div className="mt-0.5 text-[11px] leading-snug text-slate-600">{nextStepHelp}</div> : null}
            </div>
          ) : null}
        </div>

        {inlineStepStrip ? (
          <ErpOperationalWorkflowStrip
            className="mt-2 border-t border-slate-100 pt-2"
            stages={stagesForUi}
            currentIndex={curIdxUi}
            allComplete={closed}
            layout="horizontal"
            leadingLabel="Flow"
            dense
            ariaLabel="No Qty workflow steps"
          />
        ) : null}

        {showSteps ? (
          <ErpOperationalWorkflowStrip
            className="mt-3"
            stages={stagesForUi}
            currentIndex={curIdxUi}
            allComplete={closed}
            layout="vertical"
            leadingLabel="Steps"
            ariaLabel="No Qty workflow steps"
          />
        ) : null}

        {list.length ? (
          <div className={cn(density === "compact" ? "mt-2" : "mt-3")}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {list.map((m) => (
                <div
                  key={m.label}
                  className={cn(
                    "rounded-md border border-slate-200 bg-white px-3 py-2",
                    m.subtle && "bg-slate-50",
                  )}
                >
                  <div className="erp-type-helper font-medium text-slate-500">{m.label}</div>
                  <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", m.subtle ? "text-slate-700" : "text-slate-900")}>
                    {fmtQty(m.value)}
                  </div>
                </div>
              ))}
            </div>
            {belowMetricsNote ? <div className="mt-2 text-xs text-slate-600">{belowMetricsNote}</div> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
