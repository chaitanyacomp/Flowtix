/**
 * Shared ERP date-only input.
 * Value / onChange use YYYY-MM-DD (API). Operator errors use DD-MM-YYYY wording only.
 * Default calendar window: 1900-01-01 … 2100-12-31 (override with min/max).
 */
import * as React from "react";
import { cn } from "../../lib/utils";
import {
  ERP_DATE_INVALID_MESSAGE,
  ERP_DATE_MAX_YMD,
  ERP_DATE_MIN_YMD,
  isStrictCalendarYmd,
  isYmdInInclusiveRange,
  sanitizeNativeDateInputValue,
} from "../../lib/erpDate";

export type ErpDateInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "min" | "max"
> & {
  value?: string | null;
  onChange?: (value: string) => void;
  /** Inclusive minimum YYYY-MM-DD (defaults to ERP global min). */
  min?: string | null;
  /** Inclusive maximum YYYY-MM-DD (defaults to ERP global max). */
  max?: string | null;
  /** External field error (e.g. screen policy). Overrides generic invalid message when set. */
  error?: string | null;
  /** When false, still validates but does not render the inline error node. */
  showInlineError?: boolean;
  onValidityChange?: (valid: boolean) => void;
  /** Optional test id for the inline error element. */
  errorTestId?: string;
};

export const ErpDateInput = React.forwardRef<HTMLInputElement, ErpDateInputProps>(
  function ErpDateInput(
    {
      value,
      onChange,
      min,
      max,
      error = null,
      showInlineError = true,
      onValidityChange,
      errorTestId = "erp-date-input-error",
      className,
      disabled,
      id,
      onBlur,
      ...rest
    },
    ref,
  ) {
    const resolvedMin = min && isStrictCalendarYmd(min) ? min : ERP_DATE_MIN_YMD;
    const resolvedMax = max && isStrictCalendarYmd(max) ? max : ERP_DATE_MAX_YMD;
    const [localInvalid, setLocalInvalid] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    const displayValue = value ?? "";

    function reportValidity(nextYmd: string, blankOk: boolean): boolean {
      if (!nextYmd) {
        const ok = blankOk;
        setLocalInvalid(!ok && Boolean(rest.required));
        onValidityChange?.(ok || !rest.required);
        return ok || !rest.required;
      }
      const ok = isYmdInInclusiveRange(nextYmd, resolvedMin, resolvedMax);
      setLocalInvalid(!ok);
      onValidityChange?.(ok);
      return ok;
    }

    function applySanitized(raw: string) {
      const cleaned = sanitizeNativeDateInputValue(raw);
      if (cleaned !== raw && inputRef.current) {
        inputRef.current.value = cleaned;
      }
      // Only propagate complete strict dates (or clear).
      if (!cleaned) {
        setLocalInvalid(false);
        onValidityChange?.(true);
        onChange?.("");
        return;
      }
      if (cleaned.length < 10) {
        // Partial while typing — do not mark invalid yet; don't push incomplete to parent.
        return;
      }
      const ok = reportValidity(cleaned, !rest.required);
      if (ok) {
        onChange?.(cleaned);
        return;
      }
      // Block illegal values from parent state (controlled input snaps back).
      if (inputRef.current) inputRef.current.value = displayValue;
    }

    const message = error?.trim() || (localInvalid ? ERP_DATE_INVALID_MESSAGE : null);
    const showError = Boolean(showInlineError && message);

    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <input
          {...rest}
          ref={inputRef}
          id={id}
          type="date"
          disabled={disabled}
          className={cn(
            "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            (showError || localInvalid) && "border-red-500 focus-visible:ring-red-300",
            className,
          )}
          value={displayValue}
          min={resolvedMin}
          max={resolvedMax}
          aria-invalid={showError || localInvalid ? true : undefined}
          aria-describedby={showError && id ? `${id}-date-error` : undefined}
          onInput={(e) => {
            const el = e.currentTarget;
            const cleaned = sanitizeNativeDateInputValue(el.value);
            if (cleaned !== el.value) el.value = cleaned;
          }}
          onChange={(e) => applySanitized(e.target.value)}
          onBlur={(e) => {
            const cleaned = sanitizeNativeDateInputValue(e.target.value);
            if (cleaned && cleaned.length === 10) {
              reportValidity(cleaned, !rest.required);
            } else if (cleaned) {
              setLocalInvalid(true);
              onValidityChange?.(false);
            }
            onBlur?.(e);
          }}
          data-erp-date-input="true"
        />
        {showError ? (
          <p
            id={id ? `${id}-date-error` : undefined}
            className="text-[11px] font-medium leading-snug text-red-700"
            role="alert"
            data-testid={errorTestId}
          >
            {message}
          </p>
        ) : null}
      </div>
    );
  },
);
