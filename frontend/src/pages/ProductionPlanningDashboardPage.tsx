import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { apiFetch } from "../services/api";
import { cn } from "../lib/utils";

type Status = "RED" | "YELLOW" | "GREEN";

type Row = {
  itemId: number;
  itemName: string;
  requirementQty: number;
  stockQty: number;
  gapPercent: number;
  suggestedWoQty: number;
  status: Status;
};

type ApiResp = {
  items: Row[];
  summary: { criticalCount: number; lowCount: number; healthyCount: number };
};

function statusBadge(s: Status) {
  if (s === "RED") return { label: "Critical", variant: "rejected" as const };
  if (s === "YELLOW") return { label: "Low", variant: "warning" as const };
  return { label: "Healthy", variant: "success" as const };
}

function rowTone(s: Status) {
  if (s === "RED") return "bg-red-50/60 hover:bg-red-50";
  if (s === "YELLOW") return "bg-amber-50/60 hover:bg-amber-50";
  return "bg-white hover:bg-slate-50/70";
}

export function ProductionPlanningDashboardPage() {
  const nav = useNavigate();
  const [data, setData] = React.useState<ApiResp | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setBusy(true);
    setError(null);
    apiFetch<ApiResp>("/api/planning-dashboard/production")
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setBusy(false));
  }, []);

  const rows = data?.items ?? [];
  const summary = data?.summary ?? { criticalCount: 0, lowCount: 0, healthyCount: 0 };

  function goCreateWo(r: Row) {
    const qs = new URLSearchParams();
    qs.set("prefillItemId", String(r.itemId));
    qs.set("prefillQty", String(r.suggestedWoQty));
    qs.set("source", "planning_dashboard");
    nav(`/work-orders?${qs.toString()}`);
  }

  return (
    <div className="space-y-3">
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Critical</div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{busy ? "…" : summary.criticalCount}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Low</div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{busy ? "…" : summary.lowCount}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Healthy</div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{busy ? "…" : summary.healthyCount}</div>
        </div>
      </div>

      <Card className="overflow-hidden border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-3.5 py-2.5">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Production Planning Dashboard</CardTitle>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-[13px]">
              <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.06)]">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Requirement</th>
                  <th className="px-3 py-2 text-right">Current stock</th>
                  <th className="px-3 py-2 text-right">Gap %</th>
                  <th className="px-3 py-2 text-right">Suggested WO qty</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {busy ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-600">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-600">
                      No planning rows right now.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const b = statusBadge(r.status);
                    const canCreate = Number(r.suggestedWoQty) > 0;
                    return (
                      <tr key={r.itemId} className={cn("border-b border-slate-100 transition-colors", rowTone(r.status))}>
                        <td className="px-3 py-2 font-medium text-slate-900">{r.itemName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.requirementQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.stockQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(r.gapPercent).toFixed(2)}%</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{r.suggestedWoQty}</td>
                        <td className="px-3 py-2">
                          <Badge variant={b.variant} className="text-[10px]">
                            {b.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant={canCreate ? "default" : "outline"} disabled={!canCreate} onClick={() => goCreateWo(r)}>
                            Create WO
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

