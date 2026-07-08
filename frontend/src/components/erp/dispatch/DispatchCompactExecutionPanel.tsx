import * as React from "react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { ERPBackNavigation } from "../foundation/ERPBackNavigation";
import {
  OperatorMainSplit,
  operatorTableRowCompactClass,
} from "../OperatorWorkbench";
import { cn } from "../../../lib/utils";
import {
  formatDispatchCompactQty,
  buildDispatchSoCompleteMessage,
  type DispatchCompactQueueRow,
} from "../../../lib/dispatchWorkspaceUx";

/** Queue viewport — independent scroll; supports 30+ FG rows without page scroll. */
const DISPATCH_COMPACT_QUEUE_MAX_H = "max-h-[min(360px,42vh)] lg:max-h-none";

export type DispatchCompactExecutionPanelProps = {
  soLabel: string;
  customerName: string;
  totalReadyQty: number;
  itemCount: number;
  queue: DispatchCompactQueueRow[];
  selectedItemId: number | null;
  activeItemName: string | null;
  activeOriginalReadyQty: number;
  activeDraftQty: number;
  activeRemainingQty: number;
  activeStatusLabel: string;
  dispatchQtyStr: string;
  isPartialMode: boolean;
  dispatching: boolean;
  canDispatchFull: boolean;
  canDispatchPartial: boolean;
  dispatchReadOnly?: boolean;
  primaryFinalizeDraftId?: number | null;
  draftSavedIdle?: boolean;
  lockingId?: number | null;
  deletingId?: number | null;
  /** Batch 2D — when false, backend `draftLockEligibility` blocks finalize (display only). */
  canFinalizeDraft?: boolean;
  finalizeDraftBlockedReason?: string | null;
  error?: string | null;
  info?: string | null;
  onSelectItem: (itemId: number) => void;
  onDispatchQtyChange: (value: string) => void;
  onDispatchFull: () => void;
  onDispatchPartial: () => void;
  onEnablePartial: () => void;
  onDisablePartial: () => void;
  onFinalizeDraft?: () => void;
  onDeleteDraft?: () => void;
};

