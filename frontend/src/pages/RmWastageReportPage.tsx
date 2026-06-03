/**
 * RM Wastage Report — MWN register with GRN-based valuation.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch, getApiUrl } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { Download } from "lucide-react";
import { ReportPageHeader } from "../components/PageHeader";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { RM_WASTAGE_REASON_OPTIONS } from "../lib/rmWastageUx";

type DetailRow = {
  id: number;
  date: string;
  mwnNo: string | null;
  workOrderNo: string | null;
  rmItemName: string;
  rmUnit: string;
  qty: number;
  reasonLabel: string;
  remarks: string | null;
  createdByName: string | null;
  rate: number;
  wastageValue: number;
};

type ApiResp = {
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  kpis: { totalNotes: number; totalWastageQty: number; totalWastageValue: number };
  rows: DetailRow[];
};

const URL_OMIT: Record<string, string> = {
  reason: "ALL",
  woNumber: "",
  rmItemId: "",
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstDayOfMonthYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function fmtQty(n: number, unit?: string): string {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

function fmtMoney(n: number): string {
  return `₹${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function RmWastageReportPage() {
  const { showError } = useToast();
  const { read, patch } = useUrlQueryState(URL_OMIT);
  const dateFrom = useDebouncedUrlStringParam("dateFrom", firstDayOfMonthYmd());
  const dateTo = useDebouncedUrlStringParam("dateTo", todayYmd());
  const woNumber = read.string("woNumber");
  const reason = read.string("reason") || "ALL";
  const rmItemId = read.string("rmItemId");

  const [data, setData] = React.useState<ApiResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(1);
  const liveTick = useErpRefreshTick(["reports", "production"], { pollIntervalMs: ERP_REPORT_POLL_MS });

  React.useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, woNumber, reason, rmItemId, liveTick]);

  React.useEffect(() => {
    let mounted = true;
    setLoading(true);
    const qs = new URLSearchParams();
    if (dateFrom) qs.set("dateFrom", dateFrom);
    if (dateTo) qs.set("dateTo", dateTo);
    if (woNumber.trim()) qs.set("woNumber", woNumber.trim());
    if (reason && reason !== "ALL") qs.set("reason", reason);
    if (rmItemId) qs.set("rmItemId", rmItemId);
    qs.set("page", String(page));
    qs.set("pageSize", "50");

    apiFetch<ApiResp>(`/api/reports/rm-wastage?${qs}`)
      .then((resp) => {
        if (mounted) setData(resp);
      })
      .catch((e) => {
        if (mounted) {
          setData(null);
          showError(e instanceof Error ? e.message : "Failed to load RM wastage report");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [dateFrom, dateTo, woNumber, reason, rmItemId, page, liveTick, showError]);

  async function exportCsv() {
    const qs = new URLSearchParams();
    if (dateFrom) qs.set("dateFrom", dateFrom);
    if (dateTo) qs.set("dateTo", dateTo);
    if (woNumber.trim()) qs.set("woNumber", woNumber.trim());
    if (reason && reason !== "ALL") qs.set("reason", reason);
    if (rmItemId) qs.set("rmItemId", rmItemId);
    qs.set("export", "csv");
    try {
      const res = await fetch(getApiUrl(`/api/reports/rm-wastage?${qs}`), { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `rm-wastage_${dateFrom}_to_${dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Export failed");
    }
  }

  const rows = data?.rows ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <ReportPageHeader
        title="RM Wastage Report"
        description="Material Wastage Notes (MWN) — production RM written off as final loss, valued at latest GRN rate."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-[12px]">
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">Date from</span>
            <Input
              type="date"
              className="h-8 w-36"
              value={dateFrom}
              onChange={(e) => patch({ dateFrom: e.target.value })}
            />
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">Date to</span>
            <Input
              type="date"
              className="h-8 w-36"
              value={dateTo}
              onChange={(e) => patch({ dateTo: e.target.value })}
            />
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">WO no.</span>
            <Input
              className="h-8 w-32"
              value={woNumber}
              onChange={(e) => patch({ woNumber: e.target.value })}
              placeholder="WO-26-"
            />
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">RM item id</span>
            <Input
              className="h-8 w-24"
              value={rmItemId}
              onChange={(e) => patch({ rmItemId: e.target.value })}
              placeholder="Item #"
            />
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">Reason</span>
            <select
              className="erp-flow-filter-input h-8 min-w-[10rem] rounded-md border border-slate-200 px-2"
              value={reason}
              onChange={(e) => patch({ reason: e.target.value })}
            >
              <option value="ALL">All</option>
              {RM_WASTAGE_REASON_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="outline" size="sm" className="mt-5 h-8 gap-1" onClick={() => void exportCsv()}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
        </CardContent>
      </Card>

      {data?.kpis ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Card>
            <CardContent className="p-3 text-[12px]">
              <div className="text-slate-500">MWN count</div>
              <div className="text-lg font-semibold tabular-nums">{data.kpis.totalNotes}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-[12px]">
              <div className="text-slate-500">Total wastage qty</div>
              <div className="text-lg font-semibold tabular-nums">{fmtQty(data.kpis.totalWastageQty)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-[12px]">
              <div className="text-slate-500">Total wastage value</div>
              <div className="text-lg font-semibold tabular-nums">{fmtMoney(data.kpis.totalWastageValue)}</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Detail</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <p className="p-3 text-sm text-slate-600">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">No wastage entries for these filters.</p>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-1">Date</th>
                  <th className="px-2 py-1">MWN</th>
                  <th className="px-2 py-1">WO</th>
                  <th className="px-2 py-1">RM item</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                  <th className="px-2 py-1">Reason</th>
                  <th className="px-2 py-1">Remarks</th>
                  <th className="px-2 py-1">By</th>
                  <th className="px-2 py-1 text-right">Rate</th>
                  <th className="px-2 py-1 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-2 py-1">{r.date ? new Date(r.date).toLocaleDateString() : "—"}</td>
                    <td className="px-2 py-1 font-medium">{r.mwnNo ?? `MWN-${r.id}`}</td>
                    <td className="px-2 py-1">{r.workOrderNo ?? "—"}</td>
                    <td className="px-2 py-1">{r.rmItemName}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtQty(r.qty, r.rmUnit)}</td>
                    <td className="px-2 py-1">{r.reasonLabel}</td>
                    <td className="max-w-[12rem] truncate px-2 py-1" title={r.remarks ?? ""}>
                      {r.remarks ?? "—"}
                    </td>
                    <td className="px-2 py-1">{r.createdByName ?? "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.rate > 0 ? fmtMoney(r.rate) : "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(r.wastageValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data && data.meta.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-slate-100 p-2 text-[11px]">
              <span>
                Page {data.meta.page} of {data.meta.totalPages} ({data.meta.total} rows)
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={page >= data.meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
