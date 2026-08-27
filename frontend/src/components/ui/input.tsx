import * as React from "react";
import { cn } from "../../lib/utils";
import { ErpDateInput } from "./ErpDateInput";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Optional external validation message when type="date" (ErpDateInput). */
  dateError?: string | null;
  /** When type="date", control whether ErpDateInput renders its inline error. Default true. */
  showInlineError?: boolean;
  onDateValidityChange?: (valid: boolean) => void;
  dateErrorTestId?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      dateError,
      showInlineError,
      onDateValidityChange,
      dateErrorTestId,
      onChange,
      value,
      min,
      max,
      ...props
    },
    ref,
  ) => {
    if (type === "date") {
      const restProps = props as Record<string, unknown>;
      return (
        <ErpDateInput
          ref={ref}
          className={className}
          value={value == null ? "" : String(value)}
          min={min == null ? null : String(min)}
          max={max == null ? null : String(max)}
          error={dateError}
          showInlineError={showInlineError}
          errorTestId={dateErrorTestId}
          onValidityChange={onDateValidityChange}
          disabled={props.disabled}
          id={props.id}
          name={props.name}
          required={props.required}
          readOnly={props.readOnly}
          autoFocus={props.autoFocus}
          tabIndex={props.tabIndex}
          aria-label={props["aria-label"]}
          aria-invalid={props["aria-invalid"]}
          aria-describedby={props["aria-describedby"]}
          aria-disabled={props["aria-disabled"]}
          data-testid={restProps["data-testid"] as string | undefined}
          data-invalid={restProps["data-invalid"] as string | undefined}
          data-next-field={restProps["data-next-field"] as string | undefined}
          onClick={props.onClick}
          onKeyDown={props.onKeyDown}
          onChange={(ymd) => {
            if (!onChange) return;
            const synthetic = {
              target: { value: ymd },
              currentTarget: { value: ymd },
            } as React.ChangeEvent<HTMLInputElement>;
            onChange(synthetic);
          }}
          onBlur={props.onBlur}
        />
      );
    }

    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
