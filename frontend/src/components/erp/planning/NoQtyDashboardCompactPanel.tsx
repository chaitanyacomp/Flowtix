import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { displaySalesOrderNo } from "../../../lib/docNoDisplay";
import { resolveNoQtyDashboardContinuation } from "../../../lib/noQtyDashboardContinuation";
import type { NoQtyFlowState } from "../../../lib/noQtyFlowState";
import {
  noQtyDashboardRowToPresentation,
  type NoQtyDashboardCompactRow,
} from "../../../lib/noQtyDashboardPresentation";

export type { NoQtyDashboardCompactRow };

export type NoQtyDashboardCompactPanelProps = {
  rows: NoQtyDashboardCompactRow[];
  /** Full filtered list — used for summary counts. */
  allRows: NoQtyDashboardCompactRow[];
  flowBySo: Record<number, NoQtyFlowState | null | undefined>;
  viewerRole: string;
  dispatchReadyCount?: number;
  truncated?: boolean;
  viewAllHref: string;
  maxVisible?: number;
  onPrimaryAction: (args: {
    row: NoQtyDashboardCompactRow;
    resolved: ReturnType<typeof resolveNoQtyDashboardContinuation>;
  }) => void;
};

function SummaryChip({ label, value, tone }: { label: string; value: number; tone?: "warn" | "muted" }) {
  return (
    <div className="flex min-w-0 flex-col gap-px px-1.5 py-0.5">
      <span className="truncate text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span
        className={cn(
          "text-[13px] font-extrabold tabular-nums leading-none",
          tone === "warn" ? "text-amber-900" : tone === "muted" ? "text-slate-500" : "text-slate-900",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function NoQtyDashboardCompactPanel({
  rows,
  allRows,
  flowBySo,
  viewerRole,
  dispatchReadyCount = 0,
  truncated = false,
  viewAllHref,
  maxVisible = 5,
  onPrimaryAction,
}: NoQtyDashboardCompactPanelProps) {
  const summary = React.useMemo(
    () =>
      allRows.reduce(
        (acc, row) => {
          const flow = flowBySo[row.salesOrderId] ?? null;
          const pres = noQtyDashboardRowToPresentation({ row, flow, viewerRole, commercialContinuation: true });
          acc.total += 1;
          if (pres.summaryBucket === "create_rs") acc.createRsPending += 1;
          else if (pres.summaryBucket === "draft_rs") acc.draftRs += 1;
          else if (pres.summaryBucket === "ready_place_wo") acc.readyToPlaceWo += 1;
          return acc;
        },
        { total: 0, createRsPending: 0, draftRs: 0, readyToPlaceWo: 0 },
      ),
    [allRows, flowBySo, viewerRole],
  );

  return (
    <div
      className="erp-dash-no-qty-panel overflow-hidden rounded-md border border-slate-200/95 bg-slate-50/90 ring-1 ring-slate-900/[0.04]"
      data-testid="dashboard-no-qty-compact-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b border-blue-900/10 bg-gradient-to-r from-blue-50/80 to-slate-50/90 px-2 py-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-900">
          NO_QTY ({summary.total})
        </span>
        {truncated ? (
          <span className="text-[10px] font-medium text-slate-500">Showing {rows.length} of {summary.total}</span>
        ) : null}
      </div>

      <div
        className="grid grid-cols-2 divide-x divide-y divide-slate-200/80 border-b border-slate-200/80 bg-white/70 sm:grid-cols-5 sm:divide-y-0"
        data-testid="dashboard-no-qty-summary"
      >
        <SummaryChip label="Pending" value={summary.total} tone={summary.total > 0 ? "warn" : "muted"} />
        <SummaryChip label="Create RS" value={summary.createRsPending} tone={summary.createRsPending > 0 ? "warn" : "muted"} />
        <SummaryChip label="Draft RS" value={summary.draftRs} tone={summary.draftRs > 0 ? "warn" : "muted"} />
        <SummaryChip label="Place WO" value={summary.readyToPlaceWo} tone={summary.readyToPlaceWo > 0 ? "warn" : "muted"} />
        <SummaryChip label="Dispatch" value={dispatchReadyCount} tone={dispatchReadyCount > 0 ? "warn" : "muted"} />
      </div>

      <div className="erp-dash-no-qty-panel__scroll min-h-0">
        <table className="w-full table-fixed border-collapse text-[11px]">
          <thead className="sticky top-0 z-[1] bg-slate-100/95 text-[9px] font-bold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="w-[26%] px-2 py-1 text-left font-bold">SO</th>
              <th className="w-[24%] px-1 py-1 text-left font-bold">Customer</th>
              <th className="w-[22%] px-1 py-1 text-left font-bold">Stage</th>
              <th className="w-[28%] px-2 py-1 text-right font-bold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/80 bg-white/90">
            {rows.map((row) => {
              const flow = flowBySo[row.salesOrderId] ?? null;
              const pres = noQtyDashboardRowToPresentation({ row, flow, viewerRole, commercialContinuation: true });
              return (
                <tr
                  key={`no-qty-compact-${row.salesOrderId}`}
                  className="hover:bg-blue-50/30"
                  data-testid={`dashboard-no-qty-row-${row.salesOrderId}`}
                >
                  <td className="truncate px-2 py-1 font-semibold tabular-nums text-slate-950" title={displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo)}>
                    {displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo)}
                  </td>
                  <td className="truncate px-1 py-1 text-slate-700" title={row.customerName}>
                    {row.customerName}
                  </td>
                  <td
                    className="truncate px-1 py-1 font-medium text-slate-600"
                    data-testid={`dashboard-no-qty-state-${row.salesOrderId}`}
                  >
                    {pres.stageLabel}
                  </td>
                  <td className="px-2 py-0.5 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 max-w-full truncate px-1.5 text-[10px] font-semibold text-blue-800 hover:bg-blue-50 hover:text-blue-950"
                      data-testid={`dashboard-no-qty-continue-${row.salesOrderId}`}
                      title={pres.actionLabel}
                      onClick={() => onPrimaryAction({ row, resolved: pres.resolved })}
                    >
                      {pres.actionLabel}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {truncated || allRows.length > maxVisible ? (
        <div className="border-t border-slate-200/80 bg-slate-50/80 px-2 py-1 text-center">
          <Link
            to={viewAllHref}
            className="text-[10px] font-semibold text-blue-800 underline-offset-2 hover:underline"
            data-testid="dashboard-no-qty-view-all"
          >
            View all NO_QTY actions
          </Link>
        </div>
      ) : null}
    </div>
  );
}
