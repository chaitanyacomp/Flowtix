import * as React from "react";
import { cn } from "../../../lib/utils";
import { isPageRefreshing, shouldShowEmptyState, shouldShowInitialPageSkeleton } from "../../../lib/pageLoadState";
import { ErpPageSkeleton, type ErpPageSkeletonVariant } from "./ErpPageSkeleton";
import { ErpRefreshingBadge } from "./ErpRefreshingBadge";

export type ErpPageContentGateProps = {
  firstLoadDone: boolean;
  loading?: boolean;
  refreshing?: boolean;
  hasDisplayData?: boolean;
  error?: React.ReactNode;
  skeletonVariant?: ErpPageSkeletonVariant;
  skeletonLines?: number;
  isEmpty?: boolean;
  emptyState?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/**
 * Gates main page content:
 * - initial load → skeleton (not blank / false empty)
 * - refresh → stale children + refreshing badge
 * - loaded empty → emptyState
 */
export function ErpPageContentGate({
  firstLoadDone,
  loading = false,
  refreshing,
  hasDisplayData = false,
  error,
  skeletonVariant = "panel",
  skeletonLines,
  isEmpty = false,
  emptyState,
  children,
  className,
}: ErpPageContentGateProps) {
  const snapshot = { firstLoadDone, loading, hasDisplayData };
  const showSkeleton = shouldShowInitialPageSkeleton(snapshot);
  const showRefreshing =
    refreshing ?? isPageRefreshing(snapshot);
  const showEmpty = shouldShowEmptyState({ firstLoadDone, isEmpty });

  if (showSkeleton) {
    return <ErpPageSkeleton variant={skeletonVariant} lines={skeletonLines} className={className} />;
  }

  return (
    <div className={cn("relative space-y-3", className)} data-testid="erp-page-content-gate">
      {showRefreshing ? (
        <div className="flex justify-end">
          <ErpRefreshingBadge />
        </div>
      ) : null}
      {error ? <div data-testid="erp-page-content-error">{error}</div> : null}
      {showEmpty ? emptyState : children}
    </div>
  );
}
