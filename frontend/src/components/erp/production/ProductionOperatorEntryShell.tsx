import * as React from "react";
import type { FocusEventHandler } from "react";
import { cn } from "../../../lib/utils";
import {
  PRODUCTION_SAVE_BUTTON_LABEL,
  formatProductionOperatorMaxHelper,
  productionOperatorDateInputClass,
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
}: {
  maxAllowedQty?: number | null;
  unit?: string | null;
  className?: string;
}) {
  const maxLabel = formatProductionOperatorMaxHelper(maxAllowedQty, unit);
  if (!maxLabel) return null;
  return (
    <p className={cn("text-[10px] leading-snug text-slate-500", className)} data-testid="production-qty-helper">
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
  prodSaveFocusBind: { onFocus: FocusEventHandler<HTMLButtonElement>; onBlur: FocusEventHandler<HTMLButtonElement> };
  onProdQtyEnter?: () => void;
  onMarkProdQtyShortcut?: () => void;
  onMarkProdSaveShortcut?: () => void;
  shortcutHints: { activeFieldId: string | null; activeFieldHintText?: string | null };
  prodDemoHl?: string;
  saveButtonTitle?: string;
  warnings?: string[];
};

/** Aligned MES entry grid — Date · Qty · actions on shared baseline. */
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
    <div className="space-y-1.5">
      <div className={PRODUCTION_OPERATOR_ENTRY_GRID}>
        <label className="col-start-1 row-start-1 grid gap-0.5 self-end">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Date</span>
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
          className="col-start-2 row-start-1 min-w-0 self-end"
        >
          <label className="grid gap-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Produced Qty</span>
            <div className="flex items-center gap-1.5">
              <Input
                ref={producedQtyRef}
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
              {unitLabel ? <span className="shrink-0 text-[12px] font-semibold text-slate-600">{unitLabel}</span> : null}
            </div>
            <ProductionOperatorQtyHelper maxAllowedQty={maxAllowedQty} unit={unit} />
            {rmReadinessLoading ? (
              <p className="text-[10px] text-slate-500">Checking RM readiness…</p>
            ) : showRmCapHint && rmAllowedNowQty != null && !rmProductionEntryBlocked ? (
              <p className="text-[10px] text-emerald-800">RM cap: {rmAllowedNowQty}</p>
            ) : null}
            {wolId > 0 && !producedQtyValid ? (
              <p className="text-[10px] font-medium text-amber-800">Enter quantity.</p>
            ) : null}
          </label>
        </FieldShortcutHint>

        <div className="col-span-2 col-start-1 row-start-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 px-3 text-[12px]"
            disabled={useRemainingDisabled}
            onClick={onUseRemaining}
          >
            Use Remaining Qty
          </Button>
          <FieldShortcutHint
            show={shortcutHints.activeFieldId === "prodSave"}
            hint={shortcutHints.activeFieldHintText ?? ""}
            placement="above"
            className="inline-block"
          >
            <Button
              type="submit"
              size="sm"
              data-testid="save-production-btn"
              className="h-9 min-w-[9.5rem] px-5 text-[13px] font-bold shadow-md"
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

      {warnings && warnings.length > 0 ? (
        <ul className="space-y-0.5 text-[10px] font-medium text-amber-900">
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
