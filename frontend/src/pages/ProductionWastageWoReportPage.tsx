/**
 * Phase 3 — Production Wastage WO Analysis (Lane C).
 * Source: CONFIRMED Production Work Order Reports + classification details.
 * Distinct from RM Wastage (MWN), Production RM Variance, and FG Scrap.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ReportPageHeader } from "../components/PageHeader";
import {
  ReportPrintExportBar,
  ReportPrintMeta,
  downloadReportExcel,
} from "../components/erp/ReportPrintExport";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { apiFetch } from "../services/api";
import { formatQuantityWithUnit } from "../lib/quantityDisplay";
import { WASTAGE_TYPE_CATEGORIES, fetchWastageTypes, type WastageTypeRow } from "../lib/wastageTypeApi";
import {
  downloadProductionWastageCsv,
  fetchProductionWastageWoDetail,
  type ProductionWastageAnalysisResponse,
  type WoDetailRow,
} from "../lib/productionWastageAnalysisApi";

type ItemOpt = { id: number; itemName: string; unit?: string };
type CustomerOpt = { id: number; name: string };

const URL_OMIT: Record<string, string> = {
  category: "",
  wastageTypeId: "",
  fgItemId: "",
  rmItemId: "",
  customerId: "",
  salesOrderId: "",
  workOrderId: "",
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstDayOfMonthYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function fmtQty(n: number | null | undefined, unit?: string | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatQuantityWithUnit(n, unit || "");
}

function reportAllowed(role: string | undefined): boolean {
  return role === "ADMIN" || role === "STORE" || role === "PRODUCTION" || role === "PURCHASE";
}

const selectClass = "erp-flow-filter-input h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[12px]";

export function ProductionWastageWoReportPage() {
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
  const salesOrderId = read.string("salesOrderId");
  const workOrderId = read.string("workOrderId");

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      patch({ dateFrom: dateFrom || null, dateTo: dateTo || null });
    }, 200);
    return () => window.clearTimeout(t);
  }, [dateFrom, dateTo, patch]);

  const [page, setPage] = React.useState(1);
  const [sortField, setSortField] = React.useState("reportDate");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [data, setData] = React.useState<ProductionWastageAnalysisResponse<WoDetailRow> | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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
  }, [dateFrom, dateTo, woNumber, wastageTypeId, category, fgItemId, rmItemId, customerId, salesOrderId, workOrderId, liveTick]);

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
      salesOrderId: salesOrderId || undefined,
      workOrderId: workOrderId || undefined,
      page,
      pageSize: 50,
      sortField,
      sortDir,
    }),
    [
      dateFrom,
      dateTo,
      woNumber,
      wastageTypeId,
      category,
      fgItemId,
      rmItemId,
      customerId,
      salesOrderId,
      workOrderId,
      page,
      sortField,
      sortDir,
    ],
  );

  React.useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProductionWastageWoDetail(filterParams)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          const msg = e instanceof Error ? e.message : "Failed to load WO wastage report";
          setError(msg);
          toast.showError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, liveTick, filterParams, toast]);

  function toggleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "reportDate" || field === "wastageQty" ? "desc" : "asc");
    }
  }

  async function onExportCsv() {
    try {
      await downloadProductionWastageCsv("wo-detail", filterParams, `production-wastage-wo_${dateFrom}_to_${dateTo}.csv`);
      toast.showSuccess("CSV exported");
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "CSV export failed");
    }
  }

  async function onExportExcel() {
    try {
      const all = await fetchProductionWastageWoDetail({ ...filterParams, export: "all", page: 1, pageSize: 100000 });
      downloadReportExcel(
        `production-wastage-wo_${dateFrom}_to_${dateTo}.xlsx`,
        "WO Wastage",
        [
          "Report Date",
          "WO No",
          "Sales Order",
          "Customer",
          "FG Item",
          "RM Item",
          "Planned Consumption",
          "Issued Qty",
          "Returned Qty",
          "Actual Consumed Qty",
          "FG Produced Qty",
          "Wastage Qty",
          "Wastage %",
          "Yield %",
          "Wastage Type",
          "Category",
          "Reason / Remarks",
          "Production Report Ref",
          "Status",
        ],
        (all.rows || []).map((r) => [
          fmtDate(r.reportDate),
          r.workOrderNo,
          r.salesOrderNo,
          r.customerName,
          r.fgItemName,
          r.rmItemName,
          r.plannedConsumption,
          r.issuedQty,
          r.returnedQty,
          r.actualConsumedQty,
          r.fgProducedQty,
          r.wastageQty,
          r.wastagePct,
          r.yieldPct,
          r.wastageTypeLabel,
          r.categoryLabel,
          r.remarks,
          r.productionReportRef,
          r.status,
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
    woNumber.trim() ? `WO ${woNumber.trim()}` : null,
    wastageTypeId ? `Type #${wastageTypeId}` : null,
    category || null,
    customerId ? `Customer #${customerId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const kpiSummary = `Reports ${kpis.reportCount ?? 0} · WO ${kpis.workOrderCount ?? 0} · Wastage ${kpis.totalWastageQty ?? 0}`;

  return (
    <div className="erp-report-page mx-auto max-w-[1400px] space-y-3 p-4">
      <ReportPrintMeta title="Production Wastage — WO Analysis" filterSummary={filterSummary} kpiSummary={kpiSummary} />
      <ReportPageHeader
        title="Production Wastage — WO Analysis"
        purpose="CONFIRMED Production Work Order Report classification (Lane C). Not RM Wastage Notes, not Production RM Variance, not FG Scrap. Returns are excluded from wastage. Material Cost Loss deferred pending valuation policy."
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

      <div className="erp-no-print grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Reports", value: String(kpis.reportCount ?? 0) },
          { label: "Work Orders", value: String(kpis.workOrderCount ?? 0) },
          { label: "Issued", value: fmtQty(Number(kpis.totalIssuedQty ?? 0)) },
          { label: "Returned", value: fmtQty(Number(kpis.totalReturnedQty ?? 0)) },
          { label: "Wastage", value: fmtQty(Number(kpis.totalWastageQty ?? 0)) },
          { label: "Avg Wastage %", value: fmtPct(kpis.averageWastagePct as number | null) },
        ].map((k) => (
          <Card key={k.label} className="border-slate-200 shadow-none">
            <CardContent className="px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{k.label}</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="erp-no-print rounded-md border border-amber-100 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900">
        Material Cost Loss: deferred (pending RM valuation policy). Lane boundaries preserved — MWN and FG Scrap are not included in these totals.
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
            <Input className="h-8 w-32" value={woNumber} onChange={(e) => setWoNumber(e.target.value)} placeholder="WO-26-" />
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
            <span className="font-medium text-slate-600">FG item</span>
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
            <span className="font-medium text-slate-600">RM item</span>
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
            <span className="font-medium text-slate-600">Wastage type</span>
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
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">SO id</span>
            <Input
              className="h-8 w-24"
              value={salesOrderId}
              onChange={(e) => patch({ salesOrderId: e.target.value })}
              placeholder="id"
            />
          </label>
        </CardContent>
      </Card>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <div className="overflow-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[1200px] border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              {(
                [
                  ["reportDate", "Report Date", true],
                  ["workOrderNo", "WO No.", true],
                  ["salesOrderNo", "Sales Order", true],
                  ["customerName", "Customer", false],
                  ["fgItemName", "FG Item", false],
                  ["rmItemName", "RM Item", false],
                  ["plannedConsumption", "Planned", false],
                  ["issuedQty", "Issued", false],
                  ["returnedQty", "Returned", false],
                  ["actualConsumedQty", "Consumed", false],
                  ["fgProducedQty", "FG Produced", false],
                  ["wastageQty", "Wastage", false],
                  ["wastagePct", "Wastage %", false],
                  ["yieldPct", "Yield %", false],
                  ["wastageTypeLabel", "Wastage Type", false],
                  ["categoryLabel", "Category", false],
                  ["remarks", "Remarks", false],
                  ["productionReportRef", "Report Ref", false],
                  ["status", "Status", false],
                ] as Array<[string, string, boolean]>
              ).map(([field, label, frozen]) => (
                <th
                  key={field}
                  className={`cursor-pointer whitespace-nowrap px-2 py-1.5 ${frozen ? "sticky left-0 z-20 bg-slate-50" : ""} ${
                    field === "workOrderNo" ? "left-[6.5rem]" : ""
                  }`}
                  onClick={() => toggleSort(field)}
                >
                  {label}
                  {sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={19} className="px-3 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={19} className="px-3 py-6 text-center text-slate-500">
                  No confirmed production wastage rows for the selected filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.reportId}-${r.rmItemId}`} className="border-b border-slate-100 hover:bg-slate-50/80">
                  <td className="sticky left-0 z-[1] bg-white px-2 py-1.5 whitespace-nowrap">{fmtDate(r.reportDate)}</td>
                  <td className="sticky left-[6.5rem] z-[1] bg-white px-2 py-1.5 font-medium">
                    {r.drillDown.hrefWorkOrder ? (
                      <Link className="text-sky-700 underline-offset-2 hover:underline" to={r.drillDown.hrefWorkOrder}>
                        {r.workOrderNo}
                      </Link>
                    ) : (
                      r.workOrderNo || "—"
                    )}
                  </td>
                  <td className="px-2 py-1.5">{r.salesOrderNo || "—"}</td>
                  <td className="px-2 py-1.5">{r.customerName || "—"}</td>
                  <td className="px-2 py-1.5">{r.fgItemName || "—"}</td>
                  <td className="px-2 py-1.5">{r.rmItemName}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtQty(r.plannedConsumption, r.rmUnit)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtQty(r.issuedQty, r.rmUnit)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtQty(r.returnedQty, r.rmUnit)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtQty(r.actualConsumedQty, r.rmUnit)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtQty(r.fgProducedQty, r.fgUnit)}</td>
                  <td className="px-2 py-1.5 tabular-nums font-medium">{fmtQty(r.wastageQty, r.rmUnit)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtPct(r.wastagePct)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtPct(r.yieldPct)}</td>
                  <td className="px-2 py-1.5">{r.wastageTypeLabel || "—"}</td>
                  <td className="px-2 py-1.5">{r.categoryLabel || "—"}</td>
                  <td className="max-w-[10rem] truncate px-2 py-1.5" title={r.remarks || undefined}>
                    {r.remarks || "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.drillDown.hrefProductionReport ? (
                      <Link
                        className="text-sky-700 underline-offset-2 hover:underline"
                        to={r.drillDown.hrefProductionReport}
                      >
                        {r.productionReportRef}
                      </Link>
                    ) : (
                      r.productionReportRef
                    )}
                  </td>
                  <td className="px-2 py-1.5">{r.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 ? (
        <div className="erp-no-print flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} rows
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
    </div>
  );
}
