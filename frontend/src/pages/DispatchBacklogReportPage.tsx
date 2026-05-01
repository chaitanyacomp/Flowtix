import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { apiFetch } from "../services/api";
import { cn } from "../lib/utils";
import {
  type DispatchBacklogRow,
  daysSince,
  dashboardToneToBadgeVariant,
  dispatchBacklogLeadCellClass,
  dispatchBacklogRowEmphasis,
  dispatchBacklogStatusTone,
} from "../lib/dispatchBacklog";
import { getDrillRowProps, salesOrdersFocusHref, withReportsReturnContext } from "../lib/drillDownRoutes";
import { useToast } from "../contexts/ToastContext";
import { useDrillActivable } from "../hooks/useDrillAccess";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { ReportPageHeader } from "../components/PageHeader";

type Customer = { id: number; name: string };
type StatusFilter = "ALL" | "APPROVED" | "IN_PROCESS";
type SortKey = "date" | "pending";

const DEFAULT_SORT_KEY: SortKey = "date";
const DEFAULT_SORT_DIR: "asc" | "desc" = "asc";

const REPORT_URL_OMIT: Record<string, string> = {
  status: "ALL",
  sort: "date",
  dir: "asc",
};

export function DispatchBacklogReportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const canDrillSalesOrder = useDrillActivable("sales-order");

  const { patch, read } = useUrlQueryState(REPORT_URL_OMIT);
  const [rows, setRows] = React.useState<DispatchBacklogRow[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const customerName = read.string("customer");
  const statusFilter = read.enum("status", ["ALL", "APPROVED", "IN_PROCESS"] as const, "ALL");
  const dateFrom = read.string("dateFrom");
  const dateTo = read.string("dateTo");
  const sortBy = read.enum("sort", ["date", "pending"] as const, DEFAULT_SORT_KEY);
  const sortDir = read.enum("dir", ["asc", "desc"] as const, DEFAULT_SORT_DIR);

  const searchFromUrl = read.string("search");
  const [searchDraft, setSearchDraft] = useDebouncedUrlStringParam({
    urlValue: searchFromUrl,
    patch,
    paramKey: "search",
  });
  const search = searchDraft;

  const hasActiveFilters =
    customerName !== "" ||
    statusFilter !== "ALL" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    search.trim() !== "";

  const filtersDifferFromSort = sortBy !== DEFAULT_SORT_KEY || sortDir !== DEFAULT_SORT_DIR;

  function clearFilters() {
    setSearchDraft("");
    patch({
      customer: null,
      status: null,
      dateFrom: null,
      dateTo: null,
      search: null,
      sort: null,
      dir: null,
    });
  }

  React.useEffect(() => {
    apiFetch<Customer[]>("/api/customers").then(setCustomers).catch(() => setCustomers([]));
  }, []);

  React.useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    apiFetch<DispatchBacklogRow[]>("/api/dashboard/dispatch-backlog")
      .then((data) => {
        if (mounted) {
          setRows(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (mounted) {
          setRows([]);
          setError(e instanceof Error ? e.message : "Failed to load dispatch backlog");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (customerName && r.customerName !== customerName) return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      const ymd = r.salesOrderDate.slice(0, 10);
      if (dateFrom && ymd < dateFrom) return false;
      if (dateTo && ymd > dateTo) return false;
      if (q) {
        const hit =
          r.salesOrderNo.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          r.itemName.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, customerName, statusFilter, dateFrom, dateTo, search]);

  const sorted = React.useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      if (sortBy === "date") {
        const cmp = new Date(a.salesOrderDate).getTime() - new Date(b.salesOrderDate).getTime();
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = a.pendingQty - b.pendingQty;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [filtered, sortBy, sortDir]);

  function toggleSortDir() {
    const next = sortDir === "asc" ? "desc" : "asc";
    patch({ dir: next });
  }

  function onExportPlaceholder() {
    toast.showInfo("Export to Excel will be available in a future update.");
  }

  function onRowActivate(r: DispatchBacklogRow) {
    navigate(withReportsReturnContext(salesOrdersFocusHref(r.salesOrderId)));
  }

  const selectClass =
    "h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 shadow-sm";

  const canClear = hasActiveFilters || filtersDifferFromSort;

  function sortHeaderClass(active: boolean): string {
    return cn(
      "transition-colors",
      active && "bg-slate-100/90 font-semibold text-slate-900 ring-1 ring-inset ring-slate-200/90",
    );
  }

  return (
    <div className="grid gap-3">
      <ReportPageHeader
        className="mb-0"
        title="Dispatch Backlog"
        purpose="Pending dispatch lines across active sales orders — who is waiting to ship, and how much."
        actions={
          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={onExportPlaceholder}>
            <Download className="h-4 w-4" />
            Export to Excel
          </Button>
        }
      />

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
          <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={!canClear} onClick={clearFilters}>
            Clear filters
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Customer
            <select
              className={selectClass}
              value={customerName}
              onChange={(e) => patch({ customer: e.target.value || null })}
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
            Status
            <select
              className={selectClass}
              value={statusFilter}
              onChange={(e) => patch({ status: e.target.value as StatusFilter })}
              aria-label="Filter by order status"
            >
              <option value="ALL">All (approved / in process)</option>
              <option value="APPROVED">APPROVED</option>
              <option value="IN_PROCESS">IN_PROCESS</option>
            </select>
          </label>

          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            SO date from
            <Input type="date" className="h-9" value={dateFrom} onChange={(e) => patch({ dateFrom: e.target.value || null })} />
          </label>

          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            SO date to
            <Input type="date" className="h-9" value={dateTo} onChange={(e) => patch({ dateTo: e.target.value || null })} />
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2 lg:col-span-4">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Search</span>
            <Input
              className="h-10 border-slate-300 bg-white text-sm font-medium shadow-sm placeholder:font-normal placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-slate-300"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="SO number, item name, or customer…"
              aria-label="Search by SO number, item, or customer"
            />
          </label>
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold text-slate-800">Pending Dispatch Lines</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500">Sort</span>
              <select
                className={cn(selectClass, "h-8 w-[8.5rem]")}
                value={sortBy}
                onChange={(e) => patch({ sort: e.target.value as SortKey })}
                aria-label="Sort by"
              >
                <option value="date">Sales order date</option>
                <option value="pending">Pending qty</option>
              </select>
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={toggleSortDir}>
                {sortDir === "asc" ? "Asc ↑" : "Desc ↓"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {error ? (
            <div className="px-4 py-8 text-sm text-red-700">{error}</div>
          ) : loading ? (
            <div className="px-4 py-8 text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="border-t border-slate-200 px-4 py-10">
              <p className="text-sm font-medium text-slate-800">No pending dispatch found</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                All approved / in-process sales orders are fully dispatched.
              </p>
            </div>
          ) : sorted.length === 0 ? (
            <div className="border-t border-slate-200 px-4 py-10">
              <p className="text-sm font-medium text-slate-800">No matching backlog rows</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                Nothing matches the current filters or search. Try clearing filters, widening the date range, or using a shorter search term.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-4 h-8" disabled={!canClear} onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <>
              <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2.5">
                <p className="text-sm text-slate-700">
                  {hasActiveFilters ? (
                    <>
                      Showing <span className="font-semibold tabular-nums text-slate-900">{sorted.length}</span> of{" "}
                      <span className="tabular-nums text-slate-600">{rows.length}</span> backlog rows
                    </>
                  ) : (
                    <>
                      Showing <span className="font-semibold tabular-nums text-slate-900">{sorted.length}</span>{" "}
                      backlog row{sorted.length === 1 ? "" : "s"}
                    </>
                  )}
                </p>
              </div>
              <div className="max-h-[min(70vh,720px)] min-h-0 flex-1 overflow-auto border-t border-slate-200">
                <div className="erp-table-wrap border-0">
                  <table className="erp-table min-w-[720px] text-xs sm:text-sm">
                    <thead className="sticky top-0 z-[1] shadow-[0_1px_0_0_rgb(226_232_240)] [&_th]:bg-slate-50">
                      <tr>
                        <th>SO No</th>
                        <th>Customer</th>
                        <th>Item</th>
                        <th className="text-right">Ordered Qty</th>
                        <th className="text-right">Dispatched Qty</th>
                        <th
                          className={cn("text-right", sortHeaderClass(sortBy === "pending"))}
                          aria-sort={sortBy === "pending" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            Pending Qty
                            {sortBy === "pending" ? (
                              sortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th
                          className={sortHeaderClass(sortBy === "date")}
                          aria-sort={sortBy === "date" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            Date
                            {sortBy === "date" ? (
                              sortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r, idx) => {
                        const urg = dispatchBacklogRowEmphasis(r, sorted);
                        const ageDays = daysSince(r.salesOrderDate);
                        const olderOrder = ageDays >= 12;
                        return (
                          <tr
                            key={`${r.salesOrderId}-${r.itemId}-${idx}`}
                            {...getDrillRowProps({
                              onActivate: () => onRowActivate(r),
                              ariaLabel: `Open sales order ${r.salesOrderNo}`,
                              activable: canDrillSalesOrder,
                            })}
                          >
                            <td
                              className={cn(
                                "whitespace-nowrap font-medium tabular-nums",
                                dispatchBacklogLeadCellClass(urg),
                              )}
                            >
                              {r.salesOrderNo}
                            </td>
                            <td className="max-w-[10rem] truncate sm:max-w-[14rem]">{r.customerName}</td>
                            <td className="max-w-[12rem] truncate">{r.itemName}</td>
                            <td className="text-right tabular-nums">{r.orderedQty}</td>
                            <td className="text-right tabular-nums">{r.dispatchedQty}</td>
                            <td
                              className={cn(
                                "text-right tabular-nums bg-slate-50/70 ring-1 ring-inset ring-slate-100/90",
                                urg !== "low" ? "font-semibold text-slate-900" : "font-medium text-slate-800",
                              )}
                            >
                              {r.pendingQty}
                            </td>
                            <td
                              className={cn(
                                "whitespace-nowrap tabular-nums",
                                olderOrder ? "text-slate-600" : "font-medium text-slate-800",
                              )}
                            >
                              {new Date(r.salesOrderDate).toLocaleDateString()}
                            </td>
                            <td className="whitespace-nowrap">
                              <Badge variant={dashboardToneToBadgeVariant(dispatchBacklogStatusTone(r.status))}>
                                {r.status}
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