export function DispatchCompactExecutionPanel({
  soLabel,
  customerName,
  totalReadyQty,
  itemCount,
  queue,
  selectedItemId,
  activeItemName,
  activeOriginalReadyQty,
  activeDraftQty,
  activeRemainingQty,
  activeStatusLabel,
  dispatchQtyStr,
  isPartialMode,
  dispatching,
  canDispatchFull,
  canDispatchPartial,
  dispatchReadOnly = false,
  primaryFinalizeDraftId,
  draftSavedIdle = false,
  lockingId,
  deletingId,
  canFinalizeDraft = true,
  finalizeDraftBlockedReason,
  error,
  info,
  onSelectItem,
  onDispatchQtyChange,
  onDispatchFull,
  onDispatchPartial,
  onEnablePartial,
  onDisablePartial,
  onFinalizeDraft,
  onDeleteDraft,
}: DispatchCompactExecutionPanelProps) {
  const queueEmpty = queue.length === 0;
  const hasOpenDraft = primaryFinalizeDraftId != null && primaryFinalizeDraftId > 0 && activeDraftQty > 1e-9;

  return (
    <div className="flex flex-col gap-2" data-testid="dispatch-compact-execution">
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] text-slate-800">
          <span className="font-mono font-semibold text-slate-900">{soLabel}</span>
          <span className="text-slate-400" aria-hidden>
            |
          </span>
          <span className="font-medium text-slate-700">{customerName || "—"}</span>
          <span className="text-slate-400" aria-hidden>
            |
          </span>
          <span>
            Dispatchable qty{" "}
            <span className="font-semibold tabular-nums text-emerald-900">{formatDispatchCompactQty(totalReadyQty)}</span>
          </span>
          <span className="text-slate-400" aria-hidden>
            |
          </span>
          <span>
            Items <span className="font-semibold tabular-nums">{itemCount}</span>
          </span>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">{error}</div>
      ) : null}

      {queueEmpty ? (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 shadow-sm"
          data-testid="dispatch-compact-complete"
        >
          <div className="text-[14px] font-semibold leading-snug text-emerald-950">
            {buildDispatchSoCompleteMessage(soLabel)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ERPBackNavigation defaultTo="/pending-actions" defaultLabel="Back to Pending Actions" />
          </div>
        </div>
      ) : (
        <OperatorMainSplit
          balancedWorkbench
          className="lg:max-h-[min(calc(100dvh-9.5rem),32rem)] lg:min-h-0"
          panelClassName="!p-2.5 min-h-0 h-full"
          queue={
            <div
              className="flex min-h-0 flex-col gap-1 lg:h-full lg:min-h-0"
              data-testid="dispatch-compact-queue-pane"
            >
              <div className="flex items-center justify-between gap-2 px-0.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Dispatch queue</h2>
                <span className="text-[10px] font-medium tabular-nums text-slate-500">{queue.length} items</span>
              </div>
              <div
                className={cn(
                  "min-h-0 flex-1 overflow-auto rounded-md border border-slate-200/80 bg-white",
                  DISPATCH_COMPACT_QUEUE_MAX_H,
                  queue.length > 8 ? "lg:overflow-y-auto" : "",
                )}
              >
                <table className="w-full text-left text-[12px]">
                  <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                    <tr className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1.5 font-medium">Item</th>
                      <th className="px-2 py-1.5 text-right font-medium">Dispatchable</th>
                      <th className="px-2 py-1.5 text-right font-medium">Draft</th>
                      <th className="px-2 py-1.5 text-right font-medium">Dispatched</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((row) => {
                      const selected = selectedItemId != null && row.itemId === selectedItemId;
                      return (
                        <tr
                          key={row.itemId}
                          className={cn(
                            "cursor-pointer border-t border-slate-100 transition-colors",
                            operatorTableRowCompactClass,
                            selected
                              ? "bg-emerald-50/90 ring-1 ring-inset ring-emerald-300/80"
                              : "hover:bg-slate-50/80",
                          )}
                          onClick={() => onSelectItem(row.itemId)}
                          data-testid={`dispatch-compact-queue-row-${row.itemId}`}
                        >
                          <td className="max-w-[10rem] truncate px-2 py-1 font-medium text-slate-900" title={row.itemName}>
                            {row.itemName}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums font-semibold text-emerald-900">
                            {formatDispatchCompactQty(row.readyQty)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-amber-900">
                            {formatDispatchCompactQty(row.draftQty)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-700">
                            {formatDispatchCompactQty(row.dispatchedQty)}
                          </td>
                          <td className="px-2 py-1 text-slate-700">{row.statusLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          }
          panel={
            <div className="flex min-h-0 flex-col" data-testid="dispatch-compact-active-pane">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Active dispatch</h2>
              {info ? (
                <p className="mt-1 whitespace-pre-line text-[11px] leading-snug text-sky-900">{info}</p>
              ) : null}
              {activeItemName ? (
                <div className="mt-2 space-y-3">
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-500">Item</div>
                    <div className="font-semibold text-slate-900">{activeItemName}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="space-y-1">
                      <div className="text-[11px] text-slate-500">Allocated to SO</div>
                      <div className="font-semibold tabular-nums text-slate-900">
                        {formatDispatchCompactQty(activeOriginalReadyQty)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] text-slate-500">Draft</div>
                      <div className="font-semibold tabular-nums text-amber-900">
                        {formatDispatchCompactQty(activeDraftQty)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] text-slate-500">Dispatchable qty</div>
                      <div className="font-semibold tabular-nums text-emerald-900">
                        {formatDispatchCompactQty(activeRemainingQty)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] text-slate-500">Status</div>
                      <div className="font-semibold text-slate-800">{activeStatusLabel}</div>
                    </div>
                  </div>

                  {hasOpenDraft ? (
                    <div
                      className="space-y-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-2.5"
                      data-testid="dispatch-compact-draft-banner"
                    >
                      <div className="text-[12px] font-semibold text-amber-950">Dispatch draft saved</div>
                      {!canFinalizeDraft && finalizeDraftBlockedReason ? (
                        <p className="text-[11px] leading-snug text-amber-900/95">
                          Finalize blocked: {finalizeDraftBlockedReason}
                        </p>
                      ) : null}
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100/80"
                          disabled={dispatchReadOnly || deletingId === primaryFinalizeDraftId}
                          onClick={() => onDeleteDraft?.()}
                          data-testid="dispatch-compact-delete-draft"
                        >
                          {deletingId === primaryFinalizeDraftId ? "Deleting…" : "Delete draft"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            lockingId === primaryFinalizeDraftId || dispatchReadOnly || !canFinalizeDraft
                          }
                          title={!canFinalizeDraft ? finalizeDraftBlockedReason ?? undefined : undefined}
                          onClick={() => onFinalizeDraft?.()}
                          data-testid="dispatch-compact-finalize-draft"
                        >
                          {lockingId === primaryFinalizeDraftId ? "Finalizing…" : "Finalize dispatch"}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <label className="text-[11px] font-medium text-slate-600" htmlFor="dispatch-compact-qty">
                      {hasOpenDraft ? "Edit dispatch qty" : "Dispatch qty"}
                    </label>
                    <Input
                      id="dispatch-compact-qty"
                      className="mt-1 h-9 max-w-full tabular-nums"
                      value={dispatchQtyStr}
                      disabled={dispatchReadOnly || dispatching}
                      onChange={(e) => onDispatchQtyChange(e.target.value)}
                    />
                  </div>

                  {!draftSavedIdle ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button
                        type="button"
                        className="sm:min-w-[8.5rem]"
                        disabled={dispatchReadOnly || dispatching || !canDispatchFull}
                        onClick={onDispatchFull}
                        data-testid="dispatch-compact-full"
                      >
                        {dispatching ? "Saving…" : hasOpenDraft ? "Update draft" : "Dispatch Full"}
                      </Button>
                      {isPartialMode ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            className="sm:min-w-[8.5rem]"
                            disabled={dispatchReadOnly || dispatching || !canDispatchPartial}
                            onClick={onDispatchPartial}
                            data-testid="dispatch-compact-partial"
                          >
                            Dispatch Partial
                          </Button>
                          <button
                            type="button"
                            className="text-[12px] font-medium text-slate-600 underline underline-offset-2"
                            onClick={onDisablePartial}
                          >
                            Cancel partial
                          </button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          className="sm:min-w-[8.5rem]"
                          disabled={dispatchReadOnly || dispatching || !canDispatchFull}
                          onClick={onEnablePartial}
                        >
                          Partial dispatch
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12px] text-amber-950/90">
                      Draft is saved for the full dispatchable quantity. Finalize dispatch or delete the draft to continue.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-slate-600">Select an item from the queue.</p>
              )}
            </div>
          }
        />
      )}
    </div>
  );
}
