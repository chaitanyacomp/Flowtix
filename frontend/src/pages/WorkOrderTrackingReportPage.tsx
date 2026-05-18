import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { ROW_NUM_EPS, dashboardToneToBadgeVariant, maxInSlice } from "../lib/dispatchBacklog";
import { getDrillRowProps, withReportsReturnContext, workOrdersFocusHref } from "../lib/drillDownRoutes";
import { woTrackingStatusTone } from "../lib/reportStatusTones";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { useDrillActivable } from "../hooks/useDrillAccess";
import { ReportPageHeader } from "../components/PageHeader";
import {
  type WoTrackingRow,
  type WoTrackingSummary,
  normalizeWoTrackingApiResponse,
} from "../lib/woTrackingResponse";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";

type Customer = { id: number; name: string };

const TRACKING_STATUSES = [
  "PENDING_PRODUCTION",
  "IN_PRODUCTION",
  "PENDING_QC",
  "PARTIAL_QC",
  "READY_TO_DISPATCH",
  "PARTIAL_DISPATCH",
  "COMPLETED",
] as const;

type SortKey = "soDate" | "woDate" | "prodPending" | "qcPending" | "dispatchPending";

const DEFAULT_SORT: SortKey = "soDate";
const DEFAULT_SORT_DIR: "asc" | "desc" = "asc";

function woTrackingReportAllowed(role: string | undefined): boolean {
  return role === "ADMIN" || role === "PRODUCTION";
}

export function WorkOrderTrackingReportPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const allowed = woTrackingReportAllowed(auth.user?.role);
  const canDrillWorkOrder = useDrillActivable("work-order");
  const [rows, setRows] = React.useState<WoTrackingRow[]>([]);
  const [reportSummary, setReportSummary] = React.useState<WoTrackingSummary | null>(null);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [customerName, setCustomerName] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [search, setSearch] = React.useState("");

  const [sortBy, setSortBy] = React.useState<SortKey>(DEFAULT_SORT);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">(DEFAULT_SORT_DIR);
  const liveTick = useErpRefreshTick(["reports", "production", "workorders", "qc", "dispatch"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });

  React.useEffect(() => {
    if (!allowed) return;
    apiFetch<Customer[]>("/api/customers")
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, [allowed, liveTick]);

  React.useEffect(() => {
    if (!allowed) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    apiFetch<unknown>("/api/reports/work-order-tracking")
      .then((raw) => {
        if (mounted) {
          const data = normalizeWoTrackingApiResponse(raw);
          setRows(data.rows);
          setReportSummary(data.summary);
          setError(null);
        }
      })
      .catch((e) => {
        if (mounted) {
          setRows([]);
          setReportSummary(null);
          setError(e instanceof Error ? e.message : "Failed to load work order tracking");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [allowed, liveTick]);

  React.useEffect(() => {
    if (!allowed) setLoading(false);
  }, [allowed]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (customerName && r.customerName !== customerName) return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      const ymd = r.workOrderDate.slice(0, 10);
      if (dateFrom && ymd < dateFrom) return false;
      if (dateTo && ymd > dateTo) return false;
      if (q) {
        const hit =
          r.salesOrderNo.toLowerCase().includes(q) ||
          r.workOrderNo.toLowerCase().includes(q) ||
          r.itemName.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, customerName, statusFilter, dateFrom, dateTo, search]);

  const sorted = React.useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "soDate") {
        cmp = new Date(a.salesOrderDate).getTime() - new Date(b.salesOrderDate).getTime();
      } else if (sortBy === "woDate") {
        cmp = new Date(a.workOrderDate).getTime() - new Date(b.workOrderDate).getTime();
      } else if (sortBy === "prodPending") {
        cmp = a.productionPendingQty - b.productionPendingQty;
      } else if (sortBy === "qcPending") {
        cmp = a.qcPendingQty - b.qcPendingQty;
      } else {
        cmp = a.dispatchPendingQty - b.dispatchPendingQty;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [filtered, sortBy, sortDir]);

  const hasActiveFilters =
    customerName !== "" || statusFilter !== "ALL" || dateFrom !== "" || dateTo !== "" || search.trim() !== "";
  const sortDiffers = sortBy !== DEFAULT_SORT || sortDir !== DEFAULT_SORT_DIR;
  const canClear = hasActiveFilters || sortDiffers;

  function clearFilters() {
    setCustomerName("");
    setStatusFilter("ALL");
    setDateFrom("");
    setDateTo("");
    setSearch("");
    setSortBy(DEFAULT_SORT);
    setSortDir(DEFAULT_SORT_DIR);
  }

  function toggleSortDir() {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }

  function onExport() {
    toast.showInfo("Export to Excel will be available in a future update.");
  }

  function onRowActivate(r: WoTrackingRow) {
    navigate(withReportsReturnContext(workOrdersFocusHref(r.workOrderId)));
  }

  const selectClass =
    "h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 shadow-sm";

  function sortHeaderClass(active: boolean): string {
    return cn(
      "transition-colors",
      active &&
        "bg-slate-100 font-semibold text-slate-900 ring-1 ring-inset ring-slate-300 shadow-[inset_0_-2px_0_0_rgb(51_65_85)]",
    );
  }

  function pendingTripleEmphasis(r: WoTrackingRow): "high" | "medium" | "low" {
    const maxP = maxInSlice(sorted.map((x) => x.productionPendingQty));
    const maxQ = maxInSlice(sorted.map((x) => x.qcPendingQty));
    const maxD = maxInSlice(sorted.map((x) => x.dispatchPendingQty));
    const hi =
      (maxP > ROW_NUM_EPS && r.productionPendingQty >= maxP * 0.55) ||
      (maxQ > ROW_NUM_EPS && r.qcPendingQty >= maxQ * 0.55) ||
      (maxD > ROW_NUM_EPS && r.dispatchPendingQty >= maxD * 0.55);
    const any = r.productionPendingQty > ROW_NUM_EPS || r.qcPendingQty > ROW_NUM_EPS || r.dispatchPendingQty > ROW_NUM_EPS;
    if (hi) return "high";
    if (any) return "medium";
    return "low";
  }

  if (!allowed) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-6 py-10 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Not authorized</h2>
        <p className="mt-2 text-sm text-slate-600">
          You don&apos;t have permission to view the Work Order Tracking report. If you need access, contact an administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ReportPageHeader
        title="Work Order Tracking Report"
        purpose="Tracks each work order’s current stage, quantity progress, and pending next action."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Open WO lines</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {reportSummary?.openWoLines ?? "—"}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending production qty</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">
            {reportSummary != null ? reportSummary.pendingProductionQtySum.toFixed(3) : "—"}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending QC qty</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">
            {reportSummary != null ? reportSummary.pendingQcQtySum.toFixed(3) : "—"}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending dispatch qty</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {reportSummary != null ? reportSummary.pendingDispatchQtySum.toFixed(3) : "—"}
          </div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
          <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={!canClear} onClick={clearFilters}>
            Clear filters
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Customer
            <select
              className={selectClass}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              aria-label="Filter by customer"
            >
              <option value="">All customers</option>
              {customers.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Operational status
            <select
              className={selectClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by pipeline status"
            >
              <option value="ALL">All statuses</option>
              {TRACKING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            WO Date From <span className="font-normal text-slate-400">(WO created)</span>
            <Input type="date" className="h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>

          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            WO Date To <span className="font-normal text-slate-400">(WO created)</span>
            <Input type="date" className="h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2 lg:col-span-4">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Search</span>
            <Input
              className="h-10 border-slate-300 bg-white text-sm font-medium shadow-sm placeholder:font-normal placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-slate-300"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SO no, WO no, item, or customer…"
              aria-label="Search"
            />
          </label>
        </CardContent>
      </Card>

      <p className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2 text-xs leading-relaxed text-slate-600">
        <span className="font-medium text-slate-700">Dispatch on this report:</span> shipments are booked in the system by{" "}
        <span className="font-medium text-slate-800">sales order + item</span>, not by work order line. If more than one WO line
        covers the same item on the same order, we split that shipped quantity across lines in{" "}
        <span className="font-medium text-slate-800">line order</span> for reporting so totals stay correct and you can still read
        per-line progress. This is a presentation rule only — it does not change how dispatch is stored.
      </p>

      <Card className="flex min-h-0 flex-col border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-2">
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="text-sm font-semibold text-slate-800">Work order lines</CardTitle>
            <p className="text-xs text-slate-500">One row per WO line — production, QC, and dispatch are rolled up per line</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500">Sort</span>
              <select
                className={cn(selectClass, "h-8 w-[11rem]")}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                aria-label="Sort by"
              >
                <option value="soDate">Sales order date</option>
                <option value="woDate">Work order date</option>
                <option value="prodPending">Production pending</option>
                <option value="qcPending">QC pending</option>
                <option value="dispatchPending">Dispatch pending</option>
              </select>
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={toggleSortDir}>
                {sortDir === "asc" ? "Asc ↑" : "Desc ↓"}
              </Button>
              <span className="hidden text-xs text-slate-500 sm:inline" aria-live="polite">
                Active sort:{" "}
                <span className="font-semibold text-slate-800">
                  {sortBy === "soDate"
                    ? "Sales order date"
                    : sortBy === "woDate"
                      ? "Work order date"
                      : sortBy === "prodPending"
                        ? "Production pending"
                        : sortBy === "qcPending"
                          ? "QC pending"
                          : "Dispatch pending"}{" "}
                  · {sortDir === "asc" ? "ascending" : "descending"}
                </span>
              </span>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onExport}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-col p-0">
          {error ? (
            <div className="border-t border-slate-200 px-4 py-8 text-sm text-red-700">{error}</div>
          ) : loading ? (
            <div className="border-t border-slate-200 px-4 py-8 text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="border-t border-slate-200 px-4 py-10">
              <p className="text-sm font-medium text-slate-800">No work order tracking rows</p>
              <p className="mt-1 max-w-md text-xs text-slate-500">There are no work order lines to show yet.</p>
            </div>
          ) : sorted.length === 0 ? (
            <div className="border-t border-slate-200 px-4 py-10">
              <p className="text-sm font-medium text-slate-800">No matching work order tracking rows</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                Adjust or clear filters — try a wider WO date range, reset customer or status, or shorten the search. Sort order
                does not hide rows.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-4 h-8" disabled={!canClear} onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <>
              <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2.5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Work order tracking</p>
                <p className="mt-0.5 text-sm text-slate-700">
                  {hasActiveFilters ? (
                    <>
                      Showing <span className="font-semibold tabular-nums text-slate-900">{sorted.length}</span> of{" "}
                      <span className="tabular-nums text-slate-600">{rows.length}</span> rows
                    </>
                  ) : (
                    <>
                      Showing <span className="font-semibold tabular-nums text-slate-900">{sorted.length}</span> row
                      {sorted.length === 1 ? "" : "s"} <span className="text-slate-500">(full list)</span>
                    </>
                  )}
                </p>
              </div>
              <div className="max-h-[min(70vh,720px)] min-h-0 overflow-auto border-t border-slate-200">
                <div className="erp-table-wrap border-0">
                  <table className="erp-table min-w-[1200px] text-xs sm:text-sm">
                    <thead className="sticky top-0 z-[1] shadow-[0_1px_0_0_rgb(226_232_240)] [&_th]:bg-slate-50">
                      <tr>
                        <th
                          className={sortHeaderClass(sortBy === "soDate")}
                          aria-sort={sortBy === "soDate" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            SO No
                            {sortBy === "soDate" ? (
                              sortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th>Customer</th>
                        <th
                          className={sortHeaderClass(sortBy === "woDate")}
                          aria-sort={sortBy === "woDate" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            WO No
                            {sortBy === "woDate" ? (
                              sortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th>Item</th>
                        <th className="text-right">Ordered</th>
                        <th className="text-right">Required</th>
                        <th className="text-right">Planned</th>
                        <th className="text-right">Produced</th>
                        <th className="text-right">Accepted</th>
                        <th className="text-right">Rejected</th>
                        <th className="text-right">Dispatched</th>
                        <th
                          className={cn(
                            "border-l-2 border-l-slate-300/90 bg-slate-100/50 text-right",
                            sortHeaderClass(sortBy === "prodPending"),
                          )}
                          aria-sort={sortBy === "prodPending" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            Prod pend
                            {sortBy === "prodPending" ? (
                              sortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th
                          className={cn(
                            "bg-slate-100/50 text-right",
                            sortHeaderClass(sortBy === "qcPending"),
                          )}
                          aria-sort={sortBy === "qcPending" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            QC pend
                            {sortBy === "qcPending" ? (
                              sortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th
                          className={cn(
                            "bg-slate-100/50 text-right",
                            sortHeaderClass(sortBy === "dispatchPending"),
                          )}
                          aria-sort={
                            sortBy === "dispatchPending" ? (sortDir === "asc" ? "ascending" : "descending") : undefined
                          }
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            Disp pend
                            {sortBy === "dispatchPending" ? (
                              sortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th className="min-w-[9.5rem]">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r) => {
                        const pend = pendingTripleEmphasis(r);
                        return (
                          <tr
                            key={r.workOrderLineId}
                            {...getDrillRowProps({
                              onActivate: () => onRowActivate(r),
                              ariaLabel: `Open work order ${r.workOrderNo}`,
                              className: cn(
                                r.status === "PENDING_PRODUCTION" && "[&_td]:!bg-slate-50/80",
                                (r.status === "IN_PRODUCTION" || r.status === "PENDING_QC" || r.status === "PARTIAL_QC") &&
                                  "[&_td]:!bg-amber-50/35",
                                (r.status === "READY_TO_DISPATCH" || r.status === "PARTIAL_DISPATCH") &&
                                  "[&_td]:!bg-sky-50/40",
                              ),
                              activable: canDrillWorkOrder,
                            })}
                          >
                            <td className="whitespace-nowrap font-medium tabular-nums">{r.salesOrderNo}</td>
                            <td className="max-w-[8rem] truncate sm:max-w-[12rem]">{r.customerName}</td>
                            <td className="whitespace-nowrap tabular-nums">{r.workOrderNo}</td>
                            <td className="max-w-[10rem] truncate">{r.itemName}</td>
                            <td className="text-right tabular-nums">{r.orderedQty}</td>
                            <td className="text-right tabular-nums">{r.requiredQty ?? r.workOrderQty}</td>
                            <td className="text-right tabular-nums">{r.requiredQty ?? r.workOrderQty}</td>
                            <td className="text-right tabular-nums">{r.producedQty}</td>
                            <td className="text-right tabular-nums">{r.acceptedQty}</td>
                            <td className="text-right tabular-nums">{r.rejectedQty}</td>
                            <td className="text-right tabular-nums">{r.dispatchedQty}</td>
                            <td
                              className={cn(
                                "border-l-2 border-l-slate-300/90 bg-slate-50/50 text-right tabular-nums ring-1 ring-inset ring-slate-200/70",
                                r.productionPendingQty > ROW_NUM_EPS
                                  ? pend === "high"
                                    ? "bg-amber-100/65 font-semibold text-amber-950"
                                    : "bg-amber-50/85 font-medium text-amber-950"
                                  : "text-slate-600",
                              )}
                            >
                              {r.productionPendingQty}
                            </td>
                            <td
                              className={cn(
                                "bg-slate-50/50 text-right tabular-nums ring-1 ring-inset ring-slate-200/70",
                                r.qcPendingQty > ROW_NUM_EPS
                                  ? pend === "high"
                                    ? "bg-amber-100/65 font-semibold text-amber-950"
                                    : "bg-amber-50/85 font-medium text-amber-950"
                                  : "text-slate-600",
                              )}
                            >
                              {r.qcPendingQty}
                            </td>
                            <td
                              className={cn(
                                "bg-slate-50/50 text-right tabular-nums ring-1 ring-inset ring-slate-200/70",
                                r.dispatchPendingQty > ROW_NUM_EPS
                                  ? pend === "high"
                                    ? "bg-sky-100/50 font-semibold text-slate-900"
                                    : "bg-sky-50/70 font-semibold text-slate-900"
                                  : "text-slate-600",
                              )}
                            >
                              {r.dispatchPendingQty}
                            </td>
                            <td className="min-w-[9.5rem] whitespace-normal align-middle">
                              <Badge
                                variant={dashboardToneToBadgeVariant(woTrackingStatusTone(r.status))}
                                className="whitespace-normal text-left font-semibold leading-snug"
                              >
                                {r.status.replace(/_/g, " ")}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
