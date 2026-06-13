import * as React from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch, ApiRequestError } from "../services/api";
import { PageContainer, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { cn } from "../lib/utils";
import { withReportsReturnContextIfPresent } from "../lib/drillDownRoutes";
import { buildGrnDocumentHref, buildPurchaseBillDetailHref } from "../lib/procurementNavigation";
import { useAuth } from "../hooks/useAuth";
import { useBulkSelection } from "../hooks/useBulkSelection";
import {
  downloadPurchaseBillsTallyExport,
  isPurchaseBillTallyBulkExportEligible,
} from "../lib/purchaseBillTallyExport";
import { useToast } from "../contexts/ToastContext";
import { commercialPaymentStatusLabel, isBillAmountOverdue } from "../lib/commercialBillPaymentLabels";
import { formatCommercialDueDateCell } from "../lib/commercialDueDateDisplay";
import { NativeSelect } from "../components/ui/native-select";
import {
  commercialFilterCardClass,
  CommercialFilterActions,
  CommercialFilterField,
  CommercialFilterGrid,
} from "../components/erp/CommercialFilterLayout";

type Supplier = { id: number; name: string };

type BillRow = {
  id: number;
  billNo: string | null;
  billDate: string;
  netAmount: string | number;
  status: string;
  isExported?: boolean;
  exportedAt?: string | null;
  dueDate?: string | null;
  paidAmount?: string | number | null;
  pendingAmount?: string | number | null;
  paymentStatus?: string | null;
  cancelledAt?: string | null;
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

export function PurchaseBillsListPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const auth = useAuth();
  const role = auth.user?.role ?? "";
  const hideNewBill = role === "PURCHASE";

  const [rows, setRows] = React.useState<BillRow[]>([]);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [supplierId, setSupplierId] = React.useState<string>("");
  const [status, setStatus] = React.useState<string>("ALL");
  const [search, setSearch] = React.useState("");
  const [paymentFilter, setPaymentFilter] = React.useState<"" | "pending" | "overdue" | "partial" | "paid">("");
  const [exportBillFilter, setExportBillFilter] = React.useState<"" | "exported" | "not_exported">("");
  const [loading, setLoading] = React.useState(false);
  const [bulkExporting, setBulkExporting] = React.useState(false);
  const { showSuccess, showError } = useToast();

  const canTallyExport = role === "ADMIN" || role === "PURCHASE";

  const exportEligibleIds = React.useMemo(
    () => rows.filter(isPurchaseBillTallyBulkExportEligible).map((r) => r.id),
    [rows],
  );
  const bulk = useBulkSelection(exportEligibleIds);

  React.useEffect(() => {
    const q = new URLSearchParams(location.search);
    setPaymentFilter(parsePaymentParam(q.get("payment")));
    setExportBillFilter(parseExportParam(q));
    setSupplierId(q.get("supplierId") ?? "");
    setFromDate(q.get("fromDate") ?? "");
    setToDate(q.get("toDate") ?? "");
    setSearch(q.get("search") ?? "");
    const st = q.get("status");
    setStatus(st && ["DRAFT", "FINALIZED", "CANCELLED"].includes(st) ? st : "ALL");
  }, [location.search]);

  React.useEffect(() => {
    apiFetch<Supplier[]>("/api/suppliers").then(setSuppliers).catch(() => {});
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
      const sid = q.get("supplierId");
      if (sid) api.set("supplierId", sid);
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
      const path = qs ? `/api/purchase-bills?${qs}` : "/api/purchase-bills";
      const data = await apiFetch<BillRow[]>(path);
      setRows(Array.isArray(data) ? data : []);
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
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  function applyFiltersToUrl() {
    const next = new URLSearchParams(sp);
    if (fromDate) next.set("fromDate", fromDate);
    else next.delete("fromDate");
    if (toDate) next.set("toDate", toDate);
    else next.delete("toDate");
    if (supplierId) next.set("supplierId", supplierId);
    else next.delete("supplierId");
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

  async function bulkExportToTally() {
    if (!canTallyExport || bulkExporting) return;
    const ids = bulk.getSelectedIdsArray();
    if (!ids.length) return;
    setBulkExporting(true);
    try {
      const out = await downloadPurchaseBillsTallyExport(ids);
      showSuccess(`Exported ${out.count} bill(s) to Tally (${out.filename})`);
      bulk.clear();
      await load();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not export to Tally");
      await load();
    } finally {
      setBulkExporting(false);
    }
  }

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
          {hideNewBill ? null : (
            <Link to={withReportsReturnContextIfPresent("/purchase-bills/new", location.search)} className="shrink-0 sm:pt-0.5">
              <Button type="button">New purchase bill</Button>
            </Link>
          )}
        </div>
      </StickyWorkspaceHead>

      <Card className={cn("min-w-0 overflow-hidden", commercialFilterCardClass)}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <CommercialFilterGrid>
            <CommercialFilterField label="From date">
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </CommercialFilterField>
            <CommercialFilterField label="To date">
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </CommercialFilterField>
            <CommercialFilterField label="Supplier" className="min-w-0 sm:min-w-[12rem]">
              <NativeSelect value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">All suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </CommercialFilterField>
            <CommercialFilterField label="Document status" className="min-w-0 sm:min-w-[9.5rem]">
              <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="ALL">All</option>
                <option value="DRAFT">Draft</option>
                <option value="FINALIZED">Finalized</option>
                <option value="CANCELLED">Cancelled</option>
              </NativeSelect>
            </CommercialFilterField>
            <CommercialFilterField label="Payment status" className="min-w-0 sm:min-w-[10.5rem]">
              <NativeSelect
                value={paymentFilter}
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
                placeholder="Bill no. or supplier"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFiltersToUrl()}
              />
            </CommercialFilterField>
            <CommercialFilterActions>
              <Button type="button" onClick={() => applyFiltersToUrl()} disabled={loading}>
                {loading ? "Loading…" : "Apply filters"}
              </Button>
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
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Bills</CardTitle>
            {canTallyExport && bulk.selectedCount > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-600">
                  Selected: <span className="font-semibold text-slate-900">{bulk.selectedCount}</span> bill
                  {bulk.selectedCount === 1 ? "" : "s"}
                </span>
                <Button type="button" size="sm" disabled={bulkExporting} onClick={() => void bulkExportToTally()}>
                  {bulkExporting ? "Exporting…" : "Export to Tally"}
                </Button>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="min-w-0 p-0 sm:p-6 sm:pt-0">
          <div className="min-w-0 overflow-x-auto px-3 pb-4 sm:px-0 sm:pb-0">
            <table className="w-full min-w-[1024px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                  {canTallyExport ? (
                    <th className="w-10 px-4 py-2">
                      <input
                        ref={bulk.selectAllRef}
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={bulk.allSelected}
                        disabled={!exportEligibleIds.length || bulkExporting}
                        onChange={(e) => bulk.toggleSelectAll(e.target.checked)}
                        title="Select all bills eligible for Tally export"
                        aria-label="Select all bills eligible for Tally export"
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-2">Bill no.</th>
                  <th className="px-4 py-2">Bill date</th>
                  <th className="min-w-[8rem] px-4 py-2">Supplier</th>
                  <th className="px-4 py-2 text-right">Net</th>
                  <th className="px-4 py-2 text-right">Paid</th>
                  <th className="px-4 py-2 text-right">Pending</th>
                  <th className="px-4 py-2">Due</th>
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2">Export</th>
                  <th className="px-4 py-2 text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={canTallyExport ? 11 : 10} className="px-4 py-8 text-center text-slate-500">
                      <div className="mx-auto max-w-[30rem] space-y-1">
                        <div className="text-base font-semibold text-slate-900">No purchase bills match these filters</div>
                        <div className="text-sm text-slate-600">Adjust filters or create a bill from received goods (GRN).</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const pendAmt = num(r.pendingAmount ?? 0);
                    const payLabel = commercialPaymentStatusLabel("purchase", r);
                    const showOverdue =
                      payLabel !== "—" &&
                      isBillAmountOverdue(r.dueDate ?? null, pendAmt, r.status, r.cancelledAt ?? null);
                    const fin = r.status === "FINALIZED";
                    const exportEligible = isPurchaseBillTallyBulkExportEligible(r);
                    return (
                      <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                        {canTallyExport ? (
                          <td className="w-10 px-4 py-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              checked={bulk.selectedIds.has(r.id)}
                              disabled={!exportEligible || bulkExporting}
                              onChange={(e) => bulk.toggleOne(r.id, e.target.checked)}
                              aria-label={
                                exportEligible
                                  ? `Select ${r.billNo?.trim() || `PB-${r.id}`} for Tally export`
                                  : `Not eligible for Tally export`
                              }
                              title={
                                exportEligible
                                  ? "Select for bulk Tally export"
                                  : r.status !== "FINALIZED"
                                    ? "Draft bills cannot be exported"
                                    : r.isExported
                                      ? "Already exported"
                                      : "Not eligible"
                              }
                            />
                          </td>
                        ) : null}
                        <td className="px-4 py-2 font-medium text-slate-900">
                          <Link
                            className="text-sky-700 underline-offset-4 hover:underline"
                            to={withReportsReturnContextIfPresent(buildPurchaseBillDetailHref(r.id), location.search)}
                          >
                            {r.billNo?.trim() ? r.billNo : `PB-${r.id} (draft)`}
                          </Link>
                          {r.grn?.id ? (
                            <div className="mt-0.5 text-[10px] text-slate-500">
                              <Link
                                className="text-sky-700 underline-offset-4 hover:underline"
                                to={withReportsReturnContextIfPresent(
                                  buildGrnDocumentHref(r.grn.id, "/purchase-bills"),
                                  location.search,
                                )}
                              >
                                GRN-{r.grn.id}
                              </Link>
                            </div>
                          ) : (
                            <div className="mt-0.5 text-[10px] text-slate-500">Multiple GRNs</div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-700">{formatDate(r.billDate)}</td>
                        <td className="max-w-[12rem] px-4 py-2 text-slate-700 sm:max-w-[16rem]">
                          <span className="line-clamp-2 break-words">{r.supplier.name}</span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-800">{formatMoney(r.netAmount)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                          {fin ? formatMoney(r.paidAmount ?? 0) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                          {fin ? formatMoney(r.pendingAmount ?? 0) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-700">{formatCommercialDueDateCell(r.dueDate)}</td>
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
                          {r.isExported ? (
                            <span
                              className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
                              title="Exported to Tally"
                            >
                              Exported
                            </span>
                          ) : fin && !r.cancelledAt ? (
                            <Link
                              className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 underline-offset-2 hover:underline"
                              title="Open Tally Export tab"
                              to={withReportsReturnContextIfPresent(
                                buildPurchaseBillDetailHref(r.id, { tab: "tally" }),
                                location.search,
                              )}
                            >
                              Not exported
                            </Link>
                          ) : (
                            <span
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                              title={r.status === "DRAFT" ? "Finalize before export" : "Not eligible for export"}
                            >
                              Not exported
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Link
                            className="text-sm font-medium text-sky-700 underline-offset-4 hover:underline"
                            to={withReportsReturnContextIfPresent(buildPurchaseBillDetailHref(r.id), location.search)}
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
