import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  groupPendingPmrsByWorkOrder,
  type PendingPmrSummary,
  type WoPmrGroup,
} from "../../lib/materialIssueWorkspace";

type Props = {
  pendingPmrs: PendingPmrSummary[];
  activePmrId: number | null;
  activeWorkOrderId?: number | null | undefined;
  onSelectPmr: (pmrId: number, workOrderId?: number) => void;
  onSelectWorkOrder?: (workOrderId: number) => void;
};

function fmtQty(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function MaterialIssuePmrQueuePanel({
  pendingPmrs,
  activePmrId,
  activeWorkOrderId,
  onSelectPmr,
  onSelectWorkOrder,
}: Props) {
  const groups = React.useMemo(() => groupPendingPmrsByWorkOrder(pendingPmrs), [pendingPmrs]);
  const [expandedWo, setExpandedWo] = React.useState<Set<number>>(new Set());

  function toggleExpand(woId: number) {
    setExpandedWo((prev) => {
      const next = new Set(prev);
      if (next.has(woId)) next.delete(woId);
      else next.add(woId);
      return next;
    });
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
          Work orders waiting for issue
        </h3>
        <Link to="/production/material-requests" className="text-[10px] font-medium text-primary hover:underline">
          All
        </Link>
      </div>

      <ul className="max-h-[min(420px,45vh)] space-y-1 overflow-y-auto">
        {groups.length === 0 ? (
          <li className="text-[11px] text-slate-500">No pending material requests.</li>
        ) : (
          groups.map((g) => (
            <WoGroupCard
              key={g.workOrderId}
              group={g}
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
  activePmrId,
  activeWorkOrderId,
  expanded,
  onToggleExpand,
  onSelectPmr,
  onSelectWorkOrder,
}: {
  group: WoPmrGroup;
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
        {g.productionItemName ? (
          <p className="truncate text-[11px] font-semibold text-slate-900">{g.productionItemName}</p>
        ) : null}
        <p className={cn("text-[11px] font-bold text-slate-950", g.productionItemName && "mt-0.5")}>
          {g.workOrderNo ?? `WO-${g.workOrderId}`}
          {g.salesOrderNo ? <span className="font-medium text-slate-500"> · {g.salesOrderNo}</span> : null}
        </p>
        <p className="mt-0.5 text-[10px] font-semibold tabular-nums text-amber-900">
          Pending {fmtQty(g.totalPending)}
          {g.pendingLineCount > 1 ? ` · ${g.pendingLineCount} lines` : ""}
        </p>
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
                    {p.docNo ?? `PMR-${p.id}`} · {fmtQty(p.totalPending)}
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
