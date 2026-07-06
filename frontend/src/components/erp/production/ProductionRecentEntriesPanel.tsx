import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Badge } from "../../ui/badge";
import { Button, buttonVariants } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { PRODUCTION_QA_TERMS } from "../../../lib/productionQaTerminology";
import { isGreenLevelProductionEntry } from "../../../lib/greenLevelProductionExecution";

export type ProductionRecentEntryRow = {
  id: number;
  producedQty: string;
  date: string;
  orderType?: string;
  salesOrder?: { orderType?: string };
  workflowStatus?: string;
  qcPendingQty?: number;
  workOrderLine: {
    id: number;
    fgItem: { itemName: string };
    workOrder: {
      id: number;
      salesOrderId: number;
      cycleId?: number | null;
      cycle?: { cycleNo?: number | null } | null;
      orderType?: string;
      salesOrder?: { orderType?: string };
    };
  };
};

function prodEntryOrderTypeRaw(e: ProductionRecentEntryRow): string {
  const pick = [e.orderType, e.salesOrder?.orderType, e.workOrderLine?.workOrder?.salesOrder?.orderType].find(
    (v) => v != null && String(v).trim() !== "",
  );
  return pick != null ? String(pick).trim() : "";
}

function isDraft(e: ProductionRecentEntryRow): boolean {
  return (e.workflowStatus ?? "APPROVED") === "DRAFT";
}

function isApproved(e: ProductionRecentEntryRow): boolean {
  return (e.workflowStatus ?? "APPROVED") === "APPROVED";
}

function qcCompleted(e: ProductionRecentEntryRow): boolean {
  if (!isApproved(e)) return false;
  const pending = Number(e.qcPendingQty ?? NaN);
  return Number.isFinite(pending) && pending <= 1e-6;
}

function qcPendingEntry(e: ProductionRecentEntryRow): boolean {
  return isApproved(e) && !qcCompleted(e);
}

function reversibleProductionQty(e: ProductionRecentEntryRow): number {
  const pq = Number(e.producedQty);
  return Number.isFinite(pq) ? Math.max(0, pq) : 0;
}

function canOfferProductionReverse(r: ProductionRecentEntryRow, isAdminUser: boolean): boolean {
  if (!isAdminUser || !isApproved(r) || qcCompleted(r)) return false;
  return reversibleProductionQty(r) > 1e-6;
}

type Props = {
  embedded?: boolean;
  navigateNoQtyContext: boolean;
  navigateGreenLevelContext?: boolean;
  fromNoQtySo: boolean;
  focusSoIdValid: boolean;
  effectiveNoQtyCycleId: number | null;
  visibleEntries: ProductionRecentEntryRow[];
  entryFilter: "ALL" | "DRAFT" | "APPROVED";
  onEntryFilterChange: (value: "ALL" | "DRAFT" | "APPROVED") => void;
  workOrdersCount: number;
  showProductionWorkspace?: boolean;
  canProd: boolean;
  rowBusy: number | null;
  suppressDuplicateQcWorkflowUi: boolean;
  canOpenQaFromProduction: boolean;
  showCompactDraftApprovalStrip: boolean;
  latestDraftForSelectedWo: { latest: ProductionRecentEntryRow } | null;
  isAdmin: boolean;
  onOpenEdit: (row: ProductionRecentEntryRow) => void;
  onApproveDraft: (id: number) => void;
  onDeleteDraft: (id: number) => void;
  qcEntryHrefForEntry: (row: ProductionRecentEntryRow) => string;
  onOpenReverse: (row: ProductionRecentEntryRow) => void;
  renderApproveButtonLabel: (id: number, fallback: string, compact?: boolean) => string;
  containedScroll?: boolean;
  className?: string;
};

