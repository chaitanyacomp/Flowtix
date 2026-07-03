import { RefreshCw } from "lucide-react";
import { cn } from "../../../lib/utils";

export type ErpRefreshingBadgeProps = {
  label?: string;
  className?: string;
};

export function ErpRefreshingBadge({ label = "Refreshing…", className }: ErpRefreshingBadgeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm",
        className,
      )}
      data-testid="erp-refreshing-badge"
    >
      <RefreshCw className="h-3 w-3 animate-spin text-slate-500" aria-hidden />
      {label}
    </div>
  );
}
