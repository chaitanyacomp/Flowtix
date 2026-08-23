import * as React from "react";
import { useLocation } from "react-router-dom";
import { cn } from "../lib/utils";
import { ReportBackLink, StickyPageHeader } from "./ReportPageHeader";
import { apiFetch } from "../services/api";
import { isReportsReturnContext } from "../lib/drillDownRoutes";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { useCanOpenRequirementSheet } from "../hooks/useIsAdmin";
import { useAuth } from "../hooks/useAuth";
import { ERPBackNavigation } from "./erp/foundation/ERPBackNavigation";
import { ERP_COMMERCIAL_ORIGIN_SESSION_KEY, noQtySoBackTarget } from "../lib/erpBackNavigation";

export { ERPBackNavigation } from "./erp/foundation/ERPBackNavigation";

/** Row below the shell title bar: primary actions (e.g. Add), right-aligned. */
export function PageActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-3 flex flex-wrap justify-end gap-2", className)}>{children}</div>;
}

/**
 * Standard ERP page wrapper.
 *
 * **Default**: full operational workspace width — aligns to the same invisible
 * vertical grid as every other page rendered inside `.erp-main`. This is the
 * correct choice for list, dashboard, report, and split-panel screens (SAP
 * Business One / ERPNext convention).
 *
 * **`narrow`**: opt-in narrow column (max-w-5xl, centered). Use for
 * content-light data-entry forms (Bill entry, Settings, Account, login-style
 * flows) where a wide form would feel sprawling.
 *
 * Vertical rhythm is `space-y-3` to match the system-wide density pass; pages
 * that need more breathing room pass `className="space-y-4"` explicitly.
 *
 * The horizontal gutter is owned by `.erp-main` in `AppLayout` so every page
 * (with or without PageContainer) shares the same left/right padding — this is
 * what unifies the layout grid across the application.
 */
