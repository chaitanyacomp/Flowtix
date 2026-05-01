import * as React from "react";
import { apiFetch } from "../services/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";

type Bucket = "QC_HOLD" | "REWORK";

type Row = {
  id: number;
  returnNo: string;
  date: string;
  customer: { id: number; name: string };
  dispatchId: number;
  dispatchNo: string;
  item: { id: number; name: string; unit: string };
  qty: number;
  disposition: "QC_HOLD" | "REWORK" | "TO_STOCK";
  currentBucket: Bucket;
  status?: "IN_REWORK" | "IN_QC_HOLD" | "APPROVED_TO_STOCK" | "SCRAPPED" | "REVERSED";
};

function titleForBucket(bucket: Bucket): string {
  return bucket === "QC_HOLD" ? "Hold for Checking" : "Rework";
}

function statusBadgeForRow(
  r: Pick<Row, "status">,
): { label: string; variant: "default" | "warning" | "success" | "info" | "rejected" } | null {
  if (!r.status) return null;
  if (r.status === "IN_REWORK") return { label: "Waiting for Rework Approval", variant: "info" };
  if (r.status === "IN_QC_HOLD") return { label: "Waiting QC", variant: "warning" };
  if (r.status === "APPROVED_TO_STOCK") return { label: "Approved for Dispatch", variant: "success" };
  if (r.status === "SCRAPPED") return { label: "Scrapped", variant: "rejected" };
  if (r.status === "REVERSED") return { label: "Reversed", variant: "warning" };
  return null;
}

export function CustomerReturnBucketPage({ bucket }: { bucket: Bucket }) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [scrappingId, setScrappingId] = React.useState<number | null>(null);
  const [actionReasonById, setActionReasonById] = React.useState<Record<number, string>>({});
  const [completingId, setCompletingId] = React.useState<number | null>(null);
  const [approvingId, setApprovingId] = React.useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<Row[]>(`/api/customer-returns/bucket/${bucket}?limit=200`);
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
      setError("Could not load customer returns.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket]);

  async function scrapRow(id: number) {
    setScrappingId(id);
    setError(null);
    try {
      await apiFetch(`/api/customer-returns/${id}/scrap`, {
        method: "POST",
        body: JSON.stringify({ reason: actionReasonById[id] ?? "" }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not scrap.");
    } finally {
      setScrappingId(null);
    }
  }

  async function approveReworkToStock(id: number) {
    setCompletingId(id);
    setError(null);
    try {
      await apiFetch(`/api/customer-returns/${id}/approve-rework`, {
        method: "POST",
        body: JSON.stringify({ reason: actionReasonById[id] ?? "" }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve rework.");
    } finally {
      setCompletingId(null);
    }
  }

  async function approveRow(id: number) {
    setApprovingId(id);
    setError(null);
    try {
      await apiFetch(`/api/customer-returns/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ reason: actionReasonById[id] ?? "" }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve.");
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900">Customer Return · {titleForBucket(bucket)}</h1>
        <p className="text-sm text-slate-600">
          {bucket === "REWORK"
            ? "Approve rework to stock (one step) or scrap."
            : "Approve to stock or scrap."}
        </p>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Active returns</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
          {loading ? <p className="text-sm text-slate-600">Loading…</p> : null}
          {!loading && !rows.length && !error ? <p className="text-sm text-slate-600">No active returns in this bucket.</p> : null}

          {rows.length ? (
            <div className="overflow-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-600">
                    <th className="py-2 pr-2">Return No</th>
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Customer</th>
                    <th className="py-2 pr-2">Item</th>
                    <th className="py-2 pr-2">Qty</th>
                    <th className="py-2 pr-2">Dispatch</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Reason (optional)</th>
                    <th className="py-2 pr-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-2 pr-2 font-mono text-xs">{r.returnNo}</td>
                      <td className="py-2 pr-2">{r.date ? new Date(r.date).toLocaleDateString() : "—"}</td>
                      <td className="py-2 pr-2">{r.customer.name}</td>
                      <td className="py-2 pr-2">
                        <div className="font-medium">{r.item.name}</div>
                        <div className="text-xs text-slate-500">
                          <Badge variant="info">{titleForBucket(bucket)}</Badge>
                        </div>
                      </td>
                      <td className="py-2 pr-2 tabular-nums">
                        {r.qty} {r.item.unit}
                      </td>
                      <td className="py-2 pr-2 font-mono text-xs">{r.dispatchNo}</td>
                      <td className="py-2 pr-2">
                        {statusBadgeForRow(r) ? (
                          <Badge variant={statusBadgeForRow(r)!.variant}>{statusBadgeForRow(r)!.label}</Badge>
                        ) : (
                          <Badge variant="info">{titleForBucket(bucket)}</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          className="h-9"
                          value={actionReasonById[r.id] ?? ""}
                          onChange={(e) => setActionReasonById((p) => ({ ...p, [r.id]: e.target.value }))}
                          placeholder="Optional"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-wrap gap-2">
                          {bucket === "REWORK" ? (
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              onClick={() => approveReworkToStock(r.id)}
                              disabled={completingId === r.id}
                            >
                              {completingId === r.id ? "Approving…" : "Approve Rework (Move to Stock)"}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => approveRow(r.id)}
                              disabled={approvingId === r.id}
                            >
                              {approvingId === r.id ? "Approving…" : "Approve"}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => scrapRow(r.id)}
                            disabled={scrappingId === r.id}
                          >
                            {scrappingId === r.id ? "Scrapping…" : "Scrap"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

