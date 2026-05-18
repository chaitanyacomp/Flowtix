import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { PageBackLink, PageContainer, StickyWorkspaceHead } from "../components/PageHeader";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { salesOrdersFocusHref, workOrdersFocusHref } from "../lib/drillDownRoutes";
import { cn } from "../lib/utils";
import { useErpReportLiveLoad } from "../hooks/useErpReportLiveLoad";

type CustomerOpt = { id: number; name: string };
type ItemOpt = { id: number; itemName: string };

type QcReportSummaries = {
  productionQcAcceptedToday: number;
  productionQcRejectedToday: number;
  customerReturnQcAcceptedToday: number;
  customerReturnQcRejectedToday: number;
  reworkPendingDispositions: number;
  rowsInRange: number;
  customerReturnDispatchableSum: number;
};

type ReturnBreakdownDetail = {
  returnQty: number;
  qcPassedTotal: number;
  pendingInProcess: number;
  scrapQty: number;
  dispatchableNow: number;
  alreadyDispatched: number;
  replacementSalesOrderId: number | null;
  replacementSalesOrderDocNo: string | null;
  originalSalesOrderId?: number | null;
};

type QcReportRow = {
  sourceType: "PRODUCTION" | "CUSTOMER_RETURN";
  rowKind?: "RETURN_SUMMARY";
  id: string;
  qcEntryId?: number;
  stockAdjustmentQcEntryId?: number;
  qcDocNo: string | null;
  date: string;
  sourceRef: string;
  workOrderId?: number | null;
  workOrderDocNo?: string | null;
  productionEntryId?: number | null;
  salesOrderId?: number | null;
  salesOrderDocNo?: string | null;
  originalSalesOrderId?: number | null;
  customerReturnId?: number | null;
  customerId?: number | null;
  customerName?: string | null;
  itemId: number | null;
  itemName: string;
  inputQty: number;
  acceptedQty: number;
  rejectedQty: number;
  reworkQty: number;
  holdQty: number;
  scrapQty: number;
  statusLabel: string;
  isReversed: boolean;
  dispatchableQty: number | null;
  detail: {
    producedQty?: number | null;
    lossQty?: number;
    reversalReason?: string | null;
    inspectedQty?: number;
    initialAcceptedQty?: number;
    reworkAcceptedQty?: number;
    finalUsableQty?: number;
    directScrapQty?: number;
    reworkFinalScrapQty?: number;
    stockTransactionId?: number;
    stockTransactionType?: string | null;
    disposition?: string;
    dispatchNo?: string | null;
    returnBreakdown?: ReturnBreakdownDetail | null;
  };
};

type QcReportResponse = { summaries: QcReportSummaries; rows: QcReportRow[] };

function fmt(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1000) / 1000;
  return String(r);
}

