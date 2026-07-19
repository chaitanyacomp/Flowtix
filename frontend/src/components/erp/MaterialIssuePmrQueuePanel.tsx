import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { displayPmrNo, displayWorkOrderNo } from "../../lib/docNoDisplay";
import { cn } from "../../lib/utils";
import {
  groupPendingPmrsByWorkOrder,
  type PendingPmrSummary,
  type WoPmrGroup,
} from "../../lib/materialIssueWorkspace";
import {
  resolveIssueQueueState,
  resolveMaterialIssueQueueFilter,
  type MaterialIssueQueueFilterKey,
} from "../../lib/materialIssueQueueState";
import type { PmrAllowanceQueueStatus } from "../../lib/rmAllowanceApprovalUx";

type Props = {
  pendingPmrs: PendingPmrSummary[];
  activePmrId: number | null;
  activeWorkOrderId?: number | null | undefined;
  onSelectPmr: (pmrId: number, workOrderId?: number) => void;
  onSelectWorkOrder?: (workOrderId: number) => void;
  /** Controlled filter from URL deep-link (e.g. Continue RM Issue → Partially Issued). */
  activeFilter?: MaterialIssueQueueFilterKey;
  onFilterChange?: (key: MaterialIssueQueueFilterKey) => void;
};

const FILTER_TABS: Array<{ key: MaterialIssueQueueFilterKey; label: string }> = [
  { key: "READY", label: "Ready to Issue" },
  { key: "PARTIAL", label: "Partially Issued" },
  { key: "PENDING", label: "Approval Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected / Revision Required" },
];

const FILTER_BADGE: Record<
  MaterialIssueQueueFilterKey,
  { label: string; className: string }
