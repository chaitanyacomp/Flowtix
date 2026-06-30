import * as React from "react";
import { cn } from "../../../lib/utils";
import {
  fetchProductionWorkOrderReport,
  type ProductionWorkOrderReport,
} from "../../../lib/productionWorkOrderReportApi";

function fmtQty(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) <= 1e-9) return "0";
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : String(r);
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function ProductionReportPanel({
  workOrderId,
  refreshKey = 0,
  className,
}: {
  workOrderId: number;
  refreshKey?: number;
  className?: string;
}) {
  const [report, setReport] = React.useState<ProductionWorkOrderReport | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!workOrderId || workOrderId <= 0) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchProductionWorkOrderReport(workOrderId)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setReport(null);
          setError(e instanceof Error ? e.message : "Failed to load production report");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, refreshKey]);

  if (!workOrderId || workOrderId <= 0) return null;

  return (
    <div
      className={cn("rounded-md border border-slate-200 bg-white shadow-sm", className)}
      role="region"
      aria-label="Production report and RM consumption"
      data-testid="production-report-panel"
    >
      <div className="border-b border-slate-100 bg-slate-50/80 px-3 py-2">
        <div className="text-[12px] font-semibold text-slate-900">Production Report / RM Consumption</div>
        <p className="mt-0.5 text-[11px] text-slate-600">
          Audit view after production posting. RM consumed values come from approved batch snapshots (REGULAR).
        </p>
      </div>
      <div className="space-y-3 px-3 py-2">
        {loading ? (
          <p className="text-[11px] text-slate-600">Loading production report…</p>
        ) : error ? (
          <p className="text-[11px] text-amber-800">{error}</p>
        ) : !report?.hasApprovedProduction ? (
          <p className="text-[11px] text-slate-600">No approved production batches on this work order yet.</p>
        ) : (
          <>
            <div className="grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <span className="text-slate-500">WO</span>
                <div className="font-semibold text-slate-900">{report.workOrderNo}</div>
              </div>
              <div>
                <span className="text-slate-500">SO / FG</span>
                <div className="font-medium text-slate-900">
                  {report.salesOrderNo ?? "—"}
                  {report.fgItemName ? ` · ${report.fgItemName}` : ""}
                </div>
              </div>
              <div>
                <span className="text-slate-500">Planned / Produced</span>
                <div className="font-semibold tabular-nums text-slate-900">
                  {fmtQty(report.summary.plannedQty)} / {fmtQty(report.summary.producedQty)}
                </div>
              </div>
              <div>
                <span className="text-slate-500">Execution</span>
                <div className="font-medium text-slate-900">
                  {report.execution.status ?? report.workOrderStatus}
                  {report.execution.completedAt ? (
                    <span className="ml-1 font-normal text-slate-500">
                      · {fmtWhen(report.execution.completedAt)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {report.batches.length > 0 ? (
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full min-w-[36rem] border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1">Batch</th>
                      <th className="px-2 py-1 text-right">Produced</th>
                      <th className="px-2 py-1 text-right">QC Accept</th>
                      <th className="px-2 py-1 text-right">QC Reject</th>
                      <th className="px-2 py-1 text-right">QC Pending</th>
                      <th className="px-2 py-1">Approved by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.batches.map((b) => (
                      <tr key={b.productionEntryId} className="border-b border-slate-100 text-slate-800">
                        <td className="px-2 py-1 font-medium">
                          {b.productionEntryDocNo}
                          <span className="ml-1 font-normal text-slate-500">
                            {new Date(b.productionDate).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtQty(b.producedQty)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-emerald-800">{fmtQty(b.acceptedQty)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-rose-800">{fmtQty(b.rejectedQty)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-amber-800">{fmtQty(b.pendingQcQty)}</td>
                        <td className="px-2 py-1 text-slate-600">{b.approvedByName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {report.rmLines.length > 0 ? (
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full min-w-[40rem] border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1">RM Item</th>
                      <th className="px-2 py-1 text-right">Issued</th>
                      <th className="px-2 py-1 text-right">Std (BOM)</th>
                      <th className="px-2 py-1 text-right">Consumed</th>
                      <th className="px-2 py-1 text-right">Variance</th>
                      <th className="px-2 py-1 text-right">Returnable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rmLines.map((ln) => (
                      <tr key={ln.itemId} className="border-b border-slate-100 text-slate-800">
                        <td className="px-2 py-1 font-medium">
                          {ln.itemName}
                          {ln.unit ? <span className="ml-1 font-normal text-slate-500">{ln.unit}</span> : null}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtQty(ln.issuedQty)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtQty(ln.standardQty)}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold">
                          {fmtQty(ln.reportedConsumedQty ?? ln.ledgerConsumedQty)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1 text-right tabular-nums",
                            Number(ln.varianceQty ?? 0) > 0
                              ? "text-rose-800"
                              : Number(ln.varianceQty ?? 0) < 0
                                ? "text-emerald-800"
                                : "",
                          )}
                        >
                          {fmtQty(ln.varianceQty)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtQty(ln.returnableQty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : report.isRegular ? (
              <p className="text-[11px] text-slate-600">No RM consumption lines recorded for approved batches.</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
