import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpDown, ClipboardList, ExternalLink } from "lucide-react";
import { ERPBackNavigation, PageContainer, PageHeader, StickyWorkspaceHead } from "../components/PageHeader";
import { Button, buttonVariants } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";
import { ErpRefreshingBadge } from "../components/erp/foundation/ErpRefreshingBadge";
import { PendingActionBucketSkeleton } from "../components/erp/pending/PendingActionBucketSkeleton";
import { RmAllowanceApprovalDetailModal } from "../components/erp/RmAllowanceApprovalDetailModal";
import { useAuth } from "../hooks/useAuth";
import { useListScrollRestoration } from "../hooks/useListScrollRestoration";
import { useUrlQueryState } from "../hooks/useUrlQueryState";
import { usePendingActionsPageData } from "../hooks/usePendingActionsPageData";
import { bumpErpRefresh } from "../lib/erpRefresh";
import { usePagePerf } from "../lib/performanceTiming";
import {
  formatPendingActionAge,
  formatPendingActionOwner,
  pendingActionPriorityLabel,
  pendingActionPriorityTone,
  type PendingAction,
  type PendingActionPriority,
  type PendingActionsDashboardProps,
} from "../lib/pendingActionsApi";
import {
  groupPendingActionsIntoWorkBuckets,
  pendingActionsBucketNavigateState,
  type PendingActionWorkBucket,
} from "../lib/pendingActionsWorkBuckets";
import {
  RM_ALLOWANCE_APPROVAL_ACTION,
  resolveAllowanceApprovalIdFromAction,
} from "../lib/rmAllowanceApprovalApi";
import { cn } from "../lib/utils";

const RM_ALLOWANCE_APPROVAL_FOCUS = "rm-allowance-approval";

function isRmAllowanceApprovalBucket(bucket: PendingActionWorkBucket): boolean {
  return bucket.actionType === RM_ALLOWANCE_APPROVAL_ACTION;
}

type SortMode = "priority" | "age";

function PriorityDot({ priority }: { priority: PendingActionPriority }) {
  const tone = pendingActionPriorityTone(priority);
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        tone === "crit" && "bg-red-500",
        tone === "warn" && "bg-amber-500",
        tone === "muted" && "bg-yellow-400",
      )}
      title={pendingActionPriorityLabel(priority)}
      aria-hidden
    />
  );
}

