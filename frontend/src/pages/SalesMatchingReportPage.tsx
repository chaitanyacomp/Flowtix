import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PageContainer, ReportPageHeader } from "../components/PageHeader";
import { apiFetch } from "../services/api";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { cn } from "../lib/utils";
import { dispatchLedgerFocusHref, salesOrdersFocusHref, withReportsReturnContext } from "../lib/drillDownRoutes";
import {
  ReportFilterToolbar,
  ReportFilterField,
  ReportKpiStrip,
  ReportEmptyState,
} from "../components/erp/ReportChrome";

type Customer = { id: number; name: string };
type Item = { id: number; itemName: string };

type Row = {
  soId: number;
  salesOrderNo: string;
  salesOrderDate: string;
  customerName: string;
  itemId: number;
  itemName: string;
  unit: string;
  soType: "NORMAL" | "NO_QTY" | "REPLACEMENT";
  orderedQty: number | null;
  operationalQty: number | null;
  dispatchedQty: number;
  invoicedQty: number;
  pendingDispatchQty: number | null;
  pendingInvoiceQty: number;
  excessDispatchQty: number | null;
  excessInvoiceQty: number;
  latestDispatchId: number | null;
  latestDispatchDate: string | null;
  latestSalesBillId: number | null;
  latestSalesBillNo: string | null;
  latestSalesBillDate: string | null;
  status: string;
};