> = {
  READY: { label: "Ready", className: "bg-slate-100 text-slate-700" },
  PARTIAL: { label: "Partially Issued", className: "bg-sky-100 text-sky-900" },
  PENDING: { label: "Approval Pending", className: "bg-amber-100 text-amber-900" },
  APPROVED: { label: "Approved · Ready to Issue", className: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Rejected · Revise", className: "bg-red-100 text-red-800" },
};

function fmtQty(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function groupFilterKey(group: WoPmrGroup): MaterialIssueQueueFilterKey {
  const allowance = (group.latestPmr.allowanceStatus as PmrAllowanceQueueStatus | undefined) ?? "NONE";
  return resolveMaterialIssueQueueFilter({
    allowanceStatus: allowance,
    issueQueueState: resolveIssueQueueState(group.latestPmr),
  });
}

export function MaterialIssuePmrQueuePanel({
  pendingPmrs,
  activePmrId,
  activeWorkOrderId,
  onSelectPmr,
  onSelectWorkOrder,
  activeFilter: controlledFilter,
  onFilterChange,
}: Props) {
  const groups = React.useMemo(() => groupPendingPmrsByWorkOrder(pendingPmrs), [pendingPmrs]);
  const [expandedWo, setExpandedWo] = React.useState<Set<number>>(new Set());
  const [internalFilter, setInternalFilter] = React.useState<MaterialIssueQueueFilterKey>("READY");
  const activeFilter = controlledFilter ?? internalFilter;

  function setFilter(key: MaterialIssueQueueFilterKey) {
    onFilterChange?.(key);
    if (controlledFilter == null) setInternalFilter(key);
  }

  function toggleExpand(woId: number) {
    setExpandedWo((prev) => {
      const next = new Set(prev);
      if (next.has(woId)) next.delete(woId);
      else next.add(woId);
      return next;
    });
  }

  const tabCounts = React.useMemo(() => {
    const counts: Record<MaterialIssueQueueFilterKey, number> = {
      READY: 0,
      PARTIAL: 0,
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
    };
    for (const g of groups) {
      counts[groupFilterKey(g)] += 1;
    }
    return counts;
  }, [groups]);

  const activeTab = FILTER_TABS.find((t) => t.key === activeFilter) ?? FILTER_TABS[0];
  const filteredGroups = React.useMemo(
    () => groups.filter((g) => groupFilterKey(g) === activeFilter),
    [groups, activeFilter],
  );

  return (
    <div
      className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2"
      data-testid="material-issue-queue-panel"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
          Work orders waiting for issue
        </h3>
        <Link to="/production/material-requests" className="text-[10px] font-medium text-primary hover:underline">
          All
        </Link>
      </div>

      <div className="mb-1.5 flex flex-wrap gap-1" data-testid="material-issue-queue-filters">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
              activeFilter === tab.key
                ? "border-violet-500 bg-violet-50 text-violet-900"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
            onClick={() => setFilter(tab.key)}
            data-testid={`material-issue-queue-filter-${tab.key}`}
          >
            {tab.label} ({tabCounts[tab.key]})
          </button>
        ))}
      </div>

      <ul className="max-h-[min(420px,45vh)] space-y-1 overflow-y-auto">
        {filteredGroups.length === 0 ? (
          <li className="text-[11px] text-slate-500">
            {groups.length === 0 ? "No pending material requests." : `No work orders in “${activeTab.label}”.`}
          </li>
        ) : (
          filteredGroups.map((g) => (
            <WoGroupCard
              key={g.workOrderId}
              group={g}
              filterKey={groupFilterKey(g)}
              activePmrId={activePmrId}
              activeWorkOrderId={activeWorkOrderId}
              expanded={expandedWo.has(g.workOrderId)}
              onToggleExpand={() => toggleExpand(g.workOrderId)}
              onSelectPmr={onSelectPmr}
              onSelectWorkOrder={onSelectWorkOrder}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function WoGroupCard({
  group,
  filterKey,
  activePmrId,
  activeWorkOrderId,
  expanded,
  onToggleExpand,
  onSelectPmr,
  onSelectWorkOrder,
}: {
  group: WoPmrGroup;
  filterKey: MaterialIssueQueueFilterKey;
  activePmrId: number | null;
  activeWorkOrderId?: number | null | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelectPmr: (pmrId: number, workOrderId?: number) => void;
  onSelectWorkOrder?: (workOrderId: number) => void;
}) {
  const g = group;
  const isActiveWo = activeWorkOrderId === g.workOrderId || activePmrId === g.latestPmr.id;
  const hasOlder = g.allPmrs.length > 1;
  const badge = FILTER_BADGE[filterKey];
  const allowancePct = g.latestPmr.allowancePct;
  const isPartial = filterKey === "PARTIAL";
  const required = g.totalRequired > 0 ? g.totalRequired : n(g.latestPmr.totalRequired);
  const issued = g.totalIssued > 0 ? g.totalIssued : n(g.latestPmr.totalIssued);

  return (
    <li>
      <button
        type="button"
        className={cn(
          "w-full rounded border px-2 py-1.5 text-left transition-colors",
          isActiveWo
            ? "border-violet-500 bg-violet-50 ring-2 ring-violet-300/80"
            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80",
        )}
        onClick={() => {
          onSelectWorkOrder?.(g.workOrderId);
          onSelectPmr(g.latestPmr.id, g.workOrderId);
        }}
      >
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0">
            {g.productionItemName ? (
              <p className="truncate text-[11px] font-semibold text-slate-900">{g.productionItemName}</p>
            ) : null}
            <p className={cn("text-[11px] font-bold text-slate-950", g.productionItemName && "mt-0.5")}>
              {displayWorkOrderNo(g.workOrderId, g.workOrderNo)}
              {g.salesOrderNo ? <span className="font-medium text-slate-500"> · {g.salesOrderNo}</span> : null}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500">
              {displayPmrNo(g.latestPmr.id, g.latestPmr.docNo)}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-4",
              badge.className,
            )}
            data-testid="material-issue-queue-status-badge"
          >
            {badge.label}
          </span>
        </div>
        {isPartial ? (
          <p className="mt-0.5 text-[10px] tabular-nums text-slate-700">
            Required {fmtQty(required)} · Issued {fmtQty(issued)} · Remaining {fmtQty(g.totalPending)}
            {g.pendingLineCount > 1 ? ` · ${g.pendingLineCount} lines` : ""}
          </p>
        ) : (
          <p className="mt-0.5 text-[10px] font-semibold tabular-nums text-amber-900">
            Pending {fmtQty(g.totalPending)}
            {g.pendingLineCount > 1 ? ` · ${g.pendingLineCount} lines` : ""}
            {(filterKey === "PENDING" || filterKey === "APPROVED" || filterKey === "REJECTED") &&
            allowancePct != null
              ? ` · Allowance ${allowancePct.toFixed(1)}%`
              : ""}
          </p>
        )}
      </button>

      {hasOlder ? (
        <div className="mt-0.5 pl-1">
          <button
            type="button"
            className="flex items-center gap-0.5 text-[10px] font-semibold text-slate-600 hover:text-slate-900"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {g.allPmrs.length - 1} older
          </button>
          {expanded ? (
            <ul className="mt-0.5 space-y-0.5 border-l-2 border-slate-200 pl-1.5">
              {g.allPmrs.slice(1).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded border px-1.5 py-0.5 text-left text-[10px]",
                      activePmrId === p.id
                        ? "border-primary bg-white font-semibold"
                        : "border-slate-200 bg-white hover:bg-slate-50",
                    )}
                    onClick={() => onSelectPmr(p.id, g.workOrderId)}
                  >
                    {displayPmrNo(p.id, p.docNo)} · {fmtQty(p.totalPending)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
