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
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Work orders waiting for issue</h3>
        <Link to="/production/material-requests" className="text-xs font-medium text-primary hover:underline">
          All requests
        </Link>
      </div>

      <ul className="max-h-[min(520px,50vh)] space-y-2 overflow-y-auto">
        {groups.length === 0 ? (
          <li className="text-xs text-slate-500">No pending material requests for store issue.</li>
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
          "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
          isActiveWo
            ? "border-violet-400 bg-violet-50/90 ring-1 ring-violet-200"
            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80",
        )}
        onClick={() => {
          onSelectWorkOrder?.(g.workOrderId);
          onSelectPmr(g.latestPmr.id, g.workOrderId);
        }}
      >
        <p className="text-sm font-extrabold text-slate-950">
          {g.workOrderNo ?? `WO-${g.workOrderId}`}
          {g.salesOrderNo ? <span className="font-semibold text-slate-600"> · {g.salesOrderNo}</span> : null}
        </p>
        {g.productionItemName ? (
          <p className="mt-0.5 truncate text-[11px] text-slate-600">{g.productionItemName}</p>
        ) : null}
        <p className="mt-1.5 text-xs text-slate-700">
          <span className="font-bold">Latest PMR:</span> {g.latestPmr.docNo ?? `PMR-${g.latestPmr.id}`}
        </p>
        <p className="mt-0.5 text-xs font-semibold text-amber-900">
          {g.pendingLineCount} RM line{g.pendingLineCount === 1 ? "" : "s"} pending · Total pending:{" "}
          <span className="tabular-nums">{fmtQty(g.totalPending)}</span>
        </p>
      </button>

      {hasOlder ? (
        <div className="mt-1 pl-1">
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] font-bold text-slate-600 hover:text-slate-900"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {g.allPmrs.length - 1} older request{g.allPmrs.length - 1 === 1 ? "" : "s"}
          </button>
          {expanded ? (
            <ul className="mt-1 space-y-1 border-l-2 border-slate-200 pl-2">
              {g.allPmrs.slice(1).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded border px-2 py-1 text-left text-[11px]",
                      activePmrId === p.id
                        ? "border-primary bg-white font-semibold"
                        : "border-slate-200 bg-white hover:bg-slate-50",
                    )}
                    onClick={() => onSelectPmr(p.id, g.workOrderId)}
                  >
                    {p.docNo ?? `PMR-${p.id}`} · pending {fmtQty(p.totalPending)}
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
