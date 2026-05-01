import { useNavigate } from "react-router-dom";
import { useDemoMode } from "../../contexts/DemoModeContext";
import {
  DEMO_STEP_CLICK_HINTS,
  DEMO_STEP_HINTS,
  DEMO_STEP_LABELS,
  getDemoStepCount,
} from "../../lib/demoFlowConfig";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

/** Guided overlay: step title, hints, manual Next, completion state. */
export function DemoGuide() {
  const demo = useDemoMode();
  const navigate = useNavigate();

  if (!demo.enabled || !demo.flow) return null;

  const flow = demo.flow;
  const step = demo.step;
  const stepCount = getDemoStepCount(flow);

  if (step > stepCount) {
    return (
      <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-base font-semibold text-emerald-950">Demo completed</div>
            <p className="mt-1 text-sm text-emerald-900/90">
              You’ve finished the guided tour. Explore freely or return to the dashboard.
            </p>
          </div>
          <Button
            type="button"
            className="h-9 shrink-0 px-4 text-sm"
            onClick={() => {
              demo.setDemoEnabled(false);
              navigate("/dashboard");
            }}
          >
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const labels = DEMO_STEP_LABELS[flow];
  const hints = DEMO_STEP_HINTS[flow];
  const clickHints = DEMO_STEP_CLICK_HINTS[flow];
  const idx = Math.min(step, stepCount) - 1;
  const title = labels[idx] ?? "—";
  const hint = hints[idx] ?? "";
  const clickHint = clickHints[idx] ?? "";
  const flowIntro =
    flow === "regular"
      ? "This is a customer commitment order."
      : "This is a planning order without fixed quantity commitment.";

  function fireDemoNext() {
    window.dispatchEvent(new CustomEvent("demo:next"));
  }

  return (
    <div className="border-b border-sky-200 bg-gradient-to-r from-sky-50/95 to-white px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-900/80">Demo guide</div>
            <div className="mt-1 text-base font-semibold text-slate-900">
              Step {step} of {stepCount}: {title}
            </div>
            <p className="mt-0.5 text-sm text-slate-700">{hint}</p>
            <p className="mt-1 text-xs font-semibold text-slate-700">{flowIntro}</p>
            <p className="mt-1 text-xs font-medium text-blue-800">{clickHint}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" variant="default" size="sm" className="h-8 px-3 text-xs" onClick={fireDemoNext}>
              Next step
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => demo.setDemoEnabled(false)}
            >
              Exit demo
            </Button>
          </div>
        </div>
        <ol className="flex min-w-0 flex-wrap items-center gap-1.5">
          {hints.map((label, i) => {
            const n = i + 1;
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
