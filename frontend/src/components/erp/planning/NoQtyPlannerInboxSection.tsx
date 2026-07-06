import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { cn } from "../../../lib/utils";
import { ErpRefreshingBadge } from "../foundation/ErpRefreshingBadge";
import type { NoQtyPlannerInboxRow } from "../../../hooks/useNoQtyPlannerInbox";
import { NoQtyCycleManagementWorkspace } from "./NoQtyCycleManagementWorkspace";
import { NoQtyCycleManagementSkeleton } from "./NoQtyCycleManagementSkeleton";

type Props = {
  rows: NoQtyPlannerInboxRow[];
  loading: boolean;
  initialLoading?: boolean;
  refreshing?: boolean;
  firstLoadDone?: boolean;
  error: string | null;
  className?: string;
  /** When set, show a single focused cycle management workspace for this agreement. */
  focusedSalesOrderId?: number | null;
  /** True while focused sales-order context is still being verified. */
  contextLoading?: boolean;
  /** Deep-link focus for Create Next RS from pending actions / dashboard. */
  focusedCreateNextRs?: { nextCycleNo: number | null; autoOpen?: boolean } | null;
};

/** FT-UX-002 — Cycle Management Workspace (not a Requirement Sheet launcher). */
export function NoQtyPlannerInboxSection({
  rows,
  loading,
  initialLoading,
  refreshing,
  firstLoadDone = false,
  error,
  className,
  focusedSalesOrderId = null,
  contextLoading = false,
  focusedCreateNextRs = null,
}: Props) {
  const visibleRows = React.useMemo(() => {
    const focusId = Number(focusedSalesOrderId);
    if (Number.isFinite(focusId) && focusId > 0) {
      return rows.filter((r) => Number(r.so.id) === focusId);
    }
    return rows;
  }, [rows, focusedSalesOrderId]);

  const attentionCount = visibleRows.filter(
    (r) =>
      r.so.noQtyCreateNextRsEligible ||
      r.rsStatus === "Draft" ||
      r.rsStatus === "No RS" ||
      r.rsStatus === "Cancelled",
  ).length;

  const focused = Number(focusedSalesOrderId) > 0;
  const isInitialLoad = initialLoading ?? (!firstLoadDone && loading);
  const isRefreshing = refreshing ?? (firstLoadDone && loading);
  const showSkeleton = isInitialLoad || contextLoading;
  const contentMinHeight = focused ? "min-h-[18.5rem]" : "min-h-[12rem]";

  return (
    <Card
      className={cn("min-w-0 overflow-hidden border-violet-200/80 shadow-sm", className)}
      data-testid="no-qty-planner-inbox"
    >
      <CardHeader className="space-y-1 border-b border-violet-100 bg-gradient-to-r from-violet-50/90 to-white px-3.5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">
            {focused ? "Cycle Management Workspace" : "NO_QTY Cycle Management"}
          </CardTitle>
          {showSkeleton ? (
            <span
              className="inline-block h-3 w-28 animate-pulse rounded bg-slate-200/80"
              aria-hidden
            />
          ) : (
            <span className="text-[11px] tabular-nums text-slate-600">
              {visibleRows.length} active · {attentionCount} need attention
            </span>
          )}
        </div>
        <p className="text-[11px] leading-snug text-slate-600">
          {focused
            ? "Review current cycle status, next RS eligibility, and prior cycle history — then use the single primary action to continue in the Requirement Sheet workbench."
            : "Cycle status and next-step decisions for active NO_QTY agreements. Each workspace has one primary action into the Requirement Sheet workbench."}
        </p>
        {isRefreshing ? (
          <div className="flex justify-end pt-0.5">
            <ErpRefreshingBadge />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className={cn("space-y-2 px-2.5 py-2.5", contentMinHeight)}>
        {showSkeleton ? (
          <NoQtyCycleManagementSkeleton focused={focused} rowCount={focused ? 1 : 2} />
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-900">{error}</div>
        ) : visibleRows.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] text-slate-700">
            {focused
              ? "No active cycle management context for this sales order."
              : "No active NO_QTY agreements require cycle planning attention right now."}
          </p>
        ) : (
          <div className="space-y-2">
            {visibleRows.map((row) => (
              <NoQtyCycleManagementWorkspace
                key={row.so.id}
                row={row}
                compact={!focused && visibleRows.length > 1}
                highlightCreateNextRs={
                  focusedCreateNextRs && Number(focusedSalesOrderId) === Number(row.so.id)
                    ? focusedCreateNextRs
                    : null
                }
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
