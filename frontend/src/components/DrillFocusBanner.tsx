import { Focus } from "lucide-react";
import { DRILL_FOCUS_CLEAR_LABEL } from "../lib/drillFocusCopy";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export type DrillFocusRecoveryAction = {
  label: string;
  onClick: () => void;
};

export type DrillFocusBannerProps = {
  /** When false, nothing is rendered */
  active: boolean;
  /** Primary line (plain language, e.g. “Focused from drill-down: Work order #45”) */
  title: string;
  /** Optional secondary line (e.g. not visible / filtered hints) */
  hint?: string;
  /** Softer styling for informational / not-found cases */
  variant?: "default" | "soft";
  /**
   * Shown when the drill target exists in loaded data but is hidden by filters/search.
   * Typical label: “Show …” / “Clear conflicting filters”.
   */
  recoveryAction?: DrillFocusRecoveryAction;
  onClearFocus: () => void;
  clearLabel?: string;
};

/**
 * Compact in-page cue that the user arrived with a drill / deep-link query param.
 * Place above the main list or primary card for the entity.
 */
export function DrillFocusBanner({
  active,
  title,
  hint,
  variant = "default",
  recoveryAction,
  onClearFocus,
  clearLabel = DRILL_FOCUS_CLEAR_LABEL,
}: DrillFocusBannerProps) {
  if (!active) return null;

  const btnBase =
    "h-9 min-h-9 w-full min-w-0 sm:h-8 sm:min-h-0 sm:w-auto sm:min-w-[7.5rem]";

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-md border px-3 py-2.5 text-sm shadow-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        variant === "soft"
          ? "border-amber-200/90 bg-amber-50/95 text-amber-950"
          : "border-sky-200/85 bg-sky-50/90 text-sky-950",
      )}
    >
      <div className="flex min-w-0 flex-1 gap-2.5">
        <Focus className="mt-0.5 h-4 w-4 shrink-0 text-current opacity-75" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-medium leading-snug text-[0.9375rem]">{title}</p>
          {hint ? <p className="text-xs leading-relaxed opacity-90">{hint}</p> : null}
        </div>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:pt-0.5">
        {recoveryAction ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={cn(
              btnBase,
              variant === "soft" && "border-amber-300/70 bg-white/95 text-amber-950 hover:bg-white",
            )}
            onClick={recoveryAction.onClick}
          >
            {recoveryAction.label}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            btnBase,
            "border-slate-300 bg-white/90 text-slate-800 hover:bg-white",
            variant === "soft" && "border-amber-300/80 bg-white/90",
          )}
          onClick={onClearFocus}
        >
          {clearLabel}
        </Button>
      </div>
    </div>
  );
}
