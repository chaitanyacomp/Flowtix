/**
 * Shared ERP decimal field — no native spinners, wheel, or arrow-key increments.
 * Use for editable Quantity and Rate (and similar decimal amounts).
 */
import * as React from "react";
import { Input, type InputProps } from "./input";
import { cn } from "../../lib/utils";
import {
  blockDecimalSpinnerKeys,
  blockDecimalWheel,
  normalizeDecimalOnBlur,
  sanitizeDecimalInput,
} from "../../lib/keyboardDecimalInput";

export type DecimalInputProps = Omit<InputProps, "type" | "inputMode" | "value" | "onChange" | "onBlur"> & {
  /** Controlled value (string preferred while editing). */
  value: string | number | null | undefined;
  /** Called with sanitized draft text (may be "" or "12."). */
  onValueChange: (next: string) => void;
  /** Normalize on blur (default true). Pass false when parent handles blur. */
  normalizeOnBlur?: boolean;
  maxFractionDigits?: number;
  /** Optional unit suffix inside the field (e.g. KG). */
  unit?: string;
  /** Extra class on the outer wrapper when unit is shown. */
  wrapperClassName?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
};

function toDisplayValue(value: string | number | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  return String(value);
}

export const DecimalInput = React.forwardRef<HTMLInputElement, DecimalInputProps>(function DecimalInput(
  {
    value,
    onValueChange,
    normalizeOnBlur = true,
    maxFractionDigits = 6,
    unit,
    wrapperClassName,
    className,
    onBlur,
    onKeyDown,
    onWheel,
    disabled,
    ...rest
  },
  ref,
) {
  const display = toDisplayValue(value);

  const input = (
    <Input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      value={display}
      className={cn(unit && "pr-8", className)}
      onChange={(event) => {
        const next = sanitizeDecimalInput(event.target.value);
        if (next == null) return;
        onValueChange(next);
      }}
      onBlur={(event) => {
        if (normalizeOnBlur && !disabled) {
          onValueChange(normalizeDecimalOnBlur(display, maxFractionDigits));
        }
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        blockDecimalSpinnerKeys(event);
        onKeyDown?.(event);
      }}
      onWheel={(event) => {
        blockDecimalWheel(event);
        (event.currentTarget as HTMLInputElement).blur();
        onWheel?.(event);
      }}
    />
  );

  if (!unit) {
    if (!wrapperClassName) return input;
    return <div className={cn("inline-flex w-full justify-end", wrapperClassName)}>{input}</div>;
  }

  return (
    <div className={cn("relative inline-flex w-full justify-end", wrapperClassName)}>
      {input}
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
        {unit}
      </span>
    </div>
  );
});

DecimalInput.displayName = "DecimalInput";
