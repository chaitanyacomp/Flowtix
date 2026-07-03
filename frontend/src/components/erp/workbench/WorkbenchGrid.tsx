import * as React from "react";
import { cn } from "../../../lib/utils";
import { erpTable } from "../../../lib/erpFoundationTokens";

export type WorkbenchGridProps = {
  children: React.ReactNode;
  className?: string;
  id?: string;
  /** Accessible label for the grid region */
  "aria-label"?: string;
  stickyHeader?: boolean;
  compact?: boolean;
};

/**
 * FT-PD-067 — High-density grid wrapper with sticky header and horizontal scroll.
 */
export function WorkbenchGrid({
  children,
  className,
  id,
  "aria-label": ariaLabel = "Workbench data grid",
  stickyHeader = true,
  compact = true,
}: WorkbenchGridProps) {
  return (
    <div
      id={id}
      className={cn(
        "erp-workbench-grid min-w-0",
        stickyHeader && "erp-workbench-grid--sticky-head",
        compact && "erp-workbench-grid--compact",
        className,
      )}
      data-testid="workbench-grid"
      role="region"
      aria-label={ariaLabel}
    >
      <div className={cn(erpTable.wrap, "erp-workbench-grid-scroll")}>{children}</div>
    </div>
  );
}

export type WorkbenchGridTableProps = React.TableHTMLAttributes<HTMLTableElement>;

export function WorkbenchGridTable({ className, children, ...rest }: WorkbenchGridTableProps) {
  return (
    <table className={cn(erpTable.standard, "erp-workbench-table w-full min-w-[720px]", className)} {...rest}>
      {children}
    </table>
  );
}
