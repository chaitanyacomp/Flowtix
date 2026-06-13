/**
 * P6D — RM Planning vs Actual Received report.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { PageContainer, ReportPageHeader, StickyReportBackStrip } from "../components/PageHeader";
import { ReportFilterToolbar, ReportFilterField } from "../components/erp/ReportChrome";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch, getApiUrl } from "../services/api";
import { useUrlQueryState } from "../hooks/useUrlQueryState";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { cn } from "../lib/utils";
import {
  buildCsvDownloadUrl,
  buildReportQuery,
  defaultPeriodKey,
  formatReportQty,
  formatVariancePercent,
  formatVarianceQty,
  PROCUREMENT_SOURCE_OPTIONS,
  ROW_STATUS_OPTIONS,
  rowStatusTone,
  type RmPlanningVsReceivedFilters,
  type RmPlanningVsReceivedRow,
} from "../lib/rmPlanningVsReceivedReportUx";

type Supplier = { id: number; name: string };
type RmItem = { id: number; itemName: string; unit?: string | null };

type ApiResp = {
  periodKey: string;
  summary: {
    totalPlannedRmQty: number;
    totalPoQty: number;
    totalReceivedQty: number;
    totalPendingGrnQty: number;
    overReceivedItems: number;
    shortReceivedItems: number;
  };
  emptyState: { code: string; message: string } | null;
  rows: RmPlanningVsReceivedRow[];
};

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function RowDetail({ row }: { row: RmPlanningVsReceivedRow }) {
  return (
    <div className="space-y-4 border-t border-slate-100 bg-slate-50/80 px-3 py-3 text-sm">
      {row.planningSources.length ? (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Planning source</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-2 py-1">Plan document</th>
                  <th className="px-2 py-1">Revision</th>
                  <th className="px-2 py-1">Period</th>
                  <th className="px-2 py-1">Source type</th>
                  <th className="px-2 py-1 text-right">Planned qty</th>
                </tr>
              </thead>
              <tbody>
                {row.planningSources.map((ps, i) => (
                  <tr key={`${ps.planId}-${ps.revision}-${i}`} className="border-b border-slate-100">
                    <td className="px-2 py-1.5">
                      {ps.planId ? (
                        <Link to={`/monthly-planning/${ps.planId}`} className="font-semibold text-primary underline">
                          {ps.planLabel || ps.planDocNo || `Plan #${ps.planId}`}
                        </Link>
                      ) : (
                        ps.planLabel || "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5">{ps.revision}</td>
                    <td className="px-2 py-1.5">{ps.periodKey}</td>
                    <td className="px-2 py-1.5">{ps.sourceTypeLabel}</td>
                    <td className="px-2 py-1.5 text-right">{formatReportQty(ps.plannedQty, row.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">No monthly planning snapshot for this item in the selected period.</p>
      )}

      {row.procurementDetails.length ? (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Procurement source</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-2 py-1">Source</th>
                  <th className="px-2 py-1">MR / PR</th>
                  <th className="px-2 py-1">PO</th>
                  <th className="px-2 py-1">Supplier</th>
                  <th className="px-2 py-1 text-right">PO qty</th>
                  <th className="px-2 py-1">GRN</th>
                  <th className="px-2 py-1 text-right">GRN qty</th>
                  <th className="px-2 py-1">GRN date</th>
                </tr>
              </thead>
              <tbody>
                {row.procurementDetails.map((d, i) => (
                  <tr key={`${d.mrId}-${d.rmPoId}-${i}`} className="border-b border-slate-100">
                    <td className="px-2 py-1.5">{d.sourceTypeLabel ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      {d.mrDocNo ?? "—"}
                      {d.prDocNo ? ` → ${d.prDocNo}` : ""}
                    </td>
                    <td className="px-2 py-1.5">
                      {d.rmPoId ? (
                        <Link to={`/rm-po-grn/${d.rmPoId}`} className="font-semibold text-primary underline">
                          {d.rmPoDisplayNo}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5">{d.supplierName ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{formatReportQty(d.poQty, row.unit)}</td>
                    <td className="px-2 py-1.5">
                      {d.grnEntries.length
                        ? d.grnEntries.map((g) => (
                            <span key={g.grnId} className="mr-1 inline-block rounded bg-slate-100 px-1 py-0.5">
                              {g.grnNo}
                            </span>
                          ))
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right">{formatReportQty(d.grnQty, row.unit)}</td>
                    <td className="px-2 py-1.5">
                      {d.grnEntries[0]?.grnDate
                        ? new Date(d.grnEntries[0].grnDate).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">No procurement documents linked for this item in the selected scope.</p>
      )}
    </div>
  );
}

export function RmPlanningVsReceivedReportPage() {
  const { patch, read } = useUrlQueryState({
    periodKey: defaultPeriodKey(),
    rmItemId: "",
    procurementSource: "ALL",
    supplierId: "",
    status: "",
  });

  const filters: RmPlanningVsReceivedFilters = {
    periodKey: read.string("periodKey") || defaultPeriodKey(),
    rmItemId: read.string("rmItemId"),
    procurementSource: read.string("procurementSource") || "ALL",
    supplierId: read.string("supplierId"),
    status: read.string("status"),
  };

  const [data, setData] = React.useState<ApiResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [rmItems, setRmItems] = React.useState<RmItem[]>([]);
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());
  const [filterTick, setFilterTick] = React.useState(0);
  const liveTick = useErpRefreshTick(["reports", "purchase", "monthly-planning"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });

  React.useEffect(() => {
    apiFetch<Supplier[]>("/api/suppliers").then(setSuppliers).catch(() => setSuppliers([]));
    apiFetch<RmItem[]>("/api/items?type=RM").then(setRmItems).catch(() => setRmItems([]));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<ApiResp>(`/api/reports/rm-planning-vs-received${buildReportQuery(filters)}`)
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load report.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters.periodKey, filters.rmItemId, filters.procurementSource, filters.supplierId, filters.status, filterTick, liveTick]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rows = data?.rows ?? [];
  const summary = data?.summary;

  const handleExport = () => {
    const url = getApiUrl(buildCsvDownloadUrl(filters));
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <PageContainer>
      <StickyReportBackStrip returnTo="/reports" />
      <ReportPageHeader
        title="RM Planning vs Actual Received"
        description="Month-wise comparison of RM planned requirement, procurement release, PO quantity, and GRN received quantity."
      />

      <ReportFilterToolbar onApply={() => setFilterTick((t) => t + 1)}>
        <ReportFilterField label="Month / Period">
          <Input
            type="month"
            value={filters.periodKey}
            onChange={(e) => patch({ periodKey: e.target.value || defaultPeriodKey() })}
            className="h-9"
          />
        </ReportFilterField>
        <ReportFilterField label="RM Item">
          <select
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={filters.rmItemId}
            onChange={(e) => patch({ rmItemId: e.target.value })}
          >
            <option value="">All RM items</option>
            {rmItems.map((i) => (
              <option key={i.id} value={String(i.id)}>
                {i.itemName}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="Procurement Source">
          <select
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={filters.procurementSource}
            onChange={(e) => patch({ procurementSource: e.target.value || "ALL" })}
          >
            {PROCUREMENT_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="Supplier">
          <select
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={filters.supplierId}
            onChange={(e) => patch({ supplierId: e.target.value })}
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="Status">
          <select
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={filters.status}
            onChange={(e) => patch({ status: e.target.value })}
          >
            {ROW_STATUS_OPTIONS.map((o) => (
              <option key={o.value || "ALL"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </ReportFilterField>
      </ReportFilterToolbar>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Period: <span className="font-semibold">{filters.periodKey}</span>
          {loading ? " · Loading…" : ` · ${rows.length} item${rows.length === 1 ? "" : "s"}`}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={loading || !rows.length}>
          <Download className="mr-1.5 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      {summary ? (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total Planned RM Qty" value={formatReportQty(summary.totalPlannedRmQty)} />
          <KpiCard label="Total PO Qty" value={formatReportQty(summary.totalPoQty)} />
          <KpiCard label="Total Received Qty" value={formatReportQty(summary.totalReceivedQty)} />
          <KpiCard label="Total Pending GRN" value={formatReportQty(summary.totalPendingGrnQty)} />
          <KpiCard label="Over Received Items" value={String(summary.overReceivedItems)} />
          <KpiCard label="Short Received Items" value={String(summary.shortReceivedItems)} />
        </div>
      ) : null}

      {data?.emptyState && !loading ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {data.emptyState.message}
        </div>
      ) : null}

      {!loading && !rows.length && !data?.emptyState ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          No rows match the selected filters.
        </div>
      ) : null}

      {rows.length ? (
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardContent className="p-0">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1200px] border-collapse text-sm" data-testid="rm-planning-vs-received-table">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    <th className="w-8 px-2 py-2" />
                    <th className="px-2 py-2">RM Item</th>
                    <th className="px-2 py-2">Unit</th>
                    <th className="px-2 py-2 text-right">Planned RM Qty</th>
                    <th className="px-2 py-2 text-right">Released Procurement Qty</th>
                    <th className="px-2 py-2 text-right">PO Qty</th>
                    <th className="px-2 py-2 text-right">GRN Received Qty</th>
                    <th className="px-2 py-2 text-right">Pending GRN Qty</th>
                    <th className="px-2 py-2 text-right">Variance Qty</th>
                    <th className="px-2 py-2 text-right">Variance %</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const open = expanded.has(row.rmItemId);
                    return (
                      <React.Fragment key={row.rmItemId}>
                        <tr className="border-b border-slate-100 hover:bg-slate-50/50">
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              className="rounded p-0.5 text-slate-500 hover:bg-slate-100"
                              onClick={() => toggle(row.rmItemId)}
                              aria-expanded={open}
                            >
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="px-2 py-2 font-medium text-slate-900">{row.rmItemName}</td>
                          <td className="px-2 py-2">{row.unit || "—"}</td>
                          <td className="px-2 py-2 text-right">{formatReportQty(row.plannedRmQty, row.unit)}</td>
                          <td className="px-2 py-2 text-right">{formatReportQty(row.releasedProcurementQty, row.unit)}</td>
                          <td className="px-2 py-2 text-right">{formatReportQty(row.poQty, row.unit)}</td>
                          <td className="px-2 py-2 text-right">{formatReportQty(row.grnReceivedQty, row.unit)}</td>
                          <td className="px-2 py-2 text-right">{formatReportQty(row.pendingGrnQty, row.unit)}</td>
                          <td className="px-2 py-2 text-right">{formatVarianceQty(row.varianceQty, row.unit)}</td>
                          <td className="px-2 py-2 text-right">{formatVariancePercent(row.variancePercent)}</td>
                          <td className="px-2 py-2">
                            <span className={cn("rounded border px-2 py-0.5 text-xs font-semibold", rowStatusTone(row.status))}>
                              {row.statusLabel}
                            </span>
                          </td>
                        </tr>
                        {open ? (
                          <tr>
                            <td colSpan={11} className="p-0">
                              <RowDetail row={row} />
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-3 md:hidden" data-testid="rm-planning-vs-received-cards">
              {rows.map((row) => {
                const open = expanded.has(row.rmItemId);
                return (
                  <div key={row.rmItemId} className="rounded-lg border border-slate-200 bg-white">
                    <button type="button" className="w-full px-3 py-3 text-left" onClick={() => toggle(row.rmItemId)}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900">{row.rmItemName}</p>
                          <p className="text-xs text-slate-500">{row.unit}</p>
                        </div>
                        <span className={cn("shrink-0 rounded border px-2 py-0.5 text-[10px] font-bold", rowStatusTone(row.status))}>
                          {row.statusLabel}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                        <div>
                          <span className="block text-[10px] uppercase text-slate-400">Planned</span>
                          {formatReportQty(row.plannedRmQty, row.unit)}
                        </div>
                        <div>
                          <span className="block text-[10px] uppercase text-slate-400">GRN</span>
                          {formatReportQty(row.grnReceivedQty, row.unit)}
                        </div>
                        <div>
                          <span className="block text-[10px] uppercase text-slate-400">Variance</span>
                          {formatVarianceQty(row.varianceQty, row.unit)}
                        </div>
                        <div>
                          <span className="block text-[10px] uppercase text-slate-400">PO</span>
                          {formatReportQty(row.poQty, row.unit)}
                        </div>
                      </div>
                    </button>
                    {open ? <RowDetail row={row} /> : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </PageContainer>
  );
}
