import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { suppressMouseFocusOnDrillRow } from "../lib/drillDownRowProps";
import { cn } from "../lib/utils";
import { ROW_NUM_EPS, dashboardToneToBadgeVariant, maxInSlice } from "../lib/dispatchBacklog";
import { purchasePoStatusTone, rmRiskStatusTone } from "../lib/reportStatusTones";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { ChevronDown, ChevronUp, Download, ShoppingCart } from "lucide-react";
import { ReportPageHeader } from "../components/PageHeader";

type RmRiskRow = {
  itemId: number;
  itemCode: string;
  itemName: string;
  currentStockQty: number;
  requiredQty: number;
  freeQty: number;
  shortageQty: number;
  status: string;
};

type PurchaseSummaryRow = {
  purchaseOrderId: number;
  purchaseOrderNo: string;
  supplierName: string;
  itemId: number;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  pendingQty: number;
  status: string;
  purchaseDate: string;
};

type RmStatusFilter = "ALL" | "CRITICAL" | "LOW_BUFFER";
type RmSortKey = "shortage" | "stock" | "item";
type PoSortKey = "pending" | "date";

const DEFAULT_RM_SORT: RmSortKey = "shortage";
const DEFAULT_RM_DIR: "asc" | "desc" = "desc";
const DEFAULT_PO_SORT: PoSortKey = "date";
const DEFAULT_PO_DIR: "asc" | "desc" = "asc";

const RM_SHORTAGE_URL_OMIT: Record<string, string> = {
  rmStatus: "ALL",
  rmSort: "shortage",
  rmDir: "desc",
  poSort: "date",
  poDir: "asc",
};

function rmShortageReportAllowed(role: string | undefined): boolean {
  return role === "ADMIN" || role === "STORE" || role === "PRODUCTION";
}

/**
 * Build the navigation target for "Create RM PO" from a shortage row.
 *
 * Carries the item context as query params (itemId, itemCode, itemName,
 * shortageQty, source) plus a `returnTo` so the RM PO list page can render a
 * smart "Back to RM Shortage Workspace" link that preserves the operator's
 * original entry source (e.g. Dashboard).
 *
 * Quantity-related params are PRESENTATIONAL ONLY — the RM PO page uses them
 * to prefill the line; no business calculation is mutated here.
 */
function buildCreateRmPoHref(args: {
  itemId: number;
  itemCode: string;
  itemName: string;
  shortageQty: number;
  rmShortageSearch: string;
}): string {
  const params = new URLSearchParams();
  params.set("source", "rm-shortage");
  params.set("itemId", String(args.itemId));
  if (args.itemCode) params.set("itemCode", args.itemCode);
  if (args.itemName) params.set("itemName", args.itemName);
  if (Number.isFinite(args.shortageQty) && args.shortageQty > 0) {
    params.set("shortageQty", String(args.shortageQty));
    params.set("requiredQty", String(args.shortageQty));
  }
  const returnPath = `/reports/rm-shortage${args.rmShortageSearch || ""}`;
  params.set("returnTo", returnPath);
  return `/rm-po-grn/create?${params.toString()}`;
}

