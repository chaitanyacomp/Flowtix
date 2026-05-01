import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { Card, CardContent } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { isReportsReturnContext } from "../lib/drillDownRoutes";
import {
  OperatorPageBody,
  OperatorPageTitle,
  OperatorTopBar,
  operatorInputClass,
  operatorTableRowClass,
} from "../components/erp/OperatorWorkbench";
import { PageSmartBackLink, StickyReportBackStrip, StickyWorkspaceHead } from "../components/PageHeader";

type StockBucketsRow = {
  itemId: number;
  item: { itemName: string; itemType: string; unit: string };
  usableQty: number;
  qcHoldQty: number;
  /** Awaiting QC re-check after rework (not Hold for Checking) */
  qcPendingQty: number;
  reworkQty: number;
  scrapQty: number;
};

const STOCK_URL_OMIT: Record<string, string> = { itemType: "ALL" };

function fmtQtyStock(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // UI-only: keep numbers readable (max 2 decimals)
  return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function StockPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromReportsHub = isReportsReturnContext(location.search);
  const { patch, read } = useUrlQueryState(STOCK_URL_OMIT);
  const itemTypeFilterVal = read.enum("itemType", ["ALL", "FG", "RM"] as const, "ALL");
  const qFromUrl = read.string("q");
  const [qDraft, setQDraft] = useDebouncedUrlStringParam({ urlValue: qFromUrl, patch, paramKey: "q" });
  const [showFilter, setShowFilter] = React.useState<"ALL" | "IN_STOCK" | "ZERO_STOCK">("ALL");

  const [rows, setRows] = React.useState<StockBucketsRow[]>([]);
  const [summaryLoaded, setSummaryLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function loadSummary() {
    return apiFetch<StockBucketsRow[]>("/api/stock/summary-buckets")
      .then((data) =>
        setRows(
          (Array.isArray(data) ? data : []).map((row) => ({
            ...row,
            qcPendingQty: row.qcPendingQty ?? 0,
          })),
        ),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setSummaryLoaded(true));
  }

  React.useEffect(() => {
    loadSummary();
  }, []);

  const visibleStockRows = React.useMemo(() => {
    const q = qDraft.trim().toLowerCase();
    return rows.filter((r) => {
      if (itemTypeFilterVal !== "ALL" && r.item.itemType !== itemTypeFilterVal) return false;
      if (q && !r.item.itemName.toLowerCase().includes(q)) return false;
      const currentStock = Number(r.usableQty) || 0;
      if (showFilter === "IN_STOCK" && currentStock <= 0) return false;
      if (showFilter === "ZERO_STOCK" && currentStock > 0) return false;
      return true;
    });
  }, [rows, itemTypeFilterVal, qDraft, showFilter]);

  const stockListFiltersActive = itemTypeFilterVal !== "ALL" || qDraft.trim().length > 0;

  function clearStockListFilters() {
    setQDraft("");
    patch({ q: null, itemType: null });
  }

  const stockCounts = React.useMemo(() => {
    const rm = rows.filter((r) => r.item.itemType === "RM").length;
    const fg = rows.filter((r) => r.item.itemType === "FG").length;
    const zero = rows.filter((r) => (Number(r.usableQty) || 0) <= 0).length;
    return { rm, fg, zero };
  }, [rows]);

  const stockSummaryTitleRow = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <OperatorPageTitle>Stock Summary</OperatorPageTitle>
        <p className="mt-0.5 text-[12px] text-slate-600">
          Usable stock is dispatchable. Other buckets (hold/pending/rework/scrap) are shown separately for clarity.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/stock/adjustment"
          className="text-[13px] font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
        >
          Adjustments
        </Link>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("w-fit text-[13px]", operatorInputClass)}
          disabled={!stockListFiltersActive}
          onClick={clearStockListFilters}
        >
          Clear filters
        </Button>
      </div>
    </div>
  );

  return (
    <OperatorPageBody>
      <Card className="mx-auto w-full max-w-[1680px] border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-4">
          {fromReportsHub ? (
            <>
              <StickyReportBackStrip className="-mx-4 px-4" />
              {stockSummaryTitleRow}
            </>
          ) : (
            <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/dashboard" defaultLabel="Back to Dashboard" />}>
              {stockSummaryTitleRow}
            </StickyWorkspaceHead>
          )}
          {error ? <div className="text-[13px] text-red-700">{error}</div> : null}

          {summaryLoaded ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total RM items</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{stockCounts.rm}</div>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total FG items</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{stockCounts.fg}</div>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Zero stock items</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{stockCounts.zero}</div>
              </div>
            </div>
          ) : null}

          <OperatorTopBar className="rounded border border-slate-200 bg-slate-50/90 p-2">
            <div className="erp-form-field min-w-[8rem]">
              <span className="text-[12px] font-medium text-slate-600">Item type</span>
              <select
                className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                value={itemTypeFilterVal}
                onChange={(e) => {
                  patch({ itemType: e.target.value as typeof itemTypeFilterVal });
                }}
              >
                <option value="ALL">All</option>
                <option value="FG">FG</option>
                <option value="RM">RM</option>
              </select>
            </div>
            <div className="erp-form-field min-w-[12rem] flex-1">
              <span className="text-[12px] font-medium text-slate-600">Search item</span>
              <Input
                className={cn("mt-0.5 text-[13px]", operatorInputClass)}
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                placeholder="Type item name…"
              />
            </div>
            <div className="erp-form-field min-w-[10rem]">
              <span className="text-[12px] font-medium text-slate-600">Show</span>
              <select
                className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                value={showFilter}
                onChange={(e) => setShowFilter(e.target.value as typeof showFilter)}
              >
                <option value="ALL">All</option>
                <option value="IN_STOCK">In stock</option>
                <option value="ZERO_STOCK">Zero stock</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("h-[38px] text-[13px]", operatorInputClass)}
                onClick={() => {
                  void loadSummary();
                }}
              >
                Refresh
              </Button>
            </div>
          </OperatorTopBar>

          <div className="space-y-2">
            {rows.length > 0 ? (
              <p className="text-xs text-slate-500">
                Showing <span className="font-semibold tabular-nums text-slate-700">{visibleStockRows.length}</span> of{" "}
                <span className="tabular-nums">{rows.length}</span> items
              </p>
            ) : null}

            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr className="text-left text-[12px] text-slate-600">
                    <th className="px-3 py-2 font-medium">Item ID</th>
                    <th className="px-3 py-2 font-medium">Item name</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Unit</th>
                    <th className="px-3 py-2 text-right font-medium">Usable stock</th>
                    <th className="px-3 py-2 text-right font-medium">QC hold</th>
                    <th className="px-3 py-2 text-right font-medium">QC pending</th>
                    <th className="px-3 py-2 text-right font-medium">Rework</th>
                    <th className="px-3 py-2 text-right font-medium">Scrap</th>
                    <th className="px-3 py-2 text-right font-medium">Total (all buckets)</th>
                    <th className="px-3 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStockRows.map((r) => (
                    <tr
                      key={r.itemId}
                      className={cn(
                        "border-b border-slate-100 align-middle",
                        operatorTableRowClass,
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-slate-700">{r.itemId}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{r.item.itemName}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={r.item.itemType === "FG" ? "success" : "default"}
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        >
                          {r.item.itemType}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{r.item.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(r.usableQty) <= 0 ? (
                          <span className="inline-flex items-center justify-end gap-2 font-bold text-red-700">
                            <span className="tabular-nums">{fmtQtyStock(0)}</span>
                            <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                              Out of stock
                            </span>
                          </span>
                        ) : (
                          <span className="font-bold text-slate-900">{fmtQtyStock(r.usableQty)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtQtyStock(r.qcHoldQty || 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtQtyStock(r.qcPendingQty || 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtQtyStock(r.reworkQty || 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtQtyStock(r.scrapQty || 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                        {fmtQtyStock(
                          Number(r.usableQty || 0) +
                            Number(r.qcHoldQty || 0) +
                            Number(r.qcPendingQty || 0) +
                            Number(r.reworkQty || 0) +
                            Number(r.scrapQty || 0),
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-[32px] rounded-md px-3 text-[13px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            const params = new URLSearchParams();
                            params.set("itemId", String(r.itemId));
                            params.set("sort", "desc");
                            if (r.item.itemType === "RM") {
                              navigate(`/stock/rm-ledger?${params.toString()}`);
                              return;
                            }
                            params.set("source", "stock_summary");
                            navigate(`/stock/ledger?${params.toString()}`);
                          }}
                        >
                          View Movement
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {summaryLoaded && rows.length === 0 ? <p className="text-sm text-slate-600">No stock records found.</p> : null}
            {rows.length > 0 && visibleStockRows.length === 0 ? (
              <p className="text-sm text-slate-600">
                No stock records found.
              </p>
            ) : null}
            {rows.length > 0 ? (
              <p className="text-sm text-slate-600">Click “View Movement” to open movement history for the selected item.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </OperatorPageBody>
  );
}
