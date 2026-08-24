import * as React from "react";
import { ErpModal } from "../ErpModal";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { cn } from "../../../lib/utils";
import { ApiRequestError } from "../../../services/api";
import {
  emptyConfirmStartSelection,
  isConfirmStartSelectionComplete,
  reduceConfirmStartSelection,
  type ConfirmStartSelectionState,
} from "../../../lib/confirmProductionStartSelection";
import {
  MATERIAL_CONDITIONS,
  SETUP_CONDITIONS,
  CONFIRM_START_MODAL_TITLE,
  MATERIAL_REQUIRED_LABEL,
  MATERIAL_QUESTION,
  MOULD_QUESTION,
  MACHINE_MATERIAL_NOT_RECORDED_NOTE,
  CONFIRM_START_LAYOUT,
  canEnableConfirmStart,
  confirmProductionRunStartApi,
  fetchProductionRunStartPreview,
  formatReadableMaterialProfileLabel,
  operatorMessageFromConfirmError,
  parseActualPurgeQtyDraft,
  suggestPurgeFromActualCondition,
  formatStartConfirmSuccessSummary,
  type MaterialCondition,
  type ProductionRunStartConfirmation,
  type ProductionRunStartPreview,
  type SetupCondition,
} from "../../../lib/productionRunStartConfirmation";

type Props = {
  open: boolean;
  runAllocationId: number | null;
  canConfirm: boolean;
  onClose: () => void;
  onConfirmed?: (confirmation: ProductionRunStartConfirmation) => void;
};

