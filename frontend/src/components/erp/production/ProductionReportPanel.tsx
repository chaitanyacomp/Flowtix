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
  productionReportLeaveWarningMessage,
  resolveLiveWastageValidationMessage,
  shouldBlockLeaveProductionReport,
  toWastageDetailPayload,
  validateWastageClassification,
} from "../../../lib/productionWastageClassification";
import {
  clearProductionReportDraft,
  getProductionReportDraft,
  isProductionReportDraftDirty,
  saveProductionReportDraft,
  type ProductionReportLineInputDraft,
} from "../../../lib/productionReportDraftCache";
import {
  computeRmLineWastageAllocation,
  fmtRmQty,
} from "../../../lib/productionReportRmAllocation";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard";

function fmtQty(n: number | null | undefined): string {
  return fmtRmQty(n);
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
    const runner = Number(ln.runnerWasteQty ?? 0);
    const alloc = computeRmLineWastageAllocation({
      issuedQty: issued,
      consumedQty: consumed,
      returnedQty: 0,
      runnerWasteQty: runner,
    });
    next[ln.itemId] = {
      rmConsumedQty: fmtQty(consumed),
      rmReturnQty: "0",
      scrapWasteQty: fmtQty(alloc.manualWasteQty),
      varianceQty: fmtQty(alloc.unexplainedBalance),
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
  const [remarksExpanded, setRemarksExpanded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [recoveredDraft, setRecoveredDraft] = React.useState(false);
  const [localDirty, setLocalDirty] = React.useState(false);
  const skipDraftPersistRef = React.useRef(false);

  React.useEffect(() => {
    if (!workOrderId || workOrderId <= 0) {
      setReport(null);
      setRecoveredDraft(false);
      setLocalDirty(false);
      onStatusChange?.(initialProductionReportPanelStatus());
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRecoveredDraft(false);
    setLocalDirty(false);
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
        if (cached && isProductionReportDraftDirty(workOrderId)) {
          setRecoveredDraft(true);
          setLocalDirty(true);
        }
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
    if (!localDirty) return;
    saveProductionReportDraft(workOrderId, { lineInputs, wastageRows, remarks }, { dirty: true });
  }, [enableDraftCache, workOrderId, loading, report, lineInputs, wastageRows, remarks, localDirty]);

  const updateLineInput = React.useCallback(
    (itemId: number, key: keyof LineInput, value: string) => {
      setLocalDirty(true);
      setLineInputs((prev) => {
        const source = report?.rmLines.find((ln) => ln.itemId === itemId);
        const issued = Number(source?.issuedQty ?? 0);
        const consumedDefault = Number(source?.reportedConsumedQty ?? source?.ledgerConsumedQty ?? 0);
        const runner = Number(source?.runnerWasteQty ?? 0);
        const defaultAlloc = computeRmLineWastageAllocation({
          issuedQty: issued,
          consumedQty: consumedDefault,
          returnedQty: 0,
          runnerWasteQty: runner,
        });
        const cur = prev[itemId] ?? {
          rmConsumedQty: fmtQty(consumedDefault),
          rmReturnQty: "0",
          scrapWasteQty: fmtQty(defaultAlloc.manualWasteQty),
          varianceQty: fmtQty(defaultAlloc.unexplainedBalance),
          remarks: "",
        };
        const next = { ...cur, [key]: value };
        if (key === "rmReturnQty" || key === "rmConsumedQty" || key === "scrapWasteQty") {
          const consumed = Number(next.rmConsumedQty) || 0;
          const returned = Number(next.rmReturnQty) || 0;
          // Return/consumed changes re-open required allocation; refill manual wastage by default.
          // Explicit scrap edits keep the typed manual qty and recompute unexplained only.
          const alloc = computeRmLineWastageAllocation({
            issuedQty: issued,
            consumedQty: consumed,
            returnedQty: returned,
            runnerWasteQty: runner,
            manualWasteQty: key === "scrapWasteQty" ? Number(next.scrapWasteQty) || 0 : null,
          });
          if (key !== "scrapWasteQty") {
            next.scrapWasteQty = fmtQty(alloc.manualWasteQty);
          }
          next.varianceQty = fmtQty(alloc.unexplainedBalance);
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

  const reportConfirmed = Boolean(report?.confirmation?.confirmed);

  const confirmBlockedByWastage =
    totalWastageQty > 1e-6 && !isWastageClassificationComplete(wastageBalance, wastageRows);

  const rmTotals = React.useMemo(() => {
    if (!report?.rmLines?.length) {
      return { issued: 0, accounted: 0, unexplained: 0, unit: "Kg" };
    }
    let issued = 0;
    let accounted = 0;
    let unexplained = 0;
    for (const ln of report.rmLines) {
      const issuedQty = Number(ln.issuedQty ?? 0);
      issued += issuedQty;
      if (reportConfirmed) {
        const confirmedLine = report.confirmation?.lines.find((r) => r.itemId === ln.itemId);
        const consumedQty = Number(confirmedLine?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0);
        const returnedQty = Number(confirmedLine?.rmReturnQty ?? 0);
        const wasteQty = Number(confirmedLine?.scrapWasteQty ?? 0);
        accounted += consumedQty + returnedQty + wasteQty;
        unexplained += issuedQty - consumedQty - returnedQty - wasteQty;
      } else {
        const input = lineInputs[ln.itemId];
        const consumedQty = Number(input?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0);
        const returnedQty = Number(input?.rmReturnQty ?? 0);
        const wasteQty = Number(ln.runnerWasteQty ?? 0) + Number(input?.scrapWasteQty ?? 0);
        accounted += consumedQty + returnedQty + wasteQty;
        unexplained += issuedQty - consumedQty - returnedQty - wasteQty;
      }
    }
    const unit = report.rmLines.find((ln) => ln.unit)?.unit?.trim() || "Kg";
    return {
      issued,
      accounted: Number(fmtQty(accounted)),
      unexplained: Number(fmtQty(unexplained)),
      unit,
    };
  }, [lineInputs, report, reportConfirmed]);

  const confirmBlockedByUnexplained = Math.abs(rmTotals.unexplained) > 1e-6;
  const confirmBlocked = confirmBlockedByWastage || confirmBlockedByUnexplained;

  const leaveBlocked =
    enableDraftCache &&
    shouldBlockLeaveProductionReport({
      confirmed: reportConfirmed,
      localDirty,
      totalWastageQty,
      wastageRows,
    });

  useUnsavedChangesGuard({
    isDirty: leaveBlocked,
    message: productionReportLeaveWarningMessage({
      localDirty,
      totalWastageQty,
      wastageRows,
    }),
  });

  const wastageFooterFeedback = React.useMemo(() => {
    if (reportConfirmed || !(totalWastageQty > 1e-6)) return null;
    const message = resolveLiveWastageValidationMessage(wastageBalance, wastageRows, wastageUnit);
    if (message) {
      return {
        message,
        tone:
          wastageBalance.status === "over"
            ? "border-red-200 bg-red-50 text-red-950"
            : "border-amber-200 bg-amber-50 text-amber-950",
      };
    }
    if (wastageBalance.status === "complete") {
      return {
        message: "Wastage fully classified.",
        tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
      };
    }
    return null;
  }, [reportConfirmed, totalWastageQty, wastageBalance, wastageRows, wastageUnit]);

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
            scrapWasteQty: Number(input?.scrapWasteQty ?? 0),
            remarks: input?.remarks || null,
          };
        }),
        wastageDetails: totalWastageQty > 1e-6 ? toWastageDetailPayload(wastageRows) : [],
      });
      setReport(result.report);
      setWastageRows(buildDefaultWastageRows(result.report));
      setLocalDirty(false);
      setRecoveredDraft(false);
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
  const confirmed = reportConfirmed;
  const isPremiumCompact = compact && premium;
  const showWastage =
    Boolean(report) && (totalWastageQty > 1e-6 || (confirmed && wastageRows.length > 0));

  const rmTable = report && report.rmLines.length > 0 ? (
    <div
      className={cn(
        "rounded border border-slate-200",
        compact ? "max-h-[min(9.5rem,22vh)] overflow-x-hidden overflow-y-auto" : "overflow-auto",
      )}
      data-testid={compact ? "production-report-rm-scroll" : undefined}
    >
      <table
        className={cn(
          "w-full border-collapse text-slate-800",
          isPremiumCompact
            ? "table-fixed text-[12px]"
            : compact
              ? "table-fixed text-[11px]"
              : "min-w-[54rem] text-[12px]",
        )}
      >
        <thead className="sticky top-0 z-[1] bg-slate-50">
          <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            <th className={cn("px-2", isPremiumCompact ? "py-1" : compact ? "py-0.5" : "py-1")}>RM Item</th>
            <th className={cn("px-2 text-right", compact ? "w-[4.25rem] py-0.5" : "py-1")}>Issued</th>
            <th className={cn("px-2 text-right", compact ? "w-[4.25rem] py-0.5" : "py-1")}>Consumed</th>
            <th className={cn("px-2 text-right", compact ? "w-[5rem] py-0.5" : "py-1")}>Returned</th>
            <th className={cn("px-2 text-right", compact ? "w-[4.75rem] py-0.5" : "py-1")}>
              {compact ? "Wastage" : "Total Wastage"}
            </th>
            <th className={cn("px-2 text-right", compact ? "w-[5.5rem] py-0.5" : "py-1")}>
              {compact ? "Unexplained Balance" : "Variance"}
            </th>
            {!compact ? <th className="px-2 py-1 text-right">Returnable</th> : null}
            <th className={cn("px-2", compact ? "w-[6.5rem] py-0.5" : "py-1")}>Remarks</th>
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
                  {Number(ln.runnerWasteQty ?? 0) > 0 ? (
                    <span className="block text-[10px] font-normal text-slate-500" title="AUTO – Item Master">
                      Runner wastage (auto): {fmtQty(ln.runnerWasteQty)} {ln.unit}
                    </span>
                  ) : null}
                </td>
                <td className={cn("px-2 text-right tabular-nums", cellPy)}>{fmtQty(ln.issuedQty)}</td>
                <td className={cn("px-2 text-right tabular-nums", cellPy)}>
                  {confirmed
                    ? fmtQty(confirmedLine?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty)
                    : fmtQty(Number(input?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0))}
                </td>
                <td className={cn("px-2 text-right tabular-nums", cellPy)}>
                  {confirmed ? (
                    fmtQty(confirmedLine?.rmReturnQty ?? 0)
                  ) : (
                    <input
                      className={cn(
                        "rounded border border-slate-200 px-1 text-right",
                        isPremiumCompact
                          ? "h-8 w-full max-w-[4.5rem] text-[12px]"
                          : compact
                            ? "h-7 w-full max-w-[4rem] text-[11px]"
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
                    Math.abs(Number(variance ?? 0)) <= 1e-6
                      ? "text-slate-800"
                      : Number(variance ?? 0) > 0
                        ? "text-rose-800"
                        : "text-emerald-800",
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
                        "w-full rounded border border-slate-200 px-1",
                        isPremiumCompact
                          ? "h-8 text-[12px]"
                          : compact
                            ? "h-7 text-[11px]"
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
  ) : null;

  const remarksField = !isPremiumCompact ? (
    <label className={cn("text-[11px] font-medium text-slate-600", compact ? "block" : "flex-1")}>
      Remarks
      <textarea
        className={cn(
          "mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-slate-900",
          compact ? "min-h-10 text-[11px]" : "min-h-16 text-[12px]",
        )}
        value={remarks}
        onChange={(e) => {
          setLocalDirty(true);
          setRemarks(e.target.value);
        }}
        disabled={confirmed}
        rows={compact ? 2 : undefined}
      />
    </label>
  ) : remarksExpanded || remarks.trim() ? (
    <label className="block text-[11px] font-semibold text-slate-700">
      Report remarks
      <textarea
        className="mt-0.5 min-h-8 w-full rounded border border-slate-300 px-2 py-1 text-[12px] text-slate-900"
        value={remarks}
        onChange={(e) => {
          setLocalDirty(true);
          setRemarks(e.target.value);
        }}
        onBlur={() => {
          if (!remarks.trim()) setRemarksExpanded(false);
        }}
        disabled={confirmed}
        placeholder="Optional"
        rows={2}
        autoFocus={remarksExpanded && !remarks.trim()}
      />
    </label>
  ) : (
    <button
      type="button"
      className="text-left text-[11px] font-semibold text-sky-800 underline-offset-2 hover:underline"
      onClick={() => setRemarksExpanded(true)}
      disabled={confirmed}
      data-testid="production-report-add-remarks"
    >
      Add report remarks
    </button>
  );

  const footerStatusText = confirmed
    ? "Report confirmed"
    : confirmBlockedByUnexplained
      ? `Unexplained balance ${fmtQty(Math.abs(rmTotals.unexplained))} ${rmTotals.unit}`
      : confirmBlockedByWastage
        ? wastageFooterFeedback?.message ?? "Classify wastage before close"
        : `Balance ${fmtQty(rmTotals.unexplained)} ${rmTotals.unit} · Ready to close`;

  const confirmButton = !confirmed ? (
    <div
      className={cn(
        "shrink-0",
        isPremiumCompact ? "w-auto" : isPremiumCompact || compact ? "w-full" : "space-y-1 sm:max-w-[16rem]",
      )}
    >
      {!isPremiumCompact && !compact && confirmHelperText ? (
        <p className="text-[10px] leading-snug text-slate-600">{confirmHelperText}</p>
      ) : null}
      <Button
        type="button"
        size={isPremiumCompact ? "default" : "sm"}
        className={cn(
          isPremiumCompact
            ? "h-9 whitespace-nowrap px-4 text-[13px] font-semibold"
            : "w-full",
          !isPremiumCompact && compact ? "h-9 text-[12px] font-semibold" : !isPremiumCompact ? "text-[12px]" : "",
        )}
        onClick={handleConfirm}
        disabled={saving || confirmBlocked}
        data-testid="confirm-report-close-wo-btn"
      >
        {saving ? "Working…" : confirmButtonLabel ?? "Confirm Report"}
      </Button>
    </div>
  ) : null;

  const fgUnit = report?.fgUnit?.trim() || "Nos";
  const plannedQty = Number(report?.summary?.plannedQty ?? 0);
  const producedQty = Number(report?.summary?.producedQty ?? 0);
  const shortageExtraLabel =
    producedQty + 1e-6 < plannedQty
      ? `Short ${fmtQty(plannedQty - producedQty)}`
      : producedQty > plannedQty + 1e-6
        ? `Extra ${fmtQty(producedQty - plannedQty)}`
        : "—";
  const reportStatusLabel = confirmed ? "Confirmed" : "Report Pending";

  /** Compact/premium: true 3-zone containment — header+strip / middle / pinned action footer. */
  if (compact) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 max-h-[min(100%,calc(100dvh-11rem))] flex-1 flex-col overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm max-[800px]:max-h-none",
          className,
        )}
        role="region"
        aria-label="Production report and RM consumption"
        data-testid="production-report-panel"
      >
        {/* ZONE 1 — fixed header + compact summary strip */}
        <div className="shrink-0 border-b border-slate-100 bg-slate-50/90 px-2.5 py-1.5" data-testid="production-report-header">
          <div className="flex items-center justify-between gap-2">
            <div
              className={cn(
                "font-semibold text-slate-900",
                isPremiumCompact ? "text-[13px]" : "text-[12px]",
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
          {report?.hasApprovedProduction ? (
            <dl
              className="mt-1.5 grid grid-cols-4 gap-x-2 gap-y-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] sm:grid-cols-7"
              data-testid="production-report-summary-strip"
            >
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Planned</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-slate-900">
                  {fmtQty(plannedQty)} {fgUnit}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Produced</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-slate-900">
                  {fmtQty(producedQty)} {fgUnit}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Shortage/Extra</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-slate-900">{shortageExtraLabel}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">RM Issued</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-slate-900">
                  {fmtQty(rmTotals.issued)} {rmTotals.unit}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Accounted</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-slate-900">
                  {fmtQty(rmTotals.accounted)} {rmTotals.unit}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Balance</dt>
                <dd
                  className={cn(
                    "mt-0.5 font-bold tabular-nums",
                    Math.abs(rmTotals.unexplained) <= 1e-6 ? "text-emerald-800" : "text-rose-800",
                  )}
                >
                  {fmtQty(rmTotals.unexplained)} {rmTotals.unit}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Status</dt>
                <dd
                  className={cn(
                    "mt-0.5 font-bold",
                    confirmed ? "text-emerald-800" : "text-amber-900",
                  )}
                >
                  {reportStatusLabel}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>

        {loading ? (
          <p className={cn("px-2.5 py-2 text-slate-600", isPremiumCompact ? "text-[13px] font-medium" : "text-[12px]")}>
            Loading production report…
          </p>
        ) : error ? (
          <p className="px-2.5 py-2 text-[11px] text-amber-800">{error}</p>
        ) : !report?.hasApprovedProduction ? (
          <p className="px-2.5 py-2 text-[11px] text-slate-600">No approved production batches on this work order yet.</p>
        ) : (
          <>
            {rmTable ? (
              <div className="shrink-0 space-y-1 border-b border-slate-100 px-2.5 py-1.5" data-testid="production-report-rm-zone">
                {rmTable}
              </div>
            ) : null}

            {/* ZONE 2 — middle: bounded wastage; remarks compact above footer */}
            <div
              className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-2.5 py-1.5"
              data-testid="production-report-scroll-body"
            >
              {showWastage ? (
                <div className="shrink-0">
                  <ProductionReportWastageDetails
                    wastageTypes={report.wastageTypes ?? []}
                    rows={wastageRows}
                    totalWastageQty={totalWastageQty}
                    unit={wastageUnit}
                    readOnly={confirmed}
                    compact={compact}
                    hideInlineValidation={!confirmed}
                    scrollableRows={false}
                    fillAvailableHeight={false}
                    onChange={(rows) => {
                      setLocalDirty(true);
                      setWastageRows(rows);
                    }}
                  />
                </div>
              ) : (
                <div className="min-h-0 flex-1" />
              )}

              {report.confirmation?.returnPendings?.length ? (
                <div className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950">
                  RM Return Pending:{" "}
                  {report.confirmation.returnPendings
                    .map((p) => `${p.itemName} ${fmtQty(p.requestedQty)} ${p.unit}`.trim())
                    .join(", ")}
                </div>
              ) : null}

              <div className="shrink-0">{remarksField}</div>
            </div>

            {/* ZONE 3 — pinned footer: reconciliation status + Confirm */}
            <div
              className="shrink-0 border-t border-slate-200 bg-white px-2.5 py-2 shadow-[0_-4px_12px_-2px_rgba(15,23,42,0.08)]"
              data-testid="production-report-sticky-footer"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p
                  className={cn(
                    "min-w-0 flex-1 text-[12px] font-semibold tabular-nums",
                    confirmed || !confirmBlocked
                      ? "text-emerald-800"
                      : confirmBlockedByUnexplained
                        ? "text-rose-800"
                        : "text-amber-900",
                  )}
                  data-testid="production-report-footer-status"
                >
                  {footerStatusText}
                </p>
                {wastageFooterFeedback && confirmBlockedByWastage && !confirmBlockedByUnexplained ? (
                  <p
                    className={cn(
                      "w-full rounded border px-2 py-1 font-medium sm:hidden",
                      isPremiumCompact ? "text-[11px]" : "text-[11px]",
                      wastageFooterFeedback.tone,
                    )}
                    data-testid="production-wastage-validation"
                  >
                    {wastageFooterFeedback.message}
                  </p>
                ) : null}
                {confirmButton}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  /* Non-compact (full page) layout — unchanged structure with sticky bottom action */
  return (
    <div
      className={cn("rounded-md border border-slate-200 bg-white shadow-sm", className)}
      role="region"
      aria-label="Production report and RM consumption"
      data-testid="production-report-panel"
    >
      <div className="shrink-0 border-b border-slate-100 bg-slate-50/90 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-slate-900">Production Report</div>
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
        {recoveredDraft && !confirmed ? (
          <p
            className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950"
            data-testid="production-report-recovered-draft"
          >
            Recovered draft — unsaved edits from this browser tab were restored. Server confirmation remains authoritative.
          </p>
        ) : null}
        {loading ? (
          <p className="text-[12px] text-slate-600">Loading production report…</p>
        ) : error ? (
          <p className="text-[11px] text-amber-800">{error}</p>
        ) : !report?.hasApprovedProduction ? (
          <p className="text-[11px] text-slate-600">No approved production batches on this work order yet.</p>
        ) : (
          <>
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

            {rmTable}

            {showWastage ? (
              <ProductionReportWastageDetails
                wastageTypes={report.wastageTypes ?? []}
                rows={wastageRows}
                totalWastageQty={totalWastageQty}
                unit={wastageUnit}
                readOnly={confirmed}
                onChange={(rows) => {
                  setLocalDirty(true);
                  setWastageRows(rows);
                }}
              />
            ) : null}

            <div className="sticky bottom-0 z-10 -mx-3 flex flex-col gap-2 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-sm sm:flex-row sm:items-end">
              {remarksField}
              {confirmButton}
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
