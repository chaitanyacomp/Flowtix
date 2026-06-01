/**
 * Phase 3F — Production RM Variance Report (factory consumption analysis).
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { apiFetch, getApiUrl } from "../services/api";
import { cn } from "../lib/utils";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { Download } from "lucide-react";
import { ReportPageHeader } from "../components/PageHeader";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";

type ItemOpt = { id: number; itemName: string; unit?: string };

type DetailRow = {
  id: number;
  productionEntryId: number;
  productionDate: string;
  workOrderNo: string | null;
  salesOrderNo: string | null;
  fgItemName: string;
  rmItemName: string;
  rmUnit: string;
  producedQty: number;
  standardQty: number;
  actualQty: number;
  varianceQty: number;
  variancePercent: number | null;
  consumptionType: string | null;
  remarks: string | null;
  approvedByName: string | null;
};

type RmSummaryRow = {
  itemId: number;
  itemName: string;
  unit: string;
  totalStandard: number;
  totalActual: number;
  netVariance: number;
  variancePercent: number | null;
};

type FgSummaryRow = {
  fgItemId: number;
  fgItemName: string;
  fgUnit: string;
  batchCount: number;
  totalStandard: number;
  totalActual: number;
  netVariance: number;
  variancePercent: number | null;
};

type ApiResp = {
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    thresholdPct: number;
  };
  kpis: {
    totalProductionBatches: number;
    totalRmLines: number;
    extraUsageQty: number;
    lowerUsageQty: number;
    highVarianceCases: number;
    mostConsumedRm: { itemId: number; itemName: string; totalActualQty: number } | null;
  };
  rows: DetailRow[];
  rmSummary: RmSummaryRow[];
  fgSummary: FgSummaryRow[];
};

const URL_OMIT: Record<string, string> = {
  varianceType: "ALL",
  consumptionType: "ALL",
  highVariance: "",
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstDayOfMonthYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function fmtQty(n: number | null | undefined, unit?: string): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${x.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function varianceRowClass(variancePercent: number | null, varianceQty: number, thresholdPct: number): string {
  if (variancePercent != null && variancePercent > thresholdPct) return "text-amber-900 font-medium bg-amber-50/60";
  if (varianceQty > 0 && variancePercent != null && variancePercent > 0) return "text-amber-800";
  if (varianceQty < 0) return "text-sky-800";
  return "text-slate-800";
}

function reportAllowed(role: string | undefined): boolean {
  return role === "ADMIN" || role === "STORE" || role === "PRODUCTION";
}

function buildQueryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function ProductionRmVarianceReportPage() {
  const auth = useAuth();
  const toast = useToast();
  const allowed = reportAllowed(auth.user?.role);
  const { patch, read } = useUrlQueryState(URL_OMIT);

  const [dateFrom, setDateFrom] = React.useState(firstDayOfMonthYmd());
  const [dateTo, setDateTo] = React.useState(todayYmd());
  const [fgItemId, setFgItemId] = React.useState<number | "">("");
  const [rmItemId, setRmItemId] = React.useState<number | "">("");
  const [varianceType, setVarianceType] = React.useState("ALL");
  const [consumptionType, setConsumptionType] = React.useState("ALL");
  const [thresholdPct, setThresholdPct] = React.useState("5");
  const [highVarianceOnly, setHighVarianceOnly] = React.useState(false);
  const [woNumber, setWoNumber] = useDebouncedUrlStringParam({
    urlValue: read.string("wo"),
    patch,
    paramKey: "wo",
  });
  const [soNumber, setSoNumber] = useDebouncedUrlStringParam({
    urlValue: read.string("so"),
    patch,
    paramKey: "so",
  });
  const [page, setPage] = React.useState(1);
  const [tab, setTab] = React.useState<"detail" | "fg">("detail");

  const [fgItems, setFgItems] = React.useState<ItemOpt[]>([]);
  const [rmItems, setRmItems] = React.useState<ItemOpt[]>([]);
  const [data, setData] = React.useState<ApiResp | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const liveTick = useErpRefreshTick(["reports", "production"], { pollIntervalMs: ERP_REPORT_POLL_MS });

  React.useEffect(() => {
    if (!allowed) return;
    Promise.all([
      apiFetch<ItemOpt[]>("/api/items?type=FG").catch(() => []),
      apiFetch<ItemOpt[]>("/api/items?type=RM").catch(() => []),
    ]).then(([fg, rm]) => {
      setFgItems(fg);
      setRmItems(rm);
    });
  }, [allowed, liveTick]);

  const filterParams = React.useMemo(
    () => ({
      dateFrom,
      dateTo,
      fgItemId: fgItemId === "" ? undefined : fgItemId,
      rmItemId: rmItemId === "" ? undefined : rmItemId,
      varianceType,
      consumptionType,
      thresholdPct,
      highVarianceOnly: highVarianceOnly ? "1" : undefined,
      woNumber: woNumber.trim() || undefined,
      soNumber: soNumber.trim() || undefined,
      page,
      pageSize: 50,
    }),
    [
      dateFrom,
      dateTo,
      fgItemId,
      rmItemId,
      varianceType,
      consumptionType,
      thresholdPct,
      highVarianceOnly,
      woNumber,
      soNumber,
      page,
    ],
  );

  React.useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<ApiResp>(`/api/reports/production-rm-variance${buildQueryString(filterParams)}`)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Failed to load report");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, liveTick, filterParams]);

  React.useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, fgItemId, rmItemId, varianceType, consumptionType, thresholdPct, highVarianceOnly, woNumber, soNumber]);

  const threshold = data?.meta.thresholdPct ?? (Number(thresholdPct) || 5);
  const selectClass = "erp-flow-filter-input h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[13px]";

  async function downloadCsv() {
    try {
      const qs = buildQueryString({ ...filterParams, page: 1, pageSize: 50, export: "csv" });
      const token = localStorage.getItem("token");
      const res = await fetch(getApiUrl(`/api/reports/production-rm-variance${qs}`), {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Export failed");
      const text = await res.text();
      const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `production-rm-variance_${dateFrom}_to_${dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.showSuccess("CSV exported.");
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "CSV export failed");
    }
  }

  function downloadExcel() {
    if (!data) return;
    const esc = (v: unknown) =>
      v == null ? "" : String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const detailRows = data.rows
      .map(
        (r) =>
          `<tr><td>${esc(fmtDate(r.productionDate))}</td><td>${esc(r.workOrderNo)}</td><td>${esc(r.salesOrderNo)}</td><td>${esc(r.fgItemName)}</td><td>${esc(r.rmItemName)}</td><td>${r.producedQty}</td><td>${r.standardQty}</td><td>${r.actualQty}</td><td>${r.varianceQty}</td><td>${esc(fmtPct(r.variancePercent))}</td><td>${esc(r.consumptionType)}</td><td>${esc(r.remarks)}</td><td>${esc(r.approvedByName)}</td></tr>`,
      )
      .join("");
    const rmRows = data.rmSummary
      .map(
        (r) =>
          `<tr><td>${esc(r.itemName)}</td><td>${r.totalStandard}</td><td>${r.totalActual}</td><td>${r.netVariance}</td><td>${esc(fmtPct(r.variancePercent))}</td></tr>`,
      )
      .join("");
    const fgRows = data.fgSummary
      .map(
        (r) =>
          `<tr><td>${esc(r.fgItemName)}</td><td>${r.batchCount}</td><td>${r.totalStandard}</td><td>${r.totalActual}</td><td>${esc(fmtPct(r.variancePercent))}</td></tr>`,
      )
      .join("");
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>
<h3>Production RM Variance (page ${data.meta.page} of ${data.meta.totalPages})</h3>
<p>For full detail export, use Export CSV.</p>
<table border="1"><thead><tr><th>Date</th><th>WO</th><th>SO</th><th>FG</th><th>RM</th><th>Produced</th><th>Standard</th><th>Actual</th><th>Variance</th><th>Var %</th><th>Type</th><th>Remarks</th><th>Approved By</th></tr></thead><tbody>${detailRows}</tbody></table>
<h3>RM Variance Summary</h3>
<table border="1"><thead><tr><th>RM Item</th><th>Total Standard</th><th>Total Actual</th><th>Net Variance</th><th>Var %</th></tr></thead><tbody>${rmRows}</tbody></table>
<h3>FG Consumption Accuracy</h3>
<table border="1"><thead><tr><th>FG Item</th><th>Batches</th><th>Standard RM</th><th>Actual RM</th><th>Net Var %</th></tr></thead><tbody>${fgRows}</tbody></table>
</body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `production-rm-variance_${dateFrom}_to_${dateTo}.xls`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.showSuccess("Excel file exported (current filters; use CSV for full detail).");
  }

  if (!allowed) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-6 py-10 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Not authorized</h2>
        <p className="mt-2 text-sm text-slate-600">This report is available to Admin, Store, and Production roles.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ReportPageHeader
        title="Production RM Variance Report"
        purpose="Compare standard vs actual RM consumption across approved production batches."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => void downloadCsv()}>
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1" disabled={!data} onClick={downloadExcel}>
              <Download className="h-3.5 w-3.5" />
              Export Excel
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Production batches</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{data?.kpis.totalProductionBatches ?? "—"}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">RM lines</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{data?.kpis.totalRmLines ?? "—"}</div>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-wide text-amber-800">Extra usage qty</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-amber-950">
            {data ? fmtQty(data.kpis.extraUsageQty) : "—"}
          </div>
        </div>
        <div className="rounded-md border border-sky-200 bg-sky-50/40 p-3 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-wide text-sky-800">Lower usage qty</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-sky-950">
            {data ? fmtQty(data.kpis.lowerUsageQty) : "—"}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">High variance cases</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-amber-900">
            {data?.kpis.highVarianceCases ?? "—"}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Most consumed RM</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 leading-tight">
            {data?.kpis.mostConsumedRm?.itemName ?? "—"}
          </div>
          {data?.kpis.mostConsumedRm ? (
            <div className="text-[11px] tabular-nums text-slate-600">
              {fmtQty(data.kpis.mostConsumedRm.totalActualQty)}
            </div>
          ) : null}
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Date from
            <Input type="date" className="h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Date to
            <Input type="date" className="h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            FG item
            <select className={selectClass} value={fgItemId === "" ? "" : String(fgItemId)} onChange={(e) => setFgItemId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">All FG</option>
              {fgItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            RM item
            <select className={selectClass} value={rmItemId === "" ? "" : String(rmItemId)} onChange={(e) => setRmItemId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">All RM</option>
              {rmItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            WO number
            <Input className="h-9" value={woNumber} onChange={(e) => setWoNumber(e.target.value)} placeholder="Contains…" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            SO number
            <Input className="h-9" value={soNumber} onChange={(e) => setSoNumber(e.target.value)} placeholder="Contains…" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Consumption difference
            <select className={selectClass} value={varianceType} onChange={(e) => setVarianceType(e.target.value)}>
              <option value="ALL">All</option>
              <option value="EXTRA_USAGE">Extra usage</option>
              <option value="LOWER_USAGE">Lower usage</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Consumption type
            <select className={selectClass} value={consumptionType} onChange={(e) => setConsumptionType(e.target.value)}>
              <option value="ALL">All</option>
              <option value="NORMAL">Normal</option>
              <option value="EXTRA_PROCESS_LOSS">Extra process loss</option>
              <option value="LOWER_USAGE">Lower usage</option>
              <option value="REWORK_RESERVED">Rework (reserved)</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Variance threshold (%)
            <Input type="number" min={0} step="0.1" className="h-9" value={thresholdPct} onChange={(e) => setThresholdPct(e.target.value)} />
          </label>
          <label className="flex items-end gap-2 pb-1 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={highVarianceOnly}
              onChange={(e) => setHighVarianceOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Show only high variance
          </label>
        </CardContent>
      </Card>

      <div className="flex gap-2 border-b border-slate-200">
        <button
          type="button"
          className={cn(
            "px-3 py-1.5 text-sm font-medium",
            tab === "detail" ? "border-b-2 border-slate-800 text-slate-900" : "text-slate-500",
          )}
          onClick={() => setTab("detail")}
        >
          Detail lines
        </button>
        <button
          type="button"
          className={cn(
            "px-3 py-1.5 text-sm font-medium",
            tab === "fg" ? "border-b-2 border-slate-800 text-slate-900" : "text-slate-500",
          )}
          onClick={() => setTab("fg")}
        >
          FG consumption accuracy
        </button>
      </div>

      {error ? <p className="text-sm text-red-800">{error}</p> : null}
      {loading && !data ? <p className="text-sm text-slate-600">Loading…</p> : null}

      {tab === "detail" ? (
        <>
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-0">
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Date</th>
                      <th className="px-2 py-1.5 font-medium">WO</th>
                      <th className="px-2 py-1.5 font-medium">SO</th>
                      <th className="px-2 py-1.5 font-medium">FG item</th>
                      <th className="px-2 py-1.5 font-medium">RM item</th>
                      <th className="px-2 py-1.5 text-right font-medium">Produced</th>
                      <th className="px-2 py-1.5 text-right font-medium">Standard</th>
                      <th className="px-2 py-1.5 text-right font-medium">Actual used</th>
                      <th className="px-2 py-1.5 text-right font-medium">Difference</th>
                      <th className="px-2 py-1.5 font-medium">Type</th>
                      <th className="px-2 py-1.5 font-medium">Remarks</th>
                      <th className="px-2 py-1.5 font-medium">Approved by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.rows ?? []).map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-2 py-1 whitespace-nowrap">{fmtDate(r.productionDate)}</td>
                        <td className="px-2 py-1">{r.workOrderNo ?? "—"}</td>
                        <td className="px-2 py-1">{r.salesOrderNo ?? "—"}</td>
                        <td className="px-2 py-1">{r.fgItemName}</td>
                        <td className="px-2 py-1">{r.rmItemName}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtQty(r.producedQty, r.rmUnit)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtQty(r.standardQty, r.rmUnit)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtQty(r.actualQty, r.rmUnit)}</td>
                        <td className={cn("px-2 py-1 text-right tabular-nums", varianceRowClass(r.variancePercent, r.varianceQty, threshold))}>
                          {fmtQty(r.varianceQty, r.rmUnit)}
                          <span className="block text-[10px]">{fmtPct(r.variancePercent)}</span>
                        </td>
                        <td className="px-2 py-1">
                          {r.consumptionType ? (
                            <Badge variant="default" className="text-[10px] font-normal">
                              {r.consumptionType.replace(/_/g, " ")}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-1 max-w-[8rem] truncate" title={r.remarks ?? ""}>
                          {r.remarks ?? "—"}
                        </td>
                        <td className="px-2 py-1">{r.approvedByName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && data && data.rows.length === 0 ? (
                  <p className="p-4 text-center text-sm text-slate-500">No consumption records for these filters.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {data && data.meta.totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">
                Page {data.meta.page} of {data.meta.totalPages} ({data.meta.total} lines)
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= data.meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-800">RM variance summary</CardTitle>
              <p className="text-xs text-slate-500">Grouped by RM item (all matching lines, not only current page).</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-2 py-1 font-medium">RM item</th>
                      <th className="px-2 py-1 text-right font-medium">Total standard</th>
                      <th className="px-2 py-1 text-right font-medium">Total actual</th>
                      <th className="px-2 py-1 text-right font-medium">Net difference</th>
                      <th className="px-2 py-1 text-right font-medium">Difference %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.rmSummary ?? []).map((r) => (
                      <tr key={r.itemId} className="border-t border-slate-100">
                        <td className="px-2 py-0.5">{r.itemName}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtQty(r.totalStandard, r.unit)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtQty(r.totalActual, r.unit)}</td>
                        <td className={cn("px-2 py-0.5 text-right tabular-nums", varianceRowClass(r.variancePercent, r.netVariance, threshold))}>
                          {fmtQty(r.netVariance, r.unit)}
                        </td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtPct(r.variancePercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-800">FG consumption accuracy</CardTitle>
            <p className="text-xs text-slate-500">Finished goods vs total RM standard and actual for matching batches.</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">FG item</th>
                    <th className="px-2 py-1.5 text-right font-medium">Batches</th>
                    <th className="px-2 py-1.5 text-right font-medium">Standard RM</th>
                    <th className="px-2 py-1.5 text-right font-medium">Actual RM</th>
                    <th className="px-2 py-1.5 text-right font-medium">Net difference %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.fgSummary ?? []).map((r) => (
                    <tr key={r.fgItemId} className="border-t border-slate-100">
                      <td className="px-2 py-1">{r.fgItemName}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.batchCount}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtQty(r.totalStandard, r.fgUnit)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtQty(r.totalActual, r.fgUnit)}</td>
                      <td className={cn("px-2 py-1 text-right tabular-nums", varianceRowClass(r.variancePercent, r.netVariance, threshold))}>
                        {fmtPct(r.variancePercent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
