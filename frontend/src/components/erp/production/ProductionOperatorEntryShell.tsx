import * as React from "react";
import type { FocusEventHandler } from "react";
import { cn } from "../../../lib/utils";
import {
  PRODUCTION_SAVE_BUTTON_LABEL,
  formatProductionOperatorMaxHelper,
  productionOperatorDateInputClass,
  productionOperatorFieldLabelClass,
  productionOperatorQtyInputClass,
} from "../../../lib/productionOperatorUx";
import { PRODUCTION_OPERATOR_ENTRY_GRID } from "../../../lib/productionOperatorWorkbenchLayout";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import { FieldShortcutHint } from "../../ui/FieldShortcutHint";

export function ProductionOperatorQtyHelper({
  maxAllowedQty,
  unit,
  className,
  labelPrefix,
}: {
  maxAllowedQty?: number | null;
  unit?: string | null;
  className?: string;
  labelPrefix?: string;
}) {
  const maxLabel = formatProductionOperatorMaxHelper(maxAllowedQty, unit, labelPrefix);
  if (!maxLabel) return null;
  return (
    <p className={cn("text-[11px] leading-snug text-slate-500", className)} data-testid="production-qty-helper">
      {maxLabel}
    </p>
  );
}

export type ProductionOperatorEntryFieldsProps = {
  prodDate: string;
  onProdDateChange: (value: string) => void;
  producedQtyRef: React.RefObject<HTMLInputElement | null>;
  prodQtyBind: Record<string, unknown>;
  producedQtyStr: string;
  prodQtyPlaceholder: string;
  unit?: string | null;
  disabled?: boolean;
  maxAllowedQty?: number | null;
  maxLabelPrefix?: string;
  producedQtyValid: boolean;
  wolId: number;
  rmReadinessLoading?: boolean;
  rmAllowedNowQty?: number | null;
  rmProductionEntryBlocked?: boolean;
  showRmCapHint?: boolean;
  posting: boolean;
  createFormCanSubmit: boolean;
  useRemainingDisabled: boolean;
  onUseRemaining: () => void;
  showUseRmSupportedMax?: boolean;
  useRmSupportedMaxDisabled?: boolean;
  onUseRmSupportedMax?: () => void;
  prodSaveFocusBind: { onFocus: FocusEventHandler<HTMLButtonElement>; onBlur: FocusEventHandler<HTMLButtonElement> };
  onProdQtyEnter?: () => void;
  onMarkProdQtyShortcut?: () => void;
  onMarkProdSaveShortcut?: () => void;
  shortcutHints: { activeFieldId: string | null; activeFieldHintText?: string | null };
  prodDemoHl?: string;
  saveButtonTitle?: string;
  warnings?: string[];
};

