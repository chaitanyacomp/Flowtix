import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export type StickyWorkflowAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  variant?: "default" | "outline" | "destructive";
};

type Props = {
  visible?: boolean;
  title?: string;
  subtitle?: string;
  primaryAction?: StickyWorkflowAction;
  secondaryAction?: StickyWorkflowAction;
  className?: string;
  /** Accessible name when title is omitted. */
  ariaLabel?: string;
};

/**
 * Sticky bottom workflow bar for transaction workspaces — keeps the primary
 * operator action visible while scrolling. Visual chrome matches existing ERP buttons.
 */
export function StickyWorkflowActionBar({
  visible = true,
  title,
  subtitle,
  primaryAction,
  secondaryAction,
  className,
  ariaLabel = "Workflow action",
}: Props) {
  if (!visible || (!primaryAction && !secondaryAction)) return null;

  return (
    <div
      className={cn("erp-sticky-workflow-bar", className)}
      role="toolbar"
      aria-label={title ?? ariaLabel}
    >
      {(title || subtitle) && (
        <div className="min-w-0 flex-1">
          {title ? <p className="text-[12px] font-semibold leading-snug text-slate-900">{title}</p> : null}
          {subtitle ? <p className="text-[11px] leading-snug text-slate-600">{subtitle}</p> : null}
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {secondaryAction ? (
          <Button
            type="button"
            size="sm"
            variant={secondaryAction.variant ?? "outline"}
            className="h-8 text-[12px]"
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
            variant={primaryAction.variant ?? "default"}
            className="h-8 text-[12px] font-semibold"
            disabled={primaryAction.disabled}
            onClick={primaryAction.onClick}
            data-testid={primaryAction.testId}
          >
            {primaryAction.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
