import * as React from "react";
import { Check, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
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
  /** Compact horizontal flow (replaces separate sidebar step card). */
  inlineStepStrip?: boolean;
  /** Hide WO step in strip/list when WO is not an operator milestone. */
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
              <Badge variant={closed ? "info" : "success"} className="text-[11px]">
                Cycle {cycleNo ?? "—"} · {closed ? "Closed" : "Active"}
              </Badge>
            </div>
          </div>

          {showNextStepCard ? (
            <div
              className={cn(
                "shrink-0 rounded border border-slate-200 bg-slate-50",
                density === "compact" ? "px-2 py-1" : "px-2.5 py-1.5",
              )}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Next</div>
              <div className={cn(density === "compact" ? "text-[12px]" : "text-[13px]", "font-semibold leading-tight text-slate-900")}>
                {nextStep}
              </div>
              {nextStepHelp ? <div className="mt-0.5 text-[11px] leading-snug text-slate-600">{nextStepHelp}</div> : null}
            </div>
          ) : null}
        </div>

        {inlineStepStrip ? (
          <div
            className="mt-2 flex flex-wrap items-center gap-y-1 border-t border-slate-100 pt-2"
            aria-label="No Qty workflow steps"
          >
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Flow</span>
            {stagesForUi.map((s, idx) => {
              const done = closed ? true : idx < curIdxUi;
              const active = !closed && idx === curIdxUi;
              return (
                <React.Fragment key={s.key}>
                  {idx > 0 ? <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-slate-300" aria-hidden /> : null}
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                      active && "bg-sky-100 font-semibold text-sky-950 ring-1 ring-sky-200/80",
                      done && !active && "bg-emerald-50/80 text-emerald-900",
                      !done && !active && "text-slate-500",
                    )}
                  >
                    {s.label}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        ) : null}

        {showSteps ? (
          <div className="mt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Steps</div>
            <ol className="mt-2 space-y-1">
              {stagesForUi.map((s, idx) => {
                const done = closed ? idx <= stagesForUi.length - 1 : idx < curIdxUi;
                const active = idx === curIdxUi;
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
          </div>
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
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{m.label}</div>
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
