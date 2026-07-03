import * as React from "react";
import { cn } from "../../../lib/utils";

export type WorkbenchShellProps = {
  children: React.ReactNode;
  className?: string;
  /** Stable id for print/export scoping */
  "data-testid"?: string;
  /** Module label for accessibility (e.g. Requirement Sheet) */
  moduleLabel?: string;
};

/**
 * FT-PD-067 — Top-level Workbench layout: fixed header band, scrollable main, sticky action bar.
 * Technology-neutral shell used by operational modules (RS, Monthly Planning, RMCC, Production, Dispatch).
 */
export function WorkbenchShell({
  children,
  className,
  "data-testid": testId = "workbench-shell",
  moduleLabel,
}: WorkbenchShellProps) {
  return (
    <div
      className={cn("erp-workbench-shell flex min-h-0 flex-col", className)}
      data-testid={testId}
      aria-label={moduleLabel ? `${moduleLabel} workbench` : "Operational workbench"}
    >
      {children}
    </div>
  );
}

export type WorkbenchMainProps = {
  children: React.ReactNode;
  className?: string;
};

/** Scrollable main region between KPI strip and sticky action bar. */
export function WorkbenchMain({ children, className }: WorkbenchMainProps) {
  return (
    <div className={cn("erp-workbench-main min-h-0 flex-1 overflow-y-auto", className)} data-testid="workbench-main">
      {children}
    </div>
  );
}

export type WorkbenchAlertsProps = {
  children: React.ReactNode;
  className?: string;
};

/** Banners above header (demo, success, workflow). */
export function WorkbenchAlerts({ children, className }: WorkbenchAlertsProps) {
  if (!children) return null;
  return (
    <div className={cn("erp-workbench-alerts shrink-0 space-y-1", className)} data-testid="workbench-alerts">
      {children}
    </div>
  );
}
