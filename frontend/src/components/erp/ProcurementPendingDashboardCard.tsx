import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";
import {
  buildRmControlCenterHref,
  procurementStageLabelForKey,
  WO_PROCUREMENT_CONTINUITY,
} from "../../lib/woProcurementContinuity";

export type ProcurementPendingRow = {
  materialRequirementId: number;
  docNo: string | null;
  workOrderId?: number | null;
  workOrderNo?: string | null;
  salesOrderId: number | null;
  salesOrderDocNo: string | null;
  primaryFgName: string | null;
  shortageRmLineCount: number;
  totalShortageQty: number;
  pendingGrnQty?: number;
  procurementStage?: string | null;
  operationalLabel: string;
  pendingPoStatus: string;
  pendingGrnStatus: string;
  supplierPendingStatus: string;
  nextActionKey: string;
  operationalKey?: string;
  totalRemainingQty?: number;
};

type Props = {
  rows: ProcurementPendingRow[] | null;
  loading?: boolean;
};

function fmtQty(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function ProcurementPendingDashboardCard({ rows, loading }: Props) {
  const list = rows ?? [];
  if (loading) {
    return (
      <Card className="border-violet-200/80 shadow-sm">
        <CardContent className="py-3 text-sm text-slate-600">{PROCUREMENT_TERMS.LOADING_PROCUREMENT}</CardContent>
      </Card>
    );
  }
  if (!list.length) {
    return (
      <Card className="border-slate-200/80 bg-slate-50/30 shadow-sm">
        <CardHeader className="py-2 pb-1">
          <CardTitle className="text-base text-slate-800">{PROCUREMENT_TERMS.DASHBOARD_EMPTY_TITLE}</CardTitle>
          <p className="text-[11px] font-normal text-slate-600">{PROCUREMENT_TERMS.DASHBOARD_EMPTY_DETAIL}</p>
        </CardHeader>
        <CardContent className="pt-0 pb-3">
          <Link
            to="/procurement-planning?demandPool=REGULAR_SO"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-[11px] no-underline")}
          >
            {PROCUREMENT_TERMS.WORKSPACE_TITLE}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-violet-200/80 bg-gradient-to-b from-violet-50/35 to-white shadow-sm ring-1 ring-violet-100/60">
      <CardHeader className="py-2 pb-1">
        <CardTitle className="text-base">{PROCUREMENT_TERMS.DASHBOARD_SECTION_TITLE}</CardTitle>
        <p className="text-[11px] font-normal text-slate-600">{PROCUREMENT_TERMS.DASHBOARD_SECTION_DETAIL}</p>
      </CardHeader>
      <CardContent className="space-y-2 pt-0 pb-3">
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {list.slice(0, 12).map((row) => {
            const woId = row.workOrderId != null && row.workOrderId > 0 ? row.workOrderId : null;
            const stage =
              row.procurementStage?.trim() ||
              procurementStageLabelForKey(row.operationalKey) ||
              row.operationalLabel;
            const pendingGrn = Number(row.pendingGrnQty ?? 0);
            const rmHref = buildRmControlCenterHref({
              workOrderId: woId ?? undefined,
              salesOrderId: row.salesOrderId ?? undefined,
              materialRequirementId: row.materialRequirementId,
            });
            return (
              <li
                key={row.materialRequirementId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {row.workOrderNo ? (
                      <span className="text-violet-950">{row.workOrderNo}</span>
                    ) : woId ? (
                      <span className="text-violet-950">WO #{woId}</span>
                    ) : (
                      displaySalesOrderNo(row.salesOrderId ?? 0, row.salesOrderDocNo)
                    )}
                    {row.primaryFgName ? (
                      <span className="font-normal text-slate-600"> · {row.primaryFgName}</span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-slate-600">
                    {row.docNo ?? `MR #${row.materialRequirementId}`} · {row.shortageRmLineCount} RM line(s) · Short{" "}
                    {fmtQty(row.totalShortageQty)}
                  </div>
                  <div className="text-[11px] font-semibold text-violet-900">
                    Procurement · {stage}
                    {pendingGrn > 0 ? (
                      <span className="font-bold text-blue-900">
                        {" "}
                        · {WO_PROCUREMENT_CONTINUITY.WAITING_GRN_QTY(fmtQty(pendingGrn))}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    PO: {row.pendingPoStatus} · GRN: {row.pendingGrnStatus}
                    {row.salesOrderDocNo ? ` · SO ${row.salesOrderDocNo}` : ""}
                  </div>
                </div>
                <Link
                  to={rmHref}
                  className={cn(
                    buttonVariants({ variant: "default", size: "sm" }),
                    "h-8 shrink-0 bg-violet-900 text-[11px] font-bold text-white no-underline hover:bg-violet-800",
                  )}
                >
                  {WO_PROCUREMENT_CONTINUITY.OPEN_RM_CONTROL_CENTER}
                </Link>
              </li>
            );
          })}
        </ul>
        {list.length > 12 ? (
          <p className="text-center text-[11px] text-slate-500">+{list.length - 12} {PROCUREMENT_TERMS.MORE_IN_WORKSPACE}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