function statusBadgeClass(label: string, isReversed: boolean): "default" | "success" | "warning" | "info" | "rejected" {
  if (isReversed || label === "Voided") return "default";
  if (label.includes("Rework") || label.includes("Waiting")) return "warning";
  if (label.includes("Hold")) return "warning";
  if (label.includes("Scrap")) return "rejected";
  if (label.includes("Partial")) return "info";
  if (label.includes("Completed") || label.includes("Usable")) return "success";
  return "default";
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

type QcHistoryTableSectionProps = {
  title: string;
  subtitle?: string;
  rows: QcReportRow[];
  loading: boolean;
  onOpenDetail: (r: QcReportRow) => void;
  /** Production: inspected → disposition split → final accepted. Customer return keeps legacy qty column order. */
  qtyColumnLayout?: "production" | "customerReturn";
};

function QcQtyCells({ r, layout }: { r: QcReportRow; layout: "production" | "customerReturn" }) {
  const inspected = <td className="px-2 py-1 text-right tabular-nums">{fmt(r.inputQty)}</td>;
  const rejected = <td className="px-2 py-1 text-right tabular-nums">{fmt(r.rejectedQty)}</td>;
  const rework = <td className="px-2 py-1 text-right tabular-nums">{fmt(r.reworkQty)}</td>;
  const hold = <td className="px-2 py-1 text-right tabular-nums">{fmt(r.holdQty)}</td>;
  const scrap = <td className="px-2 py-1 text-right tabular-nums">{fmt(r.scrapQty)}</td>;
  const accepted = (
    <td className="px-2 py-1 text-right tabular-nums text-emerald-800">{fmt(r.acceptedQty)}</td>
  );

  if (layout === "production") {
    return (
      <>
        {inspected}
        {rejected}
        {rework}
        {hold}
        {scrap}
        {accepted}
      </>
    );
  }

  return (
    <>
      {inspected}
      {accepted}
      {rejected}
      {rework}
      {hold}
      {scrap}
    </>
  );
}

function QcHistoryTableSection({
  title,
  subtitle,
  rows,
  loading,
  onOpenDetail,
  qtyColumnLayout = "customerReturn",
}: QcHistoryTableSectionProps) {
  const productionQtyCols = qtyColumnLayout === "production";
  return (
    <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">{title}</CardTitle>
          <div className="text-[12px] text-slate-600">{rows.length} row{rows.length === 1 ? "" : "s"}</div>
        </div>
        {subtitle ? <p className="mt-0.5 text-[12px] leading-snug text-slate-600">{subtitle}</p> : null}
      </CardHeader>
      <CardContent className="px-0 py-0">
        {loading ? (
          <p className="px-3 py-6 text-center text-[12px] text-slate-600">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-slate-600">No QC records found for selected filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1.5 font-medium">QC Ref</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">Date</th>
                  <th className="px-2 py-1.5 font-medium">Source</th>
                  <th className="px-2 py-1.5 font-medium">Source Ref</th>
                  <th className="px-2 py-1.5 font-medium">SO</th>
                  <th className="px-2 py-1.5 font-medium">Item</th>
                  <th className="px-2 py-1.5 text-right font-medium">Inspected</th>
                  {productionQtyCols ? (
                    <>
                      <th className="px-2 py-1.5 text-right font-medium">Rejected</th>
                      <th className="px-2 py-1.5 text-right font-medium">Rework</th>
                      <th className="px-2 py-1.5 text-right font-medium">Hold</th>
                      <th className="px-2 py-1.5 text-right font-medium">Scrap</th>
                      <th className="px-2 py-1.5 text-right font-medium">Accepted</th>
                    </>
                  ) : (
                    <>
                      <th className="px-2 py-1.5 text-right font-medium">Accepted</th>
                      <th className="px-2 py-1.5 text-right font-medium">Rejected</th>
                      <th className="px-2 py-1.5 text-right font-medium">Rework</th>
                      <th className="px-2 py-1.5 text-right font-medium">Hold</th>
                      <th className="px-2 py-1.5 text-right font-medium">Scrap</th>
                    </>
                  )}
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 text-right font-medium">Dispatchable</th>
                  <th className="px-2 py-1.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-t border-slate-100 transition-colors hover:bg-slate-50/90",
                      r.isReversed && "bg-slate-50/80 text-slate-500 hover:bg-slate-50",
                    )}
                  >
                    <td className="px-2 py-1 font-mono text-[11px]">
                      {r.qcDocNo ?? (r.qcEntryId ? `QC #${r.qcEntryId}` : r.stockAdjustmentQcEntryId ? `#${r.stockAdjustmentQcEntryId}` : r.id)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 tabular-nums">{r.date ? new Date(r.date).toLocaleDateString() : "—"}</td>
                    <td className="px-2 py-1">{r.sourceType === "PRODUCTION" ? "Production" : "Customer return"}</td>
                    <td className="px-2 py-1 font-mono text-[11px] text-slate-700">{r.sourceRef}</td>
                    <td className="px-2 py-1">
                      {r.salesOrderId ? (
                        <Link
                          className="text-sky-700 underline-offset-2 hover:underline"
                          to={salesOrdersFocusHref(r.salesOrderId)}
                        >
                          {displaySalesOrderNo(r.salesOrderId, r.salesOrderDocNo ?? null)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-[12rem] truncate px-2 py-1" title={r.itemName}>
                      {r.itemName}
                    </td>
                    <QcQtyCells r={r} layout={qtyColumnLayout} />
                    <td className="px-2 py-1">
                      <Badge
                        variant={statusBadgeClass(r.statusLabel, r.isReversed)}
                        className="px-2 py-0.5 text-[11px] font-medium"
                      >
                        {r.statusLabel}
                      </Badge>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {r.dispatchableQty != null ? (
                        <span className="font-medium text-emerald-900">{fmt(r.dispatchableQty)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => onOpenDetail(r)}>
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function QcReportPage() {
  const [searchParams] = useSearchParams();
  const urlSource = searchParams.get("sourceType");
  const initialSourceType: "ALL" | "PRODUCTION" | "CUSTOMER_RETURN" =
    urlSource === "CUSTOMER_RETURN" || urlSource === "PRODUCTION" ? urlSource : "ALL";

  const { from: defaultFrom, to: defaultTo } = defaultDateRange();
  const [dateFrom, setDateFrom] = React.useState(defaultFrom);
  const [dateTo, setDateTo] = React.useState(defaultTo);
  const [sourceType, setSourceType] = React.useState<"ALL" | "PRODUCTION" | "CUSTOMER_RETURN">(initialSourceType);
  const [customerId, setCustomerId] = React.useState<number | "">("");
  const [itemId, setItemId] = React.useState<number | "">("");
  const [status, setStatus] = React.useState<"ALL" | "ACTIVE" | "REVERSED">("ALL");
  const [search, setSearch] = React.useState("");

  const [customers, setCustomers] = React.useState<CustomerOpt[]>([]);
  const [items, setItems] = React.useState<ItemOpt[]>([]);
  const [rows, setRows] = React.useState<QcReportRow[]>([]);
  const [summaries, setSummaries] = React.useState<QcReportSummaries | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [detailRow, setDetailRow] = React.useState<QcReportRow | null>(null);

  React.useEffect(() => {
    apiFetch<CustomerOpt[]>("/api/customers")
      .then((c) => setCustomers(Array.isArray(c) ? c : []))
      .catch(() => setCustomers([]));
    apiFetch<ItemOpt[]>("/api/items?type=FG")
      .then((c) => setItems(Array.isArray(c) ? c : []))
      .catch(() => setItems([]));
  }, []);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);
      qs.set("sourceType", sourceType);
      if (customerId !== "") qs.set("customerId", String(customerId));
      if (itemId !== "") qs.set("itemId", String(itemId));
      qs.set("status", status);
      if (search.trim()) qs.set("search", search.trim());
      const data = await apiFetch<QcReportResponse>(`/api/qc/report?${qs.toString()}`);
      setSummaries(data.summaries ?? null);
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setRows([]);
      setSummaries(null);
      setError(e instanceof Error ? e.message : "Failed to load QC report.");
    } finally {
      setLoading(false);
    }
  }

  useErpReportLiveLoad(() => load(), ["reports", "qc"], []);

  const productionRows = React.useMemo(() => rows.filter((r) => r.sourceType === "PRODUCTION"), [rows]);
  const customerReturnRows = React.useMemo(() => rows.filter((r) => r.sourceType === "CUSTOMER_RETURN"), [rows]);
  const showProductionSection = sourceType === "ALL" || sourceType === "PRODUCTION";
  const showCustomerReturnSection = sourceType === "ALL" || sourceType === "CUSTOMER_RETURN";

  return (
    <PageContainer className="erp-flow-page -mt-2 max-w-[min(110rem,calc(100vw-2rem))] space-y-2.5 pb-6">
      <StickyWorkspaceHead lead={<PageBackLink to="/qc-entry" label="Back to QC" />}>
        <div className="min-w-0 space-y-0.5">
          <h1 className="text-base font-semibold leading-tight tracking-tight text-slate-900">QC Report</h1>
          <p className="text-xs leading-snug text-slate-600">
            Review inspection results, rejection, rework, scrap, and return QC.
          </p>
        </div>
      </StickyWorkspaceHead>

      {summaries ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              { label: "Prod accepted (today)", value: fmt(summaries.productionQcAcceptedToday), tone: "text-slate-900" },
              { label: "Prod rejected (today)", value: fmt(summaries.productionQcRejectedToday), tone: "text-slate-900" },
              { label: "Rework / hold queue", value: fmt(summaries.reworkPendingDispositions), tone: "text-slate-900" },
              { label: "Rows in range", value: fmt(summaries.rowsInRange), tone: "text-slate-900" },
              { label: "Return accepted (today)", value: fmt(summaries.customerReturnQcAcceptedToday), tone: "text-emerald-900" },
              { label: "Return rejected (today)", value: fmt(summaries.customerReturnQcRejectedToday), tone: "text-emerald-900" },
            ] as const
          ).map((k) => (
            <Card key={k.label} className="border-slate-200 shadow-sm">
              <CardContent className="flex h-full items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{k.label}</div>
                </div>
                <div className={cn("text-[16px] font-bold tabular-nums", k.tone)}>{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-3 py-2">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 px-3 py-2">
          {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
          <div className="grid gap-2.5">
            <div className="grid gap-2.5 lg:grid-cols-4">
              <label className="grid gap-1 text-[12px]">
                <span className="font-medium text-slate-600">Date From</span>
                <Input className="h-8 text-sm tabular-nums" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label className="grid gap-1 text-[12px]">
                <span className="font-medium text-slate-600">Date To</span>
                <Input className="h-8 text-sm tabular-nums" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <label className="grid gap-1 text-[12px]">
                <span className="font-medium text-slate-600">Source</span>
                <select
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
                >
                  <option value="ALL">All</option>
                  <option value="PRODUCTION">Production</option>
                  <option value="CUSTOMER_RETURN">Customer return</option>
                </select>
              </label>
              <label className="grid gap-1 text-[12px]">
                <span className="font-medium text-slate-600">Status</span>
                <select
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                >
                  <option value="ALL">All</option>
                  <option value="ACTIVE">Active</option>
                  <option value="REVERSED">Reversed</option>
                </select>
              </label>
            </div>
            <div className="grid gap-2.5 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(18rem,2fr)_auto_auto]">
              <label className="grid gap-1 text-[12px]">
                <span className="font-medium text-slate-600">Customer</span>
                <select
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={customerId === "" ? "" : String(customerId)}
                  onChange={(e) => setCustomerId(e.target.value === "" ? "" : Number(e.target.value))}
                >
                  <option value="">All</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[12px]">
                <span className="font-medium text-slate-600">FG Item</span>
                <select
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={itemId === "" ? "" : String(itemId)}
                  onChange={(e) => setItemId(e.target.value === "" ? "" : Number(e.target.value))}
                >
                  <option value="">All</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.itemName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[12px] lg:col-span-1">
                <span className="font-medium text-slate-600">Search</span>
                <Input
                  className="h-8 text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="QC no, SO, return, production, item…"
                />
              </label>
              <div className="flex items-end">
                <Button type="button" className="h-8" onClick={() => void load()} disabled={loading}>
                  {loading ? "Loading…" : "Apply"}
                </Button>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8"
                  onClick={() => {
                    setDateFrom(defaultFrom);
                    setDateTo(defaultTo);
                    setSourceType(initialSourceType);
                    setStatus("ALL");
                    setCustomerId("");
                    setItemId("");
                    setSearch("");
                    void load();
                  }}
                  disabled={loading}
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {showProductionSection ? (
          <QcHistoryTableSection
            title="Production QC"
            subtitle="Manufacturing batches only. Customer-return and replacement fulfillment never use this path."
            rows={productionRows}
            loading={loading}
            onOpenDetail={setDetailRow}
            qtyColumnLayout="production"
          />
        ) : null}
        {showCustomerReturnSection ? (
          <QcHistoryTableSection
            title="Customer Return QC (Rework Checking)"
            subtitle="Post–manual rework verification and replacement-SO dispatch pool. Separate from production QC and stock."
            rows={customerReturnRows}
            loading={loading}
            onOpenDetail={setDetailRow}
          />
        ) : null}
      </div>

      {detailRow ? (
        <div
          className="fixed inset-0 z-[100] flex justify-end bg-black/40 p-2 sm:p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailRow(null);
          }}
        >
          <div
            className="flex h-full w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">QC trace</h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDetailRow(null)}>
                Close
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">QC summary</div>
                  <dl className="mt-1 space-y-1 text-[13px]">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-600">Source</dt>
                      <dd className="font-medium">
                        {detailRow.sourceType === "PRODUCTION" ? "Production QC" : "Customer Return QC (rework checking)"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-600">QC ref</dt>
                      <dd className="font-mono text-xs">{detailRow.qcDocNo ?? `ID ${detailRow.id}`}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-600">Source ref</dt>
                      <dd className="font-mono text-xs">{detailRow.sourceRef}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-600">Item</dt>
                      <dd className="max-w-[14rem] truncate font-medium">{detailRow.itemName}</dd>
                    </div>
                  </dl>
                </div>

                {detailRow.sourceType === "PRODUCTION" ? (
                  <div className="rounded-md border border-slate-100 bg-slate-50/80 p-3 text-[13px]">
                    <div className="font-semibold text-slate-800">Production chain</div>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700">
                      {detailRow.productionEntryId != null && detailRow.salesOrderId ? (
                        <li>
                          Production entry:{" "}
                          <Link className="text-sky-700 underline" to={`/production?salesOrderId=${detailRow.salesOrderId}`}>
                            #{detailRow.productionEntryId}
                          </Link>
                        </li>
                      ) : detailRow.productionEntryId != null ? (
                        <li>Production entry #{detailRow.productionEntryId}</li>
                      ) : null}
                      {detailRow.workOrderId != null ? (
                        <li>
                          Work order:{" "}
                          <Link className="text-sky-700 underline" to={workOrdersFocusHref(detailRow.workOrderId)}>
                            {detailRow.workOrderDocNo ?? `WO #${detailRow.workOrderId}`}
                          </Link>
                        </li>
                      ) : null}
                      {detailRow.salesOrderId != null ? (
                        <li>
                          Sales order:{" "}
                          <Link className="text-sky-700 underline" to={salesOrdersFocusHref(detailRow.salesOrderId)}>
                            {displaySalesOrderNo(detailRow.salesOrderId, detailRow.salesOrderDocNo ?? null)}
                          </Link>
                        </li>
                      ) : null}
                    </ul>
                    <dl className="mt-3 space-y-1 border-t border-slate-200 pt-2">
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Produced qty (batch)</dt>
                        <dd className="tabular-nums font-medium">{fmt(Number(detailRow.detail?.producedQty ?? 0))}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Inspected (this QC)</dt>
                        <dd className="tabular-nums font-medium">
                          {fmt(Number(detailRow.detail?.inspectedQty ?? detailRow.inputQty))}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Initial accepted</dt>
                        <dd className="tabular-nums font-medium text-emerald-800">
                          {fmt(Number(detailRow.detail?.initialAcceptedQty ?? detailRow.acceptedQty))}
                        </dd>
                      </div>
                      {(detailRow.detail?.reworkAcceptedQty ?? 0) > 0 ? (
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">Rework recheck accepted</dt>
                          <dd className="tabular-nums font-medium text-emerald-800">
                            {fmt(Number(detailRow.detail?.reworkAcceptedQty ?? 0))}
                          </dd>
                        </div>
                      ) : null}
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Final usable</dt>
                        <dd className="tabular-nums font-semibold text-emerald-900">
                          {fmt(Number(detailRow.detail?.finalUsableQty ?? detailRow.acceptedQty))}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">This posting — rejected</dt>
                        <dd className="tabular-nums font-medium">{fmt(detailRow.rejectedQty)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Rework / hold / scrap (split)</dt>
                        <dd className="tabular-nums">
                          {fmt(detailRow.reworkQty)} / {fmt(detailRow.holdQty)} / {fmt(detailRow.scrapQty)}
                        </dd>
                      </div>
                      {(detailRow.detail?.reworkFinalScrapQty ?? 0) > 0 ? (
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">Scrap (incl. rework final)</dt>
                          <dd className="tabular-nums">
                            {fmt(Number(detailRow.detail?.directScrapQty ?? 0))} +{" "}
                            {fmt(Number(detailRow.detail?.reworkFinalScrapQty ?? 0))} = {fmt(detailRow.scrapQty)}
                          </dd>
                        </div>
                      ) : null}
                      {detailRow.detail?.lossQty != null && Number(detailRow.detail.lossQty) > 0 ? (
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">Process loss (ledger)</dt>
                          <dd className="tabular-nums">{fmt(Number(detailRow.detail.lossQty))}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <p className="mt-2 text-[11px] leading-snug text-slate-600">
                      Dispatch pool for this FG uses cumulative QC on the sales order (not only this row). Use Dispatch for live caps.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md border border-amber-100 bg-amber-50/60 p-3 text-[13px]">
                    <div className="font-semibold text-amber-950">Customer return — why return qty ≠ dispatchable</div>
                    <p className="mt-1 text-[12px] leading-snug text-amber-900/90">
                      Replacement SO QC builds the dispatch pool. Pending qty is still on the return until QC clears it.
                    </p>
                    {detailRow.detail?.returnBreakdown?.replacementSalesOrderId == null &&
                    (detailRow.detail?.returnBreakdown?.qcPassedTotal ?? 0) <= 0 &&
                    (detailRow.detail?.returnBreakdown?.scrapQty ?? 0) <= 0 ? (
                      <p className="mt-2 text-[12px] text-amber-900">
                        No replacement sales order linked yet — QC accepted and dispatchable stay at zero until a replacement SO exists.
                      </p>
                    ) : null}
                    {detailRow.detail?.returnBreakdown ? (
                      <dl className="mt-3 space-y-1 border-t border-amber-200/60 pt-2">
                        <div className="flex justify-between gap-2">
                          <dt className="text-amber-900/90">Return qty</dt>
                          <dd className="tabular-nums font-semibold">{fmt(detailRow.detail.returnBreakdown.returnQty)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-amber-900/90">QC passed (usable, SO total)</dt>
                          <dd className="tabular-nums font-semibold">{fmt(detailRow.detail.returnBreakdown.qcPassedTotal)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-amber-900/90">Pending / in rework</dt>
                          <dd className="tabular-nums font-semibold">{fmt(detailRow.detail.returnBreakdown.pendingInProcess)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-amber-900/90">Scrap (return)</dt>
                          <dd className="tabular-nums font-semibold">{fmt(detailRow.detail.returnBreakdown.scrapQty)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-amber-900/90">Already dispatched (replacement SO)</dt>
                          <dd className="tabular-nums font-semibold">{fmt(detailRow.detail.returnBreakdown.alreadyDispatched)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-amber-900/90">Dispatchable now</dt>
                          <dd className="tabular-nums font-bold text-emerald-900">{fmt(detailRow.detail.returnBreakdown.dispatchableNow)}</dd>
                        </div>
                      </dl>
                    ) : null}
                    {detailRow.originalSalesOrderId != null && detailRow.originalSalesOrderId > 0 ? (
                      <div className="mt-2 border-t border-amber-200/60 pt-2 text-[12px] text-amber-900/90">
                        Original sales order:{" "}
                        <Link className="font-medium text-sky-800 underline" to={salesOrdersFocusHref(detailRow.originalSalesOrderId)}>
                          {displaySalesOrderNo(detailRow.originalSalesOrderId, null)}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  {detailRow.sourceType === "PRODUCTION" && detailRow.salesOrderId ? (
                    <Link to={`/production?salesOrderId=${detailRow.salesOrderId}`}>
                      <Button type="button" size="sm" variant="outline">
                        Open production
                      </Button>
                    </Link>
                  ) : null}
                  {detailRow.workOrderId != null && detailRow.workOrderId > 0 ? (
                    <Link to={workOrdersFocusHref(detailRow.workOrderId)}>
                      <Button type="button" size="sm" variant="outline">
                        Open work order
                      </Button>
                    </Link>
                  ) : null}
                  {detailRow.sourceType === "CUSTOMER_RETURN" ? (
                    <Link to="/customer-returns">
                      <Button type="button" size="sm" variant="outline">
                        Open customer return
                      </Button>
                    </Link>
                  ) : null}
                  {detailRow.salesOrderId ? (
                    <Link to={`/dispatch?salesOrderId=${detailRow.salesOrderId}`}>
                      <Button type="button" size="sm" variant="outline">
                        Open dispatch
                      </Button>
                    </Link>
                  ) : null}
                  <Link to="/qc-entry">
                    <Button type="button" size="sm" variant="default">
                      Open QC
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
