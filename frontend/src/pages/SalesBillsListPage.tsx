import * as React from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch, ApiRequestError } from "../services/api";
import { PageContainer, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { withReportsReturnContextIfPresent } from "../lib/drillDownRoutes";
import { displayDispatchNo, displaySalesBillNo, displaySalesOrderNo } from "../lib/docNoDisplay";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";

type Customer = { id: number; name: string };

type BillRow = {
  id: number;
  docNo?: string | null;
  billNo: string | null;
  billDate: string;
  netAmount: string | number;
  status: string;
  isExported?: boolean;
  customer: { id: number; name: string };
  dispatch: { id: number; soId: number; date: string; docNo?: string | null; salesOrder?: { docNo?: string | null } };
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

export function SalesBillsListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sp] = useSearchParams();
  const source = sp.get("source") ?? "";
  const fromNoQtySo = source === "no_qty_so";
  const focusSoId = Number(sp.get("salesOrderId") ?? 0);
  const focusSoIdValid = Number.isFinite(focusSoId) && focusSoId > 0;

  const demo = useDemoMode();
  const showNoQtyFinalStepPreview = demo.enabled && demo.flow === "no_qty" && demo.step === 7;
  const billDemoHl =
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "regular", 6) ??
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "no_qty", 7);

  const [rows, setRows] = React.useState<BillRow[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [customerId, setCustomerId] = React.useState<string>("");
  const [status, setStatus] = React.useState<string>("ALL");
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [pendingTallyOnly, setPendingTallyOnly] = React.useState(false);
  const [hasCompletedLoad, setHasCompletedLoad] = React.useState(false);

  React.useEffect(() => {
    apiFetch<Customer[]>("/api/customers").then(setCustomers).catch(() => {});
  }, []);

  async function load() {
    setLoadError(null);
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (fromDate) q.set("fromDate", fromDate);
      if (toDate) q.set("toDate", toDate);
      if (customerId) q.set("customerId", customerId);
      if (status && status !== "ALL") q.set("status", status);
      if (search.trim()) q.set("search", search.trim());
      const qs = q.toString();
      const path = qs ? `/api/sales-bills?${qs}` : "/api/sales-bills";
      const data = await apiFetch<BillRow[]>(path);
      const list = Array.isArray(data) ? data : [];
      setRows(focusSoIdValid ? list.filter((r) => Number(r.dispatch?.soId) === focusSoId) : list);
    } catch (e) {
      const msg =
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not load sales bills.";
      setLoadError(msg);
    } finally {
      setLoading(false);
      setHasCompletedLoad(true);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromNoQtySo, focusSoId, focusSoIdValid]);

  const isDefaultFilterState =
    !fromDate && !toDate && !customerId && status === "ALL" && !search.trim() && !pendingTallyOnly;

  const stripKind = React.useMemo(() => {
    if (loading || !hasCompletedLoad) return null;
    const finalized = rows.filter((r) => r.status === "FINALIZED");
    const pendingTally = finalized.filter((r) => r.isExported !== true);
    if (rows.length === 0 && isDefaultFilterState) return "EMPTY" as const;
    if (pendingTally.length > 0) return "PENDING" as const;
    if (finalized.length > 0 && pendingTally.length === 0) return "ALL_EXPORTED" as const;
    return null;
  }, [loading, hasCompletedLoad, rows, isDefaultFilterState]);

  const tableRows = React.useMemo(() => {
    if (!pendingTallyOnly) return rows;
    return rows.filter((r) => r.status === "FINALIZED" && r.isExported !== true);
  }, [rows, pendingTallyOnly]);

  const newBillHref = React.useMemo(() => {
    const base =
      fromNoQtySo && focusSoIdValid
        ? `/sales-bills/new?source=no_qty_so&salesOrderId=${focusSoId}`
        : "/sales-bills/new";
    return withReportsReturnContextIfPresent(base, location.search);
  }, [fromNoQtySo, focusSoIdValid, focusSoId, location.search]);

  const dispatchHref = React.useMemo(() => {
    const base =
      fromNoQtySo && focusSoIdValid
        ? `/dispatch?source=no_qty_so&salesOrderId=${focusSoId}`
        : "/dispatch";
    return withReportsReturnContextIfPresent(base, location.search);
  }, [fromNoQtySo, focusSoIdValid, focusSoId, location.search]);

  return (
    <PageContainer className="space-y-4">
      <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/dashboard" defaultLabel="Back to Dashboard" />}>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-snug text-slate-900">Sales bills</h1>
            {fromNoQtySo && focusSoIdValid ? (
              <p className="mt-0.5 text-xs text-slate-600">
                <span className="font-medium text-slate-800">No Qty SO</span>
                <span className="text-slate-500"> · Bills for SO #{focusSoId} only</span>
              </p>
            ) : (
              <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                Dispatch-wise customer invoices (Tally export ready).
              </p>
            )}
          </div>
          <Link to={newBillHref} className="shrink-0 sm:pt-0.5">
            <Button
              type="button"
              data-testid="create-sales-bill-btn"
              {...(billDemoHl ? { "data-demo-highlight": billDemoHl } : {})}
            >
              New sales bill
            </Button>
          </Link>
        </div>
      </StickyWorkspaceHead>

      {showNoQtyFinalStepPreview ? (
        <Card className="min-w-0 border-amber-200 bg-amber-50/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-950">Sales bill preview</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-0.5">
              <span className="text-xs font-medium text-amber-900/80">Customer</span>
              <span className="text-sm font-semibold text-amber-950">ABC Industries</span>
            </div>
            <div className="grid gap-0.5">
              <span className="text-xs font-medium text-amber-900/80">SO</span>
              <span className="text-sm font-semibold text-amber-950">Demo NO_QTY SO</span>
            </div>
            <div className="grid gap-0.5">
              <span className="text-xs font-medium text-amber-900/80">Dispatch Qty</span>
              <span className="text-sm font-semibold text-amber-950 tabular-nums">100</span>
            </div>
            <div className="grid gap-0.5">
              <span className="text-xs font-medium text-amber-900/80">Rate</span>
              <span className="text-sm font-semibold text-amber-950 tabular-nums">1</span>
            </div>
            <div className="grid gap-0.5">
              <span className="text-xs font-medium text-amber-900/80">Net Amount</span>
              <span className="text-sm font-semibold text-amber-950 tabular-nums">100</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-amber-900/80">Status</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                  Ready for billing
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">Demo preview</span>
              </div>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-3 py-2">
                <span className="text-sm text-slate-700">This is a demo-only preview. Nothing will be saved.</span>
                <Button type="button" onClick={() => demo.nextDemoStep()}>
                  Complete Demo
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {stripKind === "PENDING" ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-medium">Some finalized bills are not exported yet</p>
          <p className="mt-0.5 text-amber-900/90">Filter to pending export to work through them.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => setPendingTallyOnly(true)}>
              Open pending bills
            </Button>
            {pendingTallyOnly ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setPendingTallyOnly(false)}>
                Show all bills
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {stripKind === "ALL_EXPORTED" ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          <p className="font-medium">All sales bills exported</p>
        </div>
      ) : null}
      {stripKind === "EMPTY" && !showNoQtyFinalStepPreview ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
          <p className="font-medium text-slate-900">
            {fromNoQtySo && focusSoIdValid ? "No sales bills for this sales order yet" : "No sales bills yet"}
          </p>
          <p className="mt-0.5 text-slate-600">Complete dispatch to generate sales bills.</p>
          <div className="mt-2">
            <Button type="button" size="sm" variant="outline" onClick={() => navigate(dispatchHref)}>
              Go to Dispatch
            </Button>
          </div>
        </div>
      ) : null}

      {pendingTallyOnly && stripKind !== "PENDING" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <span>No finalized bills pending export in the current list.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => setPendingTallyOnly(false)}>
            Show all bills
          </Button>
        </div>
      ) : null}

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-medium text-slate-600">From date</span>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-medium text-slate-600">To date</span>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-medium text-slate-600">Customer</span>
            <select
              className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">All customers</option>
              {customers.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
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
              placeholder="Bill no., dispatch, customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-5">
            <Button type="button" data-testid="sales-bills-apply-filters-btn" onClick={() => void load()} disabled={loading}>
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
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bills</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 p-0 sm:p-6 sm:pt-0">
          <div className="min-w-0 overflow-x-auto px-3 pb-4 sm:px-0 sm:pb-0">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                  <th className="px-4 py-2">Bill no.</th>
                  <th className="px-4 py-2">Bill date</th>
                  <th className="min-w-[10rem] px-4 py-2">Customer</th>
                  <th className="px-4 py-2">Dispatch / SO</th>
                  <th className="px-4 py-2 text-right">Net amount</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      {showNoQtyFinalStepPreview && rows.length === 0
                        ? "Demo preview shown above."
                        : rows.length === 0
                        ? "No sales bills match these filters. Create a new entry from dispatch."
                        : pendingTallyOnly
                          ? "No bills pending Tally export in this list."
                          : "No sales bills match these filters."}
                    </td>
                  </tr>
                ) : (
                  tableRows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                      <td className="px-4 py-2 font-medium text-slate-900">
                        <Link
                          className="text-sky-700 underline-offset-4 hover:underline"
                          to={withReportsReturnContextIfPresent(`/sales-bills/${r.id}`, location.search)}
                        >
                          <span className="inline-flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-slate-600">Sales Bill No</span>
                            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-emerald-900">
                              {displaySalesBillNo(r.id, r.billNo, r.docNo)}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-slate-700">{formatDate(r.billDate)}</td>
                      <td className="max-w-[14rem] px-4 py-2 text-slate-700 sm:max-w-[18rem]">
                        <span className="line-clamp-2 break-words">{r.customer.name}</span>
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-slate-600">Dispatch No</span>
                            <span className="rounded border border-violet-200 bg-violet-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-violet-900">
                              {displayDispatchNo(r.dispatch.id, r.dispatch.docNo)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-slate-600">SO No</span>
                            <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-sky-900">
                              {displaySalesOrderNo(r.dispatch.soId, r.dispatch.salesOrder?.docNo)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-800">{formatMoney(r.netAmount)}</td>
                      <td className="px-4 py-2">
                        <span
                          className={
                            r.isExported
                              ? "rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-800"
                              : r.status === "FINALIZED"
                                ? "rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800"
                                : r.status === "CANCELLED"
                                  ? "rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800"
                                  : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800"
                          }
                        >
                          {r.isExported ? "Exported" : r.status === "FINALIZED" ? "Finalized" : r.status === "CANCELLED" ? "Cancelled" : "Draft"}
                        </span>
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

