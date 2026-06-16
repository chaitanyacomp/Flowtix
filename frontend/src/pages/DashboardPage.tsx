import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { cn } from "../lib/utils";
import { type NoQtyFlowState } from "../lib/noQtyFlowState";
import { resolveNoQtyDashboardContinuation } from "../lib/noQtyDashboardContinuation";
import { noQtyCreateNextCycleContinuationLabel } from "../lib/noQtyRsActionLabels";
import { prepareNoQtyNextRequirementSheetAndNavigate } from "../lib/noQtyPrepareNextRsNavigate";
import { useToast } from "../contexts/ToastContext";
import { useDemoMode } from "../contexts/DemoModeContext";
import { ApiRequestError } from "../services/api";
import { type DispatchBacklogRow, ROW_NUM_EPS } from "../lib/dispatchBacklog";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { salesOrdersFocusHref } from "../lib/drillDownRoutes";
import { useAuth } from "../hooks/useAuth";
import { PendingActionsDashboardCard, PENDING_ACTIONS_PRODUCTION_HELPER } from "./PendingActionsPage";
import { fetchPendingActions } from "../lib/pendingActionsApi";
import { PurchaseDashboardPage } from "./PurchaseDashboardPage";
import { QaDashboardPage } from "./QaDashboardPage";
import { StoreDispatchDashboard, type StoreDispatchActionRow } from "./store/StoreDispatchDashboard";
import { type WoPrepareDashboardQueues } from "../components/erp/WoPrepareOperationalQueuesCard";
import { type ProcurementPendingRow } from "../components/erp/ProcurementPendingDashboardCard";
import { OperationalBlockersCard } from "../components/erp/OperationalBlockersCard";
import { buildOperationalSoActions } from "../lib/operationalBlockers";
import { DashboardLiveFactoryPanel } from "../components/erp/DashboardLiveFactoryPanel";
import { OperationalAlertStrip } from "../components/erp/OperationalAlertStrip";
import { REGULAR_TERMS } from "../lib/flowTerminology";
import { PRODUCTION_QA_TERMS } from "../lib/productionQaTerminology";
import type { ResolvedNoQtyContinuation } from "../lib/noQtyDashboardContinuation";
import {
  DashboardControlColumn,
  DashboardCurrentProductionStatus,
  DashboardPausedWorkOrders,
  type PausedWorkOrderRow,
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
  coverageFromOperationalBlockers,
  operationalControlColumnHasContent,
  shouldShowProductionPendingRegularControlCard,
} from "../lib/dashboardOperationalDedup";
import {
  buildActionRequiredFromQueues,
  buildDashboardDispatchHref,
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
  aggregateNoQtyOptionalDispatchBySo,
  shouldShowNoQtyOptionalDispatchChip,
} from "../lib/noQtyDashboardOptionalDispatch";
import {
  flowLabelForQuotationPendingSo,
  normalizeQuotationPendingSoRow,
  type QuotationPendingSoRow,
} from "../lib/dashboardCommercialWorkflow";
import { buildNoQtyDashboardTraceLine } from "../lib/noQtyDashboardCycleTrace";
import { NoQtyDashboardCycleHistoryDialog } from "../components/erp/NoQtyDashboardCycleHistoryDialog";
import { formatRmStockAlertBanner } from "../lib/inventoryHealth";
import { hasSoWoRmBlockerAttention } from "../lib/dashboardRmClassification";
import {
  productionMaterialBlockedHref,
  productionWorkspaceHref,
  rmControlCenterHref,
} from "../lib/materialWorkflowLinks";

/** Role-based access to dashboard API sections (aligns with future backend requireRole). */
function dashboardWidgetFlags(role: string) {
  const isAdmin = role === "ADMIN";
  const isProduction = role === "PRODUCTION";
  const isStore = role === "STORE";
  const isPurchase = role === "PURCHASE";

  return {
    canViewOverallSummary: isAdmin,
    canViewDispatchBacklog: isAdmin || isStore,
    canViewProductionQueue: isAdmin || isProduction,
    canViewProductionQaQueue: isAdmin || isProduction,
    canViewRmRisk: isAdmin || isStore || isProduction,
    canViewPurchaseSummary: isAdmin || isPurchase,
    canViewGrnPendingSummary: isAdmin || isStore || isPurchase,
    canViewWoPrepareProcurement: isAdmin || isStore || isPurchase,
    canViewWoPrepareCreation: isAdmin || isProduction,
    canViewWoPrepareQueues: isAdmin || isPurchase || isProduction,
    canViewContinueWorking: isAdmin || isProduction || isStore,
    canUseOpenNoQtyContinuation: isAdmin || isStore,
    canViewQuotationsPendingSo: isAdmin,
  };
}

/**
 * Role-based visibility for the per-category Action Required cards.
 *
 * `dashboardWidgetFlags` controls which API sections a role can *fetch*. This
 * helper controls which workflow cards a role should actually *see and act on*
 * once data is loaded ? so STORE never sees production / QC / sales-bill CTAs
 * even though continue-working data may include them.
 *
 * Role intent (per ERP philosophy):
 *  - STORE     ? RM shortage, material planning / purchase receipts, stock alerts,
 *                dispatch-ready FG lines, and NO_QTY cycle planning continuation.
 *                NOT production / QC / sales-bill CTAs.
 *  - PRODUCTION? production cards (and shortage visibility, view-only).
 *                NOT responsible for creating RM POs.
 *  - QC        ? QC cards only.
 *  - DISPATCH  ? dispatch cards only.
 *  - SALES     ? NO_QTY requirement sheet / planning (not dispatch ? Store owns dispatch), sales-bill, enquiry cards.
 *  - ACCOUNTS  ? has a separate AccountsDashboardPage; not handled here.
 *  - ADMIN     ? all cards.
 */
function dashboardActionVisibility(role: string) {
  const isAdmin = role === "ADMIN";
  const isStore = role === "STORE";
  const isProduction = role === "PRODUCTION";
  const isPurchase = role === "PURCHASE";
  return {
    canShowProductionQaCards: isAdmin || isProduction,
    canShowDispatchCards: isAdmin || isStore,
    canShowProductionCards: isAdmin || isProduction,
    canShowSalesBillCards: isAdmin || isStore,
    canSeeRmShortageOperational: isAdmin || isStore || isProduction,
    canActOnRmShortageProcurement: isAdmin || isPurchase,
    canShowPurchaseCards: isAdmin || isPurchase,
    canShowEnquiryCards: isAdmin,
    canShowQuotationPendingSoCards: isAdmin,
    canShowNextRsCard: isAdmin || isProduction,
    canShowNoQtyPlanningCard: isAdmin || isStore,
    canActOnNoQtyProductionCta: isAdmin || isProduction,
  };
}

/**
 * Per-row gate for the NO_QTY continuation list: which primary actions a role may see.
 * STORE: planning continuation (next cycle RS) only — dispatch backlog cards cover FG-ready work.
 */
function isNoQtyResolvedRelevantForRole(role: string, resolved: ResolvedNoQtyContinuation): boolean {
  if (role === "ADMIN") return true;
  if (role === "STORE") {
    if (resolved.kind === "prepare_next_rs") return true;
    if (resolved.kind === "navigate" && String(resolved.to ?? "").includes("/requirement-sheets")) return true;
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
  /** Single dense row ? no flex-grow empty shell */
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
        {description ? <span className="text-slate-600"> ? {description}</span> : null}
      </div>
    </div>
  );
}

