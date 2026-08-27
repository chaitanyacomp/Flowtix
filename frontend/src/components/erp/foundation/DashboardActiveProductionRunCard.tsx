import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../../lib/utils";
import { buttonVariants } from "../../ui/button";
import {
  formatActiveShiftRunningTime,
  type ActiveShiftRunGuidance,
  OPEN_ACTIVE_SHIFT_LABEL,
} from "../../../lib/activeShiftRunGuidance";
import { evaluateOpenShiftOverdue, SHIFT_OVERDUE_MESSAGE } from "../../../lib/shiftOverdueGuidance";

export function DashboardActiveProductionRunCard({
  runs,
  className,
}: {
  runs: ActiveShiftRunGuidance[];
  className?: string;
}) {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!runs.length) return null;

  return (
    <section
      aria-label="Active Production Run"
      data-testid="dashboard-active-production-run"
      className={cn(
        "overflow-hidden rounded-lg border border-emerald-300/80 bg-gradient-to-br from-emerald-50/95 via-white to-teal-50/60 shadow-sm",
        className,
      )}
    >
      {runs.map((run) => {
        const primaryHref = run.workspaceHref || `/production?workOrderId=${run.workOrderId}&pwSection=active`;
        const secondaryHref = run.shiftSessionHref || `/shift-production/sessions/${run.shiftSessionId}`;
        const running =
          run.runningTimeLabel ||
          formatActiveShiftRunningTime(run.segmentStartedAt, nowMs);
        const liveOverdue = evaluateOpenShiftOverdue(
          {
            status: "OPEN",
            sessionDate: run.sessionDate,
            startTime: run.shiftStartTime,
            endTime: run.shiftEndTime,
          },
          nowMs,
        );
        const shiftOverdue = Boolean(run.shiftOverdue) || liveOverdue.overdue;
        return (
          <div
            key={`${run.shiftSessionId}-${run.runSegmentId}`}
            className="border-b border-emerald-100/80 px-3 py-2.5 last:border-b-0"
            data-testid="active-production-run-card"
          >
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-[14px] font-bold tracking-tight text-emerald-950">Active Production Run</h2>
                <p className="mt-0.5 text-[11px] text-emerald-900/70">
                  {run.shiftSessionNo ? `${run.shiftSessionNo} · ` : ""}
                  Segment {run.segmentNo ?? 1} active — do not start another run
                </p>
              </div>
              <span className="rounded-md bg-emerald-600/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Running {running}
              </span>
            </header>

            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Machine</dt>
                <dd className="font-semibold tabular-nums text-slate-900">
                  {run.machineCode || run.machineName || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Shift</dt>
                <dd className="font-semibold text-slate-900">{run.shiftName || run.shiftCode || "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">WO</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{run.workOrderNo || `WO-${run.workOrderId}`}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Operator</dt>
                <dd className="font-semibold text-slate-900">{run.operatorName || "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Running time</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{running}</dd>
              </div>
            </dl>

            {shiftOverdue ? (
              <p
                className="mt-2 text-[12px] font-medium text-amber-900"
                role="status"
                data-testid="active-run-overdue-banner"
              >
                {liveOverdue.message || run.shiftOverdueMessage || SHIFT_OVERDUE_MESSAGE}
              </p>
            ) : null}

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Link
                to={primaryHref}
                className={cn(buttonVariants({ size: "sm" }), "h-8 text-[12px] font-semibold")}
                data-testid="active-run-primary-cta"
              >
                {run.primaryActionLabel}
              </Link>
              <Link
                to={secondaryHref}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "h-8 border-emerald-300/80 bg-white/80 text-[12px] font-medium text-emerald-950",
                )}
                data-testid="active-run-open-shift-cta"
              >
                {run.secondaryActionLabel || OPEN_ACTIVE_SHIFT_LABEL}
              </Link>
            </div>
          </div>
        );
      })}
    </section>
  );
}
