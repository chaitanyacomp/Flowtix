import * as React from "react";
import { Card, CardContent } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { ReportPageHeader } from "../components/PageHeader";
import { Input } from "../components/ui/input";
import { useUrlQueryState } from "../hooks/useUrlQueryState";
import { useStablePageData } from "../hooks/useStablePageData";
import { ERP_REPORT_POLL_MS } from "../hooks/useErpRefreshTick";
import { ReportPrintExportBar, ReportPrintMeta } from "../components/erp/ReportPrintExport";
import { ReportResultsLoadGate } from "../components/erp/foundation/ReportResultsLoadGate";
import {
  ReportEmptyState,
  ReportFilterField,
  ReportFilterToolbar,
  ReportKpiStrip,
  ReportPageShell,
  ReportTableShell,
} from "../components/erp/ReportChrome";
import { buildScrapReportDateQuery } from "../lib/scrapReportDateQuery";
import { sanitizeReportUiError } from "../lib/reportUiError";

type FgItem = { id: number; itemName: string };

type ScrapRow = {
  id: number;
  date: string;
  fgItemId: number;
  fgItemName: string;
  rejectedQty: number;
  reason: string | null;
  workOrderId: number;
};

export function ScrapReportPage() {
  // dateFrom/dateTo — never reuse `from` (reserved for Analysis return context `from=reports`)
  const { patch, read } = useUrlQueryState({
    fgItemId: "",
    workOrderId: "",
    dateFrom: "",
    dateTo: "",
    from: "",
    to: "",
  });
  const fgItemIdNum = read.int("fgItemId");
  const fgItemId = fgItemIdNum > 0 ? fgItemIdNum : ("" as const);
  const workOrderId = read.string("workOrderId");
  // Prefer dateFrom/dateTo; migrate legacy from/to when they look like dates (not "reports")
  const legacyFrom = read.string("from");
  const legacyTo = read.string("to");
  const dateFrom =
    read.string("dateFrom") ||
    (legacyFrom && legacyFrom !== "reports" && /^\d/.test(legacyFrom) ? legacyFrom : "");
  const dateTo = read.string("dateTo") || (legacyTo && /^\d/.test(legacyTo) ? legacyTo : "");

  const [fgItems, setFgItems] = React.useState<FgItem[]>([]);

  React.useEffect(() => {
    apiFetch<FgItem[]>("/api/items?type=FG")
      .then(setFgItems)
      .catch(() => {});
  }, []);

  const dateQuery = React.useMemo(() => buildScrapReportDateQuery(dateFrom, dateTo), [dateFrom, dateTo]);
  const clientDateError = dateQuery.ok ? null : dateQuery.clientError;

  const {
    data,
    error,
    firstLoadDone,
    loading,
    reload,
  } = useStablePageData<ScrapRow[]>({
    enabled: clientDateError == null,
    scopes: ["reports", "qc"],
    pollIntervalMs: ERP_REPORT_POLL_MS,
    deps: [fgItemId, workOrderId, dateFrom, dateTo],
    fetcher: (signal) => {
      const built = buildScrapReportDateQuery(dateFrom, dateTo);
      if (!built.ok) {
        return Promise.reject(new Error(built.clientError));
      }
      const qs = new URLSearchParams();
      if (fgItemId !== "") qs.set("fgItemId", String(fgItemId));
      if (workOrderId.trim()) qs.set("workOrderId", workOrderId.trim());
      if (built.from) qs.set("from", built.from);
      if (built.to) qs.set("to", built.to);
      return apiFetch<ScrapRow[]>(`/api/scrap?${qs.toString()}`, { signal });
    },
  });

  const displayError = clientDateError ?? (error ? sanitizeReportUiError(error) : null);
  const resultsReady = firstLoadDone || clientDateError != null;
  const rows = data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.rejectedQty || 0), 0);

  function clearFilters() {
    patch({ fgItemId: null, workOrderId: null, dateFrom: null, dateTo: null, from: null, to: null });
  }

  function exportCsv() {
    const header = "Date,WO Id,FG Item,Rejected Qty,Reason";
    const lines =
      rows.length === 0
        ? ["No records found"]
        : rows.map((r) => {
            const date = r.date ? new Date(r.date).toISOString().slice(0, 10) : "";
            const esc = (s: string | null) => `"${String(s ?? "").replace(/"/g, '""')}"`;
            return [date, r.workOrderId, esc(r.fgItemName), r.rejectedQty, esc(r.reason)].join(",");
          });
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scrap-report_${dateFrom || "all"}_to_${dateTo || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const filterSummary = [
    dateFrom ? `From ${dateFrom}` : null,
    dateTo ? `To ${dateTo}` : null,
    fgItemId !== "" ? `FG #${fgItemId}` : null,
    workOrderId.trim() ? `WO ${workOrderId.trim()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ReportPageShell>
      <ReportPrintMeta title="Scrap Report" filterSummary={filterSummary} />
      <ReportPageHeader
        title="Scrap Report"
        purpose="QC scrap and loss quantities by FG item and work order for the filters you choose."
        actions={<ReportPrintExportBar filterSummary={filterSummary} onExportCsv={exportCsv} />}
      />

      <ReportKpiStrip
        items={[
          {
            key: "total",
            label: "Total Rejected Qty",
            value: total.toFixed(2),
            tone: total > 0 ? "warning" : "default",
          },
          { key: "rows", label: "Rows", value: rows.length },
        ]}
      />

      <ReportFilterToolbar
        onApply={() => void reload()}
        onReset={clearFilters}
        applyBusy={loading}
        applyLabel="Apply"
        resetLabel="Clear"
      >
        <ReportFilterField label="FG item">
          <select
            value={fgItemId === "" ? "" : fgItemId}
            onChange={(e) => patch({ fgItemId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">All</option>
            {fgItems.map((f) => (
              <option key={f.id} value={f.id}>
                {f.itemName}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="Work order id">
          <Input value={workOrderId} onChange={(e) => patch({ workOrderId: e.target.value || null })} placeholder="e.g. 12" />
        </ReportFilterField>
        <ReportFilterField label="From">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => patch({ dateFrom: e.target.value || null, from: null })}
          />
        </ReportFilterField>
        <ReportFilterField label="To">
          <Input type="date" value={dateTo} onChange={(e) => patch({ dateTo: e.target.value || null, to: null })} />
        </ReportFilterField>
      </ReportFilterToolbar>

      {displayError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {displayError}
        </div>
      ) : null}

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <ReportResultsLoadGate
            firstLoadDone={resultsReady}
            loading={loading && clientDateError == null}
            hasDisplayData={data != null}
            isEmpty={rows.length === 0 && clientDateError == null}
            error={
              displayError && data == null ? (
                <div className="px-4 py-6 text-sm text-red-700">{displayError}</div>
              ) : null
            }
            initialLoader={<div className="px-4 py-6 text-sm text-slate-600">Loading scrap report…</div>}
            emptyState={<ReportEmptyState title="No scrap records" body="Adjust filters and apply again." />}
          >
            <ReportTableShell>
              <table className="erp-table erp-table-dense w-full text-sm">
                <thead className="sticky top-0 z-[1]">
                  <tr className="border-b bg-slate-50 text-left text-slate-600">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">WO</th>
                    <th className="px-3 py-2">FG</th>
                    <th className="px-3 py-2 text-right">Rejected qty</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(r.date).toLocaleDateString()}</td>
                      <td className="px-3 py-2">#{r.workOrderId}</td>
                      <td className="px-3 py-2 font-medium">{r.fgItemName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(r.rejectedQty).toFixed(2)}</td>
                      <td className="px-3 py-2 text-slate-700">{r.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportTableShell>
          </ReportResultsLoadGate>
        </CardContent>
      </Card>
    </ReportPageShell>
  );
}
