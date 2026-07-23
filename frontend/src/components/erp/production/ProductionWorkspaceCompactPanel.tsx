import * as React from "react";

import { ProductionExecutionPanel } from "./ProductionExecutionPanel";
import { ProductionReportPanel } from "./ProductionReportPanel";
import type { ProductionNoQtyWoSummary } from "./ProductionNoQtyWoSummaryCard";
import {
  initialProductionReportPanelStatus,
  isProductionQtyShort,
  type ProductionReportPanelStatus,
} from "../../../lib/productionWorkspaceCompactUx";
import type { ProductionExecutionClosedOutcome } from "../../../lib/productionCompletionUx";
import type { ProductionExecutionSummary } from "../../../lib/productionExecutionApi";
import { cn } from "../../../lib/utils";

export type ProductionWorkspaceWoSummary = ProductionNoQtyWoSummary;

function fmtQty(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : String(r);
}

type Props = {
  workOrderId: number;
  orderType?: string | null;
  woSummary: ProductionWorkspaceWoSummary;
  canOperate?: boolean;
  executionRefreshKey?: number;
  reportRefreshKey?: number;
  evaluateTick?: number;
  evaluateBatchQty?: number;
  onChanged?: () => void;
  onSummaryChange?: (summary: ProductionExecutionSummary | null) => void;
  onExecutionClosed?: (payload: {
    workOrderId: number;
    outcome: ProductionExecutionClosedOutcome;
  }) => void | Promise<void>;
  onReportConfirmed?: (meta: {
    requiresShortfallDecision: boolean;
    remainderQty: number;
    executionCloseOutcome?: string | null;
  }) => void;
  className?: string;
};

/**
 * Production Report Mode workbench: compact WO header + full-width report.
 * Hides Production Entry / Material Ready / Recent Entries / Other Open WOs (AP-03).
 */
