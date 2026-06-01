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
  /** Tighter layout for transaction workspaces (~80–100px target height). */
  density?: "default" | "compact";
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
  density = "default",
  className,
}: NextStepStripProps) {
  if (visible === false) return null;

  const compact = density === "compact";

  return (
    <div
      className={cn(
        "flex min-w-0 max-h-[100px] flex-col overflow-hidden rounded-md border sm:flex-row sm:items-center sm:justify-between",
        compact ? "gap-1.5 px-2 py-1.5 sm:gap-2" : "gap-2 px-3 py-2 sm:gap-3",
        variantShell[variant],
        className,
      )}
      role="region"
      aria-label="Next step"
    >
      <div className={cn("flex min-w-0", compact ? "gap-1.5" : "gap-2")}>
        <span className={cn("shrink-0", compact ? "mt-0" : "mt-0.5")}>{variantIcon[variant]}</span>
        <div className="min-w-0">
          <p className={cn("font-semibold leading-snug", compact ? "text-[13px] line-clamp-1" : "text-sm")}>{title}</p>
          {subtitle ? (
            <p
              className={cn(
                "whitespace-pre-line font-normal leading-snug text-slate-600",
                compact ? "mt-0 line-clamp-1 text-[11px]" : "mt-0.5 text-xs",
              )}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
          {secondaryAction ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(
                "border-slate-300 bg-white/80",
                compact ? "h-7 px-2 text-[11px]" : "h-8 text-[12px]",
              )}
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
                compact ? "h-7 px-3 text-[11px] font-semibold" : "h-8 text-[12px] font-semibold",
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
