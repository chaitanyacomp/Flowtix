/**
 * Phase 4 — Production Wastage Type Analysis (Lane C).
 * Groups CONFIRMED Production Report classification by Wastage Type / Category.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ReportPageHeader } from "../components/PageHeader";
import { ReportPageShell } from "../components/erp/ReportChrome";
import {
  ReportPrintExportBar,
  ReportPrintMeta,
  downloadReportExcel,
} from "../components/erp/ReportPrintExport";
import { useToast } from "../contexts/ToastContext";
import { sanitizeReportUiError } from "../lib/reportUiError";
import { useAuth } from "../hooks/useAuth";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { useStablePageData } from "../hooks/useStablePageData";
import { ReportResultsLoadGate } from "../components/erp/foundation/ReportResultsLoadGate";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { apiFetch } from "../services/api";
import { formatQuantityWithUnit } from "../lib/quantityDisplay";
import { WASTAGE_TYPE_CATEGORIES, fetchWastageTypes, type WastageTypeRow } from "../lib/wastageTypeApi";
import {
  downloadProductionWastageCsv,
  fetchProductionWastageTypeSummary,
  type ProductionWastageAnalysisResponse,
  type TypeSummaryRow,
} from "../lib/productionWastageAnalysisApi";

type ItemOpt = { id: number; itemName: string };
type CustomerOpt = { id: number; name: string };

const URL_OMIT: Record<string, string> = {
  category: "",
  wastageTypeId: "",
  fgItemId: "",
  rmItemId: "",
  customerId: "",
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstDayOfMonthYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function fmtQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatQuantityWithUnit(n, "");
}

function reportAllowed(role: string | undefined): boolean {
  return role === "ADMIN" || role === "STORE" || role === "PRODUCTION" || role === "PURCHASE";
}

const selectClass = "erp-flow-filter-input h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[12px]";

function buildWoDrillHref(row: TypeSummaryRow, filters: Record<string, string>): string {
  const qs = new URLSearchParams();
  qs.set("wastageTypeId", String(row.wastageTypeId));
  for (const [k, v] of Object.entries(filters)) {
    if (v) qs.set(k, v);
  }
  return `/reports/production-wastage-wo?${qs.toString()}`;
}

export function ProductionWastageByTypeReportPage() {
  const auth = useAuth();
  const toast = useToast();
  const allowed = reportAllowed(auth.user?.role);
  const { read, patch } = useUrlQueryState(URL_OMIT);

  const [dateFrom, setDateFrom] = React.useState(read.string("dateFrom") || firstDayOfMonthYmd());
  const [dateTo, setDateTo] = React.useState(read.string("dateTo") || todayYmd());
  const [woNumber, setWoNumber] = useDebouncedUrlStringParam({
    urlValue: read.string("wo"),
    patch,
    paramKey: "wo",
  });
  const wastageTypeId = read.string("wastageTypeId");
  const category = read.string("category");
  const fgItemId = read.string("fgItemId");
  const rmItemId = read.string("rmItemId");
  const customerId = read.string("customerId");

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      patch({ dateFrom: dateFrom || null, dateTo: dateTo || null });
    }, 200);
    return () => window.clearTimeout(t);
  }, [dateFrom, dateTo, patch]);

  const [page, setPage] = React.useState(1);
  const [sortField, setSortField] = React.useState("totalWastageQty");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [types, setTypes] = React.useState<WastageTypeRow[]>([]);
  const [fgItems, setFgItems] = React.useState<ItemOpt[]>([]);
  const [rmItems, setRmItems] = React.useState<ItemOpt[]>([]);
  const [customers, setCustomers] = React.useState<CustomerOpt[]>([]);

  const liveTick = useErpRefreshTick(["reports", "production"], { pollIntervalMs: ERP_REPORT_POLL_MS });

  React.useEffect(() => {
    if (!allowed) return;
    Promise.all([
      fetchWastageTypes(true).catch(() => []),
      apiFetch<ItemOpt[]>("/api/items?type=FG").catch(() => []),
      apiFetch<ItemOpt[]>("/api/items?type=RM").catch(() => []),
      apiFetch<CustomerOpt[]>("/api/customers").catch(() => []),
    ]).then(([t, fg, rm, cust]) => {
      setTypes(t);
      setFgItems(fg);
      setRmItems(rm);
      setCustomers(Array.isArray(cust) ? cust : []);
    });
  }, [allowed, liveTick]);

  React.useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, woNumber, wastageTypeId, category, fgItemId, rmItemId, customerId, liveTick]);

  const filterParams = React.useMemo(
    () => ({
      fromDate: dateFrom || undefined,
      toDate: dateTo || undefined,
      woNumber: woNumber.trim() || undefined,
      wastageTypeId: wastageTypeId || undefined,
      category: category || undefined,
      fgItemId: fgItemId || undefined,
      rmItemId: rmItemId || undefined,
      customerId: customerId || undefined,
      page,
      pageSize: 50,
      sortField,
      sortDir,
    }),
    [dateFrom, dateTo, woNumber, wastageTypeId, category, fgItemId, rmItemId, customerId, page, sortField, sortDir],
  );

  const {
    data,
    error: loadError,
    firstLoadDone,
    loading,
  } = useStablePageData<ProductionWastageAnalysisResponse<TypeSummaryRow>>({
    enabled: allowed,
    scopes: ["reports", "production"],
    pollIntervalMs: ERP_REPORT_POLL_MS,
    deps: [dateFrom, dateTo, woNumber, wastageTypeId, category, fgItemId, rmItemId, customerId, page, sortField, sortDir],
    fetcher: (signal) => fetchProductionWastageTypeSummary(filterParams, { signal }),
  });

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  async function onExportCsv() {
    try {
      await downloadProductionWastageCsv(
        "type-summary",
        filterParams,
        `production-wastage-by-type_${dateFrom}_to_${dateTo}.csv`,
      );
      toast.showSuccess("CSV exported");
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "CSV export failed");
    }
  }

  async function onExportExcel() {
    try {
      const all = await fetchProductionWastageTypeSummary({
        ...filterParams,
        export: "all",
        page: 1,
        pageSize: 100000,
      });
      downloadReportExcel(
        `production-wastage-by-type_${dateFrom}_to_${dateTo}.xlsx`,
        "Type Analysis",
        [
          "Wastage Type",
          "Category",
          "Total Wastage Qty",
          "Share of Total %",
          "Work Order Count",
          "Production Report Count",
          "Avg Wastage per WO",
          "Avg Wastage %",
          "Highest Wastage WO",
          "Highest Wastage Qty",
          "Lowest Non-zero WO",
          "Lowest Non-zero Qty",
        ],
        (all.rows || []).map((r) => [
          r.wastageTypeName,
          r.category,
          r.totalWastageQty,
          r.shareOfTotalWastagePct,
          r.workOrderCount,
          r.productionReportCount,
          r.averageWastagePerWo,
          r.averageWastagePct,
          r.highestWastageWoNo,
          r.highestWastageQty,
          r.lowestNonZeroWastageWoNo,
          r.lowestNonZeroWastageQty,
        ]),
      );
      toast.showSuccess("Excel exported");
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "Excel export failed");
    }
  }

  if (!allowed) {
    return <div className="p-4 text-sm text-slate-600">Access denied.</div>;
  }

  const rows = data?.rows ?? [];
  const kpis = data?.kpis ?? {};
  const pagination = data?.pagination;
  const filterSummary = [
    dateFrom ? `From ${dateFrom}` : null,
    dateTo ? `To ${dateTo}` : null,
    category || null,
    wastageTypeId ? `Type #${wastageTypeId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const drillFilters = {
    dateFrom,
    dateTo,
    wo: woNumber,
    category,
    fgItemId,
    rmItemId,
    customerId,
  };

  return (
    <ReportPageShell>
      <ReportPrintMeta
        title="Production Wastage — Type Analysis"
        filterSummary={filterSummary}
        kpiSummary={`Types ${kpis.wastageTypeCount ?? 0} · Wastage ${kpis.totalWastageQty ?? 0}`}
      />
      <ReportPageHeader
        title="Production Wastage — Type Analysis"
        purpose="Aggregates Lane C Production Report wastage classification by type and category. Drill into WO Analysis for detail. Cost columns deferred until valuation policy approval."
        actions={
          <ReportPrintExportBar
            filterSummary={filterSummary}
            onExportCsv={() => void onExportCsv()}
            onExportExcel={() => void onExportExcel()}
            csvDisabled={loading}
            excelDisabled={loading}
          />
        }
      />

      <div className="erp-no-print grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Wastage Types", value: String(kpis.wastageTypeCount ?? 0) },
          { label: "Total Wastage Qty", value: fmtQty(Number(kpis.totalWastageQty ?? 0)) },
          { label: "Work Orders", value: String(kpis.workOrderCount ?? 0) },
          { label: "Reports", value: String(kpis.reportCount ?? 0) },
        ].map((k) => (
          <Card key={k.label} className="border-slate-200 shadow-none">
            <CardContent className="px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{k.label}</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="erp-no-print border-slate-200 shadow-sm">
        <CardContent className="flex flex-wrap gap-2 p-3 text-[12px]">
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">From</span>
            <Input type="date" className="h-8 w-36" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">To</span>
            <Input type="date" className="h-8 w-36" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">WO no.</span>
            <Input className="h-8 w-32" value={woNumber} onChange={(e) => setWoNumber(e.target.value)} placeholder="WO-R-26-" />
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">Customer</span>
            <select className={`${selectClass} w-40`} value={customerId} onChange={(e) => patch({ customerId: e.target.value })}>
              <option value="">All</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">FG</span>
            <select className={`${selectClass} w-40`} value={fgItemId} onChange={(e) => patch({ fgItemId: e.target.value })}>
              <option value="">All</option>
              {fgItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">RM</span>
            <select className={`${selectClass} w-40`} value={rmItemId} onChange={(e) => patch({ rmItemId: e.target.value })}>
              <option value="">All</option>
              {rmItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">Type</span>
            <select
              className={`${selectClass} w-40`}
              value={wastageTypeId}
              onChange={(e) => patch({ wastageTypeId: e.target.value })}
            >
              <option value="">All</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {!t.isActive ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">Category</span>
            <select className={`${selectClass} w-36`} value={category} onChange={(e) => patch({ category: e.target.value })}>
              <option value="">All</option>
              {WASTAGE_TYPE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      {loadError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {sanitizeReportUiError(loadError)}
        </div>
      ) : null}

      <div className="overflow-auto rounded-md border border-slate-200">
        <ReportResultsLoadGate
          firstLoadDone={firstLoadDone}
          loading={loading}
          hasDisplayData={data != null}
          isEmpty={rows.length === 0}
          error={
            loadError && data == null ? (
              <div className="px-3 py-6 text-center text-sm text-red-700">{sanitizeReportUiError(loadError)}</div>
            ) : null
          }
          emptyState={
            <div className="px-3 py-6 text-center text-sm text-slate-500">No classification totals for the selected filters.</div>
          }
        >
          <table className="w-full min-w-[960px] border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              {(
                [
                  ["wastageTypeName", "Wastage Type"],
                  ["category", "Category"],
                  ["totalWastageQty", "Total Wastage Qty"],
                  ["shareOfTotalWastagePct", "Share %"],
                  ["workOrderCount", "WO Count"],
                  ["productionReportCount", "Report Count"],
                  ["averageWastagePerWo", "Avg / WO"],
                  ["averageWastagePct", "Avg Wastage %"],
                  ["highestWastageWoNo", "Highest WO"],
                  ["highestWastageQty", "Highest Qty"],
                  ["lowestNonZeroWastageWoNo", "Lowest Non-zero WO"],
                  ["lowestNonZeroWastageQty", "Lowest Qty"],
                ] as Array<[string, string]>
              ).map(([field, label]) => (
                <th key={field} className="cursor-pointer whitespace-nowrap px-2 py-1.5" onClick={() => toggleSort(field)}>
                  {label}
                  {sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.wastageTypeId} className="border-b border-slate-100 hover:bg-slate-50/80">
                <td className="px-2 py-1.5 font-medium">
                  <Link
                    className="text-sky-700 underline-offset-2 hover:underline"
                    to={buildWoDrillHref(r, drillFilters)}
                  >
                    {r.wastageTypeName}
                    {r.isActiveType === false ? " (inactive)" : ""}
                  </Link>
                </td>
                <td className="px-2 py-1.5">{r.category || "—"}</td>
                <td className="px-2 py-1.5 tabular-nums font-medium">{fmtQty(r.totalWastageQty)}</td>
                <td className="px-2 py-1.5 tabular-nums">{fmtPct(r.shareOfTotalWastagePct)}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.workOrderCount}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.productionReportCount}</td>
                <td className="px-2 py-1.5 tabular-nums">{fmtQty(r.averageWastagePerWo)}</td>
                <td className="px-2 py-1.5 tabular-nums">{fmtPct(r.averageWastagePct)}</td>
                <td className="px-2 py-1.5">{r.highestWastageWoNo || "—"}</td>
                <td className="px-2 py-1.5 tabular-nums">{fmtQty(r.highestWastageQty)}</td>
                <td className="px-2 py-1.5">{r.lowestNonZeroWastageWoNo || "—"}</td>
                <td className="px-2 py-1.5 tabular-nums">{fmtQty(r.lowestNonZeroWastageQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </ReportResultsLoadGate>
      </div>

      {pagination && pagination.totalPages > 1 ? (
        <div className="erp-no-print flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} types
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </ReportPageShell>
  );
}
