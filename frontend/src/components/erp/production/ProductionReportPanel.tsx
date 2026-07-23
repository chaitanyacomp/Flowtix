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
import { DecimalInput } from "../../ui/DecimalInput";
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
import { computeRmLineWastageAllocation, fmtRmQty } from "../../../lib/productionReportRmAllocation";
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
    next[ln.itemId] = {
      rmConsumedQty: fmtQty(consumed),
      rmReturnQty: "0",
      remarks: "",
    };
  }
  return next;
}

function buildDefaultWastageRows(data: ProductionWorkOrderReport): WastageDetailDraft[] {
  return (data.confirmation?.wastageDetails || []).map((row) => ({
    key: `wd-${row.id}`,
    itemId: row.itemId ?? data.rmLines[0]?.itemId,
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
  reportModeSummary = null,
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
  /** Optional compact WO/SO metrics row for Report Mode (display only). */
  reportModeSummary?: {
    woLabel?: string | null;
    soLabel?: string | null;
    itemName?: string | null;
    soQty?: number | null;
    woTarget?: number | null;
    produced?: number | null;
    targetBalance?: number | null;
    unit?: string | null;
  } | null;
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
        setLineInputs(cached ? Object.fromEntries(Object.entries(defaultLines).map(([id, defaults]) => [id, {
          ...defaults,
          rmReturnQty: cached.lineInputs[Number(id)]?.rmReturnQty ?? defaults.rmReturnQty,
          remarks: cached.lineInputs[Number(id)]?.remarks ?? defaults.remarks,
        }])) : defaultLines);
        setWastageRows((cached?.wastageRows ?? defaultWastage).map((row) => ({
          ...row,
          itemId: row.itemId ?? data.rmLines[0]?.itemId,
        })));
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
        const consumedDefault = Number(source?.reportedConsumedQty ?? source?.ledgerConsumedQty ?? 0);
        const cur = prev[itemId] ?? {
          rmConsumedQty: fmtQty(consumedDefault),
          rmReturnQty: "0",
          remarks: "",
        };
        const next = { ...cur, [key]: value };
        if (key === "rmReturnQty" && value.trim()) {
          const returned = Number(value);
          const physicalBalance = Math.max(0, Number(source?.issuedQty ?? 0) - consumedDefault);
          if (!Number.isFinite(returned) || returned < 0) {
            setError("Returned quantity cannot be negative.");
            return prev;
          }
          if (returned > physicalBalance + 0.0005) {
            setError(`Returned quantity cannot exceed the available physical balance (${fmtQty(physicalBalance)} ${source?.unit ?? ""}).`);
            return prev;
          }
          setError(null);
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
      const issued = Number(ln.issuedQty ?? 0);
      const consumed = Number(input?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0);
      const returned = Number(input?.rmReturnQty ?? 0);
      return acc + Math.max(0, issued - consumed - returned);
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
        const wasteQty = wastageRows.filter((row) => row.itemId === ln.itemId).reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0);
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
  }, [lineInputs, report, reportConfirmed, wastageRows]);

  const confirmBlockedByUnexplained = Math.abs(rmTotals.unexplained) > 1e-6;
  const firstUnreconciledLine = React.useMemo(() => {
    if (!report || reportConfirmed) return null;
    for (const ln of report.rmLines) {
      const input = lineInputs[ln.itemId];
      const classified = wastageRows.filter((row) => row.itemId === ln.itemId).reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0);
      const balance = computeRmLineWastageAllocation({
        issuedQty: Number(ln.issuedQty ?? 0),
        consumedQty: Number(input?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0),
        returnedQty: Number(input?.rmReturnQty ?? 0),
        manualWasteQty: classified,
      }).unexplainedBalance;
      if (Math.abs(balance) > 0.0005) return { ...ln, balance };
    }
    return null;
  }, [lineInputs, report, reportConfirmed, wastageRows]);
  const confirmBlocked = confirmBlockedByWastage || confirmBlockedByUnexplained || Boolean(firstUnreconciledLine);

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
            scrapWasteQty: wastageRows.filter((row) => row.itemId === ln.itemId).reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0),
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
        "overflow-x-auto rounded border border-slate-200",
        !compact && "overflow-auto",
      )}
      data-testid={compact ? "production-report-rm-scroll" : undefined}
    >
      <table
        className={cn(
          "w-full border-collapse text-slate-800",
          isPremiumCompact
            ? "min-w-[52rem] table-fixed text-[12px]"
            : compact
              ? "min-w-[48rem] table-fixed text-[11px]"
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
              Classified Wastage
            </th>
            <th className={cn("px-2 text-right", compact ? "w-[5.5rem] py-0.5" : "py-1")}>
              Remaining Unreconciled
            </th>
            <th className={cn("px-2 text-right", compact ? "w-[4.75rem] py-0.5" : "py-1")}>Expected Runner</th>
            <th className={cn("px-2 text-right", compact ? "w-[5rem] py-0.5" : "py-1")}>Actual Runner Variance</th>
            <th className={cn("px-2", compact ? "w-[6.5rem] py-0.5" : "py-1")}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {report.rmLines.map((ln) => {
            const confirmedLine = report.confirmation?.lines.find((r) => r.itemId === ln.itemId);
            const input = lineInputs[ln.itemId];
            const classifiedWaste = confirmed
              ? Number(confirmedLine?.scrapWasteQty ?? 0)
              : wastageRows.filter((row) => row.itemId === ln.itemId).reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0);
            const consumed = Number(confirmedLine?.rmConsumedQty ?? input?.rmConsumedQty ?? ln.reportedConsumedQty ?? ln.ledgerConsumedQty ?? 0);
            const returned = Number(confirmedLine?.rmReturnQty ?? input?.rmReturnQty ?? 0);
            const allocation = computeRmLineWastageAllocation({ issuedQty: Number(ln.issuedQty ?? 0), consumedQty: consumed, returnedQty: returned, manualWasteQty: classifiedWaste });
            const variance = confirmed ? Number(confirmedLine?.varianceQty ?? allocation.unexplainedBalance) : allocation.unexplainedBalance;
            const runnerTypeIds = new Set((report.wastageTypes ?? []).filter((type) => /runner/i.test(type.name)).map((type) => type.id));
            const actualRunner = wastageRows.filter((row) => row.itemId === ln.itemId && runnerTypeIds.has(row.wastageTypeId)).reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0);
            const runnerVariance = actualRunner - Number(ln.runnerWasteQty ?? 0);
            const cellPy = isPremiumCompact ? "py-1" : compact ? "py-0.5" : "py-1";
            return (
              <tr key={ln.itemId} className="border-b border-slate-100">
                <td className={cn("px-2 font-medium", cellPy)}>
                  {ln.itemName}
                  {ln.unit ? <span className="ml-1 font-normal text-slate-500">{ln.unit}</span> : null}
                  {Number(ln.runnerWasteQty ?? 0) > 0 ? (
                    <span className="block text-[10px] font-normal text-slate-500" title="AUTO – Item Master">
                      Expected runner component (included in Consumed): {fmtQty(ln.runnerWasteQty)} {ln.unit}
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
                    <DecimalInput
                      className={cn(
                        "rounded border border-slate-200 px-1 text-right",
                        isPremiumCompact
                          ? "h-8 w-full max-w-[4.5rem] text-[12px]"
                          : compact
                            ? "h-7 w-full max-w-[4rem] text-[11px]"
                            : "w-20 py-0.5",
                      )}
                      value={input?.rmReturnQty ?? ""}
                      onValueChange={(next) => updateLineInput(ln.itemId, "rmReturnQty", next)}
                    />
                  )}
                </td>
                <td className={cn("px-2 text-right tabular-nums", cellPy)}>
                  {fmtQty(classifiedWaste)}
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
                <td className={cn("px-2 text-right tabular-nums", cellPy)}>{fmtQty(ln.runnerWasteQty)}</td>
                <td className={cn("px-2 text-right tabular-nums", cellPy)}>{fmtQty(runnerVariance)}</td>
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
          compact ? "min-h-8 max-h-16 text-[11px]" : "min-h-16 text-[12px]",
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
      General Remarks
      <textarea
        className="mt-0.5 min-h-8 max-h-14 w-full rounded border border-slate-300 px-2 py-1 text-[12px] text-slate-900"
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
      Add general remarks
    </button>
  );

  /** Compact readiness beside header Confirm — pending balance / ready / exact validation reason. */
  const headerReadinessText = confirmed
    ? "Report confirmed"
    : firstUnreconciledLine
      ? `${fmtQty(Math.abs(firstUnreconciledLine.balance))} ${firstUnreconciledLine.unit} ${firstUnreconciledLine.itemName} is still unreconciled. Return it or classify it as wastage.`
      : confirmBlockedByWastage
        ? wastageFooterFeedback?.message ?? "Classify wastage before close"
        : `Balance ${fmtQty(rmTotals.unexplained)} ${rmTotals.unit} · Ready to close`;

  const confirmButton = !confirmed ? (
    <div
      className={cn(
        "shrink-0",
        compact ? "w-auto" : "space-y-1 sm:max-w-[16rem]",
      )}
    >
      {!compact && confirmHelperText ? (
        <p className="text-[10px] leading-snug text-slate-600">{confirmHelperText}</p>
      ) : null}
      <Button
        type="button"
        size={isPremiumCompact ? "default" : "sm"}
        className={cn(
          compact
            ? "h-9 whitespace-nowrap px-4 text-[13px] font-semibold"
            : "w-full text-[12px]",
        )}
        onClick={handleConfirm}
        disabled={saving || confirmBlocked}
        title={saving || confirmBlocked ? headerReadinessText : undefined}
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

  /** Compact/premium: sticky header hosts Confirm; body scrolls naturally — no bottom duplicate action. */
  if (compact) {
    const summaryUnit = reportModeSummary?.unit?.trim() || fgUnit;
    return (
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200/90 bg-white shadow-sm",
          className,
        )}
        role="region"
        aria-label="Production report and RM consumption"
        data-testid="production-report-panel"
      >
        {/* ZONE 1 — sticky header: title + Mandatory + readiness + Confirm (top-right) */}
        <div
          className="sticky top-0 z-[15] shrink-0 border-b border-slate-100 bg-slate-50/95 px-2.5 py-1.5 backdrop-blur-sm"
          data-testid="production-report-header"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className={cn(
                  "font-semibold text-slate-900",
                  isPremiumCompact ? "text-[13px]" : "text-[12px]",
                )}
              >
                Production Report
              </div>
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
            <div
              className="flex min-w-0 flex-wrap items-center justify-end gap-2"
              data-testid="production-report-header-actions"
            >
              <p
                className={cn(
                  "max-w-[min(100%,28rem)] text-right text-[12px] font-semibold tabular-nums",
                  confirmed || !confirmBlocked
                    ? "text-emerald-800"
                    : confirmBlockedByUnexplained
                      ? "text-rose-800"
                      : "text-amber-900",
                )}
                data-testid="production-report-header-status"
              >
                {headerReadinessText}
              </p>
              {confirmButton}
            </div>
          </div>
          {recoveredDraft && !confirmed ? (
            <div
              className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-950"
              data-testid="production-report-recovered-draft"
            >
              <span>Recovered draft — unsaved edits restored. Server confirmation remains authoritative.</span>
              <button
                type="button"
                className="shrink-0 text-[11px] font-semibold text-amber-900 underline-offset-2 hover:underline"
                onClick={() => setRecoveredDraft(false)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {error && !loading ? (
            <p className="mt-1 text-[11px] font-medium text-rose-800" data-testid="production-report-error">
              {error}
            </p>
          ) : null}
          {reportModeSummary ? (
            <dl
              className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] sm:grid-cols-6"
              data-testid="production-report-compact-wo-summary"
            >
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">WO</dt>
                <dd className="mt-0.5 font-bold text-slate-900">{reportModeSummary.woLabel ?? report?.workOrderNo ?? "—"}</dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="font-semibold uppercase tracking-wide text-slate-500">SO / FG</dt>
                <dd className="mt-0.5 truncate font-medium text-slate-900">
                  {reportModeSummary.soLabel ?? report?.salesOrderNo ?? "—"}
                  {reportModeSummary.itemName ? ` · ${reportModeSummary.itemName}` : ""}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">SO Qty</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-slate-900">
                  {reportModeSummary.soQty != null ? `${fmtQty(reportModeSummary.soQty)} ${summaryUnit}` : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">WO Target</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-slate-900">
                  {fmtQty(reportModeSummary.woTarget ?? plannedQty)} {summaryUnit}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Produced</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-slate-900">
                  {fmtQty(reportModeSummary.produced ?? producedQty)} {summaryUnit}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Target Balance</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-slate-900">
                  {fmtQty(reportModeSummary.targetBalance ?? Math.max(0, plannedQty - producedQty))} {summaryUnit}
                </dd>
              </div>
            </dl>
          ) : report?.hasApprovedProduction ? (
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
        ) : !report?.hasApprovedProduction && !error ? (
          <p className="px-2.5 py-2 text-[11px] text-slate-600">No approved production batches on this work order yet.</p>
        ) : report?.hasApprovedProduction ? (
          <div className="space-y-1.5 px-2.5 py-1.5" data-testid="production-report-scroll-body">
            {rmTable ? (
              <div className="space-y-1" data-testid="production-report-rm-zone">
                {rmTable}
              </div>
            ) : null}

            {showWastage ? (
              <ProductionReportWastageDetails
                rmLines={report.rmLines}
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
            ) : null}

            {report.confirmation?.returnPendings?.length ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950">
                RM Return Pending:{" "}
                {report.confirmation.returnPendings
                  .map((p) => `${p.itemName} ${fmtQty(p.requestedQty)} ${p.unit}`.trim())
                  .join(", ")}
              </div>
            ) : null}

            <div className="shrink-0">{remarksField}</div>
          </div>
        ) : null}
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
                rmLines={report.rmLines}
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
