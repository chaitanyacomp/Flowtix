import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "../lib/utils";
import { ReportBackLink, ReportPageHeader, StickyPageHeader, StickyReportBackStrip } from "./ReportPageHeader";
import { apiFetch } from "../services/api";
import { isReportsReturnContext } from "../lib/drillDownRoutes";
import { displaySalesOrderNo } from "../lib/docNoDisplay";

/** Row below the shell title bar: primary actions (e.g. Add), right-aligned. */
export function PageActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-4 flex flex-wrap justify-end gap-2", className)}>{children}</div>;
}

/** Standard centered page container. */
export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full min-w-0 max-w-5xl space-y-6 overflow-x-hidden pb-8", className)}>{children}</div>;
}

/** Consistent context-aware back control — compact navigation chip (shared with report hub). */
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
  return (
    <Link to={to} className={cn("erp-back-nav-chip", className)}>
      <ArrowLeft className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span>{text}</span>
    </Link>
  );
}

/**
 * Sticky band for back + primary page heading row (inside `erp-main` scroll).
 * Keeps navigation visible without duplicating sticky CSS on each screen.
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
    <StickyPageHeader className={cn("space-y-2.5", className)}>
      {lead}
      {children}
    </StickyPageHeader>
  );
}

type SmartBackKind = "reports" | "dashboard" | "production" | "generic";

type SmartBackSource =
  | "dashboard"
  | "reports"
  | "stock_summary"
  | "production_flow"
  | "no_qty_so";

const SMART_BACK_MAP: Record<SmartBackSource, { to: string; label: string }> = {
  dashboard: { to: "/dashboard", label: "Back to Dashboard" },
  reports: { to: "/reports", label: "Back to Reports" },
  stock_summary: { to: "/stock", label: "Back to Stock Summary" },
  // Production Flow landing: must always be a valid page.
  production_flow: { to: "/dashboard", label: "Back to Dashboard" },
  // NO_QTY list page used in this project.
  no_qty_so: { to: "/sales-orders?soType=NO_QTY", label: "Back to No Qty Sales Orders" },
};

function asSmartSourceKey(v: string | null | undefined): SmartBackSource | null {
  const x = String(v ?? "").trim().toLowerCase();
  if (
    x === "dashboard" ||
    x === "reports" ||
    x === "stock_summary" ||
    x === "production_flow" ||
    x === "no_qty_so"
  ) {
    return x;
  }
  // Backward-compat aliases already in use.
  if (x === "production" || x === "production-flow") return "production_flow";
  return null;
}

/**
 * Context-aware back link with safe fallbacks.
 *
 * Supported context hints:
 * - URL query: ?from=dashboard|reports (or ?source=...)
 * - Navigation state: { backTo: "/path", backLabel?: "..." } or { from: "/path" }
 *
 * It does NOT rely on browser history, and always renders as a normal Link.
 */
export function PageSmartBackLink({
  kind = "generic",
  className,
  fallbackTo,
  defaultTo,
  defaultLabel,
}: {
  kind?: SmartBackKind;
  className?: string;
  fallbackTo?: string;
  /** New universal API: used when no known source context is present. */
  defaultTo?: string;
  defaultLabel?: string;
}) {
  const location = useLocation();
  const searchParams = React.useMemo(() => new URLSearchParams(location.search), [location.search]);
  const state = (location.state ?? {}) as unknown as {
    backTo?: unknown;
    backLabel?: unknown;
    from?: unknown;
  };

  const stateBackTo = typeof state.backTo === "string" ? state.backTo : null;
  const stateBackLabel = typeof state.backLabel === "string" ? state.backLabel : null;
  const stateFromTo = typeof state.from === "string" ? state.from : null;
  const stateFromKey = stateFromTo && !stateFromTo.startsWith("/") ? asSmartSourceKey(stateFromTo) : null;
  const fromKey = asSmartSourceKey(searchParams.get("from"));
  const sourceKey = asSmartSourceKey(searchParams.get("source"));
  /** Prefer `from`, then `source`, for non-report deep links (e.g. `source=no_qty_so`). */
  const querySourceKey: SmartBackSource | null =
    (fromKey && fromKey !== "reports" ? fromKey : null) ?? (sourceKey && sourceKey !== "reports" ? sourceKey : null);

  /** Report screens always return to the Reports hub; ignore stale `from=` / navigation state from other modules. */
  if (kind === "reports") {
    return <ReportBackLink className={className} />;
  }

  /** Drill-down / hub links with `from=reports` or `source=reports` (including alongside other query keys). */
  if (isReportsReturnContext(location.search)) {
    return <ReportBackLink className={className} />;
  }

  let to: string | null = null;
  let label: string = "Back";

  if (stateBackTo) {
    to = stateBackTo;
    label = stateBackLabel ?? "Back";
  } else if (stateFromKey) {
    to = SMART_BACK_MAP[stateFromKey].to;
    label = SMART_BACK_MAP[stateFromKey].label;
  } else if (querySourceKey) {
    to = SMART_BACK_MAP[querySourceKey].to;
    label = SMART_BACK_MAP[querySourceKey].label;
  } else if (kind === "dashboard") {
    to = "/dashboard";
    label = "Back to Dashboard";
  } else if (kind === "production") {
    // If NO_QTY context exists, return to NO_QTY Sales Orders list (never a blank flow route).
    const ctx = readNoQtyContext(location);
    if (ctx.active && ctx.soId != null) {
      to = "/sales-orders?soType=NO_QTY";
      label = "Back to No Qty Sales Orders";
    } else {
      to = "/dashboard";
      label = "Back to Dashboard";
    }
  } else if (stateFromTo && stateFromTo.startsWith("/")) {
    to = stateFromTo;
    label = stateBackLabel ?? "Back";
  } else if (defaultTo || fallbackTo) {
    to = defaultTo ?? fallbackTo ?? "/dashboard";
    label = defaultLabel ?? "Back";
  } else {
    to = "/dashboard";
    label = "Back";
  }

  // Avoid self-linking (e.g. on the production landing page itself)
  if (to === location.pathname) {
    to = defaultTo ?? fallbackTo ?? "/dashboard";
    label = defaultLabel ?? "Back to Dashboard";
  }

  return <PageBackLink to={to} label={label} className={className} />;
}

