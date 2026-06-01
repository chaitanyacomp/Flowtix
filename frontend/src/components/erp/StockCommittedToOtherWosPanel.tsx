import { Link } from "react-router-dom";
import { cn } from "../../lib/utils";
import { buildRmControlCenterHref } from "../../lib/woProcurementContinuity";
import {
  buildStockCommitmentDisplayRows,
  isStockCommittedElsewhere,
  stockCommittedElsewhereHeadline,
  stockCommittedElsewhereSummary,
  type StockCommitmentSourceRow,
} from "../../lib/stockCommitmentVisibility";

type Props = {
  rmItemName?: string | null;
  unit?: string | null;
  physicalQty: number;
  freeQty: number;
  committedQty?: number | null;
  breakdown?: StockCommitmentSourceRow[];
  currentWorkOrderId?: number | null;
  rmItemId?: number | null;
  salesOrderId?: number | null;
  className?: string;
};

function fmtQty(value: number, unit?: string | null): string {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

export function StockCommittedToOtherWosPanel({
  rmItemName,
  unit,
  physicalQty,
  freeQty,
  committedQty,
  breakdown,
  currentWorkOrderId,
  rmItemId,
  salesOrderId,
  className,
}: Props) {
  if (!isStockCommittedElsewhere(physicalQty, freeQty)) return null;

  const rows = buildStockCommitmentDisplayRows(breakdown, currentWorkOrderId);
  const totalCommitted =
    committedQty != null && Number(committedQty) > 0
      ? Number(committedQty)
      : rows.reduce((s, r) => s + r.committedQty, 0);

  return (
    <section
      className={cn(
        "rounded-md border border-sky-300 bg-gradient-to-b from-sky-50/90 to-white px-3 py-2.5 shadow-sm",
        className,
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-sky-900">Where is my stock?</p>
      <h3 className="mt-0.5 text-sm font-extrabold text-sky-950">Stock committed to other work orders</h3>
      <p className="mt-1 text-xs font-medium leading-relaxed text-sky-950">
        {stockCommittedElsewhereHeadline(physicalQty, unit ?? undefined)}
      </p>
      {rmItemName ? (
        <p className="mt-1 text-[11px] text-slate-600">
          Item: <span className="font-semibold text-slate-800">{rmItemName}</span>
          {totalCommitted > 0 ? (
            <>
              {" "}
              · Committed elsewhere: <span className="font-bold tabular-nums">{fmtQty(totalCommitted, unit)}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-sky-200/80 bg-white px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-slate-950">{row.workOrderLabel}</p>
                {row.customerLabel ? (
                  <p className="text-[11px] font-medium text-slate-600">{row.customerLabel}</p>
                ) : null}
                <p className="mt-0.5 text-[11px] text-slate-600">
                  {row.pmrStatusLabel} · {row.operationalStage}
                </p>
              </div>
              <p className="shrink-0 text-right text-sm font-extrabold tabular-nums text-sky-950">
                {fmtQty(row.committedQty, unit)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-600">
          Commitment detail is not listed per work order yet, but store stock is fully committed elsewhere.
        </p>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{stockCommittedElsewhereSummary()}</p>

      {rmItemId != null && rmItemId > 0 ? (
        <Link
          to={buildRmControlCenterHref({
            workOrderId: currentWorkOrderId ?? undefined,
            rmItemId,
            salesOrderId,
          })}
          className="mt-2 inline-block text-[11px] font-bold text-violet-900 underline"
        >
          Review allocation on this RM item
        </Link>
      ) : null}
    </section>
  );
}
