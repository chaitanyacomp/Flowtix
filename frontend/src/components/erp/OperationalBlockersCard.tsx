import { Link } from "react-router-dom";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import type { ProcurementPendingRow } from "./ProcurementPendingDashboardCard";
import type { WoPrepareDashboardQueues } from "./WoPrepareOperationalQueuesCard";
import { buildOperationalSoActions } from "../../lib/operationalBlockers";

const ROW_CAP = 12;

type Props = {
  procurementPending: ProcurementPendingRow[] | null;
  storeIssuePending?: ProcurementPendingRow[] | null;
  allocationFirstPending?: Array<{
    workOrderId?: number | null;
    workOrderNo?: string | null;
    salesOrderId?: number | null;
    salesOrderDocNo?: string | null;
    primaryFgName?: string | null;
    operationalKey?: string;
    operationalLabel?: string;
    nextActionKey?: string;
  }> | null;
  woPrepareQueues: WoPrepareDashboardQueues | null;
  loading?: boolean;
};

export function OperationalBlockersCard({
  procurementPending,
  storeIssuePending,
  allocationFirstPending,
  woPrepareQueues,
  loading,
}: Props) {
  const actions = buildOperationalSoActions(
    procurementPending,
    woPrepareQueues,
    storeIssuePending,
    allocationFirstPending,
  );
  const hasAny = actions.length > 0;

  if (loading) {
    return (
      <section
        aria-label="Operational Blockers"
        className="rounded-lg border border-violet-200/70 bg-white px-2.5 py-2 text-[12px] text-slate-600 shadow-sm"
      >
        Loading blockers…
      </section>
    );
  }

  if (!hasAny) return null;

  const capped = actions.slice(0, ROW_CAP);
  const truncated = actions.length > ROW_CAP;

  return (
    <section
      aria-label="Operational Blockers"
      className="overflow-hidden rounded-lg border border-violet-200/80 bg-white shadow-sm ring-1 ring-violet-100/50"
    >
      <header className="border-b border-violet-100/80 bg-violet-50/40 px-2.5 py-1">
        <h2 className="text-[13px] font-extrabold tracking-tight text-slate-950">Operational Blockers</h2>
      </header>

      <ul className="divide-y divide-slate-100">
        {capped.map((row) => {
          const isReady = row.variant === "ready";
          return (
            <li
              key={row.key}
              className={cn(
                "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-2.5 py-1.5",
                isReady && "bg-emerald-50/35",
              )}
            >
              <div className="min-w-0 flex-1 break-words">
                <div className="text-[13px] font-bold leading-snug text-slate-950">
                  {row.salesOrderId > 0
                    ? displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo)
                    : row.salesOrderDocNo ?? "Material requirement"}
                  {row.primaryFgName ? (
                    <span className="font-semibold text-slate-700"> · {row.primaryFgName}</span>
                  ) : row.customerName ? (
                    <span className="font-normal text-slate-600"> · {row.customerName}</span>
                  ) : null}
                </div>
                <div
                  className={cn(
                    "text-[11px] font-semibold",
                    isReady ? "text-emerald-800" : "text-violet-900",
                  )}
                >
                  {row.stageLabel}
                </div>
                {row.statusLine ? (
                  <div className="text-[11px] font-medium text-slate-700">{row.statusLine}</div>
                ) : null}
                {row.detailLine ? (
                  <div className="break-words text-[11px] leading-snug text-slate-600">{row.detailLine}</div>
                ) : null}
              </div>
              <Link
                to={row.actionTo}
                state={{ from: "dashboard" }}
                className={cn(
                  buttonVariants({ variant: isReady ? "outline" : "default", size: "sm" }),
                  "h-8 shrink-0 px-2.5 text-[11px] font-semibold no-underline shadow-sm",
                  isReady && "border-emerald-300 bg-white text-emerald-950 hover:bg-emerald-50",
                )}
              >
                {row.actionLabel}
              </Link>
            </li>
          );
        })}
      </ul>

      {truncated ? (
        <p className="border-t border-slate-100 px-2.5 py-1 text-center text-[10px] text-slate-500">
          +{actions.length - ROW_CAP} more
        </p>
      ) : null}
    </section>
  );
}