type NoQtyFlowStep = "REQUIREMENT" | "PLANNING" | "WORK_ORDER" | "PRODUCTION" | "QC" | "DISPATCH" | "SALES_BILL";

function readNoQtyContext(location: ReturnType<typeof useLocation>): {
  active: boolean;
  soId: number | null;
  fromStep: string | null;
  qs: URLSearchParams;
} {
  const qs = new URLSearchParams(location.search);
  const source = (qs.get("source") || qs.get("from") || "").toLowerCase();
  const active = source === "no_qty_so";
  const soIdRaw = Number(qs.get("salesOrderId") ?? 0);
  const soId = Number.isFinite(soIdRaw) && soIdRaw > 0 ? soIdRaw : null;
  const fromStep = qs.get("fromStep");
  return { active, soId, fromStep, qs };
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
  const ctx = React.useMemo(() => readNoQtyContext(location), [location]);
  if (!ctx.active) return null;

  const baseCtx = `source=no_qty_so${ctx.soId != null ? `&salesOrderId=${ctx.soId}` : ""}`;

  const chain: Record<NoQtyFlowStep, { to: string; label: string }> = {
    REQUIREMENT: { to: "/sales-orders?soType=NO_QTY", label: "Back to No Qty Sales Orders" },
    // Back-compat: legacy "PLANNING" step behaves like Requirement list back.
    PLANNING: { to: "/sales-orders?soType=NO_QTY", label: "Back to No Qty Sales Orders" },
    WORK_ORDER: {
      to: ctx.soId != null ? `/sales-orders/${ctx.soId}/requirement-sheets?${baseCtx}` : `/sales-orders?soType=NO_QTY`,
      label: "Back to Requirement Sheet",
    },
    PRODUCTION: { to: `/work-orders?${baseCtx}`, label: "Back to Work Order" },
    QC: { to: `/production?${baseCtx}`, label: "Back to Production" },
    DISPATCH: { to: `/qc-entry?${baseCtx}`, label: "Back to QC" },
    SALES_BILL: { to: `/dispatch?${baseCtx}`, label: "Back to Dispatch" },
  };

  // If a guided CTA intentionally skipped the Work Order page, keep back navigation coherent.
  if (step === "PRODUCTION" && ctx.fromStep === "requirement" && ctx.soId != null) {
    chain.PRODUCTION = {
      to: `/sales-orders/${ctx.soId}/requirement-sheets?${baseCtx}`,
      label: "Back to Requirement Sheet",
    };
  }

  // Small safety: if salesOrderId is missing, still keep a safe step-to-step route (drops so scope).
  if (ctx.soId == null) {
    chain.WORK_ORDER.to = "/sales-orders?soType=NO_QTY";
    chain.PRODUCTION.to = "/work-orders?source=no_qty_so";
    chain.QC.to = "/production?source=no_qty_so";
    chain.DISPATCH.to = "/qc-entry?source=no_qty_so";
    chain.SALES_BILL.to = "/dispatch?source=no_qty_so";
  }

  const next = chain[step];
  // Avoid self-linking: if already at the computed target, fall back to NO_QTY list.
  const to = next.to === `${location.pathname}${location.search}` || next.to === location.pathname ? "/sales-orders?soType=NO_QTY" : next.to;

  return <PageBackLink to={to} label={next.label} className={className} />;
}

/** Optional in-page title when the screen needs a subtitle under the top bar. */
export function PageHeader({ title, actions, className }: { title: string; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("erp-page-header mb-0 flex flex-wrap items-center justify-between gap-3", className)}>
      <h2 className="text-lg font-semibold leading-snug tracking-tight text-slate-900">{title}</h2>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export { ReportBackLink, ReportPageHeader, StickyPageHeader, StickyReportBackStrip };
