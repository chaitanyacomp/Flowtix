import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { Check } from "lucide-react";

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
  className?: string;
}) {
  const cur = stageIndex(currentStage);
  const closed = cycleStatus === "Closed Cycle";
  const list = (metrics ?? []).filter((m) => Number.isFinite(m.value));

  return (
    <Card className={cn("border-slate-200", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">No Qty cycle</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Sales Order No</span>
              <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-sky-900">
                {displaySalesOrderNo(soId, soDocNo ?? null)}
              </span>
              <span className="text-slate-400">·</span>
              <Badge variant={closed ? "info" : "success"}>
                Cycle {cycleNo ?? "—"} ({closed ? "Closed" : "Active"})
              </Badge>
            </div>
            <div className="mt-1 text-sm text-slate-700">
              <span className="font-medium text-slate-900">{customerName || "—"}</span>
            </div>
          </div>

          <div className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Next Step</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-900">{nextStep}</div>
            {nextStepHelp ? <div className="mt-0.5 text-xs text-slate-600">{nextStepHelp}</div> : null}
          </div>
        </div>

        {showSteps ? (
          <div className="mt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Steps</div>
            <ol className="mt-2 space-y-1">
              {STAGES.map((s, idx) => {
                const done = closed ? idx <= STAGES.length - 1 : idx < cur;
                const active = idx === cur;
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
          <div className="mt-3">
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

