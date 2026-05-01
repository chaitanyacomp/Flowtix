import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { apiFetch, getApiUrl } from "../services/api";
import { ReportPageHeader } from "../components/PageHeader";

type RecordRow = {
  id: number;
  dispatchId: number;
  customerName: string;
  voucherNo: string;
  fileName: string;
  exportedAt: string | null;
  exportedBy: string | null;
};

type ApiResp = { records: RecordRow[] };

function fmtDdMmYyyy(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = String(dt.getFullYear()).padStart(4, "0");
  return `${dd}-${mm}-${yyyy}`;
}

export function ExportHistoryPage() {
  const [rows, setRows] = React.useState<RecordRow[]>([]);
  const [customers, setCustomers] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [customer, setCustomer] = React.useState("ALL");
  const [search, setSearch] = React.useState("");
  const [downloadingId, setDownloadingId] = React.useState<number | null>(null);

  React.useEffect(() => {
    apiFetch<{ name: string }[]>("/api/customers")
      .then((cs) => setCustomers((Array.isArray(cs) ? cs : []).map((c) => c.name).filter(Boolean).sort((a, b) => a.localeCompare(b))))
      .catch(() => setCustomers([]));
  }, []);

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (customer && customer !== "ALL") params.set("customer", customer);
    if (search.trim()) params.set("q", search.trim());

    setLoading(true);
    setError(null);
    apiFetch<ApiResp>(`/api/export-history${params.toString() ? `?${params.toString()}` : ""}`)
      .then((d) => setRows(Array.isArray(d.records) ? d.records : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load export history."))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, customer, search]);

  async function downloadAgain(id: number) {
    setDownloadingId(id);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(getApiUrl(`/api/sales-bills/${id}/download/tally.xml`), {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = `Download failed (${res.status})`;
        try {
          const j = (await res.json()) as any;
          if (j?.error?.message) msg = String(j.error.message);
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename="?([^"]+)"?/i.exec(cd);
      const filename = m?.[1] ? m[1] : `sales-bill-${id}.xml`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download XML.");
    } finally {
      setDownloadingId((p) => (p === id ? null : p));
    }
  }

  const selectClass = "h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 shadow-sm";

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ReportPageHeader
        className="mb-0"
        title="Export History"
        purpose="Download previously generated Tally XML exports for sales bills (latest first)."
      />

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1">
            <div className="text-xs font-medium text-slate-600">From</div>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <div className="text-xs font-medium text-slate-600">To</div>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <div className="text-xs font-medium text-slate-600">Customer</div>
            <select className={selectClass} value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="ALL">All</option>
              {customers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <div className="text-xs font-medium text-slate-600">Search</div>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Voucher / file name" />
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Exported records</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr className="text-left text-xs font-medium uppercase text-slate-500">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-4 py-2">Dispatch Ref</th>
                  <th className="px-4 py-2">Voucher No</th>
                  <th className="px-4 py-2">File Name</th>
                  <th className="px-4 py-2">Exported By</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-600">
                      {loading ? "Loading…" : "No exported records match the filters."}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="px-4 py-2 tabular-nums">{fmtDdMmYyyy(r.exportedAt)}</td>
                      <td className="px-4 py-2">{r.customerName}</td>
                      <td className="px-4 py-2 tabular-nums">{`DSP-${String(r.dispatchId).padStart(6, "0")}`}</td>
                      <td className="px-4 py-2 tabular-nums">{r.voucherNo}</td>
                      <td className="px-4 py-2">{r.fileName || "—"}</td>
                      <td className="px-4 py-2">{r.exportedBy || "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={downloadingId === r.id}
                          onClick={() => void downloadAgain(r.id)}
                        >
                          {downloadingId === r.id ? "…" : "Download XML Again"}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

