import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { apiFetch } from "../../services/api";
import { cn } from "../../lib/utils";
import {
  buildDashboardProductionStatusRows,
  formatProductionQty,
  type DashboardProductionStatusSource,
} from "../../lib/dashboardProductionStatus";
import { resolveNoQtyCycleDisplayStatus } from "../../lib/noQtyCycleDisplayStatus";
import { noQtyOperatorThirdColumn } from "../../lib/noQtyShortagePresentation";
import { displayWorkOrderTraceNo } from "../../lib/docNoDisplay";
import { productionHrefFromDashboardRow } from "../../lib/operationalWorkspaceLinks";
import { NO_QTY_TERMS } from "../../lib/flowTerminology";
import { useErpRefreshTick } from "../../hooks/useErpRefreshTick";

function flowBadge(orderType?: string | null) {
  return orderType === "NO_QTY" ? NO_QTY_TERMS.AGREEMENT_LABEL : "REGULAR";
}

export function OperationalProductionWorkspace({
  onOpenRow,
  className,
}: {
  /** Optional in-page handoff (e.g. applyLine) instead of navigation. */
  onOpenRow?: (row: DashboardProductionStatusSource) => void;
  className?: string;
}) {
  const liveTick = useErpRefreshTick(["production", "dashboard"], { pollIntervalMs: 0 });
  const [rows, setRows] = React.useState<DashboardProductionStatusSource[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    void apiFetch<DashboardProductionStatusSource[]>("/api/dashboard/production-queue")
      .then((data) => {
        if (mounted) {
          setRows(Array.isArray(data) ? data : []);
          setError(null);
        }
      })
      .catch((e) => {
        if (mounted) {
          setRows([]);
          setError(e instanceof Error ? e.message : "Failed to load production queue");
        }
      });
    return () => {
      mounted = false;
    };
  }, [liveTick]);

  const { visible, total } = React.useMemo(
    () => buildDashboardProductionStatusRows(rows ?? [], { limit: 24 }),
    [rows],
  );

  return (
    <Card className={cn("erp-op-workspace-primary min-w-0 overflow-hidden", className)}>
      <CardHeader className="border-b border-slate-100 bg-white px-2.5 py-1.5">
        <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Active production</CardTitle>
        <p className="text-[11px] text-slate-500">Pick a line to open scoped production · REGULAR and NO_QTY</p>
      </CardHeader>
      <CardContent className="p-1.5">
        {error ? <p className="mb-1 text-[12px] text-red-700">{error}</p> : null}
        {rows === null ? (
          <p className="px-1 py-2 text-[13px] text-slate-600">Loading production queue…</p>
        ) : visible.length === 0 ? (
          <p className="px-1 py-2 text-[13px] text-slate-600">No active production work right now.</p>
        ) : (
          <>
            <div className="max-h-[min(36vh,320px)] overflow-auto rounded-md border border-slate-200/90">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                  <tr className="text-left text-[11px] text-slate-600">
                    <th className="px-2 py-1 font-medium">Flow</th>
                    <th className="px-2 py-1 font-medium">SO</th>
                    <th className="px-2 py-1 font-medium">Cycle</th>
                    <th className="px-2 py-1 font-medium">WO</th>
                    <th className="px-2 py-1 font-medium">Item</th>
                    <th className="px-2 py-1 text-right font-medium">Planned</th>
                    <th className="px-2 py-1 text-right font-medium">Produced</th>
                    <th className="px-2 py-1 text-right font-medium">Pending</th>
                    <th className="px-2 py-1 font-medium">Status</th>
                    <th className="w-20 px-1 py-1 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const href = productionHrefFromDashboardRow({
                      orderType: row.orderType,
                      salesOrderId: (row as { salesOrderId?: number }).salesOrderId,
                      workOrderId: row.workOrderId,
                      workOrderLineId: row.workOrderLineId,
                      cycleId: row.cycleId ?? null,
                      actionHref: row.actionHref,
                    });
                    const thirdCol = noQtyOperatorThirdColumn({
                      orderType: row.orderType,
                      lastShortageQty: row.lastShortageQty,
                      nextAction: row.nextAction,
                      operationalStatus: row.operationalStatus,
                      remainingQty: row.remainingQty,
                      requiredQty: row.requiredQty,
                      producedQty: row.producedQty,
                    });
                    return (
                      <tr key={`${row.workOrderId}-${row.workOrderLineId ?? row.itemName}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className="px-2 py-0.5">
                          <Badge variant="default" className="h-5 px-1 text-[10px] font-semibold">
                            {flowBadge(row.orderType)}
                          </Badge>
                        </td>
                        <td className="px-2 py-0.5 tabular-nums font-medium">
                          {row.salesOrderNo ?? (row.salesOrderId ? `SO-${row.salesOrderId}` : "—")}
                        </td>
                        <td className="px-2 py-0.5 tabular-nums">{row.cycleNo ?? "—"}</td>
                        <td className="px-2 py-0.5 tabular-nums">{displayWorkOrderTraceNo(row.workOrderId)}</td>
                        <td className="max-w-[9rem] truncate px-2 py-0.5" title={row.itemName}>
                          {row.itemName}
                        </td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{formatProductionQty(row.requiredQty)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{formatProductionQty(row.producedQty)}</td>
                        <td
                          className={cn(
                            "px-2 py-0.5 text-right tabular-nums font-semibold",
                            row.orderType === "NO_QTY" && thirdCol.qty > 0 && "text-amber-900",
                          )}
                          title={row.orderType === "NO_QTY" ? thirdCol.label : undefined}
                        >
                          {formatProductionQty(thirdCol.qty)}
                        </td>
                        <td className="px-2 py-0.5">
                          <span
                            className={cn(
                              "text-[11px] font-semibold",
                              row.operationalStatus.tone === "carryForward" && "text-amber-900",
                              row.operationalStatus.tone === "carriedForward" && "text-slate-600",
                            )}
                          >
                            {row.orderType === "NO_QTY"
                              ? resolveNoQtyCycleDisplayStatus({ ...row, allQueueRows: rows ?? [] }).label
                              : row.operationalStatus.label}
                          </span>
                        </td>
                        <td className="px-1 py-0.5 text-right">
                          {onOpenRow ? (
                            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => onOpenRow(row)}>
                              Open
                            </Button>
                          ) : (
                            <Link to={href} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-blue-700 no-underline hover:underline">
                              Open <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {total > visible.length ? (
              <p className="mt-1 text-[11px] text-slate-500">{total - visible.length} more lines — use filters on dashboard or open SO from list below.</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