function fmtG(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${Math.round(v * 1000) / 1000} g`;
}

/**
 * Confirm Production Start — shop-floor machine check before first entry.
 *
 * Selection bugs addressed:
 * - No autofocus on first option (looked pre-selected).
 * - Radios not disabled by !canConfirm (only Confirm button is role-gated).
 * - Local selection owned by reducer; PREVIEW_LOADED without confirmation never resets choices.
 * - Native radio inputs + full-card labels for reliable click/keyboard.
 * - Material and mould groups are independent (separate name=).
 */
export function ConfirmProductionStartModal({
  open,
  runAllocationId,
  canConfirm,
  onClose,
  onConfirmed,
}: Props) {
  const [preview, setPreview] = React.useState<ProductionRunStartPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<ConfirmStartSelectionState>(() =>
    emptyConfirmStartSelection(),
  );
  const idemRef = React.useRef(`start-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const sessionKeyRef = React.useRef<string>("");

  const { materialCondition: condition, setupCondition: setup, actualPurgeRequired, purgeQtyDraft, overrideReason } =
    selection;

  const suggestion = suggestPurgeFromActualCondition(condition);
  const isOverride =
    actualPurgeRequired != null &&
    suggestion.suggestedPurgingRequired != null &&
    actualPurgeRequired !== suggestion.suggestedPurgingRequired;

  const standardPurgeQtyGrams =
    preview?.bom?.standardPurgingQtyGrams ?? preview?.planned.plannedPurgeQtyGrams ?? 0;

  React.useEffect(() => {
    if (!open || !(runAllocationId && runAllocationId > 0)) {
      setPreview(null);
      setError(null);
      return;
    }
    const sessionKey = `${runAllocationId}:${open ? "1" : "0"}`;
    const isNewSession = sessionKeyRef.current !== sessionKey;
    sessionKeyRef.current = sessionKey;

    let cancelled = false;
    setLoading(true);
    setError(null);
    if (isNewSession) {
      setSelection(reduceConfirmStartSelection(emptyConfirmStartSelection(), { type: "RESET_SESSION" }));
      idemRef.current = `start-${runAllocationId}-${Date.now()}`;
    }
    (async () => {
      try {
        const p = await fetchProductionRunStartPreview(runAllocationId);
        if (cancelled) return;
        setPreview(p);
        // Only hydrate from an existing confirmation — never wipe in-progress local choices.
        setSelection((prev) =>
          reduceConfirmStartSelection(prev, { type: "PREVIEW_LOADED", confirmation: p.confirmation }),
        );
      } catch (e) {
        if (cancelled) return;
        setError(operatorMessageFromConfirmError(e, "Failed to load start preview."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, runAllocationId]);

  const plannedG = preview?.planned.plannedPurgeQtyGrams ?? 0;
  const parsedQty =
    actualPurgeRequired == null
      ? ({ ok: false as const, message: "Select material first." } as const)
      : parseActualPurgeQtyDraft(purgeQtyDraft, actualPurgeRequired);

  const varianceG = parsedQty.ok ? Math.round((parsedQty.value - plannedG) * 1000) / 1000 : null;

  /** Already-confirmed runs are read-only; role only gates the Confirm action. */
  const choicesLocked = Boolean(preview?.confirmation) || submitting;
  const selectionComplete = isConfirmStartSelectionComplete(selection);
  const canSubmit =
    canConfirm &&
    canEnableConfirmStart({
      materialCondition: condition,
      setupCondition: setup,
      actualPurgeRequired,
      purgeQtyOk: parsedQty.ok,
      overrideReasonOk: !isOverride || Boolean(overrideReason.trim()),
      readOnly: Boolean(preview?.confirmation),
      submitting,
    }) &&
    selectionComplete;

  const targetMaterialLabel =
    preview?.planned.targetProfileLabel ||
    formatReadableMaterialProfileLabel(preview?.planned.targetProfileComponents);

  const successSummary =
    preview?.confirmation != null
      ? formatStartConfirmSuccessSummary({
          actualPurgingRequired: preview.confirmation.actualPurgingRequired,
          actualPurgeQtyGrams: preview.confirmation.actualPurgeQtyGrams,
          purgeVarianceGrams: preview.confirmation.purgeVarianceGrams,
          runSequence: preview.runSequence,
        })
      : null;

  const handleConfirm = async () => {
    if (!canSubmit || !runAllocationId || !preview || !condition || !setup || actualPurgeRequired == null) {
      return;
    }
    if (isOverride && !overrideReason.trim()) {
      setError("Override reason is required when changing the suggested purge decision.");
      return;
    }
    if (!parsedQty.ok) {
      setError(parsedQty.message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await confirmProductionRunStartApi(runAllocationId, {
        actualMaterialCondition: condition,
        actualSetupCondition: setup,
        actualPurgingRequired: actualPurgeRequired,
        purgeOverrideReason: isOverride ? overrideReason.trim() : null,
        actualPurgeQtyGrams: parsedQty.value,
        expectedMachineStateVersion: preview.machineState.version,
        idempotencyKey: idemRef.current,
      });
      setPreview((prev) => (prev ? { ...prev, confirmation: result.confirmation } : prev));
      onConfirmed?.(result.confirmation);
    } catch (e) {
      setError(
        operatorMessageFromConfirmError(
          e instanceof ApiRequestError ? e : e,
          "Could not confirm production start. No changes were saved.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ErpModal
      open={open}
      onClose={onClose}
      closeOnBackdropClick={!submitting}
      escapeDisabled={() => submitting}
      aria-labelledby="confirm-prod-start-title"
      className="items-start justify-center pt-4 sm:pt-6"
    >
      <div
        className={cn(
          "mx-auto flex w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl",
          CONFIRM_START_LAYOUT.maxModalWidthClass,
          CONFIRM_START_LAYOUT.maxModalHeightClass,
        )}
        data-testid="confirm-production-start-modal"
        data-layout-viewport={`${CONFIRM_START_LAYOUT.viewportWidth}x${CONFIRM_START_LAYOUT.viewportHeight}`}
      >
        <div className="shrink-0 border-b border-slate-200 px-4 py-2.5">
          <h2 id="confirm-prod-start-title" className="text-base font-semibold tracking-tight text-slate-900">
            {CONFIRM_START_MODAL_TITLE}
          </h2>
        </div>

        <div className={cn(CONFIRM_START_LAYOUT.bodyScrollClass, "space-y-2.5 px-4 py-2.5 text-sm text-slate-800")}>
          {loading ? <p className="text-slate-600">Loading…</p> : null}
          {error ? (
            <p
              className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-800"
              role="alert"
              data-testid="start-confirm-error"
            >
              {error}
            </p>
          ) : null}

          {preview ? (
            <>
              <section
                className="rounded-md border border-slate-200 bg-slate-50/90 px-2.5 py-1.5 text-xs leading-snug text-slate-700"
                data-testid="start-machine-summary"
              >
                <p className="truncate">
                  <span className="font-medium text-slate-900">{preview.machine.machineCode}</span>
                  {" · "}
                  {preview.fgItem.itemName}
                  {preview.bom?.revisionLabel ? ` · ${preview.bom.revisionLabel}` : ""}
                </p>
                <p className="mt-0.5" data-testid="start-planned-material-label">
                  <span className="font-medium text-slate-800">{MATERIAL_REQUIRED_LABEL}</span>{" "}
                  <span data-testid="start-planned-profile-label">{targetMaterialLabel}</span>
                </p>
                <p className="mt-0.5 text-slate-600" data-testid="start-planning-note">
                  {MACHINE_MATERIAL_NOT_RECORDED_NOTE}
                </p>
              </section>

              {preview.confirmation && successSummary ? (
                <section
                  className="rounded-md border border-emerald-200 bg-emerald-50/80 px-2.5 py-2"
                  data-testid="start-confirm-readonly-summary"
                >
                  <p className="font-medium text-emerald-900">Start confirmed</p>
                  <p className="mt-0.5 text-emerald-900/90" data-testid="start-confirm-success-purge">
                    {successSummary.purgeLine}
                  </p>
                  {successSummary.readyLine ? (
                    <p className="mt-0.5 text-emerald-900/90" data-testid="start-confirm-success-ready">
                      {successSummary.readyLine}
                    </p>
                  ) : null}
                </section>
              ) : (
                <>
                  <RadioCardGroup
                    legend={MATERIAL_QUESTION}
                    name="start-material-condition"
                    testId="start-material-condition"
                    value={condition}
                    disabled={choicesLocked}
                    options={MATERIAL_CONDITIONS}
                    onChange={(v) =>
                      setSelection((prev) =>
                        reduceConfirmStartSelection(prev, {
                          type: "SELECT_MATERIAL",
                          value: v as MaterialCondition,
                          standardPurgeQtyGrams,
                        }),
                      )
                    }
                  />

                  <RadioCardGroup
                    legend={MOULD_QUESTION}
                    name="start-setup-condition"
                    testId="start-setup-condition"
                    value={setup}
                    disabled={choicesLocked}
                    options={SETUP_CONDITIONS}
                    onChange={(v) =>
                      setSelection((prev) =>
                        reduceConfirmStartSelection(prev, {
                          type: "SELECT_MOULD",
                          value: v as SetupCondition,
                        }),
                      )
                    }
                  />

                  {suggestion.suggestedPurgingRequired != null ? (
                    <section
                      className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-2"
                      data-testid="start-purge-decision"
                    >
                      <p className="font-medium text-amber-950" data-testid="start-purge-reason">
                        {suggestion.suggestedPurgingRequired ? "Purging required" : "Purging not required"}
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Purging
                          </label>
                          <select
                            className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                            value={actualPurgeRequired ? "yes" : "no"}
                            disabled={choicesLocked}
                            onChange={(e) =>
                              setSelection((prev) =>
                                reduceConfirmStartSelection(prev, {
                                  type: "SET_PURGE_REQUIRED",
                                  value: e.target.value === "yes",
                                  standardPurgeQtyGrams,
                                }),
                              )
                            }
                            data-testid="start-actual-purge-required"
                          >
                            <option value="yes">Required</option>
                            <option value="no">Not required</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Purging quantity (g)
                          </label>
                          <Input
                            className="mt-0.5 h-8"
                            value={purgeQtyDraft}
                            disabled={choicesLocked || !actualPurgeRequired}
                            onChange={(e) =>
                              setSelection((prev) =>
                                reduceConfirmStartSelection(prev, {
                                  type: "SET_PURGE_QTY",
                                  value: e.target.value,
                                }),
                              )
                            }
                            data-testid="start-actual-purge-qty"
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Difference from standard
                          </p>
                          <p className="mt-0.5 text-sm tabular-nums text-slate-900" data-testid="start-purge-variance">
                            {varianceG == null ? "—" : fmtG(varianceG)}
                          </p>
                        </div>
                      </div>
                      {isOverride ? (
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Override reason (required)
                          </label>
                          <Input
                            className="mt-0.5 h-8"
                            value={overrideReason}
                            disabled={choicesLocked}
                            onChange={(e) =>
                              setSelection((prev) =>
                                reduceConfirmStartSelection(prev, {
                                  type: "SET_OVERRIDE_REASON",
                                  value: e.target.value,
                                }),
                              )
                            }
                            data-testid="start-purge-override-reason"
                          />
                        </div>
                      ) : null}
                    </section>
                  ) : (
                    <p className="text-xs text-slate-600" data-testid="start-purge-await-material">
                      Select material and mould to continue.
                    </p>
                  )}
                </>
              )}
            </>
          ) : null}
        </div>

        <div
          className={cn(
            CONFIRM_START_LAYOUT.footerStickyClass,
            "flex items-center justify-end gap-2 border-slate-200 px-4 py-2.5",
          )}
          data-testid="start-confirm-footer"
        >
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {preview?.confirmation ? "Close" : "Cancel"}
          </Button>
          {!preview?.confirmation && canConfirm ? (
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={!canSubmit || loading}
              data-testid="start-confirm-submit"
            >
              {submitting ? "Confirming…" : "Confirm Start"}
            </Button>
          ) : null}
        </div>
      </div>
    </ErpModal>
  );
}

function RadioCardGroup({
  legend,
  name,
  testId,
  value,
  disabled,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  testId: string;
  value: string | null;
  disabled?: boolean;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const groupId = `${testId}-label`;
  return (
    <fieldset className="min-w-0 space-y-1" data-testid={testId} disabled={disabled}>
      <legend id={groupId} className="text-sm font-semibold text-slate-800">
        {legend}
      </legend>
      <div
        role="radiogroup"
        aria-labelledby={groupId}
        className="grid gap-1"
      >
        {options.map((opt) => {
          const selected = value === opt.value;
          const inputId = `${testId}-${opt.value}`;
          return (
            <label
              key={opt.value}
              htmlFor={inputId}
              data-testid={inputId}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
                CONFIRM_START_LAYOUT.optionTextClass,
                "focus-within:outline-none focus-within:ring-2 focus-within:ring-sky-500/40 focus-within:ring-offset-1",
                selected
                  ? "border-sky-500 bg-sky-50 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                id={inputId}
                type="radio"
                name={name}
                value={opt.value}
                checked={selected}
                disabled={disabled}
                className="h-3.5 w-3.5 shrink-0 accent-sky-600"
                onChange={() => onChange(opt.value)}
              />
              <span className="min-w-0 flex-1 font-medium leading-snug text-slate-900">{opt.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
