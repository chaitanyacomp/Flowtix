import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PageContainer, ReportPageHeader } from "../components/PageHeader";
import { apiFetch } from "../services/api";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { cn } from "../lib/utils";
import { ItemStockStatusBadge } from "../components/erp/ItemStockStatusBadge";
import { itemStockStatusFromItemFields, itemStockStatusLabel } from "../lib/itemStockStatus";

type ItemOpt = {
  id: number;
  itemName: string;
  itemType: "RM" | "FG";
  unitName?: string | null;
  unit?: string | null;
  minimumStockQty?: string | null;
  minStockLevel?: string | null;
};

type Row = {
  itemId: number;
  itemName: string;
  itemType: "RM" | "FG" | null;
  unit: string;
  openingQty: number;
  totalInwardQty: number;
  totalOutwardQty: number;
  adjustmentIncreaseQty: number;
  adjustmentDecreaseQty: number;
  systemClosingQty: number;
  currentAvailableQty: number | null;
  lastMovementDate: string | null;
};

type ApiResp = {
  meta: {
    fromDate: string;
    toDate: string;
    onlyAdjustments: boolean;
    onlyMovement: boolean;
    itemId: number | null;
    itemType: "RM" | "FG" | null;
    stockBucket: "USABLE";
  };
  summary: {
    totalItems: number;
    itemsWithAdjustments: number;
    totalInwardQty: number;
    totalOutwardQty: number;
  };
  rows: Row[];
};

