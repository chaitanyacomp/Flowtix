import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { cn } from "../lib/utils";
import { type NoQtyFlowState, buildNoQtyGuidedHref } from "../lib/noQtyFlowState";
import { resolveNoQtyDashboardContinuation } from "../lib/noQtyDashboardContinuation";
import { prepareNoQtyNextRequirementSheetAndNavigate } from "../lib/noQtyPrepareNextRsNavigate";
import { useToast } from "../contexts/ToastContext";
import { useDemoMode } from "../contexts/DemoModeContext";
import { ApiRequestError } from "../services/api";
import { type DispatchBacklogRow, ROW_NUM_EPS } from "../lib/dispatchBacklog";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { useAuth } from "../hooks/useAuth";
import { AccountsDashboardPage } from "./AccountsDashboardPage";
import { REGULAR_TERMS } from "../lib/flowTerminology";
import type { ResolvedNoQtyContinuation } from "../lib/noQtyDashboardContinuation";

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
    canViewDispatchBacklog: isAdmin || isSales || isDispatch,
    canViewProductionQueue: isAdmin || isProduction,
    canViewQcQueue: isAdmin || isQc,
    canViewRmRisk: isAdmin || isProduction || isStore,
    canViewPurchaseSummary: isAdmin || isStore,
    /** Aligned with backend GET /api/dashboard/continue-working and main nav Dashboard roles. */
    canViewContinueWorking: isAdmin || isSales || isProduction || isQc || isStore,
    /** Next RS (NO_QTY) creation: backend = NEXT_RS_WRITE_ROLES = ADMIN + STORE. */
    canUseOpenNoQtyContinuation: isAdmin || isStore,
  };
}

/**
 * Role-based visibility for the per-category Action Required cards.
 *
 * `dashboardWidgetFlags` controls which API sections a role can *fetch*. This
 * helper controls which workflow cards a role should actually *see and act on*
 * once data is loaded — so STORE never sees production / QC / dispatch /
 * sales-bill CTAs even though continue-working data may include them.
 *
 * Role intent (per ERP philosophy):
 *  - STORE     → RM shortage, material planning / purchase receipts, stock alerts.
 *                NEVER production / QC / dispatch / sales-bill CTAs.
 *  - PRODUCTION→ production cards (and shortage visibility, view-only).
 *                NOT responsible for creating RM POs.
 *  - QC        → QC cards only.
 *  - DISPATCH  → dispatch cards only.
 *  - SALES     → dispatch (their commitment view), sales-bill, enquiry cards.
 *  - ACCOUNTS  → has a separate AccountsDashboardPage; not handled here.
 *  - ADMIN     → all cards.
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
    canShowDispatchCards: isAdmin || isDispatch || isSales,
    canShowProductionCards: isAdmin || isProduction,
    canShowSalesBillCards: isAdmin || isSales,
    /** RM shortage / RM-below-min visibility (ops-impact alerts). */
    canShowRmShortageCards: isAdmin || isStore || isProduction,
    /** Purchase receipts pending — STORE owns GRN, ADMIN sees everything. */
    canShowPurchaseCards: isAdmin || isStore,
    canShowEnquiryCards: isAdmin || isSales,
    /** REGULAR next-RS card links into /production — production owners only. */
    canShowNextRsCard: isAdmin || isProduction,
    /** Whether the user can act on a NO_QTY "Continue Cycle Production" CTA. */
    canActOnProductionCta: isAdmin || isProduction,
  };
}

/**
 * Per-row gate for the NO_QTY continuation list: hide a row whose primary
 * resolved action belongs to a workflow this role cannot act on. The list
 * itself is fetched only for ADMIN + STORE (`canUseOpenNoQtyContinuation`),
 * so STORE here gets rows where the next step is RS authoring; production /
 * QC / dispatch / sales-bill resolved actions are dropped.
 */
function isNoQtyResolvedRelevantForRole(role: string, resolved: ResolvedNoQtyContinuation): boolean {
  if (role === "ADMIN") return true;
  if (role === "STORE") {
    if (resolved.kind === "prepare_next_rs") return true;
    return resolved.label === "Open RS" || resolved.label === "Open requirement sheets";
  }
  return false;
}

/** Empty-state copy that matches the role's operational scope. */
function dashboardClearStateCopy(role: string): { title: string; description: string } {
  switch (role) {
    case "STORE":
      return {
        title: "No material action required right now",
        description: "RM stock and purchase receipts are quiet for your role; metrics above stay live for scan.",
      };
    case "PRODUCTION":
      return {
        title: "No production action pending",
        description: "Work orders and cycles are quiet for your role; metrics above stay live for scan.",
      };
    case "QC":
      return {
        title: "QC queues are clear",
        description: "No batches awaiting QC for your role; metrics above stay live for scan.",
      };
    case "DISPATCH":
      return {
        title: "Dispatch queues are clear",
        description: "No lines ready to ship or bill for your role; metrics above stay live for scan.",
      };
    case "SALES":
      return {
        title: "No customer-facing action pending",
        description: "Enquiries, dispatch commitments, and sales bills are quiet for your role.",
      };
    default:
      return {
        title: "All operations clear",
        description: "Queues and alerts you can act on are quiet for your role; metrics above stay live for scan.",
      };
  }
}

function DashboardTableEmpty({
  title,
  description,
  compact,
}: {
  title: string;
  description?: string;
  /** Single dense row — no flex-grow empty shell */
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
    <div className="flex flex-1 flex-col justify-center px-4 py-6 md:px-6">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          {description ? <p className="mt-0.5 max-w-md text-[13px] leading-snug text-slate-700">{description}</p> : null}
        </div>
      </div>
    </div>
  );
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
}: {
  tier: "blocker" | "approval" | "ready" | "supply";
  title: string;
  detail: string;
  actionLabel: string;
  href: string;
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

  // Whole card is clickable. CTA is a visual button (span) so we don't nest
  // anchors. Hover lift is one-pixel shadow only — no flashy animation.
  return (
    <Link
      to={href}
      state={{ from: "dashboard" }}
      aria-label={`${title} — ${actionLabel}`}
      className={cn(
        "group block rounded-md border py-2 pl-2.5 pr-2.5 shadow-sm no-underline outline-none transition-shadow",
        "hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-1",
        tierClass,
      )}
    >
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold leading-tight tracking-tight text-slate-950">{title}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-slate-700">{detail}</p>
        </div>
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
      </div>
    </Link>
  );
}

/** Dashboard shell — subtle depth for “live ops” without noise */
const DASH_SHELL = "min-h-screen bg-gradient-to-b from-slate-50 via-slate-50 to-slate-100/90";
/** Slightly wider than `max-w-7xl` so desktop uses horizontal space without feeling boxed in */
const DASH_MAX = "mx-auto w-full max-w-[min(100%,90rem)] px-3 pt-1.5 pb-4 md:px-6 md:pt-2 md:pb-5";
const DASH_GRID = "grid max-w-full gap-2";
const DASH_GRID_COMPACT = "grid max-w-full gap-1.5";
const DASH_CARD = "rounded-xl border border-slate-200/95 bg-white shadow-sm";
const DASH_CARD_MUTED =
  "rounded-lg border border-slate-200/70 bg-slate-50/40 shadow-none ring-1 ring-slate-900/[0.02]";
const DASH_CARD_PRIMARY =
  "rounded-xl border border-slate-300/95 bg-white shadow-md ring-1 ring-slate-900/[0.04]";
const DASH_BTN_PRIMARY = "bg-blue-700 text-white hover:bg-blue-800 shadow-sm";

const DASH_BTN_SECONDARY =
  "inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-slate-50";
/** Metrics ribbon — premium operational summary strip. Flat segments, hairline
 *  separators, tnum so columns align vertically when scanned at a glance. */
const DASH_METRICS_RIBBON =
  "flex w-max min-w-full flex-nowrap items-stretch divide-x divide-slate-200 rounded-md border border-slate-300/80 bg-white shadow-sm ring-1 ring-slate-900/[0.03]";
const DASH_METRIC_BTN =
  "flex min-w-[6rem] shrink-0 flex-col justify-center gap-0.5 px-3 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400/40";
const DASH_METRIC_LABEL =
  "text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600 [font-feature-settings:'tnum']";