function formatDashDispatchMetricQty(q: number): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return "?";
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
  contextLine,
  blockerReason,
  owner,
  nextAction,
}: {
  tier: "blocker" | "approval" | "ready" | "supply";
  title: string;
  detail: string;
  actionLabel?: string;
  href?: string;
  onAction?: () => void;
  readOnly?: boolean;
  readOnlyHint?: string;
  contextLine?: string;
  blockerReason?: string;
  owner?: string;
  nextAction?: string;
}) {
  if (tier === "blocker" || tier === "approval") {
    return (
      <OperationalAlertStrip
        tier={tier}
        headline={title}
        contextLine={contextLine ?? detail}
        blockerReason={blockerReason ?? detail}
        owner={owner}
        nextAction={nextAction}
        actionLabel={actionLabel}
        href={href}
        onAction={onAction}
        readOnly={readOnly}
        readOnlyHint={readOnlyHint}
      />
    );
  }

  const tierClass =
    tier === "supply"
      ? "bg-violet-50/50 ring-violet-200/70"
      : "bg-slate-50/80 ring-slate-200/80";

  const body = (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold leading-tight tracking-tight text-slate-950">{title}</div>
        <p className="mt-0.5 text-[12px] leading-snug text-slate-700">{detail}</p>
      </div>
      {readOnly ? (
        <div className="flex max-w-[16rem] shrink-0 text-right">
          <p className="text-[11px] font-semibold leading-snug text-slate-700">{readOnlyHint ?? "?"}</p>
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
      aria-label={`${title} ? ${actionLabel ?? "Open"}`}
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
const DASH_BTN_PRIMARY = dashboardShell.btnPrimary;

type RmStockHealthRow = {
  itemId: number;
  itemName: string;
  qty: number;
  minimumStockQty: number;
  minStockLevel: number;
  status?: "OUT_OF_STOCK" | "CRITICAL" | "LOW" | "HEALTHY";
};

type DashboardDto = {
  /** All non-healthy RM rows (critical band first, then warning). */
  rmStockAlert: RmStockHealthRow[];
  rmStockCritical?: RmStockHealthRow[];
  rmStockWarning?: RmStockHealthRow[];
  rmStockCriticalCount?: number;
  rmStockWarningCount?: number;
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
  | "ON_HOLD"
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
  /** max(0, WO line qty ? approved produced) */
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
  rmReadinessGate?: string | null;
  rmReadyForProduction?: boolean;
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
  /** From linked SalesOrder ? used when continue-working is unavailable. */
  orderType?: string | null;
  cycleId?: number | null;
};

type RmRiskRow = {
  itemId: number;
  itemCode: string;
  itemName: string;
  salesOrderId?: number | null;
  /** Canonical SO doc no (e.g. SO-26-0001). */
  salesOrderNo?: string | null;
  workOrderId?: number | null;
  workOrderNo?: string | null;
  fgItemName?: string | null;
  currentStockQty: number;
  requiredQty: number;
  freeQty: number;
  shortageQty: number;
  status: string;
  blockerReason?: string | null;
  recommendedAction?: string | null;
  href?: string | null;
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
  // Phase E: operator-first regular flow. Hide procurement-style panels/wording on the dashboard.
  const phaseEOperatorFlow = true;
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
    canViewProductionQaQueue,
    canViewRmRisk,
    canViewPurchaseSummary,
    canViewWoPrepareQueues,
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
    canViewProductionQaQueue ||
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
  const [pausedWorkOrders, setPausedWorkOrders] = React.useState<PausedWorkOrderRow[] | null>(null);
  const [pausedWorkOrdersError, setPausedWorkOrdersError] = React.useState<string | null>(null);
  const [qcQueue, setQcQueue] = React.useState<QcQueueRow[] | null>(null);
  const [qcQueueError, setQcQueueError] = React.useState<string | null>(null);
  const [rmRisk, setRmRisk] = React.useState<RmRiskRow[] | null>(null);
  const [rmRiskError, setRmRiskError] = React.useState<string | null>(null);
  const [purchaseSummary, setPurchaseSummary] = React.useState<PurchaseSummaryRow[] | null>(null);
  const [purchaseSummaryError, setPurchaseSummaryError] = React.useState<string | null>(null);
  const [woPrepareQueues, setWoPrepareQueues] = React.useState<WoPrepareDashboardQueues | null>(null);
  const [procurementPending, setProcurementPending] = React.useState<ProcurementPendingRow[] | null>(null);
  const [storeIssuePending, setStoreIssuePending] = React.useState<ProcurementPendingRow[] | null>(null);
  const [allocationFirstPending, setAllocationFirstPending] = React.useState<any[] | null>(null);
  const [dispQueues, setDispQueues] = React.useState<DashboardDispQueues | null>(null);
  const [continueWorking, setContinueWorking] = React.useState<ContinueWorkingRow[] | null>(null);
  const [continueWorkingError, setContinueWorkingError] = React.useState<string | null>(null);
  const [pendingActionsCount, setPendingActionsCount] = React.useState(0);
  const [pendingActionsLoading, setPendingActionsLoading] = React.useState(true);
  const [pendingActionsError, setPendingActionsError] = React.useState<string | null>(null);
  const [noQtyCycleHistoryTarget, setNoQtyCycleHistoryTarget] = React.useState<OpenNoQtyContinuationRow | null>(
    null,
  );
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
    if (!canViewProductionQueue) setPausedWorkOrders([]);
    if (!canViewProductionQaQueue) setQcQueue([]);
    if (!canViewRmRisk) setRmRisk([]);
    if (!canViewPurchaseSummary) setPurchaseSummary([]);
    if (!canViewWoPrepareQueues) {
      setWoPrepareQueues(null);
      setProcurementPending(null);
    }
    if (!canViewProductionQaQueue)
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
    canViewProductionQaQueue,
    canViewRmRisk,
    canViewPurchaseSummary,
    canViewWoPrepareQueues,
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

      apiFetch<PausedWorkOrderRow[]>("/api/dashboard/paused-work-orders")
        .then((rows) => {
          if (mounted) {
            setPausedWorkOrders(Array.isArray(rows) ? rows : []);
            setPausedWorkOrdersError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setPausedWorkOrders([]);
            setPausedWorkOrdersError(
              e instanceof Error ? e.message : "Failed to load paused work orders",
            );
          }
        });
    }

    if (canViewProductionQaQueue) {
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

    if (canViewWoPrepareQueues) {
      apiFetch<{
        rows: ProcurementPendingRow[];
        storeIssuePending?: ProcurementPendingRow[];
        allocationFirstPending?: Array<{
          workOrderId?: number | null;
          workOrderNo?: string | null;
          salesOrderId?: number | null;
          salesOrderDocNo?: string | null;
          primaryFgName?: string | null;
          operationalKey?: string;
          operationalLabel?: string;
          nextActionKey?: string;
        }>;
      }>(
        "/api/dashboard/procurement-pending",
      )
        .then((res) => {
          if (mounted) {
            setProcurementPending(res.rows ?? []);
            setStoreIssuePending(res.storeIssuePending ?? []);
            setAllocationFirstPending(res.allocationFirstPending ?? []);
          }
        })
        .catch((e) => {
          console.warn("Dashboard procurement-pending fetch failed", e);
          if (mounted) {
            setProcurementPending([]);
            setStoreIssuePending([]);
            setAllocationFirstPending([]);
          }
        });
      apiFetch<WoPrepareDashboardQueues>("/api/dashboard/wo-prepare-queues")
        .then((rows) => {
          if (mounted) setWoPrepareQueues(rows);
        })
        .catch((e) => {
          console.warn("Dashboard wo-prepare-queues fetch failed", e);
          if (mounted) {
            setWoPrepareQueues({
              rmShortageBlocking: [],
              purchaseGrnPending: [],
              readyForWoCreation: [],
            });
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
    canViewProductionQaQueue,
    canViewRmRisk,
    canViewPurchaseSummary,
    canViewWoPrepareQueues,
    canViewContinueWorking,
    canViewQuotationsPendingSo,
    liveTick,
  ]);

  React.useEffect(() => {
    if (demo.enabled) {
      setPendingActionsCount(0);
      setPendingActionsLoading(false);
      setPendingActionsError(null);
      return;
    }
    let mounted = true;
    setPendingActionsLoading(true);
    fetchPendingActions()
      .then((res) => {
        if (!mounted) return;
        setPendingActionsCount(Number(res.count ?? res.actions?.length ?? 0));
        setPendingActionsError(null);
      })
      .catch((e) => {
        if (!mounted) return;
        setPendingActionsCount(0);
        setPendingActionsError(e instanceof Error ? e.message : "Could not load pending actions");
      })
      .finally(() => {
        if (mounted) setPendingActionsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [demo.enabled, liveTick, role]);

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
      const ownerCycleId =
        row.noQtyPlanningPointerAhead &&
        row.planningPointerCycleId != null &&
        Number(row.planningPointerCycleId) > 0
          ? Number(row.planningPointerCycleId)
          : row.cycleId;
      const ownerCycleNo =
        row.noQtyPlanningPointerAhead &&
        row.planningPointerCycleNo != null &&
        Number.isFinite(Number(row.planningPointerCycleNo))
          ? Number(row.planningPointerCycleNo)
          : row.cycleNo;
      return {
        salesOrderId: row.salesOrderId,
        salesOrderDocNo: row.salesOrderDocNo,
        customerName: row.customerName,
        itemName: row.customerName,
        cycleNo: ownerCycleNo,
        cycleId: ownerCycleId,
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
            canViewProductionQaQueue ? qcQueue : null,
            canViewDispatchBacklog ? backlog : null,
            canViewProductionQueue ? prodQueue : null,
            { role },
          );
    return enrichActionRequiredWithNoQtyPlanning(base, noQtyPlanningEnrichInputs, { role });
  }, [
    canViewContinueWorking,
    continueWorking,
    canViewProductionQaQueue,
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

  /** QC-backed optional dispatch headroom per NO_QTY SO (informational chip only ? not Action Required). */
  const noQtyOptionalDispatchBySo = React.useMemo(
    () => aggregateNoQtyOptionalDispatchBySo(prodQueue),
    [prodQueue],
  );

  /**
   * Commercial continuation rows visible on the Planning Dashboard.
   *
   * Business rule (FINAL): for an OPEN NO_QTY sales order, ADMIN and SALES
   * must continue to see the Next RS / Open Draft RS continuation row
   * **independently** of the operational queues (Production / QC /
   * Dispatch / RM). NO_QTY continuation is a commercial planning workflow;
   * shop-floor queues live in their own cards on the same dashboard
   * column. Therefore:
   *
   *   ? we resolve in `commercialContinuation: true` mode ? SALES/ADMIN
   *     always land on a planning action;
   *   ? we do **not** gate on `createNextRsEligible` here ? the row stays
   *     visible across the between-cycles lifetime; RS creation lives on
   *     the NO_QTY Agreements page (primary action opens that workspace).
   *
   * Non-planning viewers (STORE / PRODUCTION / QC / DISPATCH) still see
   * only rows whose resolved action is relevant to their role.
   */
  const visibleOpenNoQtyContinuationRows = React.useMemo(() => {
    if (!hasNoQtyContinuationInActionRequired) return [] as OpenNoQtyContinuationRow[];
    return openNoQtyContinuationRows.filter((row) => {
      const flow = noQtyFlowBySo[row.salesOrderId] ?? null;
      const ownerCycleId =
        row.noQtyPlanningPointerAhead &&
        row.planningPointerCycleId != null &&
        Number(row.planningPointerCycleId) > 0
          ? Number(row.planningPointerCycleId)
          : row.cycleId;
      const resolved = resolveNoQtyDashboardContinuation({
        salesOrderId: row.salesOrderId,
        cycleId: ownerCycleId,
        latestRequirementSheetId: row.latestRequirementSheetId,
        lastRsStatus: row.lastRsStatus,
        flow,
        viewerRole: role,
        commercialContinuation: true,
      });
      if (role !== "ADMIN" && !isNoQtyResolvedRelevantForRole(role, resolved)) return false;
      if (!isNoQtyDashboardPlanningRow(flow, resolved)) return false;
      const label =
        resolved.kind === "prepare_next_rs"
          ? noQtyCreateNextCycleContinuationLabel({
              currentCycleNo: row.cycleNo,
            })
          : resolved.kind === "navigate" && String(row.lastRsStatus ?? "").toUpperCase() === "DRAFT"
            ? "Open Draft RS"
            : resolved.label;
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
      if (canViewRmRisk) links.push({ label: "RM Control Center", href: rmControlCenterHref({ returnTo: "dashboard" }) });
      return links;
    }
    if (role === "QA") {
      return [
        { label: PRODUCTION_QA_TERMS.WORKSPACE_NAV, href: "/qc-entry?source=dashboard" },
        { label: "QA report", href: "/qc-report?source=dashboard" },
      ];
    }
    if (role === "PURCHASE") {
      return [
        { label: "Procurement workspace", href: "/procurement-planning?demandPool=REGULAR_SO&source=dashboard" },
        { label: "RM purchase", href: "/rm-po-grn?source=dashboard" },
        { label: "Purchase bills", href: "/purchase-bills?source=dashboard" },
      ];
    }
    if (role === "STORE") {
      return [
        { label: "Dispatch", href: "/dispatch?source=dashboard" },
        { label: "Material issue", href: "/material-issue?source=dashboard" },
        { label: "Stock", href: "/stock?source=dashboard" },
      ];
    }
    if (role === "ADMIN") {
      return [
        { label: "Sales orders", href: "/sales-orders?from=dashboard" },
        { label: "Enquiries", href: "/enquiries?from=dashboard" },
        { label: "Dispatch", href: "/dispatch?source=dashboard" },
        { label: "Production", href: "/production?source=dashboard" },
      ];
    }
    return [];
  }, [role, canViewRmRisk]);

  const allocationFirstWoIds = React.useMemo(() => {
    const ids = new Set<number>();
    for (const r of allocationFirstPending ?? []) {
      const woId = Number((r as any)?.workOrderId ?? 0);
      if (woId > 0) ids.add(woId);
    }
    for (const r of storeIssuePending ?? []) {
      const woId = Number((r as any)?.workOrderId ?? 0);
      if (woId > 0) ids.add(woId);
    }
    return ids;
  }, [allocationFirstPending, storeIssuePending]);

  const procurementPendingSecondary = React.useMemo(() => {
    const rows = procurementPending ?? [];
    if (!rows.length) return rows;
    return rows.filter((r) => {
      const woId = Number(r.workOrderId ?? 0);
      if (woId > 0 && allocationFirstWoIds.has(woId)) return false;
      return true;
    });
  }, [procurementPending, allocationFirstWoIds]);

  const operationalBlockersReady =
    !canViewWoPrepareQueues ||
    (procurementPending !== null &&
      storeIssuePending !== null &&
      allocationFirstPending !== null &&
      woPrepareQueues !== null);

  const operationalSoActions = React.useMemo(() => {
    if (!canViewWoPrepareQueues || !operationalBlockersReady) return [];
    return buildOperationalSoActions(
      procurementPendingSecondary,
      woPrepareQueues,
      storeIssuePending,
      allocationFirstPending,
    );
  }, [
    canViewWoPrepareQueues,
    operationalBlockersReady,
    procurementPendingSecondary,
    woPrepareQueues,
    storeIssuePending,
    allocationFirstPending,
  ]);

  const hasOperationalBlockerCards = operationalSoActions.length > 0;

  const operationalBlockerCoverage = React.useMemo(
    () => coverageFromOperationalBlockers(operationalSoActions),
    [operationalSoActions],
  );

  const rmRiskSecondary = React.useMemo(() => {
    const rows = rmRisk ?? [];
    if (!rows.length) return rows;
    return rows.filter((r) => {
      const woId = Number(r.workOrderId ?? 0);
      if (woId > 0 && allocationFirstWoIds.has(woId)) return false;
      return true;
    });
  }, [rmRisk, allocationFirstWoIds]);

  const prodAttention = React.useMemo(
    () => summarizeDashboardProductionAttention(prodQueue ?? []),
    [prodQueue],
  );

  const prodWaitingForMaterial = React.useMemo(() => {
    if (!prodQueue?.length) return { workOrderCount: 0, waitingStoreIssueCount: 0 };
    const materialGates = new Set(["NO_PMR", "PMR_DRAFT_ONLY", "WAITING_STORE_ISSUE"]);
    const woIds = new Set<number>();
    const waitingStoreWoIds = new Set<number>();
    for (const row of prodQueue) {
      if (row.orderType === "NO_QTY") continue;
      const gate = row.rmReadinessGate ?? null;
      if (!gate || !materialGates.has(gate)) continue;
      woIds.add(row.workOrderId);
      if (gate === "WAITING_STORE_ISSUE") waitingStoreWoIds.add(row.workOrderId);
    }
    return {
      workOrderCount: woIds.size,
      waitingStoreIssueCount: waitingStoreWoIds.size,
    };
  }, [prodQueue]);

  const loading =
    (canViewOverallSummary && data === null && !error) ||
    (canViewDispatchBacklog && backlog === null) ||
    (canViewProductionQueue && prodQueue === null) ||
    (canViewProductionQaQueue && qcQueue === null) ||
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
          <p className="text-sm text-slate-600">Loading?</p>
        </div>
      </div>
    );
  }

  const pendingActionsDeskProps = !demo.enabled
    ? {
        count: pendingActionsCount,
        loading: pendingActionsLoading,
        error: pendingActionsError,
      }
    : undefined;

  if (role === "PURCHASE") {
    return <PurchaseDashboardPage pendingActions={pendingActionsDeskProps} />;
  }

  if (role === "QA") {
    return <QaDashboardPage pendingActions={pendingActionsDeskProps} />;
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

  const showProductionPendingRegularCard = shouldShowProductionPendingRegularControlCard({
    woProdRegularSalesOrderIds: woProdRegular.map((r) => r.salesOrderId),
    hasOperationalBlockerCards,
    blockerCoverage: operationalBlockerCoverage,
    prodQueue,
  });

  const qcBatchCount = canViewProductionQaQueue ? (qcQueue?.length ?? 0) : 0;
  const qcPendingTotalQty =
    canViewProductionQaQueue && qcQueue && qcQueue.length > 0
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
  const firstProcurementPending =
    procurementPending?.find((r) => Number(r.workOrderId ?? 0) > 0 || Number(r.materialRequirementId ?? 0) > 0) ??
    null;
  const purchaseContinueHref = firstProcurementPending
    ? rmControlCenterHref({
        workOrderId: firstProcurementPending.workOrderId ?? undefined,
        salesOrderId: firstProcurementPending.salesOrderId ?? undefined,
        materialRequirementId: firstProcurementPending.materialRequirementId,
        returnTo: "dashboard",
      })
    : rmControlCenterHref({ onlyBlocked: true, returnTo: "dashboard" });

  // Role-filtered attention check. A pending action only "counts" toward
  // the operations-attention banner when the current role can actually act
  // on it. Without this filter, a STORE user with a pending PRODUCTION
  // queue would see "operations not clear" yet have no visible action card.
  const hasOperationalQueueAttention =
    (canViewWoPrepareQueues && hasOperationalBlockerCards) ||
    hasSoWoRmBlockerAttention(rmRiskCount, actionVisibility.canSeeRmShortageOperational) ||
    (actionVisibility.canShowProductionQaCards && canViewProductionQaQueue && qcWqHold > 0) ||
    (actionVisibility.canShowProductionQaCards && canViewProductionQaQueue && qcWqLegacy > 0) ||
    (actionVisibility.canShowProductionQaCards && canViewProductionQaQueue && qcWqRework > 0) ||
    (actionVisibility.canShowProductionQaCards && canViewProductionQaQueue && qcBatchCount > 0) ||
    (actionVisibility.canShowProductionQaCards && actionRequiredGroups.qc.length > 0) ||
    (actionVisibility.canShowDispatchCards && actionRequiredGroups.dispatch.length > 0) ||
    (actionVisibility.canShowProductionCards && showProductionPendingRegularCard) ||
    (actionVisibility.canShowProductionCards &&
      prodWaitingForMaterial.workOrderCount > 0) ||
    (actionVisibility.canShowProductionCards &&
      role === "PRODUCTION" &&
      woProdNoQtyEligible.length > 0) ||
    (actionVisibility.canShowSalesBillCards && salesBillActions.length > 0) ||
    (actionVisibility.canShowNoQtyPlanningCard && hasVisibleNoQtyContinuation) ||
    (actionVisibility.canShowNextRsCard && actionRequiredGroups.nextRs.length > 0) ||
    (actionVisibility.canShowPurchaseCards && purchaseLineCount > 0) ||
    (canViewOverallSummary &&
      data != null &&
      ((actionVisibility.canShowDispatchCards && data.pendingDispatchCount > 0) ||
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
    (!canViewProductionQaQueue || qcQueue !== null) &&
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
    canViewProductionQaQueue ||
    canViewRmRisk ||
    canViewPurchaseSummary ||
    (canViewOverallSummary && !!data);

  const showOperationsClearStrip =
    !demo.enabled &&
    userHasOperationalSummaryWidgets &&
    opsQueuesReady &&
    noOperationalFetchErrors &&
    opsAttentionClear &&
    // Phase B: Operations are not "clear" while any allocation/issue blockers exist.
    (allocationFirstPending?.length ?? 0) === 0 &&
    (storeIssuePending?.length ?? 0) === 0 &&
    (!canViewWoPrepareQueues || (operationalBlockersReady && !hasOperationalBlockerCards));

  const prodWoNeedsActionCount =
    canViewProductionQueue && prodQueue != null ? prodAttention.activeWorkOrderCount : 0;

  const displayWoNeedsActionCount =
    canViewProductionQueue && prodQueue != null
      ? prodAttention.activeWorkOrderCount
      : data?.pendingWorkOrders ?? 0;

  const showRoleKpiStrip =
    !demo.enabled && !canViewOverallSummary && opsQueuesReady && noOperationalFetchErrors;

  const qcRejMetricTone: "muted" | "warn" | "crit" =
    data == null || data.qcRejectionPct <= 0 ? "muted" : data.qcRejectionPct >= 12 ? "crit" : "warn";

  const showOperationalLeftPanel =
    !demo.enabled && (hasOperationalQueueAttention || hasVisibleNoQtyContinuation);
  const showCommercialRightPanel = !demo.enabled && canShowCommercialColumn;

  const neutralDashAlertNodes: React.ReactNode[] = [];
  const regularFlowDashAlertNodes: React.ReactNode[] = [];
  const noQtyFlowDashAlertNodes: React.ReactNode[] = [];

  const dashActionGrid = "flex flex-col gap-1.5";
  const dashCommercialGrid = "grid gap-1 grid-cols-1";

  const noQtyContinuationRowsCapped = visibleOpenNoQtyContinuationRows.slice(0, DASH_NO_QTY_CONTINUATION_CAP);
  const noQtyContinuationTruncated =
    visibleOpenNoQtyContinuationRows.length > DASH_NO_QTY_CONTINUATION_CAP;
  const commercialQuotationsCapped = visibleQuotationsPendingSo.slice(0, DASH_COMMERCIAL_QUOTE_CAP);
  const commercialQuotationsTruncated = visibleQuotationsPendingSo.length > DASH_COMMERCIAL_QUOTE_CAP;

  if (!phaseEOperatorFlow && actionVisibility.canSeeRmShortageOperational && canViewRmRisk && rmRisk != null && rmRisk.length > 0) {
    // Avoid duplicate RM shortage CTAs: Store/admin see the deduped Operational Blockers list.
    const showRmBlockedWoCard = !canViewWoPrepareQueues;
    const blockedWoLines = rmRisk.length;
    const affectedItemCount = new Set(rmRisk.map((r) => r.itemId)).size;
    const rmSeverity: "blocker" | "approval" = blockedWoLines >= 3 ? "blocker" : "approval";
    const rmBase =
      affectedItemCount > 0 && affectedItemCount !== blockedWoLines
        ? `${blockedWoLines} WO line(s) blocked ? ${affectedItemCount} item(s) short`
        : `${blockedWoLines} WO line(s) blocked on material`;

    if (showRmBlockedWoCard && actionVisibility.canActOnRmShortageProcurement) {
      const firstRmBlocker = rmRisk.find((r) => r.workOrderId && r.itemId) ?? rmRisk[0];
      const rmHref =
        firstRmBlocker?.href ||
        (firstRmBlocker?.workOrderId && firstRmBlocker?.itemId
          ? rmControlCenterHref({
              workOrderId: firstRmBlocker.workOrderId,
              rmItemId: firstRmBlocker.itemId,
              onlyBlocked: true,
              returnTo: "dashboard",
            })
          : rmControlCenterHref({ onlyBlocked: true, returnTo: "dashboard" }));
      neutralDashAlertNodes.push(
        <OperationalDashCard
          key="rm-shortage-wo"
          tier={rmSeverity}
          title="RM blocked work orders"
          detail={rmBase}
          contextLine={
            firstRmBlocker
              ? [
                  firstRmBlocker.workOrderNo,
                  firstRmBlocker.salesOrderId
                    ? displaySalesOrderNo(firstRmBlocker.salesOrderId, firstRmBlocker.salesOrderNo ?? null)
                    : null,
                  firstRmBlocker.fgItemName,
                ]
                  .filter(Boolean)
                  .join(" ? ")
              : undefined
          }
          blockerReason={firstRmBlocker?.blockerReason ?? rmBase}
          owner="Store Department"
          nextAction="Approve requisition / continue resolution"
          actionLabel="Continue RM Resolution"
          href={rmHref}
        />,
      );
    } else if (showRmBlockedWoCard && role !== "PRODUCTION") {
      neutralDashAlertNodes.push(
        <OperationalDashCard
          key="rm-shortage-wo-readonly"
          readOnly
          tier={rmSeverity}
          title="RM blocked work orders"
          detail={rmBase}
          readOnlyHint="Contact Material Planning (Store). RM POs are not created from Production."
        />,
      );
    }
  }

  if (
    prodWaitingForMaterial.workOrderCount > 0 &&
    !canViewWoPrepareQueues &&
    (role === "PRODUCTION" || role === "STORE" || role === "ADMIN")
  ) {
    const woCount = prodWaitingForMaterial.waitingStoreIssueCount || prodWaitingForMaterial.workOrderCount;
    const woWord = woCount === 1 ? "work order" : "work orders";
    const waitingDetail =
      prodWaitingForMaterial.waitingStoreIssueCount > 0
        ? `${prodWaitingForMaterial.waitingStoreIssueCount} ${woWord} waiting for Store issue.`
        : `${prodWaitingForMaterial.workOrderCount} ${woWord} need material before production can continue.`;
    const firstWaitingWo = prodQueue?.find((row) => {
      if (row.orderType === "NO_QTY") return false;
      const gate = row.rmReadinessGate ?? null;
      return gate === "WAITING_STORE_ISSUE" || gate === "NO_PMR" || gate === "PMR_DRAFT_ONLY";
    });
    const waitingGate = firstWaitingWo?.rmReadinessGate ?? null;
    const woId = firstWaitingWo?.workOrderId ?? 0;
    const isProductionRole = role === "PRODUCTION";
    let materialHref: string;
    let actionLabel: string;

    if (isProductionRole) {
      if (waitingGate === "WAITING_STORE_ISSUE" && woId > 0) {
        materialHref = productionWorkspaceHref(woId, undefined, {
          salesOrderId: firstWaitingWo?.salesOrderId,
          orderType: firstWaitingWo?.orderType,
          cycleId: firstWaitingWo?.cycleId ?? undefined,
        });
        actionLabel = "Open Production Workspace";
      } else if ((waitingGate === "NO_PMR" || waitingGate === "PMR_DRAFT_ONLY") && woId > 0) {
        materialHref = rmControlCenterHref({ workOrderId: woId, returnTo: "dashboard" });
        actionLabel = "Open RM Control Center";
      } else if (woId > 0) {
        const gate =
          waitingGate === "NO_PMR" || waitingGate === "PMR_DRAFT_ONLY" || waitingGate === "WAITING_STORE_ISSUE"
            ? waitingGate
            : null;
        materialHref = productionMaterialBlockedHref({ workOrderId: woId, gate, returnTo: "dashboard" });
        actionLabel = "Open Production Workspace";
      } else {
        materialHref = rmControlCenterHref({ onlyBlocked: true, returnTo: "dashboard" });
        actionLabel = "Continue RM Resolution";
      }
    } else if (woId > 0) {
      materialHref = rmControlCenterHref({ workOrderId: woId, returnTo: "dashboard" });
      actionLabel = "Continue RM Resolution";
    } else {
      materialHref = rmControlCenterHref({ onlyBlocked: true, returnTo: "dashboard" });
      actionLabel = "Continue RM Resolution";
    }

    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="prod-waiting-material"
        tier="approval"
        title={
          prodWaitingForMaterial.waitingStoreIssueCount > 0
            ? "Production blocked ? waiting for store issue"
            : "Production blocked ? waiting for RM issue"
        }
        detail={waitingDetail}
        blockerReason={waitingDetail}
        owner={isProductionRole ? "Production" : "Store Department"}
        nextAction={
          prodWaitingForMaterial.waitingStoreIssueCount > 0
            ? "Waiting for store issue"
            : isProductionRole
              ? "Material request pending"
              : "RM resolution pending"
        }
        actionLabel={actionLabel}
        href={materialHref}
      />,
    );
  }

  const hasRmBlockedWoCard =
    actionVisibility.canSeeRmShortageOperational && canViewRmRisk && rmRisk != null && rmRisk.length > 0;

  if (
    actionVisibility.canSeeRmShortageOperational &&
    role !== "PRODUCTION" &&
    canViewOverallSummary &&
    data != null &&
    !hasRmBlockedWoCard &&
    (data.rmStockCriticalCount ?? data.rmStockCritical?.length ?? 0) +
      (data.rmStockWarningCount ?? data.rmStockWarning?.length ?? 0) >
      0
  ) {
    const crit = data.rmStockCriticalCount ?? data.rmStockCritical?.length ?? 0;
    const warn = data.rmStockWarningCount ?? data.rmStockWarning?.length ?? 0;
    const bannerText = formatRmStockAlertBanner(crit, warn);
    neutralDashAlertNodes.push(
      <div
        key="rm-below-min"
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5",
          crit > 0 ? "border-red-200/70 bg-red-50/45" : "border-amber-200/70 bg-amber-50/45",
        )}
      >
        <div className="min-w-0">
          <span className="text-[12px] font-semibold text-slate-900">
            {bannerText ?? "Stock replenishment alert"}
          </span>
          <p className="mt-0.5 text-[11px] text-slate-600">{REGULAR_TERMS.DASHBOARD_STOCK_REPLENISHMENT_TOOLTIP}</p>
        </div>
        <Link
          to="/stock?source=dashboard"
          state={{ from: "dashboard" }}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 shrink-0 text-[11px] no-underline")}
        >
          {REGULAR_TERMS.REVIEW_RM_STATUS}
        </Link>
      </div>,
    );
  }

  if (actionVisibility.canShowNextRsCard && actionRequiredGroups.nextRs.length > 0) {
    regularFlowDashAlertNodes.push(
      <OperationalDashCard
        key="next-rs"
        tier="supply"
        title="Regular flow ? next requirement sheet"
        detail={`${actionRequiredGroups.nextRs.length} regular order line(s) await the next RS before production`}
        actionLabel="Open Production Queue"
        href="/production?source=dashboard"
      />,
    );
  }

  if (actionVisibility.canShowProductionQaCards && canViewProductionQaQueue && qcWqHold > 0) {
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="qc-hold"
        tier="approval"
        title={PRODUCTION_QA_TERMS.QA_BLOCKED_HOLD}
        detail={`${qcWqHold} disposition(s) need a hold decision`}
        actionLabel={PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA}
        href="/qc-entry?source=dashboard#qc-hold-decisions"
      />,
    );
  }

  if (actionVisibility.canShowProductionQaCards && canViewProductionQaQueue && qcWqLegacy > 0) {
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="qc-legacy"
        tier="approval"
        title={PRODUCTION_QA_TERMS.QA_BLOCKED_REWORK_APPROVAL}
        detail={`${qcWqLegacy} record(s) need production rework approval`}
        actionLabel={PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA}
        href="/qc-entry?source=dashboard#qc-rework-supervisor"
      />,
    );
  }

  if (actionVisibility.canShowProductionQaCards && canViewProductionQaQueue && qcBatchCount > 0) {
    const batchWord = qcBatchCount === 1 ? "batch" : "batches";
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="qc-batch"
        tier="ready"
        title={PRODUCTION_QA_TERMS.QA_BLOCKED_BATCHES}
        detail={`${qcBatchCount} production ${batchWord} ? ${qcPendingQtyDisplay} qty ${PRODUCTION_QA_TERMS.QA_IN_PROGRESS.toLowerCase()}`}
        actionLabel={PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA}
        href="/qc-entry?source=dashboard#qc-production-pending"
      />,
    );
  }

  if (actionVisibility.canShowProductionQaCards && canViewProductionQaQueue && qcWqRework > 0) {
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="qc-rework"
        tier="ready"
        title={PRODUCTION_QA_TERMS.QA_BLOCKED_RECHECK}
        detail={`${qcWqRework} rework line(s) await QA review`}
        actionLabel={PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA}
        href="/qc-entry?source=dashboard#qc-rework-pending"
      />,
    );
  }

  if (actionVisibility.canShowProductionCards && showProductionPendingRegularCard) {
    regularFlowDashAlertNodes.push(
      <OperationalDashCard
        key="wo-prod-regular"
        tier="ready"
        title="Production pending ? regular SO(s)"
        detail={`${woProdRegular.length} regular WO line(s) still on the shop floor`}
        actionLabel="Open Production Workspace"
        href={woProdRegular[0]?.href ?? "/production?source=dashboard"}
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
          title="NO_QTY ? Production ready"
          detail={`${soLabel} ? ${prodRow.customerName} ? Balance: ${qtyLabel}`}
          actionLabel="Open Production Workspace"
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
        title="Sales bill pending ? regular"
        detail={`${salesBillRegular.length} regular line(s) ready to invoice`}
        actionLabel="Open Sales Bill Workspace"
        href={salesBillRegular[0]?.href ?? "/sales-bills?source=dashboard"}
      />,
    );
  }

  if (actionVisibility.canShowSalesBillCards && salesBillNoQty.length > 0) {
    noQtyFlowDashAlertNodes.push(
      <OperationalDashCard
        key="sales-bill-no-qty"
        tier="ready"
        title="Sales bill pending ? NO_QTY"
        detail={`${salesBillNoQty.length} NO_QTY cycle line(s) ready to invoice`}
        actionLabel="Open Sales Bill Workspace"
        href={salesBillNoQty[0]?.href ?? "/sales-bills?source=dashboard"}
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
          ? `${soLabel} ? ${d.customerName} ? ${d.itemName} ? NO_QTY ? Dispatch available: ${qtyLabel}`
          : `${soLabel} ? ${d.customerName} ? ${d.itemName} ? ${qtyLabel} ready ? ${ot}`;
        const card = (
          <OperationalDashCard
            key={`store-dispatch-${d.key}`}
            tier="ready"
            title={isNoQty ? "Waiting for dispatch ? NO_QTY" : "Waiting for dispatch"}
            detail={`${detail} ? Store-owned dispatch`}
            actionLabel="Open Dispatch Workspace"
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
          title="Waiting for dispatch ? all flows"
          detail={`${prepLines} line(s) still in dispatch prep`}
          actionLabel="Open Dispatch Workspace"
          href="/dispatch?source=dashboard"
        />,
      );
    } else {
      if (dispatchDashRegular.length > 0) {
        let dRegular = `${dispatchDashRegular.length} regular SO line(s) ready to ship or bill`;
        if (prepLines > 0) {
          dRegular +=
            dispatchDashNoQty.length > 0
              ? ` ? ${prepLines} line(s) in dispatch prep (all SO types)`
              : ` ? ${prepLines} line(s) still in dispatch prep`;
        }
        regularFlowDashAlertNodes.push(
          <OperationalDashCard
            key="dispatch-regular"
            tier="ready"
            title="Waiting for dispatch ? regular SO(s)"
            detail={dRegular}
            actionLabel="Open Dispatch Workspace"
            href={dispatchDashRegular[0]?.href ?? "/dispatch?source=dashboard"}
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
        title="Procurement blocked ? waiting for GRN"
        detail={`${purchaseLineCount} PO line(s) awaiting GRN`}
        actionLabel="Continue RM Resolution"
        href={purchaseContinueHref}
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
          title={`${row.quotationNo} ? ${row.customerName}`}
          detail={`${flowLabel} ? Next step: ${row.nextStep}`}
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

  const operationalControlHasContent = operationalControlColumnHasContent({
    neutralCardCount: neutralDashAlertNodes.length,
    regularCardCount: regularFlowDashAlertNodes.length,
    noQtyCardCount: noQtyFlowDashAlertNodes.length,
    hasVisibleNoQtyContinuation,
  });

  const operationalActionCardsPresent =
    operationalDashGroupsPresent || hasVisibleNoQtyContinuation || hasOperationalBlockerCards;

  if (role === "STORE" && !demo.enabled) {
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
    return (
      <StoreDispatchDashboard
        dispatchReady={storeDispatchReady}
        backlogPreview={backlog ?? []}
        fgStockTotal={fgStockTotal}
        dispatchBacklogCount={backlog?.length ?? 0}
        pendingActions={pendingActionsDeskProps}
      />
    );
  }

  const operationalActionQueue =
    (showOperationalLeftPanel || showCommercialRightPanel) && operationalControlHasContent ? (
    <DashboardControlColumn
      variant="operational"
      title="Operational Control"
      subtitle="Factory execution ? production QA ? dispatch ? production"
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
            <div className={dashActionGrid}>{regularFlowDashAlertNodes}</div>
          ) : null}
          {noQtyFlowDashAlertNodes.length > 0 ? (
            <div className={dashActionGrid}>{noQtyFlowDashAlertNodes}</div>
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
                    commercialContinuation: true,
                  });
                  const continuationLabel =
                    resolved.kind === "prepare_next_rs"
                      ? noQtyCreateNextCycleContinuationLabel({
                          currentCycleNo:
                            row.noQtyPlanningPointerAhead && row.planningPointerCycleNo != null
                              ? Number(row.planningPointerCycleNo)
                              : row.cycleNo,
                        })
                      : resolved.kind === "navigate" && String(row.lastRsStatus ?? "").toUpperCase() === "DRAFT"
                        ? "Open Draft RS"
                        : resolved.label;
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
                          : "?";
                  const traceLine = buildNoQtyDashboardTraceLine({
                    cycleNo: row.cycleNo,
                    planningPointerCycleNo: row.planningPointerCycleNo,
                    noQtyPlanningPointerAhead: row.noQtyPlanningPointerAhead,
                    lastRsStatus: row.lastRsStatus,
                  });
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
                  /**
                   * Commercial state badge ? independent of operational queues.
                   * Mirrors the labels shown on the Sales Order screen so the
                   * dashboard reads consistently with that workspace:
                   *   ? Draft RS         ? `lastRsStatus === "DRAFT"`
                   *   ? Between cycles   ? planning pointer ahead of doc cycle
                   *                        (current cycle CLOSED, no active RS)
                   *   ? Planning pending ? default while SO is OPEN and
                   *                        commercial continuation is needed
                   */
                  const upperRsStatus = String(row.lastRsStatus ?? "").toUpperCase();
                  const planningState: "draft" | "between" | "pending" =
                    upperRsStatus === "DRAFT"
                      ? "draft"
                      : row.noQtyPlanningPointerAhead
                        ? "between"
                        : "pending";
                  const planningStateLabel =
                    planningState === "draft"
                      ? "Draft RS"
                      : planningState === "between"
                        ? "Between cycles"
                        : "Cycle review pending";
                  const planningStateChipClass =
                    planningState === "draft"
                      ? "bg-amber-100 text-amber-900 ring-amber-200"
                      : planningState === "between"
                        ? "bg-blue-100 text-blue-900 ring-blue-200"
                        : "bg-slate-100 text-slate-700 ring-slate-200";
                  const closeSoHref = salesOrdersFocusHref(row.salesOrderId);
                  const optionalDispatch = shouldShowNoQtyOptionalDispatchChip(
                    row.salesOrderId,
                    noQtyOptionalDispatchBySo,
                    actionRequiredGroups,
                    continueWorking,
                  );
                  const optionalDispatchHref = optionalDispatch
                    ? buildDashboardDispatchHref({
                        salesOrderId: row.salesOrderId,
                        orderType: "NO_QTY",
                        itemId: optionalDispatch.itemId,
                      })
                    : null;
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
                            ?
                          </span>
                          {!traceLine ? (
                            <>
                              <span className="font-semibold text-slate-800">Cycle {headerCycleShown}</span>
                              <span className="text-slate-400" aria-hidden>
                                ?
                              </span>
                            </>
                          ) : null}
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1",
                              planningStateChipClass,
                            )}
                            data-testid={`dashboard-no-qty-state-${row.salesOrderId}`}
                          >
                            {planningStateLabel}
                          </span>
                        </div>
                        {traceLine ? (
                          <p
                            className="text-[11px] leading-snug text-slate-600"
                            data-testid={`dashboard-no-qty-trace-${row.salesOrderId}`}
                          >
                            <span>{traceLine.positionText}</span>
                            <span className="text-slate-400" aria-hidden>
                              {" "}
                              ?{" "}
                            </span>
                            <button
                              type="button"
                              className="font-semibold text-blue-800 underline-offset-2 hover:underline"
                              data-testid={`dashboard-no-qty-cycle-history-${row.salesOrderId}`}
                              onClick={() => setNoQtyCycleHistoryTarget(row)}
                            >
                              View cycle history
                            </button>
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-1">
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              className={cn("h-8 rounded-md px-3 text-xs font-semibold", DASH_BTN_PRIMARY, "border-0")}
                              data-testid={`dashboard-no-qty-continue-${row.salesOrderId}`}
                              onClick={() => {
                                if (resolved.kind === "prepare_next_rs") {
                                  void prepareNoQtyNextRequirementSheetAndNavigate({
                                    salesOrderId: row.salesOrderId,
                                    navigate,
                                    toast,
                                    navigateState: { from: "dashboard" },
                                  });
                                } else {
                                  navigate(appendFromDashboard(resolved.to), {
                                    state: { from: "dashboard" },
                                  });
                                }
                              }}
                            >
                              {continuationLabel}
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
                                Open Production Workspace
                              </Button>
                            ) : null}
                            {optionalDispatch && optionalDispatchHref ? (
                              <button
                                type="button"
                                className="inline-flex h-8 max-w-full items-center rounded-full border border-slate-200/90 bg-slate-50/95 px-2.5 text-[10px] font-medium tabular-nums text-slate-700 ring-1 ring-slate-200/80 transition-colors hover:border-slate-300 hover:bg-slate-100"
                                title="Usable FG stock ? optional dispatch only (not mandatory on dashboard)"
                                data-testid={`dashboard-no-qty-opt-dispatch-${row.salesOrderId}`}
                                onClick={() => {
                                  navigate(appendFromDashboard(optionalDispatchHref), {
                                    state: { from: "dashboard" },
                                  });
                                }}
                              >
                                Optional dispatch available: {formatDashDispatchMetricQty(optionalDispatch.qty)}
                              </button>
                            ) : null}
                            {/*
                              Close SO ? quiet secondary link that navigates
                              to the Sales Orders workspace focused on this
                              SO. The actual close action (with confirmation
                              dialog and carry-forward freeze) lives there;
                              we never duplicate that flow on the dashboard.
                            */}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="ml-auto h-8 rounded-md px-2 text-xs font-medium text-slate-500 hover:text-slate-900"
                              data-testid={`dashboard-no-qty-close-${row.salesOrderId}`}
                              onClick={() => {
                                navigate(appendFromDashboard(closeSoHref), {
                                  state: { from: "dashboard" },
                                });
                              }}
                            >
                              Close SO
                            </Button>
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
      compact
      footer={
        commercialQuotationsTruncated ? (
          <DashboardViewAllLink href="/quotations?source=dashboard" label="View all quotations" />
        ) : null
      }
    >
      {commercialWorkflowDashNodes.length > 0 ? (
        <div className={dashCommercialGrid}>{commercialWorkflowDashNodes}</div>
      ) : !quotationsPendingSoError ? (
        <DashboardTableEmpty compact title="Commercial pipeline clear ?" />
      ) : null}
      {quotationsPendingSoError ? (
        <ErpWorkflowBanner tone="warning" className="text-[12px] leading-snug" role="alert">
          Approved quotations queue could not be refreshed.{" "}
          <span className="text-amber-950/80">({quotationsPendingSoError})</span>
        </ErpWorkflowBanner>
      ) : null}
    </DashboardControlColumn>
  ) : null;

  const liveFactorySection =
    !demo.enabled && canViewOverallSummary && data ? (
      <DashboardLiveFactoryPanel
        data={{
          pendingDispatchCount: data.pendingDispatchCount,
          readyIssueCount: 0,
        }}
        prodQueue={prodQueue}
        prodWaitingWoCount={prodWaitingForMaterial.workOrderCount}
        prodWaitingIssueCount={prodWaitingForMaterial.waitingStoreIssueCount}
        procurementPending={procurementPendingSecondary}
        qcBatchCount={qcBatchCount}
        qcHoldCount={qcWqHold}
        qcReworkCount={qcWqRework}
        qcRejectionPct={data.qcRejectionPct}
        rmRisk={rmRiskSecondary}
      />
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
                <span className="text-sky-900/90">Guided workflow ? sample data</span>
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
          {!demo.enabled && pendingActionsDeskProps ? (
            <PendingActionsDashboardCard
              count={pendingActionsDeskProps.count}
              loading={pendingActionsDeskProps.loading}
              error={pendingActionsDeskProps.error}
              description={role === "PRODUCTION" ? PENDING_ACTIONS_PRODUCTION_HELPER : undefined}
            />
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
                  aria-label="Open Dispatch ? dispatch prep (regular, No Qty, and replacement)"
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
                {canViewProductionQaQueue ? (
                  <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard")} aria-label={PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA}>
                    <ErpKpiLabel>{PRODUCTION_QA_TERMS.QA_IN_PROGRESS_LABEL}</ErpKpiLabel>
                    <ErpKpiValue tone={(qcQueue?.length ?? 0) > 0 ? "warn" : "muted"}>
                      {qcQueue ? qcQueue.length : 0}
                    </ErpKpiValue>
                  </ErpKpiSegment>
                ) : null}
                <ErpKpiSegment
                  type="button"
                  title={REGULAR_TERMS.DASHBOARD_STOCK_REPLENISHMENT_TOOLTIP}
                  {...clickTo("/stock?source=dashboard")}
                  aria-label={REGULAR_TERMS.REVIEW_RM_STATUS}
                >
                  <ErpKpiLabel>{REGULAR_TERMS.DASHBOARD_RM_CRITICAL_LABEL}</ErpKpiLabel>
                  <ErpKpiValue
                    tone={
                      (data.rmStockCriticalCount ?? data.rmStockCritical?.length ?? 0) > 0 ? "crit" : "muted"
                    }
                  >
                    {data.rmStockCriticalCount ?? data.rmStockCritical?.length ?? 0}
                  </ErpKpiValue>
                </ErpKpiSegment>
                <ErpKpiSegment
                  type="button"
                  title={REGULAR_TERMS.DASHBOARD_STOCK_REPLENISHMENT_TOOLTIP}
                  {...clickTo("/stock?source=dashboard")}
                  aria-label="Review replenishment low stock"
                >
                  <ErpKpiLabel>{REGULAR_TERMS.DASHBOARD_RM_WARNING_LABEL}</ErpKpiLabel>
                  <ErpKpiValue
                    tone={
                      (data.rmStockWarningCount ?? data.rmStockWarning?.length ?? 0) > 0 ? "warn" : "muted"
                    }
                  >
                    {data.rmStockWarningCount ?? data.rmStockWarning?.length ?? 0}
                  </ErpKpiValue>
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
                    {canViewProductionQaQueue ? (
                      <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard")} aria-label={PRODUCTION_QA_TERMS.QA_BATCHES_KPI}>
                        <ErpKpiLabel>{PRODUCTION_QA_TERMS.QA_IN_PROGRESS_LABEL}</ErpKpiLabel>
                        <ErpKpiValue tone={qcBatchCount > 0 ? "warn" : "muted"}>{qcBatchCount}</ErpKpiValue>
                      </ErpKpiSegment>
                    ) : null}
                    {canViewRmRisk ? (
                      <ErpKpiSegment
                        type="button"
                        title="Sales order / work order material shortages blocking production or issue."
                        {...clickTo(rmControlCenterHref({ onlyBlocked: true, returnTo: "dashboard" }))}
                        aria-label={REGULAR_TERMS.DASHBOARD_WO_RM_BLOCKED_LABEL}
                      >
                        <ErpKpiLabel>{REGULAR_TERMS.DASHBOARD_WO_RM_BLOCKED_LABEL}</ErpKpiLabel>
                        <ErpKpiValue tone={rmRiskCount > 0 ? "crit" : "muted"}>{rmRiskCount}</ErpKpiValue>
                      </ErpKpiSegment>
                    ) : null}
                  </>
                ) : role === "QA" ? (
                  <>
                    <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard")} aria-label={PRODUCTION_QA_TERMS.QA_BATCHES_KPI}>
                      <ErpKpiLabel>Batches</ErpKpiLabel>
                      <ErpKpiValue tone={qcBatchCount > 0 ? "warn" : "muted"}>{qcBatchCount}</ErpKpiValue>
                    </ErpKpiSegment>
                    <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard")} aria-label={PRODUCTION_QA_TERMS.QA_QTY_PENDING_KPI}>
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
            {canViewWoPrepareQueues && !demo.enabled ? (
              <OperationalBlockersCard
        procurementPending={role === "PRODUCTION" ? [] : procurementPendingSecondary}
                storeIssuePending={storeIssuePending}
                allocationFirstPending={allocationFirstPending as any}
                woPrepareQueues={woPrepareQueues}
                loading={
                  procurementPending === null ||
                  storeIssuePending === null ||
                  allocationFirstPending === null ||
                  woPrepareQueues === null
                }
              />
            ) : null}
            {!demo.enabled ? operationalActionQueue : null}
            {!demo.enabled &&
            !operationalActionCardsPresent &&
            !hasVisibleNoQtyContinuation &&
            operationalBlockersReady &&
            (showOperationalLeftPanel || showCommercialRightPanel) ? (
              <DashboardTableEmpty
                compact
                title="Operations clear"
                description="Operations clear ? No shop-floor actions pending right now."
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
          <div className="erp-dash-live-workspace min-h-0 shrink-0 space-y-2">
            <DashboardPausedWorkOrders
              rows={pausedWorkOrders}
              loading={pausedWorkOrders === null}
              error={pausedWorkOrdersError}
              onResumed={() => {
                void apiFetch<ProductionQueueRow[]>("/api/dashboard/production-queue")
                  .then((rows) => setProdQueue(rows))
                  .catch(() => setProdQueue([]));
                void apiFetch<PausedWorkOrderRow[]>("/api/dashboard/paused-work-orders")
                  .then((rows) => setPausedWorkOrders(Array.isArray(rows) ? rows : []))
                  .catch(() => setPausedWorkOrders([]));
              }}
            />
            <DashboardCurrentProductionStatus
              rows={prodQueue}
              loading={prodQueue === null}
              error={prodQueueError}
              hideWhenEmpty
            />
          </div>
        ) : null}

        {liveFactorySection}
      </div>

      <NoQtyDashboardCycleHistoryDialog
        open={noQtyCycleHistoryTarget != null}
        onClose={() => setNoQtyCycleHistoryTarget(null)}
        salesOrderId={noQtyCycleHistoryTarget?.salesOrderId ?? 0}
        salesOrderDocNo={noQtyCycleHistoryTarget?.salesOrderDocNo}
        customerName={noQtyCycleHistoryTarget?.customerName}
      />
    </div>
  );
}