export function ProductionRecentEntriesPanel({
  embedded = false,
  navigateNoQtyContext,
  navigateGreenLevelContext = false,
  fromNoQtySo,
  focusSoIdValid,
  effectiveNoQtyCycleId,
  visibleEntries,
  entryFilter,
  onEntryFilterChange,
  workOrdersCount,
  showProductionWorkspace = false,
  canProd,
  rowBusy,
  suppressDuplicateQcWorkflowUi,
  canOpenQaFromProduction,
  showCompactDraftApprovalStrip,
  latestDraftForSelectedWo,
  isAdmin,
  onOpenEdit,
  onApproveDraft,
  onDeleteDraft,
  qcEntryHrefForEntry,
  onOpenReverse,
  renderApproveButtonLabel,
  containedScroll = true,
  className,
}: Props) {
  const hardenedProductionContext = navigateNoQtyContext || navigateGreenLevelContext;
  const cycleScoped =
    navigateNoQtyContext && focusSoIdValid && effectiveNoQtyCycleId != null
      ? visibleEntries.filter(
          (r) => Number(r.workOrderLine?.workOrder?.cycleId ?? 0) === Number(effectiveNoQtyCycleId),
        )
      : visibleEntries;
  const older =
    navigateNoQtyContext && focusSoIdValid && effectiveNoQtyCycleId != null
      ? visibleEntries.filter(
          (r) => Number(r.workOrderLine?.workOrder?.cycleId ?? 0) !== Number(effectiveNoQtyCycleId),
        )
      : [];

  const panelScrollsInternally =
    containedScroll && (embedded || hardenedProductionContext || showProductionWorkspace);

  const table = (rowsToShow: ProductionRecentEntryRow[]) => {
    const rowsOrdered = navigateNoQtyContext
      ? rowsToShow
      : [...rowsToShow].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (!rowsOrdered.length) {
      return (
        <p className={cn("leading-snug text-slate-600", embedded ? "px-1 py-2 text-[12px]" : "text-xs")}>
          {workOrdersCount === 0 ? "Create a work order to begin production." : "No production entries yet."}
        </p>
      );
    }
    return (
      <div
        className={cn(
          "rounded-md border border-slate-200",
          panelScrollsInternally ? "min-h-0 overflow-auto overscroll-contain" : "overflow-x-auto",
        )}
      >
        <table className="table-fixed w-full min-w-[720px] border-collapse text-[12px]">
          <colgroup>
            <col className="w-[100px]" />
            {navigateNoQtyContext ? <col className="w-[64px]" /> : <col className="w-[64px]" />}
            <col className="w-[64px]" />
            <col className="w-[140px]" />
            <col className="w-[88px]" />
            <col className="w-[80px]" />
            <col className="w-[96px]" />
            <col className="w-[11rem]" />
          </colgroup>
          <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <th className="px-2 py-1.5 text-left">Date</th>
              {navigateNoQtyContext || navigateGreenLevelContext ? null : (
                <th className="px-1 py-1.5 text-center">WO</th>
              )}
              {navigateNoQtyContext ? <th className="px-1 py-1.5 text-center">Cycle</th> : null}
              <th className="px-1 py-1.5 text-center">{navigateGreenLevelContext ? "Source" : "SO"}</th>
              <th className="min-w-0 px-2 py-1.5 text-left">Item</th>
              <th className="px-1 py-1.5 text-center">Type</th>
              <th className="px-2 py-1.5 text-right">Produced</th>
              <th className="px-1 py-1.5 text-center">Status</th>
              <th className="px-1 py-1.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rowsOrdered.map((r, idx) => {
              const rawType = prodEntryOrderTypeRaw(r);
              return (
                <tr
                  key={r.id}
                  className={cn(
                    "border-b border-slate-100 hover:bg-slate-50/90",
                    idx === 0 && isDraft(r) && "bg-amber-50/60",
                  )}
                >
                  <td className="whitespace-nowrap px-2 py-2 align-middle tabular-nums text-slate-700">
                    {new Date(r.date).toLocaleDateString()}
                  </td>
                  {navigateNoQtyContext ? null : navigateGreenLevelContext ? null : (
                    <td className="px-1 py-1.5 text-center align-middle tabular-nums">#{r.workOrderLine.workOrder.id}</td>
                  )}
                  {navigateNoQtyContext ? (
                    <td className="px-1 py-1.5 text-center align-middle tabular-nums">
                      {r.workOrderLine.workOrder.cycle?.cycleNo != null
                        ? Number(r.workOrderLine.workOrder.cycle.cycleNo)
                        : "—"}
                    </td>
                  ) : null}
                  <td className="px-1 py-1.5 text-center align-middle tabular-nums">
                    {isGreenLevelProductionEntry(r) || navigateGreenLevelContext
                      ? "Stock"
                      : `#${r.workOrderLine.workOrder.salesOrderId}`}
                  </td>
                  <td className="min-w-0 px-2 py-1.5 align-middle">
                    <div className="truncate font-medium text-slate-800" title={r.workOrderLine.fgItem.itemName}>
                      {r.workOrderLine.fgItem.itemName}
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-center align-middle">
                    {!rawType ? (
                      <span className="text-[11px] text-slate-400">—</span>
                    ) : rawType === "NO_QTY" ? (
                      <Badge className="border-violet-200 bg-violet-50 px-1.5 py-0 text-[9px] font-semibold uppercase text-violet-800">
                        NO_QTY
                      </Badge>
                    ) : rawType === "NORMAL" ? (
                      <Badge variant="info" className="px-1.5 py-0 text-[9px] font-semibold uppercase">
                        REGULAR
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-slate-500">{rawType}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right align-middle font-bold tabular-nums text-slate-900">
                    {Number(r.producedQty)}
                  </td>
                  <td className="px-1 py-1.5 text-center align-middle">
                    {isDraft(r) ? (
                      <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                        Draft
                      </Badge>
                    ) : qcCompleted(r) ? (
                      <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                        QC Done
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                        Pending QC
                      </Badge>
                    )}
                  </td>
                  <td className="px-1 py-2 text-right align-top">
                    {canProd && isDraft(r) ? (
                      showCompactDraftApprovalStrip &&
                      latestDraftForSelectedWo &&
                      r.id === latestDraftForSelectedWo.latest.id ? (
                        <span className="text-[10px] text-slate-400">—</span>
                      ) : (
                        <div className="erp-table-actions">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-1.5 text-[10px]"
                            disabled={rowBusy === r.id}
                            onClick={() => onOpenEdit(r)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-7 px-1.5 text-[10px]"
                            disabled={rowBusy === r.id}
                            onClick={() => onApproveDraft(r.id)}
                          >
                            {renderApproveButtonLabel(r.id, "Approve", true)}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="h-7 px-1.5 text-[10px]"
                            disabled={rowBusy === r.id}
                            onClick={() => onDeleteDraft(r.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      )
                    ) : isApproved(r) && qcPendingEntry(r) ? (
                      <div className="flex flex-col items-end gap-1">
                        {!suppressDuplicateQcWorkflowUi && canOpenQaFromProduction ? (
                          <Link
                            to={qcEntryHrefForEntry(r)}
                            className={cn(
                              buttonVariants({ variant: "secondary", size: "sm" }),
                              "inline-flex h-7 items-center justify-center px-1.5 text-[10px]",
                            )}
                          >
                            {PRODUCTION_QA_TERMS.COMPLETE_QA}
                          </Link>
                        ) : !suppressDuplicateQcWorkflowUi ? (
                          <span className="text-[10px] font-medium text-slate-600">
                            {PRODUCTION_QA_TERMS.WAITING_FOR_QA}
                          </span>
                        ) : null}
                        {canOfferProductionReverse(r, isAdmin) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 border-slate-300 px-1.5 text-[10px] font-normal text-slate-600"
                            disabled={rowBusy === r.id}
                            onClick={() => onOpenReverse(r)}
                          >
                            {rowBusy === r.id ? "…" : "Reverse"}
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Card
      className={cn(
        "erp-op-workspace-secondary min-w-0 overflow-hidden",
        panelScrollsInternally && "flex min-h-0 flex-1 flex-col",
        embedded && "border-slate-200/95 shadow-[0_2px_10px_0_rgb(15_23_42_/0.06)]",
        className,
      )}
      data-testid={embedded ? "production-recent-entries-embedded" : "production-recent-entries-panel"}
    >
      <CardHeader className={cn("shrink-0 border-b border-slate-100/80 bg-slate-50/90 px-3", embedded ? "py-2.5" : "py-1.5")}>
        <CardTitle className={cn("font-semibold text-slate-800", embedded ? "text-[13px] tracking-tight" : "text-[12px] text-slate-600")}>
          {embedded ? "Recent entries" : showProductionWorkspace ? "Recent Production Entries" : "Production entries"}
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          panelScrollsInternally
            ? "flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2"
            : "space-y-2 px-3 py-2",
        )}
      >
        <div className={cn("shrink-0", embedded ? "mb-1.5" : "border-b border-slate-100 px-0 py-1")}>
          <label className="grid gap-1 text-[12px] font-semibold text-slate-700">
            Show
            <select
              className="erp-flow-filter-input h-8 w-full max-w-[8rem] rounded-md border border-slate-200 bg-white px-2 text-[13px]"
              value={entryFilter}
              onChange={(e) => onEntryFilterChange(e.target.value as typeof entryFilter)}
            >
              <option value="ALL">All</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Posted (QC)</option>
            </select>
          </label>
        </div>
        <div
          className={cn(
            panelScrollsInternally
              ? "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
              : "space-y-2 px-0",
          )}
        >
          {fromNoQtySo && focusSoIdValid ? (
            <div className="mb-1 text-[12px] font-semibold text-slate-700">Current cycle</div>
          ) : null}
          {table(cycleScoped)}
          {fromNoQtySo && focusSoIdValid && older.length > 0 ? (
            <details className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
              <summary className="cursor-pointer text-[12px] font-medium text-slate-700">
                Older history ({older.length})
              </summary>
              <div className="mt-2">{table(older)}</div>
            </details>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
