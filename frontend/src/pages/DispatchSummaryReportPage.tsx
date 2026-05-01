import * as React from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../services/api";
import { cn } from "../lib/utils";
import { ReportPageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useUrlQueryState } from "../hooks/useUrlQueryState";

type Customer = { id: number; name: string };
type Item = { id: number; itemName: string; itemType: string };

type DispatchLineStat = {
  lineId: number;
  itemId: number;
  itemName: string;
  dispatchable: number;
  dispatchBlockedReason?: string | null;
};

type DispatchSalesOrderRow = {
  id: number;
  docNo: string | null;
  customer?: { name?: string | null } | null;
  customerName?: string | null;
  lineStats: DispatchLineStat[];
};

type DispatchSummaryHistoryRow = {
  id: number;
  date: string;
  soId: number;
  soNo: string | null;
  customerName: string | null;
  itemId: number;
  itemName: string | null;
  qty: number;
  reversalOfId: number | null;
};

type DispatchSummaryApi = {
  kpis: { dispatchTodayQty: number; dispatchMonthQty: number };
  history: DispatchSummaryHistoryRow[];
};

const URL_OMIT: Record<string, string> = {
  fromDate: "",
  toDate: "",
  customerId: "",
  itemId: "",
};

function safeNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ymdToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(3).replace(/\.000$/, "");
}

