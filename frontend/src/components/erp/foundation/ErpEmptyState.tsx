import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "../../../lib/utils";

export type ErpEmptyStateProps = {
  title: string;
  body?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  /** `inline` for table/list placeholders; `panel` for section-level empties. */
  variant?: "inline" | "panel";
  className?: string;
};

/**
 * Compact operational empty state — centered, subtle icon, no marketing illustration.
 */
export function ErpEmptyState({
  title,
  body,
  icon,
  action,
  variant = "panel",
  className,
}: ErpEmptyStateProps) {
  const isInline = variant === "inline";
  return (
    <div
      role="status"
      className={cn(
        "erp-empty-state",
        isInline ? "erp-empty-state--inline" : "erp-empty-state--panel",
        className,
      )}
    >
      <span className="erp-empty-state__icon" aria-hidden>
        {icon ?? <Inbox className="h-4 w-4" strokeWidth={2} />}
      </span>
      <div className="erp-empty-state__text">
        <div className="erp-empty-state__title">{title}</div>
        {body ? <div className="erp-empty-state__body">{body}</div> : null}
      </div>
      {action ? <div className="erp-empty-state__action">{action}</div> : null}
    </div>
  );
}
