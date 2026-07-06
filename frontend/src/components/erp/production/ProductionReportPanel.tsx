import * as React from "react";
import { cn } from "../../../lib/utils";
import {
  confirmProductionWorkOrderReport,
  fetchProductionWorkOrderReport,
  type ProductionWorkOrderReport,
} from "../../../lib/productionWorkOrderReportApi";
import {
  initialProductionReportPanelStatus,
  type ProductionReportPanelStatus,
} from "../../../lib/productionWorkspaceCompactUx";
import { Button } from "../../ui/button";
import { ProductionReportWastageDetails } from "./ProductionReportWastageDetails";
import {
  type WastageDetailDraft,
  computeWastageClassificationBalance,
  isWastageClassificationComplete,
  toWastageDetailPayload,
  validateWastageClassification,
} from "../../../lib/productionWastageClassification";
import {
  clearProductionReportDraft,
  getProductionReportDraft,
  saveProductionReportDraft,
  type ProductionReportLineInputDraft,
} from "../../../lib/productionReportDraftCache";

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

type LineInput = ProductionReportLineInputDraft;

function buildDefaultLineInputs(data: ProductionWorkOrderReport): Record<number, LineInput> {
  const next: Record<number, LineInput> = {};
  for (const ln of data.rmLines || []) {
    const consumed = Number(ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0);
    const issued = Number(ln.issuedQty ?? 0);
    next[ln.itemId] = {
      rmConsumedQty: fmtQty(consumed),
      rmReturnQty: "0",
      scrapWasteQty: fmtQty(Math.max(0, issued - consumed)),
      varianceQty: fmtQty(issued - consumed),
      remarks: "",
    };
  }
  return next;
}

function buildDefaultWastageRows(data: ProductionWorkOrderReport): WastageDetailDraft[] {
  return (data.confirmation?.wastageDetails || []).map((row) => ({
    key: `wd-${row.id}`,
    wastageTypeId: row.wastageTypeId,
    qty: fmtQty(row.qty),
    remarks: row.remarks ?? "",
  }));
}

