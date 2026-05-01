import * as React from "react";
import { AlertCircle, CheckCircle2, Info, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export type NextStepStripProps = {
  variant: "action" | "info" | "success" | "blocked";
  title: string;
  subtitle?: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    testId?: string;
    /** `data-demo-highlight` value for guided demo (see `DemoHighlightController`). */
    demoHighlightKey?: string;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    testId?: string;
  };
  visible?: boolean;
  className?: string;
};

const variantShell: Record<NextStepStripProps["variant"], string> = {
  action: "border-amber-300 bg-amber-50/95 text-amber-950",
  info: "border-blue-200 bg-blue-50/95 text-blue-950",
  success: "border-emerald-200 bg-emerald-50/95 text-emerald-950",
  blocked: "border-red-200 bg-red-50/95 text-red-950",
};

const variantIcon: Record<NextStepStripProps["variant"], React.ReactNode> = {
  action: <Sparkles className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />,
  info: <Info className="h-4 w-4 shrink-0 text-blue-700" aria-hidden />,
  success: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden />,
  blocked: <AlertCircle className="h-4 w-4 shrink-0 text-red-700" aria-hidden />,
};

export function NextStepStrip({
  variant,
  title,
  subtitle,
  primaryAction,
  secondaryAction,
  visible = true,
  className,
}: NextStepStripProps) {
  if (visible === false) return null;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
        variantShell[variant],
        className,
      )}
      role="region"
      aria-label="Next step"
    >
      <div className="flex min-w-0 gap-2">
        <span className="mt-0.5 shrink-0">{variantIcon[variant]}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 whitespace-pre-line text-xs font-normal leading-snug text-slate-600">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {secondaryAction ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 border-slate-300 bg-white/80 text-[12px]"
              disabled={secondaryAction.disabled}
              onClick={secondaryAction.onClick}
              data-testid={secondaryAction.testId}
            >
              {secondaryAction.label}
            </Button>
          ) : null}
          {primaryAction ? (
            <Button
              type="button"
              size="sm"
              className={cn(
                "h-8 text-[12px] font-semibold",
                variant === "action" && "bg-amber-600 text-white hover:bg-amber-700",
                variant === "info" && "bg-blue-600 text-white hover:bg-blue-700",
                variant === "success" && "bg-emerald-600 text-white hover:bg-emerald-700",
                variant === "blocked" && "bg-red-600 text-white hover:bg-red-700",
              )}
              disabled={primaryAction.disabled}
              onClick={primaryAction.onClick}
              data-testid={primaryAction.testId}
              {...(primaryAction.demoHighlightKey
                ? { "data-demo-highlight": primaryAction.demoHighlightKey }
                : {})}
            >
              {primaryAction.label}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
