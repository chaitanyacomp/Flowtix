import { cn } from "../../../lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-slate-200/80", className)} aria-hidden />;
}

export type PendingActionBucketSkeletonProps = {
  count?: number;
  className?: string;
};

/** Reserved-height placeholder matching pending action work bucket cards. */
export function PendingActionBucketSkeleton({ count = 3, className }: PendingActionBucketSkeletonProps) {
  const placeholders = Math.max(1, Math.min(count, 4));

  return (
    <div
      className={cn("space-y-3", className)}
      data-testid="pending-action-bucket-skeleton"
      aria-busy="true"
      aria-label="Loading pending action buckets"
    >
      {Array.from({ length: placeholders }).map((_, index) => (
        <div
          key={index}
          className="min-h-[6.5rem] overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Bar className="h-2.5 w-2.5 rounded-full" />
                <Bar className="h-4 w-40" />
              </div>
              <Bar className="h-3 w-56 max-w-full" />
              <Bar className="h-3 w-44 max-w-full" />
              <Bar className="h-3 w-36 max-w-full" />
            </div>
            <Bar className="h-8 w-24 shrink-0 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