function sortActions(rows: PendingAction[], mode: SortMode): PendingAction[] {
  const priorityRank: Record<PendingActionPriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const copy = [...rows];
  if (mode === "age") {
    return copy.sort((a, b) => {
      const aa = a.ageHours != null ? Number(a.ageHours) : -1;
      const ab = b.ageHours != null ? Number(b.ageHours) : -1;
      if (aa !== ab) return ab - aa;
      return (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
    });
  }
  return copy.sort((a, b) => {
    const pr = (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
    if (pr !== 0) return pr;
    const aa = a.ageHours != null ? Number(a.ageHours) : -1;
    const ab = b.ageHours != null ? Number(b.ageHours) : -1;
    return ab - aa;
  });
}

export function PendingActionsPage() {
  const auth = useAuth();
  useListScrollRestoration();
  const navigate = useNavigate();
  const role = String(auth.user?.role ?? "").trim().toUpperCase();
  const isAdmin = role === "ADMIN";
  const { patch, read } = useUrlQueryState({ sort: "priority" });
  const sortMode = read.enum("sort", ["priority", "age"] as const, "priority");
  const setSortMode = React.useCallback(
    (mode: SortMode) => patch({ sort: mode === "priority" ? null : mode }),
    [patch],
  );
  const { firstLoadDone, initialLoading, refreshing, error, count, actions } = usePendingActionsPageData();
  usePagePerf("pending-actions", firstLoadDone, { role, count });

  const focusParam = read.string("focus");
  const allowanceApprovalIdParam = read.int("allowanceApprovalId", 0);
  const activeAllowanceApprovalId =
    isAdmin && focusParam === RM_ALLOWANCE_APPROVAL_FOCUS && allowanceApprovalIdParam > 0
      ? allowanceApprovalIdParam
      : null;

  const openAllowanceApproval = React.useCallback(
    (item: PendingAction) => {
      const id = resolveAllowanceApprovalIdFromAction(item);
      if (!id) return;
      patch({ focus: RM_ALLOWANCE_APPROVAL_FOCUS, allowanceApprovalId: String(id) });
    },
    [patch],
  );

  const closeAllowanceApprovalModal = React.useCallback(() => {
    patch({ focus: null, allowanceApprovalId: null });
  }, [patch]);

  const handleAllowanceApprovalDecided = React.useCallback(() => {
    bumpErpRefresh("pending-actions");
  }, []);

  const sorted = React.useMemo(() => sortActions(actions, sortMode), [actions, sortMode]);
  const buckets = React.useMemo(
    () => groupPendingActionsIntoWorkBuckets(sorted, sortMode),
    [sorted, sortMode],
  );

  const showInitialBucketSkeleton = initialLoading && buckets.length === 0;
  const showEmpty = firstLoadDone && !error && sorted.length === 0;

  return (
    <PageContainer>
      <StickyWorkspaceHead lead={<ERPBackNavigation defaultTo="/dashboard" defaultLabel="Back to Dashboard" />}>
        <PageHeader
          title="Pending Actions"
          subtitle="Work grouped by type — open the workspace to work through each list. Nothing is edited on this page."
        />
      </StickyWorkspaceHead>

      <div className="mb-4 max-w-full overflow-x-auto pb-0.5">
        <ErpKpiStrip className="min-w-0" role="region" aria-label="Pending actions summary">
          <ErpKpiSegment>
            <ErpKpiLabel>Assigned to you</ErpKpiLabel>
            <ErpKpiValue tone={count > 0 ? "warn" : "muted"}>{initialLoading ? "…" : count}</ErpKpiValue>
          </ErpKpiSegment>
          <ErpKpiSegment>
            <ErpKpiLabel>Work buckets</ErpKpiLabel>
            <ErpKpiValue tone={buckets.length > 0 ? "default" : "muted"}>
              {initialLoading ? "…" : buckets.length}
            </ErpKpiValue>
          </ErpKpiSegment>
          <ErpKpiSegment>
            <ErpKpiLabel>Role</ErpKpiLabel>
            <ErpKpiValue>{formatPendingActionOwner(role)}</ErpKpiValue>
          </ErpKpiSegment>
        </ErpKpiStrip>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">Sort by:</span>
        <Button
          type="button"
          size="sm"
          variant={sortMode === "priority" ? "default" : "outline"}
          onClick={() => setSortMode("priority")}
        >
          <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Priority
        </Button>
        <Button
          type="button"
          size="sm"
          variant={sortMode === "age" ? "default" : "outline"}
          onClick={() => setSortMode("age")}
        >
          Age
        </Button>
        {refreshing ? (
          <div className="ml-auto">
            <ErpRefreshingBadge />
          </div>
        ) : null}
      </div>

      {error ? (
        <Card className="mb-3 border-red-200 bg-red-50/80">
          <CardContent className="px-4 py-3 text-sm text-red-900">{error}</CardContent>
        </Card>
      ) : null}

      {showInitialBucketSkeleton ? <PendingActionBucketSkeleton count={3} /> : null}

      {showEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-slate-600">
            <ClipboardList className="h-8 w-8 text-slate-400" aria-hidden />
            <p className="font-medium text-slate-900">No pending actions</p>
            <p>When work is assigned to {formatPendingActionOwner(role)}, it will appear here.</p>
            <Link
              to="/dashboard"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2")}
            >
              Return to Dashboard
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {!showInitialBucketSkeleton && buckets.length > 0 ? (
        <div className="space-y-3" data-testid="pending-actions-buckets">
          {buckets.map((bucket) => {
            const isAllowanceBucket = isAdmin && isRmAllowanceApprovalBucket(bucket);
            return (
            <div
              key={bucket.key}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
              data-testid={`pending-action-bucket-${bucket.key}`}
            >
              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityDot priority={bucket.topPriority} />
                    <h2 className="text-[15px] font-semibold text-slate-900">{bucket.title}</h2>
                    <span className="text-xs text-slate-500">
                      {formatPendingActionOwner(bucket.ownerRole)}
                      {bucket.maxAgeHours != null ? ` · ${formatPendingActionAge(bucket.maxAgeHours)}` : ""}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-slate-800">
                    {bucket.previewLines.map((line, idx) =>
                      isAllowanceBucket && bucket.items[idx] ? (
                        <li key={`${bucket.key}-${line.documentNo}-${idx}`} className="tabular-nums">
                          <button
                            type="button"
                            className="text-left font-medium text-slate-900 underline-offset-2 hover:underline"
                            onClick={() => openAllowanceApproval(bucket.items[idx])}
                          >
                            {line.documentNo}
                          </button>
                          {line.detail ? (
                            <span className="ml-2 text-slate-600">{line.detail}</span>
                          ) : null}
                        </li>
                      ) : (
                        <li key={`${bucket.key}-${line.documentNo}-${idx}`} className="tabular-nums">
                          <span className="font-medium">{line.documentNo}</span>
                          {line.detail ? (
                            <span className="ml-2 text-slate-600">{line.detail}</span>
                          ) : null}
                        </li>
                      ),
                    )}
                    {bucket.overflowCount > 0 ? (
                      <li className="text-slate-500">+{bucket.overflowCount} more…</li>
                    ) : null}
                  </ul>
                </div>
                <div className="shrink-0 sm:pt-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1"
                    onClick={() => {
                      if (isAllowanceBucket && bucket.items[0]) {
                        openAllowanceApproval(bucket.items[0]);
                        return;
                      }
                      navigate(bucket.openHref, {
                        state: pendingActionsBucketNavigateState(bucket),
                      });
                    }}
                  >
                    {bucket.openLabel}
                    <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden />
                  </Button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      ) : null}

      {isAdmin ? (
        <RmAllowanceApprovalDetailModal
          open={activeAllowanceApprovalId != null}
          allowanceApprovalId={activeAllowanceApprovalId}
          onClose={closeAllowanceApprovalModal}
          onDecided={handleAllowanceApprovalDecided}
        />
      ) : null}
    </PageContainer>
  );
}

/** Compact dashboard card — single entry point to the operational inbox. */
export const PENDING_ACTIONS_DEFAULT_HELPER = "Click to open your operational inbox";

export const PENDING_ACTIONS_PRODUCTION_HELPER = "Work you need to start or continue now.";

export function PendingActionsDashboardCard({
  count,
  loading,
  refreshing,
  error,
  description,
}: PendingActionsDashboardProps) {
  const navigate = useNavigate();
  const displayCount = loading ? "…" : String(count);
  const tone = count > 0 ? "warn" : "muted";
  const helperText = description?.trim() || PENDING_ACTIONS_DEFAULT_HELPER;

  return (
    <button
      type="button"
      onClick={() => navigate("/pending-actions")}
      className={cn(
        "w-full rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm transition-colors",
        "hover:border-slate-300 hover:bg-slate-50/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400",
      )}
      aria-label={`Pending Actions${loading ? "" : `: ${count} items`}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ClipboardList className="h-6 w-6 shrink-0 text-slate-600" aria-hidden />
          <span className="text-base font-semibold text-slate-900">Pending Actions</span>
        </div>
        <ErpKpiValue tone={tone} className="text-3xl leading-none">
          {displayCount}
        </ErpKpiValue>
        {refreshing ? <ErpRefreshingBadge className="shrink-0" /> : null}
      </div>
      {error ? <p className="mt-1.5 text-sm text-red-700">{error}</p> : null}
      {!error ? <p className="mt-1.5 text-sm text-slate-500">{helperText}</p> : null}
    </button>
  );
}
