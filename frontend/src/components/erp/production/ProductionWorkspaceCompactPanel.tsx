import * as React from "react";

import { ProductionExecutionPanel } from "./ProductionExecutionPanel";

import { ProductionReportPanel } from "./ProductionReportPanel";

import { ProductionNoQtyWoSummaryCard, type ProductionNoQtyWoSummary } from "./ProductionNoQtyWoSummaryCard";

import { ProductionNoQtyViewportShell } from "./ProductionNoQtyViewportShell";

import {
  initialProductionReportPanelStatus,
  isProductionQtyShort,
  type ProductionReportPanelStatus,
} from "../../../lib/productionWorkspaceCompactUx";

import type { ProductionExecutionClosedOutcome } from "../../../lib/productionCompletionUx";

import type { ProductionExecutionSummary } from "../../../lib/productionExecutionApi";

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
  onReportConfirmed?: (meta: { requiresShortfallDecision: boolean; remainderQty: number }) => void;
  className?: string;
};

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
      if (meta.executionCloseOutcome && onExecutionClosed) {
        const rawOutcome = String(meta.executionCloseOutcome).toUpperCase();
        const outcome: ProductionExecutionClosedOutcome =
          rawOutcome === "CARRY_FORWARD"
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
      });
    },
    [executionSummary?.surplusQty, onExecutionClosed, onReportConfirmed, workOrderId],
  );

  const closurePanel = (
    <div
      className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border border-slate-200/90 bg-white p-3.5 shadow-sm"
      data-testid="production-workspace-closure-panel"
    >
      <ProductionNoQtyWoSummaryCard summary={woSummary} />

      {isShort ? (
        <div
          className="rounded-md border border-amber-200/90 bg-amber-50 px-2.5 py-2"
          data-testid="production-shortage-status"
        >
          <div className="text-[13px] font-semibold text-amber-950">Below WO qty</div>
          <div className="mt-0.5 text-[12px] font-medium tabular-nums text-amber-900">
            Short {Math.max(0, planned - produced)} units
            {String(orderType ?? "").trim() !== "GREEN_LEVEL"
              ? " — carry forward on close"
              : " — remaining qty will be recalculated in next Green Level planning"}
          </div>
        </div>
      ) : null}

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
  );

  const reportPanel = (
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
  );

  return (
    <ProductionNoQtyViewportShell
      className={className}
      viewportOffsetClass="lg:h-[calc(100dvh-12rem)] lg:max-h-[calc(100dvh-12rem)]"
      left={closurePanel}
      right={reportPanel}
    />
  );
}
