import * as React from "react";
import { cn } from "../../../lib/utils";

export type WorkbenchHeaderProps = {
  /** Page title row (title + back nav) */
  titleRow?: React.ReactNode;
  /** Compact contextual row: SO, customer, cycle, document status */
  contextRow?: React.ReactNode;
  /** Optional workflow badges / cycle bar */
  workflowRow?: React.ReactNode;
  /** Version selector + status badges (toolbar within header) */
  toolbarRow?: React.ReactNode;
  className?: string;
};

/**
 * FT-PD-067 — Fixed compact header band (FT-PD-066 §9.3).
 */
export function WorkbenchHeader({
  titleRow,
  contextRow,
  workflowRow,
  toolbarRow,
  className,
}: WorkbenchHeaderProps) {
  const hasContent = titleRow || contextRow || workflowRow || toolbarRow;
  if (!hasContent) return null;

  return (
    <header
      className={cn("erp-workbench-header sticky top-0 z-[26] shrink-0", className)}
      data-testid="workbench-header"
    >
      {titleRow ? <div className="erp-workbench-header-title">{titleRow}</div> : null}
      {contextRow ? <div className="erp-workbench-header-context">{contextRow}</div> : null}
      {workflowRow ? <div className="erp-workbench-header-workflow">{workflowRow}</div> : null}
      {toolbarRow ? <div className="erp-workbench-header-toolbar">{toolbarRow}</div> : null}
    </header>
  );
}
