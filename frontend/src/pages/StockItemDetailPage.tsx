/**
 * Item-wise stock drilldown — godown positions, operational flow summary, recent movements.
 */
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import {
  OperatorPageBody,
  OperatorPageTitle,
  operatorTableRowClass,
} from "../components/erp/OperatorWorkbench";
import { PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";

type SummaryLine = {
  key: string;
  label: string;
  qty: number;
  tone: string;
};

type GodownPositions = {
  total: number;
  rmStore: number;
  production: number;
  wip: number;
  fgStore: number;
  qcHold: number;
  scrap: number;
  unassignedUsable?: number;
};

type DrilldownResponse = {
  item: { id: number; itemName: string; itemType: string; unit: string };
  positions: GodownPositions;
  summaryLines: SummaryLine[];
  movementHistory: Array<{
    id: number;
    date: string;
    activityLabel: string;
    refDisplay: string;
    fromLocationName?: string | null;
    toLocationName?: string | null;
    qtyIn: number;
    qtyOut: number;
    stockBucket: string;
  }>;
  movementHistoryTotal: number;
};

function fmtQty(n: number, unit?: string) {
  const u = unit?.trim() ? ` ${unit}` : "";
  const v = Number.isFinite(n) ? n : 0;
  const s = v.toFixed(3).replace(/\.?0+$/, "");
  return `${s}${u}`;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function summaryToneClass(tone: string) {
  if (tone === "consumption") return "text-amber-900";
  if (tone === "return") return "text-emerald-800";
  if (tone === "transfer") return "text-sky-800";
  if (tone === "qc") return "text-violet-800";
  if (tone === "scrap") return "text-red-800";
  return "text-slate-800";
}

export function StockItemDetailPage() {
  const { itemId: itemIdParam } = useParams();
  const navigate = useNavigate();
  const itemId = Number(itemIdParam);
  const [data, setData] = React.useState<DrilldownResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const liveTick = useErpRefreshTick(["stock"], { pollIntervalMs: ERP_REPORT_POLL_MS });

  React.useEffect(() => {
    if (!Number.isFinite(itemId) || itemId <= 0) {
      setError("Invalid item");
      setLoading(false);
      return;
    }
    setLoading(true);
    void apiFetch<DrilldownResponse>(`/api/stock/items/${itemId}/drilldown`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load item stock"))
      .finally(() => setLoading(false));
  }, [itemId, liveTick]);

  const unit = data?.item.unit ?? "";

  return (
    <OperatorPageBody>
      <div className="mx-auto w-full max-w-[960px] space-y-4">
        <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/stock" defaultLabel="Stock Overview" />}>
          <div>
            <OperatorPageTitle>{data?.item.itemName ?? "Item stock"}</OperatorPageTitle>
            <p className="mt-1 text-[13px] text-slate-600">
              Where stock sits and how it moved — operational view only.
            </p>
          </div>
        </StickyWorkspaceHead>

        {error ? <p className="text-[13px] text-red-700">{error}</p> : null}
        {loading ? <p className="text-[13px] text-slate-600">Loading…</p> : null}

        {data && !loading ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data.item.itemType === "FG" ? "success" : "default"}>{data.item.itemType}</Badge>
              <span className="text-[12px] text-slate-500">Item #{data.item.id}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto h-8 text-[12px]"
                onClick={() => navigate(`/stock/movement-history?itemId=${data.item.id}&sort=desc`)}
              >
                Full movement history
              </Button>
            </div>

            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <h2 className="text-sm font-semibold text-slate-900">Current positions</h2>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { label: "Total", value: data.positions.total, bold: true },
                  { label: "RM Store", value: data.positions.rmStore },
                  { label: "At Production", value: data.positions.production },
                  { label: "WIP", value: data.positions.wip },
                  { label: "FG Store", value: data.positions.fgStore },
                  { label: "Under QC", value: data.positions.qcHold },
                  { label: "Scrap", value: data.positions.scrap },
                ]
                  .filter((c) => c.bold || c.value > 0)
                  .map((c) => (
                    <div key={c.label} className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5">
                      <div className="text-[11px] font-medium text-slate-600">{c.label}</div>
                      <div
                        className={cn(
                          "tabular-nums text-[15px]",
                          c.bold ? "font-bold text-slate-900" : "font-semibold text-slate-800",
                        )}
                      >
                        {fmtQty(c.value, unit)}
                      </div>
                    </div>
                  ))}
              </div>
            </section>

            {data.summaryLines.length > 0 ? (
              <section className="rounded-lg border border-slate-200 bg-white p-3">
                <h2 className="text-sm font-semibold text-slate-900">Movement summary</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">Lifetime totals from stock ledger (all work orders).</p>
                <ul className="mt-2 divide-y divide-slate-100">
                  {data.summaryLines.map((ln) => (
                    <li
                      key={ln.key}
                      className="flex items-center justify-between gap-3 py-2 text-[13px]"
                    >
                      <span className={cn("font-medium", summaryToneClass(ln.tone))}>{ln.label}</span>
                      <span className="tabular-nums font-semibold text-slate-900">{fmtQty(ln.qty, unit)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Latest movements</h2>
                <span className="text-[11px] text-slate-500">
                  {data.movementHistory.length} of {data.movementHistoryTotal}
                </span>
              </div>
              {data.movementHistory.length === 0 ? (
                <p className="mt-2 text-[13px] text-slate-600">No movements recorded.</p>
              ) : (
                <div className="mt-2 overflow-hidden rounded border border-slate-100">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="px-2 py-1 font-medium">When</th>
                        <th className="px-2 py-1 font-medium">Activity</th>
                        <th className="px-2 py-1 font-medium">Ref</th>
                        <th className="px-2 py-1 text-right font-medium">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.movementHistory.map((m) => {
                        const netIn = Number(m.qtyIn) > 0;
                        const qty = netIn ? m.qtyIn : m.qtyOut;
                        const dir =
                          m.fromLocationName && m.toLocationName
                            ? `${m.fromLocationName} → ${m.toLocationName}`
                            : m.toLocationName || m.fromLocationName || "";
                        return (
                          <tr key={m.id} className={cn("border-t border-slate-100", operatorTableRowClass)}>
                            <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{fmtDate(m.date)}</td>
                            <td className="px-2 py-1.5">
                              <div className="font-medium text-slate-900">{m.activityLabel}</div>
                              {dir ? <div className="text-[10px] text-slate-500">{dir}</div> : null}
                            </td>
                            <td className="px-2 py-1.5 text-slate-600">{m.refDisplay || "—"}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                              <span className={netIn ? "text-emerald-800" : "text-amber-900"}>
                                {netIn ? "+" : "−"}
                                {fmtQty(Number(qty), unit)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                <Link to={`/stock/movement-history?itemId=${data.item.id}`} className="font-semibold text-sky-800 underline">
                  Open full movement history
                </Link>{" "}
                for GRN, transfers, consumption, and adjustments.
              </p>
            </section>
          </>
        ) : null}

        <Link
          to="/stock"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to stock overview
        </Link>
      </div>
    </OperatorPageBody>
  );
}