export function ProductionWorkspaceCompactPanel({
  workOrderId,
  orderType,
  woSummary,
  canOperate = false,
  executionRefreshKey = 0,
  reportRefreshKey = 0,
  evaluateTick = 0,
  evaluateBatchQty = 0,
  onChanged,
  onSummaryChange,
  onExecutionClosed,
  onReportConfirmed,
  className,
}: Props) {
  const [reportStatus, setReportStatus] = React.useState<ProductionReportPanelStatus>(
    initialProductionReportPanelStatus(),
  );
  const [executionSummary, setExecutionSummary] = React.useState<ProductionExecutionSummary | null>(null);
  const [executionResolved, setExecutionResolved] = React.useState(false);

  const planned = Number(woSummary.plannedQty ?? 0);
  const produced = Number(woSummary.producedQty ?? 0);
  const isShort = isProductionQtyShort(produced, planned);
  const shortQty = Math.max(0, planned - produced);
  const isRegularReportMode =
    String(orderType ?? "").toUpperCase() === "REGULAR" ||
    String(orderType ?? "").toUpperCase() === "NORMAL" ||
    Boolean(woSummary.flowBadge);

  const handleSummaryChange = React.useCallback(
    (summary: ProductionExecutionSummary | null) => {
      setExecutionSummary(summary);
      setExecutionResolved(true);
      onSummaryChange?.(summary);
    },
    [onSummaryChange],
  );

  React.useEffect(() => {
    setExecutionSummary(null);
    setExecutionResolved(false);
    setReportStatus(initialProductionReportPanelStatus());
    onSummaryChange?.(null);
  }, [workOrderId, onSummaryChange]);

  const handleReportStatusChange = React.useCallback((status: ProductionReportPanelStatus) => {
    setReportStatus(status);
  }, []);

  const handleReportConfirmed = React.useCallback(
    async (meta: {
      requiresShortfallDecision: boolean;
      remainderQty: number;
      executionCloseOutcome?: string | null;
      executionCloseMessage?: string | null;
    }) => {
      // Compact workbench always closes on confirm — never fall through to legacy NO_QTY advance.
      if (onExecutionClosed) {
        const rawOutcome = String(meta.executionCloseOutcome ?? "").toUpperCase();
        const outcome: ProductionExecutionClosedOutcome =
          rawOutcome === "CARRY_FORWARD"
            ? "CARRY_FORWARD"
            : rawOutcome === "SURPLUS"
              ? "SURPLUS"
              : isShort
                ? "CARRY_FORWARD"
                : Number(executionSummary?.surplusQty ?? 0) > 1e-6
                  ? "SURPLUS"
                  : "COMPLETE";
        await onExecutionClosed({ workOrderId, outcome });
        return;
      }
      await onReportConfirmed?.({
        requiresShortfallDecision: meta.requiresShortfallDecision,
        remainderQty: meta.remainderQty,
        executionCloseOutcome: meta.executionCloseOutcome,
      });
    },
    [executionSummary?.surplusQty, isShort, onExecutionClosed, onReportConfirmed, workOrderId],
  );

  const unit = String(woSummary.unit ?? "").trim() || "Nos";

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", className)}
      data-testid="production-no-qty-viewport-shell"
      data-report-mode="1"
    >
      <div
        className="sticky top-0 z-[12] shrink-0 border-b border-slate-200/90 bg-white px-2.5 py-1.5 shadow-sm"
        data-testid="production-report-wo-identity"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-bold tracking-tight text-slate-900">{woSummary.woLabel}</span>
          <span className="text-[12px] font-semibold text-slate-700">{woSummary.soLabel}</span>
          <span className="min-w-0 truncate text-[12px] font-medium text-slate-800" title={woSummary.itemName}>
            {woSummary.itemName}
          </span>
          {woSummary.flowBadge ? (
            <span
              className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
              data-testid="production-report-flow-badge"
            >
              {woSummary.flowBadge}
            </span>
          ) : null}
          {woSummary.reportPending || !reportStatus.confirmed ? (
            <span
              className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950"
              data-testid="production-report-pending-badge"
            >
              Report Pending
            </span>
          ) : null}
        </div>
        <dl
          className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-6"
          data-testid="production-report-mode-metrics"
        >
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-500">Planned</dt>
            <dd className="font-bold tabular-nums text-slate-900">
              {fmtQty(woSummary.plannedQty)} {unit}
            </dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-500">Produced</dt>
            <dd className="font-bold tabular-nums text-slate-900">
              {fmtQty(woSummary.producedQty)} {unit}
            </dd>
          </div>
          {woSummary.soQty != null && Number.isFinite(Number(woSummary.soQty)) ? (
            <div>
              <dt className="font-semibold uppercase tracking-wide text-slate-500">SO Qty</dt>
              <dd className="font-bold tabular-nums text-slate-900">
                {fmtQty(woSummary.soQty)} {unit}
              </dd>
            </div>
          ) : (
            <div>
              <dt className="font-semibold uppercase tracking-wide text-slate-500">Remaining</dt>
              <dd className="font-bold tabular-nums text-slate-900">
                {fmtQty(woSummary.remainingQty)} {unit}
              </dd>
            </div>
          )}
          {isRegularReportMode ? (
            <>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">WO Target</dt>
                <dd className="font-bold tabular-nums text-slate-900">
                  {fmtQty(woSummary.plannedQty)} {unit}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Target Balance</dt>
                <dd className="font-bold tabular-nums text-slate-900">
                  {fmtQty(woSummary.remainingQty)} {unit}
                </dd>
              </div>
            </>
          ) : null}
          {woSummary.customerName ? (
            <div className="min-w-0 sm:col-span-1">
              <dt className="font-semibold uppercase tracking-wide text-slate-500">Customer</dt>
              <dd className="truncate font-medium text-slate-800">{woSummary.customerName}</dd>
            </div>
          ) : null}
        </dl>
        <p
          className="mt-1 text-[11px] font-medium text-amber-950"
          data-testid="production-report-mode-locked-line"
        >
          Production entry locked — complete the mandatory Production Report.
        </p>
      </div>

      {isShort && !isRegularReportMode ? (
        <p
          className="shrink-0 border-b border-amber-100 bg-amber-50/90 px-2.5 py-1 text-[11px] font-medium text-amber-950"
          data-testid="production-shortage-status"
        >
          Short production: {shortQty} Nos will enter recovery after the WO closes.
        </p>
      ) : null}

      {/* Keep execution sync for parent SHORTFALL_PENDING / pause state without a tall left panel. */}
      <div className="sr-only" aria-hidden>
        <ProductionExecutionPanel
          workOrderId={workOrderId}
          orderType={orderType}
          canOperate={canOperate}
          refreshKey={executionRefreshKey}
          evaluateTick={evaluateTick}
          evaluateBatchQty={evaluateBatchQty}
          layoutMode="compact-closure"
          productionReportConfirmed={reportStatus.confirmed}
          reportStatusResolved={reportStatus.resolved}
          executionSummary={executionSummary}
          executionResolved={executionResolved}
          workOrderLabel={woSummary.woLabel}
          itemName={woSummary.itemName}
          onChanged={onChanged}
          onSummaryChange={handleSummaryChange}
          onExecutionClosed={onExecutionClosed}
        />
      </div>

      {/* Intentionally omit: Production Entry, Material Ready, Recent Entries, Other Open WOs */}
      <ProductionReportPanel
        workOrderId={workOrderId}
        refreshKey={reportRefreshKey}
        compact
        premium
        enableDraftCache
        className="min-h-0 flex-1 border-0 shadow-none"
        onStatusChange={handleReportStatusChange}
        closeWorkOrderOnConfirm={!isRegularReportMode}
        confirmButtonLabel="Confirm Report & Close WO"
        onConfirmed={handleReportConfirmed}
        reportModeSummary={{
          woLabel: woSummary.woLabel,
          soLabel: woSummary.soLabel,
          itemName: woSummary.itemName,
          soQty: woSummary.soQty ?? null,
          woTarget: woSummary.plannedQty,
          produced: woSummary.producedQty,
          targetBalance: woSummary.remainingQty,
          unit,
        }}
      />
    </div>
  );
}