export function RMShortageReportPage() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const allowed = rmShortageReportAllowed(auth.user?.role);
  const { patch, read } = useUrlQueryState(RM_SHORTAGE_URL_OMIT);

  // Smart back-nav: if opened from Dashboard (source=dashboard), go back to
  // Dashboard; otherwise default to the Reports hub. Mirrors the same query
  // param convention used elsewhere on the dashboard.
  const sourceFromUrl = read.string("source");
  const back = React.useMemo(
    () =>
      sourceFromUrl === "dashboard"
        ? { to: "/dashboard", label: "Back to Dashboard" }
        : { to: "/reports", label: "Back to Reports" },
    [sourceFromUrl],
  );

  const [rmRows, setRmRows] = React.useState<RmRiskRow[]>([]);
  const [poRows, setPoRows] = React.useState<PurchaseSummaryRow[]>([]);
  const [rmLoading, setRmLoading] = React.useState(true);
  const [poLoading, setPoLoading] = React.useState(true);
  const [rmError, setRmError] = React.useState<string | null>(null);
  const [poError, setPoError] = React.useState<string | null>(null);

  const statusFilter = read.enum("rmStatus", ["ALL", "CRITICAL", "LOW_BUFFER"] as const, "ALL");
  const onlyWithPendingPurchase = read.bool("rmPending");
  const shortageOnly = read.bool("rmShortage");

  const rmSortBy = read.enum("rmSort", ["shortage", "stock", "item"] as const, DEFAULT_RM_SORT);
  const rmSortDir = read.enum("rmDir", ["asc", "desc"] as const, DEFAULT_RM_DIR);
  const poSortBy = read.enum("poSort", ["pending", "date"] as const, DEFAULT_PO_SORT);
  const poSortDir = read.enum("poDir", ["asc", "desc"] as const, DEFAULT_PO_DIR);

  const searchFromUrl = read.string("q");
  const [searchDraft, setSearchDraft] = useDebouncedUrlStringParam({
    urlValue: searchFromUrl,
    patch,
    paramKey: "q",
  });
  const search = searchDraft;

  React.useEffect(() => {
    if (!allowed) return;
    let mounted = true;
    setRmLoading(true);
    setRmError(null);
    apiFetch<RmRiskRow[]>("/api/dashboard/rm-risk")
      .then((data) => {
        if (mounted) {
          setRmRows(data);
          setRmError(null);
        }
      })
      .catch((e) => {
        if (mounted) {
          setRmRows([]);
          setRmError(e instanceof Error ? e.message : "Failed to load RM risk");
        }
      })
      .finally(() => {
        if (mounted) setRmLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [allowed]);

  React.useEffect(() => {
    if (!allowed) return;
    let mounted = true;
    setPoLoading(true);
    setPoError(null);
    apiFetch<PurchaseSummaryRow[]>("/api/dashboard/purchase-summary")
      .then((data) => {
        if (mounted) {
          setPoRows(data);
          setPoError(null);
        }
      })
      .catch((e) => {
        if (mounted) {
          setPoRows([]);
          setPoError(e instanceof Error ? e.message : "Failed to load purchase summary");
        }
      })
      .finally(() => {
        if (mounted) setPoLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [allowed]);

  const itemIdsWithPendingPurchase = React.useMemo(() => {
    const s = new Set<number>();
    for (const p of poRows) s.add(p.itemId);
    return s;
  }, [poRows]);

  const summary = React.useMemo(() => {
    const critical = rmRows.filter((r) => r.status === "CRITICAL").length;
    const lowBuf = rmRows.filter((r) => r.status === "LOW_BUFFER").length;
    const totalShortage = rmRows.reduce((acc, r) => acc + Number(r.shortageQty || 0), 0);
    const pendingLines = poRows.length;
    return { critical, lowBuf, totalShortage, pendingLines };
  }, [rmRows, poRows]);

  const rmFiltered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rmRows.filter((r) => {
      if (shortageOnly && r.status !== "CRITICAL") return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (onlyWithPendingPurchase && !itemIdsWithPendingPurchase.has(r.itemId)) return false;
      if (q) {
        const code = (r.itemCode || "").toLowerCase();
        const name = (r.itemName || "").toLowerCase();
        if (!code.includes(q) && !name.includes(q)) return false;
      }
      return true;
    });
  }, [rmRows, statusFilter, search, onlyWithPendingPurchase, shortageOnly, itemIdsWithPendingPurchase]);

  const rmSorted = React.useMemo(() => {
    const out = [...rmFiltered];
    out.sort((a, b) => {
      let cmp = 0;
      if (rmSortBy === "shortage") {
        cmp = a.shortageQty - b.shortageQty;
      } else if (rmSortBy === "stock") {
        cmp = a.currentStockQty - b.currentStockQty;
      } else {
        cmp = a.itemName.localeCompare(b.itemName, undefined, { sensitivity: "base" });
      }
      return rmSortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rmFiltered, rmSortBy, rmSortDir]);

  const poSorted = React.useMemo(() => {
    const out = [...poRows];
    out.sort((a, b) => {
      let cmp = 0;
      if (poSortBy === "pending") {
        cmp = a.pendingQty - b.pendingQty;
      } else {
        cmp = new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime();
      }
      return poSortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [poRows, poSortBy, poSortDir]);

  const hasActiveRmFilters =
    statusFilter !== "ALL" ||
    search.trim() !== "" ||
    onlyWithPendingPurchase ||
    shortageOnly;

  const rmSortDiffers = rmSortBy !== DEFAULT_RM_SORT || rmSortDir !== DEFAULT_RM_DIR;
  const poSortDiffers = poSortBy !== DEFAULT_PO_SORT || poSortDir !== DEFAULT_PO_DIR;
  const canClear = hasActiveRmFilters || rmSortDiffers || poSortDiffers;

  function clearFilters() {
    setSearchDraft("");
    patch({
      rmStatus: null,
      q: null,
      rmPending: null,
      rmShortage: null,
      rmSort: null,
      rmDir: null,
      poSort: null,
      poDir: null,
    });
  }

  function toggleRmSortDir() {
    const next = rmSortDir === "asc" ? "desc" : "asc";
    patch({ rmDir: next });
  }

  function togglePoSortDir() {
    const next = poSortDir === "asc" ? "desc" : "asc";
    patch({ poDir: next });
  }

  function onExportRm() {
    toast.showInfo("Export RM shortage to Excel will be available in a future update.");
  }

  function onExportPo() {
    toast.showInfo("Export purchase coverage to Excel will be available in a future update.");
  }

  /**
   * Row click on a shortage line opens the RM ledger filtered to this item so
   * STORE can verify recent stock movement before placing an RM PO. The
   * explicit "Create RM PO" button on the row is the actual action — row
   * activation is informational.
   */
  function onRmRowActivate(r: RmRiskRow) {
    navigate(`/stock/rm-ledger?itemId=${encodeURIComponent(String(r.itemId))}&source=rm-shortage`);
  }

  /**
   * Row click on a pending purchase line opens the corresponding RM PO detail
   * page so STORE can review/edit it without leaving the workspace flow.
   */
  function onPoRowActivate(r: PurchaseSummaryRow) {
    navigate(`/rm-po-grn/${r.purchaseOrderId}?source=rm-shortage`);
  }

  /**
   * Navigate to the RM Purchase Order create page with item context prefilled
   * via query params. The list page reads `source=rm-shortage` and auto-opens
   * the new PO modal with the shortage qty.
   */
  function onCreateRmPoForRow(r: RmRiskRow) {
    navigate(
      buildCreateRmPoHref({
        itemId: r.itemId,
        itemCode: r.itemCode,
        itemName: r.itemName,
        shortageQty: Number(r.shortageQty || 0),
        rmShortageSearch: location.search,
      }),
    );
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

  function purchaseRowEmphasis(r: PurchaseSummaryRow, slice: PurchaseSummaryRow[]): "high" | "low" {
    if (slice.length === 0) return "low";
    const maxP = maxInSlice(slice.map((x) => x.pendingQty));
    if (maxP <= ROW_NUM_EPS) return "low";
    return r.pendingQty >= maxP * 0.6 ? "high" : "low";
  }

  function firstPoCellClass(level: "high" | "low"): string {
    if (level === "low") return "";
    return cn("border-l-2 border-slate-500/70 border-y-0 border-r-0 border-solid pl-2");
  }

  if (!allowed) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-6 py-10 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Not authorized</h2>
        <p className="mt-2 text-sm text-slate-600">
          You don&apos;t have permission to view the RM Shortage Workspace. If you need access, contact an administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ReportPageHeader
        className="mb-0"
        title="RM Shortage Workspace"
        purpose="Review material shortages, pending purchase coverage, and create RM PO for blocked production."
        back={back}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Critical RM items</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-red-800">{summary.critical}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Low buffer RM items</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-800">{summary.lowBuf}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Total shortage qty</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{summary.totalShortage.toFixed(3)}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending Material Planning lines</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{summary.pendingLines}</div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
          <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={!canClear} onClick={clearFilters}>
            Clear filters
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1.5 text-xs font-medium text-slate-600">
              Status
              <select
                className={selectClass}
                value={statusFilter}
                onChange={(e) =>
                  patch({ rmStatus: e.target.value as RmStatusFilter })
                }
                aria-label="Filter by RM risk status"
              >
                <option value="ALL">All (CRITICAL + LOW_BUFFER)</option>
                <option value="CRITICAL">CRITICAL</option>
                <option value="LOW_BUFFER">LOW_BUFFER</option>
              </select>
            </label>

            <label className="grid gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2 lg:col-span-3">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Search</span>
              <Input
                className="h-10 border-slate-300 bg-white text-sm font-medium shadow-sm placeholder:font-normal placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-slate-300"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Item code or name…"
                aria-label="Search item code or name"
              />
            </label>
          </div>

          <p className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2 text-xs leading-relaxed text-slate-600">
            <span className="font-medium text-slate-700">API scope:</span> the RM risk endpoint only returns items in{" "}
            <strong className="font-semibold text-slate-800">CRITICAL</strong> or <strong className="font-semibold text-slate-800">LOW_BUFFER</strong>{" "}
            state. <strong className="font-semibold text-slate-800">SAFE</strong> raw materials are not included in this report payload — they are
            omitted by the server, not hidden by filters.
          </p>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-slate-900"
                checked={onlyWithPendingPurchase}
                onChange={(e) =>
                  patch({ rmPending: e.target.checked ? "1" : null })
                }
              />
              <span>Only items with pending Material Planning (any open PO line)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-slate-900"
                checked={shortageOnly}
                onChange={(e) =>
                  patch({ rmShortage: e.target.checked ? "1" : null })
                }
              />
              <span>Shortage only (CRITICAL)</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* RM risk table */}
      <Card className="flex min-h-0 flex-col border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-2">
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="text-sm font-semibold text-slate-800">RM demand vs stock</CardTitle>
            <p className="text-xs text-slate-500">Open WO BOM demand vs ledger stock (RM risk API)</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500">Sort</span>
              <select
                className={cn(selectClass, "h-8 w-[9.5rem]")}
                value={rmSortBy}
                onChange={(e) => patch({ rmSort: e.target.value as RmSortKey })}
                aria-label="Sort RM rows by"
              >
                <option value="shortage">Shortage qty</option>
                <option value="stock">Current stock</option>
                <option value="item">Item name</option>
              </select>
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={toggleRmSortDir}>
                {rmSortDir === "asc" ? "Asc ↑" : "Desc ↓"}
              </Button>
              <span className="hidden text-xs text-slate-500 sm:inline" aria-live="polite">
                Active:{" "}
                <span className="font-medium text-slate-700">
                  {rmSortBy === "shortage" ? "Shortage" : rmSortBy === "stock" ? "Stock" : "Item name"} · {rmSortDir === "asc" ? "asc" : "desc"}
                </span>
              </span>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onExportRm}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-col p-0">
          {rmError ? (
            <div className="border-t border-slate-200 px-4 py-8 text-sm text-red-700">{rmError}</div>
          ) : rmLoading ? (
            <div className="border-t border-slate-200 px-4 py-8 text-sm text-slate-500">Loading RM risk…</div>
          ) : rmRows.length === 0 ? (
            <div className="border-t border-slate-200 px-4 py-10">
              <p className="text-sm font-medium text-slate-800">No RM risk rows from API</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                Nothing is in CRITICAL or LOW_BUFFER for open work orders with BOM-backed demand. SAFE items are not returned by this endpoint.
              </p>
            </div>
          ) : rmSorted.length === 0 ? (
            <div className="border-t border-slate-200 px-4 py-10">
              <p className="text-sm font-medium text-slate-800">No matching RM risk rows</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                Current filters hide every loaded row. Clear filters, widen search, turn off &quot;shortage only&quot;, or uncheck pending-purchase
                coverage to see RM risk lines again.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-4 h-8" disabled={!canClear} onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <>
              <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2.5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">RM risk rows</p>
                <p className="mt-0.5 text-sm text-slate-700">
                  {hasActiveRmFilters ? (
                    <>
                      Showing <span className="font-semibold tabular-nums text-slate-900">{rmSorted.length}</span> of{" "}
                      <span className="tabular-nums text-slate-600">{rmRows.length}</span> RM risk rows
                    </>
                  ) : (
                    <>
                      Showing <span className="font-semibold tabular-nums text-slate-900">{rmSorted.length}</span> RM risk row
                      {rmSorted.length === 1 ? "" : "s"} <span className="text-slate-500">(full API result)</span>
                    </>
                  )}
                </p>
              </div>
              <div className="max-h-[min(55vh,560px)] min-h-0 overflow-auto border-t border-slate-200">
                <div className="erp-table-wrap border-0">
                  <table className="erp-table min-w-[940px] text-xs sm:text-sm">
                    <thead className="sticky top-0 z-[1] shadow-[0_1px_0_0_rgb(226_232_240)] [&_th]:bg-slate-50">
                      <tr>
                        <th>Item Code</th>
                        <th
                          className={sortHeaderClass(rmSortBy === "item")}
                          aria-sort={rmSortBy === "item" ? (rmSortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            Item Name
                            {rmSortBy === "item" ? (
                              rmSortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th
                          className={cn("text-right", sortHeaderClass(rmSortBy === "stock"))}
                          aria-sort={rmSortBy === "stock" ? (rmSortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            Current Stock
                            {rmSortBy === "stock" ? (
                              rmSortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th className="text-right">Required Qty</th>
                        <th className="text-right">Free Qty</th>
                        <th
                          className={cn("text-right", sortHeaderClass(rmSortBy === "shortage"))}
                          aria-sort={rmSortBy === "shortage" ? (rmSortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            Shortage Qty
                            {rmSortBy === "shortage" ? (
                              rmSortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th>Status</th>
                        <th className="whitespace-nowrap text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rmSorted.map((r, idx) => {
                        const needsPo = r.shortageQty > ROW_NUM_EPS;
                        return (
                        <tr
                          key={`${r.itemId}-${idx}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Open RM ledger for ${r.itemName}`}
                          className={cn(
                            "cursor-pointer select-none transition-colors hover:bg-slate-50/90 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-1",
                            r.status === "CRITICAL" &&
                              "[&_td]:!bg-red-50 [&_td]:border-b-red-100/90",
                            r.status === "LOW_BUFFER" && "[&_td]:!bg-amber-50/55 [&_td]:border-b-amber-100/70",
                          )}
                          onClick={() => onRmRowActivate(r)}
                          onMouseDown={suppressMouseFocusOnDrillRow}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRmRowActivate(r);
                            }
                          }}
                        >
                          <td
                            className={cn(
                              "max-w-[8rem] truncate font-medium tabular-nums",
                              r.status === "CRITICAL" &&
                                "border-l-[4px] border-l-red-600 border-y-0 border-r-0 border-solid pl-2",
                              r.status === "LOW_BUFFER" &&
                                "border-l-2 border-l-amber-500/80 border-y-0 border-r-0 border-solid pl-2",
                            )}
                          >
                            {r.itemCode}
                          </td>
                          <td className="max-w-[14rem] truncate">{r.itemName}</td>
                          <td className="text-right tabular-nums">{r.currentStockQty}</td>
                          <td className="text-right tabular-nums">{r.requiredQty}</td>
                          <td className="text-right tabular-nums">{r.freeQty}</td>
                          <td
                            className={cn(
                              "text-right tabular-nums font-semibold ring-1 ring-inset ring-slate-200/80",
                              r.status === "CRITICAL" && r.shortageQty > ROW_NUM_EPS
                                ? "bg-red-100/35 text-red-900"
                                : "bg-slate-50/90 text-slate-800",
                              r.shortageQty > ROW_NUM_EPS && r.status !== "CRITICAL" && "text-red-800",
                            )}
                          >
                            {r.shortageQty}
                          </td>
                          <td className="whitespace-nowrap">
                            <Badge variant={dashboardToneToBadgeVariant(rmRiskStatusTone(r.status))}>{r.status}</Badge>
                          </td>
                          <td
                            className="whitespace-nowrap text-right"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant={r.status === "CRITICAL" ? "default" : "outline"}
                              className={cn(
                                "h-8 gap-1.5 px-3 text-xs font-semibold shadow-sm",
                                r.status === "CRITICAL" && "bg-red-700 text-white hover:bg-red-800",
                              )}
                              disabled={!needsPo}
                              title={
                                needsPo
                                  ? `Create RM PO for ${r.itemName}${r.shortageQty ? ` (shortage ${r.shortageQty})` : ""}`
                                  : "No active shortage on this item"
                              }
                              onClick={() => onCreateRmPoForRow(r)}
                            >
                              <ShoppingCart className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              Create RM PO
                            </Button>
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

      {/* Purchase coverage */}
      <Card className="flex min-h-0 flex-col border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-2">
          <div className="min-w-0 max-w-xl space-y-1">
            <CardTitle className="text-sm font-semibold text-slate-800">Pending Material Planning coverage</CardTitle>
            <p className="text-xs leading-relaxed text-slate-500">
              Open purchase orders with quantity still to receive on each RM line. Use <span className="font-medium text-slate-600">item</span> with
              the RM risk table above to mentally tie coverage to demand — data stays in separate tables; no server join.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500">Sort</span>
              <select
                className={cn(selectClass, "h-8 w-[9rem]")}
                value={poSortBy}
                onChange={(e) => patch({ poSort: e.target.value as PoSortKey })}
                aria-label="Sort purchase lines by"
              >
                <option value="date">Purchase date</option>
                <option value="pending">Pending qty</option>
              </select>
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={togglePoSortDir}>
                {poSortDir === "asc" ? "Asc ↑" : "Desc ↓"}
              </Button>
              <span className="hidden text-xs text-slate-500 sm:inline" aria-live="polite">
                Active:{" "}
                <span className="font-medium text-slate-700">
                  {poSortBy === "pending" ? "Pending qty" : "Purchase date"} · {poSortDir === "asc" ? "asc" : "desc"}
                </span>
              </span>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onExportPo}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-col p-0">
          {poError ? (
            <div className="border-t border-slate-200 px-4 py-8 text-sm text-red-700">{poError}</div>
          ) : poLoading ? (
            <div className="border-t border-slate-200 px-4 py-8 text-sm text-slate-500">Loading purchase lines…</div>
          ) : poSorted.length === 0 ? (
            <div className="border-t border-slate-200 px-4 py-10">
              <p className="text-sm font-medium text-slate-800">No matching pending Material Planning lines</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                The purchase summary API returned no open RM lines with pending receipt (or the request failed). When data exists, lines appear here
                unchanged by the RM risk filters above.
              </p>
            </div>
          ) : (
            <>
              <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2.5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Purchase summary rows</p>
                <p className="mt-0.5 text-sm text-slate-700">
                  Showing <span className="font-semibold tabular-nums text-slate-900">{poSorted.length}</span> of{" "}
                  <span className="tabular-nums text-slate-600">{poRows.length}</span>                   pending Material Planning line{poRows.length === 1 ? "" : "s"}{" "}
                  <span className="text-slate-500">(full API result; sort only)</span>
                </p>
              </div>
              <div className="max-h-[min(45vh,480px)] min-h-0 overflow-auto border-t border-slate-200">
                <div className="erp-table-wrap border-0">
                  <table className="erp-table min-w-[880px] text-xs sm:text-sm">
                    <thead className="sticky top-0 z-[1] shadow-[0_1px_0_0_rgb(226_232_240)] [&_th]:bg-slate-50">
                      <tr>
                        <th>PO No</th>
                        <th>Supplier</th>
                        <th>Item</th>
                        <th className="text-right">Ordered Qty</th>
                        <th className="text-right">Received Qty</th>
                        <th
                          className={cn("text-right", sortHeaderClass(poSortBy === "pending"))}
                          aria-sort={poSortBy === "pending" ? (poSortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            Pending Qty
                            {poSortBy === "pending" ? (
                              poSortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                        <th>Status</th>
                        <th
                          className={sortHeaderClass(poSortBy === "date")}
                          aria-sort={poSortBy === "date" ? (poSortDir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            Purchase Date
                            {poSortBy === "date" ? (
                              poSortDir === "asc" ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              )
                            ) : null}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {poSorted.map((r, idx) => {
                        const pUrg = purchaseRowEmphasis(r, poSorted);
                        return (
                          <tr
                            key={`${r.purchaseOrderId}-${r.itemId}-${idx}`}
                            role="button"
                            tabIndex={0}
                            className={cn(
                              "cursor-pointer select-none transition-colors hover:bg-slate-50/90 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-1",
                              pUrg === "high" && "[&_td]:!bg-slate-50/90",
                            )}
                            onClick={() => onPoRowActivate(r)}
                            onMouseDown={suppressMouseFocusOnDrillRow}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onPoRowActivate(r);
                              }
                            }}
                          >
                            <td
                              className={cn(
                                "whitespace-nowrap font-medium tabular-nums",
                                firstPoCellClass(pUrg),
                              )}
                            >
                              {r.purchaseOrderNo}
                            </td>
                            <td className="max-w-[10rem] truncate">{r.supplierName}</td>
                            <td className="max-w-[12rem] truncate">{r.itemName}</td>
                            <td className="text-right tabular-nums">{r.orderedQty}</td>
                            <td className="text-right tabular-nums">{r.receivedQty}</td>
                            <td
                              className={cn(
                                "text-right tabular-nums ring-1 ring-inset ring-slate-200/90",
                                pUrg === "high"
                                  ? "bg-slate-100/80 font-semibold text-slate-900"
                                  : "bg-slate-50/90 font-medium text-slate-800",
                              )}
                            >
                              {r.pendingQty}
                            </td>
                            <td className="whitespace-nowrap">
                              <Badge variant={dashboardToneToBadgeVariant(purchasePoStatusTone(r.status))}>{r.status}</Badge>
                            </td>
                            <td className="whitespace-nowrap tabular-nums text-slate-700">
                              {new Date(r.purchaseDate).toLocaleDateString()}
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
