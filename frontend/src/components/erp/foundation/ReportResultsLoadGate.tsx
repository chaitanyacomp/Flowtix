import * as React from "react";
import { resolveReportTableLoadUi, type PageLoadSnapshot } from "../../../lib/pageLoadState";
import { ErpRefreshingBadge } from "./ErpRefreshingBadge";

export type ReportResultsLoadGateProps = {
  /** e.g. missing date range — takes precedence over load states. */
  blocked?: boolean;
  blockedState?: React.ReactNode;
  firstLoadDone: boolean;
  loading: boolean;
  hasDisplayData: boolean;
  isEmpty: boolean;
  error?: React.ReactNode;
  emptyState: React.ReactNode;
  initialLoader?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Report results body gate:
 * - first load → loader (no false empty)
 * - refresh → keep children + compact Refreshing badge
 * - empty only after first load completes
 */
export function ReportResultsLoadGate({
  blocked = false,
  blockedState,
  firstLoadDone,
  loading,
  hasDisplayData,
  isEmpty,
  error,
  emptyState,
  initialLoader = <div className="px-4 py-8 text-sm text-slate-500">Loading…</div>,
  children,
}: ReportResultsLoadGateProps) {
  if (blocked) {
    return <>{blockedState}</>;
  }

  const snapshot: PageLoadSnapshot & { isEmpty: boolean } = {
    firstLoadDone,
    loading,
    hasDisplayData,
    isEmpty,
  };
  const ui = resolveReportTableLoadUi(snapshot);

  if (ui.showInitialLoader) {
    return <>{initialLoader}</>;
  }

  return (
    <div data-testid="report-results-load-gate">
      {ui.showRefreshing ? (
        <div className="flex justify-end px-4 pt-2">
          <ErpRefreshingBadge />
        </div>
      ) : null}
      {error && !hasDisplayData ? error : ui.showEmpty ? emptyState : children}
    </div>
  );
}