export function ProductionReportPanel({
  workOrderId,
  refreshKey = 0,
  className,
  compact = false,
  premium = false,
  confirmButtonLabel,
  confirmHelperText,
  closeWorkOrderOnConfirm = false,
  enableDraftCache = false,
  onConfirmed,
  onStatusChange,
}: {
  workOrderId: number;
  refreshKey?: number;
  className?: string;
  compact?: boolean;
  premium?: boolean;
  confirmButtonLabel?: string;
  confirmHelperText?: string;
  closeWorkOrderOnConfirm?: boolean;
  enableDraftCache?: boolean;
  onConfirmed?: (meta: {
    requiresShortfallDecision: boolean;
    remainderQty: number;
    executionCloseOutcome?: string | null;
    executionCloseMessage?: string | null;
  }) => void | Promise<void>;
  onStatusChange?: (status: ProductionReportPanelStatus) => void;
}) {
  const [report, setReport] = React.useState<ProductionWorkOrderReport | null>(null);
  const [lineInputs, setLineInputs] = React.useState<Record<number, LineInput>>({});
  const [wastageRows, setWastageRows] = React.useState<WastageDetailDraft[]>([]);
  const [remarks, setRemarks] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const skipDraftPersistRef = React.useRef(false);

  React.useEffect(() => {
    if (!workOrderId || workOrderId <= 0) {
      setReport(null);
      onStatusChange?.(initialProductionReportPanelStatus());
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    onStatusChange?.({ ...initialProductionReportPanelStatus(), loading: true });
    void fetchProductionWorkOrderReport(workOrderId)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        const confirmed = Boolean(data.confirmation?.confirmed);
        const cached = enableDraftCache && !confirmed ? getProductionReportDraft(workOrderId) : null;
        const defaultLines = buildDefaultLineInputs(data);
        const defaultWastage = buildDefaultWastageRows(data);
        setRemarks(cached?.remarks ?? data.confirmation?.remarks ?? "");
        setLineInputs(cached?.lineInputs ?? defaultLines);
        setWastageRows(cached?.wastageRows ?? defaultWastage);
        if (confirmed && enableDraftCache) {
          clearProductionReportDraft(workOrderId);
        }
        onStatusChange?.({
          loading: false,
          resolved: true,
          confirmed,
          hasApprovedProduction: Boolean(data.hasApprovedProduction),
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setReport(null);
          setError(e instanceof Error ? e.message : "Failed to load production report");
          onStatusChange?.({
            loading: false,
            resolved: true,
            confirmed: false,
            hasApprovedProduction: false,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, refreshKey, onStatusChange, enableDraftCache]);

  React.useEffect(() => {
    if (!enableDraftCache || !(workOrderId > 0) || skipDraftPersistRef.current) return;
    if (loading || !report || Boolean(report.confirmation?.confirmed)) return;
    saveProductionReportDraft(workOrderId, { lineInputs, wastageRows, remarks }, { dirty: true });
  }, [enableDraftCache, workOrderId, loading, report, lineInputs, wastageRows, remarks]);

  const updateLineInput = React.useCallback(
    (itemId: number, key: keyof LineInput, value: string) => {
      setLineInputs((prev) => {
        const source = report?.rmLines.find((ln) => ln.itemId === itemId);
        const issued = Number(source?.issuedQty ?? 0);
        const consumedDefault = Number(source?.reportedConsumedQty ?? source?.ledgerConsumedQty ?? 0);
        const cur = prev[itemId] ?? {
          rmConsumedQty: fmtQty(consumedDefault),
          rmReturnQty: "0",
          scrapWasteQty: "0",
          varianceQty: fmtQty(issued - consumedDefault),
          remarks: "",
        };
        const next = { ...cur, [key]: value };
        if (key === "rmReturnQty") {
          const consumed = Number(next.rmConsumedQty) || 0;
          const ret = Number(next.rmReturnQty) || 0;
          const scrap = Math.max(0, issued - consumed - ret);
          next.scrapWasteQty = fmtQty(scrap);
          next.varianceQty = fmtQty(issued - consumed);
        }
        return { ...prev, [itemId]: next };
      });
    },
    [report?.rmLines],
  );

  const totalWastageQty = React.useMemo(() => {
    if (!report?.rmLines?.length) return 0;
    if (report.confirmation?.confirmed) {
      return Number(report.totalWastageQty ?? 0);
    }
    return report.rmLines.reduce((acc, ln) => {
      const input = lineInputs[ln.itemId];
      return acc + Math.max(0, Number(input?.scrapWasteQty ?? 0));
    }, 0);
  }, [lineInputs, report]);

  const wastageUnit = React.useMemo(() => {
    const fromLine = report?.rmLines.find((ln) => ln.unit)?.unit;
    return fromLine?.trim() || "Kg";
  }, [report?.rmLines]);

  const wastageBalance = React.useMemo(
    () => computeWastageClassificationBalance(totalWastageQty, wastageRows),
    [totalWastageQty, wastageRows],
  );

  const confirmBlockedByWastage =
    totalWastageQty > 1e-6 && !isWastageClassificationComplete(wastageBalance, wastageRows);

  const handleConfirm = React.useCallback(async () => {
    if (!report || saving) return;
    const validationError = validateWastageClassification(totalWastageQty, wastageRows, wastageUnit);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await confirmProductionWorkOrderReport(workOrderId, {
        remarks,
        closeWorkOrder: closeWorkOrderOnConfirm,
        lines: report.rmLines.map((ln) => {
          const input = lineInputs[ln.itemId];
          return {
            itemId: ln.itemId,
            rmConsumedQty: Number(input?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0),
            rmReturnQty: Number(input?.rmReturnQty ?? 0),
            remarks: input?.remarks || null,
          };
        }),
        wastageDetails: totalWastageQty > 1e-6 ? toWastageDetailPayload(wastageRows) : [],
      });
      setReport(result.report);
      setWastageRows(buildDefaultWastageRows(result.report));
      if (enableDraftCache) {
        clearProductionReportDraft(workOrderId);
      }
      onStatusChange?.({
        loading: false,
        resolved: true,
        confirmed: Boolean(result.report?.confirmation?.confirmed),
        hasApprovedProduction: Boolean(result.report?.hasApprovedProduction),
      });
      await onConfirmed?.({
        requiresShortfallDecision: Boolean(result.requiresShortfallDecision),
        remainderQty: Number(result.report?.summary?.remainderQty ?? 0),
        executionCloseOutcome: result.executionClose?.outcome ?? null,
        executionCloseMessage: result.executionClose?.successMessage ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm Production Report");
    } finally {
      setSaving(false);
    }
  }, [
    closeWorkOrderOnConfirm,
    enableDraftCache,
    lineInputs,
    onConfirmed,
    onStatusChange,
    remarks,
    report,
    saving,
    totalWastageQty,
    wastageRows,
    wastageUnit,
    workOrderId,
  ]);

  if (!workOrderId || workOrderId <= 0) return null;
  const confirmed = Boolean(report?.confirmation?.confirmed);
  const isPremiumCompact = compact && premium;

  return (
    <div
      className={cn(
        compact
          ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm"
          : "rounded-md border border-slate-200 bg-white shadow-sm",
        className,
      )}
      role="region"
      aria-label="Production report and RM consumption"
      data-testid="production-report-panel"
    >
      <div
        className={cn(
          "shrink-0 border-b border-slate-100 bg-slate-50/90 px-3",
          isPremiumCompact ? "py-2" : compact ? "py-1.5" : "py-2",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div
            className={cn(
              "font-semibold text-slate-900",
              isPremiumCompact ? "text-[14px]" : compact ? "text-[12px]" : "text-[13px]",
            )}
          >
            Production Report
          </div>
          {!isPremiumCompact ? (
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
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          compact ? "flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-2.5 py-2" : "space-y-3 px-3 py-2",
        )}
      >
        {loading ? (
          <p className={cn("text-slate-600", isPremiumCompact ? "text-[13px] font-medium" : "text-[12px]")}>
            Loading production report…
          </p>
        ) : error ? (
          <p className="text-[11px] text-amber-800">{error}</p>
        ) : !report?.hasApprovedProduction ? (
          <p className="text-[11px] text-slate-600">No approved production batches on this work order yet.</p>
        ) : (
          <>
            {!compact ? (
              <div className="grid gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <span className="text-slate-500">WO</span>
                  <div className="font-semibold text-slate-900">{report.workOrderNo}</div>
                </div>
                <div>
                  <span className="text-slate-500">Source / FG</span>
                  <div className="font-medium text-slate-900">
                    {String(report.salesOrderNo ?? "").toLowerCase().includes("green level")
                      ? "Green Level Stock"
                      : (report.salesOrderNo ?? "-")}
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
            ) : null}

            {report.rmLines.length > 0 ? (
              <div
                className={cn(
                  "min-h-0 overflow-auto rounded border border-slate-200",
                  compact && "flex-1",
                )}
              >
                <table
                  className={cn(
                    "w-full border-collapse text-slate-800",
                    isPremiumCompact
                      ? "min-w-[44rem] text-[12px]"
                      : compact
                        ? "min-w-[44rem] text-[11px]"
                        : "min-w-[54rem] text-[12px]",
                  )}
                >
                  <thead className="sticky top-0 z-[1] bg-slate-50">
                    <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      <th className={cn("px-2", isPremiumCompact ? "py-1" : compact ? "py-0.5" : "py-1")}>RM Item</th>
                      <th className={cn("px-2 text-right", compact ? "py-0.5" : "py-1")}>Issued</th>
                      <th className={cn("px-2 text-right", compact ? "py-0.5" : "py-1")}>Consumed</th>
                      <th className={cn("px-2 text-right", compact ? "py-0.5" : "py-1")}>Returned</th>
                      <th className={cn("px-2 text-right", compact ? "py-0.5" : "py-1")}>Total Wastage</th>
                      <th className={cn("px-2 text-right", compact ? "py-0.5" : "py-1")}>Variance</th>
                      {!compact ? <th className="px-2 py-1 text-right">Returnable</th> : null}
                      <th className={cn("px-2", compact ? "py-0.5" : "py-1")}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rmLines.map((ln) => {
                      const confirmedLine = report.confirmation?.lines.find((r) => r.itemId === ln.itemId);
                      const input = lineInputs[ln.itemId];
                      const variance = confirmed ? confirmedLine?.varianceQty : Number(input?.varianceQty ?? 0);
                      const cellPy = isPremiumCompact ? "py-1" : compact ? "py-0.5" : "py-1";
                      return (
                        <tr key={ln.itemId} className="border-b border-slate-100">
                          <td className={cn("px-2 font-medium", cellPy)}>
                            {ln.itemName}
                            {ln.unit ? <span className="ml-1 font-normal text-slate-500">{ln.unit}</span> : null}
                          </td>
                          <td className={cn("px-2 text-right tabular-nums", cellPy)}>{fmtQty(ln.issuedQty)}</td>
                          <td className={cn("px-2 text-right tabular-nums", cellPy)}>
                            {confirmed ? (
                              fmtQty(confirmedLine?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty)
                            ) : (
                              fmtQty(Number(input?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0))
                            )}
                          </td>
                          <td className={cn("px-2 text-right tabular-nums", cellPy)}>
                            {confirmed ? (
                              fmtQty(confirmedLine?.rmReturnQty ?? 0)
                            ) : (
                              <input
                                className={cn(
                                  "rounded border border-slate-200 px-1 text-right",
                                  isPremiumCompact
                                    ? "h-8 w-[4.5rem] text-[12px]"
                                    : compact
                                      ? "h-7 w-16 text-[11px]"
                                      : "w-20 py-0.5",
                                )}
                                type="number"
                                min="0"
                                step="0.001"
                                value={input?.rmReturnQty ?? ""}
                                onChange={(e) => updateLineInput(ln.itemId, "rmReturnQty", e.target.value)}
                              />
                            )}
                          </td>
                          <td className={cn("px-2 text-right tabular-nums", cellPy)}>
                            {confirmed ? fmtQty(confirmedLine?.scrapWasteQty ?? 0) : fmtQty(Number(input?.scrapWasteQty ?? 0))}
                          </td>
                          <td
                            className={cn(
                              "px-2 text-right tabular-nums",
                              cellPy,
                              Number(variance ?? 0) > 0
                                ? "text-rose-800"
                                : Number(variance ?? 0) < 0
                                  ? "text-emerald-800"
                                  : "",
                            )}
                          >
                            {fmtQty(variance)}
                          </td>
                          {!compact ? (
                            <td className={cn("px-2 text-right tabular-nums", cellPy)}>{fmtQty(ln.returnableQty)}</td>
                          ) : null}
                          <td className={cn("px-2", cellPy)}>
                            {confirmed ? (
                              confirmedLine?.remarks ?? "-"
                            ) : (
                              <input
                                className={cn(
                                  "rounded border border-slate-200 px-1",
                                  isPremiumCompact
                                    ? "h-8 w-32 text-[12px]"
                                    : compact
                                      ? "h-7 w-28 text-[11px]"
                                      : "w-36 py-0.5",
                                )}
                                value={input?.remarks ?? ""}
                                onChange={(e) => updateLineInput(ln.itemId, "remarks", e.target.value)}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {totalWastageQty > 1e-6 || (confirmed && wastageRows.length > 0) ? (
              <ProductionReportWastageDetails
                wastageTypes={report.wastageTypes ?? []}
                rows={wastageRows}
                totalWastageQty={totalWastageQty}
                unit={wastageUnit}
                readOnly={confirmed}
                compact={compact}
                onChange={setWastageRows}
              />
            ) : null}

            <div
              className={cn(
                "shrink-0 border-t border-slate-200 bg-white",
                isPremiumCompact
                  ? "flex flex-col gap-2 px-1 py-2"
                  : compact
                    ? "flex flex-wrap items-end gap-2 px-1 py-1.5"
                    : "sticky bottom-0 z-10 -mx-3 flex flex-col gap-2 bg-white/95 px-3 py-2 backdrop-blur-sm sm:flex-row sm:items-end",
              )}
            >
              {!isPremiumCompact ? (
                <label className={cn("text-[11px] font-medium text-slate-600", compact ? "min-w-[10rem] flex-1" : "flex-1")}>
                  Remarks
                  <textarea
                    className={cn(
                      "mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-slate-900",
                      compact ? "min-h-10 text-[11px]" : "min-h-16 text-[12px]",
                    )}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    disabled={confirmed}
                  />
                </label>
              ) : (
                <label className="text-[12px] font-semibold text-slate-700">
                  Report remarks
                  <textarea
                    className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] text-slate-900"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    disabled={confirmed}
                    placeholder="Optional"
                  />
                </label>
              )}
              {!confirmed ? (
                <div className={cn("shrink-0", isPremiumCompact ? "w-full" : compact ? "space-y-1" : "space-y-1 sm:max-w-[16rem]")}>
                  {!isPremiumCompact && confirmHelperText ? (
                    <p className="text-[10px] leading-snug text-slate-600">{confirmHelperText}</p>
                  ) : null}
                  <Button
                    type="button"
                    size={isPremiumCompact ? "default" : "sm"}
                    className={cn(
                      isPremiumCompact ? "h-10 w-full text-[14px] font-semibold" : "w-full",
                      !isPremiumCompact && compact ? "h-8 text-[11px]" : !isPremiumCompact ? "text-[12px]" : "",
                    )}
                    onClick={handleConfirm}
                    disabled={saving || confirmBlockedByWastage}
                    data-testid="confirm-report-close-wo-btn"
                  >
                    {saving ? "Working…" : confirmButtonLabel ?? "Confirm Report"}
                  </Button>
                </div>
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
