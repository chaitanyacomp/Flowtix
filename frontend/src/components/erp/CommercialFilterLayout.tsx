import * as React from "react";
import { cn } from "../../lib/utils";

/** Dense commercial list filter card — less shadow, tight border (spread onto Card). */
export const commercialFilterCardClass = "border-slate-200 shadow-none ring-1 ring-slate-900/[0.06]";

/**
 * Compact-density refinement: tightened grid + label gaps so commercial filter
 * cards (Sales Bills, Purchase Bills, etc.) read like a SAP/ERPNext toolbar
 * rather than a form. Locked to the unified ERP report filter rhythm:
 * mobile → 1 col, tablet → 2 cols, desktop → 4 cols. Additional fields wrap to
 * the next aligned row so widths never overflow the toolbar edge.
 */
export function CommercialFilterGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-1 gap-x-2.5 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4 sm:items-end",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Label + control; keeps compact vertical rhythm for spreadsheet-style filters. */
export function CommercialFilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-[10.5px] font-medium uppercase tracking-wide leading-tight text-slate-500">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Apply / actions row spanning full filter grid width; aligns button to control baseline. */
export function CommercialFilterActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 pt-0.5 sm:col-span-2 lg:col-span-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
