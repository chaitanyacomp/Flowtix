import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { cn } from "../lib/utils";
import { type NoQtyFlowState } from "../lib/noQtyFlowState";
import { resolveNoQtyDashboardContinuation } from "../lib/noQtyDashboardContinuation";
import { prepareNoQtyNextRequirementSheetAndNavigate } from "../lib/noQtyPrepareNextRsNavigate";
import { useToast } from "../contexts/ToastContext";
import { useDemoMode } from "../contexts/DemoModeContext";
import { ApiRequestError } from "../services/api";
import { type DispatchBacklogRow, ROW_NUM_EPS } from "../lib/dispatchBacklog";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { useAuth } from "../hooks/useAuth";
import { AccountsDashboardPage } from "./AccountsDashboardPage";
import { StoreDispatchDashboard, type StoreDispatchActionRow } from "./store/StoreDispatchDashboard";
import { REGULAR_TERMS } from "../lib/flowTerminology";
import type { ResolvedNoQtyContinuation } from "../lib/noQtyDashboardContinuation";
import {
  DashboardControlColumn,
  DashboardCurrentProductionStatus,
  DashboardOpsClearStrip,
  DashboardRoleShortcuts,
  DashboardViewAllLink,
  DashboardWalkthroughHelp,
  DashboardWorkspaceHeader,
  ErpKpiStrip,
  ErpKpiSegment,
  ErpKpiLabel,
  ErpKpiValue,
  ErpWorkflowBanner,
} from "../components/erp/foundation";
import { dashboardShell } from "../lib/dashboardShell";
import { erpKpi } from "../lib/erpFoundationTokens";
import type { DashboardShortcut } from "../components/erp/foundation/DashboardRoleShortcuts";
import { ERP_DASHBOARD_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { summarizeDashboardProductionAttention } from "../lib/dashboardProductionStatus";
import {
  buildActionRequiredFromQueues,
  dedupeContinueWorkingBySalesOrder,
  enrichActionRequiredWithNoQtyPlanning,
  enforceUniqueSalesOrdersAcrossGroups,
  findNoQtyContinueProductionForLauncher,
  isNoQtyDashboardPlanningRow,
  partitionContinueWorkingForActions,
  primaryActionStageBySalesOrder,
  shouldHideOpenNoQtyForActionRequired,
  shouldShowNoQtyDashboardContinueProduction,
  type ContinueWorkingRow,
} from "../lib/dashboardActionQueue";
import {
  flowLabelForQuotationPendingSo,
  normalizeQuotationPendingSoRow,
  type QuotationPendingSoRow,
} from "../lib/dashboardCommercialWorkflow";

/** Role-based access to dashboard API sections (aligns with future backend requireRole). */
function dashboardWidgetFlags(role: string) {
  const isAdmin = role === "ADMIN";
  const isSales = role === "SALES";
  const isDispatch = role === "DISPATCH";
  const isProduction = role === "PRODUCTION";
  const isQc = role === "QC";
  const isStore = role === "STORE";

  return {
    canViewOverallSummary: isAdmin,
    canViewDispatchBacklog: isAdmin || isDispatch || isStore,
    canViewProductionQueue: isAdmin || isProduction,
    canViewQcQueue: isAdmin || isQc,
    canViewRmRisk: isAdmin || isProduction || isStore,
    canViewPurchaseSummary: isAdmin || isStore,
    /** STORE: continue-working limited to DISPATCH + SALES_BILL rows in partitionContinueWorkingForActions. */
    canViewContinueWorking: isAdmin || isSales || isProduction || isQc || isStore || isDispatch,
    /**
     * NO_QTY â€œOpen orders / planning & cyclesâ€ launcher (RS / planning handoff).
     * SALES + ADMIN: planning visibility. STORE: dispatch + stock only â€” no launcher fetch.
     */
    canUseOpenNoQtyContinuation: isAdmin || isSales,
    /** Approved quotation → SO creation handoff (commercial workflow). */
    canViewQuotationsPendingSo: isAdmin || isSales,
  };
}

/**
 * Role-based visibility for the per-category Action Required cards.
 *
 * `dashboardWidgetFlags` controls which API sections a role can *fetch*. This
 * helper controls which workflow cards a role should actually *see and act on*
 * once data is loaded â€” so STORE never sees production / QC / sales-bill CTAs
 * even though continue-working data may include them.
 *
 * Role intent (per ERP philosophy):
 *  - STORE     â†’ RM shortage, material planning / purchase receipts, stock alerts,
 *                and dispatch-ready FG lines (same backlog snapshot as Dispatch).
 *                NOT production / QC / sales-bill / NO_QTY RS or SO planning CTAs.
 *  - PRODUCTIONâ†’ production cards (and shortage visibility, view-only).
 *                NOT responsible for creating RM POs.
 *  - QC        â†’ QC cards only.
 *  - DISPATCH  â†’ dispatch cards only.
 *  - SALES     â†’ NO_QTY requirement sheet / planning (not dispatch â€” Store owns dispatch), sales-bill, enquiry cards.
 *  - ACCOUNTS  â†’ has a separate AccountsDashboardPage; not handled here.
 *  - ADMIN     â†’ all cards.
 */
function dashboardActionVisibility(role: string) {
  const isAdmin = role === "ADMIN";
  const isStore = role === "STORE";
  const isProduction = role === "PRODUCTION";
  const isQc = role === "QC";
  const isDispatch = role === "DISPATCH";
  const isSales = role === "SALES";
  return {
    canShowQcCards: isAdmin || isQc,
    canShowDispatchCards: isAdmin || isDispatch || isStore,
    canShowProductionCards: isAdmin || isProduction,
    canShowSalesBillCards: isAdmin || isStore || isDispatch,
    /** Who should see RM shortage / RM-below-min in ops attention counts. */
    canSeeRmShortageOperational: isAdmin || isStore || isProduction,
    /** RM shortage workspace link + PO creation â€” Store / Admin (material planning ownership). */
    canActOnRmShortageProcurement: isAdmin || isStore,
    /** Purchase receipts pending â€” STORE owns GRN, ADMIN sees everything. */
    canShowPurchaseCards: isAdmin || isStore,
    canShowEnquiryCards: isAdmin || isSales,
    /** Approved quotation awaiting sales order — Sales / Admin commercial continuation. */
    canShowQuotationPendingSoCards: isAdmin || isSales,
    /** REGULAR next-RS card links into /production â€” production owners only. */
    canShowNextRsCard: isAdmin || isProduction,
    /** NO_QTY rolling RS planning â€” Sales / Admin only. */
    canShowNoQtyPlanningCard: isAdmin || isSales,
    /** Whether the user can act on a NO_QTY production CTA (launcher or shop-floor card). */
    canActOnNoQtyProductionCta: isAdmin || isProduction || isSales,
  };
}

/**
 * Per-row gate for the NO_QTY continuation list: which primary actions a role may see.
 * STORE: none (dispatch backlog cards cover FG-ready work).
 * SALES: customer / RS / planning and billing handoffs â€” not shop-floor Production or QC.
 */
function isNoQtyResolvedRelevantForRole(role: string, resolved: ResolvedNoQtyContinuation): boolean {
  if (role === "ADMIN") return true;
  if (role === "STORE") return false;
  if (role === "SALES") {
    if (resolved.kind === "prepare_next_rs") return true;
    if (resolved.kind === "navigate") {
      const shopOrDispatch = new Set([
        "Open Production",
        "Open QC",
        "Open Dispatch",
        "Open Dispatch Queue",
        "Open NO_QTY Dispatch",
        "Open Sales Bill",
      ]);
      return !shopOrDispatch.has(resolved.label);
    }
    return false;
  }
  return false;
}

function DashboardTableEmpty({
  title,
  description,
  compact,
}: {
  title: string;
  description?: string;
  /** Single dense row â€” no flex-grow empty shell */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] leading-snug text-slate-800">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
        <span className="font-semibold text-slate-900">{title}</span>
        {description ? <span className="min-w-0 text-slate-700">{description}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-2 py-2 text-[12px] leading-snug text-slate-800">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
      <div className="min-w-0">
        <span className="font-semibold text-slate-900">{title}</span>
        {description ? <span className="text-slate-600"> Â· {description}</span> : null}
      </div>
    </div>
  );
}

function formatDashDispatchMetricQty(q: number): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return "â€”";
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

function isDashActionNoQty(r: { orderType?: string | null }): boolean {
  return r.orderType === "NO_QTY";
}

function OperationalDashCard({
  tier,
  title,
  detail,
  actionLabel,
  href,
  onAction,
  readOnly,
  readOnlyHint,
}: {
  tier: "blocker" | "approval" | "ready" | "supply";
  title: string;
  detail: string;
  /** Used when `readOnly` is false â€” CTA label on the linked card. */
  actionLabel?: string;
  /** Dashboard navigation target when `readOnly` is false. */
  href?: string;
  /** When set, primary CTA runs this handler instead of navigating via `href`. */
  onAction?: () => void;
  /** When true, render a non-interactive status card (no procurement / planning navigation). */
  readOnly?: boolean;
  /** Short guidance shown on the right when `readOnly` is true (e.g. Production RM shortage context). */
  readOnlyHint?: string;
}) {
  // Tier accent: subtle background tint + 3px left rule; no thick borders, no
  // colorful boxes, hairline outline so cards feel premium-corporate.
  const tierClass =
    tier === "blocker"
      ? "border-red-200/85 bg-red-50/40 border-l-[3px] border-l-red-600"
      : tier === "approval"
        ? "border-amber-200/85 bg-amber-50/40 border-l-[3px] border-l-amber-500"
        : tier === "supply"
          ? "border-violet-200/75 bg-violet-50/35 border-l-[3px] border-l-violet-500"
          : "border-slate-200/95 bg-white border-l-[3px] border-l-slate-400";

  const body = (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold leading-tight tracking-tight text-slate-950">{title}</div>
        <p className="mt-0.5 text-[12px] leading-snug text-slate-700">{detail}</p>
      </div>
      {readOnly ? (
        <div className="flex max-w-[16rem] shrink-0 text-right">
          <p className="text-[11px] font-semibold leading-snug text-slate-700">{readOnlyHint ?? "â€”"}</p>
        </div>
      ) : (
        <div className="flex shrink-0">
          <span
            className={cn(
              buttonVariants({ variant: "default", size: "sm" }),
              "h-8 select-none rounded-md px-3 text-xs font-semibold shadow-none transition-colors",
            )}
          >
            <span>{actionLabel}</span>
            <ChevronRight
              className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
        </div>
      )}
    </div>
  );

  if (readOnly) {
    return (
      <div
        role="status"
        className={cn(
          "block rounded-md border py-2 pl-2.5 pr-2.5 shadow-sm outline-none",
          "ring-1 ring-slate-900/[0.03]",
          tierClass,
        )}
      >
        {body}
      </div>
    );
  }

  if (onAction) {
    return (
      <button
        type="button"
        onClick={onAction}
        className={cn(
          "group block w-full rounded-md border py-2 pl-2.5 pr-2.5 text-left shadow-sm outline-none transition-colors",
          "hover:bg-slate-50/80 focus-visible:ring-2 focus-visible:ring-slate-400/40",
          "ring-1 ring-slate-900/[0.03]",
          tierClass,
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <Link
      to={href as string}
      state={{ from: "dashboard" }}
      aria-label={`${title} â€” ${actionLabel ?? "Open"}`}
      className={cn(
        "group block rounded-md border py-2 pl-2.5 pr-2.5 shadow-sm no-underline outline-none transition-shadow",
        "hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-1",
        tierClass,
      )}
    >
      {body}
    </Link>
  );
}

const DASH_SHELL = dashboardShell.page;
const DASH_DUAL_ROOT = dashboardShell.dualRoot;
const DASH_DUAL_INNER = dashboardShell.dualInner;
const DASH_DUAL_GRID = dashboardShell.dualGrid;
const DASH_DUAL_GRID_SINGLE = dashboardShell.dualGridSingle;
const DASH_MAX = dashboardShell.max;
/** Row caps keep the dashboard within ~90vh without page scroll. */
const DASH_NO_QTY_CONTINUATION_CAP = 5;
const DASH_COMMERCIAL_QUOTE_CAP = 5;
const DASH_CARD_MUTED = dashboardShell.cardMuted;
const DASH_BTN_PRIMARY = dashboardShell.btnPrimary;
const DASH_BTN_SECONDARY = dashboardShell.btnSecondary;
/** Demo-friendly short labels for inventory snapshot (full string in title tooltip). */
function displayShortItemName(name: string, maxLen = 28): string {
  let s = String(name ?? "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/\s+\d{10,}$/, "").trim();
  s = s.replace(/\s+[a-z]{2,}\s+\d{8,}$/i, "").trim();
  s = s.replace(/\s+[a-z]{2,}$/i, "").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}â€¦`;
}

type DashboardDto = {
  rmStockAlert: { itemId: number; itemName: string; qty: number; minStockLevel: number }[];
  fgStock: { itemId: number; itemName: string; qty: number }[];
  /** Server sum of FG on-hand from ledger (same universe as fgStock list) */
  fgStockTotalQty?: number;
  pendingWorkOrders: number;
  totalRejectedQty: number;
  qcRejectionPct: number;
  lossSummary: { fgItemId: number; itemName: string; rejectedQty: number }[];
  pendingDispatchCount: number;
  purchasePending: number;
  openEnquiries: number;
  qcWorkQueueCounts?: {
    productionQcPendingCount: number;
    reworkQcPendingCount: number;
    holdDecisionsPendingCount: number;
    legacyReworkApprovalCount: number;
  };
  recentQcRejections: {
    id: number;
    date: string;
    itemName: string;
    rejectedQty: number;
    acceptedQty: number;
    lossQty: number;
    rejectedGrossQty?: number;
    recoveredQty?: number;
    holdQty?: number;
    scrapNetLossQty?: number;
    netLossOrUnresolvedQty?: number;
    netRejectedImpactQty?: number;
    reason: string | null;
    scrapReusable: boolean;
  }[];
};

type ProductionQueueNextAction =
  | "QC_PENDING"
  | "DISPATCH_PENDING"
  | "SALES_BILL_PENDING"
  | "PRODUCTION_PENDING"
  | "NEXT_RS_REQUIRED";

type ProductionQueueRow = {
  workOrderId: number;
  workOrderNo: string;
  workOrderLineId?: number;
  salesOrderId: number;
  salesOrderNo: string;
  customerName?: string;
  itemId: number;
  itemName: string;
  /** WO line target qty */
  requiredQty: number;
  /** Sum of APPROVED production on the line */
  producedQty: number;
  /** max(0, WO line qty âˆ’ approved produced) */
  balanceQty: number;
  status: string;
  workOrderDate: string;
  quantityMetricContext?: string;
  orderType?: string;
  cycleId?: number | null;
  nextAction?: ProductionQueueNextAction;
  lastShortageQty?: number;
  hasPendingQc?: boolean;
  dispatchableQty?: number;
  productionId?: number | null;
  /** Primary qty shown in dashboard cells */
  displayQty?: number;
  qtyLabel?: string;
  actionHref?: string;
  actionLabel?: string;
};

type QcQueueRow = {
  qcRef: string;
  workOrderId: number;
  workOrderNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  itemId: number;
  itemName: string;
  producedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  pendingQcQty: number;
  status: string;
  qcDate: string;
  quantityMetricContext?: string;
  /** From linked SalesOrder â€” used when continue-working is unavailable. */
  orderType?: string | null;
  cycleId?: number | null;
};

type RmRiskRow = {
  itemId: number;
  itemCode: string;
  itemName: string;
  currentStockQty: number;
  requiredQty: number;
  freeQty: number;
  shortageQty: number;
  status: string;
  quantityMetricContext?: string;
};

type PurchaseSummaryRow = {
  purchaseOrderId: number;
  purchaseOrderNo: string;
  supplierName: string;
  itemId: number;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  pendingQty: number;
  status: string;
  purchaseDate: string;
  quantityMetricContext?: string;
};

type DashboardDispQueues = {
  reworkPendingSupervisor: { id: number }[];
  reworkApprovedPendingExecution?: { id: number }[];
  readyForQcRecheck: { id: number }[];
  holdStock: { id: number }[];
  scrapRegister: { id: number }[];
};

function normalizeDashboardDispQueues(raw: unknown): DashboardDispQueues {
  const dq = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rows = (v: unknown): { id: number }[] => (Array.isArray(v) ? (v as { id: number }[]) : []);
  const reworkQc = rows(dq.reworkQcPending).length ? dq.reworkQcPending : dq.readyForQcRecheck;
  const holdList = rows(dq.holdDecisionsPending).length ? dq.holdDecisionsPending : dq.holdStock;
  const legacy = rows(dq.legacyReworkApprovalPending).length ? dq.legacyReworkApprovalPending : dq.reworkPendingSupervisor;
  return {
    reworkPendingSupervisor: rows(legacy),
    reworkApprovedPendingExecution: rows(dq.reworkApprovedPendingExecution),
    readyForQcRecheck: rows(reworkQc),
    holdStock: rows(holdList),
    scrapRegister: rows(dq.scrapRegister),
  };
}

/** Subset of GET /api/dashboard/no-qty-active rows used for the Open NO_QTY continuation launcher. */
type DashboardSalesOrderHead = {
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  internalStatus: string;
  /** Document-linked cycle (locked RS / latest sheet), not SO planning pointer. */
  cycleId?: number | null;
  cycleNo?: number | null;
  planningPointerCycleId?: number | null;
  planningPointerCycleNo?: number | null;
  noQtyPlanningPointerAhead?: boolean;
  latestRequirementSheetId?: number | null;
  latestRequirementSheetDocNo?: string | null;
  latestRequirementSheetStatus?: string | null;
  latestRequirementSheetCycleId?: number | null;
  latestRequirementSheetCycleNo?: number | null;
};

type OpenNoQtyContinuationRow = {
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  cycleNo?: number | null;
  cycleId?: number | null;
  planningPointerCycleNo?: number | null;
  planningPointerCycleId?: number | null;
  noQtyPlanningPointerAhead?: boolean;
  latestRequirementSheetId?: number | null;
  lastRsDocNo?: string | null;
  lastRsStatus?: string | null;
  lastShortageQty?: number | null;
  lastDispatchQty?: number | null;
  statusText: string;
};

function isExcludedInternalStatusForOpenNoQtyDashboard(internalStatus: string): boolean {
  return (
    internalStatus === "CLOSED" ||
    internalStatus === "MANUALLY_CLOSED" ||
    internalStatus === "COMPLETED" ||
    internalStatus === "DRAFT"
  );
}


export function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const role = auth.user?.role ?? "";
  const demo = useDemoMode();
  const liveTick = useErpRefreshTick(["dashboard"], { pollIntervalMs: ERP_DASHBOARD_POLL_MS });

  function clickTo(to: string) {
    return {
      onClick: () => navigate(to, { state: { from: "dashboard" } }),
    };
  }

  const {
    canViewOverallSummary,
    canViewDispatchBacklog,
    canViewProductionQueue,
    canViewQcQueue,
    canViewRmRisk,
    canViewPurchaseSummary,
    canViewContinueWorking,
    canUseOpenNoQtyContinuation,
    canViewQuotationsPendingSo,
  } = React.useMemo(() => dashboardWidgetFlags(role), [role]);

  /**
   * Role-based action card visibility.
   *
   * `canViewXxx` decides what we *fetch* (and was kept untouched to preserve
   * widget data flow); `actionVisibility.canShowXxx` decides what the user
   * is actually allowed to *see and act on* in the Action Required section
   * of the dashboard. This guarantees, e.g., that a STORE user never sees a
   * "Continue Cycle Production" CTA even though continue-working data may
   * contain production rows.
   */
  const actionVisibility = React.useMemo(() => dashboardActionVisibility(role), [role]);

  const hasAnyWidget =
    canViewOverallSummary ||
    canViewDispatchBacklog ||
    canViewProductionQueue ||
    canViewQcQueue ||
    canViewRmRisk ||
    canViewPurchaseSummary ||
    canViewContinueWorking ||
    canViewQuotationsPendingSo;

  const [data, setData] = React.useState<DashboardDto | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [backlog, setBacklog] = React.useState<DispatchBacklogRow[] | null>(null);
  const [backlogError, setBacklogError] = React.useState<string | null>(null);
  const [prodQueue, setProdQueue] = React.useState<ProductionQueueRow[] | null>(null);
  const [prodQueueError, setProdQueueError] = React.useState<string | null>(null);
  const [qcQueue, setQcQueue] = React.useState<QcQueueRow[] | null>(null);
  const [qcQueueError, setQcQueueError] = React.useState<string | null>(null);
  const [rmRisk, setRmRisk] = React.useState<RmRiskRow[] | null>(null);
  const [rmRiskError, setRmRiskError] = React.useState<string | null>(null);
  const [purchaseSummary, setPurchaseSummary] = React.useState<PurchaseSummaryRow[] | null>(null);
  const [purchaseSummaryError, setPurchaseSummaryError] = React.useState<string | null>(null);
  const [dispQueues, setDispQueues] = React.useState<DashboardDispQueues | null>(null);
  const [continueWorking, setContinueWorking] = React.useState<ContinueWorkingRow[] | null>(null);
  const [continueWorkingError, setContinueWorkingError] = React.useState<string | null>(null);
  const [dashboardRsPrepareSoId, setDashboardRsPrepareSoId] = React.useState<number | null>(null);
  const [salesOrdersForDashboard, setSalesOrdersForDashboard] = React.useState<DashboardSalesOrderHead[] | null>(null);
  const [quotationsPendingSo, setQuotationsPendingSo] = React.useState<QuotationPendingSoRow[] | null>(null);
  const [quotationsPendingSoError, setQuotationsPendingSoError] = React.useState<string | null>(null);

  React.useLayoutEffect(() => {
    if (!canViewContinueWorking) {
      setContinueWorking(null);
    }
    if (!canViewQuotationsPendingSo) {
      setQuotationsPendingSo([]);
    }
    if (!canViewDispatchBacklog) setBacklog([]);
    if (!canViewProductionQueue) setProdQueue([]);
    if (!canViewQcQueue) setQcQueue([]);
    if (!canViewRmRisk) setRmRisk([]);
    if (!canViewPurchaseSummary) setPurchaseSummary([]);
    if (!canViewQcQueue)
      setDispQueues({
        reworkPendingSupervisor: [],
        reworkApprovedPendingExecution: [],
        readyForQcRecheck: [],
        holdStock: [],
        scrapRegister: [],
      });
  }, [
    canViewDispatchBacklog,
    canViewProductionQueue,
    canViewQcQueue,
    canViewRmRisk,
    canViewPurchaseSummary,
    canViewContinueWorking,
    canViewQuotationsPendingSo,
  ]);

  React.useEffect(() => {
    let mounted = true;
    setBacklogError(null);
    setProdQueueError(null);
    setQcQueueError(null);
    setRmRiskError(null);
    setPurchaseSummaryError(null);
    if (!canViewOverallSummary) setError(null);

    if (canViewContinueWorking) {
      apiFetch<ContinueWorkingRow[]>("/api/dashboard/continue-working?limit=50")
        .then((rows) => {
          if (mounted) {
            setContinueWorking(Array.isArray(rows) ? rows : []);
            setContinueWorkingError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setContinueWorking([]);
            setContinueWorkingError(
              e instanceof Error ? e.message : "Continue-working queue could not be loaded.",
            );
          }
        });
    } else {
      setContinueWorking(null);
    }

    if (canViewOverallSummary) {
      apiFetch<DashboardDto>("/api/dashboard")
        .then((d) => {
          if (mounted) setData(d);
        })
        .catch((e) => {
          if (!mounted) return;
          const msg = e instanceof Error ? e.message : "Failed to load";
          setError(msg);
          // Dev-friendly: show backend root cause + endpoint in console, keep UI message simple.
          if (e instanceof ApiRequestError) {
            // eslint-disable-next-line no-console
            console.error("[dashboard] /api/dashboard failed", {
              status: e.status,
              code: e.code,
              message: e.message,
              endpoint: (e.body as any)?.endpoint,
              backendError: (e.body as any)?.error,
              body: e.body,
            });
          } else {
            // eslint-disable-next-line no-console
            console.error("[dashboard] /api/dashboard failed", e);
          }
        });
    } else {
      setData(null);
    }

    if (canViewDispatchBacklog) {
      apiFetch<DispatchBacklogRow[]>("/api/dashboard/dispatch-backlog")
        .then((rows) => {
          if (mounted) {
            setBacklog(rows);
            setBacklogError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setBacklog([]);
            setBacklogError(e instanceof Error ? e.message : "Failed to load dispatch backlog");
          }
        });
    }

    if (canViewProductionQueue) {
      apiFetch<ProductionQueueRow[]>("/api/dashboard/production-queue")
        .then((rows) => {
          if (mounted) {
            setProdQueue(rows);
            setProdQueueError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setProdQueue([]);
            setProdQueueError(e instanceof Error ? e.message : "Failed to load production queue");
          }
        });
    }

    if (canViewQcQueue) {
      apiFetch<QcQueueRow[]>("/api/dashboard/qc-queue")
        .then((rows) => {
          if (mounted) {
            setQcQueue(rows);
            setQcQueueError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setQcQueue([]);
            setQcQueueError(e instanceof Error ? e.message : "Failed to load QC queue");
          }
        });

      apiFetch<unknown>("/api/production/qc-rejected-dispositions/queues")
        .then((q) => {
          if (mounted) setDispQueues(normalizeDashboardDispQueues(q));
        })
        .catch(() => {
          if (mounted)
            setDispQueues({
              reworkPendingSupervisor: [],
              reworkApprovedPendingExecution: [],
              readyForQcRecheck: [],
              holdStock: [],
              scrapRegister: [],
            });
        });
    }

    if (canViewRmRisk) {
      apiFetch<RmRiskRow[]>("/api/dashboard/rm-risk")
        .then((rows) => {
          if (mounted) {
            setRmRisk(rows);
            setRmRiskError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setRmRisk([]);
            setRmRiskError(e instanceof Error ? e.message : "Failed to load RM risk");
          }
        });
    }

    if (canViewPurchaseSummary) {
      apiFetch<PurchaseSummaryRow[]>("/api/dashboard/purchase-summary")
        .then((rows) => {
          if (mounted) {
            setPurchaseSummary(rows);
            setPurchaseSummaryError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setPurchaseSummary([]);
            setPurchaseSummaryError(e instanceof Error ? e.message : "Failed to load purchase summary");
          }
        });
    }

    if (canViewQuotationsPendingSo) {
      apiFetch<unknown[]>("/api/dashboard/quotations-pending-so?limit=25")
        .then((rows) => {
          if (!mounted) return;
          const normalized = (Array.isArray(rows) ? rows : [])
            .map((r) => normalizeQuotationPendingSoRow(r))
            .filter((r): r is QuotationPendingSoRow => r != null);
          setQuotationsPendingSo(normalized);
          setQuotationsPendingSoError(null);
        })
        .catch((e) => {
          if (mounted) {
            setQuotationsPendingSo([]);
            const msg =
              e instanceof Error ? e.message : "Approved quotations queue could not be loaded.";
            setQuotationsPendingSoError(
              msg.includes("404") || msg.includes("HTML")
                ? `${msg} Restart the backend (npm run dev in backend/) so GET /api/dashboard/quotations-pending-so is registered.`
                : msg,
            );
          }
        });
    }

    return () => {
      mounted = false;
    };
  }, [
    canViewOverallSummary,
    canViewDispatchBacklog,
    canViewProductionQueue,
    canViewQcQueue,
    canViewRmRisk,
    canViewPurchaseSummary,
    canViewContinueWorking,
    canViewQuotationsPendingSo,
    liveTick,
  ]);

  React.useEffect(() => {
    if (!canUseOpenNoQtyContinuation || demo.enabled) {
      setSalesOrdersForDashboard(null);
      return;
    }
    let mounted = true;
    apiFetch<DashboardSalesOrderHead[]>("/api/dashboard/no-qty-active?limit=50")
      .then((rows) => {
        if (mounted) setSalesOrdersForDashboard(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (mounted) setSalesOrdersForDashboard([]);
      });
    return () => {
      mounted = false;
    };
  }, [canUseOpenNoQtyContinuation, demo.enabled, liveTick]);

  const noQtyMetricsBySoId = React.useMemo(() => {
    const m = new Map<number, { shortage?: number; dispatch?: number }>();
    if (prodQueue) {
      for (const r of prodQueue) {
        if (r.orderType !== "NO_QTY") continue;
        const cur = m.get(r.salesOrderId) ?? {};
        if (r.nextAction === "NEXT_RS_REQUIRED") {
          const balance = Math.max(0, Number(r.balanceQty ?? 0));
          const required = Math.max(0, Number(r.requiredQty ?? 0));
          const produced = Math.max(0, Number(r.producedQty ?? 0));
          const sq = balance > ROW_NUM_EPS ? balance : Math.max(0, required - produced);
          if (Number.isFinite(sq) && sq > ROW_NUM_EPS) cur.shortage = sq;
        }
        const dq = Number(r.dispatchableQty ?? 0);
        if (Number.isFinite(dq) && dq > ROW_NUM_EPS) cur.dispatch = dq;
        m.set(r.salesOrderId, cur);
      }
    }
    if (continueWorking) {
      for (const r of continueWorking) {
        if (r.orderType !== "NO_QTY" || r.stageKey !== "NEXT_RS") continue;
        const cur = m.get(r.salesOrderId) ?? {};
        if (cur.shortage == null) {
          const sq = Number(r.metricQty ?? 0);
          if (Number.isFinite(sq) && sq > ROW_NUM_EPS) cur.shortage = sq;
        }
        m.set(r.salesOrderId, cur);
      }
    }
    return m;
  }, [prodQueue, continueWorking]);

  const openNoQtyContinuationRows = React.useMemo((): OpenNoQtyContinuationRow[] => {
    if (!canUseOpenNoQtyContinuation || demo.enabled || salesOrdersForDashboard === null) return [];
    const out: OpenNoQtyContinuationRow[] = [];
    for (const so of salesOrdersForDashboard) {
      if (isExcludedInternalStatusForOpenNoQtyDashboard(so.internalStatus)) continue;
      const metrics = noQtyMetricsBySoId.get(so.salesOrderId);
      const shortage = metrics?.shortage ?? null;
      const dispatch = metrics?.dispatch ?? null;
      const statusText =
        String(so.latestRequirementSheetStatus ?? "").toUpperCase() === "DRAFT"
          ? "Draft RS"
          : shortage != null && shortage > ROW_NUM_EPS
            ? "Shortage"
            : "";
      const hintDoc = so.latestRequirementSheetDocNo?.trim();
      out.push({
        salesOrderId: so.salesOrderId,
        salesOrderDocNo: so.salesOrderDocNo ?? null,
        customerName: so.customerName?.trim() ? so.customerName : "-",
        cycleNo: so.cycleNo ?? null,
        cycleId: so.cycleId ?? null,
        planningPointerCycleNo: so.planningPointerCycleNo ?? null,
        planningPointerCycleId: so.planningPointerCycleId ?? null,
        noQtyPlanningPointerAhead: Boolean(so.noQtyPlanningPointerAhead),
        latestRequirementSheetId: so.latestRequirementSheetId ?? null,
        lastRsDocNo: hintDoc ? hintDoc : null,
        lastRsStatus: so.latestRequirementSheetStatus ?? null,
        lastShortageQty: shortage,
        lastDispatchQty: dispatch,
        statusText,
      });
    }
    out.sort((a, b) => a.salesOrderId - b.salesOrderId);
    return out;
  }, [canUseOpenNoQtyContinuation, demo.enabled, salesOrdersForDashboard, noQtyMetricsBySoId]);

  const openNoQtyFlowFetchIds = React.useMemo(
    () => openNoQtyContinuationRows.map((r) => r.salesOrderId),
    [openNoQtyContinuationRows],
  );

  const [noQtyFlowBySo, setNoQtyFlowBySo] = React.useState<Record<number, NoQtyFlowState | null>>({});

  React.useEffect(() => {
    if (!canUseOpenNoQtyContinuation || demo.enabled || openNoQtyFlowFetchIds.length === 0) {
      setNoQtyFlowBySo({});
      return;
    }
    let cancelled = false;
    const ids = openNoQtyFlowFetchIds;
    (async () => {
      const pairs = await Promise.all(
        ids.map(async (id) => {
          try {
            const row = openNoQtyContinuationRows.find((r) => r.salesOrderId === id);
            const cid =
              row?.noQtyPlanningPointerAhead &&
              row.planningPointerCycleId != null &&
              Number(row.planningPointerCycleId) > 0
                ? Number(row.planningPointerCycleId)
                : row?.cycleId != null && Number(row.cycleId) > 0
                  ? Number(row.cycleId)
                  : null;
            const qs =
              cid != null ? `?cycleId=${encodeURIComponent(String(cid))}` : "";
            const st = await apiFetch<NoQtyFlowState>(
              `/api/sales-orders/${id}/no-qty-flow-state${qs}`,
            );
            return [id, st] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      if (!cancelled) setNoQtyFlowBySo(Object.fromEntries(pairs));
    })();
    return () => {
      cancelled = true;
    };
  }, [
    canUseOpenNoQtyContinuation,
    demo.enabled,
    openNoQtyFlowFetchIds,
    openNoQtyContinuationRows,
    liveTick,
  ]);

  const hasNoQtyContinuationInActionRequired =
    !demo.enabled && canUseOpenNoQtyContinuation && openNoQtyContinuationRows.length > 0;

  /**
   * Role-filtered NO_QTY continuation rows for rendering.
   *
   * Fetched for ADMIN + SALES (`canUseOpenNoQtyContinuation`). STORE does not fetch this list.
   */
  const noQtyPlanningEnrichInputs = React.useMemo(() => {
    return openNoQtyContinuationRows.map((row) => {
      const flow = noQtyFlowBySo[row.salesOrderId];
      return {
        salesOrderId: row.salesOrderId,
        salesOrderDocNo: row.salesOrderDocNo,
        customerName: row.customerName,
        itemName: row.customerName,
        cycleNo: row.cycleNo,
        cycleId: row.cycleId,
        createNextRsEligible: Boolean(flow?.createNextRsEligible),
        lastShortageQty: row.lastShortageQty ?? null,
      };
    });
  }, [openNoQtyContinuationRows, noQtyFlowBySo]);

  const actionRequiredGroups = React.useMemo(() => {
    const base =
      canViewContinueWorking && continueWorking !== null
        ? enforceUniqueSalesOrdersAcrossGroups(
            partitionContinueWorkingForActions(dedupeContinueWorkingBySalesOrder(continueWorking), { role }),
          )
        : buildActionRequiredFromQueues(
            canViewQcQueue ? qcQueue : null,
            canViewDispatchBacklog ? backlog : null,
            canViewProductionQueue ? prodQueue : null,
            { role },
          );
    return enrichActionRequiredWithNoQtyPlanning(base, noQtyPlanningEnrichInputs, { role });
  }, [
    canViewContinueWorking,
    continueWorking,
    canViewQcQueue,
    qcQueue,
    canViewDispatchBacklog,
    backlog,
    canViewProductionQueue,
    prodQueue,
    role,
    noQtyPlanningEnrichInputs,
  ]);

  const primaryActionBySo = React.useMemo(
    () => primaryActionStageBySalesOrder(actionRequiredGroups),
    [actionRequiredGroups],
  );

  const visibleOpenNoQtyContinuationRows = React.useMemo(() => {
    if (!hasNoQtyContinuationInActionRequired) return [] as OpenNoQtyContinuationRow[];
    return openNoQtyContinuationRows.filter((row) => {
      const flow = noQtyFlowBySo[row.salesOrderId] ?? null;
      const resolved = resolveNoQtyDashboardContinuation({
        salesOrderId: row.salesOrderId,
        cycleId: row.cycleId,
        latestRequirementSheetId: row.latestRequirementSheetId,
        lastRsStatus: row.lastRsStatus,
        flow,
        viewerRole: role,
      });
      if (role !== "ADMIN" && !isNoQtyResolvedRelevantForRole(role, resolved)) return false;
      if (!isNoQtyDashboardPlanningRow(flow, resolved)) return false;
      if (flow && !flow.createNextRsEligible) {
        const rollingId =
          flow.nextRollingRequirementSheetId != null && Number(flow.nextRollingRequirementSheetId) > 0;
        const rowDraft = String(row.lastRsStatus ?? "").toUpperCase() === "DRAFT";
        if (!rollingId && !rowDraft) return false;
      }
      const label = resolved.kind === "prepare_next_rs" ? "Next RS" : resolved.label;
      if (shouldHideOpenNoQtyForActionRequired(row.salesOrderId, label, primaryActionBySo)) return false;
      return true;
    });
  }, [
    hasNoQtyContinuationInActionRequired,
    openNoQtyContinuationRows,
    noQtyFlowBySo,
    role,
    primaryActionBySo,
  ]);

  const hasVisibleNoQtyContinuation = visibleOpenNoQtyContinuationRows.length > 0;

  const woProdNoQtyEligible = React.useMemo(() => {
    return actionRequiredGroups.production.filter((r) => {
      if (!isDashActionNoQty(r)) return false;
      const openRow = openNoQtyContinuationRows.find((o) => o.salesOrderId === r.salesOrderId);
      const flow = noQtyFlowBySo[r.salesOrderId];
      return shouldShowNoQtyDashboardContinueProduction(flow, {
        noQtyPlanningPointerAhead: openRow?.noQtyPlanningPointerAhead,
      });
    });
  }, [actionRequiredGroups.production, openNoQtyContinuationRows, noQtyFlowBySo]);

  const roleShortcuts = React.useMemo((): DashboardShortcut[] => {
    if (role === "PRODUCTION") {
      const links: DashboardShortcut[] = [
        { label: "Work orders", href: "/work-orders?from=dashboard" },
        { label: "Production", href: "/production?source=dashboard" },
      ];
      if (canViewRmRisk) links.push({ label: "RM shortage", href: "/reports/rm-shortage?source=dashboard" });
      return links;
    }
    if (role === "QC") {
      return [
        { label: "QC workspace", href: "/qc-entry?source=dashboard" },
        { label: "QC report", href: "/qc-report?source=dashboard" },
        { label: "Dispatch", href: "/dispatch?source=dashboard" },
      ];
    }
    if (role === "SALES") {
      return [
        { label: "Sales orders", href: "/sales-orders?from=dashboard" },
        { label: "Quotations", href: "/quotations?from=dashboard" },
      ];
    }
    if (role === "ADMIN") {
      return [
        { label: "Dispatch", href: "/dispatch?source=dashboard" },
        { label: "Production", href: "/production?source=dashboard" },
        { label: "QC", href: "/qc-entry?source=dashboard" },
      ];
    }
    return [];
  }, [role, canViewRmRisk]);

  const prodAttention = React.useMemo(
    () => summarizeDashboardProductionAttention(prodQueue ?? []),
    [prodQueue],
  );

  const loading =
    (canViewOverallSummary && data === null && !error) ||
    (canViewDispatchBacklog && backlog === null) ||
    (canViewProductionQueue && prodQueue === null) ||
    (canViewQcQueue && qcQueue === null) ||
    (canViewRmRisk && rmRisk === null) ||
    (canViewPurchaseSummary && purchaseSummary === null) ||
    (canViewContinueWorking && continueWorking === null);

  if (canViewOverallSummary && error) {
    return (
      <div className={DASH_SHELL}>
        <div className={DASH_MAX}>
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={DASH_SHELL}>
        <div className={DASH_MAX}>
          <p className="text-sm text-slate-600">Loadingâ€¦</p>
        </div>
      </div>
    );
  }

  if (role === "ACCOUNTS") {
    return <AccountsDashboardPage />;
  }

  if (!hasAnyWidget) {
    return (
      <div className={DASH_SHELL}>
        <div className={DASH_MAX}>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            No dashboard widgets are available for your role.
          </div>
        </div>
      </div>
    );
  }

  const fgStockTotal = data
    ? data.fgStockTotalQty !== undefined
      ? data.fgStockTotalQty
      : data.fgStock.reduce((s, x) => s + Number(x.qty), 0)
    : 0;

  const qcWq = data?.qcWorkQueueCounts;
  const qcWqRework = qcWq?.reworkQcPendingCount ?? (dispQueues?.readyForQcRecheck?.length ?? 0);
  const qcWqHold = qcWq?.holdDecisionsPendingCount ?? (dispQueues?.holdStock?.length ?? 0);
  const qcWqLegacy = qcWq?.legacyReworkApprovalCount ?? (dispQueues?.reworkPendingSupervisor?.length ?? 0);

  const salesBillActions = actionRequiredGroups.salesBill;
  const woProductionActions = actionRequiredGroups.production;

  const dispatchDashRegular = actionRequiredGroups.dispatch.filter((r) => !isDashActionNoQty(r));
  const dispatchDashNoQty = actionRequiredGroups.dispatch.filter(isDashActionNoQty);
  const woProdRegular = woProductionActions.filter((r) => !isDashActionNoQty(r));
  const salesBillRegular = salesBillActions.filter((r) => !isDashActionNoQty(r));
  const salesBillNoQty = salesBillActions.filter(isDashActionNoQty);

  const qcBatchCount = canViewQcQueue ? (qcQueue?.length ?? 0) : 0;
  const qcPendingTotalQty =
    canViewQcQueue && qcQueue && qcQueue.length > 0
      ? qcQueue.reduce((s, r) => s + Number(r.pendingQcQty ?? 0), 0)
      : 0;
  const qcPendingQtyDisplay =
    qcPendingTotalQty > ROW_NUM_EPS &&
    Math.abs(qcPendingTotalQty - Math.round(qcPendingTotalQty)) < ROW_NUM_EPS
      ? String(Math.round(qcPendingTotalQty))
      : qcPendingTotalQty > ROW_NUM_EPS
        ? qcPendingTotalQty.toFixed(2)
        : "0";
  const prepDispatchLines =
    canViewOverallSummary && data != null ? Number(data.pendingDispatchCount ?? 0) : 0;
  const rmRiskCount = canViewRmRisk ? (rmRisk?.length ?? 0) : 0;
  const purchaseLineCount = canViewPurchaseSummary ? (purchaseSummary?.length ?? 0) : 0;

  // Role-filtered attention check. A pending action only "counts" toward
  // the operations-attention banner when the current role can actually act
  // on it. Without this filter, a STORE user with a pending PRODUCTION
  // queue would see "operations not clear" yet have no visible action card.
  const hasOperationalQueueAttention =
    (actionVisibility.canSeeRmShortageOperational && rmRiskCount > 0) ||
    (actionVisibility.canShowQcCards && canViewQcQueue && qcWqHold > 0) ||
    (actionVisibility.canShowQcCards && canViewQcQueue && qcWqLegacy > 0) ||
    (actionVisibility.canShowQcCards && canViewQcQueue && qcWqRework > 0) ||
    (actionVisibility.canShowQcCards && canViewQcQueue && qcBatchCount > 0) ||
    (actionVisibility.canShowQcCards && actionRequiredGroups.qc.length > 0) ||
    (actionVisibility.canShowDispatchCards && actionRequiredGroups.dispatch.length > 0) ||
    (actionVisibility.canShowProductionCards && woProdRegular.length > 0) ||
    (actionVisibility.canShowProductionCards &&
      role === "PRODUCTION" &&
      woProdNoQtyEligible.length > 0) ||
    (actionVisibility.canShowSalesBillCards && salesBillActions.length > 0) ||
    (actionVisibility.canShowNoQtyPlanningCard && hasVisibleNoQtyContinuation) ||
    (actionVisibility.canShowNextRsCard && actionRequiredGroups.nextRs.length > 0) ||
    (actionVisibility.canShowPurchaseCards && purchaseLineCount > 0) ||
    (canViewOverallSummary &&
      data != null &&
      ((actionVisibility.canSeeRmShortageOperational && data.rmStockAlert.length > 0) ||
        (actionVisibility.canShowDispatchCards && data.pendingDispatchCount > 0) ||
        (actionVisibility.canShowEnquiryCards && data.openEnquiries > 0))) ||
    (actionVisibility.canShowQuotationPendingSoCards &&
      quotationsPendingSo != null &&
      quotationsPendingSo.length > 0);

  const visibleQuotationsPendingSo =
    actionVisibility.canShowQuotationPendingSoCards && quotationsPendingSo != null
      ? quotationsPendingSo
      : [];

  const canShowCommercialColumn =
    actionVisibility.canShowEnquiryCards || actionVisibility.canShowQuotationPendingSoCards;

  const opsAttentionClear =
    !continueWorkingError &&
    !quotationsPendingSoError &&
    !hasOperationalQueueAttention &&
    !hasVisibleNoQtyContinuation;

  const opsQueuesReady =
    (!canViewDispatchBacklog || backlog !== null) &&
    (!canViewProductionQueue || prodQueue !== null) &&
    (!canViewQcQueue || qcQueue !== null) &&
    (!canViewRmRisk || rmRisk !== null) &&
    (!canViewPurchaseSummary || purchaseSummary !== null);

  const noOperationalFetchErrors =
    !backlogError &&
    !prodQueueError &&
    !qcQueueError &&
    !rmRiskError &&
    !purchaseSummaryError &&
    !continueWorkingError;

  const userHasOperationalSummaryWidgets =
    canViewDispatchBacklog ||
    canViewProductionQueue ||
    canViewQcQueue ||
    canViewRmRisk ||
    canViewPurchaseSummary ||
    (canViewOverallSummary && !!data);

  const showOperationsClearStrip =
    !demo.enabled &&
    userHasOperationalSummaryWidgets &&
    opsQueuesReady &&
    noOperationalFetchErrors &&
    opsAttentionClear;

  const dashboardQuietMode = showOperationsClearStrip;

  const prodWoNeedsActionCount =
    canViewProductionQueue && prodQueue != null ? prodAttention.activeWorkOrderCount : 0;

  const displayWoNeedsActionCount =
    canViewProductionQueue && prodQueue != null
      ? prodAttention.activeWorkOrderCount
      : data?.pendingWorkOrders ?? 0;

  const showRoleKpiStrip =
    !demo.enabled && !canViewOverallSummary && opsQueuesReady && noOperationalFetchErrors;

  const inventorySnapshotBothClear =
    data != null && data.fgStock.length === 0 && data.rmStockAlert.length === 0;

  const showInventorySnapshot =
    canViewOverallSummary && data != null && !(dashboardQuietMode && inventorySnapshotBothClear);

  const qcRejMetricTone: "muted" | "warn" | "crit" =
    data == null || data.qcRejectionPct <= 0 ? "muted" : data.qcRejectionPct >= 12 ? "crit" : "warn";

  async function prepareNoQtyNextRsAndNavigate(salesOrderId: number) {
    setDashboardRsPrepareSoId(salesOrderId);
    try {
      await prepareNoQtyNextRequirementSheetAndNavigate({
        salesOrderId,
        navigate,
        toast,
      });
    } finally {
      setDashboardRsPrepareSoId(null);
    }
  }

  const showOperationalLeftPanel =
    !demo.enabled && (hasOperationalQueueAttention || hasVisibleNoQtyContinuation);
  const showCommercialRightPanel = !demo.enabled && canShowCommercialColumn;

  const neutralDashAlertNodes: React.ReactNode[] = [];
  const regularFlowDashAlertNodes: React.ReactNode[] = [];
  const noQtyFlowDashAlertNodes: React.ReactNode[] = [];

  const dashActionGrid = "grid gap-1 grid-cols-1 sm:grid-cols-2";
  const dashCommercialGrid = "grid gap-1 grid-cols-1";
  const dashFlowSectionLabel = "text-[11px] font-bold uppercase tracking-wider text-slate-800";
  const dashFlowSectionLabelNoQty = "text-[11px] font-bold uppercase tracking-wider text-slate-900";

  const noQtyContinuationRowsCapped = visibleOpenNoQtyContinuationRows.slice(0, DASH_NO_QTY_CONTINUATION_CAP);
  const noQtyContinuationTruncated =
    visibleOpenNoQtyContinuationRows.length > DASH_NO_QTY_CONTINUATION_CAP;
  const commercialQuotationsCapped = visibleQuotationsPendingSo.slice(0, DASH_COMMERCIAL_QUOTE_CAP);
  const commercialQuotationsTruncated = visibleQuotationsPendingSo.length > DASH_COMMERCIAL_QUOTE_CAP;

  if (actionVisibility.canSeeRmShortageOperational && canViewRmRisk && rmRisk != null && rmRisk.length > 0) {
    const blockedWoLines = rmRisk.length;
    const affectedItemCount = new Set(rmRisk.map((r) => r.itemId)).size;
    const rmSeverity: "blocker" | "approval" = blockedWoLines >= 3 ? "blocker" : "approval";
    const rmBase =
      affectedItemCount > 0 && affectedItemCount !== blockedWoLines
        ? `${blockedWoLines} WO line(s) blocked Â· ${affectedItemCount} item(s) short`
        : `${blockedWoLines} WO line(s) blocked on material`;

    if (actionVisibility.canActOnRmShortageProcurement) {
      const rmDetail = `${rmBase} â€” opens shortage planning workspace`;
      neutralDashAlertNodes.push(
        <OperationalDashCard
          key="rm-shortage-wo"
          tier={rmSeverity}
          title="RM shortage â€” production blocked"
          detail={rmDetail}
          actionLabel="Open RM Shortage Workspace"
          href="/reports/rm-shortage?source=dashboard"
        />,
      );
    } else {
      neutralDashAlertNodes.push(
        <OperationalDashCard
          key="rm-shortage-wo-readonly"
          readOnly
          tier={rmSeverity}
          title="RM shortage blocking production"
          detail={rmBase}
          readOnlyHint="Contact Material Planning (Store). RM POs are not created from Production."
        />,
      );
    }
  }

  if (
    actionVisibility.canSeeRmShortageOperational &&
    role !== "PRODUCTION" &&
    canViewOverallSummary &&
    data != null &&
    data.rmStockAlert.length > 0
  ) {
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="rm-below-min"
        tier="blocker"
        title="RM below minimum stock"
        detail={`${data.rmStockAlert.length} item(s) under policy minimum`}
        actionLabel={REGULAR_TERMS.REVIEW_RM_STATUS}
        href="/stock?source=dashboard"
      />,
    );
  }

  if (actionVisibility.canShowNextRsCard && actionRequiredGroups.nextRs.length > 0) {
    regularFlowDashAlertNodes.push(
      <OperationalDashCard
        key="next-rs"
        tier="supply"
        title="Regular flow â€” next requirement sheet"
        detail={`${actionRequiredGroups.nextRs.length} regular order line(s) await the next RS before production`}
        actionLabel="Open Production Queue"
        href="/production?source=dashboard"
      />,
    );
  }

  if (actionVisibility.canShowQcCards && canViewQcQueue && qcWqHold > 0) {
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="qc-hold"
        tier="approval"
        title="QC hold decisions"
        detail={`${qcWqHold} disposition(s) need a decision`}
        actionLabel="Open Hold Queue"
        href="/qc-entry?source=dashboard#qc-hold-decisions"
      />,
    );
  }

  if (actionVisibility.canShowQcCards && canViewQcQueue && qcWqLegacy > 0) {
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="qc-legacy"
        tier="approval"
        title="Legacy rework approval"
        detail={`${qcWqLegacy} record(s) need supervisor sign-off`}
        actionLabel="Open Supervisor Queue"
        href="/qc-entry?source=dashboard#qc-rework-supervisor"
      />,
    );
  }

  if (actionVisibility.canShowQcCards && canViewQcQueue && qcBatchCount > 0) {
    const batchWord = qcBatchCount === 1 ? "batch" : "batches";
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="qc-batch"
        tier="ready"
        title="QC inspection pending"
        detail={`${qcBatchCount} production ${batchWord} awaiting QC Â· ${qcPendingQtyDisplay} qty`}
        actionLabel="Open QC Workspace"
        href="/qc-entry?source=dashboard#qc-production-pending"
      />,
    );
  }

  if (actionVisibility.canShowQcCards && canViewQcQueue && qcWqRework > 0) {
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="qc-rework"
        tier="ready"
        title="Rework QC pending"
        detail={`${qcWqRework} rework line(s) await final QC`}
        actionLabel="Open Rework QC"
        href="/qc-entry?source=dashboard#qc-rework-pending"
      />,
    );
  }

  if (actionVisibility.canShowProductionCards && woProdRegular.length > 0) {
    regularFlowDashAlertNodes.push(
      <OperationalDashCard
        key="wo-prod-regular"
        tier="ready"
        title="Production pending â€” regular SO(s)"
        detail={`${woProdRegular.length} regular WO line(s) still on the shop floor`}
        actionLabel="Continue Production"
        href="/production?source=dashboard"
      />,
    );
  }

  if (
    actionVisibility.canShowProductionCards &&
    role === "PRODUCTION" &&
    woProdNoQtyEligible.length > 0
  ) {
    for (const prodRow of woProdNoQtyEligible) {
      const soLabel = displaySalesOrderNo(prodRow.salesOrderId, prodRow.salesOrderDocNo ?? null);
      const qty = Number(prodRow.metricQty ?? 0);
      const qtyLabel = Number.isInteger(qty) ? String(qty) : qty.toFixed(3);
      const prodHref =
        prodRow.href ||
        (prodRow.salesOrderId > 0
          ? `/production?source=dashboard&salesOrderId=${encodeURIComponent(String(prodRow.salesOrderId))}`
          : "/production?source=dashboard");
      noQtyFlowDashAlertNodes.push(
        <OperationalDashCard
          key={`wo-prod-no-qty-${prodRow.key}`}
          tier="ready"
          title="NO_QTY · Production"
          detail={`${soLabel} · ${prodRow.customerName} · Balance: ${qtyLabel}`}
          actionLabel="Continue Production"
          href={prodHref}
        />,
      );
    }
  }

  if (actionVisibility.canShowSalesBillCards && salesBillRegular.length > 0) {
    regularFlowDashAlertNodes.push(
      <OperationalDashCard
        key="sales-bill-regular"
        tier="ready"
        title="Sales bill pending â€” regular"
        detail={`${salesBillRegular.length} regular line(s) ready to invoice`}
        actionLabel="Open Sales Bills"
        href="/sales-bills?source=dashboard"
      />,
    );
  }

  if (actionVisibility.canShowSalesBillCards && salesBillNoQty.length > 0) {
    noQtyFlowDashAlertNodes.push(
      <OperationalDashCard
        key="sales-bill-no-qty"
        tier="ready"
        title="Sales bill pending â€” NO_QTY"
        detail={`${salesBillNoQty.length} NO_QTY cycle line(s) ready to invoice`}
        actionLabel="Open NO_QTY Sales Bills"
        href="/sales-bills?source=dashboard"
      />,
    );
  }

  const dispatchReadyTotal = actionRequiredGroups.dispatch.length;
  const showDispatchAttentionCard =
    actionVisibility.canShowDispatchCards &&
    canViewDispatchBacklog &&
    (dispatchReadyTotal > 0 || (canViewOverallSummary && data != null && prepDispatchLines > 0));

  if (showDispatchAttentionCard) {
    const prepLines = prepDispatchLines;
    if (role === "STORE" && dispatchReadyTotal > 0) {
      for (const d of actionRequiredGroups.dispatch) {
        const soLabel = displaySalesOrderNo(d.salesOrderId, d.salesOrderDocNo ?? null);
        const qtyLabel = formatDashDispatchMetricQty(d.metricQty);
        const isNoQty = isDashActionNoQty(d);
        const ot =
          d.orderType === "NO_QTY"
            ? "NO_QTY"
            : d.orderType === "REPLACEMENT"
              ? "REPLACEMENT"
              : d.orderType === "NORMAL" || d.orderType == null
                ? "Regular"
                : String(d.orderType);
        const detail = isNoQty
          ? `${soLabel} Â· ${d.customerName} Â· ${d.itemName} Â· NO_QTY Â· Dispatch available: ${qtyLabel}`
          : `${soLabel} Â· ${d.customerName} Â· ${d.itemName} Â· ${qtyLabel} ready Â· ${ot}`;
        const card = (
          <OperationalDashCard
            key={`store-dispatch-${d.key}`}
            tier="ready"
            title={isNoQty ? "NO_QTY Â· Dispatch available" : "Optional dispatch available"}
            detail={`${detail} Â· Store-owned dispatch`}
            actionLabel="Open Dispatch"
            href={d.href}
          />
        );
        if (isNoQty) noQtyFlowDashAlertNodes.push(card);
        else regularFlowDashAlertNodes.push(card);
      }
    } else if (dispatchReadyTotal === 0 && prepLines > 0) {
      neutralDashAlertNodes.push(
        <OperationalDashCard
          key="dispatch-prep"
          tier="ready"
          title="Dispatch prep (all flows)"
          detail={`${prepLines} line(s) still in dispatch prep`}
          actionLabel="Open Dispatch"
          href="/dispatch?source=dashboard"
        />,
      );
    } else {
      if (dispatchDashRegular.length > 0) {
        let dRegular = `${dispatchDashRegular.length} regular SO line(s) ready to ship or bill`;
        if (prepLines > 0) {
          dRegular +=
            dispatchDashNoQty.length > 0
              ? ` Â· ${prepLines} line(s) in dispatch prep (all SO types)`
              : ` Â· ${prepLines} line(s) still in dispatch prep`;
        }
        regularFlowDashAlertNodes.push(
          <OperationalDashCard
            key="dispatch-regular"
            tier="ready"
            title="Dispatch queue â€” regular SO(s)"
            detail={dRegular}
            actionLabel="Open Regular Dispatch"
            href="/dispatch?source=dashboard"
          />,
        );
      }
    }
  }

  if (actionVisibility.canShowPurchaseCards && canViewPurchaseSummary && purchaseLineCount > 0) {
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="purchase"
        tier="supply"
        title="Purchase receipts pending"
        detail={`${purchaseLineCount} PO line(s) awaiting GRN`}
        actionLabel="Open Material Planning"
        href="/rm-po-grn?source=dashboard"
      />,
    );
  }

  const commercialWorkflowDashNodes: React.ReactNode[] = [];
  if (actionVisibility.canShowQuotationPendingSoCards && commercialQuotationsCapped.length > 0) {
    for (const row of commercialQuotationsCapped) {
      const flowLabel = flowLabelForQuotationPendingSo(row.flowType);
      commercialWorkflowDashNodes.push(
        <OperationalDashCard
          key={row.key}
          tier="approval"
          title={`${row.quotationNo} · ${row.customerName}`}
          detail={`${flowLabel} · Next step: ${row.nextStep}`}
          actionLabel="Continue"
          href={row.href}
        />,
      );
    }
  }
  if (actionVisibility.canShowEnquiryCards && canViewOverallSummary && data != null && data.openEnquiries > 0) {
    commercialWorkflowDashNodes.push(
      <OperationalDashCard
        key="enquiries"
        tier="supply"
        title="Active enquiries"
        detail={`${data.openEnquiries} pre-quotation enquiry / enquiries`}
        actionLabel="Open Enquiries"
        href="/enquiries?source=dashboard"
      />,
    );
  }

  const operationalDashGroupsPresent =
    neutralDashAlertNodes.length > 0 ||
    regularFlowDashAlertNodes.length > 0 ||
    noQtyFlowDashAlertNodes.length > 0;

  const operationalActionCardsPresent =
    operationalDashGroupsPresent || hasVisibleNoQtyContinuation;

  if ((role === "STORE" || role === "DISPATCH") && !demo.enabled) {
    const storeDispatchReady: StoreDispatchActionRow[] = actionRequiredGroups.dispatch.map((d) => ({
      key: d.key,
      salesOrderId: d.salesOrderId,
      salesOrderDocNo: d.salesOrderDocNo,
      customerName: d.customerName,
      itemName: d.itemName,
      orderType: d.orderType,
      metricQty: d.metricQty,
      href: d.href,
    }));
    const storeBillingPending: StoreDispatchActionRow[] = salesBillActions.map((b) => ({
      key: b.key,
      salesOrderId: b.salesOrderId,
      salesOrderDocNo: b.salesOrderDocNo,
      customerName: b.customerName,
      itemName: b.itemName,
      orderType: b.orderType,
      metricQty: b.metricQty,
      href: b.href,
    }));
    return (
      <StoreDispatchDashboard
        summary={
          data
            ? {
                fgStockTotalQty: fgStockTotal,
                pendingDispatchCount: data.pendingDispatchCount,
                purchasePending: data.purchasePending,
                fgStock: data.fgStock,
              }
            : null
        }
        dispatchReady={storeDispatchReady}
        billingPending={storeBillingPending}
        backlogPreview={backlog ?? []}
        purchaseLineCount={purchaseLineCount}
        rmAlertCount={rmRiskCount}
      />
    );
  }

  const operationalActionQueue =
    showOperationalLeftPanel || showCommercialRightPanel ? (
    <DashboardControlColumn
      variant="operational"
      title="Operational Control"
      subtitle="Factory execution · QC · dispatch · production"
      footer={
        noQtyContinuationTruncated ? (
          <DashboardViewAllLink href="/sales-orders?soType=NO_QTY&source=dashboard" label="View all NO_QTY orders" />
        ) : null
      }
    >
          {neutralDashAlertNodes.length > 0 ? (
            <div className={dashActionGrid}>{neutralDashAlertNodes}</div>
          ) : null}
          {regularFlowDashAlertNodes.length > 0 ? (
            <div className="space-y-1">
              <div className={dashFlowSectionLabel}>Regular flow Â· production & dispatch</div>
              <div className={dashActionGrid}>{regularFlowDashAlertNodes}</div>
            </div>
          ) : null}
          {noQtyFlowDashAlertNodes.length > 0 ? (
            <div className="space-y-1">
              <div className={dashFlowSectionLabelNoQty}>NO_QTY</div>
              <div className={dashActionGrid}>{noQtyFlowDashAlertNodes}</div>
            </div>
          ) : null}

          {hasVisibleNoQtyContinuation ? (
            <div className="overflow-hidden rounded-md border border-slate-200/95 bg-slate-50/90 ring-1 ring-slate-900/[0.04]">
              <div className="border-b border-blue-900/10 bg-gradient-to-r from-blue-50/80 to-slate-50/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-900">
                NO_QTY ({visibleOpenNoQtyContinuationRows.length})
              </div>
              <ul className="divide-y divide-slate-200/90">
                {noQtyContinuationRowsCapped.map((row) => {
                  const flow = noQtyFlowBySo[row.salesOrderId];
                  const planCycleId =
                    row.noQtyPlanningPointerAhead &&
                    row.planningPointerCycleId != null &&
                    Number(row.planningPointerCycleId) > 0
                      ? Number(row.planningPointerCycleId)
                      : row.cycleId;
                  const resolved = resolveNoQtyDashboardContinuation({
                    salesOrderId: row.salesOrderId,
                    cycleId: planCycleId,
                    latestRequirementSheetId: row.latestRequirementSheetId,
                    lastRsStatus: row.lastRsStatus,
                    flow: flow ?? null,
                    viewerRole: role,
                  });
                  const busy =
                    resolved.kind === "prepare_next_rs" && dashboardRsPrepareSoId === row.salesOrderId;
                  const prepareLocked =
                    resolved.kind === "prepare_next_rs" && dashboardRsPrepareSoId != null;
                  const appendFromDashboard = (to: string) => {
                    const sep = to.includes("?") ? "&" : "?";
                    return `${to}${sep}fromDashboard=1`;
                  };
                  const cycleShown =
                    row.noQtyPlanningPointerAhead &&
                    row.planningPointerCycleNo != null &&
                    Number.isFinite(Number(row.planningPointerCycleNo))
                      ? String(row.planningPointerCycleNo)
                      : row.cycleNo != null && Number.isFinite(Number(row.cycleNo))
                        ? String(row.cycleNo)
                        : planCycleId != null && planCycleId > 0
                          ? `#${planCycleId}`
                          : "â€”";
                  const shortageQty =
                    row.lastShortageQty != null && Number(row.lastShortageQty) > ROW_NUM_EPS
                      ? Number(row.lastShortageQty)
                      : null;
                  const evalCycleId =
                    row.cycleId != null && Number(row.cycleId) > 0 ? Number(row.cycleId) : null;
                  const showContinueProduction =
                    actionVisibility.canActOnNoQtyProductionCta &&
                    shouldShowNoQtyDashboardContinueProduction(flow, row);
                  const continueProductionAction = showContinueProduction
                    ? findNoQtyContinueProductionForLauncher({
                        salesOrderId: row.salesOrderId,
                        evalCycleId,
                        prodQueue: canViewProductionQueue ? prodQueue : null,
                        continueWorking: canViewContinueWorking ? continueWorking : null,
                      })
                    : null;
                  const headerCycleShown =
                    !row.noQtyPlanningPointerAhead &&
                    row.cycleNo != null &&
                    Number.isFinite(Number(row.cycleNo))
                      ? String(row.cycleNo)
                      : cycleShown;
                  return (
                    <li
                      key={`no-qty-cycle-${row.salesOrderId}-${planCycleId ?? "c"}-${cycleShown}`}
                      title={row.customerName}
                      className="border-b border-slate-200/70 border-l-[3px] border-l-blue-700/80 bg-gradient-to-r from-blue-50/40 to-transparent px-2 py-1.5 text-[12px] text-slate-800 last:border-b-0"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-bold tabular-nums text-slate-950">
                            {displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo)}
                          </span>
                          <span className="text-slate-400" aria-hidden>
                            Â·
                          </span>
                          <span className="font-semibold text-slate-800">Cycle {headerCycleShown}</span>
                          <span className="text-slate-400" aria-hidden>
                            Â·
                          </span>
                          <span className="font-medium text-slate-700">Next RS</span>
                          {shortageQty != null ? (
                            <>
                              <span className="text-slate-400" aria-hidden>
                                Â·
                              </span>
                              <span className="font-semibold tabular-nums text-slate-900">
                                {shortageQty} next cycle pending
                              </span>
                            </>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              className={cn("h-8 rounded-md px-3 text-xs font-semibold", DASH_BTN_PRIMARY, "border-0")}
                              disabled={prepareLocked}
                              data-testid={`dashboard-no-qty-continue-${row.salesOrderId}`}
                              onClick={() => {
                                if (resolved.kind === "prepare_next_rs") {
                                  void prepareNoQtyNextRsAndNavigate(row.salesOrderId);
                                } else {
                                  navigate(appendFromDashboard(resolved.to), {
                                    state: { from: "dashboard" },
                                  });
                                }
                              }}
                            >
                              {busy ? "…" : "Next RS"}
                            </Button>
                            {showContinueProduction && continueProductionAction ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-md border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 shadow-none"
                                data-testid={`dashboard-no-qty-prod-${row.salesOrderId}`}
                                onClick={() => {
                                  navigate(appendFromDashboard(continueProductionAction.href), {
                                    state: { from: "dashboard" },
                                  });
                                }}
                              >
                                Continue Production
                              </Button>
                            ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </DashboardControlColumn>
  ) : null;

  const commercialActionQueue = showCommercialRightPanel ? (
    <DashboardControlColumn
      variant="commercial"
      title="Commercial Control"
      subtitle="Sales pipeline · continue workflow"
      footer={
        commercialQuotationsTruncated ? (
          <DashboardViewAllLink href="/quotations?source=dashboard" label="View all quotations" />
        ) : null
      }
    >
      {commercialWorkflowDashNodes.length > 0 ? (
        <div className={dashCommercialGrid}>{commercialWorkflowDashNodes}</div>
      ) : !quotationsPendingSoError ? (
        <DashboardTableEmpty
          compact
          title="Commercial pipeline clear"
          description="No enquiry or quotation handoffs pending."
        />
      ) : null}
      {quotationsPendingSoError ? (
        <ErpWorkflowBanner tone="warning" className="text-[12px] leading-snug" role="alert">
          Approved quotations queue could not be refreshed.{" "}
          <span className="text-amber-950/80">({quotationsPendingSoError})</span>
        </ErpWorkflowBanner>
      ) : null}
    </DashboardControlColumn>
  ) : null;

  const overviewHistorySection =
    !demo.enabled && canViewOverallSummary && data ? (
      <details
        className={cn(
          "erp-dash-history-panel erp-dash-history-panel--secondary min-h-0 shrink overflow-hidden rounded-lg border border-slate-200/60 bg-slate-50/40 [&_summary::-webkit-details-marker]:hidden",
          dashboardQuietMode && "erp-op-workspace-secondary",
        )}
      >
        <summary className="cursor-pointer list-none px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-50/80">
          Overview & history
          {dashboardQuietMode ? <span className="ml-1 font-normal normal-case text-slate-500">· expand</span> : null}
        </summary>
        <div
          className={cn(
            "grid border-t border-slate-200/60 p-1.5 lg:items-stretch",
            dashboardQuietMode ? "grid-cols-1 gap-1.5" : "gap-1.5 lg:grid-cols-2",
          )}
        >
          {!showInventorySnapshot ? null : inventorySnapshotBothClear && !dashboardQuietMode ? (
            <div className={cn(DASH_CARD_MUTED, "px-2.5 py-1.5")}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
                  Inventory snapshot
                </span>
                <span className="text-[11px] text-slate-700">
                  <span className="font-medium text-slate-800">FG</span> no listed rows ·{" "}
                  <span className="font-medium text-slate-800">RM below min</span> none — snapshot quiet.
                </span>
              </div>
            </div>
          ) : showInventorySnapshot ? (
            <Card className={DASH_CARD_MUTED}>
              <CardHeader className="space-y-0 px-2.5 pb-0 pt-1">
                <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
                  Inventory snapshot
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 px-2.5 pb-1.5 pt-0 sm:grid-cols-2">
                <div className="min-w-0 overflow-hidden rounded border border-slate-200/90 bg-white/60">
                  <div className="border-b border-slate-100 bg-slate-50/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                    FG usable · top 5
                  </div>
                  {data.fgStock.length === 0 ? (
                    <DashboardTableEmpty compact title="No FG rows" />
                  ) : (
                    <table className="erp-table erp-table-dense dash-table w-full [&_thead_th]:!py-1 [&_thead_th]:!px-2 [&_tbody_td]:!py-1 [&_tbody_td]:!px-2 [&_tbody_td]:text-[11px] [&_thead_th]:text-[10px]">
                      <thead>
                        <tr>
                          <th className="text-left">Item</th>
                          <th className="text-right">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.fgStock.slice(0, 5).map((fg) => (
                          <tr key={fg.itemId}>
                            <td className="max-w-[11rem] truncate text-slate-800" title={fg.itemName}>
                              {displayShortItemName(fg.itemName)}
                            </td>
                            <td className="text-right tabular-nums font-semibold text-slate-900">{fg.qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="min-w-0 overflow-hidden rounded border border-slate-200/90 bg-white/60">
                  <div className="border-b border-slate-100 bg-slate-50/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                    RM below min · top 5
                  </div>
                  {data.rmStockAlert.length === 0 ? (
                    <DashboardTableEmpty compact title="None below minimum — all clear" />
                  ) : (
                    <table className="erp-table erp-table-dense dash-table w-full [&_thead_th]:!py-1 [&_thead_th]:!px-2 [&_tbody_td]:!py-1 [&_tbody_td]:!px-2 [&_tbody_td]:text-[11px] [&_thead_th]:text-[10px]">
                      <thead>
                        <tr>
                          <th className="text-left">Item</th>
                          <th className="text-right">Stock / min</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rmStockAlert.slice(0, 5).map((r) => (
                          <tr key={r.itemId}>
                            <td className="max-w-[11rem] truncate text-slate-800" title={r.itemName}>
                              {displayShortItemName(r.itemName)}
                            </td>
                            <td className="text-right tabular-nums text-slate-800">
                              {r.qty} / {r.minStockLevel}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {!demo.enabled && role === "ADMIN" ? (
            <details className="rounded border border-slate-200/60 bg-slate-50/50 px-2 py-1 text-[10px] text-slate-600 lg:col-span-2 [&_summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer select-none text-slate-600 hover:text-slate-800">
                Advanced · direct SO entry
              </summary>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Link
                  to="/sales-orders?action=new-so"
                  state={{ from: "dashboard" }}
                  className={cn(DASH_BTN_SECONDARY, "inline-flex items-center px-2.5 py-1 text-[11px] no-underline")}
                >
                  New SO (shortcut)
                </Link>
                <Link
                  to="/sales-orders?action=no-qty-so"
                  state={{ from: "dashboard" }}
                  className={cn(DASH_BTN_SECONDARY, "inline-flex items-center px-2.5 py-1 text-[11px] no-underline")}
                >
                  NO_QTY SO (shortcut)
                </Link>
              </div>
            </details>
          ) : null}
        </div>
      </details>
    ) : null;

  return (
    <div className={cn(DASH_SHELL, DASH_DUAL_ROOT)}>
      <div className={DASH_DUAL_INNER}>
        <div className="flex shrink-0 flex-col gap-1">
          {!demo.enabled ? (
            <DashboardWorkspaceHeader
              role={role}
              trailing={
                role === "ADMIN" ? (
                  <DashboardWalkthroughHelp
                    onRegular={() => demo.startDemoFlow("regular")}
                    onNoQty={() => demo.startDemoFlow("no_qty")}
                  />
                ) : null
              }
            />
          ) : null}
          {demo.enabled ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200/90 bg-sky-50/95 px-2 py-1.5 text-[12px] text-sky-950">
              <div className="min-w-0">
                <span className="font-semibold">DEMO MODE</span>{" "}
                <span className="text-sky-900/90">Guided workflow Â· sample data</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-md border-sky-300/80 bg-white px-3 text-xs font-medium text-sky-950 shadow-none hover:bg-sky-100/60"
                onClick={() => demo.setDemoEnabled(false)}
              >
                Exit Demo
              </Button>
            </div>
          ) : null}
          {!demo.enabled && continueWorkingError ? (
            <ErpWorkflowBanner tone="warning" className="text-[12px] leading-snug" role="alert">
              Action queue could not be refreshed. KPIs may still be live; retry by refreshing the page.{" "}
              <span className="text-amber-950/80">({continueWorkingError})</span>
            </ErpWorkflowBanner>
          ) : null}
        </div>

        <div
          className={cn(
            DASH_DUAL_GRID,
            !canShowCommercialColumn && DASH_DUAL_GRID_SINGLE,
            "items-start",
          )}
        >
          <div className="erp-dash-ops-col flex min-w-0 flex-col gap-1">
            {!demo.enabled && showOperationsClearStrip ? <DashboardOpsClearStrip role={role} /> : null}

          {!demo.enabled && canViewOverallSummary && data ? (
            <div className="erp-dash-ops-metrics max-w-full overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ErpKpiStrip className={erpKpi.stripCompact} role="toolbar" aria-label="Operational metrics">
                <ErpKpiSegment
                  type="button"
                  title="Counts sales order lines with dispatch backlog: Regular (NORMAL) by customer PO commitment, plus NO_QTY (cycle-driven) and replacement flows."
                  {...clickTo("/dispatch")}
                  aria-label="Open Dispatch â€” dispatch prep (regular, No Qty, and replacement)"
                >
                  <ErpKpiLabel>Dispatch prep</ErpKpiLabel>
                  <ErpKpiValue tone={data.pendingDispatchCount > 0 ? "warn" : "muted"}>{data.pendingDispatchCount}</ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment
                  type="button"
                  title="Work orders with shop-floor action still pending (excludes carried-forward history)."
                  {...clickTo("/work-orders?woStatus=OPEN")}
                  aria-label="Open work orders needing action"
                >
                  <ErpKpiLabel>WO needs action</ErpKpiLabel>
                  <ErpKpiValue tone={displayWoNeedsActionCount > 0 ? "warn" : "muted"}>
                    {displayWoNeedsActionCount}
                  </ErpKpiValue>
                </ErpKpiSegment>
                {canViewQcQueue ? (
                  <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard")} aria-label="Open QC">
                    <ErpKpiLabel>QC pending</ErpKpiLabel>
                    <ErpKpiValue tone={(qcQueue?.length ?? 0) > 0 ? "warn" : "muted"}>
                      {qcQueue ? qcQueue.length : 0}
                    </ErpKpiValue>
                  </ErpKpiSegment>
                ) : null}
                <ErpKpiSegment type="button" {...clickTo("/stock?source=dashboard")} aria-label={REGULAR_TERMS.REVIEW_RM_STATUS}>
                  <ErpKpiLabel>{REGULAR_TERMS.DASHBOARD_RM_ALERTS_LABEL}</ErpKpiLabel>
                  <ErpKpiValue tone={data.rmStockAlert.length > 0 ? "crit" : "muted"}>{data.rmStockAlert.length}</ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment type="button" {...clickTo("/stock")} aria-label="Open Stock">
                  <ErpKpiLabel>FG usable</ErpKpiLabel>
                  <ErpKpiValue>{fgStockTotal.toFixed(2)}</ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment
                  type="button"
                  title="View rejection details"
                  {...clickTo("/qc-report?source=dashboard")}
                  aria-label="View QC rejection details in QC Report"
                >
                  <ErpKpiLabel>Rejection %</ErpKpiLabel>
                  <ErpKpiValue tone={qcRejMetricTone}>{data.qcRejectionPct.toFixed(1)}%</ErpKpiValue>
                </ErpKpiSegment>
              </ErpKpiStrip>
            </div>
          ) : null}

          
          {!demo.enabled && showRoleKpiStrip ? (
            <div className="erp-dash-ops-metrics max-w-full overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ErpKpiStrip className={erpKpi.stripCompact} role="toolbar" aria-label="Desk metrics">
                {role === "PRODUCTION" ? (
                  <>
                    <ErpKpiSegment
                      type="button"
                      title="Distinct work orders needing shop-floor action (excludes carried-forward)."
                      {...clickTo("/work-orders?woStatus=OPEN")}
                      aria-label="Open work orders needing action"
                    >
                      <ErpKpiLabel>WO needs action</ErpKpiLabel>
                      <ErpKpiValue tone={prodWoNeedsActionCount > 0 ? "warn" : "muted"}>{prodWoNeedsActionCount}</ErpKpiValue>
                    </ErpKpiSegment>
                    <ErpKpiSegment type="button" {...clickTo("/production?source=dashboard")} aria-label="Open production">
                      <ErpKpiLabel>Queue</ErpKpiLabel>
                      <ErpKpiValue tone={woProductionActions.length > 0 ? "warn" : "muted"}>
                        {woProductionActions.length}
                      </ErpKpiValue>
                    </ErpKpiSegment>
                    {canViewRmRisk ? (
                      <ErpKpiSegment type="button" {...clickTo("/reports/rm-shortage?source=dashboard")} aria-label="RM shortage">
                        <ErpKpiLabel>RM blocked</ErpKpiLabel>
                        <ErpKpiValue tone={rmRiskCount > 0 ? "crit" : "muted"}>{rmRiskCount}</ErpKpiValue>
                      </ErpKpiSegment>
                    ) : null}
                  </>
                ) : role === "QC" ? (
                  <>
                    <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard")} aria-label="QC batches">
                      <ErpKpiLabel>Batches</ErpKpiLabel>
                      <ErpKpiValue tone={qcBatchCount > 0 ? "warn" : "muted"}>{qcBatchCount}</ErpKpiValue>
                    </ErpKpiSegment>
                    <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard")} aria-label="QC qty pending">
                      <ErpKpiLabel>Qty pending</ErpKpiLabel>
                      <ErpKpiValue tone={qcPendingTotalQty > ROW_NUM_EPS ? "warn" : "muted"}>{qcPendingQtyDisplay}</ErpKpiValue>
                    </ErpKpiSegment>
                    <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard#qc-rework-pending")} aria-label="Rework QC">
                      <ErpKpiLabel>Rework</ErpKpiLabel>
                      <ErpKpiValue tone={qcWqRework > 0 ? "warn" : "muted"}>{qcWqRework}</ErpKpiValue>
                    </ErpKpiSegment>
                    <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard#qc-hold-decisions")} aria-label="Hold queue">
                      <ErpKpiLabel>Hold</ErpKpiLabel>
                      <ErpKpiValue tone={qcWqHold > 0 ? "warn" : "muted"}>{qcWqHold}</ErpKpiValue>
                    </ErpKpiSegment>
                  </>
                ) : null}
              </ErpKpiStrip>
            </div>
          ) : null}
            {!demo.enabled ? operationalActionQueue : null}
            {!demo.enabled &&
            !operationalActionCardsPresent &&
            !hasVisibleNoQtyContinuation &&
            (showOperationalLeftPanel || showCommercialRightPanel) ? (
              <DashboardTableEmpty
                compact
                title="Operations clear"
                description="Operations clear — No shop-floor actions pending right now."
              />
            ) : null}
          {!demo.enabled && !showOperationsClearStrip && roleShortcuts.length > 0 ? (
            <DashboardRoleShortcuts items={roleShortcuts} />
          ) : null}
          </div>
          {canShowCommercialColumn ? (
            <div className="erp-dash-commercial-col flex min-w-0 flex-col self-start">
              {commercialActionQueue}
            </div>
          ) : null}
        </div>

        {!demo.enabled && canViewProductionQueue ? (
          <div className="erp-dash-live-workspace min-h-0 shrink-0">
            <DashboardCurrentProductionStatus
              className="shadow-md ring-1 ring-slate-900/[0.06]"
              rows={prodQueue}
              loading={prodQueue === null}
              error={prodQueueError}
            />
          </div>
        ) : null}

        {overviewHistorySection}
      </div>
    </div>
  );
}
