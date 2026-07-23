import * as React from "react";
import { Link } from "react-router-dom";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { ReportPageHeader, useAnalysisReportBack } from "../components/PageHeader";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { salesOrdersFocusHref, workOrdersFocusHref } from "../lib/drillDownRoutes";
import { cn } from "../lib/utils";
import { useStablePageData } from "../hooks/useStablePageData";
import { ERP_REPORT_POLL_MS } from "../hooks/useErpRefreshTick";
import { ErpModal } from "../components/erp/ErpModal";
import { PRODUCTION_QA_TERMS } from "../lib/productionQaTerminology";
import { formatQcQuantity } from "../lib/quantityDisplay";
import {
  ReportPrintExportBar,
  downloadReportCsv,
  downloadReportExcel,
} from "../components/erp/ReportPrintExport";
import {
  ReportEmptyState,
  ReportFilterField,
  ReportFilterToolbar,
  ReportKpiStrip,
  ReportPageShell,
  ReportTableShell,
} from "../components/erp/ReportChrome";

type CustomerOpt = { id: number; name: string };
type ItemOpt = { id: number; itemName: string };

type QcReportSummaries = {
  productionQcAcceptedToday: number;
  productionQcRejectedToday: number;
  productionFinalUsableAcceptedToday?: number;
  productionFirstPassAcceptedToday?: number;
  productionInitialRejectedToday?: number;
  productionReworkAcceptedToday?: number;
  productionFinalUnusableToday?: number;
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
  uom?: string | null;
  inputQty: number;
  acceptedQty: number;
  rejectedQty: number;
  firstPassAcceptedQty?: number | null;
  initialAcceptedQty?: number | null;
  initialRejectedQty?: number | null;
  reworkQty: number;
  reworkAcceptedQty?: number | null;
  reworkPendingQty?: number | null;
  holdQty: number;
  scrapQty: number;
  finalUsableQty?: number | null;
  finalUnusableQty?: number | null;
  statusLabel: string;
  isReversed: boolean;
  dispatchableQty: number | null;
  /** Terminal unusable only (scrap). Not first-pass rejected. */
  finalRejectedQty?: number | null;
  recoveryCreatedQty?: number | null;
  recoveryAllocatedQty?: number | null;
  recoveryPendingQty?: number | null;
  recoveryWaivedQty?: number | null;
  recoverySourceStatus?: string | null;
  recoveryOriginCycleId?: number | null;
  recoveryAgeDays?: number | null;
  detail: {
    producedQty?: number | null;
    lossQty?: number;
    reversalReason?: string | null;
    inspectedQty?: number;
    initialAcceptedQty?: number;
    firstPassAcceptedQty?: number;
    initialRejectedQty?: number;
    reworkRoutedQty?: number;
    reworkAcceptedQty?: number;
    reworkPendingQty?: number;
    holdQty?: number;
    scrapQty?: number;
    finalUsableQty?: number;
    finalUnusableQty?: number;
    directScrapQty?: number;
    reworkFinalScrapQty?: number;
    lifecycleNote?: string | null;
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

function fmtQtyUom(n: number | null | undefined, uom: string | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return formatQcQuantity(Number(n), uom ?? undefined);
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
  const firstPass = Number(r.firstPassAcceptedQty ?? r.detail?.firstPassAcceptedQty ?? r.detail?.initialAcceptedQty ?? 0);
  const initialRejected = Number(r.initialRejectedQty ?? r.detail?.initialRejectedQty ?? r.rejectedQty ?? 0);
  const reworkAccepted = Number(r.reworkAcceptedQty ?? r.detail?.reworkAcceptedQty ?? 0);
  const finalUsable = Number(r.finalUsableQty ?? r.detail?.finalUsableQty ?? r.acceptedQty ?? 0);
  const finalUnusable = Number(r.finalUnusableQty ?? r.detail?.finalUnusableQty ?? r.finalRejectedQty ?? 0);

  if (layout === "production") {
    return (
      <>
        <td className="px-3 py-2 text-right tabular-nums">{fmtQtyUom(r.inputQty, r.uom)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{fmtQtyUom(firstPass, r.uom)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{fmtQtyUom(initialRejected, r.uom)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-emerald-800">{fmtQtyUom(reworkAccepted, r.uom)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-900">{fmtQtyUom(finalUsable, r.uom)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{fmtQtyUom(finalUnusable, r.uom)}</td>
      </>
    );
  }

  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{fmtQtyUom(r.inputQty, r.uom)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-emerald-800">{fmtQtyUom(r.acceptedQty, r.uom)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtQtyUom(r.rejectedQty, r.uom)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtQtyUom(r.reworkQty, r.uom)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtQtyUom(r.holdQty, r.uom)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtQtyUom(r.scrapQty, r.uom)}</td>
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
    <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm" data-testid="qc-report-section">
      <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">{title}</CardTitle>
          <div className="text-sm text-slate-600">{rows.length} row{rows.length === 1 ? "" : "s"}</div>
        </div>
        {subtitle ? <p className="mt-1 text-sm leading-snug text-slate-600">{subtitle}</p> : null}
      </CardHeader>
      <CardContent className="px-0 py-0">
        {loading && rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-600">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="px-4 py-4">
            <ReportEmptyState
              title="No QC records found"
              body="No QC records match the selected filters. Adjust filters and apply again."
              className="py-8"
            />
          </div>
        ) : (
          <div className="relative">
            {loading ? (
              <div className="flex justify-end px-4 pt-2">
                <span className="text-xs font-medium text-slate-500">Refreshing…</span>
              </div>
            ) : null}
            <ReportTableShell>
              <table
                className={cn(
                  "erp-table w-full border-collapse text-sm",
                  productionQtyCols ? "min-w-0" : "min-w-[980px]",
                )}
                data-testid={productionQtyCols ? "production-qc-report-table" : "customer-return-qc-report-table"}
              >
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium">QC No.</th>
                    {productionQtyCols ? null : (
                      <>
                        <th className="whitespace-nowrap px-3 py-2.5 font-medium">Date</th>
                        <th className="px-3 py-2.5 font-medium">Source</th>
                        <th className="px-3 py-2.5 font-medium">Source Ref</th>
                        <th className="px-3 py-2.5 font-medium">SO</th>
                      </>
                    )}
                    <th className="min-w-[8rem] px-3 py-2.5 font-medium">Item</th>
                    {productionQtyCols ? (
                      <>
                        <th className="px-3 py-2.5 text-right font-medium">Inspected</th>
                        <th className="px-3 py-2.5 text-right font-medium">First-Pass Acc.</th>
                        <th className="px-3 py-2.5 text-right font-medium">Initial Rej.</th>
                        <th className="px-3 py-2.5 text-right font-medium">Rework Acc.</th>
                        <th className="px-3 py-2.5 text-right font-medium">Final Usable</th>
                        <th className="px-3 py-2.5 text-right font-medium">Final Unusable</th>
                      </>
                    ) : (
                      <>
                        <th className="px-3 py-2.5 text-right font-medium">Inspected</th>
                        <th className="px-3 py-2.5 text-right font-medium">Accepted</th>
                        <th className="px-3 py-2.5 text-right font-medium">Rejected</th>
                        <th className="px-3 py-2.5 text-right font-medium">Rework</th>
                        <th className="px-3 py-2.5 text-right font-medium">Hold</th>
                        <th className="px-3 py-2.5 text-right font-medium">Scrap</th>
                      </>
                    )}
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    {productionQtyCols ? null : (
                      <th className="px-3 py-2.5 text-right font-medium">Dispatchable</th>
                    )}
                    <th className="px-3 py-2.5 text-right font-medium">Trace</th>
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
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px]">
                        {r.qcDocNo ?? (r.qcEntryId ? `QC #${r.qcEntryId}` : r.stockAdjustmentQcEntryId ? `#${r.stockAdjustmentQcEntryId}` : r.id)}
                      </td>
                      {productionQtyCols ? null : (
                        <>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.date ? new Date(r.date).toLocaleDateString() : "—"}</td>
                          <td className="px-3 py-2">{r.sourceType === "PRODUCTION" ? "Production" : "Customer return"}</td>
                          <td className="px-3 py-2 font-mono text-[13px] text-slate-700">{r.sourceRef}</td>
                          <td className="px-3 py-2">
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
                        </>
                      )}
                      <td className="max-w-[12rem] truncate px-3 py-2" title={r.itemName}>
                        {r.itemName}
                      </td>
                      <QcQtyCells r={r} layout={qtyColumnLayout} />
                      <td className="px-3 py-2">
                        <Badge
                          variant={statusBadgeClass(r.statusLabel, r.isReversed)}
                          className="px-2 py-0.5 text-xs font-medium"
                        >
                          {r.statusLabel}
                        </Badge>
                      </td>
                      {productionQtyCols ? null : (
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.dispatchableQty != null ? (
                            <span className="font-medium text-emerald-900">{fmt(r.dispatchableQty)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right">
                        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenDetail(r)}>
                          Trace
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportTableShell>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function QcReportPage() {
  const { from: defaultFrom, to: defaultTo } = defaultDateRange();
  const { patch, read } = useUrlQueryState({
    dateFrom: defaultFrom,
    dateTo: defaultTo,
    sourceType: "ALL",
    status: "ALL",
    customerId: "",
    itemId: "",
    search: "",
  });
  const dateFrom = read.string("dateFrom", defaultFrom);
  const dateTo = read.string("dateTo", defaultTo);
  const sourceType = read.enum("sourceType", ["ALL", "PRODUCTION", "CUSTOMER_RETURN"] as const, "ALL");
  const customerIdNum = read.int("customerId");
  const customerId = customerIdNum > 0 ? customerIdNum : ("" as const);
  const itemIdNum = read.int("itemId");
  const itemId = itemIdNum > 0 ? itemIdNum : ("" as const);
  const status = read.enum("status", ["ALL", "ACTIVE", "REVERSED"] as const, "ALL");
  const searchFromUrl = read.string("search");
  const [search, setSearch] = useDebouncedUrlStringParam({
    urlValue: searchFromUrl,
    patch,
    paramKey: "search",
  });

  const [customers, setCustomers] = React.useState<CustomerOpt[]>([]);
  const [items, setItems] = React.useState<ItemOpt[]>([]);
  const [detailRow, setDetailRow] = React.useState<QcReportRow | null>(null);

  React.useEffect(() => {
    apiFetch<CustomerOpt[]>("/api/customers")
      .then((c) => setCustomers(Array.isArray(c) ? c : []))
      .catch(() => setCustomers([]));
    apiFetch<ItemOpt[]>("/api/items?type=FG")
      .then((c) => setItems(Array.isArray(c) ? c : []))
      .catch(() => setItems([]));
  }, []);

  const {
    data,
    error,
    loading,
    reload,
  } = useStablePageData<QcReportResponse>({
    scopes: ["reports", "qc"],
    pollIntervalMs: ERP_REPORT_POLL_MS,
    deps: [dateFrom, dateTo, sourceType, customerId, itemId, status, search],
    fetcher: (signal) => {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);
      qs.set("sourceType", sourceType);
      if (customerId !== "") qs.set("customerId", String(customerId));
      if (itemId !== "") qs.set("itemId", String(itemId));
      qs.set("status", status);
      if (search.trim()) qs.set("search", search.trim());
      return apiFetch<QcReportResponse>(`/api/qc/report?${qs.toString()}`, { signal });
    },
  });

  const summaries = data?.summaries ?? null;
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const hasLoadedRows = data != null;
  const reportLoadFailed = Boolean(error) && !hasLoadedRows;

  const productionRows = React.useMemo(() => rows.filter((r) => r.sourceType === "PRODUCTION"), [rows]);
  const customerReturnRows = React.useMemo(() => rows.filter((r) => r.sourceType === "CUSTOMER_RETURN"), [rows]);
  const showProductionSection = sourceType === "ALL" || sourceType === "PRODUCTION";
  const showCustomerReturnSection = sourceType === "ALL" || sourceType === "CUSTOMER_RETURN";

  const csvHeaders = [
    "QC Ref",
    "Date",
    "Source",
    "SO",
    "Item",
    "UOM",
    "Inspected",
    "First-Pass Accepted",
    "Initial Rejected",
    "Rework Accepted",
    "Rework Pending",
    "Hold",
    "Scrap",
    "Final Usable",
    "Final Unusable",
    "Status",
  ];
  const csvRows = productionRows.map((r) => [
    r.qcDocNo ?? (r.qcEntryId ? `QC #${r.qcEntryId}` : r.id),
    r.date ? new Date(r.date).toISOString().slice(0, 10) : "",
    r.sourceType,
    r.salesOrderDocNo ?? (r.salesOrderId ? `SO-${r.salesOrderId}` : ""),
    r.itemName,
    r.uom ?? "",
    r.inputQty,
    r.firstPassAcceptedQty ?? r.detail?.firstPassAcceptedQty ?? r.detail?.initialAcceptedQty ?? "",
    r.initialRejectedQty ?? r.detail?.initialRejectedQty ?? r.rejectedQty,
    r.reworkAcceptedQty ?? r.detail?.reworkAcceptedQty ?? 0,
    r.reworkPendingQty ?? r.detail?.reworkPendingQty ?? "",
    r.holdQty,
    r.scrapQty,
    r.finalUsableQty ?? r.detail?.finalUsableQty ?? r.acceptedQty,
    r.finalUnusableQty ?? r.detail?.finalUnusableQty ?? r.finalRejectedQty ?? 0,
    r.statusLabel,
  ]);

  const qcModuleBack = React.useMemo(
    () => ({ to: "/qc-entry", label: "Back to Quality Inspection Workspace" }),
    [],
  );
  const back = useAnalysisReportBack(qcModuleBack);

  return (
    <ReportPageShell className="qc-report-page" data-testid="qc-report-page">
      <ReportPageHeader
        title="QC Report"
        purpose="First-pass, rework, and final usable outcomes. Summary “today” cards use event dates; row totals show full lifecycle."
        back={back}
        actions={
          <ReportPrintExportBar
            onExportCsv={() => downloadReportCsv(`qc-report_${new Date().toISOString().slice(0, 10)}.csv`, csvHeaders, csvRows)}
            onExportExcel={() =>
              downloadReportExcel(
                `qc-report_${new Date().toISOString().slice(0, 10)}.xlsx`,
                "QC Report",
                csvHeaders,
                csvRows,
              )
            }
          />
        }
      />

      {summaries ? (
        <div data-testid="qc-report-summary-cards">
          <ReportKpiStrip
            className="sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4"
            items={[
              {
                key: "final-usable",
                label: "Final usable accepted (today)",
                value: fmt(summaries.productionFinalUsableAcceptedToday ?? summaries.productionQcAcceptedToday),
                tone: "success",
              },
              {
                key: "initial-rejected",
                label: "Initial rejected (today)",
                value: fmt(summaries.productionInitialRejectedToday ?? summaries.productionQcRejectedToday),
              },
              {
                key: "rework-accepted",
                label: "Rework accepted (today)",
                value: fmt(summaries.productionReworkAcceptedToday ?? 0),
                tone: "success",
              },
              {
                key: "final-unusable",
                label: "Final unusable (today)",
                value: fmt(summaries.productionFinalUnusableToday ?? 0),
              },
              {
                key: "rows",
                label: "QC rows in range",
                value: fmt(summaries.rowsInRange),
              },
              {
                key: "queue",
                label: "Rework / hold queue",
                value: fmt(summaries.reworkPendingDispositions),
                tone: summaries.reworkPendingDispositions > 0 ? "warning" : "default",
              },
              {
                key: "return-acc",
                label: "Return accepted (today)",
                value: fmt(summaries.customerReturnQcAcceptedToday),
                tone: "success",
              },
              {
                key: "return-rej",
                label: "Return rejected (today)",
                value: fmt(summaries.customerReturnQcRejectedToday),
              },
            ]}
          />
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          data-testid="qc-report-load-error"
          role="alert"
        >
          <div className="font-semibold">QC Report could not be loaded</div>
          <div className="mt-1 whitespace-pre-wrap break-words">{error}</div>
          {import.meta.env.DEV ? (
            <div className="mt-1 text-xs text-red-700/90">
              Development: this is a server/API failure, not an empty filter result.
            </div>
          ) : null}
        </div>
      ) : null}

      <ReportFilterToolbar
        onApply={() => void reload()}
        onReset={() => {
          patch({
            dateFrom: defaultFrom,
            dateTo: defaultTo,
            sourceType: null,
            status: null,
            customerId: null,
            itemId: null,
            search: null,
          });
          setSearch("");
          void reload();
        }}
        applyBusy={loading}
        applyLabel="Apply"
        resetLabel="Reset"
      >
        <ReportFilterField label="Date From">
          <Input type="date" value={dateFrom} onChange={(e) => patch({ dateFrom: e.target.value || null })} />
        </ReportFilterField>
        <ReportFilterField label="Date To">
          <Input type="date" value={dateTo} onChange={(e) => patch({ dateTo: e.target.value || null })} />
        </ReportFilterField>
        <ReportFilterField label="Source">
          <select
            value={sourceType}
            onChange={(e) => patch({ sourceType: e.target.value === "ALL" ? null : e.target.value })}
          >
            <option value="ALL">All</option>
            <option value="PRODUCTION">Production</option>
            <option value="CUSTOMER_RETURN">Customer return</option>
          </select>
        </ReportFilterField>
        <ReportFilterField label="Status">
          <select
            value={status}
            onChange={(e) => patch({ status: e.target.value === "ALL" ? null : e.target.value })}
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="REVERSED">Reversed</option>
          </select>
        </ReportFilterField>
        <ReportFilterField label="Customer">
          <select
            value={customerId === "" ? "" : String(customerId)}
            onChange={(e) => patch({ customerId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">All</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="FG Item">
          <select
            value={itemId === "" ? "" : String(itemId)}
            onChange={(e) => patch({ itemId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">All</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.itemName}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="Search" span={2}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="QC no, SO, return, production, item…"
          />
        </ReportFilterField>
      </ReportFilterToolbar>

      <div className="space-y-4">
        {reportLoadFailed ? (
          <Card className="border-red-200 shadow-sm" data-testid="qc-report-failed-state">
            <CardContent className="px-4 py-8 text-center text-sm text-red-800">
              Report data is unavailable because the API request failed. Fix the server error and click Apply — this is
              not a zero-result filter.
            </CardContent>
          </Card>
        ) : (
          <>
            {showProductionSection ? (
              <QcHistoryTableSection
                title="Production QC"
                subtitle="Lifecycle totals per QC posting date. Hold/scrap/rework pending and NO_QTY recovery details are in Trace."
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
          </>
        )}
      </div>

      {detailRow ? (
        <ErpModal
          onClose={() => setDetailRow(null)}
          closeOnBackdropClick
          backdropClassName="z-[100] !items-stretch !justify-end bg-black/40 p-2 sm:p-4"
          aria-label="QC trace"
        >
          <div className="flex h-full w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
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
                        <dt className="text-slate-600">First-pass accepted</dt>
                        <dd className="tabular-nums font-medium text-emerald-800">
                          {fmt(
                            Number(
                              detailRow.detail?.firstPassAcceptedQty ??
                                detailRow.detail?.initialAcceptedQty ??
                                detailRow.firstPassAcceptedQty ??
                                0,
                            ),
                          )}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Initial rejection posted</dt>
                        <dd className="tabular-nums font-medium">
                          {fmt(
                            Number(
                              detailRow.detail?.initialRejectedQty ??
                                detailRow.initialRejectedQty ??
                                detailRow.rejectedQty,
                            ),
                          )}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Rework / Hold / Scrap (split)</dt>
                        <dd className="tabular-nums">
                          {fmt(detailRow.reworkQty)} / {fmt(detailRow.holdQty)} / {fmt(detailRow.scrapQty)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Rework accepted</dt>
                        <dd className="tabular-nums font-medium text-emerald-800">
                          {fmt(Number(detailRow.detail?.reworkAcceptedQty ?? detailRow.reworkAcceptedQty ?? 0))}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Rework pending</dt>
                        <dd className="tabular-nums font-medium">
                          {fmt(Number(detailRow.detail?.reworkPendingQty ?? detailRow.reworkPendingQty ?? 0))}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Final usable</dt>
                        <dd className="tabular-nums font-semibold text-emerald-900">
                          {fmt(Number(detailRow.detail?.finalUsableQty ?? detailRow.finalUsableQty ?? detailRow.acceptedQty))}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Final unresolved / unusable</dt>
                        <dd className="tabular-nums font-medium">
                          {fmt(
                            Number(
                              detailRow.detail?.finalUnusableQty ??
                                detailRow.finalUnusableQty ??
                                detailRow.finalRejectedQty ??
                                0,
                            ),
                          )}
                        </dd>
                      </div>
                      {(detailRow.detail?.reworkFinalScrapQty ?? 0) > 0 ? (
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">Scrap (direct + rework final)</dt>
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
                      {detailRow.detail?.lifecycleNote ? (
                        <p className="mt-2 rounded border border-emerald-100 bg-emerald-50/80 px-2 py-1.5 text-[12px] leading-snug text-emerald-950">
                          {detailRow.detail.lifecycleNote}
                        </p>
                      ) : null}
                      {(detailRow.recoveryCreatedQty != null && Number(detailRow.recoveryCreatedQty) > 0) ||
                      (detailRow.recoveryPendingQty != null && Number(detailRow.recoveryPendingQty) > 0) ? (
                        <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-[12px]">
                          <div className="font-semibold text-slate-800">NO_QTY recovery (informational)</div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-600">Created / allocated / pending / waived</dt>
                            <dd className="tabular-nums">
                              {fmt(Number(detailRow.recoveryCreatedQty ?? 0))} /{" "}
                              {fmt(Number(detailRow.recoveryAllocatedQty ?? 0))} /{" "}
                              {fmt(Number(detailRow.recoveryPendingQty ?? 0))} /{" "}
                              {fmt(Number(detailRow.recoveryWaivedQty ?? 0))}
                            </dd>
                          </div>
                          <div className="text-slate-600">
                            {detailRow.recoverySourceStatus ?? "—"}
                            {detailRow.recoveryOriginCycleId != null ? ` · C${detailRow.recoveryOriginCycleId}` : ""}
                            {detailRow.recoveryAgeDays != null ? ` · ${detailRow.recoveryAgeDays}d` : ""}
                          </div>
                        </div>
                      ) : null}
                    </dl>
                    <p className="mt-2 text-[11px] leading-snug text-slate-600">
                      Final usable = first-pass accepted + rework accepted. Dispatch pool uses cumulative final usable on the sales order, capped by SO remaining and FG on-hand.
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
                      {PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA}
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </ErpModal>
      ) : null}
    </ReportPageShell>
  );
}
