import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import {
  materialPlanningReviewHref,
  resolvePurchaseExecutionCta,
  woPreparePrepareHref,
} from "../../lib/woPrepareOperationalStage";
import { REGULAR_TERMS } from "../../lib/flowTerminology";

export type WoPrepareQueueRow = {
  salesOrderId: number;
  salesOrderDocNo: string | null;
  customerName: string;
  primaryFgName: string | null;
  shortageRmCount: number;
  pendingMrRefs: string;
  nextActionKey: string;
  operationalLabel: string;
  procurementOperationalLabel?: string;
  pendingPoStatus?: string;
  pendingGrnStatus?: string;
  supplierPendingStatus?: string;
};

export type WoPrepareDashboardQueues = {
  rmShortageBlocking: WoPrepareQueueRow[];
  purchaseGrnPending: WoPrepareQueueRow[];
  readyForWoCreation: WoPrepareQueueRow[];
};

const WO_PREPARE_EMPTY = {
  title: "Work order preparation",
  detail:
    "No REGULAR sales orders are blocked on RM shortage, purchase, or GRN. Open Sales Orders when Store raises material requirements.",
} as const;

type Props = {
  queues: WoPrepareDashboardQueues | null;
  loading?: boolean;
};

function QueueSection({
  title,
  detail,
  rows,
  actionLabel,
  actionHref,
}: {
  title: string;
  detail: string;
  rows: WoPrepareQueueRow[];
  actionLabel: string | ((row: WoPrepareQueueRow) => string);
  actionHref: (row: WoPrepareQueueRow) => string;
}) {
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-[11px] text-slate-600">{detail}</p>
      </div>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
        {rows.map((row) => (
          <li key={row.salesOrderId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-slate-900">
                {displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo)}
                {row.customerName ? (
                  <span className="ml-1 font-normal text-slate-600">· {row.customerName}</span>
                ) : null}
              </div>
              <div className="text-[11px] text-slate-600">
                {row.primaryFgName ? <span>{row.primaryFgName}</span> : null}
                {row.primaryFgName && row.shortageRmCount > 0 ? " · " : null}
                {row.shortageRmCount > 0 ? (
                  <span className="text-red-700">{row.shortageRmCount} RM shortage line(s)</span>
                ) : null}
                {row.pendingMrRefs ? (
                  <span className={row.shortageRmCount > 0 ? " · " : ""}>MR {row.pendingMrRefs}</span>
                ) : null}
                {row.procurementOperationalLabel ? (
                  <span> · {row.procurementOperationalLabel}</span>
                ) : null}
              </div>
            </div>
            <Link
              to={actionHref(row)}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 shrink-0 text-[11px] no-underline")}
            >
              {typeof actionLabel === "function" ? actionLabel(row) : actionLabel}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WoPrepareOperationalQueuesCard({ queues, loading }: Props) {
  const q = queues ?? {
    rmShortageBlocking: [],
    purchaseGrnPending: [],
    readyForWoCreation: [],
  };
  const hasAny =
    q.rmShortageBlocking.length > 0 || q.purchaseGrnPending.length > 0 || q.readyForWoCreation.length > 0;

  if (loading) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="py-2">
          <CardTitle className="text-base">{WO_PREPARE_EMPTY.title}</CardTitle>
        </CardHeader>
        <CardContent className="py-2 text-sm text-slate-600">Loading WO prepare queues…</CardContent>
      </Card>
    );
  }

  if (!hasAny) {
    return (
      <Card className="border-slate-200/80 bg-slate-50/30 shadow-sm">
        <CardHeader className="py-2 pb-1">
          <CardTitle className="text-base text-slate-800">{WO_PREPARE_EMPTY.title}</CardTitle>
          <p className="text-[11px] font-normal text-slate-600">{WO_PREPARE_EMPTY.detail}</p>
        </CardHeader>
        <CardContent className="pt-0 pb-3">
          <Link
            to="/sales-orders"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-[11px] no-underline")}
          >
            Open Sales Orders
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200/80 bg-gradient-to-b from-amber-50/40 to-white shadow-sm ring-1 ring-amber-100/60">
      <CardHeader className="py-2 pb-1">
        <CardTitle className="text-base">Work order preparation</CardTitle>
        <p className="text-[11px] font-normal text-slate-600">
          REGULAR sales orders awaiting first work order — action reflects the current bottleneck.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-0 pb-3">
        <QueueSection
          title="RM shortage blocking WO"
          detail="Review RM readiness and raise material requirement for purchase."
          rows={q.rmShortageBlocking}
          actionLabel={REGULAR_TERMS.OPEN_RM_PLANNING}
          actionHref={(row) => materialPlanningReviewHref({ salesOrderId: row.salesOrderId, source: "dashboard" })}
        />
        <QueueSection
          title="Purchase / GRN pending"
          detail="Material requirement raised — complete purchase before creating work order."
          rows={q.purchaseGrnPending}
          actionLabel={(row) =>
            resolvePurchaseExecutionCta({
              salesOrderId: row.salesOrderId,
              pendingPoStatus: row.pendingPoStatus,
              pendingGrnStatus: row.pendingGrnStatus,
              source: "dashboard",
            }).label
          }
          actionHref={(row) =>
            resolvePurchaseExecutionCta({
              salesOrderId: row.salesOrderId,
              pendingPoStatus: row.pendingPoStatus,
              pendingGrnStatus: row.pendingGrnStatus,
              source: "dashboard",
            }).href
          }
        />
        <QueueSection
          title="Ready for WO creation"
          detail="RM is available — create work order from prepare screen."
          rows={q.readyForWoCreation}
          actionLabel="Create Work Order"
          actionHref={(row) => woPreparePrepareHref(row.salesOrderId)}
        />
      </CardContent>
    </Card>
  );
}
