/**
 * Sticky in-page header band for `erp-main` scroll: solid background so tables/forms do not show through.
 * Use for back link + primary page heading row on long operational pages (not for arbitrary cards).
 */
import * as React from "react";
import { useLocation } from "react-router-dom";
import { cn } from "../lib/utils";
import { isReportsReturnContext } from "../lib/drillDownRoutes";
import { ERPBackNavigation } from "./erp/foundation/ERPBackNavigation";

export function StickyPageHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        // Compact ERP density: tighter vertical padding + reduced bottom margin so operational
        // pages start their working area higher on 1366x768 laptops.
        "sticky top-0 z-[25] mb-2 border-b border-slate-200/70 bg-slate-50/95 pb-1.5 pt-1 shadow-[0_1px_0_0_rgb(226_232_240_/0.65)] backdrop-blur-sm supports-[backdrop-filter]:bg-slate-50/90",
        className,
      )}
    >
      {children}
    </header>
  );
}

/** Configurable back destination for the {@link ReportBackLink}. */
export type ReportBackTarget = { to: string; label: string };

/** Analysis reports — always return to the Reports hub (FT-PD-066 §14.2). */
export const DEFAULT_REPORT_BACK_TARGET: ReportBackTarget = {
  to: "/reports",
  label: "Back to Reports",
};

/** Dashboard-origin workspaces. */
export const DEFAULT_DASHBOARD_BACK_TARGET: ReportBackTarget = {
  to: "/dashboard",
  label: "Back to Dashboard",
};

/**
 * Resolve the single primary back target for Analysis / dual-entry report surfaces.
 * - `source|from=dashboard` → Back to Dashboard
 * - `from|source=reports` (or pure analysis with no workspace default) → Back to Reports
 * - otherwise → `workspaceDefault` when provided (module / workspace origin)
 */
export function resolveAnalysisReportBackTarget(
  search: string,
  workspaceDefault?: ReportBackTarget | null,
): ReportBackTarget {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const from = (q.get("from") ?? "").trim().toLowerCase();
  const source = (q.get("source") ?? "").trim().toLowerCase();
  if (from === "dashboard" || source === "dashboard") return DEFAULT_DASHBOARD_BACK_TARGET;
  if (isReportsReturnContext(search) || from === "reports" || source === "reports") {
    return DEFAULT_REPORT_BACK_TARGET;
  }
  if (workspaceDefault) return workspaceDefault;
  return DEFAULT_REPORT_BACK_TARGET;
}

/** Hook: one primary back control for Analysis report pages. */
export function useAnalysisReportBack(workspaceDefault?: ReportBackTarget | null): ReportBackTarget {
  const { search } = useLocation();
  return React.useMemo(
    () => resolveAnalysisReportBackTarget(search, workspaceDefault),
    // workspaceDefault is a small value object; compare by fields
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, workspaceDefault?.to, workspaceDefault?.label],
  );
}

/** Primary back-nav for report pages — uses global {@link ERPBackNavigation}. */
export function ReportBackLink({
  className,
  back,
}: {
  className?: string;
  back?: ReportBackTarget;
}) {
  const target = back ?? DEFAULT_REPORT_BACK_TARGET;
  return <ERPBackNavigation to={target.to} label={target.label} className={className} />;
}

/**
 * Inline back-nav row above the report title. Kept under the old name for
 * backward compatibility — transparent wrapper; do **not** also render
 * {@link ReportPageHeader} (which already includes this strip).
 */
export function StickyReportBackStrip({
  className,
  back,
}: {
  className?: string;
  back?: ReportBackTarget;
  /** @deprecated Ignored — use `back` or ReportPageHeader only. */
  returnTo?: string;
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
        <h2 className="erp-type-page-title">{title}</h2>
        {purpose ? <p className="erp-type-helper max-w-3xl text-slate-500">{purpose}</p> : null}
      </div>
      {actions ? <div className="erp-page-header-actions">{actions}</div> : null}
    </div>
  );
}

/**
 * Standard Analysis report chrome: **one** primary Back control, then title / actions.
 * Do not render a separate {@link StickyReportBackStrip} above this component.
 *
 * Default back is **Back to Reports**. Pass `back` for Dashboard / Module origins.
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
