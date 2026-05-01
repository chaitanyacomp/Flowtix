import { useDemoMode } from "../../contexts/DemoModeContext";
import { DEMO_STEP_HINTS, getDemoStepCount } from "../../lib/demoFlowConfig";
import { cn } from "../../lib/utils";

/** Guided step strip: current step blue, completed green, upcoming muted. */
export function DemoStepHintBar() {
  const demo = useDemoMode();
  if (!demo.enabled || !demo.flow) return null;

  const flow = demo.flow;
  const step = demo.step;
  const hints = DEMO_STEP_HINTS[flow];
  const stepCount = getDemoStepCount(flow);

  return (
    <div className="border-b border-sky-200 bg-gradient-to-r from-sky-50/95 to-white px-4 py-2.5">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 shrink-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-900/80">Demo guide</div>
          <p className="mt-0.5 text-[13px] font-medium leading-snug text-slate-900">
            {step > stepCount ? (
              <span className="text-emerald-800">All demo steps completed — explore freely.</span>
            ) : (
              <>
                <span className="tabular-nums text-sky-800">Step {Math.min(step, stepCount)} of {stepCount}:</span>{" "}
                <span>{hints[Math.min(step, stepCount) - 1] ?? "—"}</span>
              </>
            )}
          </p>
        </div>
        <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:justify-end">
          {hints.map((label, idx) => {
            const n = idx + 1;
            const done = step > n || step > stepCount;
            const current = step === n && step <= stepCount;
            return (
              <li key={n}>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                    done && "border-emerald-200 bg-emerald-50 text-emerald-900",
                    current && "border-sky-400 bg-sky-100 text-sky-950 shadow-sm",
                    !done && !current && "border-slate-200 bg-white/80 text-slate-500",
                  )}
                  title={label}
                >
                  {n}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
