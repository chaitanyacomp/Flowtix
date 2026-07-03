import { cn } from "../../../lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-slate-200/80", className)} aria-hidden />;
}

function Block({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-100/90", className)} aria-hidden />;
}

export type NoQtyCycleManagementSkeletonProps = {
  /** Focused single-agreement workspace — taller placeholder */
  focused?: boolean;
  /** Number of workspace placeholders in list mode */
  rowCount?: number;
  className?: string;
};

/**
 * Reserved-height skeleton for Cycle Management — prevents layout shift on first load.
 */
export function NoQtyCycleManagementSkeleton({
  focused = false,
  rowCount = 1,
  className,
}: NoQtyCycleManagementSkeletonProps) {
  const placeholders = focused ? 1 : Math.max(1, Math.min(rowCount, 2));

  return (
    <div
      className={cn("space-y-2", className)}
      data-testid="cycle-management-skeleton"
      aria-busy="true"
      aria-label="Loading cycle management"
    >
      {Array.from({ length: placeholders }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "rounded-md border border-slate-200/90 bg-white p-2.5",
            focused ? "min-h-[17.5rem]" : "min-h-[10.5rem]",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1.5">
              <Bar className="h-4 w-28" />
              <Bar className="h-3 w-36" />
            </div>
            <Bar className="h-8 w-40 shrink-0 rounded-md" />
          </div>

          <Block className="mt-2 h-[4.75rem] border border-violet-100/80 bg-violet-50/40" />

          <div className="mt-2 space-y-1.5">
            <Bar className="h-3 w-full max-w-md" />
            {focused ? <Bar className="h-3 w-2/3 max-w-sm" /> : null}
          </div>

          {focused ? (
            <>
              <Block className="mt-2 h-8 border border-slate-200/70" />
              <Block className="mt-2 h-14 border border-slate-200/70" />
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
