import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../../lib/utils";
import { ErpActionButton } from "../foundation/ErpActionButton";
import { buttonVariants } from "../../ui/button";

export type WorkbenchActionSpec = {
  key: string;
  label: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  title?: string;
  href?: string;
  tier?: "primary" | "secondary" | "tertiary" | "danger";
};

export type WorkbenchActionBarProps = {
  /** Exactly one primary action per FT-PD-066 §15 */
  primary?: WorkbenchActionSpec | null;
  secondary?: WorkbenchActionSpec[];
  tertiary?: WorkbenchActionSpec[];
  /** Right-aligned cancel / back */
  cancel?: WorkbenchActionSpec | null;
  /** Inline hint next to primary (validation message) */
  hint?: React.ReactNode;
  className?: string;
};

const tierVariant = {
  primary: "default" as const,
  secondary: "secondary" as const,
  tertiary: "outline" as const,
  danger: "destructive" as const,
};

function renderAction(action: WorkbenchActionSpec) {
  const tier = action.tier ?? "secondary";
  if (action.href) {
    const label = action.loading ? "…" : action.label;
    if (action.href.startsWith("/")) {
      return (
        <Link
          key={action.key}
          to={action.href}
          title={action.title}
          className={cn(buttonVariants({ variant: tierVariant[tier], size: "sm" }), "erp-type-action-button")}
          aria-disabled={action.disabled || action.loading ? true : undefined}
          onClick={(e) => {
            if (action.disabled || action.loading) e.preventDefault();
            action.onClick?.();
          }}
        >
          {label}
        </Link>
      );
    }
    return (
      <a
        key={action.key}
        href={action.href}
        title={action.title}
        className={cn(buttonVariants({ variant: tierVariant[tier], size: "sm" }), "erp-type-action-button")}
        aria-disabled={action.disabled || action.loading ? true : undefined}
      >
        {label}
      </a>
    );
  }
  return (
    <ErpActionButton
      key={action.key}
      tier={tier}
      disabled={action.disabled || action.loading}
      title={action.title}
      onClick={action.onClick}
    >
      {action.loading ? "…" : action.label}
    </ErpActionButton>
  );
}

/** Compact inline action cluster (e.g. Items section header) — same specs as the sticky bar. */
export function WorkbenchActionCluster({
  primary,
  secondary = [],
  hint,
  className,
}: Pick<WorkbenchActionBarProps, "primary" | "secondary" | "hint" | "className">) {
  const hasActions = primary || secondary.length > 0;
  if (!hasActions && !hint) return null;

  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-center justify-end gap-1.5", className)}
      data-testid="workbench-inline-actions"
    >
      {primary ? renderAction({ ...primary, tier: "primary" }) : null}
      {secondary.map((a) => renderAction({ ...a, tier: a.tier ?? "secondary" }))}
      {hint ? <span className="text-[11px] font-medium text-amber-800">{hint}</span> : null}
    </div>
  );
}

/**
 * FT-PD-067 — Sticky bottom action bar (primary left, cancel right).
 */
export function WorkbenchActionBar({
  primary,
  secondary = [],
  tertiary = [],
  cancel,
  hint,
  className,
}: WorkbenchActionBarProps) {
  const hasActions = primary || secondary.length > 0 || tertiary.length > 0 || cancel;
  if (!hasActions && !hint) return null;

  return (
    <footer
      className={cn("erp-workbench-action-bar sticky bottom-0 z-[25] shrink-0 print:hidden", className)}
      data-testid="workbench-action-bar"
      aria-label="Workbench actions"
    >
      <div className="erp-workbench-action-bar-inner">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {primary ? renderAction({ ...primary, tier: "primary" }) : null}
          {secondary.map((a) => renderAction({ ...a, tier: a.tier ?? "secondary" }))}
          {tertiary.map((a) => renderAction({ ...a, tier: a.tier ?? "tertiary" }))}
          {hint ? <span className="text-xs font-medium text-amber-800">{hint}</span> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {cancel ? renderAction({ ...cancel, tier: cancel.tier ?? "tertiary" }) : null}
        </div>
      </div>
    </footer>
  );
}