type ApiResp = {
  meta: {
    fromDate: string;
    toDate: string;
    customerId: number | null;
    itemId: number | null;
    soType: "NORMAL" | "NO_QTY" | null;
    status: string;
    mismatchesOnly: boolean;
  };
  summary: {
    totalRows: number;
    mismatchRows: number;
    totalOperationalQty: number;
    totalDispatchedQty: number;
    totalInvoicedQty: number;
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
  if (n == null) return "—";
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

export function SalesMatchingReportPage() {
  const { patch, read } = useUrlQueryState({
    fromDate: ymdDaysAgo(60),
    toDate: todayYmd(),
    customerId: "",
    itemId: "",
    soType: "ALL",
    status: "ALL",
    mismatchesOnly: "false",
    q: "",
  });

  const fromDate = read.string("fromDate");
  const toDate = read.string("toDate");
  const customerId = read.int("customerId");
  const itemId = read.int("itemId");
  const soType = read.string("soType", "ALL");
  const status = read.string("status", "ALL");
  const mismatchesOnly = read.string("mismatchesOnly", "false") === "true";
  const qFromUrl = read.string("q");
  const [q, setQ] = useDebouncedUrlStringParam({ urlValue: qFromUrl, patch, paramKey: "q" });

  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [data, setData] = React.useState<ApiResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const missingDates = !fromDate.trim() || !toDate.trim();

  React.useEffect(() => {
    apiFetch<Customer[]>("/api/customers").then(setCustomers).catch(() => setCustomers([]));
    apiFetch<Item[]>("/api/items?type=FG").then(setItems).catch(() => setItems([]));
  }, []);

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
      if (customerId && customerId > 0) qs.set("customerId", String(customerId));
      if (itemId && itemId > 0) qs.set("itemId", String(itemId));
      if (soType === "NORMAL" || soType === "NO_QTY") qs.set("soType", soType);
      if (status && status !== "ALL") qs.set("status", status);
      if (mismatchesOnly) qs.set("mismatchesOnly", "true");
      const resp = await apiFetch<ApiResp>(`/api/reports/sales-matching?${qs.toString()}`);
      setData(resp);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : "Could not load sales matching report.");
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
  }, [fromDate, toDate, customerId, itemId, soType, status, mismatchesOnly]);

  const rows = data?.rows ?? [];

  return (
    <PageContainer className="pb-8">
      <ReportPageHeader
        title="Sales Matching Report"
        purpose="Shows mismatch between Sales Order, Dispatch, and Sales Bill quantities/documents."
      />

      {missingDates ? (
        <div className="rounded-md border border-sky-200/90 bg-sky-50/90 px-3 py-2 text-sm text-slate-700">
          Select both <span className="font-medium text-slate-900">From date</span> and{" "}
          <span className="font-medium text-slate-900">To date</span> to view this report.
        </div>
      ) : null}

      {loadError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div> : null}

      <ReportFilterToolbar
        applyBusy={loading}
        leftExtras={
          <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
            <input
              type="checkbox"
              checked={mismatchesOnly}
              onChange={(e) => patch({ mismatchesOnly: String(e.target.checked) })}
            />
            Mismatches only
          </label>
        }
      >
        <ReportFilterField label="From">
          <input type="date" value={fromDate} onChange={(e) => patch({ fromDate: e.target.value || null })} />
        </ReportFilterField>
        <ReportFilterField label="To">
          <input type="date" value={toDate} onChange={(e) => patch({ toDate: e.target.value || null })} />
        </ReportFilterField>
        <ReportFilterField label="Customer">
          <select
            value={customerId || ""}
            onChange={(e) => patch({ customerId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="Item">
          <select
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
        </ReportFilterField>
        <ReportFilterField label="Type">
          <select value={soType} onChange={(e) => patch({ soType: e.target.value || null })}>
            <option value="ALL">All</option>
            <option value="NORMAL">Normal</option>
            <option value="NO_QTY">No Qty SO</option>
          </select>
        </ReportFilterField>
        <ReportFilterField label="Status">
          <select value={status} onChange={(e) => patch({ status: e.target.value || null })}>
            <option value="ALL">All</option>
            <option value="Open">Open</option>
            <option value="Partly Dispatched">Partly Dispatched</option>
            <option value="Pending Billing">Pending Billing</option>
            <option value="Fully Billed">Fully Billed</option>
            <option value="Mismatch">Mismatch</option>
            <option value="Closed">Closed</option>
          </select>
        </ReportFilterField>
        <ReportFilterField label="Search item" hideLabel span={2}>
          <input
            type="search"
            className="search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search item name…"
          />
        </ReportFilterField>
      </ReportFilterToolbar>

      <ReportKpiStrip
        items={[
          {
            key: "rows",
            label: "Rows",
            value: data?.summary.totalRows ?? (loading ? "…" : 0),
          },
          {
            key: "mismatches",
            label: "Mismatches",
            value: data?.summary.mismatchRows ?? (loading ? "…" : 0),
            tone: (data?.summary.mismatchRows ?? 0) > 0 ? "warning" : "default",
          },
          {
            key: "dispatched",
            label: "Dispatched qty",
            value: data ? fmtQty(data.summary.totalDispatchedQty) : loading ? "…" : "0",
          },
          {
            key: "invoiced",
            label: "Invoiced qty",
            value: data ? fmtQty(data.summary.totalInvoicedQty) : loading ? "…" : "0",
          },
        ]}
      />

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-800">Results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {missingDates ? (
            <div className="p-3">
              <ReportEmptyState
                title="Select a date range"
                body="Choose both From and To dates above to load sales matching results."
              />
            </div>
          ) : loading ? (
            <div className="px-4 py-6 text-sm text-slate-500">Loading…</div>
          ) : !rows.length ? (
            <div className="p-3">
              <ReportEmptyState
                title="No rows match these filters"
                body="Widen the date range, clear SO type / status, or untick “Mismatches only”."
              />
            </div>
          ) : (
            <div className="erp-table-wrap mt-auto max-w-full overflow-x-auto border-t border-slate-200">
              <table className="erp-table min-w-[1320px] text-xs sm:text-sm">
                <thead className="sticky top-0 z-[1] shadow-[0_1px_0_0_rgb(226_232_240)] [&_th]:bg-slate-50">
                  <tr>
                    <th>SO No</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Item</th>
                    <th>SO Type</th>
                    <th className="text-right">Operational Qty</th>
                    <th className="text-right">Dispatched</th>
                    <th className="text-right">Sales bill qty</th>
                    <th className="text-right">Pending dispatch</th>
                    <th className="text-right">Pending invoice</th>
                    <th className="text-right">Excess dispatch</th>
                    <th className="text-right">Excess invoice</th>
                    <th>Latest dispatch</th>
                    <th>Latest bill</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.soId}-${r.itemId}`}>
                      <td className="whitespace-nowrap">
                        <Link to={withReportsReturnContext(salesOrdersFocusHref(r.soId))} className="text-primary underline">
                          {r.salesOrderNo}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap">{fmtDate(r.salesOrderDate)}</td>
                      <td className="max-w-[12rem] truncate">{r.customerName}</td>
                      <td className="max-w-[14rem] truncate">
                        <span className="font-medium text-slate-900">{r.itemName}</span>
                        <span className="text-slate-500"> · {r.unit || "—"}</span>
                      </td>
                      <td className="whitespace-nowrap">{r.soType}</td>
                      <td className="text-right tabular-nums">{fmtQty(r.operationalQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(r.dispatchedQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(r.invoicedQty)}</td>
                      <td className="text-right tabular-nums">{r.pendingDispatchQty == null ? "—" : fmtQty(r.pendingDispatchQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(r.pendingInvoiceQty)}</td>
                      <td className={cn("text-right tabular-nums", (r.excessDispatchQty ?? 0) > 0 ? "font-medium text-amber-800" : "text-slate-700")}>
                        {r.excessDispatchQty == null ? "—" : fmtQty(r.excessDispatchQty)}
                      </td>
                      <td className={cn("text-right tabular-nums", r.excessInvoiceQty > 0 ? "font-medium text-red-800" : "text-slate-700")}>
                        {fmtQty(r.excessInvoiceQty)}
                      </td>
                      <td className="whitespace-nowrap">
                        {r.latestDispatchId ? (
                          <Link
                            to={withReportsReturnContext(dispatchLedgerFocusHref(r.latestDispatchId))}
                            className="text-primary underline"
                          >
                            {`DSP-${String(r.latestDispatchId).padStart(6, "0")}`}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {r.latestSalesBillId ? (
                          <Link
                            to={withReportsReturnContext(`/sales-bills/${r.latestSalesBillId}`)}
                            className="text-primary underline"
                          >
                            {r.latestSalesBillNo || `SB-${r.latestSalesBillId}`}
                          </Link>
                        ) : (
                          "—"
                        )}
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
        Notes: For <span className="font-medium">NO_QTY</span> sales orders, “Operational Qty” is taken from the latest{" "}
        <span className="font-medium">locked Requirement Sheet</span> cap (if available). If no cap is locked yet, pending dispatch is shown as “—”.
      </div>
    </PageContainer>
  );
}