export function DispatchSummaryReportPage() {
  const { read, patch } = useUrlQueryState(URL_OMIT);
  const fromDate = read.string("fromDate");
  const toDate = read.string("toDate");
  const customerId = read.string("customerId");
  const itemId = read.string("itemId");

  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [pendingRows, setPendingRows] = React.useState<{ soNo: string; customerName: string; itemName: string; ready: number; status: string }[]>([]);
  const [history, setHistory] = React.useState<DispatchSummaryHistoryRow[]>([]);
  const [kpis, setKpis] = React.useState<{ dispatchTodayQty: number; dispatchMonthQty: number }>({ dispatchTodayQty: 0, dispatchMonthQty: 0 });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    apiFetch<Customer[]>("/api/customers").then(setCustomers).catch(() => setCustomers([]));
    apiFetch<Item[]>("/api/items").then(setItems).catch(() => setItems([]));
  }, []);

  React.useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams();
    if (fromDate) qs.set("fromDate", fromDate);
    if (toDate) qs.set("toDate", toDate);
    if (customerId) qs.set("customerId", customerId);
    if (itemId) qs.set("itemId", itemId);

    Promise.allSettled([
      // Pending section must match Dispatch page operational logic exactly.
      apiFetch<DispatchSalesOrderRow[]>("/api/dispatch/sales-orders"),
      apiFetch<DispatchSummaryApi>(`/api/reports/dispatch-summary${qs.toString() ? `?${qs.toString()}` : ""}`),
    ])
      .then(([pendingRes, histRes]) => {
        if (!mounted) return;

        const dispatchRows: DispatchSalesOrderRow[] =
          pendingRes.status === "fulfilled" && Array.isArray(pendingRes.value) ? pendingRes.value : [];

        const selectedCustomerId = customerId ? Number(customerId) : null;
        const selectedItemId = itemId ? Number(itemId) : null;

        const pendingFlat = dispatchRows.flatMap((so) => {
          const soNo = String(so.docNo ?? `SO-${so.id}`);
          const customerName = String(so.customerName ?? so.customer?.name ?? "—");
          return (so.lineStats || []).map((ls) => ({
            soNo,
            customerName,
            itemId: Number(ls.itemId),
            itemName: String(ls.itemName ?? `Item #${ls.itemId}`),
            ready: safeNum(ls.dispatchable),
            status: safeNum(ls.dispatchable) > 1e-9 ? "Can dispatch now" : (ls.dispatchBlockedReason?.trim() ?? "Cannot dispatch now"),
          }));
        });

        // Filters apply to pending too (but pending logic source remains the dispatch API).
        const pendingFiltered = pendingFlat
          .filter((r) => r.ready > 1e-9)
          .filter((r) => (selectedItemId ? r.itemId === selectedItemId : true))
          .filter((r) => {
            if (!selectedCustomerId) return true;
            const match = customers.find((c) => c.id === selectedCustomerId);
            if (!match) return true;
            return r.customerName === match.name;
          })
          .sort((a, b) => b.ready - a.ready);

        setPendingRows(
          pendingFiltered.map((r) => ({
            soNo: r.soNo,
            customerName: r.customerName,
            itemName: r.itemName,
            ready: r.ready,
            status: r.status,
          })),
        );

        if (histRes.status === "fulfilled" && histRes.value) {
          setHistory(Array.isArray(histRes.value.history) ? histRes.value.history : []);
          setKpis(histRes.value.kpis ?? { dispatchTodayQty: 0, dispatchMonthQty: 0 });
        } else {
          setHistory([]);
          setKpis({ dispatchTodayQty: 0, dispatchMonthQty: 0 });
        }
      })
      .catch((e) => {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load dispatch summary.");
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [fromDate, toDate, customerId, itemId, customers]);

  const pendingDispatchLines = pendingRows.length;
  const pendingDispatchQty = pendingRows.reduce((s, r) => s + safeNum(r.ready), 0);

  const kpiPillClass = "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[12px]";

  const selectClass =
    "h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 shadow-sm";

  return (
    <div className="grid gap-3">
      <ReportPageHeader
        className="mb-0"
        title="Dispatch Summary"
        purpose="Ready-to-ship now (same rules as Dispatch) plus locked dispatch history for the filters you choose."
        actions={
          <Link to="/dispatch?source=reports" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}>
            Open Dispatch
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
        <span className={kpiPillClass}>
          <span className="font-medium text-slate-600">Dispatch Today</span>
          <span className="font-semibold tabular-nums text-slate-900">{fmtQty(kpis.dispatchTodayQty)}</span>
        </span>
        <span className={kpiPillClass}>
          <span className="font-medium text-slate-600">Dispatch This Month</span>
          <span className="font-semibold tabular-nums text-slate-900">{fmtQty(kpis.dispatchMonthQty)}</span>
        </span>
        <span className={kpiPillClass}>
          <span className="font-medium text-slate-600">Pending Dispatch Qty</span>
          <span className="font-semibold tabular-nums text-slate-900">{fmtQty(pendingDispatchQty)}</span>
        </span>
        <span className={kpiPillClass}>
          <span className="font-medium text-slate-600">Pending Dispatch Lines</span>
          <span className="font-semibold tabular-nums text-slate-900">{pendingDispatchLines}</span>
        </span>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            From
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => patch({ fromDate: e.target.value || null })}
              placeholder={ymdToday()}
              className="h-9"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            To
            <Input
              type="date"
              value={toDate}
              onChange={(e) => patch({ toDate: e.target.value || null })}
              placeholder={ymdToday()}
              className="h-9"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Customer
            <select className={selectClass} value={customerId} onChange={(e) => patch({ customerId: e.target.value || null })}>
              <option value="">All</option>
              {customers.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Item
            <select className={selectClass} value={itemId} onChange={(e) => patch({ itemId: e.target.value || null })}>
              <option value="">All</option>
              {items.map((i) => (
                <option key={i.id} value={String(i.id)}>
                  {i.itemName}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</div> : null}
      {loading ? <div className="text-[13px] text-slate-600">Loading…</div> : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pending Dispatch (ready to ship)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {pendingRows.length === 0 && !loading ? (
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
              No dispatchable lines found for the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr className="text-left text-[12px] text-slate-600">
                    <th className="px-3 py-2 font-medium">SO No</th>
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Ready to Ship</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRows.map((r, idx) => (
                    <tr key={`${r.soNo}-${r.itemName}-${idx}`} className="border-b border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap font-medium tabular-nums text-slate-900">{r.soNo}</td>
                      <td className="px-3 py-2 max-w-[14rem] truncate">{r.customerName}</td>
                      <td className="px-3 py-2 max-w-[14rem] truncate">{r.itemName}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{fmtQty(r.ready)}</td>
                      <td className="px-3 py-2 text-slate-700">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Dispatched History (LOCKED)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {history.length === 0 && !loading ? (
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
              No locked dispatch rows found for the selected date range / filters.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr className="text-left text-[12px] text-slate-600">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">SO No</th>
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(d.date).toLocaleString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium tabular-nums text-slate-900">
                        {d.soNo ?? `SO-${d.soId}`}
                      </td>
                      <td className="px-3 py-2 max-w-[14rem] truncate">{d.customerName ?? "—"}</td>
                      <td className="px-3 py-2 max-w-[14rem] truncate">{d.itemName ?? `Item #${d.itemId}`}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                        {fmtQty(safeNum(d.qty))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

