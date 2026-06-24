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
import { commercialPaymentStatusLabel, isBillAmountOverdue } from "../lib/commercialBillPaymentLabels";
import { formatCommercialDueDateCell } from "../lib/commercialDueDateDisplay";
import { cn } from "../lib/utils";
import { NativeSelect } from "../components/ui/native-select";
import {
  commercialFilterCardClass,
  CommercialFilterActions,
  CommercialFilterField,
  CommercialFilterGrid,
} from "../components/erp/CommercialFilterLayout";
import { useErpRoleUi } from "../hooks/useErpRoleUi";

type Customer = { id: number; name: string };

type BillRow = {
  id: number;
  docNo?: string | null;
  billNo: string | null;
  billDate: string;
  netAmount: string | number;
  status: string;
  isExported?: boolean;
  dueDate?: string | null;
  receivedAmount?: string | number | null;
  pendingAmount?: string | number | null;
  paymentStatus?: string | null;
  cancelledAt?: string | null;
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

function parsePaymentParam(v: string | null): "" | "pending" | "overdue" | "partial" | "paid" {
  if (v === "pending" || v === "overdue" || v === "partial" || v === "paid") return v;
  return "";
}

function parseExportParam(sp: URLSearchParams): "" | "exported" | "not_exported" {
  const raw = sp.get("exportFilter") ?? sp.get("export") ?? "";
  if (raw === "exported") return "exported";
  if (raw === "not_exported" || raw === "pending") return "not_exported";
  return "";
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
  const { canCreateSalesBill } = useErpRoleUi();
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
  const [paymentFilter, setPaymentFilter] = React.useState<"" | "pending" | "overdue" | "partial" | "paid">("");
  const [exportBillFilter, setExportBillFilter] = React.useState<"" | "exported" | "not_exported">("");
  const [loading, setLoading] = React.useState(false);
  const [pendingTallyOnly, setPendingTallyOnly] = React.useState(false);
  const [hasCompletedLoad, setHasCompletedLoad] = React.useState(false);

  React.useEffect(() => {
    const spSync = new URLSearchParams(location.search);
    setPaymentFilter(parsePaymentParam(spSync.get("payment")));
    setExportBillFilter(parseExportParam(spSync));
    setCustomerId(spSync.get("customerId") ?? "");
    setFromDate(spSync.get("fromDate") ?? "");
    setToDate(spSync.get("toDate") ?? "");
    setSearch(spSync.get("search") ?? "");
    const st = spSync.get("status");
    setStatus(st && ["DRAFT", "FINALIZED", "CANCELLED"].includes(st) ? st : "ALL");
  }, [location.search]);

  React.useEffect(() => {
    apiFetch<Customer[]>("/api/customers").then(setCustomers).catch(() => {});
  }, []);

  async function load() {
    setLoadError(null);
    setLoading(true);
    try {
      const q = new URLSearchParams(location.search);
      const api = new URLSearchParams();
      const fd = q.get("fromDate");
      if (fd) api.set("fromDate", fd);
      const td = q.get("toDate");
      if (td) api.set("toDate", td);
      const cid = q.get("customerId");
      if (cid) api.set("customerId", cid);
      const st = q.get("status");
      if (st && ["DRAFT", "FINALIZED", "CANCELLED"].includes(st)) api.set("status", st);
      const sr = q.get("search");
      if (sr?.trim()) api.set("search", sr.trim());
      const pay = q.get("payment");
      if (pay && ["pending", "overdue", "partial", "paid"].includes(pay)) api.set("payment", pay);
      const efRaw = q.get("exportFilter") ?? q.get("export") ?? "";
      if (efRaw === "exported") api.set("exportFilter", "exported");
      else if (efRaw === "not_exported" || efRaw === "pending") api.set("exportFilter", "not_exported");

      const qs = api.toString();
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

  function applyFiltersToUrl() {
    const next = new URLSearchParams(sp);
    if (fromDate) next.set("fromDate", fromDate);
    else next.delete("fromDate");
    if (toDate) next.set("toDate", toDate);
    else next.delete("toDate");
    if (customerId) next.set("customerId", customerId);
    else next.delete("customerId");
    if (paymentFilter) next.set("payment", paymentFilter);
    else next.delete("payment");
    if (exportBillFilter === "exported") next.set("exportFilter", "exported");
    else if (exportBillFilter === "not_exported") next.set("exportFilter", "not_exported");
    else {
      next.delete("exportFilter");
      next.delete("export");
    }
    if (search.trim()) next.set("search", search.trim());
    else next.delete("search");
    if (status !== "ALL") next.set("status", status);
    else next.delete("status");
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, focusSoId, focusSoIdValid]);

  const isDefaultFilterState =
    !fromDate &&
    !toDate &&
    !customerId &&
    status === "ALL" &&
    !search.trim() &&
    !paymentFilter &&
    !exportBillFilter &&
    !pendingTallyOnly;

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
    <PageContainer className="erp-txn-workspace space-y-1.5">
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
          {canCreateSalesBill ? (
            <Link to={newBillHref} className="shrink-0 sm:pt-0.5">
              <Button
                type="button"
                data-testid="create-sales-bill-btn"
                {...(billDemoHl ? { "data-demo-highlight": billDemoHl } : {})}
              >
                New sales bill
              </Button>
            </Link>
          ) : null}
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

      <Card className={cn("min-w-0 overflow-hidden", commercialFilterCardClass)}>
        <CardContent className="p-2.5">
          <CommercialFilterGrid>
            <CommercialFilterField label="From">
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 text-[12px]" />
            </CommercialFilterField>
            <CommercialFilterField label="To">
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 text-[12px]" />
            </CommercialFilterField>
            <CommercialFilterField label="Customer" className="min-w-0 sm:min-w-[12rem]">
              <NativeSelect value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-8 text-[12px]">
                <option value="">All customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </CommercialFilterField>
            <CommercialFilterField label="Document status" className="min-w-0 sm:min-w-[9.5rem]">
              <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 text-[12px]">
                <option value="ALL">All</option>
                <option value="DRAFT">Draft</option>
                <option value="FINALIZED">Finalized</option>
                <option value="CANCELLED">Cancelled</option>
              </NativeSelect>
            </CommercialFilterField>
            <CommercialFilterField label="Payment status" className="min-w-0 sm:min-w-[10.5rem]">
              <NativeSelect
                value={paymentFilter}
                className="h-8 text-[12px]"
                onChange={(e) =>
                  setPaymentFilter(
                    e.target.value === "pending" ||
                      e.target.value === "overdue" ||
                      e.target.value === "partial" ||
                      e.target.value === "paid"
                      ? e.target.value
                      : "",
                  )
                }
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </NativeSelect>
            </CommercialFilterField>
            <CommercialFilterField label="Export status" className="min-w-0 sm:min-w-[10.5rem]">
              <NativeSelect
                value={exportBillFilter}
                className="h-8 text-[12px]"
                onChange={(e) =>
                  setExportBillFilter(e.target.value === "exported" || e.target.value === "not_exported" ? e.target.value : "")
                }
              >
                <option value="">All</option>
                <option value="exported">Exported</option>
                <option value="not_exported">Not exported</option>
              </NativeSelect>
            </CommercialFilterField>
            <CommercialFilterField label="Search" className="lg:col-span-2 xl:col-span-2">
              <Input
                placeholder="Bill no., dispatch, customer…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFiltersToUrl()}
                className="h-8 text-[12px]"
              />
            </CommercialFilterField>
            <CommercialFilterActions>
              <button
                type="button"
                data-testid="sales-bills-apply-filters-btn"
                onClick={() => applyFiltersToUrl()}
                disabled={loading}
                className="inline-flex h-8 items-center rounded-md bg-blue-600 px-3 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                aria-busy={loading || undefined}
              >
                {loading ? "Loading…" : "Apply"}
              </button>
            </CommercialFilterActions>
          </CommercialFilterGrid>
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
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                  <th className="px-4 py-2">Bill no.</th>
                  <th className="px-4 py-2">Bill date</th>
                  <th className="min-w-[10rem] px-4 py-2">Customer</th>
                  <th className="px-4 py-2 text-right">Net</th>
                  <th className="px-4 py-2 text-right">Received</th>
                  <th className="px-4 py-2 text-right">Pending</th>
                  <th className="px-4 py-2">Due</th>
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2">Export</th>
                  <th className="px-4 py-2 text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-4">
                      <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center">
                        <div className="text-[13px] font-semibold text-slate-800">
                          {showNoQtyFinalStepPreview && rows.length === 0
                            ? "Demo preview shown above"
                            : rows.length === 0
                              ? "No sales bills yet"
                              : pendingTallyOnly
                                ? "No bills pending Tally export"
                                : "No bills match these filters"}
                        </div>
                        <div className="text-[12px] leading-snug text-slate-600">
                          {rows.length === 0
                            ? "Complete a dispatch to generate a sales bill, or adjust the filters above."
                            : "Try a wider date range or clear status filters."}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  tableRows.map((r) => {
                    const pendAmt = num(r.pendingAmount ?? 0);
                    const payLabel = commercialPaymentStatusLabel("sales", r);
                    const showOverdue =
                      payLabel !== "—" &&
                      isBillAmountOverdue(r.dueDate ?? null, pendAmt, r.status, r.cancelledAt ?? null);
                    return (
                      <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                        <td className="px-4 py-2 font-medium text-slate-900">
                          <Link
                            className="text-sky-700 underline-offset-4 hover:underline"
                            to={withReportsReturnContextIfPresent(`/sales-bills/${r.id}`, location.search)}
                          >
                            <span className="inline-flex items-center gap-2">
                              <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-emerald-900">
                                {displaySalesBillNo(r.id, r.billNo, r.docNo)}
                              </span>
                            </span>
                          </Link>
                          <div className="mt-0.5 text-[10px] text-slate-500">
                            Disp {displayDispatchNo(r.dispatch.id, r.dispatch.docNo)} · SO{" "}
                            {displaySalesOrderNo(r.dispatch.soId, r.dispatch.salesOrder?.docNo)}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-slate-700">{formatDate(r.billDate)}</td>
                        <td className="max-w-[14rem] px-4 py-2 text-slate-700 sm:max-w-[18rem]">
                          <span className="line-clamp-2 break-words">{r.customer.name}</span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-800">{formatMoney(r.netAmount)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                          {r.status === "FINALIZED" ? formatMoney(r.receivedAmount ?? 0) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                          {r.status === "FINALIZED" ? formatMoney(r.pendingAmount ?? 0) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                          {formatCommercialDueDateCell(r.dueDate)}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                              {payLabel}
                            </span>
                            {showOverdue ? (
                              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-900">
                                Overdue
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              r.isExported
                                ? "rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-800"
                                : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                            }
                          >
                            {r.isExported ? "Exported" : "Not exported"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Link
                            className="text-sm font-medium text-sky-700 underline-offset-4 hover:underline"
                            to={withReportsReturnContextIfPresent(`/sales-bills/${r.id}`, location.search)}
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

