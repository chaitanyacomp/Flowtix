import * as React from "react";
import { cn } from "../../lib/utils";

export type OperationalCollapsibleSectionProps = {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  summaryClassName?: string;
  bodyClassName?: string;
  testId?: string;
};

/** Secondary metadata / traceability — collapsed by default to keep workflow above the fold. */
export function OperationalCollapsibleSection({
  title,
  children,
  defaultOpen = false,
  className,
  summaryClassName,
  bodyClassName,
  testId,
}: OperationalCollapsibleSectionProps) {
  return (
    <details
      className={cn("erp-advanced-section rounded-md border border-slate-200 bg-white shadow-sm", className)}
      open={defaultOpen || undefined}
      data-testid={testId}
    >
      <summary
        className={cn(
          "cursor-pointer select-none list-none px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 [&::-webkit-details-marker]:hidden",
          summaryClassName,
        )}
      >
        <span className="text-slate-400" aria-hidden>
          ▸{" "}
        </span>
        {title}
      </summary>
      <div className={cn("border-t border-slate-100 px-2.5 py-2", bodyClassName)}>{children}</div>
    </details>
  );
}