/** Aligned MES entry row — Date · primary Qty · actions on one baseline (FT-PD-066). */
export function ProductionOperatorEntryFields({
  prodDate,
  onProdDateChange,
  producedQtyRef,
  prodQtyBind,
  producedQtyStr,
  prodQtyPlaceholder,
  unit,
  disabled,
  maxAllowedQty,
  maxLabelPrefix,
  producedQtyValid,
  wolId,
  rmReadinessLoading,
  rmAllowedNowQty,
  rmProductionEntryBlocked,
  showRmCapHint,
  posting,
  createFormCanSubmit,
  useRemainingDisabled,
  onUseRemaining,
  showUseRmSupportedMax,
  useRmSupportedMaxDisabled,
  onUseRmSupportedMax,
  prodSaveFocusBind,
  onProdQtyEnter,
  onMarkProdQtyShortcut,
  onMarkProdSaveShortcut,
  shortcutHints,
  prodDemoHl,
  saveButtonTitle,
  warnings,
}: ProductionOperatorEntryFieldsProps) {
  const unitLabel = String(unit ?? "").trim();

  return (
    <div className="space-y-1.5" data-testid="production-operator-entry-fields">
      <div className={PRODUCTION_OPERATOR_ENTRY_GRID}>
        <label className="grid shrink-0 gap-1 self-end">
          <span className={productionOperatorFieldLabelClass}>Date</span>
          <Input
            type="date"
            className={productionOperatorDateInputClass}
            value={prodDate}
            onChange={(e) => onProdDateChange(e.target.value)}
            required
          />
        </label>

        <FieldShortcutHint
          show={shortcutHints.activeFieldId === "prodQty"}
          hint={shortcutHints.activeFieldHintText ?? ""}
          placement="below-end"
          className="min-w-[12rem] shrink-0"
        >
          <label className="grid gap-1">
            <span className={productionOperatorFieldLabelClass}>Produced Qty</span>
            <div className="flex h-12 items-center gap-2">
              <Input
                ref={producedQtyRef as React.RefObject<HTMLInputElement>}
                {...prodQtyBind}
                type="text"
                data-testid="production-qty-input"
                inputMode="decimal"
                autoComplete="off"
                className={productionOperatorQtyInputClass}
                placeholder={prodQtyPlaceholder}
                value={producedQtyStr}
                disabled={disabled}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                    onMarkProdQtyShortcut?.();
                    onProdQtyEnter?.();
                  }
                }}
              />
              {unitLabel ? (
                <span className="shrink-0 text-[14px] font-bold text-slate-700">{unitLabel}</span>
              ) : null}
            </div>
          </label>
        </FieldShortcutHint>

        <div className="flex shrink-0 flex-wrap items-end gap-2.5 self-end">
          <Button
            type="button"
            variant="outline"
            className="h-12 shrink-0 px-3 text-[13px] font-semibold"
            disabled={useRemainingDisabled}
            onClick={onUseRemaining}
            data-testid="use-remaining-qty-btn"
          >
            Use Remaining Qty
          </Button>
          {showUseRmSupportedMax ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 shrink-0 px-3 text-[13px] font-semibold"
              disabled={useRmSupportedMaxDisabled}
              onClick={onUseRmSupportedMax}
              data-testid="use-rm-supported-max-btn"
            >
              Use RM-Supported Max
            </Button>
          ) : null}

          <FieldShortcutHint
            show={shortcutHints.activeFieldId === "prodSave"}
            hint={shortcutHints.activeFieldHintText ?? ""}
            placement="above"
            className="shrink-0"
          >
            <Button
              type="submit"
              data-testid="save-production-btn"
              className="h-12 min-w-[10.5rem] shrink-0 px-6 text-[14px] font-bold shadow-md"
              title={saveButtonTitle}
              onFocus={prodSaveFocusBind.onFocus}
              onBlur={prodSaveFocusBind.onBlur}
              onClick={() => onMarkProdSaveShortcut?.()}
              disabled={posting || !createFormCanSubmit}
              {...(prodDemoHl ? { "data-demo-highlight": prodDemoHl } : {})}
            >
              {posting ? "Saving…" : PRODUCTION_SAVE_BUTTON_LABEL}
            </Button>
          </FieldShortcutHint>
        </div>
      </div>

      <div className="space-y-0.5">
        <ProductionOperatorQtyHelper maxAllowedQty={maxAllowedQty} unit={unit} labelPrefix={maxLabelPrefix} />
        {rmReadinessLoading ? (
          <p className="text-[11px] text-slate-500">Checking RM readiness…</p>
        ) : showRmCapHint && rmAllowedNowQty != null && !rmProductionEntryBlocked ? (
          <p className="text-[11px] text-emerald-800">RM cap: {rmAllowedNowQty}</p>
        ) : null}
        {wolId > 0 && !producedQtyValid ? (
          <p className="text-[11px] font-medium text-amber-800">Enter quantity.</p>
        ) : null}
      </div>

      {warnings && warnings.length > 0 ? (
        <ul className="space-y-0.5 text-[11px] font-medium text-amber-900">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** @deprecated Use ProductionOperatorWorkbench shell — kept for non-workbench fallbacks. */
export function ProductionOperatorEntryShell({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0", className)} data-testid="production-operator-entry-shell">
      {children}
    </section>
  );
}

