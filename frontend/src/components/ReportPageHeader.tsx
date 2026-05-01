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
        "sticky top-0 z-[25] mb-4 border-b border-slate-200/95 bg-slate-50/98 pb-2.5 pt-1.5 shadow-[0_1px_0_0_rgb(226_232_240)] backdrop-blur-sm supports-[backdrop-filter]:bg-slate-50/92",
        className,
      )}
    >
      {children}
    </header>
  );
}

/** Primary navigation back to the Reports hub — compact chip (same as {@link PageBackLink}). */
export function ReportBackLink({ className }: { className?: string }) {
  return (
    <Link to="/reports" className={cn("erp-back-nav-chip", className)}>
      <ArrowLeft className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span>Back to Reports</span>
    </Link>
  );
}

/**
 * Reports hub only: slim sticky strip with the back control. No title, filters, blur, or heavy shadow.
 * Title / purpose / filters stay in normal document flow below this.
 */
export function StickyReportBackStrip({ className }: { className?: string }) {
  return (
    <header
      role="navigation"
      aria-label="Back to Reports"
      className={cn("sticky top-0 z-[25] border-b border-slate-200 bg-white py-1.5", className)}
    >
      <ReportBackLink />
    </header>
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
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="text-lg font-semibold leading-snug tracking-tight text-slate-900">{title}</h2>
        {purpose ? <p className="max-w-3xl text-sm leading-relaxed text-slate-600">{purpose}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Standard report page chrome: sticky back strip only, then scrolling title / actions row.
 * Does not wrap filters, KPIs, or results in a sticky container.
 */
export function ReportPageHeader({
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
    <div className={cn("mb-4 space-y-2.5", className)}>
      <StickyReportBackStrip />
      <ReportPageTitleBlock title={title} purpose={purpose} actions={actions} />
    </div>
  );
}
