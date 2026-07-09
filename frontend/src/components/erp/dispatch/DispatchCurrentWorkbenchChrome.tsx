/**
 * Presentation-only Current Dispatch chrome (FT-PD-066 Workbench).
 * Does not change FIFO, stock, billing, or audit APIs — display helpers only.
 */
import * as React from "react";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { DispatchBillingStatusBadge } from "../DispatchBillingStatusBadge";
import type { DispatchBillingStatusInput } from "../../../lib/dispatchBillingStatus";

export type DispatchAllocationSlice = {
  cycleNo: number | null;
  qty: number;
  label?: string;
};

export type DispatchWorkbenchGuidance = {
  currentAction: string;
  nextAction: string;
};

export type DispatchCurrentWorkbenchChromeProps = {
  soBalance: number;
  usableFg: number;
  dispatchingNow: number;
  remainingAfter: number;
  formatQty: (n: number) => string;
  billingRow?: DispatchBillingStatusInput | null;
  /** When no finalized row yet — e.g. draft open. */
  billingFallbackLabel?: string | null;
  allocationSlices?: DispatchAllocationSlice[];
  guidance: DispatchWorkbenchGuidance;
  /** Primary finalize (only default button in this chrome). */
  showFinalize?: boolean;
  finalizeDisabled?: boolean;
  finalizeTitle?: string;
  finalizeLabel?: string;
  onFinalize?: () => void;
  showEditDraft?: boolean;
  onEditDraft?: () => void;
  editDraftLabel?: string;
  showDiscard?: boolean;
  discardDisabled?: boolean;
  onDiscard?: () => void;
  discardLabel?: string;
  className?: string;
  children?: React.ReactNode;
};

function KpiCell({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: "emerald" | "amber" | "slate";
}) {
  const valueCls =
    emphasize === "emerald"
      ? "text-emerald-900"
      : emphasize === "amber"
        ? "text-amber-950"
        : "text-slate-900";
  return (
    <div className="min-w-0 flex-1 basis-[5.5rem]">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-0.5 text-lg font-bold leading-none tabular-nums sm:text-xl", valueCls)}>{value}</div>
    </div>
  );
}

export function DispatchCurrentWorkbenchChrome({
  soBalance,
  usableFg,
  dispatchingNow,
  remainingAfter,
  formatQty,
  billingRow,
  billingFallbackLabel,
  allocationSlices = [],
  guidance,
  showFinalize,
  finalizeDisabled,
  finalizeTitle,
  finalizeLabel = "Finalize Dispatch",
  onFinalize,
  showEditDraft,
  onEditDraft,
  editDraftLabel = "Edit Draft Qty",
  showDiscard,
  discardDisabled,
  onDiscard,
  discardLabel = "Discard Draft",
  className,
  children,
}: DispatchCurrentWorkbenchChromeProps) {
  const allocRef = React.useRef<HTMLDetailsElement | null>(null);
  const meaningfulSlices = allocationSlices.filter((s) => Number(s.qty) > 1e-9);
  const showAllocation = meaningfulSlices.length > 0;

  return (
    <div className={cn("space-y-2", className)} data-testid="dispatch-current-workbench">
      <div
        className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
        data-testid="dispatch-current-kpi-strip"
      >
        <KpiCell label="SO Balance" value={formatQty(soBalance)} emphasize="amber" />
        <KpiCell label="Usable FG" value={formatQty(usableFg)} />
        <KpiCell label="Dispatching Now" value={formatQty(dispatchingNow)} emphasize="emerald" />
        <KpiCell label="Remaining After" value={formatQty(remainingAfter)} emphasize="amber" />
        <div className="min-w-0 flex-1 basis-[7rem]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Billing Status</div>
          <div className="mt-1">
            {billingRow ? (
              <DispatchBillingStatusBadge row={billingRow} />
            ) : billingFallbackLabel ? (
              <span className="inline-flex rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                {billingFallbackLabel}
              </span>
            ) : (
              <span className="text-[12px] text-slate-500">—</span>
            )}
          </div>
        </div>
      </div>

      {children}

      {showAllocation ? (
        <details
          ref={allocRef}
          className="overflow-hidden rounded-md border border-slate-200 bg-white"
          data-testid="dispatch-allocation-details"
        >
          <summary className="cursor-pointer list-none px-3 py-2 text-[12px] font-semibold text-slate-800 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
            ▼ Allocation Details
            <span className="ml-2 text-[11px] font-normal text-slate-500">
              (FIFO sources — internal)
            </span>
          </summary>
          <div className="space-y-2 border-t border-slate-100 px-3 py-2.5">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Dispatch Qty</div>
              <div className="text-xl font-bold tabular-nums text-emerald-900">
                {formatQty(dispatchingNow)}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold text-slate-700">Allocated From</div>
              <ul className="space-y-1">
                {meaningfulSlices.map((s, i) => (
                  <li
                    key={`${s.cycleNo ?? "x"}-${i}`}
                    className="flex items-baseline justify-between gap-3 text-[13px]"
                  >
                    <span className="font-medium text-slate-800">
                      {s.label ??
                        (s.cycleNo != null && Number.isFinite(s.cycleNo)
                          ? `Cycle ${s.cycleNo}`
                          : "Source")}
                    </span>
                    <span className="font-bold tabular-nums text-slate-900">{formatQty(s.qty)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      ) : null}

      {(showFinalize || showEditDraft || showDiscard || showAllocation) && (
        <div
          className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2"
          data-testid="dispatch-current-actions"
        >
          {showFinalize ? (
            <Button
              type="button"
              size="sm"
              className="font-semibold"
              data-testid="prepared-dispatch-finalize-btn"
              disabled={finalizeDisabled}
              title={finalizeTitle}
              onClick={() => onFinalize?.()}
            >
              {finalizeLabel}
            </Button>
          ) : null}
          {showEditDraft ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="font-semibold"
              data-testid="prepared-dispatch-edit-draft-btn"
              onClick={() => onEditDraft?.()}
            >
              {editDraftLabel}
            </Button>
          ) : null}
          {showDiscard ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="font-semibold text-slate-800"
              data-testid="prepared-dispatch-delete-btn"
              disabled={discardDisabled}
              onClick={() => onDiscard?.()}
            >
              {discardLabel}
            </Button>
          ) : null}
          {showAllocation ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="font-medium text-slate-700"
              data-testid="dispatch-view-allocation-btn"
              onClick={() => {
                const el = allocRef.current;
                if (!el) return;
                el.open = true;
                el.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }}
            >
              View Allocation
            </Button>
          ) : null}
        </div>
      )}

      <div
        className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2"
        data-testid="dispatch-workflow-guidance"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Current Action</div>
            <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{guidance.currentAction}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Next Action</div>
            <div className="mt-0.5 text-[13px] font-semibold text-emerald-900">{guidance.nextAction}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
