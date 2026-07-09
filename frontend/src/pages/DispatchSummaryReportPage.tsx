import * as React from "react";
import { apiFetch } from "../services/api";
import { cn } from "../lib/utils";
import { PageContainer, ReportPageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useUrlQueryState } from "../hooks/useUrlQueryState";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { ReportKpiStrip, type ReportKpiItem } from "../components/erp/ReportChrome";
import {
  ReportPrintExportBar,
  ReportPrintMeta,
  downloadReportCsv,
} from "../components/erp/ReportPrintExport";

type Customer = { id: number; name: string };
type Item = { id: number; itemName: string; itemType: string };

type DispatchLineStat = {
  lineId: number;
  itemId: number;
  itemName: string;
  dispatchable: number;
  dispatchableQty?: number;
  pendingDispatchQty?: number;
  noQtyCycleNo?: number | null;
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
  tab: "pending",
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

type SummaryTab = "pending" | "register";

export function DispatchSummaryReportPage() {
  const { read, patch } = useUrlQueryState(URL_OMIT);
  const fromDate = read.string("fromDate");
  const toDate = read.string("toDate");
  const customerId = read.string("customerId");
  const itemId = read.string("itemId");
  const tabRaw = read.string("tab");
  const activeTab: SummaryTab = tabRaw === "register" ? "register" : "pending";

  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [pendingRows, setPendingRows] = React.useState<
    { soNo: string; customerName: string; itemName: string; ready: number; status: string }[]
  >([]);
  const [history, setHistory] = React.useState<DispatchSummaryHistoryRow[]>([]);
  const [kpis, setKpis] = React.useState<{ dispatchTodayQty: number; dispatchMonthQty: number }>({
    dispatchTodayQty: 0,
    dispatchMonthQty: 0,
  });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const liveTick = useErpRefreshTick(["reports", "dispatch", "dashboard"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });

  React.useEffect(() => {
    apiFetch<Customer[]>("/api/customers").then(setCustomers).catch(() => setCustomers([]));
    apiFetch<Item[]>("/api/items").then(setItems).catch(() => setItems([]));
  }, [liveTick]);

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
        const selectedCustomerName =
          selectedCustomerId != null
            ? customers.find((c) => c.id === selectedCustomerId)?.name?.trim().toLowerCase() ?? null
            : null;

        const nextPending: typeof pendingRows = [];
        for (const so of dispatchRows) {
          const soCustomer =
            String(so.customer?.name ?? so.customerName ?? "")
              .trim()
              .toLowerCase() || "";
          if (selectedCustomerName && soCustomer && soCustomer !== selectedCustomerName) continue;
          for (const ls of so.lineStats ?? []) {
            const ready = Math.max(0, safeNum(ls.dispatchable ?? ls.dispatchableQty ?? 0));
            if (!(ready > 1e-9)) continue;
            if (selectedItemId != null && Number(ls.itemId) !== selectedItemId) continue;
            nextPending.push({
              soNo: so.docNo ?? `SO-${so.id}`,
              customerName: so.customer?.name ?? so.customerName ?? "—",
              itemName: ls.itemName,
              ready,
              status: ls.dispatchBlockedReason?.trim() || "Ready",
            });
          }
        }
        setPendingRows(nextPending);

        if (histRes.status === "fulfilled" && histRes.value) {
          setKpis(histRes.value.kpis ?? { dispatchTodayQty: 0, dispatchMonthQty: 0 });
          setHistory(Array.isArray(histRes.value.history) ? histRes.value.history : []);
        } else {
          setKpis({ dispatchTodayQty: 0, dispatchMonthQty: 0 });
          setHistory([]);
          if (pendingRes.status === "rejected" && histRes.status === "rejected") {
            setError("Could not load dispatch summary.");
          }
        }
      })
      .catch(() => {
        if (!mounted) return;
        setError("Could not load dispatch summary.");
        setPendingRows([]);
        setHistory([]);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [fromDate, toDate, customerId, itemId, customers, liveTick]);

  const pendingDispatchLines = pendingRows.length;
  const pendingDispatchQty = pendingRows.reduce((s, r) => s + safeNum(r.ready), 0);
  const pendingDispatchOrders = new Set(pendingRows.map((r) => r.soNo).filter(Boolean)).size;

  const kpiItems: ReportKpiItem[] = [
    { key: "today", label: "Dispatch Today", value: fmtQty(kpis.dispatchTodayQty) },
    { key: "month", label: "Dispatch This Month", value: fmtQty(kpis.dispatchMonthQty) },
    {
      key: "pending-qty",
      label: "Pending Dispatch Qty",
      value: fmtQty(pendingDispatchQty),
      tone: pendingDispatchQty > 1e-9 ? "warning" : "default",
    },
    {
      key: "pending-orders",
      label: "Pending Dispatch Orders",
      value: String(pendingDispatchOrders),
      tone: pendingDispatchOrders > 0 ? "warning" : "default",
    },
  ];

  const selectClass =
    "h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 shadow-sm";

  const filterSummary = [
    fromDate ? `From ${fromDate}` : null,
    toDate ? `To ${toDate}` : null,
    customerId ? `Customer #${customerId}` : null,
    itemId ? `Item #${itemId}` : null,
    activeTab === "register" ? "Tab Register" : "Tab Pending",
  ]
    .filter(Boolean)
    .join(" · ");

  function exportActiveTabCsv() {
    if (activeTab === "pending") {
      downloadReportCsv(
        `dispatch-summary-pending_${ymdToday()}.csv`,
        ["SO No", "Customer", "Item", "Ready to Ship", "Status"],
        pendingRows.map((r) => [r.soNo, r.customerName, r.itemName, r.ready, r.status]),
      );
      return;
    }
    downloadReportCsv(
      `dispatch-summary-register_${ymdToday()}.csv`,
      ["Date", "SO No", "Customer", "Item", "Qty"],
      history.map((d) => [
        d.date,
        d.soNo ?? `SO-${d.soId}`,
        d.customerName ?? "",
        d.itemName ?? `Item #${d.itemId}`,
        d.qty,
      ]),
    );
  }

  const tabBtn = (id: SummaryTab, label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={activeTab === id}
      className={cn(
        "border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
        activeTab === id
          ? "border-slate-900 text-slate-900"
          : "border-transparent text-slate-500 hover:text-slate-800",
      )}
      onClick={() => patch({ tab: id === "pending" ? null : id })}
    >
      {label}
    </button>
  );

  return (
    <PageContainer className="erp-report-page pb-8">
      <ReportPrintMeta title="Dispatch Summary" filterSummary={filterSummary} />
      <ReportPageHeader
        className="mb-0"
        title="Dispatch Summary"
        purpose="Operational dispatch analytics — ready-to-ship pending (same rules as Dispatch) and locked dispatch register. Read-only; open Dispatch Workspace to execute."
        actions={
          <ReportPrintExportBar
            filterSummary={filterSummary}
            onExportCsv={exportActiveTabCsv}
            csvDisabled={loading}
          />
        }
      />

      <ReportKpiStrip items={kpiItems} className="mt-2" />

      <Card className="mt-3 border-slate-200 shadow-sm">
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
            <select
              className={selectClass}
              value={customerId}
              onChange={(e) => patch({ customerId: e.target.value || null })}
            >
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

      {error ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</div>
      ) : null}
      {loading ? <div className="mt-2 text-[13px] text-slate-600">Loading…</div> : null}

      <div className="mt-3 border-b border-slate-200" role="tablist" aria-label="Dispatch summary views">
        {tabBtn("pending", "Pending Dispatch")}
        {tabBtn("register", "Dispatch Register")}
      </div>

      {activeTab === "pending" ? (
        <Card className="mt-3 border-slate-200 shadow-sm">
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
                        <td className="max-w-[14rem] truncate px-3 py-2">{r.customerName}</td>
                        <td className="max-w-[14rem] truncate px-3 py-2">{r.itemName}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                          {fmtQty(r.ready)}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-3 border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Dispatch Register (LOCKED history)</CardTitle>
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
                        <td className="whitespace-nowrap px-3 py-2">{new Date(d.date).toLocaleString()}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums text-slate-900">
                          {d.soNo ?? `SO-${d.soId}`}
                        </td>
                        <td className="max-w-[14rem] truncate px-3 py-2">{d.customerName ?? "—"}</td>
                        <td className="max-w-[14rem] truncate px-3 py-2">{d.itemName ?? `Item #${d.itemId}`}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">
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
      )}
    </PageContainer>
  );
}
