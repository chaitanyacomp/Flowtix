import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Badge } from "../../ui/badge";
import { Button, buttonVariants } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { PRODUCTION_QA_TERMS } from "../../../lib/productionQaTerminology";
import { isGreenLevelProductionEntry } from "../../../lib/greenLevelProductionExecution";
import { displaySalesOrderNo, displayWorkOrderNo } from "../../../lib/docNoDisplay";
import { formatFgQuantity } from "../../../lib/quantityDisplay";

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
    fgItem: { itemName: string; unit?: string };
    workOrder: {
      id: number;
      salesOrderId: number;
      cycleId?: number | null;
      cycle?: { cycleNo?: number | null } | null;
      docNo?: string | null;
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
  /** Default CURRENT_WO — do not mix sibling WO entries into the runner history. */
  recentEntriesScope?: "CURRENT_WO" | "GLOBAL";
  onRecentEntriesScopeChange?: (value: "CURRENT_WO" | "GLOBAL") => void;
  showRecentEntriesScopeToggle?: boolean;
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
  /** FT-PD-066 — Time · Qty · Status beside operator entry form */
  operatorWorkbench?: boolean;
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
  recentEntriesScope = "CURRENT_WO",
  onRecentEntriesScopeChange,
  showRecentEntriesScopeToggle = false,
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
  operatorWorkbench = false,
  className,
}: Props) {
  const [expandedEntryId, setExpandedEntryId] = React.useState<number | null>(null);
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
    containedScroll && (embedded || hardenedProductionContext || showProductionWorkspace || operatorWorkbench);

  const operatorStatusLabel = (r: ProductionRecentEntryRow) => {
    if (isDraft(r)) return "Draft";
    if (qcCompleted(r)) return "QC done";
    return "Pending QC";
  };

  const operatorWorkbenchTable = (rowsToShow: ProductionRecentEntryRow[]) => {
    const rowsOrdered = [...rowsToShow]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 12);
    if (!rowsOrdered.length) {
      return (
        <p className="px-1 py-2 text-[11px] leading-snug text-slate-600">No production entries yet.</p>
      );
    }
    return (
      <div
        className={cn(
          "rounded border border-slate-200",
          panelScrollsInternally ? "max-h-[min(28vh,240px)] overflow-y-auto overscroll-contain" : "",
        )}
      >
        <table className="w-full table-fixed text-[11px]">
          <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
            <tr className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-1.5 py-1 text-left">Time</th>
              <th className="px-1.5 py-1 text-right">Qty</th>
              <th className="px-1.5 py-1 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rowsOrdered.map((r) => {
              const expanded = expandedEntryId === r.id;
              return (
                <React.Fragment key={r.id}>
                  <tr
                    className={cn(
                      "cursor-pointer border-b border-slate-100 hover:bg-slate-50/90",
                      expanded && "bg-slate-50",
                      isDraft(r) && "bg-amber-50/50",
                    )}
                    onClick={() => setExpandedEntryId(expanded ? null : r.id)}
                  >
                    <td className="whitespace-nowrap px-1.5 py-1 tabular-nums text-slate-700">
                      {new Date(r.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-1.5 py-1 text-right font-bold tabular-nums text-slate-900">
                      {formatFgQuantity(Number(r.producedQty), r.workOrderLine.fgItem.unit)}
                    </td>
                    <td className="px-1.5 py-1 text-[10px] font-medium text-slate-700">{operatorStatusLabel(r)}</td>
                  </tr>
                  {expanded ? (
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      <td colSpan={3} className="px-1.5 py-1.5">
                        <div className="space-y-1 text-[10px] text-slate-600">
                          <div>{new Date(r.date).toLocaleDateString()}</div>
                          <div className="truncate font-medium text-slate-800">{r.workOrderLine.fgItem.itemName}</div>
                          {canProd && isDraft(r) ? (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              <Button type="button" size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={rowBusy === r.id} onClick={() => onOpenEdit(r)}>
                                Edit
                              </Button>
                              <Button type="button" size="sm" variant="secondary" className="h-6 px-1.5 text-[10px]" disabled={rowBusy === r.id} onClick={() => onApproveDraft(r.id)}>
                                {renderApproveButtonLabel(r.id, "Review & Finalize", true)}
                              </Button>
                              <Button type="button" size="sm" variant="destructive" className="h-6 px-1.5 text-[10px]" disabled={rowBusy === r.id} onClick={() => onDeleteDraft(r.id)}>
                                Delete
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

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
                    <td className="px-1 py-1.5 text-center align-middle tabular-nums">
                      {displayWorkOrderNo(r.workOrderLine.workOrder.id, r.workOrderLine.workOrder.docNo)}
                    </td>
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
                      : displaySalesOrderNo(r.workOrderLine.workOrder.salesOrderId, null)}
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
                    {formatFgQuantity(Number(r.producedQty), r.workOrderLine.fgItem.unit)}
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
                            {renderApproveButtonLabel(r.id, "Review & Finalize", true)}
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

  if (operatorWorkbench) {
    return (
      <div
        className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}
        data-testid="production-recent-entries-mes-panel"
      >
        <div className="mb-1.5 shrink-0">
          <select
            className="h-7 w-full rounded border border-slate-300 bg-white px-2 text-[11px]"
            value={entryFilter}
            onChange={(e) => onEntryFilterChange(e.target.value as typeof entryFilter)}
            aria-label="Filter entries"
          >
            <option value="ALL">All entries</option>
            <option value="DRAFT">Draft</option>
            <option value="APPROVED">Posted</option>
          </select>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{operatorWorkbenchTable(cycleScoped)}</div>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "erp-op-workspace-secondary min-w-0 overflow-hidden",
        panelScrollsInternally && "flex min-h-0 flex-1 flex-col",
        embedded && "border-slate-200/95 shadow-[0_2px_10px_0_rgb(15_23_42_/0.06)]",
        operatorWorkbench && "max-w-[13.5rem] border-slate-200/90 shadow-sm",
        className,
      )}
      data-testid={embedded ? "production-recent-entries-embedded" : "production-recent-entries-panel"}
    >
      <CardHeader className={cn("shrink-0 border-b border-slate-100/80 bg-slate-50/90 px-2", operatorWorkbench ? "py-1" : embedded ? "py-2.5" : "py-1.5")}>
        <CardTitle className={cn("font-semibold text-slate-800", operatorWorkbench ? "text-[11px]" : embedded ? "text-[13px] tracking-tight" : "text-[12px] text-slate-600")}>
          {operatorWorkbench ? "Recent entries" : embedded ? "Recent entries" : showProductionWorkspace ? "Recent Production Entries" : "Production entries"}
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          panelScrollsInternally
            ? "flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1"
            : "space-y-2 px-3 py-2",
        )}
      >
        {!operatorWorkbench ? (
        <div className={cn("shrink-0 space-y-1.5", embedded ? "mb-1.5" : "border-b border-slate-100 px-0 py-1")}>
          {showRecentEntriesScopeToggle && onRecentEntriesScopeChange ? (
            <label className="grid gap-1 text-[12px] font-semibold text-slate-700">
              History scope
              <select
                className="erp-flow-filter-input h-8 w-full max-w-[14rem] rounded-md border border-slate-200 bg-white px-2 text-[13px]"
                value={recentEntriesScope}
                onChange={(e) =>
                  onRecentEntriesScopeChange(e.target.value as "CURRENT_WO" | "GLOBAL")
                }
                aria-label="Recent entries history scope"
              >
                <option value="CURRENT_WO">This work order only</option>
                <option value="GLOBAL">All WOs in loaded history</option>
              </select>
            </label>
          ) : null}
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
        ) : (
          <div className="mb-1 shrink-0">
            <select
              className="erp-flow-filter-input h-7 w-full rounded border border-slate-200 bg-white px-1.5 text-[11px]"
              value={entryFilter}
              onChange={(e) => onEntryFilterChange(e.target.value as typeof entryFilter)}
              aria-label="Filter entries"
            >
              <option value="ALL">All</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Posted</option>
            </select>
          </div>
        )}
        <div
          className={cn(
            panelScrollsInternally
              ? "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1"
              : "space-y-2 px-0",
          )}
        >
          {fromNoQtySo && focusSoIdValid && !operatorWorkbench ? (
            <div className="mb-1 text-[12px] font-semibold text-slate-700">Current cycle</div>
          ) : null}
          {operatorWorkbench ? operatorWorkbenchTable(cycleScoped) : table(cycleScoped)}
          {fromNoQtySo && focusSoIdValid && older.length > 0 && !operatorWorkbench ? (
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
