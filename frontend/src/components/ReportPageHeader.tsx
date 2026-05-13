import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Sticky in-page header band for `erp-main` scroll: solid background so tables/forms do not show through.
 * Use for back link + primary page heading row on long operational pages (not for arbitrary cards).
 */
export function StickyPageHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        // Compact ERP density: tighter vertical padding + reduced bottom margin so operational
        // pages start their working area higher on 1366x768 laptops.
        "sticky top-0 z-[25] mb-2.5 border-b border-slate-200/95 bg-slate-50/98 pb-1.5 pt-1 shadow-[0_1px_0_0_rgb(226_232_240)] backdrop-blur-sm supports-[backdrop-filter]:bg-slate-50/92",
        className,
      )}
    >
      {children}
    </header>
  );
}

/** Configurable back destination for the {@link ReportBackLink}. `to` is the
 * route, `label` is the displayed text. Useful when a report page is opened
 * from a non-Reports context (e.g. Dashboard) — pass `{ to: "/dashboard",
 * label: "Back to Dashboard" }`. */
export type ReportBackTarget = { to: string; label: string };

/** Default back target — Reports hub. */
export const DEFAULT_REPORT_BACK_TARGET: ReportBackTarget = {
  to: "/reports",
  label: "Back to Reports",
};

/** Primary back-nav for report pages — subtle inline text link with arrow icon.
 * No background, border, or shadow; reads as a muted breadcrumb. Destination
 * defaults to the Reports hub but can be overridden via {@link back}. */
export function ReportBackLink({
  className,
  back,
}: {
  className?: string;
  back?: ReportBackTarget;
}) {
  const target = back ?? DEFAULT_REPORT_BACK_TARGET;
  return (
    <Link to={target.to} className={cn("erp-report-back-link", className)}>
      <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{target.label}</span>
    </Link>
  );
}

/**
 * Inline back-nav row above the report title. Kept under the old name for
 * backward compatibility with existing report pages — but no longer renders a
 * white sticky strip, border, or shadow. It is now a transparent wrapper with
 * the same horizontal gutter as the title and filter toolbar.
 */
export function StickyReportBackStrip({
  className,
  back,
}: {
  className?: string;
  back?: ReportBackTarget;
}) {
  const target = back ?? DEFAULT_REPORT_BACK_TARGET;
  return (
    <div role="navigation" aria-label={target.label} className={cn("min-w-0", className)}>
      <ReportBackLink back={back} />
    </div>
  );
}

/** Non-sticky report title row (use below {@link StickyReportBackStrip}). */
export function ReportPageTitleBlock({
  title,
  purpose,
  actions,
  className,
}: {
  title: string;
  purpose?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2", className)}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <h2 className="text-base font-semibold leading-snug tracking-tight text-slate-900">{title}</h2>
        {purpose ? <p className="max-w-3xl text-[12px] leading-relaxed text-slate-600">{purpose}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Standard report page chrome: sticky back strip only, then scrolling title / actions row.
 * Does not wrap filters, KPIs, or results in a sticky container.
 *
 * Pass `back={{ to, label }}` to customize the breadcrumb destination — useful
 * when the page is opened from a non-Reports context (e.g. `?source=dashboard`).
 */
export function ReportPageHeader({
  title,
  purpose,
  actions,
  className,
  back,
}: {
  title: string;
  purpose?: string;
  actions?: React.ReactNode;
  className?: string;
  back?: ReportBackTarget;
}) {
  return (
    <div className={cn("erp-report-page report-page mb-2.5 space-y-1.5", className)}>
      <StickyReportBackStrip back={back} />
      <ReportPageTitleBlock title={title} purpose={purpose} actions={actions} />
    </div>
  );
}
