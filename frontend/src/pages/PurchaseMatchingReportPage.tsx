import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { PageContainer, ReportPageHeader } from "../components/PageHeader";
import { apiFetch } from "../services/api";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { cn } from "../lib/utils";
import { rmPoGrnFocusHref, withReportsReturnContext } from "../lib/drillDownRoutes";

type Supplier = { id: number; name: string };
type Item = { id: number; itemName: string };

type Row = {
  rmPoId: number;
  purchaseRef: string;
  purchaseDate: string;
  supplierId: number;
  supplierName: string;
  itemId: number;
  itemName: string;
  unit: string;
  orderedQty: number;
  receivedQty: number;
  billedQty: number;
  pendingReceiptQty: number;
  pendingBillQty: number;
  excessReceiptQty: number;
  excessBillQty: number;
  latestGrnId: number | null;
  latestGrnDate: string | null;
  latestPurchaseBillId: number | null;
  latestPurchaseBillNo: string | null;
  latestPurchaseBillStatus: string | null;
  status: string;
};

type ApiResp = {
  meta: {
    fromDate: string;
    toDate: string;
    supplierId: number | null;
    itemId: number | null;
    status: string;
    mismatchesOnly: boolean;
  };
  summary: {
    totalRows: number;
    mismatchRows: number;
    totalOrderedQty: number;
    totalReceivedQty: number;
    totalBilledQty: number;
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

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
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

export function PurchaseMatchingReportPage() {
  const { patch, read } = useUrlQueryState({
    fromDate: ymdDaysAgo(60),
    toDate: todayYmd(),
    supplierId: "",
    itemId: "",
    status: "ALL",
    mismatchesOnly: "false",
    q: "",
  });

  const fromDate = read.string("fromDate");
  const toDate = read.string("toDate");
  const supplierId = read.int("supplierId");
  const itemId = read.int("itemId");
  const status = read.string("status", "ALL");
  const mismatchesOnly = read.string("mismatchesOnly", "false") === "true";
  const qFromUrl = read.string("q");
  const [q, setQ] = useDebouncedUrlStringParam({ urlValue: qFromUrl, patch, paramKey: "q" });

  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [data, setData] = React.useState<ApiResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const missingDates = !fromDate.trim() || !toDate.trim();
  const liveTick = useErpRefreshTick(["reports", "stock"], { pollIntervalMs: ERP_REPORT_POLL_MS });

  React.useEffect(() => {
    apiFetch<Supplier[]>("/api/suppliers").then(setSuppliers).catch(() => setSuppliers([]));
    apiFetch<Item[]>("/api/items?type=RM").then(setItems).catch(() => setItems([]));
  }, [liveTick]);

  const filteredItems = React.useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items.slice(0, 200);
    return items.filter((it) => it.itemName.toLowerCase().includes(query)).slice(0, 200);
  }, [items, q]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("fromDate", fromDate);
      qs.set("toDate", toDate);
      if (supplierId && supplierId > 0) qs.set("supplierId", String(supplierId));
      if (itemId && itemId > 0) qs.set("itemId", String(itemId));
      if (status && status !== "ALL") qs.set("status", status);
      if (mismatchesOnly) qs.set("mismatchesOnly", "true");
      const resp = await apiFetch<ApiResp>(`/api/reports/purchase-matching?${qs.toString()}`);
      setData(resp);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : "Could not load purchase matching report.");
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
  }, [fromDate, toDate, supplierId, itemId, status, mismatchesOnly, liveTick]);

  const rows = data?.rows ?? [];

  return (
    <PageContainer className="pb-8">
      <ReportPageHeader
        title="Purchase Matching Report"
        purpose="Compare Material Planning orders, GRN receipts, and purchase bills to spot pending receipt, pending billing, or quantity mismatches."
      />

      {missingDates ? (
        <div className="rounded-md border border-sky-200/90 bg-sky-50/90 px-3 py-2 text-sm text-slate-700">
          Select both <span className="font-medium text-slate-900">From date</span> and{" "}
          <span className="font-medium text-slate-900">To date</span> to view this report.
        </div>
      ) : null}

      {loadError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div> : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            From date (Material Planning date)
            <Input type="date" value={fromDate} onChange={(e) => patch({ fromDate: e.target.value || null })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            To date (Material Planning date)
            <Input type="date" value={toDate} onChange={(e) => patch({ toDate: e.target.value || null })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Supplier
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={supplierId || ""}
              onChange={(e) => patch({ supplierId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Item
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
            Search item (helps the dropdown)
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type item name…" />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Status
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={status}
              onChange={(e) => patch({ status: e.target.value || null })}
            >
              <option value="ALL">All</option>
              <option value="Pending Receipt">Pending Receipt</option>
              <option value="Partly Received">Partly Received</option>
              <option value="Pending Billing">Pending Billing</option>
              <option value="Fully Billed">Fully Billed</option>
              <option value="Mismatch">Mismatch</option>
              <option value="Closed">Closed</option>
            </select>
          </label>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={mismatchesOnly} onChange={(e) => patch({ mismatchesOnly: String(e.target.checked) })} />
              Show mismatches only
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rows</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{data?.summary.totalRows ?? (loading ? "…" : 0)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mismatches</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{data?.summary.mismatchRows ?? (loading ? "…" : 0)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total received qty</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{data ? fmtQty(data.summary.totalReceivedQty) : loading ? "…" : "0"}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total billed qty</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{data ? fmtQty(data.summary.totalBilledQty) : loading ? "…" : "0"}</div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-800">Results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {missingDates ? (
            <div className="border-t border-slate-200 px-4 py-10 text-sm text-slate-600">
              Choose a full date range in <span className="font-medium text-slate-800">Filters</span> to load purchase matching
              results.
            </div>
          ) : loading ? (
            <div className="px-4 py-8 text-sm text-slate-500">Loading…</div>
          ) : !rows.length ? (
            <div className="border-t border-slate-200 px-4 py-10">
              <p className="text-sm font-medium text-slate-800">No rows</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                No purchase lines match the current filters for this date range.
              </p>
            </div>
          ) : (
            <div className="erp-table-wrap mt-auto max-w-full overflow-x-auto border-t border-slate-200">
              <table className="erp-table min-w-[1240px] text-xs sm:text-sm">
                <thead className="sticky top-0 z-[1] shadow-[0_1px_0_0_rgb(226_232_240)] [&_th]:bg-slate-50">
                  <tr>
                    <th>Purchase Ref</th>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th>Item</th>
                    <th className="text-right">Ordered</th>
                    <th className="text-right">Received</th>
                    <th className="text-right">Billed</th>
                    <th className="text-right">Pending receipt</th>
                    <th className="text-right">Pending bill</th>
                    <th className="text-right">Excess receipt</th>
                    <th className="text-right">Excess bill</th>
                    <th>Latest GRN</th>
                    <th>Latest Bill</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.rmPoId}-${r.itemId}`}>
                      <td className="whitespace-nowrap">
                        <Link to={withReportsReturnContext(rmPoGrnFocusHref(r.rmPoId))} className="text-primary underline">
                          {r.purchaseRef}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap">{fmtDate(r.purchaseDate)}</td>
                      <td className="max-w-[12rem] truncate">{r.supplierName}</td>
                      <td className="max-w-[14rem] truncate">
                        <span className="font-medium text-slate-900">{r.itemName}</span>
                        <span className="text-slate-500"> · {r.unit || "—"}</span>
                      </td>
                      <td className="text-right tabular-nums">{fmtQty(r.orderedQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(r.receivedQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(r.billedQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(r.pendingReceiptQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(r.pendingBillQty)}</td>
                      <td className={cn("text-right tabular-nums", r.excessReceiptQty > 0 ? "font-medium text-amber-800" : "text-slate-700")}>
                        {fmtQty(r.excessReceiptQty)}
                      </td>
                      <td className={cn("text-right tabular-nums", r.excessBillQty > 0 ? "font-medium text-red-800" : "text-slate-700")}>
                        {fmtQty(r.excessBillQty)}
                      </td>
                      <td className="whitespace-nowrap">{r.latestGrnId ? `GRN-${r.latestGrnId}` : "—"}</td>
                      <td className="whitespace-nowrap">
                        {r.latestPurchaseBillId ? (
                          <Link
                            to={withReportsReturnContext(`/purchase-bills/${r.latestPurchaseBillId}`)}
                            className="text-primary underline"
                          >
                            {r.latestPurchaseBillNo || `PB-${r.latestPurchaseBillId}`}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {r.latestPurchaseBillStatus ? (
                          <span className="ml-2 text-xs text-slate-500">{r.latestPurchaseBillStatus}</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={cn("rounded px-2 py-0.5 text-xs", r.status === "Mismatch" ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700")}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-slate-500">
        Notes: “Billed Qty” counts only FINALIZED purchase bills. Draft bills are shown in “Latest Bill” but do not contribute to billed totals.
      </div>
    </PageContainer>
  );
}