export function PageContainer({
  children,
  className,
  narrow = false,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  narrow?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "erp-page-shell page-shell w-full min-w-0 space-y-3 overflow-x-hidden",
        narrow ? "mx-auto max-w-5xl" : null,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** @deprecated Use ERPBackNavigation — kept for gradual migration. */
export function PageBackLink({
  to,
  label = "Back",
  className,
}: {
  to: string;
  label?: string;
  className?: string;
}) {
  const text = (label ?? "Back").replace(/^\s*←\s*/, "").trim() || "Back";
  return <ERPBackNavigation to={to} label={text} className={className} />;
}

/**
 * Sticky band for back + primary page heading row (inside `erp-main` scroll).
 * Keeps navigation visible without duplicating sticky CSS on each screen.
 *
 * Compact ERP density: vertical gap tightened from `space-y-2.5` to `space-y-1.5`
 * so the back-chip and PageHeader sit closer to the top edge.
 */
export function StickyWorkspaceHead({
  lead,
  children,
  className,
}: {
  lead?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <StickyPageHeader className={cn("space-y-1.5", className)}>
      {lead}
      {children}
    </StickyPageHeader>
  );
}

type SmartBackKind = "reports" | "dashboard" | "production" | "generic";

/** @deprecated Prefer ERPBackNavigation directly. */
export function PageSmartBackLink({
  kind = "generic",
  className,
  fallbackTo,
  defaultTo,
  defaultLabel,
  workflowSessionFallback = false,
}: {
  kind?: SmartBackKind;
  className?: string;
  fallbackTo?: string;
  defaultTo?: string;
  defaultLabel?: string;
  workflowSessionFallback?: boolean;
}) {
  const location = useLocation();
  if (kind === "reports" || isReportsReturnContext(location.search)) {
    return <ReportBackLink className={className} />;
  }
  return (
    <ERPBackNavigation
      kind={kind}
      className={className}
      defaultTo={defaultTo ?? fallbackTo ?? "/dashboard"}
      defaultLabel={defaultLabel ?? "Back to Dashboard"}
      workflowSessionFallback={workflowSessionFallback}
    />
  );
}

/** Re-export for CommercialWorkflowOriginTrace consumers. */
export { ERP_COMMERCIAL_ORIGIN_SESSION_KEY };

/**
 * Records the last Enquiries / Quotations screen in sessionStorage so Sales Orders can offer a workflow-aware back target
 * when the URL has no `?from=` (see `PageSmartBackLink` + `workflowSessionFallback`).
 * Cleared when visiting the dashboard home (standalone entry).
 */
export function CommercialWorkflowOriginTrace() {
  const location = useLocation();
  React.useEffect(() => {
    const p = location.pathname;
    try {
      if (p === "/quotations" || p.startsWith("/quotations/")) {
        sessionStorage.setItem(ERP_COMMERCIAL_ORIGIN_SESSION_KEY, "quotations");
      } else if (p === "/enquiries" || p.startsWith("/enquiries/")) {
        sessionStorage.setItem(ERP_COMMERCIAL_ORIGIN_SESSION_KEY, "enquiries");
      } else if (p === "/dashboard") {
        sessionStorage.removeItem(ERP_COMMERCIAL_ORIGIN_SESSION_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [location.pathname]);
  return null;
}

type NoQtyFlowStep = "REQUIREMENT" | "PLANNING" | "WORK_ORDER" | "PRODUCTION" | "QC" | "DISPATCH" | "SALES_BILL";

function readNoQtyContext(location: ReturnType<typeof useLocation>): {
  active: boolean;
  soId: number | null;
  fromStep: string | null;
  fromDashboard: boolean;
  qs: URLSearchParams;
} {
  const qs = new URLSearchParams(location.search);
  const source = (qs.get("source") || qs.get("from") || "").toLowerCase();
  const active = source === "no_qty_so";
  const soIdRaw = Number(qs.get("salesOrderId") ?? 0);
  const soId = Number.isFinite(soIdRaw) && soIdRaw > 0 ? soIdRaw : null;
  const fromStep = qs.get("fromStep");
  const fromDashboard = qs.get("fromDashboard") === "1" || qs.get("from") === "dashboard";
  return { active, soId, fromStep, fromDashboard, qs };
}

type NoQtyCycleBannerSo = {
  id: number;
  docNo?: string | null;
  internalStatus?: string | null;
  processStage?: { key?: string | null } | null;
  currentCycle?: { cycleNo?: number | null } | null;
};

/** Shows "SO-006 | No Qty SO | Cycle 1 (Active/Closed)" when `source=no_qty_so` context is present. */
export function NoQtyCycleBanner({
  so,
  className,
}: {
  so?: NoQtyCycleBannerSo | null;
  className?: string;
}) {
  const location = useLocation();
  const ctx = React.useMemo(() => readNoQtyContext(location), [location]);
  const [loadedSo, setLoadedSo] = React.useState<NoQtyCycleBannerSo | null>(null);

  const soToUse = so ?? loadedSo;
  const shouldFetch = ctx.active && ctx.soId != null && so == null;

  React.useEffect(() => {
    if (!shouldFetch) return;
    let cancelled = false;
    apiFetch<any>(`/api/sales-orders/${ctx.soId}`)
      .then((row) => {
        if (cancelled) return;
        setLoadedSo({
          id: Number(row?.id ?? ctx.soId),
          docNo: row?.docNo ?? null,
          internalStatus: row?.internalStatus ?? null,
          processStage: row?.processStage ?? null,
          currentCycle: row?.currentCycle ?? null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoadedSo({ id: ctx.soId as number });
      });
    return () => {
      cancelled = true;
    };
  }, [shouldFetch, ctx.soId]);

  if (!ctx.active || ctx.soId == null) return null;

  const cycleNoRaw = soToUse?.currentCycle?.cycleNo;
  const cycleNo = cycleNoRaw != null && Number.isFinite(Number(cycleNoRaw)) ? Number(cycleNoRaw) : null;
  const internal = String(soToUse?.internalStatus ?? "");
  const isClosed = internal === "CLOSED" || internal === "COMPLETED" || soToUse?.processStage?.key === "COMPLETED";
  const cycleStatus = isClosed ? "Closed" : "Active";

  return (
    <div className={cn("rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[13px] text-slate-700", className)}>
      <span className="inline-flex items-center gap-2">
        <span className="text-[12px] font-semibold text-slate-600">SO No</span>
        <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-[12px] font-semibold tabular-nums text-sky-900">
          {displaySalesOrderNo(ctx.soId, soToUse?.docNo)}
        </span>
      </span>
      <span className="text-slate-400"> | </span>
      <span className="font-medium">No Qty SO</span>
      <span className="text-slate-400"> | </span>
      <span>
        Cycle {cycleNo ?? "—"} ({cycleStatus})
      </span>
    </div>
  );
}

/** Back link that follows the No Qty SO workflow chain when `source=no_qty_so` is present. */
export function PageNoQtyFlowBackLink({
  step,
  className,
}: {
  step: NoQtyFlowStep;
  className?: string;
}) {
  const location = useLocation();
  const { user } = useAuth();
  const ctx = React.useMemo(() => readNoQtyContext(location), [location]);
  const canOpenRs = useCanOpenRequirementSheet();
  const listBack = noQtySoBackTarget(user?.role);
  const soScopedBack = noQtySoBackTarget(user?.role, ctx.soId);
  if (!ctx.active) return null;

  const cycleIdRaw = ctx.qs.get("cycleId");
  const cycleId =
    cycleIdRaw != null && cycleIdRaw !== "" && Number.isFinite(Number(cycleIdRaw)) && Number(cycleIdRaw) > 0
      ? String(Number(cycleIdRaw))
      : null;
  const baseCtx = `flow=NO_QTY&source=no_qty_so${ctx.soId != null ? `&salesOrderId=${ctx.soId}` : ""}${cycleId ? `&cycleId=${encodeURIComponent(cycleId)}` : ""}`;

  // Role-safe back target for any step whose canonical "back" lives inside the planning workspace.
  // Non-planning roles (SALES / PRODUCTION / QC / ACCOUNTS) are routed up to the SO list/detail
  // instead of being deep-linked into Requirement Sheet (where they'd see "Forbidden").
  const rsBackTarget =
    canOpenRs && ctx.soId != null
      ? { to: `/sales-orders/${ctx.soId}/requirement-sheets?${baseCtx}`, label: "Back to Requirement Sheet" }
      : soScopedBack;

  const chain: Record<NoQtyFlowStep, { to: string; label: string }> = {
    REQUIREMENT: ctx.fromDashboard
      ? { to: "/dashboard", label: "Back to Dashboard" }
      : listBack,
    // Back-compat: legacy "PLANNING" step behaves like Requirement list back.
    PLANNING: listBack,
    WORK_ORDER: rsBackTarget,
    // NO_QTY flow is cycle-driven; Production returns to Requirement Sheet context (planning authority)
    // — but only for users who can actually open it.
    PRODUCTION: rsBackTarget,
    QC: ctx.fromDashboard
      ? { to: "/dashboard", label: "Back to Dashboard" }
      : { to: `/production?${baseCtx}`, label: "Back to Production Workspace" },
    DISPATCH: { to: `/qc-entry?${baseCtx}`, label: "Back to Quality Inspection Workspace" },
    SALES_BILL: { to: `/dispatch?${baseCtx}`, label: "Back to Dispatch" },
  };

  // If a guided CTA intentionally skipped the Work Order page, keep back navigation coherent.
  if (step === "PRODUCTION" && ctx.fromStep === "requirement" && ctx.soId != null) {
    chain.PRODUCTION = rsBackTarget;
  }

  // Small safety: if salesOrderId is missing, still keep a safe step-to-step route (drops so scope).
  if (ctx.soId == null) {
    chain.WORK_ORDER.to = listBack.to;
    chain.PRODUCTION.to = listBack.to;
    chain.QC.to = "/production?flow=NO_QTY&source=no_qty_so";
    chain.DISPATCH.to = "/qc-entry?source=no_qty_so";
    chain.SALES_BILL.to = "/dispatch?source=no_qty_so";
  }

  if (ctx.qs.get("from") === "work-order-workspace" && step === "PRODUCTION") {
    chain.PRODUCTION = { to: "/work-orders", label: "Back to Work Order Workspace" };
  }

  const next = chain[step];
  const to =
    next.to === `${location.pathname}${location.search}` || next.to === location.pathname ? listBack.to : next.to;

  return <ERPBackNavigation to={to} label={next.label} className={className} />;
}

/**
 * Compact ERP page header — title (+ optional subtitle) + right actions.
 * Uses the global `erp-type-page-title` scale from `style.css` for cross-module parity.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  /** Secondary line under the title (filters context, document scope, etc.). */
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "erp-page-header mb-0 flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-2",
        subtitle ? "items-start" : "items-center",
        className,
      )}
    >
      <div className={cn("min-w-0", subtitle ? "space-y-0.5" : "")}>
        <h2 className="erp-type-page-title">{title}</h2>
        {subtitle ? <div className="erp-type-helper max-w-[min(100%,42rem)] text-slate-500">{subtitle}</div> : null}
      </div>
      {actions ? (
        <div className={cn("erp-page-header-actions", subtitle ? "self-start pt-0.5" : "")}>{actions}</div>
      ) : null}
    </div>
  );
}

export {
  DEFAULT_DASHBOARD_BACK_TARGET,
  DEFAULT_REPORT_BACK_TARGET,
  ReportBackLink,
  ReportPageHeader,
  resolveAnalysisReportBackTarget,
  StickyPageHeader,
  StickyReportBackStrip,
  useAnalysisReportBack,
  type ReportBackTarget,
} from "./ReportPageHeader";
