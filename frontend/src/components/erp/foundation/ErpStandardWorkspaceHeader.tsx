import * as React from "react";
import { cn } from "../../../lib/utils";
import { erpTypography } from "../../../lib/erpFoundationTokens";

export type ErpStandardWorkspaceHeaderProps = {
  /** e.g. `<PageSmartBackLink />` or `<PageBackLink />` */
  back?: React.ReactNode;
  title: string;
  /** Optional descriptive subtitle (quieter than `workflow`). */
  subtitle?: React.ReactNode;
  /** Single line workflow / module context (not a full banner). */
  workflow?: React.ReactNode;
  /** Optional role chip or environment hint — keep short. */
  roleContext?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

/**
 * Standard operational page header row (non-sticky). Pair with
 * `StickyWorkspaceHead` when the page needs a sticky band; this composes the
 * inner title row only.
 */
export function ErpStandardWorkspaceHeader({
  back,
  title,
  subtitle,
  workflow,
  roleContext,
  actions,
  className,
}: ErpStandardWorkspaceHeaderProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {back ? <div className="min-w-0">{back}</div> : null}
      <div className="erp-page-title-row flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className={erpTypography.pageTitle}>{title}</h2>
          {subtitle ? <div className="erp-type-helper text-slate-500">{subtitle}</div> : null}
          {workflow ? <div className="erp-type-helper text-slate-600">{workflow}</div> : null}
        </div>
        {(roleContext || actions) ? (
          <div className="erp-page-header-actions self-start pt-0.5">
            {roleContext}
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