const DASH_METRIC_VALUE =
  "text-[17px] font-extrabold tabular-nums leading-none tracking-tight text-slate-900 [font-feature-settings:'tnum']";
const DASH_METRIC_VALUE_MUTED = "text-slate-700";
const DASH_METRIC_VALUE_WARN = "text-amber-800";
const DASH_METRIC_VALUE_CRIT = "text-red-800";

/** Clear-queue status — intentional “healthy ops” card, not an empty placeholder */
const DASH_CLEAR_STATUS_CARD =
  "rounded-lg border border-emerald-200/75 bg-white px-2.5 py-1.5 shadow-sm ring-1 ring-emerald-900/[0.06]";

/** Premium table shell for snapshot drill-down tables */
const DASH_TABLE_WRAP_BASE =
  "erp-table-wrap mt-auto max-w-full overflow-x-auto border-t border-slate-200 !rounded-xl";

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
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

/** Display-only labels for NO_QTY planning/cycle CTAs (routes unchanged). */
function dashNoQtyContinuationLabel(label: string): string {
  const map: Record<string, string> = {
    "Open requirement sheets": "Open Requirement Sheets",
    "Open RS": "Open Requirement Sheet",
    "Create Next RS": "Continue NO_QTY Planning",
    "Open Production": "Continue Cycle Production",
    "Open QC": "Open NO_QTY QC",
    "Open Dispatch": "Open NO_QTY Dispatch",
    "Open Sales Bill": "Open NO_QTY Sales Bill",
  };
  if (map[label]) return map[label];
  return label;
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
  /** max(0, WO line qty − approved produced) */
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

type ContinueWorkingRow = {
  key: string;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  itemName: string;
  orderType?: "NO_QTY" | "NORMAL" | string;
  cycleNo?: number | null;
  cycleId?: number | null;
  stageKey: "QC" | "DISPATCH" | "PRODUCTION" | "NEXT_RS" | "DONE" | string;
  awaitingQcQty?: number;
  dispatchableNow?: number;
  productionRemaining?: number;
  lastShortageQty?: number;
  hasPendingQc?: boolean;
  dispatchableQty?: number;
  nextAction?: string | null;
  metricLabel?: string;
  metricQty?: number;
  nextStep: string;
  href: string;
};

/** Subset of GET /api/dashboard/no-qty-active rows used for the Open NO_QTY continuation launcher. */
type DashboardSalesOrderHead = {
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  internalStatus: string;
  cycleId?: number | null;
  cycleNo?: number | null;
  latestRequirementSheetId?: number | null;
  latestRequirementSheetDocNo?: string | null;
  latestRequirementSheetStatus?: string | null;
  latestRequirementSheetCycleId?: number | null;
};

type OpenNoQtyContinuationRow = {
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  cycleNo?: number | null;
  cycleId?: number | null;
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

type ActionRequiredRow = {
  key: string;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  itemName: string;
  orderType?: "NO_QTY" | "NORMAL" | string;
  cycleNo?: number | null;
  /** Present when sourced from continue-working / production queue — used for NO_QTY de-dup only */
  cycleId?: number | null;
  metricQty: number;
  metricLabel?: string;
  buttonLabel?: string;
  href: string;
  group: "QC" | "DISPATCH" | "PRODUCTION" | "NEXT_RS";
};

/** Same NO_QTY SO + cycle on planning launcher row vs production action row — UI de-dup only */
function dashNoQtyCycleKeysMatch(
  open: Pick<OpenNoQtyContinuationRow, "salesOrderId" | "cycleId" | "cycleNo">,
  wo: Pick<ActionRequiredRow, "salesOrderId" | "cycleId" | "cycleNo">,
): boolean {
  if (open.salesOrderId !== wo.salesOrderId) return false;
  const oCid = open.cycleId != null && Number(open.cycleId) > 0 ? Number(open.cycleId) : null;
  const wCid = wo.cycleId != null && Number(wo.cycleId) > 0 ? Number(wo.cycleId) : null;
  if (oCid != null && wCid != null) return oCid === wCid;
  const oCno = open.cycleNo != null && Number.isFinite(Number(open.cycleNo)) ? Number(open.cycleNo) : null;
  const wCno = wo.cycleNo != null && Number.isFinite(Number(wo.cycleNo)) ? Number(wo.cycleNo) : null;
  if (oCno != null && wCno != null) return oCno === wCno;
  if (oCid != null && wCno != null) return oCid === wCno;
  if (oCno != null && wCid != null) return oCno === wCid;
  return false;
}

function findMergedNoQtyProdActionForOpenRow(
  open: OpenNoQtyContinuationRow,
  woProdNoQty: ActionRequiredRow[],
): ActionRequiredRow | undefined {
  const forSo = woProdNoQty.filter((w) => w.salesOrderId === open.salesOrderId);
  if (forSo.length === 0) return undefined;
  const byCycle = forSo.find((w) => dashNoQtyCycleKeysMatch(open, w));
  if (byCycle) return byCycle;
  if (forSo.length === 1) return forSo[0];
  return undefined;
}

/**
 * UX-only RM-availability classifier for the NO_QTY cycle production CTA.
 *
 * Reads the SAME signals already present on the dashboard (no new API calls,
 * no math change):
 *   - `hasMergedWo`   : true when partition logic placed at least one
 *                       producible NO_QTY WO line into Action Required.
 *   - `lastShortageQty` (per cycle row) : non-zero when the latest cycle has a
 *                       remaining material shortage signalled by the API.
 *   - `prodQueue` (optional, only for roles that can see it): per-line
 *                       `nextAction` = PRODUCTION_PENDING vs NEXT_RS_REQUIRED.
 *
 * Returns three operational states:
 *   - PRODUCIBLE     — cycle has producible balance and no shortage signal.
 *                      Continue Cycle Production stays enabled, no warning.
 *   - PARTIAL        — cycle has producible balance AND a shortage signal on
 *                      other lines. Button stays enabled (partial production
 *                      is allowed per business rule) + warning helper shown.
 *   - FULLY_BLOCKED  — every line for the cycle is awaiting next-RS due to
 *                      RM shortage and no producible balance remains. Button
 *                      is disabled with a warning state.
 *
 * IMPORTANT: This function is presentational only. It never changes what the
 * backend allocates, queues, or persists. It only adjusts the dashboard CTA so
 * operators don't get a misleading "Continue Cycle Production" navigation when
 * the underlying state cannot actually be advanced.
 */
type NoQtyProductionAvailability = "PRODUCIBLE" | "PARTIAL" | "FULLY_BLOCKED";

function detectNoQtyProductionAvailability(args: {
  salesOrderId: number;
  cycleId: number | null;
  prodQueue: ProductionQueueRow[] | null;
  hasMergedWo: boolean;
  rowLastShortageQty: number | null;
  /**
   * When true, any RM shortage signal for the cycle collapses to FULLY_BLOCKED
   * even if some lines remain producible. Used for STORE role where the
   * operator's path is shortage → RM PO → GRN → production. A misleading
   * "Continue Cycle Production" CTA must never appear with active shortage.
   */
  strict?: boolean;
}): NoQtyProductionAvailability {
  const { salesOrderId, cycleId, prodQueue, hasMergedWo, rowLastShortageQty, strict } = args;
  const shortagePresent = Number(rowLastShortageQty ?? 0) > ROW_NUM_EPS;
  const collapsePartialToBlocked = strict === true;

  // No prodQueue visibility (e.g. STORE role). Fall back to mergedWo presence.
  if (!prodQueue || prodQueue.length === 0) {
    if (hasMergedWo) {
      if (shortagePresent) return collapsePartialToBlocked ? "FULLY_BLOCKED" : "PARTIAL";
      return "PRODUCIBLE";
    }
    return shortagePresent ? "FULLY_BLOCKED" : "PRODUCIBLE";
  }

  const cidNum = cycleId != null && Number(cycleId) > 0 ? Number(cycleId) : null;
  const rows = prodQueue.filter((p) => {
    if (p.salesOrderId !== salesOrderId) return false;
    if (p.orderType !== "NO_QTY") return false;
    if (cidNum != null && p.cycleId != null && Number(p.cycleId) !== cidNum) return false;
    return true;
  });

  // No production queue rows resolved for this SO+cycle — fall back to mergedWo.
  if (rows.length === 0) {
    if (hasMergedWo) {
      if (shortagePresent) return collapsePartialToBlocked ? "FULLY_BLOCKED" : "PARTIAL";
      return "PRODUCIBLE";
    }
    return shortagePresent ? "FULLY_BLOCKED" : "PRODUCIBLE";
  }

  const producible = rows.some(
    (r) => r.nextAction === "PRODUCTION_PENDING" && Number(r.balanceQty ?? 0) > ROW_NUM_EPS,
  );
  const blocked = rows.some(
    (r) => r.nextAction === "NEXT_RS_REQUIRED" && Number(r.lastShortageQty ?? 0) > ROW_NUM_EPS,
  );

  if (!producible && (blocked || shortagePresent)) return "FULLY_BLOCKED";
  if (producible && (blocked || shortagePresent)) {
    return collapsePartialToBlocked ? "FULLY_BLOCKED" : "PARTIAL";
  }
  return "PRODUCIBLE";
}

/**
 * Collapse duplicate non-dispatch stages per SO, but keep every DISPATCH row (NO_QTY can have multiple cycles).
 * Order: QC → dispatch (oldest cycle first) → other stages by priority.
 */
function dedupeContinueWorkingBySalesOrder(rows: ContinueWorkingRow[]): ContinueWorkingRow[] {
  const stageRank = (sk: string) =>
    sk === "QC"
      ? 0
      : sk === "DISPATCH"
        ? 1
        : sk === "SALES_BILL"
          ? 2
          : sk === "PRODUCTION"
            ? 3
            : sk === "NEXT_RS"
              ? 4
              : 5;
  const qcBySo = new Map<number, ContinueWorkingRow>();
  const otherBySo = new Map<number, ContinueWorkingRow>();
  const dispatchRows: ContinueWorkingRow[] = [];
  for (const r of rows) {
    if (r.stageKey === "DONE" || r.nextStep === "Completed / Waiting") continue;
    if (r.stageKey === "DISPATCH") {
      dispatchRows.push(r);
      continue;
    }
    if (r.stageKey === "QC") {
      const prev = qcBySo.get(r.salesOrderId);
      if (!prev || stageRank(String(r.stageKey)) < stageRank(String(prev.stageKey))) qcBySo.set(r.salesOrderId, r);
      continue;
    }
    const prev = otherBySo.get(r.salesOrderId);
    if (!prev || stageRank(String(r.stageKey)) < stageRank(String(prev.stageKey))) {
      otherBySo.set(r.salesOrderId, r);
    }
  }
  dispatchRows.sort((a, b) => {
    const ca = Number(a.cycleNo ?? 1e9);
    const cb = Number(b.cycleNo ?? 1e9);
    if (ca !== cb) return ca - cb;
    return a.salesOrderId - b.salesOrderId;
  });
  const qcList = [...qcBySo.values()].sort((a, b) => a.salesOrderId - b.salesOrderId);
  const otherList = [...otherBySo.values()].sort((a, b) => {
    const ra = stageRank(String(a.stageKey));
    const rb = stageRank(String(b.stageKey));
    if (ra !== rb) return ra - rb;
    return a.salesOrderId - b.salesOrderId;
  });
  return [...qcList, ...dispatchRows, ...otherList];
}

/**
 * Same SO at most once per group for REGULAR flows. NO_QTY may appear in QC + Dispatch together
 * (next-cycle RS continuation is not Action Required — see Open NO_QTY Orders card).
 */
function enforceUniqueSalesOrdersAcrossGroups(groups: {
  qc: ActionRequiredRow[];
  dispatch: ActionRequiredRow[];
  production: ActionRequiredRow[];
  nextRs: ActionRequiredRow[];
}): {
  qc: ActionRequiredRow[];
  dispatch: ActionRequiredRow[];
  production: ActionRequiredRow[];
  nextRs: ActionRequiredRow[];
} {
  const qcIds = new Set(groups.qc.map((r) => r.salesOrderId));
  const dispatch = groups.dispatch.filter(
    (r) => !qcIds.has(r.salesOrderId) || r.orderType === "NO_QTY",
  );
  const dispIds = new Set(dispatch.map((r) => r.salesOrderId));
  const production = groups.production.filter((r) => !qcIds.has(r.salesOrderId) && !dispIds.has(r.salesOrderId));
  const prodIds = new Set(production.map((r) => r.salesOrderId));
  const nextRs = groups.nextRs.filter((r) => {
    if (prodIds.has(r.salesOrderId)) return false;
    if (qcIds.has(r.salesOrderId) && r.orderType !== "NO_QTY") return false;
    if (dispIds.has(r.salesOrderId) && r.orderType !== "NO_QTY") return false;
    return true;
  });
  return { qc: groups.qc, dispatch, production, nextRs };
}

function partitionContinueWorkingForActions(rows: ContinueWorkingRow[]): {
  qc: ActionRequiredRow[];
  dispatch: ActionRequiredRow[];
  production: ActionRequiredRow[];
  nextRs: ActionRequiredRow[];
} {
  const qc: ActionRequiredRow[] = [];
  const dispatch: ActionRequiredRow[] = [];
  const production: ActionRequiredRow[] = [];
  const nextRs: ActionRequiredRow[] = [];
  for (const r of rows) {
    if (r.stageKey === "DONE" || r.nextStep === "Completed / Waiting") continue;

    const base = {
      key: r.key,
      salesOrderId: r.salesOrderId,
      salesOrderDocNo: r.salesOrderDocNo,
      customerName: r.customerName,
      itemName: r.itemName,
      orderType: r.orderType,
      cycleNo: r.cycleNo,
      cycleId: r.cycleId ?? null,
      href: r.href,
    };

    if (r.stageKey === "QC") {
      const mq = Number(r.awaitingQcQty ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      qc.push({ ...base, group: "QC", metricQty: mq, buttonLabel: "Continue QC" });
    } else if (r.stageKey === "DISPATCH") {
      const mq = Number(r.dispatchableNow ?? r.dispatchableQty ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      dispatch.push({
        ...base,
        group: "DISPATCH",
        metricQty: mq,
        metricLabel: r.metricLabel ?? "Dispatch pending",
        buttonLabel: "Go to Dispatch",
      });
    } else if (r.stageKey === "SALES_BILL") {
      const mq = Number(r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      production.push({
        ...base,
        group: "PRODUCTION",
        metricQty: mq,
        metricLabel: r.metricLabel ?? "Sales bill pending",
        buttonLabel: "Create Sales Bill",
      });
    } else if (r.stageKey === "NEXT_RS") {
      /** NO_QTY “next RS” is a continuation option on the dashboard, not Action Required. */
      if (r.orderType === "NO_QTY") continue;
      const mq = Number(r.lastShortageQty ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      nextRs.push({
        ...base,
        group: "NEXT_RS",
        metricQty: mq,
        metricLabel: r.metricLabel ?? "Last shortage Qty",
        buttonLabel: "Create Next RS",
      });
    } else if (r.stageKey === "PRODUCTION") {
      const mq = Number(r.productionRemaining ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      production.push({ ...base, group: "PRODUCTION", metricQty: mq, buttonLabel: "Continue Production" });
    }
  }
  return { qc, dispatch, production, nextRs };
}

function prodQueueNextRank(n?: string): number {
  if (n === "QC_PENDING") return 0;
  if (n === "DISPATCH_PENDING") return 1;
  if (n === "SALES_BILL_PENDING") return 2;
  if (n === "PRODUCTION_PENDING") return 3;
  if (n === "NEXT_RS_REQUIRED") return 4;
  return 9;
}

/**
 * When continue-working is unavailable, mirror backend priority per sales order: QC → dispatch → production / next RS.
 */
function buildActionRequiredFromQueues(
  qcRows: QcQueueRow[] | null,
  backlogRows: DispatchBacklogRow[] | null,
  prodRows: ProductionQueueRow[] | null,
): { qc: ActionRequiredRow[]; dispatch: ActionRequiredRow[]; production: ActionRequiredRow[]; nextRs: ActionRequiredRow[] } {
  const qc: ActionRequiredRow[] = [];
  const dispatch: ActionRequiredRow[] = [];
  const production: ActionRequiredRow[] = [];
  const nextRs: ActionRequiredRow[] = [];

  type Agg = {
    salesOrderId: number;
    awaitingQc: number;
    dispatchableNow: number;
    productionRemaining: number;
    customerName: string;
    itemName: string;
    hrefQc: string;
    hrefDisp: string;
    hrefProd: string;
    bestProdRank: number;
    bestProdMetric: number;
    prodNextAction?: ProductionQueueNextAction;
    nextRsMetricLabel?: string;
    orderType?: string;
    bestProdCycleId?: number | null;
  };
  const bySo = new Map<number, Agg>();

  function ensure(soId: number): Agg {
    let a = bySo.get(soId);
    if (!a) {
      const sid = encodeURIComponent(String(soId));
      a = {
        salesOrderId: soId,
        awaitingQc: 0,
        dispatchableNow: 0,
        productionRemaining: 0,
        customerName: "",
        itemName: "",
        hrefQc: `/qc-entry?salesOrderId=${sid}`,
        hrefDisp: `/dispatch?salesOrderId=${sid}`,
        hrefProd: `/production?salesOrderId=${sid}&from=dashboard`,
        bestProdRank: 99,
        bestProdMetric: 0,
        nextRsMetricLabel: undefined,
      };
      bySo.set(soId, a);
    }
    return a;
  }

  if (backlogRows) {
    for (const b of backlogRows) {
      const dn = Number(b.dispatchableNow ?? 0);
      if (dn <= ROW_NUM_EPS) continue;
      const a = ensure(b.salesOrderId);
      if (dn > a.dispatchableNow) {
        a.dispatchableNow = dn;
        a.customerName = b.customerName;
        a.itemName = b.itemName;
      }
    }
  }
  if (qcRows) {
    for (const q of qcRows) {
      const pend = Number(q.pendingQcQty ?? 0);
      if (pend <= ROW_NUM_EPS) continue;
      const a = ensure(q.salesOrderId);
      if (pend > a.awaitingQc) {
        a.awaitingQc = pend;
        a.itemName = q.itemName;
      }
    }
  }
  if (prodRows) {
    for (const p of prodRows) {
      if (p.status !== "PENDING" && p.status !== "IN_PROGRESS") continue;
      const bal = Number(p.balanceQty ?? 0);
      if (bal <= ROW_NUM_EPS) continue;
      const a = ensure(p.salesOrderId);
      if (p.orderType) a.orderType = p.orderType;
      a.productionRemaining = Math.max(a.productionRemaining, bal);
      const rank = prodQueueNextRank(p.nextAction);
      const metric =
        p.orderType === "NO_QTY" && p.nextAction === "NEXT_RS_REQUIRED"
          ? Number(p.lastShortageQty ?? 0)
          : bal;
      if (
        rank < a.bestProdRank ||
        (rank === a.bestProdRank && metric > a.bestProdMetric + ROW_NUM_EPS)
      ) {
        a.bestProdRank = rank;
        a.bestProdMetric = metric;
        a.prodNextAction = p.nextAction as ProductionQueueNextAction | undefined;
        a.bestProdCycleId = p.cycleId ?? null;
        a.nextRsMetricLabel =
          p.nextAction === "NEXT_RS_REQUIRED" ? (p.qtyLabel ?? "Last shortage Qty") : undefined;
        if (p.actionHref) {
          a.hrefProd = p.actionHref;
        } else if (p.orderType === "NO_QTY") {
          /**
           * Fallback path (continue-working unavailable). Default hrefProd was REGULAR-shaped
           * (`/production?salesOrderId=...&from=dashboard`); for NO_QTY rows we must preserve
           * NO_QTY identity (source=no_qty_so + cycleId) so ProductionPage never falls back
           * to the REGULAR render branch.
           */
          a.hrefProd = buildNoQtyGuidedHref({
            to: "/production",
            salesOrderId: a.salesOrderId,
            cycleId: p.cycleId ?? null,
            fromStep: "work_order",
          });
        }
        if (p.customerName) a.customerName = p.customerName;
        a.itemName = p.itemName;
      }
    }
  }

  const soIds = [...bySo.keys()].sort((x, y) => x - y);
  for (const soId of soIds) {
    const a = bySo.get(soId)!;
    const key = `so-${soId}`;
    if (a.awaitingQc > ROW_NUM_EPS) {
      qc.push({
        key: `${key}-qc`,
        salesOrderId: soId,
        customerName: a.customerName || "—",
        itemName: a.itemName || "—",
        metricQty: a.awaitingQc,
        href: a.hrefQc,
        group: "QC",
        buttonLabel: "Continue QC",
        ...(a.orderType ? { orderType: a.orderType } : {}),
      });
    } else if (a.dispatchableNow > ROW_NUM_EPS) {
      dispatch.push({
        key: `${key}-disp`,
        salesOrderId: soId,
        customerName: a.customerName || "—",
        itemName: a.itemName || "—",
        metricQty: a.dispatchableNow,
        href: a.hrefDisp,
        group: "DISPATCH",
        buttonLabel: "Go to Dispatch",
        ...(a.orderType ? { orderType: a.orderType } : {}),
      });
    } else if (a.prodNextAction === "SALES_BILL_PENDING" && a.bestProdMetric > ROW_NUM_EPS) {
      production.push({
        key: `${key}-salesbill`,
        salesOrderId: soId,
        customerName: a.customerName || "—",
        itemName: a.itemName || "—",
        metricQty: a.bestProdMetric,
        metricLabel: "Sales bill pending",
        href: a.hrefProd,
        group: "PRODUCTION",
        buttonLabel: "Create Sales Bill",
        ...(a.orderType ? { orderType: a.orderType } : {}),
        cycleId: a.bestProdCycleId ?? null,
      });
    } else if (a.prodNextAction === "NEXT_RS_REQUIRED" && a.bestProdMetric > ROW_NUM_EPS) {
      /** NO_QTY next-cycle RS is surfaced only under Open NO_QTY Orders (neutral launcher). */
      if (a.orderType !== "NO_QTY") {
        nextRs.push({
          key: `${key}-nextrs`,
          salesOrderId: soId,
          customerName: a.customerName || "—",
          itemName: a.itemName || "—",
          metricQty: a.bestProdMetric,
          metricLabel: a.nextRsMetricLabel ?? "Last shortage Qty",
          href: a.hrefProd,
          group: "NEXT_RS",
          buttonLabel: "Create Next RS",
          ...(a.orderType ? { orderType: a.orderType } : {}),
        });
      }
    } else if (a.productionRemaining > ROW_NUM_EPS) {
      production.push({
        key: `${key}-prod`,
        salesOrderId: soId,
        customerName: a.customerName || "—",
        itemName: a.itemName || "—",
        metricQty: a.bestProdMetric > ROW_NUM_EPS ? a.bestProdMetric : a.productionRemaining,
        href: a.hrefProd,
        group: "PRODUCTION",
        buttonLabel: "Continue Production",
        ...(a.orderType ? { orderType: a.orderType } : {}),
        cycleId: a.bestProdCycleId ?? null,
      });
    }
  }

  return { qc, dispatch, production, nextRs };
}

export function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const role = auth.user?.role ?? "";
  const demo = useDemoMode();

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
    canViewContinueWorking;

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
  const [dashboardRsPrepareSoId, setDashboardRsPrepareSoId] = React.useState<number | null>(null);
  const [salesOrdersForDashboard, setSalesOrdersForDashboard] = React.useState<DashboardSalesOrderHead[] | null>(null);

  React.useLayoutEffect(() => {
    if (!canViewContinueWorking) {
      setContinueWorking(null);
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
          }
        })
        .catch(() => {
          if (mounted) {
            setContinueWorking([]);
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
  }, [canUseOpenNoQtyContinuation, demo.enabled]);

  const noQtyMetricsBySoId = React.useMemo(() => {
    const m = new Map<number, { shortage?: number; dispatch?: number }>();
    if (prodQueue) {
      for (const r of prodQueue) {
        if (r.orderType !== "NO_QTY") continue;
        const cur = m.get(r.salesOrderId) ?? {};
        if (r.nextAction === "NEXT_RS_REQUIRED") {
          const sq = Number(r.lastShortageQty ?? 0);
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
        const sq = Number(r.lastShortageQty ?? r.metricQty ?? 0);
        if (Number.isFinite(sq) && sq > ROW_NUM_EPS) cur.shortage = sq;
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
          ? "Draft requirement sheet is open"
          : shortage != null && shortage > ROW_NUM_EPS
            ? "Continue NO_QTY planning cycle"
            : "Open NO_QTY planning cycle";
      const hintDoc = so.latestRequirementSheetDocNo?.trim();
      out.push({
        salesOrderId: so.salesOrderId,
        salesOrderDocNo: so.salesOrderDocNo ?? null,
        customerName: so.customerName?.trim() ? so.customerName : "-",
        cycleNo: so.cycleNo ?? null,
        cycleId: so.cycleId ?? null,
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
              row?.cycleId != null && Number(row.cycleId) > 0 ? Number(row.cycleId) : null;
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
  ]);

  const hasNoQtyContinuationInActionRequired =
    !demo.enabled && canUseOpenNoQtyContinuation && openNoQtyContinuationRows.length > 0;

  /**
   * Role-filtered NO_QTY continuation rows for rendering.
   *
   * The dashboard fetches the NO_QTY continuation list for ADMIN + STORE
   * (`canUseOpenNoQtyContinuation`). Each row resolves to a primary action via
   * `resolveNoQtyDashboardContinuation`; for non-ADMIN roles we keep only
   * rows whose primary action belongs to that role (e.g. STORE → RS authoring
   * only, never production-side CTAs).
   *
   * Computed lazily inside render via `noQtyFlowBySo`; flows may still be
   * loading, in which case `resolveNoQtyDashboardContinuation` falls back to
   * "Open requirement sheets" (an RS-authoring action — appropriate for STORE).
   */
  const visibleOpenNoQtyContinuationRows = React.useMemo(() => {
    if (!hasNoQtyContinuationInActionRequired) return [] as OpenNoQtyContinuationRow[];
    if (role === "ADMIN") return openNoQtyContinuationRows;
    return openNoQtyContinuationRows.filter((row) => {
      const flow = noQtyFlowBySo[row.salesOrderId] ?? null;
      const resolved = resolveNoQtyDashboardContinuation({
        salesOrderId: row.salesOrderId,
        cycleId: row.cycleId,
        latestRequirementSheetId: row.latestRequirementSheetId,
        lastRsStatus: row.lastRsStatus,
        flow,
      });
      return isNoQtyResolvedRelevantForRole(role, resolved);
    });
  }, [hasNoQtyContinuationInActionRequired, openNoQtyContinuationRows, noQtyFlowBySo, role]);

  const hasVisibleNoQtyContinuation = visibleOpenNoQtyContinuationRows.length > 0;

  const loading =
    (canViewOverallSummary && data === null && !error) ||
    (canViewDispatchBacklog && backlog === null) ||
    (canViewProductionQueue && prodQueue === null) ||
    (canViewQcQueue && qcQueue === null) ||
    (canViewRmRisk && rmRisk === null) ||
    (canViewPurchaseSummary && purchaseSummary === null) ||
    (canViewContinueWorking && continueWorking === null);

  const actionRequiredGroups = React.useMemo(() => {
    let g: {
      qc: ActionRequiredRow[];
      dispatch: ActionRequiredRow[];
      production: ActionRequiredRow[];
      nextRs: ActionRequiredRow[];
    };
    if (canViewContinueWorking && continueWorking !== null) {
      g = partitionContinueWorkingForActions(dedupeContinueWorkingBySalesOrder(continueWorking));
    } else {
      g = buildActionRequiredFromQueues(
        canViewQcQueue ? qcQueue : null,
        canViewDispatchBacklog ? backlog : null,
        canViewProductionQueue ? prodQueue : null,
      );
    }
    return enforceUniqueSalesOrdersAcrossGroups(g);
  }, [
    canViewContinueWorking,
    continueWorking,
    canViewQcQueue,
    qcQueue,
    canViewDispatchBacklog,
    backlog,
    canViewProductionQueue,
    prodQueue,
  ]);

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
          <p className="text-sm text-slate-600">Loading…</p>
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

  const salesBillActions = actionRequiredGroups.production.filter((r) => r.buttonLabel === "Create Sales Bill");
  const woProductionActions = actionRequiredGroups.production.filter((r) => r.buttonLabel !== "Create Sales Bill");

  const qcDashRegular = actionRequiredGroups.qc.filter((r) => !isDashActionNoQty(r));
  const qcDashNoQty = actionRequiredGroups.qc.filter(isDashActionNoQty);
  const dispatchDashRegular = actionRequiredGroups.dispatch.filter((r) => !isDashActionNoQty(r));
  const dispatchDashNoQty = actionRequiredGroups.dispatch.filter(isDashActionNoQty);
  const woProdRegular = woProductionActions.filter((r) => !isDashActionNoQty(r));
  const woProdNoQty = woProductionActions.filter(isDashActionNoQty);
  const mergedNoQtyWoProdKeys = new Set<string>();
  if (hasNoQtyContinuationInActionRequired && openNoQtyContinuationRows.length > 0 && woProdNoQty.length > 0) {
    for (const open of openNoQtyContinuationRows) {
      const w = findMergedNoQtyProdActionForOpenRow(open, woProdNoQty);
      if (w) mergedNoQtyWoProdKeys.add(w.key);
    }
  }
  const woProdNoQtyStandalone = woProdNoQty.filter((w) => !mergedNoQtyWoProdKeys.has(w.key));
  const salesBillRegular = salesBillActions.filter((r) => !isDashActionNoQty(r));
  const salesBillNoQty = salesBillActions.filter(isDashActionNoQty);

  const qcBatchCount = canViewQcQueue ? (qcQueue?.length ?? 0) : 0;
  const prepDispatchLines =
    canViewOverallSummary && data != null ? Number(data.pendingDispatchCount ?? 0) : 0;
  const rmRiskCount = canViewRmRisk ? (rmRisk?.length ?? 0) : 0;
  const purchaseLineCount = canViewPurchaseSummary ? (purchaseSummary?.length ?? 0) : 0;

  // Role-filtered attention check. A pending action only "counts" toward
  // the operations-attention banner when the current role can actually act
  // on it. Without this filter, a STORE user with a pending PRODUCTION
  // queue would see "operations not clear" yet have no visible action card.
  const hasOperationalQueueAttention =
    (actionVisibility.canShowRmShortageCards && rmRiskCount > 0) ||
    (actionVisibility.canShowQcCards && canViewQcQueue && qcWqHold > 0) ||
    (actionVisibility.canShowQcCards && canViewQcQueue && qcWqLegacy > 0) ||
    (actionVisibility.canShowQcCards && canViewQcQueue && qcWqRework > 0) ||
    (actionVisibility.canShowQcCards && canViewQcQueue && qcBatchCount > 0) ||
    (actionVisibility.canShowQcCards && actionRequiredGroups.qc.length > 0) ||
    (actionVisibility.canShowDispatchCards && actionRequiredGroups.dispatch.length > 0) ||
    (actionVisibility.canShowProductionCards && woProductionActions.length > 0) ||
    (actionVisibility.canShowSalesBillCards && salesBillActions.length > 0) ||
    (actionVisibility.canShowNextRsCard && actionRequiredGroups.nextRs.length > 0) ||
    (actionVisibility.canShowPurchaseCards && purchaseLineCount > 0) ||
    (canViewOverallSummary &&
      data != null &&
      ((actionVisibility.canShowRmShortageCards && data.rmStockAlert.length > 0) ||
        (actionVisibility.canShowDispatchCards && data.pendingDispatchCount > 0) ||
        (actionVisibility.canShowEnquiryCards && data.openEnquiries > 0)));

  const opsAttentionClear = !hasOperationalQueueAttention && !hasVisibleNoQtyContinuation;

  const opsQueuesReady =
    (!canViewDispatchBacklog || backlog !== null) &&
    (!canViewProductionQueue || prodQueue !== null) &&
    (!canViewQcQueue || qcQueue !== null) &&
    (!canViewRmRisk || rmRisk !== null) &&
    (!canViewPurchaseSummary || purchaseSummary !== null);

  const noOperationalFetchErrors =
    !backlogError && !prodQueueError && !qcQueueError && !rmRiskError && !purchaseSummaryError;

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

  const qcRejMetricValueClass =
    data == null || data.qcRejectionPct <= 0
      ? DASH_METRIC_VALUE_MUTED
      : data.qcRejectionPct >= 12
        ? DASH_METRIC_VALUE_CRIT
        : DASH_METRIC_VALUE_WARN;

  const inventorySnapshotBothClear =
    data != null && data.fgStock.length === 0 && data.rmStockAlert.length === 0;

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

  const showOperationalQueueSection =
    !demo.enabled && (hasOperationalQueueAttention || hasVisibleNoQtyContinuation);

  const neutralDashAlertNodes: React.ReactNode[] = [];
  const regularFlowDashAlertNodes: React.ReactNode[] = [];
  const noQtyFlowDashAlertNodes: React.ReactNode[] = [];

  const dashActionGrid = "grid gap-1 sm:grid-cols-2 sm:gap-1.5 xl:grid-cols-3";
  const dashFlowSectionLabel = "text-[10px] font-bold uppercase tracking-wider text-slate-800";
  const dashFlowSectionLabelNoQty = "text-[10px] font-bold uppercase tracking-wider text-slate-900";

  if (actionVisibility.canShowRmShortageCards && canViewRmRisk && rmRisk != null && rmRisk.length > 0) {
    const blockedWoLines = rmRisk.length;
    const affectedItemCount = new Set(rmRisk.map((r) => r.itemId)).size;
    // Severity: large multi-line shortages get blocker tier; smaller stays amber-approval.
    const rmSeverity: "blocker" | "approval" = blockedWoLines >= 3 ? "blocker" : "approval";
    // Helper wording clarifies the CTA opens the shortage planning workspace
    // (review-only) — operator goes there to plan RM purchase. We do NOT
    // create POs from the dashboard.
    const rmBase =
      affectedItemCount > 0 && affectedItemCount !== blockedWoLines
        ? `${blockedWoLines} WO line(s) blocked · ${affectedItemCount} item(s) short`
        : `${blockedWoLines} WO line(s) blocked on material`;
    const rmDetail = `${rmBase} — opens shortage planning workspace`;
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="rm-shortage-wo"
        tier={rmSeverity}
        title="RM shortage — production blocked"
        detail={rmDetail}
        actionLabel="Open RM Shortage Workspace"
        href="/reports/rm-shortage?source=dashboard"
      />,
    );
  }

  if (actionVisibility.canShowRmShortageCards && canViewOverallSummary && data != null && data.rmStockAlert.length > 0) {
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
        title="Regular flow — next requirement sheet"
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
    neutralDashAlertNodes.push(
      <OperationalDashCard
        key="qc-batch"
        tier="ready"
        title="Production QC pending"
        detail={`${qcBatchCount} batch(es) awaiting first-pass QC (regular + NO_QTY)`}
        actionLabel="Open QC Queue"
        href="/qc-entry?source=dashboard#qc-production-pending"
      />,
    );
  }

  if (actionVisibility.canShowQcCards && qcDashRegular.length > 0) {
    regularFlowDashAlertNodes.push(
      <OperationalDashCard
        key="qc-pipeline-regular"
        tier="ready"
        title="Production QC pending — regular orders"
        detail={`${qcDashRegular.length} line(s) with quantity ready for QC on regular (NORMAL) SO work`}
        actionLabel="Open Regular QC"
        href="/qc-entry?source=dashboard"
      />,
    );
  }

  if (actionVisibility.canShowQcCards && qcDashNoQty.length > 0) {
    noQtyFlowDashAlertNodes.push(
      <OperationalDashCard
        key="qc-pipeline-no-qty"
        tier="ready"
        title="Production QC pending — NO_QTY cycles"
        detail={`${qcDashNoQty.length} line(s) with quantity ready for QC on NO_QTY cycle work`}
        actionLabel="Open NO_QTY QC"
        href="/qc-entry?source=dashboard"
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
        title="Production pending — regular SO(s)"
        detail={`${woProdRegular.length} regular WO line(s) still on the shop floor`}
        actionLabel="Continue Production"
        href="/production?source=dashboard"
      />,
    );
  }

  if (actionVisibility.canShowProductionCards && woProdNoQtyStandalone.length > 0) {
    /**
     * NO_QTY production CTA must always preserve NO_QTY identity (source=no_qty_so + salesOrderId
     * + cycleId) so ProductionPage renders the NO_QTY branch, never the REGULAR fallback.
     * For aggregated cards we bind to the first standalone row's SO/cycle; multi-row cases land
     * the operator on that cycle's NO_QTY production page from where they can navigate further.
     */
    const noQtyProdAggregateHref = ((): string => {
      const first = woProdNoQtyStandalone[0];
      if (first && first.salesOrderId > 0) {
        return buildNoQtyGuidedHref({
          to: "/production",
          salesOrderId: first.salesOrderId,
          cycleId: first.cycleId ?? null,
          fromStep: "work_order",
        });
      }
      return "/work-orders?soMode=NO_QTY&from=dashboard";
    })();
    noQtyFlowDashAlertNodes.push(
      <OperationalDashCard
        key="wo-prod-no-qty"
        tier="ready"
        title="Cycle production pending — NO_QTY"
        detail={`${woProdNoQtyStandalone.length} NO_QTY WO line(s) still on the shop floor (cycle-driven)`}
        actionLabel="Continue Cycle Production"
        href={noQtyProdAggregateHref}
      />,
    );
  }

  if (actionVisibility.canShowSalesBillCards && salesBillRegular.length > 0) {
    regularFlowDashAlertNodes.push(
      <OperationalDashCard
        key="sales-bill-regular"
        tier="ready"
        title="Sales bill pending — regular"
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
        title="Sales bill pending — NO_QTY"
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
    if (dispatchReadyTotal === 0 && prepLines > 0) {
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
              ? ` · ${prepLines} line(s) in dispatch prep (all SO types)`
              : ` · ${prepLines} line(s) still in dispatch prep`;
        }
        regularFlowDashAlertNodes.push(
          <OperationalDashCard
            key="dispatch-regular"
            tier="ready"
            title="Dispatch queue — regular SO(s)"
            detail={dRegular}
            actionLabel="Open Regular Dispatch"
            href="/dispatch?source=dashboard"
          />,
        );
      }
      if (dispatchDashNoQty.length > 0) {
        let dNq = `${dispatchDashNoQty.length} NO_QTY cycle line(s) ready to ship or bill`;
        if (prepLines > 0 && dispatchDashRegular.length === 0) {
          dNq += ` · ${prepLines} line(s) still in dispatch prep`;
        }
        noQtyFlowDashAlertNodes.push(
          <OperationalDashCard
            key="dispatch-no-qty"
            tier="ready"
            title="Dispatch queue — NO_QTY cycles"
            detail={dNq}
            actionLabel="Open NO_QTY Dispatch"
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

  if (actionVisibility.canShowEnquiryCards && canViewOverallSummary && data != null && data.openEnquiries > 0) {
    neutralDashAlertNodes.push(
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

  const workflowDashGroupsPresent =
    neutralDashAlertNodes.length > 0 ||
    regularFlowDashAlertNodes.length > 0 ||
    noQtyFlowDashAlertNodes.length > 0;

  const operationalActionCardsPresent =
    workflowDashGroupsPresent || hasVisibleNoQtyContinuation;

  const operationalActionQueue =
    showOperationalQueueSection ? (
      <Card
        className={cn(
          operationalActionCardsPresent ? DASH_CARD_PRIMARY : DASH_CARD,
          operationalActionCardsPresent && "border-l-[4px] border-l-blue-700",
        )}
      >
        <CardHeader className="border-b border-slate-100 p-2 md:p-2.5 md:pb-2">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(255,255,255,1)] ring-1 ring-emerald-600/25"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <CardTitle className="text-[15px] font-extrabold leading-tight tracking-tight text-slate-950">
                Action required
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5 p-2 pt-1.5 md:p-3 md:pt-2">
          {neutralDashAlertNodes.length > 0 ? (
            <div className={dashActionGrid}>{neutralDashAlertNodes}</div>
          ) : null}
          {regularFlowDashAlertNodes.length > 0 ? (
            <div className="space-y-1">
              <div className={dashFlowSectionLabel}>Regular flow · production & dispatch</div>
              <div className={dashActionGrid}>{regularFlowDashAlertNodes}</div>
            </div>
          ) : null}
          {noQtyFlowDashAlertNodes.length > 0 ? (
            <div className="space-y-1">
              <div className={dashFlowSectionLabelNoQty}>NO_QTY flow · cycles & dispatch</div>
              <div className={dashActionGrid}>{noQtyFlowDashAlertNodes}</div>
            </div>
          ) : null}
          {hasVisibleNoQtyContinuation ? (
            <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50/90">
              <div className="border-b border-slate-200/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-800">
                NO_QTY flow · planning & cycles ({visibleOpenNoQtyContinuationRows.length})
              </div>
              <ul className="divide-y divide-slate-200/90">
                {visibleOpenNoQtyContinuationRows.map((row) => {
                  const mergedWo = findMergedNoQtyProdActionForOpenRow(row, woProdNoQty);
                  const flow = noQtyFlowBySo[row.salesOrderId];
                  const resolved = resolveNoQtyDashboardContinuation({
                    salesOrderId: row.salesOrderId,
                    cycleId: row.cycleId,
                    latestRequirementSheetId: row.latestRequirementSheetId,
                    lastRsStatus: row.lastRsStatus,
                    flow: flow ?? null,
                  });
                  const busy =
                    resolved.kind === "prepare_next_rs" && dashboardRsPrepareSoId === row.salesOrderId;
                  const prepareLocked =
                    resolved.kind === "prepare_next_rs" && dashboardRsPrepareSoId != null;
                  const topPrimaryMergedCycleProduction =
                    mergedWo != null &&
                    resolved.kind === "navigate" &&
                    resolved.label === "Open Production";
                  // UX-only: classify RM availability for this cycle so we can
                  // disable / warn on the "Continue Cycle Production" CTA
                  // without changing any backend math or allocation rules.
                  const noQtyAvailability: NoQtyProductionAvailability =
                    topPrimaryMergedCycleProduction
                      ? detectNoQtyProductionAvailability({
                          salesOrderId: row.salesOrderId,
                          cycleId: row.cycleId ?? null,
                          prodQueue: canViewProductionQueue ? prodQueue : null,
                          hasMergedWo: mergedWo != null,
                          rowLastShortageQty: row.lastShortageQty ?? null,
                          // STORE owns shortage→PO→GRN; never show a misleading
                          // "Continue Cycle Production" CTA with active RM shortage.
                          strict: role === "STORE",
                        })
                      : "PRODUCIBLE";
                  const productionFullyBlocked =
                    topPrimaryMergedCycleProduction && noQtyAvailability === "FULLY_BLOCKED";
                  const productionPartiallyBlocked =
                    topPrimaryMergedCycleProduction && noQtyAvailability === "PARTIAL";
                  const latestRsShown = row.lastRsDocNo
                    ? `${row.lastRsDocNo}${row.lastRsStatus ? ` - ${row.lastRsStatus}` : ""}`
                    : null;
                  const cycleShown =
                    row.cycleNo != null && Number.isFinite(Number(row.cycleNo))
                      ? String(row.cycleNo)
                      : row.cycleId != null && row.cycleId > 0
                        ? `#${row.cycleId}`
                        : "—";
                  const shortageShown =
                    row.lastShortageQty != null && row.lastShortageQty > ROW_NUM_EPS
                      ? Number.isInteger(row.lastShortageQty)
                        ? String(row.lastShortageQty)
                        : row.lastShortageQty.toFixed(3)
                      : null;
                  const appendFromDashboard = (to: string) => {
                    const sep = to.includes("?") ? "&" : "?";
                    return `${to}${sep}fromDashboard=1`;
                  };
                  const rowDetailTitle = [latestRsShown ? `RS ${latestRsShown}` : null, row.statusText]
                    .filter(Boolean)
                    .join(" — ");
                  const floorQtyLabel =
                    mergedWo != null
                      ? Number.isInteger(mergedWo.metricQty)
                        ? String(mergedWo.metricQty)
                        : mergedWo.metricQty.toFixed(3)
                      : null;
                  return (
                    <li
                      key={`no-qty-cycle-${row.salesOrderId}-${row.cycleId ?? "c"}-${row.cycleNo ?? "n"}`}
                      className="border-b border-slate-200/70 px-2 py-1.5 text-[12px] text-slate-800 last:border-b-0"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-2.5">
                      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                        <span className="font-bold tabular-nums text-slate-950">
                          {displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo)}
                        </span>
                        <span className="rounded-sm border border-slate-300 bg-slate-50 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-slate-700">
                          NO_QTY
                        </span>
                        <span className="whitespace-nowrap rounded-sm bg-slate-900 px-1.5 py-0 text-[10px] font-bold uppercase tracking-wider text-white">
                          Cycle {cycleShown}
                        </span>
                      </div>
                      <span
                        className="min-w-0 max-w-[11rem] shrink truncate text-[12px] font-medium text-slate-900 sm:max-w-[14rem] md:max-w-[18rem]"
                        title={row.customerName}
                      >
                        {row.customerName}
                      </span>
                      <div
                        className="min-w-0 flex-1 basis-full text-[12px] leading-snug text-slate-800 sm:basis-0 sm:min-w-0 sm:flex-1 sm:truncate"
                        title={rowDetailTitle}
                      >
                        {latestRsShown ? (
                          <>
                            <span className="font-semibold text-slate-900">{latestRsShown}</span>
                            <span className="text-slate-400"> · </span>
                          </>
                        ) : null}
                        <span className="font-medium text-slate-700">{row.statusText}</span>
                      </div>
                      {shortageShown != null ? (
                        <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-slate-800">
                          Short <span className="font-semibold text-slate-950">{shortageShown}</span>
                        </span>
                      ) : null}
                      <div className="ml-auto flex shrink-0">
                        <Button
                          type="button"
                          variant={
                            productionFullyBlocked
                              ? "outline"
                              : resolved.kind === "prepare_next_rs" || topPrimaryMergedCycleProduction
                                ? "default"
                                : "outline"
                          }
                          size="sm"
                          className={cn(
                            "h-8 rounded-md px-3 text-xs font-semibold",
                            productionFullyBlocked &&
                              "cursor-not-allowed border-amber-300 bg-amber-50 text-amber-900 shadow-none hover:bg-amber-50",
                            !productionFullyBlocked &&
                              (resolved.kind === "prepare_next_rs" ||
                                topPrimaryMergedCycleProduction) &&
                              DASH_BTN_PRIMARY,
                            !productionFullyBlocked &&
                              resolved.kind !== "prepare_next_rs" &&
                              !topPrimaryMergedCycleProduction &&
                              "border-slate-200 bg-white text-slate-800 shadow-none",
                          )}
                          disabled={prepareLocked || productionFullyBlocked}
                          aria-disabled={prepareLocked || productionFullyBlocked}
                          title={
                            productionFullyBlocked
                              ? "Production cannot continue: every active WO line for this cycle is awaiting next requirement sheet due to RM shortage."
                              : productionPartiallyBlocked
                                ? "Some WO items in this cycle are blocked by RM shortage — partial production is still allowed."
                                : undefined
                          }
                          data-testid={`dashboard-no-qty-continue-${row.salesOrderId}`}
                          data-availability={noQtyAvailability}
                          onClick={() => {
                            if (productionFullyBlocked) return;
                            if (resolved.kind === "prepare_next_rs") {
                              void prepareNoQtyNextRsAndNavigate(row.salesOrderId);
                            } else {
                              navigate(appendFromDashboard(resolved.to), {
                                state: { from: "dashboard" },
                              });
                            }
                          }}
                        >
                          {busy
                            ? "…"
                            : productionFullyBlocked
                              ? "Production blocked by RM shortage"
                              : dashNoQtyContinuationLabel(resolved.label)}
                        </Button>
                      </div>
                      </div>
                      {mergedWo != null && floorQtyLabel != null ? (
                        <div className="mt-1 w-full border-t border-slate-200/70 pt-1.5 text-[12px] leading-snug text-slate-800">
                          <span className="font-semibold text-slate-950">Cycle production pending</span>
                          {": shop floor WO balance "}
                          <span className="tabular-nums font-semibold text-slate-900">{floorQtyLabel}</span> for this
                          cycle.{" "}
                          {productionPartiallyBlocked ? (
                            <span className="font-medium text-amber-800">
                              Some WO items are blocked by RM shortage — partial production is still allowed.
                            </span>
                          ) : (
                            <span className="text-slate-700">Use the primary action above.</span>
                          )}
                        </div>
                      ) : null}
                      {productionFullyBlocked ? (
                        <div className="mt-1 w-full rounded-sm border border-amber-200 bg-amber-50/80 px-2 py-1 text-[12px] leading-snug text-amber-900">
                          <span className="font-semibold text-amber-950">Production blocked by RM shortage</span>
                          {". "}
                          <span>
                            Material is short. Open RM Shortage Workspace and create RM PO before continuing production.
                          </span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    ) : null;

  return (
    <div className={DASH_SHELL}>
      <div className={cn(DASH_MAX, showOperationsClearStrip && "!pb-3 md:!pb-4")}>
        <div className={cn(showOperationsClearStrip ? DASH_GRID_COMPACT : DASH_GRID)}>
          {!demo.enabled ? (
            // Slim context strip (topbar already renders the primary "Dashboard" heading).
            // Single workflow descriptor line — no duplicate title, no role chip
            // (role is shown in the topbar's user block).
            <div className="flex items-center justify-between border-b border-slate-200/70 pb-1.5">
              <p
                className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:text-[11px]"
                aria-hidden
              >
                Production · Planning · Dispatch · Operational Control
              </p>
              <p className="sr-only">
                Dashboard — live manufacturing operations overview: queues, KPIs, and inventory snapshot.
              </p>
            </div>
          ) : null}
          {demo.enabled ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200/90 bg-sky-50/95 px-2 py-1.5 text-[12px] text-sky-950">
              <div className="min-w-0">
                <span className="font-semibold">DEMO MODE</span>{" "}
                <span className="text-sky-900/90">Guided workflow · sample data</span>
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
          {demo.enabled || role === "ADMIN" ? (
            <details className="rounded border border-slate-200/65 bg-white/75 text-slate-600 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-0.5 text-[10px] hover:bg-slate-50/90">
                <span>
                  <span className="font-semibold text-slate-700">Walkthrough</span>
                  <span className="font-normal text-slate-600"> · guided flows</span>
                </span>
                <span className="text-[9px] font-medium uppercase tracking-wide text-slate-400">Expand</span>
              </summary>
              <div className="flex flex-wrap gap-1 border-t border-slate-200/60 px-2 py-1">
                <Button
                  type="button"
                  size="sm"
                  className={cn("h-8 rounded-md px-3 text-xs font-semibold shadow-none", DASH_BTN_PRIMARY)}
                  onClick={() => demo.startDemoFlow("regular")}
                >
                  Regular SO
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-none"
                  onClick={() => demo.startDemoFlow("no_qty")}
                >
                  NO_QTY
                </Button>
              </div>
            </details>
          ) : null}

          {!demo.enabled ? operationalActionQueue : null}

          {!demo.enabled && canViewOverallSummary && data ? (
            <div className="max-w-full overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className={DASH_METRICS_RIBBON} role="toolbar" aria-label="Operational metrics">
                <button
                  type="button"
                  title="Counts sales order lines with dispatch backlog: Regular (NORMAL) by customer PO commitment, plus NO_QTY (cycle-driven) and replacement flows."
                  className={DASH_METRIC_BTN}
                  {...clickTo("/dispatch")}
                  aria-label="Open Dispatch — dispatch prep (regular, No Qty, and replacement)"
                >
                  <span className={DASH_METRIC_LABEL}>Dispatch prep</span>
                  <span
                    className={cn(
                      DASH_METRIC_VALUE,
                      data.pendingDispatchCount > 0 ? DASH_METRIC_VALUE_WARN : DASH_METRIC_VALUE_MUTED,
                    )}
                  >
                    {data.pendingDispatchCount}
                  </span>
                </button>
                <button
                  type="button"
                  className={DASH_METRIC_BTN}
                  {...clickTo("/work-orders?woStatus=OPEN")}
                  aria-label="Open Work Orders"
                >
                  <span className={DASH_METRIC_LABEL}>WO pending</span>
                  <span
                    className={cn(
                      DASH_METRIC_VALUE,
                      data.pendingWorkOrders > 0 ? DASH_METRIC_VALUE_WARN : DASH_METRIC_VALUE_MUTED,
                    )}
                  >
                    {data.pendingWorkOrders}
                  </span>
                </button>
                {canViewQcQueue ? (
                  <button type="button" className={DASH_METRIC_BTN} {...clickTo("/qc-entry")} aria-label="Open QC">
                    <span className={DASH_METRIC_LABEL}>QC pending</span>
                    <span
                      className={cn(
                        DASH_METRIC_VALUE,
                        (qcQueue?.length ?? 0) > 0 ? DASH_METRIC_VALUE_WARN : DASH_METRIC_VALUE_MUTED,
                      )}
                    >
                      {qcQueue ? qcQueue.length : 0}
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className={DASH_METRIC_BTN}
                  {...clickTo("/stock?source=dashboard")}
                  aria-label={REGULAR_TERMS.REVIEW_RM_STATUS}
                >
                  <span className={DASH_METRIC_LABEL}>{REGULAR_TERMS.DASHBOARD_RM_ALERTS_LABEL}</span>
                  <span
                    className={cn(
                      DASH_METRIC_VALUE,
                      data.rmStockAlert.length > 0 ? DASH_METRIC_VALUE_CRIT : DASH_METRIC_VALUE_MUTED,
                    )}
                  >
                    {data.rmStockAlert.length}
                  </span>
                </button>
                <button type="button" className={DASH_METRIC_BTN} {...clickTo("/stock")} aria-label="Open Stock">
                  <span className={DASH_METRIC_LABEL}>FG usable</span>
                  <span className={DASH_METRIC_VALUE}>{fgStockTotal.toFixed(2)}</span>
                </button>
                <button
                  type="button"
                  title="View rejection details"
                  className={DASH_METRIC_BTN}
                  {...clickTo("/qc-report?source=dashboard")}
                  aria-label="View QC rejection details in QC Report"
                >
                  <span className={DASH_METRIC_LABEL}>Rejection %</span>
                  <span className={cn(DASH_METRIC_VALUE, qcRejMetricValueClass)}>
                    {data.qcRejectionPct.toFixed(1)}%
                  </span>
                </button>
              </div>
            </div>
          ) : null}

          {!demo.enabled && showOperationsClearStrip ? (
            <div className={DASH_CLEAR_STATUS_CARD} role="status">
              <div className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold leading-tight tracking-tight text-emerald-950">
                    {dashboardClearStateCopy(role).title}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-emerald-900/75">
                    {dashboardClearStateCopy(role).description}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          {!demo.enabled && canViewOverallSummary && data ? (
            <>
              <div
                className={cn(
                  "grid lg:items-stretch",
                  showOperationsClearStrip ? "gap-1.5" : "gap-2",
                  data.recentQcRejections.length > 0 ? "lg:grid-cols-2" : "lg:grid-cols-1",
                )}
              >
                {inventorySnapshotBothClear ? (
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
                ) : (
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
                )}

                {data.recentQcRejections.length > 0 ? (
                  <Card className={DASH_CARD_MUTED}>
                    <CardHeader className="space-y-0 px-2.5 pb-0 pt-1">
                      <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
                        Recent QC rejections
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-2.5 pb-1.5 pt-0">
                      <div className={DASH_TABLE_WRAP_BASE}>
                      <table className="erp-table erp-table-dense dash-table min-w-[420px] sm:min-w-0 [&_thead_th]:!py-1 [&_tbody_td]:!py-1 [&_tbody_td]:text-[11px]">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>FG</th>
                            <th className="text-right">Rejected (gross)</th>
                            <th className="text-right">Net loss</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.recentQcRejections.slice(0, 3).map((q) => {
                            const rejGross = Number(q.rejectedGrossQty ?? q.rejectedQty ?? 0);
                            const netLoss = Number(
                              q.netLossOrUnresolvedQty ?? q.netRejectedImpactQty ?? q.lossQty ?? 0,
                            );
                            return (
                              <tr key={q.id}>
                                <td className="whitespace-nowrap">{new Date(q.date).toLocaleDateString()}</td>
                                <td className="max-w-[12rem] truncate" title={q.itemName}>
                                  {displayShortItemName(q.itemName)}
                                </td>
                                <td className="text-right tabular-nums font-semibold text-slate-900">{rejGross}</td>
                                <td className="text-right tabular-nums font-semibold text-slate-900">{netLoss}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
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
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
