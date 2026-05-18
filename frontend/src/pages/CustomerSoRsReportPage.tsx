import * as React from "react";
import { Link } from "react-router-dom";
import { useCanOpenRequirementSheet } from "../hooks/useIsAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { PageContainer, ReportPageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { apiFetch } from "../services/api";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { salesOrdersFocusHref, withReportsReturnContext } from "../lib/drillDownRoutes";
import { cn } from "../lib/utils";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";

type Customer = { id: number; name: string };

type ReportRow = {
  customerName: string;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderType: string;
  salesOrderDate: string;
  currentCycleId: number | null;
  currentCycleLabel: string | null;
  requirementSheetId: number | null;
  requirementSheetNo: string | null;
  requirementSheetStatus: string | null;
  requirementQty: number | null;
  suggestedWoQty: number | null;
  lockedAt: string | null;
  lastShortageQty: number | null;
  /** When set, the qty is aligned with pending QC hold/rework disposition (not confirmed RS carry-forward). */
  lastShortageQtyLabel: string | null;
  /** Frozen unfulfilled qty from last SO close (demand snapshot). */
  closedShortageQty?: number | null;
  /** Effective carry-forward demand for this row's cycle context. */
  activeCarryForwardQty?: number | null;
  reopenMode?: string | null;
  nextActionKey: string;
  nextActionLabel: string;
};

