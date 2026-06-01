/**
 * Phase 3E — REGULAR production approval: RM consumption review before ISSUE.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { apiFetch } from "../../services/api";
import { cn } from "../../lib/utils";
import { ErpModal } from "./ErpModal";
import { useToast } from "../../contexts/ToastContext";
import {
  mapProductionRmApproveError,
  PREVIEW_LOAD_FAILED_HEADLINE,
} from "../../lib/productionRmApproveErrors";

export type RmConsumptionPreviewLine = {
  itemId: number;
  itemName: string;
  unit: string;
  standardQty: number;
  suggestedActualQty: number;
  availableAtProduction: number;
};

export type RmConsumptionPreview = {
  productionEntryId: number;
  producedQty: number;
  workOrderNo: string | null;
  fgItemName: string;
  fgUnit: string;
  warnThresholdPercent: number;
  roundingToleranceKg?: number;
  lines: RmConsumptionPreviewLine[];
  skipped?: boolean;
  reason?: string;
};

type DraftLine = RmConsumptionPreviewLine & {
  actualQty: string;
  remarks: string;
  consumptionType: string;
};

/** Max RM shortage allowed at approval due to WO vs batch rounding drift (must match backend). */
const RM_ROUNDING_TOLERANCE_KG = 0.01;

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function assessRmConsumptionShortage(available: number, actual: number) {
  const avail = round3(available);
  const act = round3(actual);
  if (act <= avail + 1e-6) {
    return { blocked: false, shortage: 0, withinTolerance: false };
  }
  const shortage = round3(act - avail);
  if (shortage <= RM_ROUNDING_TOLERANCE_KG + 1e-6) {
    return { blocked: false, shortage, withinTolerance: true };
  }
  return { blocked: true, shortage, withinTolerance: false };
}

function roundingToleranceMessage(shortage: number, unit?: string) {
  const u = unit?.trim() || "Kg";
  return `Allowed due to rounding tolerance: shortage ${round3(shortage)} ${u}`;
}

/** Defensive cap — never leave banner Approve stuck on Opening… */
const PREVIEW_FETCH_TIMEOUT_MS = 45_000;

type Props = {
  open: boolean;
  productionEntryId: number | null;
  onClose: () => void;
  onApproved: (result: { consumptionWarnings?: string[] }) => void;
  /** Preview finished (success, empty, or terminal error) — clear banner Approve loading. */
  onPreviewSettled?: () => void;
};

