import { cn } from "../../../lib/utils";
import { ErpPageSkeleton, type ErpPageSkeletonVariant } from "./ErpPageSkeleton";

export type ErpPageLoaderProps = {
  variant?: ErpPageSkeletonVariant;
  hint?: string;
  className?: string;
  lines?: number;
  "data-testid"?: string;
};

/**
 * Content-area loader — keeps AppLayout shell visible; fills `.erp-main` workspace.
 */
export function ErpPageLoader({
  variant = "panel",
  hint = "Loading…",
  className,
  lines,
  "data-testid": dataTestId,
}: ErpPageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("erp-page-loader space-y-2", className)}
      data-testid={dataTestId ?? "erp-page-loader"}
    >
      {hint ? <p className="text-[12px] font-medium text-slate-500">{hint}</p> : null}
      <ErpPageSkeleton variant={variant} lines={lines} />
    </div>
  );
}
