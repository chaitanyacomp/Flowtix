import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Shared ERP report chrome primitives. Use across `/reports/*` and report-style
 * workspace pages (Customer Return, Customer Tracking, Sales Bills, etc.) so
 * every report screen shares the same design language: same toolbar density,
 * same KPI strip, same empty state, same table container behaviour.
 *
 * UI-only — no business logic, calculations, or permissions live here.
 *
 * Recommended page structure:
 *
 *   <PageContainer>
 *     <ReportPageHeader title="…" purpose="…" />
 *     <ReportFilterToolbar onApply={…} onReset={…}>
 *       <ReportFilterField label="Customer">…</ReportFilterField>
 *       …
 *     </ReportFilterToolbar>
 *     <ReportKpiStrip items={[…]} />
 *     <ReportTableShell>
 *       <table className="erp-table">…</table>
 *     </ReportTableShell>
 *     {empty ? <ReportEmptyState title="No results" body="Adjust filters and reapply." /> : null}
 *   </PageContainer>
 */

/* --------------------------------- toolbar -------------------------------- */

/**
 * Unified ERP report filter toolbar.
 *
 * Renders as a responsive grid (`.erp-filter-grid`) — 1 column on mobile, 2 on
 * tablet, 4 on desktop — so every report shares the same alignment rhythm.
 * Fields wrap gracefully to the next aligned row; widths never overflow.
 *
 * Apply / Reset / extras live in a dedicated full-width actions row at the
 * bottom of the grid so the column rhythm above stays intact.
 */
export function ReportFilterToolbar({
  children,
  onApply,
  onReset,
  applyLabel = "Apply",
  resetLabel = "Reset",
  applyDisabled,
  applyBusy,
  extras,
  leftExtras,
  className,
  containerRef,
}: {
  children?: React.ReactNode;
  onApply?: () => void;
  onReset?: () => void;
  applyLabel?: string;
  resetLabel?: string;
  applyDisabled?: boolean;
  applyBusy?: boolean;
  /** Right-aligned extras inside the actions row (e.g. toggles, secondary buttons). */
  extras?: React.ReactNode;
  /** Left-aligned extras inside the actions row (e.g. result counts, toggles). */
  leftExtras?: React.ReactNode;
  className?: string;
  containerRef?: React.Ref<HTMLDivElement>;
}) {
  const hasActions = Boolean(onApply || onReset || extras || leftExtras);
  return (
    <div ref={containerRef} className={cn("erp-filter-grid", className)}>
      {children}
      {hasActions ? (
        <div className="erp-filter-actions">
          {leftExtras ? <div className="erp-filter-actions-grow">{leftExtras}</div> : null}
          {extras}
          {onReset ? (
            <button type="button" className="erp-soft-action" onClick={onReset} disabled={applyBusy}>
              {resetLabel}
            </button>
          ) : null}
          {onApply ? (
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-md bg-blue-600 px-3 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onApply}
              disabled={applyDisabled || applyBusy}
              aria-busy={applyBusy || undefined}
            >
              {applyBusy ? "Loading…" : applyLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Labelled control inside a `<ReportFilterToolbar>`. Optionally spans
 * 2 columns (e.g. a wide search field) or the full row. */
export function ReportFilterField({
  label,
  children,
  className,
  hideLabel,
  span,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  /** Use for search fields where the placeholder already describes the input. */
  hideLabel?: boolean;
  /** Grid column span — 1 (default), 2 (wider), or "full" (entire row). */
  span?: 1 | 2 | "full";
}) {
  const spanClass =
    span === "full" ? "erp-filter-span-full" : span === 2 ? "erp-filter-span-2" : null;
  return (
    <label className={cn("erp-filter-field", spanClass, className)}>
      <span className={cn(hideLabel ? "sr-only" : null)}>{label}</span>
      {children}
    </label>
  );
}

/** @deprecated — use `<ReportFilterField span={2}>` or `span="full"` instead. */
export function ReportFilterGrow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ReportFilterField label={label} hideLabel span={2} className={className}>
      {children}
    </ReportFilterField>
  );
}

/* --------------------------------- KPI strip ------------------------------ */

export type ReportKpiItem = {
  /** Stable key (also used by tests). */
  key: string;
  label: string;
  value: React.ReactNode;
  /** Optional short context (e.g. "for current filters"). */
  hint?: React.ReactNode;
  tone?: "default" | "info" | "success" | "warning" | "danger";
  /** Test id forwarded to the value node. */
  testId?: string;
};

const KPI_TONE_CLASS: Record<NonNullable<ReportKpiItem["tone"]>, string> = {
  default: "border-slate-200 bg-white",
  info: "border-sky-200 bg-sky-50/70",
  success: "border-emerald-200 bg-emerald-50/70",
  warning: "border-amber-200 bg-amber-50/70",
  danger: "border-red-200 bg-red-50/70",
};

/**
 * Compact KPI strip — small cards in a single row (or wrap on tablet). Replaces
 * dashboard-style oversized panels at the top of audit / matching reports.
 */
export function ReportKpiStrip({
  items,
  className,
}: {
  items: ReportKpiItem[];
  className?: string;
}) {
  if (!items.length) return null;
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5", className)}>
      {items.map((it) => (
        <div
          key={it.key}
          className={cn(
            "rounded-md border px-2.5 py-1.5 shadow-sm",
            KPI_TONE_CLASS[it.tone ?? "default"],
          )}
        >
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500">
            {it.label}
          </div>
          <div
            className="mt-0.5 text-base font-semibold tabular-nums leading-tight text-slate-900"
            data-testid={it.testId}
          >
            {it.value}
          </div>
          {it.hint ? (
            <div className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{it.hint}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- table shell ---------------------------- */

/**
 * Consistent scrollable table container — adds a visible right-edge fade hint
 * when horizontal scrolling is needed, so operators know they can scroll.
 */
export function ReportTableShell({
  children,
  className,
  ariaBusy,
  minWidth,
}: {
  children: React.ReactNode;
  className?: string;
  ariaBusy?: boolean;
  /** Pixel value forwarded as `min-width` on the inner wrapper, e.g. 960. */
  minWidth?: number;
}) {
  return (
    <div
      className={cn(
        "erp-table-wrap relative overflow-x-auto",
        ariaBusy ? "opacity-60" : null,
        className,
      )}
      aria-busy={ariaBusy || undefined}
    >
      <div style={minWidth ? { minWidth: `${minWidth}px` } : undefined}>{children}</div>
    </div>
  );
}

/* --------------------------------- empty state ---------------------------- */

/**
 * Compact centered empty state for reports — no more giant blank rectangles.
 * Use inside (or in place of) `ReportTableShell` when results are empty.
 */
export function ReportEmptyState({
  title,
  body,
  icon,
  action,
  className,
}: {
  title: string;
  body?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center",
        className,
      )}
      role="status"
    >
      {icon ? (
        <span className="mb-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
          {icon}
        </span>
      ) : null}
      <div className="text-[13px] font-semibold text-slate-800">{title}</div>
      {body ? <div className="max-w-md text-[12px] leading-snug text-slate-600">{body}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
