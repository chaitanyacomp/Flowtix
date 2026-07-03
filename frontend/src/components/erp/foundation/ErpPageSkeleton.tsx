import { cn } from "../../../lib/utils";

export type ErpPageSkeletonVariant = "dashboard" | "list" | "workspace" | "table" | "panel";

export type ErpPageSkeletonProps = {
  variant?: ErpPageSkeletonVariant;
  lines?: number;
  className?: string;
};

function SkeletonBar({ className }: { className?: string }) {
  return <div className={cn("erp-page-skeleton-bar animate-pulse rounded bg-slate-200/80", className)} aria-hidden />;
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("erp-page-skeleton-block animate-pulse rounded-md bg-slate-100", className)} aria-hidden />;
}

export function ErpPageSkeleton({ variant = "panel", lines = 4, className }: ErpPageSkeletonProps) {
  if (variant === "dashboard") {
    return (
      <div className={cn("erp-page-skeleton space-y-3", className)} data-testid="erp-page-skeleton">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-16 border border-slate-200/80" />
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <SkeletonBlock className="h-40 border border-slate-200/80" />
          <SkeletonBlock className="h-40 border border-slate-200/80" />
        </div>
        <SkeletonBlock className="h-28 border border-slate-200/80" />
      </div>
    );
  }

  if (variant === "workspace") {
    return (
      <div className={cn("erp-page-skeleton grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]", className)} data-testid="erp-page-skeleton">
        <SkeletonBlock className="min-h-[14rem] border border-slate-200/80" />
        <SkeletonBlock className="min-h-[14rem] border border-slate-200/80" />
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className={cn("erp-page-skeleton overflow-hidden rounded-md border border-slate-200/80 bg-white", className)} data-testid="erp-page-skeleton">
        <div className="border-b border-slate-200/80 bg-slate-50 px-3 py-2">
          <SkeletonBar className="h-3 w-32" />
        </div>
        <div className="divide-y divide-slate-100 px-3 py-1">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5">
              <SkeletonBar className="h-3 flex-1" />
              <SkeletonBar className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className={cn("erp-page-skeleton space-y-2", className)} data-testid="erp-page-skeleton">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonBlock key={i} className="h-20 border border-slate-200/80" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("erp-page-skeleton space-y-2 rounded-md border border-slate-200/80 bg-white p-4", className)} data-testid="erp-page-skeleton">
      <SkeletonBar className="h-4 w-40" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBar key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}
