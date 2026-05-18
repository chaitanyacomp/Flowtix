import * as React from "react";
import { cn } from "../../../lib/utils";
import { erpKpi } from "../../../lib/erpFoundationTokens";

type ErpKpiStripProps = {
  children: React.ReactNode;
  className?: string;
  /** Passed to the outer strip (`role="toolbar"` for dashboard metrics). */
  role?: React.AriaRole;
  "aria-label"?: string;
};

/**
 * Standard horizontal KPI strip — compact, aligned numerics, shared with Dashboard.
 */
export function ErpKpiStrip({ children, className, role, "aria-label": ariaLabel }: ErpKpiStripProps) {
  return (
    <div className={cn(erpKpi.strip, className)} role={role} aria-label={ariaLabel}>
      {children}
    </div>
  );
}

type ErpKpiSegmentProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  as?: "button" | "div";
};

/**
 * One KPI cell: label + value column. Default `as="button"` preserves existing
 * dashboard deep-link behaviour when used with `onClick` / navigation handlers.
 */
export function ErpKpiSegment({ as = "button", className, children, type, ...rest }: ErpKpiSegmentProps) {
  const cls = cn(erpKpi.segment, className);
  if (as === "div") {
    return (
      <div className={cls} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>
        {children}
      </div>
    );
  }
  return (
    <button type={type ?? "button"} className={cls} {...rest}>
      {children}
    </button>
  );
}

export function ErpKpiLabel({ className, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(erpKpi.label, className)} {...rest} />;
}

export function ErpKpiValue({
  className,
  tone = "default",
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "default" | "muted" | "warn" | "crit";
}) {
  const toneClass =
    tone === "muted" ? erpKpi.valueMuted : tone === "warn" ? erpKpi.valueWarn : tone === "crit" ? erpKpi.valueCrit : "";
  return <span className={cn(erpKpi.value, toneClass, className)} {...rest} />;
}