function fmtQty(n: number, unit?: string) {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

function parseQty(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function ModalErrorBanner({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      className="rounded-md border-2 border-red-300 bg-red-50 px-4 py-3 text-red-950"
      role="alert"
      data-testid="rm-consumption-modal-error"
    >
      <p className="text-sm font-semibold leading-snug">{title}</p>
      {detail ? <p className="mt-1.5 text-sm leading-snug text-red-900">{detail}</p> : null}
    </div>
  );
}

export function ProductionRmConsumptionReviewModal({
  open,
  productionEntryId,
  onClose,
  onApproved,
  onPreviewSettled,
}: Props) {
  const toast = useToast();
  const [preview, setPreview] = React.useState<RmConsumptionPreview | null>(null);
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [viewState, setViewState] = React.useState<ViewState>("loading");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setViewState("loading");
      setError(null);
      setPreview(null);
      setLines([]);
      setSubmitting(false);
      return;
    }
    if (!productionEntryId) return;

    let cancelled = false;
    let previewSettled = false;
    const settlePreview = () => {
      if (previewSettled || cancelled) return;
      previewSettled = true;
      onPreviewSettled?.();
    };

    setViewState("loading");
    setError(null);
    setPreview(null);
    setLines([]);

    const timeoutId = window.setTimeout(() => {
      if (cancelled || previewSettled) return;
      const msg = "Preview request timed out. Check network connection and try again.";
      setViewState("error");
      setError(msg);
      toast.showError(`${PREVIEW_LOAD_FAILED_HEADLINE} ${msg}`);
      settlePreview();
    }, PREVIEW_FETCH_TIMEOUT_MS);

    apiFetch<RmConsumptionPreview>(
      `/api/production/production-entries/${productionEntryId}/rm-consumption-preview`,
    )
      .then((data) => {
        if (cancelled || previewSettled) return;
        if (data.skipped) {
          const msg = "RM consumption review is not used for this order type.";
          setViewState("skipped");
          setError(msg);
          toast.showError(msg);
          settlePreview();
          return;
        }
        setPreview(data);
        const draftLines = data.lines.map((ln) => ({
          ...ln,
          actualQty: String(ln.suggestedActualQty),
          remarks: "",
          consumptionType: "",
        }));
        setLines(draftLines);
        setViewState(draftLines.length === 0 ? "empty" : "ready");
        settlePreview();
      })
      .catch((e) => {
        if (cancelled || previewSettled) return;
        const detail = mapProductionRmApproveError(e);
        setViewState("error");
        setError(detail);
        toast.showError(`${PREVIEW_LOAD_FAILED_HEADLINE} ${detail}`);
        settlePreview();
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast handlers are stable; avoid refetch loops
  }, [open, productionEntryId, onPreviewSettled]);

  const warnPct = preview?.warnThresholdPercent ?? 5;
  const roundingToleranceKg = preview?.roundingToleranceKg ?? RM_ROUNDING_TOLERANCE_KG;
  const canSubmitApprove = viewState === "ready" && lines.length > 0 && !submitting;

  const toleranceWarnings = React.useMemo(() => {
    if (viewState !== "ready") return [] as string[];
    const msgs: string[] = [];
    for (const ln of lines) {
      const actual = parseQty(ln.actualQty);
      if (actual == null || actual <= 0) continue;
      const check = assessRmConsumptionShortage(ln.availableAtProduction, actual);
      if (check.withinTolerance) {
        msgs.push(roundingToleranceMessage(check.shortage, ln.unit));
      }
    }
    return msgs;
  }, [viewState, lines]);

  async function onApprove() {
    if (!productionEntryId || !preview || viewState !== "ready" || !lines.length) return;
    setError(null);
    const consumptionLines: Array<{
      itemId: number;
      actualQty: number;
      remarks?: string | null;
      consumptionType?: string | null;
    }> = [];
    for (const ln of lines) {
      const actual = parseQty(ln.actualQty);
      if (actual == null || actual <= 0) {
        const msg = `Enter a positive Actual Used qty for ${ln.itemName}.`;
        setError(msg);
        toast.showError(msg);
        return;
      }
      if (actual > ln.availableAtProduction + 1e-6) {
        const check = assessRmConsumptionShortage(ln.availableAtProduction, actual);
        if (check.blocked) {
          const msg = `${ln.itemName}: actual used (${fmtQty(actual)}) exceeds available at production (${fmtQty(ln.availableAtProduction)}).`;
          setError(msg);
          toast.showError(msg);
          return;
        }
      }
      consumptionLines.push({
        itemId: ln.itemId,
        actualQty: actual,
        remarks: ln.remarks.trim() || null,
        consumptionType: ln.consumptionType || null,
      });
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ consumptionWarnings?: string[] }>(
        `/api/production/production-entries/${productionEntryId}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ consumptionLines }),
        },
      );
      onApproved(res);
      onClose();
    } catch (e) {
      const msg = mapProductionRmApproveError(e);
      setError(msg);
      toast.showError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const overlay = (
    <ErpModal
      onClose={onClose}
      backdropClassName="items-center"
      aria-labelledby="rm-consumption-review-title"
      escapeDisabled={() => submitting}
    >
      <Card className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden shadow-lg">
        <CardHeader className="flex flex-row items-start justify-between gap-2 border-b border-slate-100 py-3">
          <div>
            <CardTitle id="rm-consumption-review-title" className="text-base font-semibold text-slate-900">
              RM Consumption Review
            </CardTitle>
            <p className="mt-0.5 text-xs text-slate-600">
              Confirm actual RM used before approving production
              {preview?.workOrderNo ? ` · ${preview.workOrderNo}` : ""}
              {preview?.fgItemName ? ` · ${preview.fgItemName}` : ""}
              {preview ? ` · Batch qty ${fmtQty(preview.producedQty, preview.fgUnit)}` : ""}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} disabled={submitting}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto py-3">
          {viewState === "loading" ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-600">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-slate-500" aria-hidden />
              Loading standard consumption…
            </div>
          ) : null}

          {viewState === "error" ? (
            <ModalErrorBanner title={PREVIEW_LOAD_FAILED_HEADLINE} detail={error ?? undefined} />
          ) : null}

          {viewState === "skipped" ? (
            <ModalErrorBanner
              title="Consumption review not available"
              detail={error ?? "This order type does not use RM consumption review."}
            />
          ) : null}

          {viewState === "empty" && preview ? (
            <div className="space-y-3">
              <ModalErrorBanner
                title="No RM consumption lines available for this production batch."
                detail="Approval is blocked until standard RM consumption can be calculated."
              />
              <dl className="grid gap-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-800">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <dt className="font-medium text-slate-600">Finished good</dt>
                  <dd>{preview.fgItemName}</dd>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <dt className="font-medium text-slate-600">Work order</dt>
                  <dd>{preview.workOrderNo ?? "—"}</dd>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <dt className="font-medium text-slate-600">Produced qty</dt>
                  <dd className="tabular-nums">{fmtQty(preview.producedQty, preview.fgUnit)}</dd>
                </div>
              </dl>
              <div className="text-[12px] text-slate-700">
                <p className="font-medium text-slate-800">Possible causes</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  <li>Approved BOM missing for this item</li>
                  <li>Approved child BOM missing for a sub-assembly</li>
                  <li>Standard RM quantity is zero for all components</li>
                </ul>
              </div>
            </div>
          ) : null}

          {viewState === "ready" ? (
            <>
              <div className="max-h-64 overflow-auto rounded border border-slate-200">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-2 py-1 font-medium">RM Item</th>
                      <th className="px-2 py-1 text-right font-medium">Standard Consumption</th>
                      <th className="px-2 py-1 text-right font-medium">Actual Used</th>
                      <th className="px-2 py-1 text-right font-medium">Consumption Difference</th>
                      <th className="px-2 py-1 text-right font-medium">Available</th>
                      <th className="px-2 py-1 font-medium">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((ln) => {
                      const actual = parseQty(ln.actualQty) ?? 0;
                      const variance = actual - ln.standardQty;
                      const variancePct =
                        ln.standardQty > 1e-6 ? (variance / ln.standardQty) * 100 : null;
                      const overWarn =
                        ln.standardQty > 0 && actual > ln.standardQty * (1 + warnPct / 100) + 1e-6;
                      const underStd = variance < -1e-6;
                      const overAvailable =
                        actual > ln.availableAtProduction + 1e-6;
                      const shortageCheck = overAvailable
                        ? assessRmConsumptionShortage(ln.availableAtProduction, actual)
                        : null;
                      return (
                        <tr key={ln.itemId} className="border-t border-slate-100 align-top">
                          <td className="px-2 py-1">{ln.itemName}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-700">
                            {fmtQty(ln.standardQty, ln.unit)}
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              type="number"
                              step="any"
                              min={0}
                              value={ln.actualQty}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((r) =>
                                    r.itemId === ln.itemId ? { ...r, actualQty: e.target.value } : r,
                                  ),
                                )
                              }
                              className="h-7 w-24 text-right text-[11px] tabular-nums"
                            />
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1 text-right tabular-nums",
                              overWarn && "font-medium text-amber-800",
                              underStd && !overWarn && "text-slate-600",
                              !overWarn && !underStd && variance > 1e-6 && "text-amber-900",
                            )}
                          >
                            {variance > 1e-6 ? "+" : ""}
                            {fmtQty(variance, ln.unit)}
                            {variancePct != null && Math.abs(variancePct) > 0.05 ? (
                              <span className="block text-[10px]">
                                {variancePct > 0 ? "+" : ""}
                                {variancePct.toFixed(1)}%
                                {overWarn ? " · Extra Usage" : ""}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                            {fmtQty(ln.availableAtProduction, ln.unit)}
                            {shortageCheck?.withinTolerance ? (
                              <span className="mt-0.5 block text-[10px] font-medium text-amber-800">
                                {roundingToleranceMessage(shortageCheck.shortage, ln.unit)}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              value={ln.remarks}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((r) =>
                                    r.itemId === ln.itemId ? { ...r, remarks: e.target.value } : r,
                                  ),
                                )
                              }
                              className="h-7 min-w-[6rem] text-[11px]"
                              placeholder="Optional"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {toleranceWarnings.length ? (
                <div
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950"
                  role="status"
                >
                  {toleranceWarnings.map((msg) => (
                    <p key={msg}>{msg}</p>
                  ))}
                </div>
              ) : null}
              {error ? <ModalErrorBanner title="Cannot approve" detail={error} /> : null}
              <p className="text-[10px] text-slate-500">
                Consumption above standard by more than {warnPct}% is flagged as Extra Usage; approval is still
                allowed when stock is sufficient. Shortages up to {roundingToleranceKg} Kg per RM line are allowed
                for rounding drift at production approval.
              </p>
            </>
          ) : null}

          <div className="mt-auto flex justify-end gap-2 border-t border-slate-100 pt-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              {viewState === "error" || viewState === "empty" || viewState === "skipped" ? "Close" : "Cancel"}
            </Button>
            {viewState === "ready" ? (
              <Button
                type="button"
                size="sm"
                onClick={() => void onApprove()}
                disabled={!canSubmitApprove}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                    Approving…
                  </>
                ) : (
                  "Approve Production"
                )}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </ErpModal>
  );

  if (typeof document === "undefined") return overlay;
  return createPortal(overlay, document.body);
}
