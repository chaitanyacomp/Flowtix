import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { PageContainer, ReportPageHeader } from "../components/PageHeader";
import { Input } from "../components/ui/input";

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
  const [fgItems, setFgItems] = React.useState<FgItem[]>([]);
  const [rows, setRows] = React.useState<ScrapRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const [fgItemId, setFgItemId] = React.useState<number | "">("");
  const [workOrderId, setWorkOrderId] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  React.useEffect(() => {
    apiFetch<FgItem[]>("/api/items?type=FG")
      .then(setFgItems)
      .catch(() => {});
  }, []);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (fgItemId !== "") qs.set("fgItemId", String(fgItemId));
      if (workOrderId.trim()) qs.set("workOrderId", workOrderId.trim());
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const data = await apiFetch<ScrapRow[]>(`/api/scrap?${qs.toString()}`);
      setRows(data);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = rows.reduce((s, r) => s + Number(r.rejectedQty || 0), 0);

  return (
    <PageContainer className="pb-8">
      <ReportPageHeader
        title="Scrap Report"
        purpose="QC scrap and loss quantities by FG item and work order for the filters you choose."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters &amp; run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? <div className="text-sm text-red-700">{error}</div> : null}
          <div className="grid gap-3 md:grid-cols-5">
            <label className="grid gap-1 text-sm md:col-span-2">
              <span className="text-slate-600">FG item</span>
              <select
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={fgItemId === "" ? "" : fgItemId}
                onChange={(e) => setFgItemId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">All</option>
                {fgItems.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.itemName}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">Work order id</span>
              <Input value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)} placeholder="e.g. 12" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">From</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">To</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Apply filters"}
            </Button>
            <div className="text-sm text-slate-600">
              Total rejected qty: <span className="font-semibold text-slate-900">{total.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scrap entries</CardTitle>
        </CardHeader>
        <CardContent>
          {!rows.length ? (
            <div className="text-sm text-slate-600">No scrap records.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-600">
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">WO</th>
                    <th className="py-2 pr-2">FG</th>
                    <th className="py-2 pr-2">Rejected qty</th>
                    <th className="py-2 pr-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-2 pr-2 whitespace-nowrap">{new Date(r.date).toLocaleString()}</td>
                      <td className="py-2 pr-2">#{r.workOrderId}</td>
                      <td className="py-2 pr-2 font-medium">{r.fgItemName}</td>
                      <td className="py-2 pr-2">{Number(r.rejectedQty).toFixed(2)}</td>
                      <td className="py-2 pr-2 text-slate-700">{r.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

