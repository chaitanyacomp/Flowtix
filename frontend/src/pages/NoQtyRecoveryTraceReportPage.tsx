/**
 * Batch 3E — NO_QTY Recovery Trace Report (read-only).
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { ReportPageHeader } from "../components/PageHeader";
import { ReportPageShell } from "../components/erp/ReportChrome";
import {
  ReportPrintExportBar,
  ReportPrintMeta,
  downloadReportCsv,
  downloadReportExcel,
} from "../components/erp/ReportPrintExport";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { salesOrdersFocusHref } from "../lib/drillDownRoutes";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";

const RECOVERY_TYPE_OPTIONS = ["ALL", "PRODUCTION_SHORTFALL", "QC_FINAL_REJECTION"] as const;
type RecoveryTypeFilter = (typeof RECOVERY_TYPE_OPTIONS)[number];

type TraceRow = {
  recoverySourceId: number;
  salesOrderId: number;
  salesOrderNo: string;
  itemId: number;
  itemName: string | null;
  uom: string | null;
  originDocumentType: string | null;
  originDocumentId: number | null;
  originCycleId: number | null;
  recoveryType: string;
  sourceQty: number;
  allocatedQty: number;
  availableQty: number;
  waivedQty: number;
  requirementSheetNo: string | null;
  allocatedCycleId: number | null;
  recoveryStatus: string;
  ageDays: number;
  reconciliationOk: boolean;
};

type ApiResp = {
  meta: {
    rowCount: number;
    reconciliationExceptions: number;
    identity: string;
    generatedAt: string;
  };
  rows: TraceRow[];
};

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return String(Math.round(Number(n) * 1000) / 1000);
}

export function NoQtyRecoveryTraceReportPage() {
  const { patch, read } = useUrlQueryState({
    salesOrderId: "",
    recoveryType: "ALL",
  });
  const soIdFromUrl = read.string("salesOrderId");
  const [soId, setSoId] = useDebouncedUrlStringParam({
    urlValue: soIdFromUrl,
    patch,
    paramKey: "salesOrderId",
  });
  const recoveryType = read.enum("recoveryType", RECOVERY_TYPE_OPTIONS, "ALL");
  const refreshTick = useErpRefreshTick(["reports"], { pollIntervalMs: ERP_REPORT_POLL_MS });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<ApiResp | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (soId.trim()) qs.set("salesOrderId", soId.trim());
    if (recoveryType && recoveryType !== "ALL") qs.set("recoveryType", recoveryType);
    apiFetch<ApiResp>(`/api/reports/no-qty-recovery-trace?${qs.toString()}`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [soId, recoveryType, refreshTick]);

  const csvHeaders = [
    "SO",
    "Item",
    "UOM",
    "Origin",
    "OriginCycle",
    "Type",
    "SourceQty",
    "Allocated",
    "Available",
    "Waived",
    "RS",
    "AllocCycle",
    "Status",
    "AgeDays",
    "ReconOK",
  ];
  const csvRows = (data?.rows || []).map((r) => [
    r.salesOrderNo,
    r.itemName ?? `Item #${r.itemId}`,
    r.uom ?? "",
    `${r.originDocumentType ?? ""} #${r.originDocumentId ?? ""}`,
    r.originCycleId ?? "",
    r.recoveryType,
    r.sourceQty,
    r.allocatedQty,
    r.availableQty,
    r.waivedQty,
    r.requirementSheetNo ?? "",
    r.allocatedCycleId ?? "",
    r.recoveryStatus,
    r.ageDays,
    r.reconciliationOk ? "Y" : "N",
  ]);

  return (
    <ReportPageShell>
      <ReportPageHeader
        title="NO_QTY Recovery Trace"
        purpose="Item-wise recovery lineage. Source = Allocated + Waived + Available."
      />
      <ReportPrintMeta title="NO_QTY Recovery Trace" />
      <div className="erp-no-print mb-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs">
          <span className="text-slate-600">Sales order id</span>
          <Input className="w-32" value={soId} onChange={(e) => setSoId(e.target.value)} placeholder="Optional" />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-slate-600">Recovery type</span>
          <select
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={recoveryType}
            onChange={(e) =>
              patch({
                recoveryType: e.target.value as RecoveryTypeFilter,
              })
            }
          >
            <option value="ALL">All</option>
            <option value="PRODUCTION_SHORTFALL">Production shortfall</option>
            <option value="QC_FINAL_REJECTION">QC final rejection</option>
          </select>
        </label>
        <ReportPrintExportBar
          onExportCsv={() => downloadReportCsv("no-qty-recovery-trace.csv", csvHeaders, csvRows)}
          onExportExcel={() =>
            downloadReportExcel("no-qty-recovery-trace.xlsx", "NO_QTY Recovery Trace", csvHeaders, csvRows)
          }
        />
      </div>
      {data?.meta ? (
        <p className="mb-2 text-xs text-slate-600">
          {data.meta.rowCount} rows · reconciliation exceptions: {data.meta.reconciliationExceptions} ·{" "}
          {data.meta.identity}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {error ? <p className="text-sm text-amber-800">{error}</p> : null}
      {!loading && !error ? (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-2 py-1.5">SO</th>
                <th className="px-2 py-1.5">Item</th>
                <th className="px-2 py-1.5">Origin</th>
                <th className="px-2 py-1.5">Type</th>
                <th className="px-2 py-1.5">Source</th>
                <th className="px-2 py-1.5">Alloc</th>
                <th className="px-2 py-1.5">Avail</th>
                <th className="px-2 py-1.5">Waived</th>
                <th className="px-2 py-1.5">RS</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Age</th>
                <th className="px-2 py-1.5">Recon</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((r) => (
                <tr key={r.recoverySourceId} className="border-t border-slate-100">
                  <td className="px-2 py-1">
                    <Link className="text-sky-800 hover:underline" to={salesOrdersFocusHref(r.salesOrderId)}>
                      {r.salesOrderNo}
                    </Link>
                  </td>
                  <td className="px-2 py-1">
                    {r.itemName ?? `#${r.itemId}`}
                    {r.uom ? ` (${r.uom})` : ""}
                  </td>
                  <td className="px-2 py-1">
                    {r.originDocumentType} #{r.originDocumentId}
                    {r.originCycleId != null ? ` · C${r.originCycleId}` : ""}
                  </td>
                  <td className="px-2 py-1">{r.recoveryType}</td>
                  <td className="px-2 py-1 tabular-nums">{fmt(r.sourceQty)}</td>
                  <td className="px-2 py-1 tabular-nums">{fmt(r.allocatedQty)}</td>
                  <td className="px-2 py-1 tabular-nums">{fmt(r.availableQty)}</td>
                  <td className="px-2 py-1 tabular-nums">{fmt(r.waivedQty)}</td>
                  <td className="px-2 py-1">{r.requirementSheetNo ?? "—"}</td>
                  <td className="px-2 py-1">{r.recoveryStatus}</td>
                  <td className="px-2 py-1 tabular-nums">{r.ageDays}d</td>
                  <td className="px-2 py-1">{r.reconciliationOk ? "OK" : "EXC"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </ReportPageShell>
  );
}