type ApiResp = {
  meta: Record<string, unknown>;
  rows: ReportRow[];
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function fmtQty(n: number | null | undefined): string {
  if (n == null) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return String(Math.round(x * 1000) / 1000);
}

function soTypeBadgeVariant(t: string): "info" | "warning" | "default" {
  if (t === "NO_QTY") return "warning";
  if (t === "NORMAL") return "info";
  return "default";
}

function soTypeLabel(t: string): string {
  if (t === "NORMAL") return "REGULAR";
  if (t === "NO_QTY") return "NO_QTY";
  return t;
}

function rsStatusBadgeVariant(s: string | null): "success" | "warning" | "default" {
  if (s === "LOCKED") return "success";
  if (s === "DRAFT") return "warning";
  return "default";
}

function nextActionBadgeVariant(key: string): "rejected" | "warning" | "info" | "success" | "default" {
  if (key === "QC_PENDING") return "rejected";
  if (key === "CREATE_NEXT_RS" || key === "NEXT_RS_REQUIRED" || key === "PRODUCTION_PENDING") return "warning";
  if (key === "DISPATCH_PENDING" || key === "SALES_BILL_PENDING") return "info";
  if (key === "DONE") return "success";
  return "default";
}

export function CustomerSoRsReportPage() {
  const canOpenRs = useCanOpenRequirementSheet();
  /**
   * Sales-facing roles get a simplified column set: the technical planning
   * fields (Suggested WO Qty, Closed shortage, Active carry, Reopen mode)
   * are useful to Planning / Admin but expose internal mechanics to Sales.
   * Mirrors the audience of `useCanOpenRequirementSheet()` (ADMIN + SALES).
   */
  const showInternals = canOpenRs;
  const { patch, read } = useUrlQueryState({
    customerId: "",
    soType: "ALL",
    status: "ALL",
    dateFrom: "",
    dateTo: "",
    q: "",
  });

  const customerId = read.int("customerId");
  const soType = read.string("soType", "ALL");
  const status = read.string("status", "ALL");
  const dateFrom = read.string("dateFrom");
  const dateTo = read.string("dateTo");
  const qFromUrl = read.string("q");
  const [searchDraft, setSearchDraft] = useDebouncedUrlStringParam({
    urlValue: qFromUrl,
    patch,
    paramKey: "q",
  });

  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [data, setData] = React.useState<ApiResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const liveTick = useErpRefreshTick(["reports", "requirement", "sales"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });

  React.useEffect(() => {
    apiFetch<Customer[]>("/api/customers").then(setCustomers).catch(() => setCustomers([]));
  }, [liveTick]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (customerId && customerId > 0) qs.set("customerId", String(customerId));
      if (soType === "NORMAL" || soType === "NO_QTY") qs.set("soType", soType);
      if (status && status !== "ALL") qs.set("status", status);
      if (dateFrom.trim()) qs.set("dateFrom", dateFrom.trim());
      if (dateTo.trim()) qs.set("dateTo", dateTo.trim());
      if (qFromUrl.trim()) qs.set("q", qFromUrl.trim());
      const resp = await apiFetch<ApiResp>(`/api/reports/customer-so-rs?${qs.toString()}`);
      setData(resp);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : "Could not load report.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, soType, status, dateFrom, dateTo, qFromUrl, liveTick]);

  const rows = data?.rows ?? [];

  return (
    <PageContainer className="pb-8">
      <ReportPageHeader
        title="Customer-wise SO & RS Report"
        purpose="Search SO number or Customer PO to filter. With search text, NO_QTY orders list every cycle; otherwise one row per order (NO_QTY uses current cycle for RS)."
      />

      {loadError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div>
      ) : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
            Search SO No / Customer PO
            <Input
              className="h-9"
              placeholder="Search SO No / Customer PO"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Customer
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={customerId && customerId > 0 ? String(customerId) : ""}
              onChange={(e) => patch({ customerId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">All</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            SO type
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={soType}
              onChange={(e) => patch({ soType: e.target.value || "ALL" })}
            >
              <option value="ALL">All</option>
              <option value="NORMAL">Regular (NORMAL)</option>
              <option value="NO_QTY">NO_QTY</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            SO status
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={status}
              onChange={(e) => patch({ status: e.target.value || "ALL" })}
            >
              <option value="ALL">All</option>
              <option value="DRAFT">DRAFT</option>
              <option value="OPEN">OPEN</option>
              <option value="APPROVED">APPROVED</option>
              <option value="IN_PROCESS">IN_PROCESS</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="CLOSED">CLOSED</option>
              <option value="MANUALLY_CLOSED">MANUALLY_CLOSED</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            SO date from
            <Input type="date" className="h-9" value={dateFrom} onChange={(e) => patch({ dateFrom: e.target.value || null })} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            SO date to
            <Input type="date" className="h-9" value={dateTo} onChange={(e) => patch({ dateTo: e.target.value || null })} />
          </label>
        </CardContent>
      </Card>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>
          {loading ? "Loading…" : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
          {data?.meta && typeof data.meta === "object" && "truncated" in data.meta && (data.meta as { truncated?: boolean }).truncated ? (
            <span className="text-amber-700"> (output capped)</span>
          ) : null}
          {data?.meta && typeof data.meta === "object" && "rowLimit" in data.meta ? (
            <span className="text-slate-400"> · SO limit {String((data.meta as { rowLimit?: number }).rowLimit ?? "—")}</span>
          ) : null}
        </span>
        <button
          type="button"
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className={cn("w-full border-collapse text-left text-[12px]", showInternals ? "min-w-[1100px]" : "min-w-[860px]")}>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <th className="px-2 py-2">Customer</th>
              <th className="px-2 py-2">SO No</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">SO Date</th>
              <th className="px-2 py-2">Cycle</th>
              <th className="px-2 py-2">RS No</th>
              <th className="px-2 py-2">RS Status</th>
              <th className="px-2 py-2 text-right">Req Qty</th>
              {showInternals ? <th className="px-2 py-2 text-right">Sug WO Qty</th> : null}
              <th className="px-2 py-2 text-right">Carry / disposition qty</th>
              {showInternals ? <th className="px-2 py-2 text-right">Closed shortage</th> : null}
              {showInternals ? <th className="px-2 py-2 text-right">Active carry</th> : null}
              {showInternals ? <th className="px-2 py-2">Reopen mode</th> : null}
              <th className="px-2 py-2">Locked</th>
              <th className="px-2 py-2">Next action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.salesOrderId}-${r.currentCycleId ?? "na"}`}
                className="border-b border-slate-100 hover:bg-slate-50/80"
              >
                <td className="max-w-[140px] truncate px-2 py-1.5 text-slate-800" title={r.customerName}>
                  {r.customerName}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  <Link
                    className="font-medium text-sky-700 underline-offset-2 hover:underline"
                    to={withReportsReturnContext(salesOrdersFocusHref(r.salesOrderId))}
                  >
                    {r.salesOrderNo}
                  </Link>
                </td>
                <td className="px-2 py-1.5">
                  <Badge variant={soTypeBadgeVariant(r.salesOrderType)} className="text-[10px]">
                    {soTypeLabel(r.salesOrderType)}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">{fmtDate(r.salesOrderDate)}</td>
                <td className="max-w-[100px] truncate px-2 py-1.5 text-slate-700" title={r.currentCycleLabel ?? ""}>
                  {r.currentCycleLabel ?? "—"}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {r.requirementSheetNo ? (
                    canOpenRs ? (
                      <Link
                        className="text-sky-700 underline-offset-2 hover:underline"
                        to={`/sales-orders/${r.salesOrderId}/requirement-sheets`}
                      >
                        {r.requirementSheetNo}
                      </Link>
                    ) : (
                      <span
                        className="font-mono text-[12px] text-slate-700"
                        title="Planning workspace — view-only to this role."
                      >
                        {r.requirementSheetNo}
                      </span>
                    )
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {r.requirementSheetStatus ? (
                    <Badge variant={rsStatusBadgeVariant(r.requirementSheetStatus)} className="text-[10px]">
                      {r.requirementSheetStatus}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtQty(r.requirementQty)}</td>
                {showInternals ? (
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtQty(r.suggestedWoQty)}</td>
                ) : null}
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">
                  {r.lastShortageQty != null ? (
                    <div className="inline-flex flex-col items-end gap-0.5">
                      <span className="text-[10px] font-normal leading-tight text-slate-500">
                        {r.lastShortageQtyLabel ?? "Last shortage Qty"}
                      </span>
                      <span className="font-semibold tabular-nums">{fmtQty(r.lastShortageQty)}</span>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                {showInternals ? (
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{fmtQty(r.closedShortageQty ?? null)}</td>
                ) : null}
                {showInternals ? (
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{fmtQty(r.activeCarryForwardQty ?? null)}</td>
                ) : null}
                {showInternals ? (
                  <td className="max-w-[120px] truncate px-2 py-1.5 text-[11px] text-slate-600" title={r.reopenMode ?? ""}>
                    {r.reopenMode ?? "—"}
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-600">{fmtDate(r.lockedAt)}</td>
                <td className="px-2 py-1.5">
                  <Badge variant={nextActionBadgeVariant(r.nextActionKey)} className={cn("max-w-[160px] truncate text-[10px]")} title={r.nextActionLabel}>
                    {r.nextActionLabel}
                  </Badge>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={showInternals ? 15 : 11} className="px-3 py-4">
                  <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center">
                    <div className="text-[13px] font-semibold text-slate-800">No sales orders match these filters</div>
                    <div className="text-[12px] leading-snug text-slate-600">
                      Widen the date range or clear customer / status / type to see more rows.
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </PageContainer>
  );
}
