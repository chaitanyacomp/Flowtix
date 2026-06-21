import * as React from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { apiFetch, ApiRequestError } from "../../../services/api";
import { workOrdersFocusHref } from "../../../lib/drillDownRoutes";
import { cn } from "../../../lib/utils";

export type RsExecutionSummary = {
  requirementSheetId: number;
  salesOrderId: number;
  cycleId: number | null;
  periodKey: string | null;
  status: string;
  release: {
    monthlyPlanId: number | null;
    released: boolean;
    releasedAt: string | null;
    releasedRevision: number | null;
    label: string | null;
  };
  totals: {
    rsDemandQty: number;
    woPlacedQty: number;
    rsBalanceQty: number;
  };
  lines: Array<{
    itemId: number;
    itemName: string;
    rsDemandQty: number;
    woPlacedQty: number;
    rsBalanceQty: number;
  }>;
  workOrders: Array<{
    id: number;
    docNo: string | null;
    status: string;
    createdAt: string | null;
    totalQty: number;
    pmrId: number | null;
    pmrDocNo: string | null;
    pmrStatus: string | null;
  }>;
  procurement: {
    status: string;
    materialRequirementId: number | null;
    materialRequirementDocNo: string | null;
    summaryLabel: string;
  };
  rmPreview: {
    available: boolean;
    message: string;
  };
};

function fmtQty(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : r.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function KpiTile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("rounded-md border border-slate-200 bg-white px-3 py-2", className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

export function RequirementSheetExecutionPanel({
  sheetId,
  salesOrderId,
  className,
}: {
  sheetId: number;
  salesOrderId: number;
  className?: string;
}) {
  const [data, setData] = React.useState<RsExecutionSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await apiFetch<RsExecutionSummary>(`/api/requirement-sheets/${sheetId}/execution`);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setError(e instanceof ApiRequestError ? e.message : "Failed to load execution summary.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheetId]);

  if (loading) {
    return (
      <div className={cn("rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600", className)}>
        Loading execution workspace…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn("rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800", className)}>
        {error ?? "Execution summary unavailable."}
      </div>
    );
  }

  return (
    <div
      className={cn("rounded-md border border-slate-200 bg-slate-50/80 px-3 py-3", className)}
      data-testid="rs-execution-workspace"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">Execution Workspace</div>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-slate-600">
            Release creates Monthly Plan MR for procurement. Store will place WO batches from this execution workspace
            after RM readiness is reviewed.
          </p>
        </div>
        <Badge variant={data.release.released ? "success" : "secondary"}>
          {data.release.released ? "Released to Procurement" : "Not Released"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="RS Demand" value={fmtQty(data.totals.rsDemandQty)} />
        <KpiTile label="WO Placed" value={fmtQty(data.totals.woPlacedQty)} />
        <KpiTile label="RS Balance" value={fmtQty(data.totals.rsBalanceQty)} />
        <KpiTile label="Procurement" value={data.procurement.summaryLabel} className="sm:col-span-2 lg:col-span-1" />
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-slate-800">WO History</div>
        {data.workOrders.length === 0 ? (
          <p className="mt-1 text-xs text-slate-600">No WO placed yet for this Requirement Sheet.</p>
        ) : (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-2">WO No</th>
                  <th className="py-1.5 pr-2">Status</th>
                  <th className="py-1.5 pr-2 text-right">Placed Qty</th>
                  <th className="py-1.5 pr-2">PMR</th>
                  <th className="py-1.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.workOrders.map((wo) => (
                  <tr key={wo.id} className="border-b border-slate-100 text-slate-800">
                    <td className="py-1.5 pr-2 font-medium">{wo.docNo?.trim() || `WO-${wo.id}`}</td>
                    <td className="py-1.5 pr-2">{wo.status}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(wo.totalQty)}</td>
                    <td className="py-1.5 pr-2">
                      {wo.pmrId ? (
                        <Link
                          to={`/material-issue?pmrId=${wo.pmrId}`}
                          className="font-medium text-primary underline underline-offset-2"
                        >
                          {wo.pmrDocNo?.trim() || `PMR-${wo.pmrId}`}
                          {wo.pmrStatus ? ` · ${wo.pmrStatus}` : ""}
                        </Link>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      <Link
                        to={`${workOrdersFocusHref(wo.id)}&source=no_qty_so&salesOrderId=${salesOrderId}`}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        Open WO
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-slate-800">Line Balance</div>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-2">FG Item</th>
                <th className="py-1.5 pr-2 text-right">RS Demand</th>
                <th className="py-1.5 pr-2 text-right">WO Placed</th>
                <th className="py-1.5 text-right">RS Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => (
                <tr key={line.itemId} className="border-b border-slate-100 text-slate-800">
                  <td className="py-1.5 pr-2 font-medium">{line.itemName}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.rsDemandQty)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.woPlacedQty)}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{fmtQty(line.rsBalanceQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
        {data.rmPreview.message}
      </div>

      <div className="mt-3">
        <Button type="button" size="sm" disabled title="Store WO batch placement arrives in the next phase">
          Create WO Batch — coming in next phase
        </Button>
      </div>
    </div>
  );
}
