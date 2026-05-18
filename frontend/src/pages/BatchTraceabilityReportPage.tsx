import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PageContainer, ReportPageHeader } from "../components/PageHeader";
import { apiFetch } from "../services/api";
import { useUrlQueryState } from "../hooks/useUrlQueryState";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { cn } from "../lib/utils";
import { salesOrdersFocusHref, withReportsReturnContext } from "../lib/drillDownRoutes";

type FgItem = { id: number; itemName: string; unitName?: string | null; unit?: string | null };
type Customer = { id: number; name: string };

type QcRef = { qcId: number; qcRef: string; date: string };

type Row = {
  productionId: number;
  productionRef: string;
  productionDate: string;
  workOrderId: number;
  workOrderNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  customerName: string;
  fgItemId: number;
  fgItemName: string;
  unit: string;
  producedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  reworkQtyApprox: number;
  qcStatus: "PENDING_QC" | "PARTIAL_QC" | "COMPLETED_QC";
  qcRefs: QcRef[];
  dispatchRef: string | null;
  dispatchId: number | null;
  dispatchDate: string | null;
  salesBillId: number | null;
  salesBillRef: string | null;
  salesBillDate: string | null;
  traceabilityNote: string;
};

type ApiResp = {
  meta: {
    fromDate: string;
    toDate: string;
    productionId: number | null;
    fgItemId: number | null;
    customerId: number | null;
    salesOrderId: number | null;
    dispatchId: number | null;
    qcStatus: string;
    supportedTraceabilityLevel: string;
  };
  summary: {
    totalBatches: number;
    pendingQc: number;
    partialQc: number;
    completedQc: number;
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

function qcBadgeTone(status: Row["qcStatus"]): "default" | "secondary" | "destructive" {
  if (status === "COMPLETED_QC") return "secondary";
  if (status === "PARTIAL_QC") return "default";
  return "destructive";
}

function qcLabel(status: Row["qcStatus"]): string {
  if (status === "COMPLETED_QC") return "QC done";
  if (status === "PARTIAL_QC") return "QC partial";
  return "QC pending";
}

function toCsv(rows: Row[]): string {
  const header = [
    "Production Ref",
    "Production Date",
    "FG Item",
    "Unit",
    "Produced Qty",
    "Accepted Qty",
    "Rejected Qty",
    "Rework Qty (approx)",
    "QC Status",
    "QC Refs",
    "Dispatch Ref (SO+Item level)",
    "Dispatch Date",
    "Customer",
    "Sales Order",
    "Sales Bill Ref (SO+Item level)",
    "Sales Bill Date",
    "Traceability Note",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.productionRef,
      r.productionDate ? new Date(r.productionDate).toISOString().slice(0, 10) : "",
      r.fgItemName,
      r.unit,
      fmtQty(r.producedQty),
      fmtQty(r.acceptedQty),
      fmtQty(r.rejectedQty),
      fmtQty(r.reworkQtyApprox),
      r.qcStatus,
      (r.qcRefs || []).map((q) => q.qcRef).join(" | "),
      r.dispatchRef ?? "",
      r.dispatchDate ? new Date(r.dispatchDate).toISOString().slice(0, 10) : "",
      r.customerName,
      r.salesOrderNo,
      r.salesBillRef ?? "",
      r.salesBillDate ? new Date(r.salesBillDate).toISOString().slice(0, 10) : "",
      r.traceabilityNote ?? "",
    ].map(esc).join(","),
  );
  return [header.map(esc).join(","), ...lines].join("\n");
}

export function BatchTraceabilityReportPage() {
  const { patch, read } = useUrlQueryState({
    fromDate: ymdDaysAgo(60),
    toDate: todayYmd(),
    productionId: "",
    fgItemId: "",
    customerId: "",
    salesOrderId: "",
    dispatchId: "",
    qcStatus: "ALL",
  });

  const fromDate = read.string("fromDate");
  const toDate = read.string("toDate");
  const productionId = read.int("productionId");
  const fgItemId = read.int("fgItemId");
  const customerId = read.int("customerId");
  const salesOrderId = read.int("salesOrderId");
  const dispatchId = read.int("dispatchId");
  const qcStatus = read.string("qcStatus", "ALL");

  const [fgItems, setFgItems] = React.useState<FgItem[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [data, setData] = React.useState<ApiResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const missingDates = !fromDate.trim() || !toDate.trim();
  const liveTick = useErpRefreshTick(["reports", "production", "qc", "dispatch"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });

  React.useEffect(() => {
    apiFetch<FgItem[]>("/api/items?type=FG").then(setFgItems).catch(() => setFgItems([]));
    apiFetch<Customer[]>("/api/customers").then(setCustomers).catch(() => setCustomers([]));
  }, [liveTick]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("fromDate", fromDate);
      qs.set("toDate", toDate);
      if (productionId && productionId > 0) qs.set("productionId", String(productionId));
      if (fgItemId && fgItemId > 0) qs.set("fgItemId", String(fgItemId));
      if (customerId && customerId > 0) qs.set("customerId", String(customerId));
      if (salesOrderId && salesOrderId > 0) qs.set("salesOrderId", String(salesOrderId));
      if (dispatchId && dispatchId > 0) qs.set("dispatchId", String(dispatchId));
      if (qcStatus && qcStatus !== "ALL") qs.set("qcStatus", qcStatus);
      const resp = await apiFetch<ApiResp>(`/api/reports/batch-traceability?${qs.toString()}`);
      setData(resp);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : "Could not load batch traceability report.");
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
  }, [fromDate, toDate, productionId, fgItemId, customerId, salesOrderId, dispatchId, qcStatus, liveTick]);

  const rows = data?.rows ?? [];

  function downloadCsv() {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batch-traceability_${fromDate}_to_${toDate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const selectClass = "h-10 rounded-md border border-slate-200 bg-white px-3 text-sm";

  return (
    <PageContainer className="pb-8">
      <ReportPageHeader
        title="Batch Traceability Report"
        purpose="Tracks a batch from production to QC to dispatch for traceability and complaint handling."
        actions={
          <Button type="button" variant="outline" size="sm" disabled={!rows.length || missingDates} onClick={downloadCsv}>
            Download CSV
          </Button>
        }
      />

      {missingDates ? (
        <div className="rounded-md border border-sky-200/90 bg-sky-50/90 px-3 py-2 text-sm text-slate-700">
          Select both <span className="font-medium text-slate-900">From date</span> and{" "}
          <span className="font-medium text-slate-900">To date</span> to view this report.
        </div>
      ) : null}

      {loadError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div> : null}

      <div className="rounded-md border border-sky-100 bg-sky-50/80 px-3 py-2 text-xs text-slate-700">
        <div className="font-semibold text-slate-900">Supported traceability level</div>
        <div className="mt-0.5">{data?.meta.supportedTraceabilityLevel ?? "—"}</div>
      </div>

      <Card className="mt-3 border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            From date (Production)
            <Input type="date" value={fromDate} onChange={(e) => patch({ fromDate: e.target.value || null })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            To date (Production)
            <Input type="date" value={toDate} onChange={(e) => patch({ toDate: e.target.value || null })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            FG item
            <select
              className={selectClass}
              value={fgItemId || ""}
              onChange={(e) => patch({ fgItemId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">All FG items</option>
              {fgItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.itemName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Customer
            <select
              className={selectClass}
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
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Production batch (ID)
            <Input
              inputMode="numeric"
              value={productionId ? String(productionId) : ""}
              onChange={(e) => patch({ productionId: e.target.value ? Number(e.target.value) : null })}
              placeholder="e.g. 1234"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Sales order (ID)
            <Input
              inputMode="numeric"
              value={salesOrderId ? String(salesOrderId) : ""}
              onChange={(e) => patch({ salesOrderId: e.target.value ? Number(e.target.value) : null })}
              placeholder="e.g. 101"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Dispatch ref (ID)
            <Input
              inputMode="numeric"
              value={dispatchId ? String(dispatchId) : ""}
              onChange={(e) => patch({ dispatchId: e.target.value ? Number(e.target.value) : null })}
              placeholder="e.g. 5001"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            QC status
            <select className={selectClass} value={qcStatus} onChange={(e) => patch({ qcStatus: e.target.value || null })}>
              <option value="ALL">All</option>
              <option value="PENDING_QC">QC pending</option>
              <option value="PARTIAL_QC">QC partial</option>
              <option value="COMPLETED_QC">QC done</option>
            </select>
          </label>
        </CardContent>
      </Card>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-600">Total batches</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-slate-900">{data?.summary.totalBatches ?? "—"}</CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-600">QC pending</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-slate-900">{data?.summary.pendingQc ?? "—"}</CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-600">QC partial</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-slate-900">{data?.summary.partialQc ?? "—"}</CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-600">QC done</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-slate-900">{data?.summary.completedQc ?? "—"}</CardContent>
        </Card>
      </div>

      <Card className="mt-3 border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Results</CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto">
          {missingDates ? (
            <div className="py-6 text-sm text-slate-600">
              Choose both production <span className="font-medium text-slate-800">From date</span> and{" "}
              <span className="font-medium text-slate-800">To date</span> in Filters to load traceability rows.
            </div>
          ) : loading ? (
            <div className="py-6 text-sm text-slate-600">Loading…</div>
          ) : !rows.length ? (
            <div className="py-6 text-sm text-slate-600">No batches found for the selected filters.</div>
          ) : (
            <table className="min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-600">
                  <th className="border-b border-slate-200 px-2 py-2">Production</th>
                  <th className="border-b border-slate-200 px-2 py-2">FG item</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right">Produced</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right">Accepted</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right">Rejected</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right">Rework*</th>
                  <th className="border-b border-slate-200 px-2 py-2">QC</th>
                  <th className="border-b border-slate-200 px-2 py-2">Dispatch*</th>
                  <th className="border-b border-slate-200 px-2 py-2">Customer</th>
                  <th className="border-b border-slate-200 px-2 py-2">Sales order</th>
                  <th className="border-b border-slate-200 px-2 py-2">Sales bill*</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productionId} className="hover:bg-slate-50">
                    <td className="border-b border-slate-100 px-2 py-2 align-top">
                      <div className="font-semibold text-slate-900">{r.productionRef}</div>
                      <div className="text-xs text-slate-600">{fmtDate(r.productionDate)}</div>
                      <div className="text-[11px] text-slate-500">{r.workOrderNo}</div>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">
                      <div className="font-medium text-slate-900">{r.fgItemName}</div>
                      <div className="text-xs text-slate-600">{r.unit}</div>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top text-right tabular-nums">{fmtQty(r.producedQty)}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top text-right tabular-nums">{fmtQty(r.acceptedQty)}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top text-right tabular-nums">{fmtQty(r.rejectedQty)}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top text-right tabular-nums">{fmtQty(r.reworkQtyApprox)}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                          qcBadgeTone(r.qcStatus) === "secondary" && "border-emerald-200 bg-emerald-50 text-emerald-800",
                          qcBadgeTone(r.qcStatus) === "default" && "border-amber-200 bg-amber-50 text-amber-800",
                          qcBadgeTone(r.qcStatus) === "destructive" && "border-slate-200 bg-slate-50 text-slate-700",
                        )}
                      >
                        {qcLabel(r.qcStatus)}
                      </span>
                      {r.qcRefs?.length ? (
                        <div className="mt-1 text-[11px] text-slate-600">{r.qcRefs.map((q) => q.qcRef).join(", ")}</div>
                      ) : (
                        <div className="mt-1 text-[11px] text-slate-400">—</div>
                      )}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">
                      <div className="font-medium text-slate-900">{r.dispatchRef ?? "—"}</div>
                      <div className="text-xs text-slate-600">{fmtDate(r.dispatchDate)}</div>
                      <div className="text-[11px] text-slate-500">SO+Item level</div>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">{r.customerName}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">
                      <Link to={withReportsReturnContext(salesOrdersFocusHref(r.salesOrderId))} className="font-medium text-slate-900 underline underline-offset-4">
                        {r.salesOrderNo}
                      </Link>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">
                      <div className="font-medium text-slate-900">{r.salesBillRef ?? "—"}</div>
                      <div className="text-xs text-slate-600">{fmtDate(r.salesBillDate)}</div>
                      <div className="text-[11px] text-slate-500">SO+Item level</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-3 text-xs text-slate-600">
            <div>
              <span className="font-semibold text-slate-800">*</span> Dispatch and Sales Bill are shown as <span className="font-semibold text-slate-800">SalesOrder+FG</span>{" "}
              summaries (not per production batch), because the current ERP data model does not persist batch-to-dispatch allocation.
            </div>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

