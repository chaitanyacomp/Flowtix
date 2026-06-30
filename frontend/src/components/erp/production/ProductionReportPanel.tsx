import * as React from "react";
import { cn } from "../../../lib/utils";
import {
  confirmProductionWorkOrderReport,
  fetchProductionWorkOrderReport,
  type ProductionWorkOrderReport,
} from "../../../lib/productionWorkOrderReportApi";

function fmtQty(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) <= 1e-9) return "0";
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : String(r);
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

type LineInput = {
  rmConsumedQty: string;
  rmReturnQty: string;
  scrapWasteQty: string;
  varianceQty: string;
  remarks: string;
};

export function ProductionReportPanel({
  workOrderId,
  refreshKey = 0,
  className,
  onConfirmed,
}: {
  workOrderId: number;
  refreshKey?: number;
  className?: string;
  onConfirmed?: () => void;
}) {
  const [report, setReport] = React.useState<ProductionWorkOrderReport | null>(null);
  const [lineInputs, setLineInputs] = React.useState<Record<number, LineInput>>({});
  const [remarks, setRemarks] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!workOrderId || workOrderId <= 0) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchProductionWorkOrderReport(workOrderId)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setRemarks(data.confirmation?.remarks ?? "");
        const next: Record<number, LineInput> = {};
        for (const ln of data.rmLines || []) {
          const consumed = Number(ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0);
          next[ln.itemId] = {
            rmConsumedQty: fmtQty(consumed),
            rmReturnQty: "0",
            scrapWasteQty: "0",
            varianceQty: fmtQty(Number(ln.issuedQty ?? 0) - consumed),
            remarks: "",
          };
        }
        setLineInputs(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setReport(null);
          setError(e instanceof Error ? e.message : "Failed to load production report");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, refreshKey]);

  const updateLineInput = React.useCallback(
    (itemId: number, key: keyof LineInput, value: string) => {
      setLineInputs((prev) => {
        const cur = prev[itemId] ?? {
          rmConsumedQty: "0",
          rmReturnQty: "0",
          scrapWasteQty: "0",
          varianceQty: "0",
          remarks: "",
        };
        const next = { ...cur, [key]: value };
        if (key === "rmConsumedQty" || key === "rmReturnQty" || key === "scrapWasteQty") {
          const source = report?.rmLines.find((ln) => ln.itemId === itemId);
          const issued = Number(source?.issuedQty ?? 0);
          const consumed = Number(next.rmConsumedQty) || 0;
          const ret = Number(next.rmReturnQty) || 0;
          const scrap = Number(next.scrapWasteQty) || 0;
          next.varianceQty = fmtQty(issued - consumed - ret - scrap);
        }
        return { ...prev, [itemId]: next };
      });
    },
    [report?.rmLines],
  );

  const handleConfirm = React.useCallback(async () => {
    if (!report || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await confirmProductionWorkOrderReport(workOrderId, {
        remarks,
        lines: report.rmLines.map((ln) => {
          const input = lineInputs[ln.itemId];
          return {
            itemId: ln.itemId,
            rmConsumedQty: Number(input?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0),
            rmReturnQty: Number(input?.rmReturnQty ?? 0),
            scrapWasteQty: Number(input?.scrapWasteQty ?? 0),
            varianceQty: Number(input?.varianceQty ?? 0),
            remarks: input?.remarks || null,
          };
        }),
      });
      setReport(result.report);
      onConfirmed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm Production Report");
    } finally {
      setSaving(false);
    }
  }, [lineInputs, onConfirmed, remarks, report, saving, workOrderId]);

  if (!workOrderId || workOrderId <= 0) return null;
  const confirmed = Boolean(report?.confirmation?.confirmed);

  return (
    <div
      className={cn("rounded-md border border-slate-200 bg-white shadow-sm", className)}
      role="region"
      aria-label="Production report and RM consumption"
      data-testid="production-report-panel"
    >
      <div className="border-b border-slate-100 bg-slate-50/80 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-semibold text-slate-900">Production Report / RM Consumption</div>
          <span
            className={cn(
              "rounded border px-2 py-0.5 text-[10px] font-semibold",
              confirmed
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800",
            )}
          >
            {confirmed ? "Confirmed" : "Mandatory"}
          </span>
        </div>
      </div>
      <div className="space-y-3 px-3 py-2">
        {loading ? (
          <p className="text-[11px] text-slate-600">Loading production report...</p>
        ) : error ? (
          <p className="text-[11px] text-amber-800">{error}</p>
        ) : !report?.hasApprovedProduction ? (
          <p className="text-[11px] text-slate-600">No approved production batches on this work order yet.</p>
        ) : (
          <>
            <div className="grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <span className="text-slate-500">WO</span>
                <div className="font-semibold text-slate-900">{report.workOrderNo}</div>
              </div>
              <div>
                <span className="text-slate-500">SO / FG</span>
                <div className="font-medium text-slate-900">
                  {report.salesOrderNo ?? "-"}
                  {report.fgItemName ? ` - ${report.fgItemName}` : ""}
                </div>
              </div>
              <div>
                <span className="text-slate-500">Planned / Produced</span>
                <div className="font-semibold tabular-nums text-slate-900">
                  {fmtQty(report.summary.plannedQty)} / {fmtQty(report.summary.producedQty)}
                </div>
              </div>
              <div>
                <span className="text-slate-500">Remaining</span>
                <div className="font-medium tabular-nums text-slate-900">
                  {fmtQty(report.summary.remainderQty)}
                  {report.confirmation?.confirmedAt ? (
                    <span className="ml-1 font-normal text-slate-500">{fmtWhen(report.confirmation.confirmedAt)}</span>
                  ) : null}
                </div>
              </div>
            </div>

            {report.rmLines.length > 0 ? (
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full min-w-[54rem] border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-semibold uppercase text-slate-500">
                      <th className="px-2 py-1">RM Item</th>
                      <th className="px-2 py-1 text-right">Issued</th>
                      <th className="px-2 py-1 text-right">Consumed</th>
                      <th className="px-2 py-1 text-right">Return</th>
                      <th className="px-2 py-1 text-right">Scrap</th>
                      <th className="px-2 py-1 text-right">Variance</th>
                      <th className="px-2 py-1 text-right">Returnable</th>
                      <th className="px-2 py-1">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rmLines.map((ln) => {
                      const confirmedLine = report.confirmation?.lines.find((r) => r.itemId === ln.itemId);
                      const input = lineInputs[ln.itemId];
                      const variance = confirmed ? confirmedLine?.varianceQty : Number(input?.varianceQty ?? 0);
                      return (
                        <tr key={ln.itemId} className="border-b border-slate-100 text-slate-800">
                          <td className="px-2 py-1 font-medium">
                            {ln.itemName}
                            {ln.unit ? <span className="ml-1 font-normal text-slate-500">{ln.unit}</span> : null}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtQty(ln.issuedQty)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {confirmed ? (
                              fmtQty(confirmedLine?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty)
                            ) : (
                              <input className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right" type="number" min="0" step="0.001" value={input?.rmConsumedQty ?? ""} onChange={(e) => updateLineInput(ln.itemId, "rmConsumedQty", e.target.value)} />
                            )}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {confirmed ? fmtQty(confirmedLine?.rmReturnQty ?? 0) : <input className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right" type="number" min="0" step="0.001" value={input?.rmReturnQty ?? ""} onChange={(e) => updateLineInput(ln.itemId, "rmReturnQty", e.target.value)} />}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {confirmed ? fmtQty(confirmedLine?.scrapWasteQty ?? 0) : <input className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right" type="number" min="0" step="0.001" value={input?.scrapWasteQty ?? ""} onChange={(e) => updateLineInput(ln.itemId, "scrapWasteQty", e.target.value)} />}
                          </td>
                          <td className={cn("px-2 py-1 text-right tabular-nums", Number(variance ?? 0) > 0 ? "text-rose-800" : Number(variance ?? 0) < 0 ? "text-emerald-800" : "")}>{fmtQty(variance)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtQty(ln.returnableQty)}</td>
                          <td className="px-2 py-1">
                            {confirmed ? confirmedLine?.remarks ?? "-" : <input className="w-36 rounded border border-slate-200 px-1 py-0.5" value={input?.remarks ?? ""} onChange={(e) => updateLineInput(ln.itemId, "remarks", e.target.value)} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 border-t border-slate-100 pt-2 sm:flex-row sm:items-end">
              <label className="flex-1 text-[11px] font-medium text-slate-600">
                Remarks
                <textarea className="mt-1 min-h-16 w-full rounded border border-slate-200 px-2 py-1 text-[12px] text-slate-900" value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={confirmed} />
              </label>
              {!confirmed ? (
                <button type="button" className="rounded bg-slate-900 px-3 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" onClick={handleConfirm} disabled={saving}>
                  {saving ? "Confirming..." : "Confirm Report"}
                </button>
              ) : null}
            </div>

            {report.confirmation?.returnPendings?.length ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950">
                RM Return Pending:{" "}
                {report.confirmation.returnPendings
                  .map((p) => `${p.itemName} ${fmtQty(p.requestedQty)} ${p.unit}`.trim())
                  .join(", ")}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
