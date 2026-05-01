import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch, ApiRequestError } from "../services/api";
import { PageContainer, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { withReportsReturnContextIfPresent } from "../lib/drillDownRoutes";

type Supplier = { id: number; name: string };

type BillRow = {
  id: number;
  billNo: string | null;
  billDate: string;
  totalBasic: string | number;
  totalTax: string | number;
  netAmount: string | number;
  status: string;
  isExported?: boolean;
  exportedAt?: string | null;
  supplier: { id: number; name: string };
  grn?: { id: number } | null;
};

function num(v: string | number): number {
  return typeof v === "number" ? v : Number(v);
}

function formatMoney(n: string | number): string {
  const x = num(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export function PurchaseBillsListPage() {
  const location = useLocation();
  const [rows, setRows] = React.useState<BillRow[]>([]);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [supplierId, setSupplierId] = React.useState<string>("");
  const [status, setStatus] = React.useState<string>("ALL");
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    apiFetch<Supplier[]>("/api/suppliers").then(setSuppliers).catch(() => {});
  }, []);

  async function load() {
    setLoadError(null);
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (fromDate) q.set("fromDate", fromDate);
      if (toDate) q.set("toDate", toDate);
      if (supplierId) q.set("supplierId", supplierId);
      if (status && status !== "ALL") q.set("status", status);
      if (search.trim()) q.set("search", search.trim());
      const qs = q.toString();
      const path = qs ? `/api/purchase-bills?${qs}` : "/api/purchase-bills";
      const data = await apiFetch<BillRow[]>(path);
      setRows(data);
    } catch (e) {
      const msg =
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not load purchase bills.";
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional filter reload
  }, []);

  return (
    <PageContainer>
      <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/dashboard" defaultLabel="Back to Dashboard" />}>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold leading-snug text-slate-900">Purchase bills</h1>
            <p className="text-sm leading-relaxed text-slate-600">
              Supplier invoices linked to GRNs (Tally-ready values; no stock impact).
            </p>
          </div>
          <Link to={withReportsReturnContextIfPresent("/purchase-bills/new", location.search)} className="shrink-0 sm:pt-0.5">
            <Button type="button">New purchase bill</Button>
          </Link>
        </div>
      </StickyWorkspaceHead>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-medium text-slate-600">From date</span>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-medium text-slate-600">To date</span>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-medium text-slate-600">Supplier</span>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-medium text-slate-600">Status</span>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="ALL">All</option>
              <option value="DRAFT">Draft</option>
              <option value="FINALIZED">Finalized</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-medium text-slate-600">Search</span>
            <Input
              placeholder="Bill no. or supplier"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-5">
            <Button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? "Loading…" : "Apply filters"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {loadError ? (
        <div className="min-w-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800 break-words">
          {loadError}
        </div>
      ) : null}

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bills</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 p-0 sm:p-6 sm:pt-0">
          <div className="min-w-0 overflow-x-auto px-3 pb-4 sm:px-0 sm:pb-0">
            <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                <th className="px-4 py-2">Bill no.</th>
                <th className="px-4 py-2">Bill date</th>
                <th className="min-w-[8rem] px-4 py-2">Supplier</th>
                <th className="px-4 py-2">Refs</th>
                <th className="px-4 py-2 text-right">Taxable</th>
                <th className="px-4 py-2 text-right">Tax</th>
                <th className="px-4 py-2 text-right">Grand total</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    <div className="mx-auto max-w-[30rem] space-y-1">
                      <div className="text-base font-semibold text-slate-900">🧾 No Purchase Bills yet</div>
                      <div className="text-sm text-slate-600">Create a bill from received goods (GRN).</div>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="px-4 py-2 font-medium text-slate-900">
                      <Link
                        className="text-sky-700 underline-offset-4 hover:underline"
                        to={withReportsReturnContextIfPresent(`/purchase-bills/${r.id}`, location.search)}
                      >
                        {r.billNo?.trim() ? r.billNo : `PB-${r.id} (draft)`}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{formatDate(r.billDate)}</td>
                    <td className="max-w-[12rem] px-4 py-2 text-slate-700 sm:max-w-[16rem]">
                      <span className="line-clamp-2 break-words">{r.supplier.name}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {r.grn?.id ? (
                        <Link
                          className="text-sky-700 underline-offset-4 hover:underline"
                          to={withReportsReturnContextIfPresent("/rm-po-grn", location.search)}
                        >
                          GRN-{r.grn.id}
                        </Link>
                      ) : (
                        <span className="text-slate-500">Multiple GRNs</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-800">{formatMoney(r.totalBasic)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-800">{formatMoney(r.totalTax)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-800">{formatMoney(r.netAmount)}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            r.status === "FINALIZED"
                              ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
                              : r.status === "CANCELLED"
                                ? "rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800"
                                : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
                          }
                        >
                          {r.status === "FINALIZED" ? "Finalized" : r.status === "CANCELLED" ? "Cancelled" : "Draft"}
                        </span>
                        <span
                          className={
                            r.isExported
                              ? "rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800"
                              : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                          }
                          title={r.isExported ? "Exported to Tally" : "Not exported to Tally"}
                        >
                          {r.isExported ? "Exported" : "Not exported"}
                        </span>
                        {r.status === "CANCELLED" ? (
                          <span className="text-xs text-slate-500" title="Stock unchanged; billing cancelled only.">
                            Stock unchanged
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
