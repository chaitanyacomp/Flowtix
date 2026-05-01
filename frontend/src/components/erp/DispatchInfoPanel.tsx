import { cn } from "../../lib/utils";
import { StatBlock } from "./StatBlock";

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

type Props = {
  className?: string;
  /** Usable FG on hand for this SKU (same basis as Stock screen). */
  totalStock: number;
  /** Gross QC accepted for this sales order + FG item (informational). */
  qcApprovedStock: number;
  /** FG in QC / rework buckets for this SKU (global). */
  inQcReworkQty: number;
  /** Operational SO line remaining (draft + locked attribution). */
  soRemaining: number;
  orderQty: number;
  dispatchedQty: number;
  pendingQty: number;
  dispatchableQty: number;
  existingDraftQty: number;
  /** Parsed draft from input when valid; for over-capacity warning */
  draftEntryQty: number | null;
  /** Server hint when backlog exists but nothing can ship */
  dispatchBlockedReason?: string | null;
  isReplacementOrder?: boolean;
};

/**
 * Read-only dispatch context (compact StatBlocks). Mirrors Dispatch page vocabulary.
 */
export function DispatchInfoPanel({
  className,
  totalStock,
  qcApprovedStock,
  inQcReworkQty,
  soRemaining,
  orderQty,
  dispatchedQty,
  pendingQty,
  dispatchableQty,
  existingDraftQty,
  draftEntryQty,
  dispatchBlockedReason,
  isReplacementOrder,
}: Props) {
  const warnings: string[] = [];
  if (dispatchableQty <= 1e-9 && pendingQty > 1e-9 && dispatchBlockedReason) {
    warnings.push(dispatchBlockedReason);
  } else if (dispatchableQty <= 1e-9 && pendingQty > 1e-9) {
    warnings.push("Nothing ready to ship for this line yet.");
  } else if (dispatchableQty <= 1e-9) {
    warnings.push("Nothing ready to ship.");
  }
  if (draftEntryQty != null && draftEntryQty > dispatchableQty + 1e-6) {
    warnings.push("Exceeds ready-to-ship quantity.");
  }

  const minDisplay = isReplacementOrder
    ? "Replacement: min(SO remaining, available stock)."
    : `min(operational remaining ${fmtQty(soRemaining)}, available ${fmtQty(totalStock)}) → ready ${fmtQty(dispatchableQty)}`;

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Stock and QC context"
      >
        <StatBlock label="Available stock" value={fmtQty(totalStock)} />
        <StatBlock label="QC approved (gross)" value={fmtQty(qcApprovedStock)} />
        <StatBlock label="In QC / rework" value={fmtQty(inQcReworkQty)} />
      </div>

      <div
        className="mt-2 flex flex-wrap gap-2 rounded border border-emerald-200 bg-emerald-50/90 px-2 py-1.5"
        role="group"
        aria-label="Ready to ship"
      >
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-900">Ready to ship</div>
          <div className="tabular-nums text-lg font-bold leading-tight text-emerald-950">{fmtQty(dispatchableQty)}</div>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] leading-snug text-slate-600">
        Ready to ship follows existing dispatch rules (not changed here).
        {!isReplacementOrder ? (
          <>
            {" "}
            <span className="font-medium text-slate-700">{minDisplay}</span>
          </>
        ) : null}
      </p>

      <div
        className="mt-2 flex flex-wrap gap-2"
        role="group"
        aria-label="Order quantities"
      >
        <StatBlock label="SO qty" value={fmtQty(orderQty)} />
        <StatBlock label="Confirmed dispatched" value={fmtQty(dispatchedQty)} />
        <StatBlock label="Remaining SO" value={fmtQty(pendingQty)} />
        <StatBlock label="Draft dispatch" value={fmtQty(existingDraftQty)} />
      </div>
      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs font-medium text-amber-900">
          {warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
