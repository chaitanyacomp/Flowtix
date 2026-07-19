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
 * Production Report workbench: one viewport, full-width report, compact summary strip.
 * Left-side summary cards are intentionally omitted (AP-03 / compact workbench).
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

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden max-[800px]:max-h-none max-[800px]:overflow-y-auto",
        "lg:h-[calc(100dvh-12rem)] lg:max-h-[calc(100dvh-12rem)]",
        className,
      )}
      data-testid="production-no-qty-viewport-shell"
    >
      <div
        className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-slate-200/90 bg-white px-2.5 py-1.5"
        data-testid="production-report-wo-identity"
      >
        <span className="text-[13px] font-bold tracking-tight text-slate-900">{woSummary.woLabel}</span>
        <span className="text-[12px] font-semibold text-slate-700">{woSummary.soLabel}</span>
        {woSummary.customerName ? (
          <span className="text-[11px] font-medium text-slate-500">{woSummary.customerName}</span>
        ) : null}
        <span className="min-w-0 truncate text-[12px] font-medium text-slate-800" title={woSummary.itemName}>
          {woSummary.itemName}
        </span>
      </div>

      {isShort ? (
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

      <ProductionReportPanel
        workOrderId={workOrderId}
        refreshKey={reportRefreshKey}
        compact
        premium
        enableDraftCache
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden border-0 shadow-none"
        onStatusChange={handleReportStatusChange}
        closeWorkOrderOnConfirm
        confirmButtonLabel="Confirm Report & Close WO"
        onConfirmed={handleReportConfirmed}
      />
    </div>
  );
}
