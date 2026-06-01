import { Link } from "react-router-dom";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import type { WoPrepareGuidedStripModel } from "../../lib/woPrepareWorkflowGuidance";

const TONE_PANEL = {
  danger: "border-red-400 bg-red-50",
  warning: "border-amber-400 bg-amber-50",
  caution: "border-yellow-400 bg-yellow-50",
  success: "border-emerald-400 bg-emerald-50",
  neutral: "border-slate-300 bg-slate-50",
} as const;

const HEADLINE_ICON = {
  danger: "🔴",
  warning: "🟠",
  caution: "🟡",
  success: "🟢",
  neutral: "ℹ️",
} as const;

type Props = {
  model: WoPrepareGuidedStripModel;
};

export function WoPrepareGuidedStrip({ model }: Props) {
  return (
    <section className={cn("rounded-md border px-2.5 py-2 shadow-sm", TONE_PANEL[model.tone])}>
      <p className="text-[13px] font-bold text-slate-900">
        {HEADLINE_ICON[model.tone]} {model.headline}
      </p>
      <div className="mt-1 grid gap-0.5 text-[12px] sm:grid-cols-[auto_1fr] sm:gap-x-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Next owner</span>
        <span className="font-semibold text-slate-950">{model.owner} Department</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Next action</span>
        <span className="text-slate-800">{model.nextActionText}</span>
      </div>

      <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
        {model.primaryKind === "link" && model.primaryHref ? (
          <Link
            to={model.primaryHref}
            className={cn(
              buttonVariants({ size: "default" }),
              "h-8 min-w-[10rem] justify-center bg-slate-900 px-4 text-[12px] font-bold text-white shadow hover:bg-slate-800 no-underline",
            )}
            data-testid="wo-prepare-guided-primary"
          >
            {model.primaryLabel}
          </Link>
        ) : (
          <Button
            type="button"
            className={cn(
              "h-8 min-w-[10rem] px-4 text-[12px] font-bold shadow",
              model.tone === "success" && "bg-emerald-700 hover:bg-emerald-800",
              model.tone === "danger" && "bg-red-700 hover:bg-red-800",
              model.tone !== "success" && model.tone !== "danger" && "bg-slate-900 hover:bg-slate-800",
            )}
            onClick={model.onPrimaryClick}
            disabled={model.primaryDisabled}
            data-testid={
              model.state === "READY_FOR_WO"
                ? "next-create-wo-btn"
                : "wo-prepare-guided-primary"
            }
          >
            {model.primaryLoading ? "Working…" : model.primaryLabel}
          </Button>
        )}

        {model.secondaryLabel && model.secondaryHref ? (
          <Link
            to={model.secondaryHref}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-9 px-3 text-[12px] font-semibold text-slate-800 no-underline hover:bg-black/5",
            )}
            data-testid="wo-prepare-guided-secondary"
          >
            {model.secondaryLabel}
          </Link>
        ) : null}

        {model.tertiaryLabel && model.onTertiaryClick ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-[11px] font-medium text-slate-600"
            disabled={model.primaryLoading}
            onClick={model.onTertiaryClick}
            data-testid="wo-prepare-guided-refresh"
          >
            {model.tertiaryLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