function todayYmd(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function firstDayOfCurrentMonthYmd(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = "01";
  return `${yyyy}-${mm}-${dd}`;
}

function fmtQty(n: number | null | undefined): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const r = Math.round(x * 1000) / 1000;
  return String(r);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function toCsv(
  rows: Row[],
  thresholdsByItemId: Map<number, { minimumStockQty?: string | null; minStockLevel?: string | null }>,
): string {
  const header = [
    "Item",
    "Item Type",
    "Unit",
    "Stock Status",
    "Opening Qty",
    "Total Inward Qty",
    "Total Outward Qty",
    "Adjustment Increase Qty",
    "Adjustment Decrease Qty",
    "System Closing Qty",
    "Current Available Qty",
    "Last Movement Date",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => {
    const th = thresholdsByItemId.get(r.itemId);
    const currentQty =
      r.currentAvailableQty != null && Number.isFinite(Number(r.currentAvailableQty))
        ? Number(r.currentAvailableQty)
        : Number(r.systemClosingQty) || 0;
    const statusLabel = itemStockStatusLabel(
      itemStockStatusFromItemFields({
        currentQty,
        minimumStockQty: th?.minimumStockQty,
        minStockLevel: th?.minStockLevel,
      }),
    );
    return [
      r.itemName,
      r.itemType ?? "",
      r.unit,
      statusLabel,
      fmtQty(r.openingQty),
      fmtQty(r.totalInwardQty),
      fmtQty(r.totalOutwardQty),
      fmtQty(r.adjustmentIncreaseQty),
      fmtQty(r.adjustmentDecreaseQty),
      fmtQty(r.systemClosingQty),
      r.currentAvailableQty == null ? "" : fmtQty(r.currentAvailableQty),
      r.lastMovementDate ? new Date(r.lastMovementDate).toISOString().slice(0, 10) : "",
    ]
      .map(esc)
      .join(",");
  });
  return [header.map(esc).join(","), ...lines].join("\n");
}

export function StockReconciliationReportPage() {
  const { patch, read } = useUrlQueryState({
    fromDate: firstDayOfCurrentMonthYmd(),
    toDate: todayYmd(),
    itemType: "ALL",
    itemId: "",
    onlyAdjustments: "false",
    onlyMovement: "true",
    q: "",
  });

  const fromDate = read.string("fromDate");
  const toDate = read.string("toDate");
  const itemType = read.enum("itemType", ["ALL", "RM", "FG"] as const, "ALL");
  const itemId = read.int("itemId");
  const onlyAdjustments = read.string("onlyAdjustments", "false") === "true";
  const onlyMovement = read.string("onlyMovement", "true") === "true";
  const qFromUrl = read.string("q");
  const [q, setQ] = useDebouncedUrlStringParam({ urlValue: qFromUrl, patch, paramKey: "q" });

  const [items, setItems] = React.useState<ItemOpt[]>([]);
  const [data, setData] = React.useState<ApiResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const missingDates = !fromDate.trim() || !toDate.trim();
  const liveTick = useErpRefreshTick(["reports", "stock"], { pollIntervalMs: ERP_REPORT_POLL_MS });

  React.useEffect(() => {
    apiFetch<ItemOpt[]>("/api/items")
      .then((xs) => setItems(Array.isArray(xs) ? xs : []))
      .catch(() => setItems([]));
  }, [liveTick]);

  const filteredItems = React.useMemo(() => {
    const query = q.trim().toLowerCase();
    const typeFilter = itemType === "ALL" ? null : itemType;
    return items
      .filter((it) => (typeFilter ? it.itemType === typeFilter : true))
      .filter((it) => (query ? it.itemName.toLowerCase().includes(query) : true))
      .slice(0, 200);
  }, [items, itemType, q]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("fromDate", fromDate);
      qs.set("toDate", toDate);
      if (itemType !== "ALL") qs.set("itemType", itemType);
      if (itemId && itemId > 0) qs.set("itemId", String(itemId));
      if (onlyAdjustments) qs.set("onlyAdjustments", "true");
      if (onlyMovement) qs.set("onlyMovement", "true");
      const res = await apiFetch<ApiResp>(`/api/reports/stock-reconciliation?${qs.toString()}`);
      setData(res);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : "Could not load stock reconciliation report.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (missingDates) {
      setLoading(false);
      setData(null);
      setLoadError(null);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, itemType, itemId, onlyAdjustments, onlyMovement, liveTick]);

  const rows = data?.rows ?? [];

  const itemThresholdsById = React.useMemo(() => {
    const m = new Map<number, { minimumStockQty?: string | null; minStockLevel?: string | null }>();
    for (const it of items) {
      m.set(it.id, { minimumStockQty: it.minimumStockQty, minStockLevel: it.minStockLevel });
    }
    return m;
  }, [items]);

  function downloadCsv() {
    const csv = toCsv(rows, itemThresholdsById);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-reconciliation_${fromDate}_to_${toDate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <PageContainer className="pb-8">
      <ReportPageHeader
        title="Stock Reconciliation Report"
        purpose="Compare stock movement and balances to identify mismatches or reconciliation issues."
        actions={
          <Button type="button" variant="outline" size="sm" disabled={!rows.length || missingDates} onClick={downloadCsv}>
            Download CSV
          </Button>
        }
      />

      {missingDates ? (
        <div className="rounded-md border border-sky-200/90 bg-sky-50/90 px-3 py-2 text-sm text-slate-700">
          Select both <span className="font-medium text-slate-900">From date</span> and{" "}
          <span className="font-medium text-slate-900">To date</span> to load reconciliation results for that period.
        </div>
      ) : null}

      {loadError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div> : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            From date
            <Input type="date" value={fromDate} onChange={(e) => patch({ fromDate: e.target.value || null })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            To date
            <Input type="date" value={toDate} onChange={(e) => patch({ toDate: e.target.value || null })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Item Category
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={itemType}
              onChange={(e) => patch({ itemType: e.target.value || null, itemId: null })}
            >
              <option value="ALL">All</option>
              <option value="RM">RM</option>
              <option value="FG">FG</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Select Item
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={itemId || ""}
              onChange={(e) => patch({ itemId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">All items</option>
              {filteredItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.itemName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600 sm:col-span-2 lg:col-span-4">
            Search item
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type item name…" />
          </label>
          <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={onlyAdjustments} onChange={(e) => patch({ onlyAdjustments: String(e.target.checked) })} />
              Show only items with adjustments
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={onlyMovement} onChange={(e) => patch({ onlyMovement: String(e.target.checked) })} />
              Show only items with stock movement
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total items</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{data?.summary.totalItems ?? (loading ? "…" : 0)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Items with adjustments</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{data?.summary.itemsWithAdjustments ?? (loading ? "…" : 0)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total inward qty</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{data ? fmtQty(data.summary.totalInwardQty) : loading ? "…" : "0"}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total outward qty</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{data ? fmtQty(data.summary.totalOutwardQty) : loading ? "…" : "0"}</div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-800">Results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {missingDates ? (
            <div className="border-t border-slate-200 px-4 py-10 text-sm text-slate-600">
              Results appear here after you choose a full date range in <span className="font-medium text-slate-800">Filters</span>.
            </div>
          ) : loading ? (
            <div className="px-4 py-8 text-sm text-slate-500">Loading…</div>
          ) : !rows.length ? (
            <div className="border-t border-slate-200 px-4 py-10">
              <p className="text-sm font-medium text-slate-800">
                No stock movement found for the selected period. Try changing the date range or filters.
              </p>
            </div>
          ) : (
            <div className="erp-table-wrap mt-auto max-w-full overflow-x-auto border-t border-slate-200">
              <table className="erp-table min-w-[1200px] text-xs sm:text-sm">
                <thead className="sticky top-0 z-[1] shadow-[0_1px_0_0_rgb(226_232_240)] [&_th]:bg-slate-50">
                  <tr>
                    <th>Item</th>
                    <th>Type</th>
                    <th>Unit</th>
                    <th className="whitespace-nowrap">Stock status</th>
                    <th className="text-right">Opening</th>
                    <th className="text-right">Inward</th>
                    <th className="text-right">Outward</th>
                    <th className="text-right">Adj +</th>
                    <th className="text-right">Adj −</th>
                    <th className="text-right">System closing</th>
                    <th className="text-right">Current available</th>
                    <th>Last movement</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const th = itemThresholdsById.get(r.itemId);
                    const currentQty =
                      r.currentAvailableQty != null && Number.isFinite(Number(r.currentAvailableQty))
                        ? Number(r.currentAvailableQty)
                        : Number(r.systemClosingQty) || 0;
                    return (
                    <tr key={r.itemId}>
                      <td className="max-w-[18rem] truncate font-medium text-slate-900">{r.itemName}</td>
                      <td className="whitespace-nowrap">{r.itemType ?? "—"}</td>
                      <td className="whitespace-nowrap">{r.unit || "—"}</td>
                      <td className="whitespace-nowrap">
                        <ItemStockStatusBadge
                          currentQty={currentQty}
                          minimumStockQty={th?.minimumStockQty}
                          minStockLevel={th?.minStockLevel}
                        />
                      </td>
                      <td className="text-right tabular-nums">{fmtQty(r.openingQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(r.totalInwardQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(r.totalOutwardQty)}</td>
                      <td className={cn("text-right tabular-nums", r.adjustmentIncreaseQty > 0 ? "font-medium text-emerald-800" : "text-slate-700")}>
                        {fmtQty(r.adjustmentIncreaseQty)}
                      </td>
                      <td className={cn("text-right tabular-nums", r.adjustmentDecreaseQty > 0 ? "font-medium text-red-800" : "text-slate-700")}>
                        {fmtQty(r.adjustmentDecreaseQty)}
                      </td>
                      <td className="text-right tabular-nums font-semibold text-slate-900">{fmtQty(r.systemClosingQty)}</td>
                      <td className="text-right tabular-nums">{r.currentAvailableQty == null ? "—" : fmtQty(r.currentAvailableQty)}</td>
                      <td className="whitespace-nowrap">{fmtDate(r.lastMovementDate)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

