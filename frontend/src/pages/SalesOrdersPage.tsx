/**
 * SALES ORDERS LIST — MIXED SURFACE (REGULAR + NO_QTY rows)
 *
 * REGULAR: fixed-qty CTAs → `/work-orders/prepare` for WO_PENDING (never `/planning-dashboard`).
 * NO_QTY: requirement-sheet / cycle navigation — keep separate from REGULAR RM check → WO prep.
 */
import * as React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { deleteUrlParamKeys } from "../lib/urlSearchParamsPatch";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import {
  DRILL_FOCUS_EMPTY_FILTERED_SUFFIX,
  DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS,
  DRILL_FOCUS_HINT_NOT_IN_LIST,
  DRILL_RECOVERY_LABEL,
} from "../lib/drillFocusCopy";
import { DRILL_DATA, DRILL_QUERY, isReportsReturnContext } from "../lib/drillDownRoutes";
import { useDrillFocus } from "../hooks/useDrillFocus";
import { cn } from "../lib/utils";
import { buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PageContainer, PageHeader, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { ApiRequestError, apiFetch } from "../services/api";
import {
  SalesCommercialInvoiceView,
  type SalesInvoiceSoDetail,
} from "../components/sales/SalesCommercialInvoiceView";
import { Button } from "../components/ui/button";
import { ErpModal } from "../components/erp/ErpModal";
import { REGULAR_TERMS } from "../lib/flowTerminology";
import { woPreparePositionLabel, woPreparePrimaryCta, type WoPrepareOperational } from "../lib/woPrepareOperationalStage";
import { formatProcessStageDisplayLabel } from "../lib/operationalErrorPresentation";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useIsAdmin, useCanCreateNextRs, useCanOpenRequirementSheet } from "../hooks/useIsAdmin";
import { useAuth } from "../hooks/useAuth";
import {
  SO_WRITE_ROLES,
  DISPATCH_READ_ROLES,
  SALES_BILL_WRITE_ROLES,
  WO_PLAN_PREP_ROLES,
  ENQUIRY_QUOTATION_WRITE_ROLES,
  QC_PAGE_ROLES,
  PRODUCTION_WRITE_ROLES,
} from "../config/erpRoles";
import { PlanningStatusChip } from "../components/erp/PlanningStatusChip";
import { useToast } from "../contexts/ToastContext";
import { Trash2, Pencil, CheckCircle2, ChevronDown, ChevronUp, X } from "lucide-react";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useModalFocusRestore } from "../hooks/useModalFocusRestore";
import { useShortcutHints } from "../hooks/useShortcutHints";
import { FieldShortcutHint } from "../components/ui/FieldShortcutHint";
import {
  FIELD_HINT_SO_CREATE,
  FIELD_HINT_SO_EDIT_QTY,
  FIELD_HINT_SO_EDIT_SAVE,
  FIELD_HINT_SO_QUOTE_PO,
} from "../lib/shortcutHintCopy";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { prefersFinePointer } from "../lib/erpFocus";
import { ActivityHistoryCard } from "../components/ActivityHistoryCard";
import { buildNoQtyGuidedHref } from "../lib/noQtyFlowState";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";

type Customer = { id: number; name: string };

type DispatchSummary = {
  totalOrdered: number;
  totalDispatched: number;
  totalPending: number;
  fullyDispatched: boolean;
};

type SoRow = {
  id: number;
  docNo?: string | null;
  poId: number | null;
  customerId: number | null;
  customer: Customer | null;
  shipToAddressId?: number | null;
  quotationId: number | null;
  quotation: { id: number; quotationNo: string | null; enquiryId: number } | null;
  customerPoReference: string | null;
  remarks: string | null;
  orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY";
  customerReturnId?: number | null;
  originalSalesOrderId?: number | null;
  originalDispatchId?: number | null;
  internalStatus: string;
  createdAt: string;
  po?: { id: number; customer?: Customer | null } | null;
  lines: {
    id: number;
    itemId: number;
    qty: string;
    customerPoQty?: string;
    bufferPercent?: string;
    isFree?: boolean;
    quotationLineId?: number | null;
    quotationLine?: {
      qty: string;
      rate: string;
      isFree: boolean;
      lineTotal: string;
      discountPct?: string;
      gstPct?: string;
    } | null;
    item: { itemName: string };
    /** Optional list price on NO_QTY / extended payloads. */
    rate?: string | null;
  }[];
  dispatchSummary?: DispatchSummary;
  /** NO_QTY only: total dispatched qty not yet billed (dispatch-driven). */
  unbilledDispatchedQty?: number | null;
  /** Sum of finalized Sales Bill qty (via dispatch.soId). */
  invoicedQty?: number;
  /** 0–100 from backend reportMetrics; optional until all clients upgraded */
  dispatchProgressPercent?: number;
  /** Operational flow stage from backend (WO → production → QC → dispatch). */
  processStage?: { key: string; label: string };
  /** REGULAR WO_PENDING substage (RM shortage / purchase pending / ready for WO). */
  woPrepareOperational?: WoPrepareOperational | null;
  /** NO_QTY only: next actionable module (current cycle). */
  noQtyNextAction?:
    | "REQUIREMENT"
    | "WORK_ORDER"
    | "PRODUCTION"
    | "QC"
    | "DISPATCH"
    | "SALES_BILL"
    | "CLOSE_SO"
    | "CREATE_NEXT_RS"
    | "COMPLETED";
  /** Human-readable next step for list (NO_QTY). */
  noQtyNextActionLabel?: string | null;
  /** Same as commercial caption when set (API convenience). */
  commercialStatusLabel?: string | null;
  /** NO_QTY list cycle: at least one FINALIZED sales bill on this cycle (display only). */
  noQtyFinalizedBillingComplete?: boolean | null;
  /** NO_QTY list cycle: finalized bill marked exported (display only). */
  noQtyBillingExported?: boolean | null;
  /** NO_QTY only: whether current cycle has at least one Requirement Sheet created. */
  hasCurrentCycleRequirementSheet?: boolean | null;
  /** NO_QTY only: whether current cycle already has at least one Sales Bill. */
  hasCurrentCycleSalesBill?: boolean | null;
  /** NO_QTY: true when current ACTIVE cycle has no requirement / WO / production / QC / dispatch / sales bill. */
  noQtyCanCloseEmptyCycle?: boolean | null;
  /** NO_QTY: count of SalesOrderCycle rows with status ACTIVE for this SO. */
  noQtyActiveCycleCount?: number | null;
  /** NO_QTY: IN_PROCESS but no ACTIVE cycle (data repair / needs Start next cycle). */
  noQtyStrandedWithoutActiveCycle?: boolean;
  /** NO_QTY: user may add next-cycle RS (server eligibility). */
  noQtyCreateNextRsEligible?: boolean;
  /** NO_QTY: server allows POST /close (operational gates; billing does not block). */
  noQtyManualCloseEligible?: boolean;
  /** NO_QTY: user-facing block reason when manual close is not allowed. */
  noQtyManualCloseBlockReason?: string | null;
  /** NO_QTY: next-cycle RS already exists (doc no from server). */
  noQtyNextRsAlreadyCreatedDocNo?: string | null;
  /** NO_QTY list: server-built cycle / between-cycles position line (display only). */
  noQtyListPositionLabel?: string | null;
  /** NO_QTY list: commercial / billing line (display only). */
  noQtyCommercialCaption?: string | null;
  /** NO_QTY guided links: prefer over `currentCycle.id` when SO pointer is stale. */
  noQtyGuidedCycleId?: number | null;
  noQtyLatestBilledCycleNo?: number | null;
  noQtyActiveCycleNo?: number | null;
  /** Workflow-active cycle (ACTIVE + RS/WO/prod/QC/dispatch/bill evidence); operator truth for “current cycle”. */
  noQtyActualActiveCycleNo?: number | null;
  /** When no workflow-active cycle: last cycle number with finalized billing (display). */
  noQtyLatestCompletedCycleNo?: number | null;
  /** Count of ACTIVE cycles that pass workflow evidence (operator “in flight”). */
  noQtyWorkflowActiveCycleCount?: number | null;
  /** ADMIN only: max existing cycleNo + 1; not shown as an active cycle until RS/row exists. */
  noQtyNextPossibleCycleNo?: number | null;
  noQtyIsBetweenCycles?: boolean;
  currentCycle?: { id: number; cycleNo: number; status?: string } | null;
  /** Admin-only: hard-delete eligibility for non-connected sales orders (server source of truth). */
  deleteAllowed?: boolean;
  /** Admin-only: reasons that block hard delete. */
  deleteBlockedReasons?: string[];

  /** Phase 1 commercial address architecture */
  snapshotState?: "LIVE" | "FROZEN" | "LEGACY" | string;
  resolvedBillTo?: {
    name: string | null;
    address: string | null;
    gstin: string | null;
    stateName: string | null;
    stateCode: string | null;
  } | null;
  resolvedShipTo?: {
    label: string | null;
    address: string | null;
    gstin: string | null;
    stateName: string | null;
    stateCode: string | null;
  } | null;
  resolvedPOS?: {
    stateCode: string | null;
    stateName: string | null;
    source: "SHIP_TO" | "BILL_TO" | "MANUAL" | string | null;
    gstMode: "LOCAL" | "INTERSTATE" | string | null;
  } | null;
};

type CustomerDeliveryAddressRow = {
  id: number;
  label: string;
  address: string | null;
  city: string | null;
  gst: string | null;
  isDefault: boolean;
  isActive: boolean;
  stateRef?: { stateName: string; stateCode: string } | null;
  stateId?: number | null;
};

type CustomerDetail = {
  id: number;
  name: string;
  gst?: string | null;
  address?: string | null;
  stateRef?: { stateName: string; stateCode: string } | null;
  deliveryAddresses?: CustomerDeliveryAddressRow[];
};

type RequirementSheetListRow = {
  id: number;
  status: "DRAFT" | "LOCKED";
  cycleId: number | null;
  createdAt: string;
};

type QuotationDetail = {
  id: number;
  quotationNo: string | null;
  workflowStatus: string;
  enquiry: { customerId: number; customer: Customer };
  lines: {
    id?: number;
    itemId: number;
    qty: string;
    rate: string;
    lineTotal: string;
    isFree?: boolean;
    gstPct?: string;
    item: { itemName: string };
  }[];
  salesOrder: { id: number; docNo?: string | null } | null;
};

/** GET /api/sales-orders/copy-preview — Regular SO “create from previous”. */
type CopyPreviewDetail = {
  sourceType: "QUOTATION" | "SO";
  sourceId: number;
  quotationNo: string | null;
  terms: string | null;
  workflowStatus: string;
  existingSalesOrder: { id: number; docNo?: string | null } | null;
  remarksPreview?: string | null;
  enquiry: { customerId: number; customer: Customer };
  lines: Array<{
    itemId: number;
    itemName: string;
    qty: string;
    rate: string;
    lineTotal: string;
    discountPct?: string;
    gstPct: string;
    isFree?: boolean;
    bufferPercentSnapshot?: string;
  }>;
};

/** Per-line qty when creating a NORMAL SO from an approved quotation (order matches `qDetail.lines`). */
type QuoteCreateLine = { itemId: number; customerPoQty: string };

type DraftLineEdit = {
  lineId: number;
  itemName: string;
  isFree: boolean;
  rateLabel: string;
  /** Regular (NORMAL) SO */
  customerPoQty?: string;
  /** NO_QTY / REPLACEMENT */
  qty?: string;
};

type FgItemOption = { id: number; itemName: string; itemType?: string | null };
type NoQtyCreateLine = { key: string; itemId: number };

function statusBadgeVariant(s: string): "default" | "success" | "warning" | "info" {
  if (s === "APPROVED") return "success";
  if (s === "COMPLETED") return "info";
  if (s === "CLOSED") return "info";
  if (s === "MANUALLY_CLOSED") return "info";
  if (s === "IN_PROCESS") return "warning";
  return "default";
}

function processStageBadgeVariant(
  key: string,
  woPrepareKey?: string | null,
): "default" | "success" | "warning" | "info" {
  if (woPrepareKey === "READY_FOR_WO") return "success";
  if (woPrepareKey === "PURCHASE_GRN_PENDING" || woPrepareKey === "RM_SHORTAGE") return "warning";
  if (key === "COMPLETED") return "info";
  if (key === "NO_QTY_BILLING_COMPLETE") return "success";
  if (
    key === "DISPATCH_PENDING" ||
    key === "QC_PENDING" ||
    key === "PRODUCTION_PENDING" ||
    key === "WO_PENDING" ||
    key === "SALES_BILL_PENDING"
  ) {
    return "warning";
  }
  return "default";
}

function isReplacementSalesOrder(so: SoRow): boolean {
  return so.orderType === "REPLACEMENT";
}

function displaySoStatus(
  row: SoRow,
  noQtyStage: NoQtyStage | null,
): "DRAFT" | "OPEN" | "APPROVED" | "IN_PROCESS" | "COMPLETED" | "CLOSED" | "MANUALLY_CLOSED" {
  const raw = (row.internalStatus ?? "DRAFT") as
    | "DRAFT"
    | "OPEN"
    | "APPROVED"
    | "IN_PROCESS"
    | "COMPLETED"
    | "CLOSED"
    | "MANUALLY_CLOSED";
  // NO_QTY lifecycle is manually controlled: only explicit SO close is terminal for display/filtering.
  if (row.orderType === "NO_QTY") return raw === "CLOSED" || raw === "MANUALLY_CLOSED" ? "CLOSED" : "OPEN";
  // UI safety: operational stage is the source of truth for display.
  if (noQtyStage === "COMPLETED") return "COMPLETED";
  if (row.processStage?.key === "COMPLETED") return "COMPLETED";
  return raw;
}

type NoQtyStage =
  | "DRAFT"
  | "REQUIREMENT READY"
  | "WORK ORDER"
  | "IN PRODUCTION"
  | "DISPATCH / BILLING"
  | "BILLING COMPLETE"
  | "COMPLETED";

type NoQtyNextStep =
  | "Create Requirement"
  | "Work Order"
  | "Dispatch"
  | "Sales Bill"
  | "Billed"
  | "Review & Close SO"
  | null;

type NoQtyStageContext = {
  isNoQtySo: boolean;
  isClosed: boolean;
  hasActiveRequirementSheet: boolean | null;
  requirementSheetLocked: boolean | null;
  requirementSheetDraft: boolean | null;
  hasProductionActivity: boolean | null;
  hasProducedQty: boolean | null;
  hasQcActivity: boolean | null;
  qcFinalizedForRelevantQty: boolean | null;
  usableQcPassedQty: number | null;
  dispatchableQty: number | null;
  actualDispatchedQty: number;
  unbilledDispatchedQty: number | null;
  adminCanReopen: boolean;
  fallbacksUsed: string[];
};

function buildNoQtyStageContext(row: SoRow, opts: { isAdmin: boolean }): NoQtyStageContext {
  const fallbacksUsed: string[] = [];
  const actualDispatchedQty = Number(row.dispatchSummary?.totalDispatched ?? 0) || 0;

  const hasActiveRequirementSheet =
    typeof row.hasCurrentCycleRequirementSheet === "boolean" ? row.hasCurrentCycleRequirementSheet : null;
  if (hasActiveRequirementSheet == null) {
    fallbacksUsed.push("hasActiveRequirementSheet: not in SO list payload");
  }

  // These signals are not available on SO list API today (kept as null for exact-flag swap-in later).
  fallbacksUsed.push("requirementSheetLocked/requirementSheetDraft: not in SO list payload");
  fallbacksUsed.push("production/qc signals (hasProductionActivity/hasProducedQty/hasQcActivity/qcFinalized): not in SO list payload");
  fallbacksUsed.push("dispatchableQty under NO_QTY cycle caps: not in SO list payload");
  const unbilled = typeof (row as any).unbilledDispatchedQty === "number" ? Number((row as any).unbilledDispatchedQty) : null;
  if (unbilled == null) fallbacksUsed.push("unbilledDispatchedQty: not in SO list payload");

  return {
    isNoQtySo: row.orderType === "NO_QTY",
    isClosed:
      row.internalStatus === "COMPLETED" ||
      row.internalStatus === "CLOSED" ||
      row.internalStatus === "MANUALLY_CLOSED" ||
      row.processStage?.key === "COMPLETED",
    hasActiveRequirementSheet,
    requirementSheetLocked: null,
    requirementSheetDraft: null,
    hasProductionActivity: null,
    hasProducedQty: null,
    hasQcActivity: null,
    qcFinalizedForRelevantQty: null,
    usableQcPassedQty: null,
    dispatchableQty: null,
    actualDispatchedQty,
    unbilledDispatchedQty: unbilled != null && Number.isFinite(unbilled) ? unbilled : null,
    adminCanReopen: opts.isAdmin,
    fallbacksUsed,
  };
}

function getNoQtySoStageMeta(row: SoRow, opts: { isAdmin: boolean }): { stage: NoQtyStage; ctx: NoQtyStageContext; reason: string } {
  const ctx = buildNoQtyStageContext(row, opts);
  const key = row.processStage?.key ?? "";
  const pendingDispatch = Number(row.dispatchSummary?.totalPending ?? 0) || 0;

  // Priority order:
  // 1 Completed/closed
  // 2 No requirement sheet yet (Draft)
  // 3 Requirement sheet exists but downstream not started (Requirement ready)
  // 4 Production/QC started but dispatch/billing not finished (In production)
  // 5 Dispatch/billing pending (Dispatch / Billing)
  // 6 Fallback safe state

  if (ctx.isClosed) return { stage: "COMPLETED", ctx, reason: "status indicates closed/completed" };

  // Backend NO_QTY stage override (priority-based, current cycle only).
  if (key === "NO_QTY_BILLING_COMPLETE") return { stage: "BILLING COMPLETE", ctx, reason: "backend stage: billing finalized" };
  if (key === "NO_QTY_DISPATCH_BILLING") return { stage: "DISPATCH / BILLING", ctx, reason: "backend stage: dispatch/billing" };
  if (key === "NO_QTY_IN_PRODUCTION") return { stage: "IN PRODUCTION", ctx, reason: "backend stage: in production" };
  if (key === "NO_QTY_WORK_ORDER") return { stage: "WORK ORDER", ctx, reason: "backend stage: work order" };
  if (key === "NO_QTY_REQUIREMENT_READY") return { stage: "REQUIREMENT READY", ctx, reason: "backend stage: requirement ready" };
  if (key === "NO_QTY_DRAFT") return { stage: "DRAFT", ctx, reason: "backend stage: draft" };

  const hasReq = ctx.hasActiveRequirementSheet === true;
  const noReq = ctx.hasActiveRequirementSheet === false;

  // Dispatch/billing: use unbilled qty (not gross dispatch) so finalized billing does not read as "pending".
  if (
    (ctx.unbilledDispatchedQty != null && ctx.unbilledDispatchedQty > 0) ||
    (key === "DISPATCH_PENDING" && pendingDispatch > 0)
  ) {
    return { stage: "DISPATCH / BILLING", ctx, reason: "dispatch/billing activity detected" };
  }

  // Production/QC signals (best available from processStage on list payload):
  if (key === "PRODUCTION_PENDING" || key === "QC_PENDING" || row.internalStatus === "IN_PROCESS") {
    return { stage: "IN PRODUCTION", ctx, reason: "production/qc in progress (processStage/internalStatus)" };
  }

  if (key === "WO_PENDING") {
    if (hasReq) return { stage: "REQUIREMENT READY", ctx, reason: "requirement sheet exists; WO not created yet" };
    if (noReq) return { stage: "DRAFT", ctx, reason: "no requirement sheet yet for current cycle" };
  }

  // Requirement readiness:
  if (hasReq) return { stage: "REQUIREMENT READY", ctx, reason: "requirement sheet exists for current cycle" };

  // Draft/awaiting requirement:
  if (noReq) return { stage: "DRAFT", ctx, reason: "no requirement sheet yet for current cycle" };

  // Fallback when requirement flag missing:
  return { stage: "DRAFT", ctx, reason: "fallback: requirement sheet signal missing" };
}

function noQtyProgressSummary(stage: NoQtyStage, so: SoRow): string {
  const fgCount = Array.isArray(so.lines) ? so.lines.length : 0;
  const disp = Number(so.dispatchSummary?.totalDispatched ?? 0) || 0;
  const pend = Number(so.dispatchSummary?.totalPending ?? 0) || 0;
  if (stage === "COMPLETED") return "Current cycle closed";
  if (stage === "DRAFT") return "Planning Pending";
  if (stage === "REQUIREMENT READY") return "Requirement prepared";
  if (stage === "WORK ORDER") return "Work order ready";
  if (stage === "IN PRODUCTION") return "Production / QC in progress";
  if (stage === "BILLING COMPLETE") {
    if (so.noQtyBillingExported === true) return "Billing completed · Exported";
    return "Billing completed";
  }
  if (stage === "DISPATCH / BILLING")
    return disp > 0 || pend > 0
      ? `Dispatch or billing pending · Out ${disp} · Pend ${pend}`
      : "Dispatch or billing pending";
  return `${fgCount} item(s)`;
}

/** Uses `dispatchSummary` from the SO list API — same fields as the "Fully dispatched" badge. Normal SOs only. */
function shouldShowCheckStockAndRmCheck(so: SoRow): boolean {
  const ds = so.dispatchSummary;
  if (!ds || ds.totalOrdered <= 0) return false;
  if (ds.fullyDispatched) return false;
  if (ds.totalPending <= 0) return false;
  return true;
}

function hasErpRole(role: string | undefined, allowed: readonly string[]): boolean {
  if (!role) return false;
  return (allowed as readonly string[]).includes(role);
}

/** Regular SO list: compact commercial / dispatch line (display only). */
function regularSoCommercialSummary(so: SoRow): string {
  if (isReplacementSalesOrder(so)) return "—";
  const pending = Number(so.dispatchSummary?.totalPending ?? 0) || 0;
  const dispatched = Number(so.dispatchSummary?.totalDispatched ?? 0) || 0;
  const invoiced = Number(so.invoicedQty ?? 0) || 0;
  const invoicePendingQty = Math.max(0, dispatched - invoiced);
  if (invoicePendingQty > 0) return `Invoice pending (${invoicePendingQty})`;
  if (invoiced > 0 && pending <= 0) return `Invoiced (${invoiced})`;
  if (pending > 0) return `Dispatch pending (${pending})`;
  if (dispatched > 0) return `Dispatched (${dispatched})`;
  return "—";
}

function regularSoPositionLabel(so: SoRow): string {
  if (so.processStage?.key === "SALES_BILL_PENDING") return "Dispatch complete";
  return woPreparePositionLabel(
    so.woPrepareOperational,
    formatProcessStageDisplayLabel(so.processStage?.label ?? "—"),
  );
}

/** Primary row CTA from `processStage` for all non–NO_QTY orders (NORMAL, REPLACEMENT, etc.). */
function getPrimaryCta(so: SoRow, role: string): { label: string; to: string; state?: { from: string } } | null {
  if (so.orderType === "NO_QTY") return null;
  const stage = so.processStage?.key;
  const sid = encodeURIComponent(String(so.id));
  const canWoFromSo = hasErpRole(role, [...SO_WRITE_ROLES, ...WO_PLAN_PREP_ROLES]) && role !== "PRODUCTION";
  switch (stage) {
    case "WO_PENDING":
      if (!canWoFromSo) return null;
      return { ...woPreparePrimaryCta(so.id, so.woPrepareOperational ?? null), state: { from: "sales-orders" } };
    case "PRODUCTION_PENDING":
      if (!hasErpRole(role, PRODUCTION_WRITE_ROLES)) return null;
      return {
        label: "Continue on Work Order",
        to: `/work-orders?salesOrderId=${sid}&from=sales-orders`,
      };
    case "QC_PENDING":
      if (!hasErpRole(role, QC_PAGE_ROLES)) return null;
      return { label: "Complete QA", to: `/qc-entry?salesOrderId=${sid}` };
    case "DISPATCH_PENDING":
      if (!hasErpRole(role, DISPATCH_READ_ROLES)) return null;
      return {
        label: "Go to Dispatch",
        to: `/dispatch?salesOrderId=${sid}&source=sales_orders`,
        state: { from: "sales-orders" },
      };
    case "SALES_BILL_PENDING":
      if (!hasErpRole(role, SALES_BILL_WRITE_ROLES)) return null;
      return { label: "Create Sales Bill", to: `/sales-bills?salesOrderId=${sid}` };
    default:
      return null;
  }
}

const SO_LIST_URL_OMIT: Record<string, string> = {
  status: "ALL",
  prod: "ALL",
  soType: "REGULAR",
  sort: "date",
  dir: "desc",
};

type SalesOrdersListTab = "REGULAR" | "NO_QTY";

export function SalesOrdersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const demo = useDemoMode();
  const soDemoHlRegular = demoHighlightKey(demo.enabled, demo.flow, demo.step, "regular", 1);
  const soDemoHlNoQty = demoHighlightKey(demo.enabled, demo.flow, demo.step, "no_qty", 1);
  const isAdmin = useIsAdmin();
  const canCreateNextRs = useCanCreateNextRs();
  const canOpenRs = useCanOpenRequirementSheet();
  const { user } = useAuth();
  const role = user?.role ?? "";
  const canUseCommercialQuotations = hasErpRole(role, ENQUIRY_QUOTATION_WRITE_ROLES);
  const canCloseNoQtySo = hasErpRole(role, SO_WRITE_ROLES);
  const { searchParams, setSearchParams, patch, read } = useUrlQueryState(SO_LIST_URL_OMIT);
  const quotationFromUrl = read.int("quotationId");
  const copySourceRaw = read.string("copySource");
  const copyIdFromUrl = read.int("copyId");
  const copyFromPreviousActive =
    (copySourceRaw === "QUOTATION" || copySourceRaw === "SO") && Number.isFinite(copyIdFromUrl) && copyIdFromUrl > 0;
  const focusSalesOrderId = Number(searchParams.get(DRILL_QUERY.salesOrderId)) || 0;

  const statusFilter = read.enum(
    "status",
    ["ALL", "DRAFT", "OPEN", "APPROVED", "IN_PROCESS", "COMPLETED", "CLOSED"] as const,
    "ALL",
  );
  const prodFilter = read.enum("prod", ["ALL", "PENDING", "NONE"] as const, "ALL");
  const soTypeFilter: SalesOrdersListTab =
    read.string("soType") === "NO_QTY" ? "NO_QTY" : "REGULAR";
  const sortKey = read.enum("sort", ["date", "id"] as const, "date");
  const sortDir = read.enum("dir", ["asc", "desc"] as const, "desc");
  const customerIdFilter = read.int("customerId");
  const openInvoiceFromUrl = read.int("openInvoice");

  const searchFromUrl = read.string("search");
  const [searchDraft, setSearchDraft] = useDebouncedUrlStringParam({
    urlValue: searchFromUrl,
    patch,
    paramKey: "search",
  });
  const listSearch = searchDraft.trim().toLowerCase();

  const [rows, setRows] = React.useState<SoRow[]>([]);
  const [listLoaded, setListLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [qDetail, setQDetail] = React.useState<QuotationDetail | null>(null);
  const [qLoading, setQLoading] = React.useState(false);
  const [copyPreview, setCopyPreview] = React.useState<CopyPreviewDetail | null>(null);
  const [copyLoading, setCopyLoading] = React.useState(false);
  const [createPoRef, setCreatePoRef] = React.useState("");
  const [createRemarks, setCreateRemarks] = React.useState("");
  const [createPoTouched, setCreatePoTouched] = React.useState(false);
  const [quoteCreateLines, setQuoteCreateLines] = React.useState<QuoteCreateLine[]>([]);
  const createFromQuoteRef = React.useRef<HTMLDivElement | null>(null);
  const createPoRefInputRef = React.useRef<HTMLInputElement | null>(null);
  const listFilterStatusSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const didAutoFocusSoListRef = React.useRef(false);

  const shortcutHints = useShortcutHints({
    pageKey: "sales-orders",
    fieldShortcuts: {
      soQuotePoRef: FIELD_HINT_SO_QUOTE_PO,
      soQuoteCreate: FIELD_HINT_SO_CREATE,
      soEditQty: FIELD_HINT_SO_EDIT_QTY,
      soEditSave: FIELD_HINT_SO_EDIT_SAVE,
    },
    firstUseTipText:
      "Tip: In the create or edit form, Enter moves to the next field. Ctrl+Enter saves when the button is enabled.",
  });

  const editFormRef = React.useRef<HTMLFormElement | null>(null);
  const editSoTypeSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const editDraftPoRefInputRef = React.useRef<HTMLInputElement | null>(null);
  const listFiltersRef = React.useRef<HTMLDivElement | null>(null);
  useFastEntryForm({ containerRef: editFormRef });
  useFastEntryForm({ containerRef: listFiltersRef });

  const [creating, setCreating] = React.useState(false);
  const [createFromPreviousOpen, setCreateFromPreviousOpen] = React.useState(false);
  const [previousKind, setPreviousKind] = React.useState<"QUOTATION" | "SO">("QUOTATION");
  const [previousPickId, setPreviousPickId] = React.useState<number>(0);
  const [quotationPickOptions, setQuotationPickOptions] = React.useState<
    {
      id: number;
      quotationNo: string | null;
      customerName: string;
      existingSalesOrderId: number | null;
      existingSalesOrderDocNo: string | null;
    }[]
  >([]);
  const [soPickOptions, setSoPickOptions] = React.useState<
    { id: number; docNo: string | null; customerName: string; internalStatus: string; lineCount: number }[]
  >([]);
  const [previousPickLoading, setPreviousPickLoading] = React.useState(false);
  const [noQtyCreateOpen, setNoQtyCreateOpen] = React.useState(false);
  const [noQtyCustomerId, setNoQtyCustomerId] = React.useState<number>(0);
  const [noQtyPoRef, setNoQtyPoRef] = React.useState("");
  const [noQtyRemarks, setNoQtyRemarks] = React.useState("");
  const [noQtyLines, setNoQtyLines] = React.useState<NoQtyCreateLine[]>([{ key: "1", itemId: 0 }]);
  const [customers, setCustomers] = React.useState<Array<{ id: number; name: string }>>([]);
  const [fgItems, setFgItems] = React.useState<FgItemOption[]>([]);
  const [savingNoQty, setSavingNoQty] = React.useState(false);

  const [editSo, setEditSo] = React.useState<SoRow | null>(null);
  useModalFocusRestore(Boolean(editSo));
  const [editPoRef, setEditPoRef] = React.useState("");
  const [editRemarks, setEditRemarks] = React.useState("");
  const [editLines, setEditLines] = React.useState<DraftLineEdit[]>([]);
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [editCustomerDetail, setEditCustomerDetail] = React.useState<CustomerDetail | null>(null);
  const [editShipToId, setEditShipToId] = React.useState<string>("");
  const [editShowAddress, setEditShowAddress] = React.useState(false);
  const [invoiceModalSoId, setInvoiceModalSoId] = React.useState<number | null>(null);
  const [invoiceSo, setInvoiceSo] = React.useState<SalesInvoiceSoDetail | null>(null);
  const [invoiceLoading, setInvoiceLoading] = React.useState(false);
  const [invoiceError, setInvoiceError] = React.useState<string | null>(null);
  const [noQtyDraftRsBySoId, setNoQtyDraftRsBySoId] = React.useState<Record<number, boolean>>({});
  const [noQtyCloseDialog, setNoQtyCloseDialog] = React.useState<{ soId: number; docNo?: string | null } | null>(null);
  const [noQtyReopenDialog, setNoQtyReopenDialog] = React.useState<{ soId: number; docNo?: string | null } | null>(null);
  const [reopenAdminPassword, setReopenAdminPassword] = React.useState("");
  const [reopenMode, setReopenMode] = React.useState<"CONTINUE_SHORTAGE" | "IGNORE_SHORTAGE">("CONTINUE_SHORTAGE");
  const [reopenPreviewLoading, setReopenPreviewLoading] = React.useState(false);
  const [reopenPreviewError, setReopenPreviewError] = React.useState<string | null>(null);
  const [reopenPreview, setReopenPreview] = React.useState<{
    closedShortageLines: { itemId: number; closedShortageQty: number }[];
    currentUsableByItem: { itemId: number; usableQty: number }[];
    pendingQcDispositionByItem: { itemId: number; pendingQty: number }[];
    stockMayHaveChangedWarning: boolean;
  } | null>(null);
  const [activityHistoryOpen, setActivityHistoryOpen] = React.useState(false);

  /** Doc no for drill-focused SO when missing from list row (e.g. list not yet refreshed). */
  const [drillSoDocNo, setDrillSoDocNo] = React.useState<string | null>(null);

  const demoForcedMode: "REGULAR" | "NO_QTY" | null =
    demo.enabled && demo.flow === "regular" ? "REGULAR" : demo.enabled && demo.flow === "no_qty" ? "NO_QTY" : null;
  React.useEffect(() => {
    if (!demoForcedMode) return;
    if (soTypeFilter === demoForcedMode) return;
    patch({ soType: demoForcedMode === "REGULAR" ? null : demoForcedMode });
  }, [demoForcedMode, soTypeFilter, patch]);

  React.useEffect(() => {
    if (!listLoaded || focusSalesOrderId <= 0) return;
    const hit = rows.find((r) => r.id === focusSalesOrderId);
    if (!hit) return;
    const want: SalesOrdersListTab = hit.orderType === "NO_QTY" ? "NO_QTY" : "REGULAR";
    if (soTypeFilter === want) return;
    patch({ soType: want === "REGULAR" ? null : want });
  }, [listLoaded, focusSalesOrderId, rows, soTypeFilter, patch]);

  React.useEffect(() => {
    setActivityHistoryOpen(false);
  }, [focusSalesOrderId]);

  function load() {
    setError(null);
    return apiFetch<SoRow[]>("/api/sales-orders")
      .then(async (fetchedRows) => {
        setRows(fetchedRows);
        const noQtyRows = fetchedRows.filter((so) => so.orderType === "NO_QTY");
        const draftStatusPairs = await Promise.all(
          noQtyRows.map(async (so) => {
            try {
              const sheets = await apiFetch<RequirementSheetListRow[]>(`/api/sales-orders/${so.id}/requirement-sheets`);
              const currentCycleId = Number(so.currentCycle?.id);
              const hasDraftInCurrentCycle = sheets.some((sheet) => {
                if (sheet.status !== "DRAFT") return false;
                if (Number.isFinite(currentCycleId) && currentCycleId > 0) {
                  return Number(sheet.cycleId) === currentCycleId;
                }
                return true;
              });
              return [so.id, hasDraftInCurrentCycle] as const;
            } catch {
              return [so.id, false] as const;
            }
          }),
        );
        setNoQtyDraftRsBySoId(Object.fromEntries(draftStatusPairs));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setListLoaded(true));
  }

  function loadCustomers() {
    return apiFetch<Array<{ id: number; name: string }>>("/api/customers")
      .then((custRows) => {
        setCustomers(
          Array.isArray(custRows) ? custRows.map((r) => ({ id: r.id, name: r.name })) : [],
        );
      })
      .catch(() => setCustomers([]));
  }

  async function runNoQtyClose() {
    if (!noQtyCloseDialog) return;
    const { soId, docNo } = noQtyCloseDialog;
    try {
      const res = await apiFetch<{
        closedShortageSummary?: { totalClosedShortage: number; lines: { itemName: string; closedShortageQty: number }[] };
      }>(`/api/sales-orders/${soId}/close`, { method: "POST", body: JSON.stringify({}) });
      const label = displaySalesOrderNo(soId, docNo);
      const sum = res?.closedShortageSummary?.totalClosedShortage;
      const lines = res?.closedShortageSummary?.lines?.length
        ? ` Items: ${res.closedShortageSummary.lines.map((l) => `${l.itemName} ${l.closedShortageQty}`).join("; ")}`
        : "";
      toast.showSuccess(
        typeof sum === "number"
          ? `Sales Order ${label} closed. Closed shortage total: ${sum}.${lines}`
          : `Sales Order ${label} closed.`,
      );
      setNoQtyCloseDialog(null);
      await load();
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "Failed to close sales order.");
    }
  }

  React.useEffect(() => {
    if (!noQtyReopenDialog) {
      setReopenPreview(null);
      setReopenPreviewError(null);
      setReopenAdminPassword("");
      setReopenMode("CONTINUE_SHORTAGE");
      return;
    }
    let cancelled = false;
    setReopenPreviewLoading(true);
    setReopenPreviewError(null);
    apiFetch<{
      closedShortageLines: { itemId: number; closedShortageQty: number }[];
      currentUsableByItem: { itemId: number; usableQty: number }[];
      pendingQcDispositionByItem: { itemId: number; pendingQty: number }[];
      stockMayHaveChangedWarning: boolean;
    }>(`/api/sales-orders/${noQtyReopenDialog.soId}/reopen-preview`)
      .then((r) => {
        if (!cancelled) setReopenPreview(r);
      })
      .catch((e) => {
        if (!cancelled) setReopenPreviewError(e instanceof Error ? e.message : "Preview failed.");
      })
      .finally(() => {
        if (!cancelled) setReopenPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [noQtyReopenDialog]);

  async function runNoQtyReopen() {
    if (!noQtyReopenDialog) return;
    const pwd = reopenAdminPassword.trim();
    if (!pwd) {
      toast.showError("Admin password is required.");
      return;
    }
    const { soId, docNo } = noQtyReopenDialog;
    try {
      await apiFetch(`/api/sales-orders/${soId}/reopen`, {
        method: "POST",
        body: JSON.stringify({ adminPassword: pwd, mode: reopenMode }),
      });
      toast.showSuccess(`Sales Order ${displaySalesOrderNo(soId, docNo)} reopened.`);
      setNoQtyReopenDialog(null);
      await load();
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "Failed to reopen sales order.");
    }
  }

  React.useEffect(() => {
    // In quotation-mode or copy-from-previous we render a single-purpose screen; skip list/customer preloads.
    if (quotationFromUrl || copyFromPreviousActive) return;
    void load();
    void loadCustomers();
  }, [quotationFromUrl, copyFromPreviousActive]);

  React.useEffect(() => {
    if (openInvoiceFromUrl > 0) {
      setInvoiceModalSoId(openInvoiceFromUrl);
      patch({ openInvoice: null });
    }
  }, [openInvoiceFromUrl, patch]);

  React.useEffect(() => {
    if (invoiceModalSoId == null || invoiceModalSoId <= 0) {
      setInvoiceSo(null);
      setInvoiceError(null);
      setInvoiceLoading(false);
      return;
    }
    let cancelled = false;
    setInvoiceLoading(true);
    setInvoiceError(null);
    setInvoiceSo(null);
    apiFetch<SalesInvoiceSoDetail>(`/api/sales-orders/${invoiceModalSoId}`)
      .then((row) => {
        if (!cancelled) setInvoiceSo(row);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiRequestError && e.status === 404) {
          setInvoiceError("Sales order not found.");
        } else {
          setInvoiceError(e instanceof Error ? e.message : "Failed to load sales order");
        }
      })
      .finally(() => {
        if (!cancelled) setInvoiceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceModalSoId]);

  const customerOptions = React.useMemo(() => {
    const m = new Map<number, string>();
    for (const so of rows) {
      const id = so.customer?.id ?? so.po?.customer?.id;
      const name = so.customer?.name ?? so.po?.customer?.name;
      if (id != null && name) m.set(id, name);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }));
  }, [rows]);

  const visibleRows = React.useMemo(() => {
    let list = rows.filter((so) => {
      const stageMetaForFilter =
        so.orderType === "NO_QTY" ? getNoQtySoStageMeta(so, { isAdmin }) : null;
      const displayStatusForFilter = displaySoStatus(so, stageMetaForFilter?.stage ?? null);
      if (statusFilter !== "ALL" && displayStatusForFilter !== statusFilter) return false;
      if (soTypeFilter === "NO_QTY") {
        if (so.orderType !== "NO_QTY") return false;
      } else if (soTypeFilter === "REGULAR") {
        if (so.orderType === "NO_QTY") return false;
      }
      if (customerIdFilter > 0) {
        const cid = so.customer?.id ?? so.po?.customer?.id;
        if (cid !== customerIdFilter) return false;
      }
      if (listSearch) {
        const hit =
          String(so.id).includes(listSearch) ||
          (so.docNo ?? "").toLowerCase().includes(listSearch) ||
          (so.customer?.name ?? "").toLowerCase().includes(listSearch) ||
          (so.po?.customer?.name ?? "").toLowerCase().includes(listSearch) ||
          (so.customerPoReference ?? "").toLowerCase().includes(listSearch) ||
          (so.quotation?.quotationNo ?? "").toLowerCase().includes(listSearch) ||
          String(so.quotation?.id ?? "").includes(listSearch);
        if (!hit) return false;
      }
      // Production filter applies to Regular / replacement rows only (not NO_QTY lifecycle).
      if (so.orderType !== "NO_QTY" && prodFilter !== "ALL") {
        const pending = Number(so.dispatchSummary?.totalPending ?? 0) || 0;
        if (prodFilter === "PENDING" && pending <= 0) return false;
        if (prodFilter === "NONE" && pending > 0) return false;
      }
      return true;
    });
    list = [...list];
    list.sort((a, b) => {
      if (sortKey === "id") {
        const cmp = a.id - b.id;
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, statusFilter, customerIdFilter, listSearch, prodFilter, sortKey, sortDir, soTypeFilter, isAdmin]);

  const listFiltersActive =
    statusFilter !== "ALL" ||
    prodFilter !== "ALL" ||
    customerIdFilter > 0 ||
    listSearch.length > 0 ||
    sortKey !== "date" ||
    sortDir !== "desc";

  function clearListFilters() {
    setSearchDraft("");
    patch({
      status: null,
      prod: null,
      soType: null,
      search: null,
      customerId: null,
      sort: null,
      dir: null,
    });
  }

  // Note: rm-check and downstream steps are row actions or detail pages (no global NextStepStrip on this list).
  // The "Show" filter and pending column use dispatch pending (order fulfillment) for clarity.

  const clearSalesOrderDrillFocus = React.useCallback(() => {
    setSearchParams((prev) => deleteUrlParamKeys(prev, [DRILL_QUERY.salesOrderId]), { replace: true });
  }, [setSearchParams]);

  /** Clears list filters that can hide the focused SO; keeps sort, dir, quotationId, salesOrderId. */
  const revealSalesOrderDrillTarget = React.useCallback(() => {
    setSearchDraft("");
    patch({
      status: null,
      search: null,
      customerId: null,
      soType: null,
    });
  }, [patch, setSearchDraft]);

  const soDrillTargetInData = focusSalesOrderId > 0 && rows.some((r) => r.id === focusSalesOrderId);
  const soDrillTargetVisible = focusSalesOrderId > 0 && visibleRows.some((r) => r.id === focusSalesOrderId);
  const soDrillHiddenByFilters = listLoaded && soDrillTargetInData && !soDrillTargetVisible;

  /** Compact focus chrome only for dashboard / reports drill-down (not plain deep links). */
  const showSalesOrdersFocusedChrome = React.useMemo(() => {
    if (focusSalesOrderId <= 0) return false;
    const q = new URLSearchParams(location.search);
    const from = (q.get("from") ?? "").trim().toLowerCase();
    const source = (q.get("source") ?? "").trim().toLowerCase();
    return (
      isReportsReturnContext(location.search) || from === "dashboard" || source === "dashboard"
    );
  }, [focusSalesOrderId, location.search]);

  useDrillFocus({
    attribute: DRILL_DATA.salesOrderId,
    id: focusSalesOrderId,
    ready: listLoaded,
    enabled: focusSalesOrderId > 0,
    retryDeps: [rows.length, soDrillTargetVisible],
  });

  React.useEffect(() => {
    if (!Number.isFinite(focusSalesOrderId) || focusSalesOrderId <= 0) {
      setDrillSoDocNo(null);
      return;
    }
    const hit = rows.find((r) => r.id === focusSalesOrderId);
    if (hit) {
      setDrillSoDocNo(hit.docNo ?? null);
      return;
    }
    let cancelled = false;
    setDrillSoDocNo(null);
    void apiFetch<{ id: number; docNo?: string | null }>(`/api/sales-orders/${focusSalesOrderId}`)
      .then((so) => {
        if (!cancelled && so && so.id === focusSalesOrderId) setDrillSoDocNo(so.docNo ?? null);
      })
      .catch(() => {
        if (!cancelled) setDrillSoDocNo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [focusSalesOrderId, rows]);

  React.useEffect(() => {
    if (!quotationFromUrl) {
      setQDetail(null);
      setQuoteCreateLines([]);
      return;
    }
    setQLoading(true);
    setError(null);
    apiFetch<QuotationDetail>(`/api/quotations/${quotationFromUrl}`)
      .then((q) => {
        setQDetail(q);
        setCreatePoRef("");
        setCreateRemarks("");
        setCreatePoTouched(false);
        setQuoteCreateLines(
          (q.lines || []).map((ln) => ({
            itemId: ln.itemId,
            customerPoQty: String(Math.max(0, Math.floor(Number(ln.qty) || 0))),
          })),
        );
      })
      .catch((e) => {
        setQDetail(null);
        setQuoteCreateLines([]);
        setError(e instanceof Error ? e.message : "Failed to load quotation");
      })
      .finally(() => setQLoading(false));
  }, [quotationFromUrl]);

  React.useEffect(() => {
    if (!copyFromPreviousActive) {
      setCopyPreview(null);
      return;
    }
    setCopyLoading(true);
    setError(null);
    apiFetch<CopyPreviewDetail>(
      `/api/sales-orders/copy-preview?sourceType=${encodeURIComponent(copySourceRaw)}&id=${encodeURIComponent(String(copyIdFromUrl))}`,
    )
      .then((p) => {
        setCopyPreview(p);
        setCreatePoRef("");
        setCreateRemarks(
          p.sourceType === "SO" && p.remarksPreview != null && String(p.remarksPreview).trim() !== ""
            ? String(p.remarksPreview).trim()
            : "",
        );
        setCreatePoTouched(false);
        setQuoteCreateLines(
          (p.lines || []).map((ln) => ({
            itemId: ln.itemId,
            customerPoQty: String(Math.max(0, Math.floor(Number(ln.qty) || 0))),
          })),
        );
      })
      .catch((e) => {
        setCopyPreview(null);
        setQuoteCreateLines([]);
        setError(e instanceof Error ? e.message : "Failed to load template");
      })
      .finally(() => setCopyLoading(false));
  }, [copyFromPreviousActive, copySourceRaw, copyIdFromUrl]);

  const quoteDetailForCreate = React.useMemo((): QuotationDetail | null => {
    if (quotationFromUrl && qDetail) return qDetail;
    if (copyFromPreviousActive && copyPreview) {
      return {
        id: copyPreview.sourceId,
        quotationNo: copyPreview.quotationNo,
        workflowStatus: copyPreview.workflowStatus,
        salesOrder: copyPreview.existingSalesOrder,
        enquiry: copyPreview.enquiry,
        lines: copyPreview.lines.map((ln) => ({
          itemId: ln.itemId,
          qty: ln.qty,
          rate: ln.rate,
          lineTotal: ln.lineTotal || "0",
          isFree: ln.isFree,
          gstPct: ln.gstPct,
          item: { itemName: ln.itemName },
        })),
      };
    }
    return null;
  }, [quotationFromUrl, qDetail, copyFromPreviousActive, copyPreview]);

  const quoteFlowLoading = qLoading || (copyFromPreviousActive && copyLoading);

  const canCreateFromQuoteFlow = React.useMemo(
    () =>
      Boolean(
        quoteDetailForCreate &&
          !quoteFlowLoading &&
          (copyFromPreviousActive ||
            (quoteDetailForCreate.workflowStatus === "APPROVED" && !quoteDetailForCreate.salesOrder)),
      ),
    [quoteDetailForCreate, quoteFlowLoading, copyFromPreviousActive],
  );

  useFastEntryForm({
    containerRef: createFromQuoteRef,
    initialFocusRef: createPoRefInputRef,
    initialFocusEnabled: canCreateFromQuoteFlow,
  });

  React.useEffect(() => {
    if (!listLoaded || didAutoFocusSoListRef.current) return;
    if (!prefersFinePointer()) return;
    if (canCreateFromQuoteFlow) return;
    if (editSo) return;
    if (invoiceModalSoId != null) return;
    didAutoFocusSoListRef.current = true;
    const id = window.setTimeout(() => listFilterStatusSelectRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(id);
  }, [listLoaded, canCreateFromQuoteFlow, editSo, invoiceModalSoId]);

  React.useEffect(() => {
    if (!editSo) return;
    if (!prefersFinePointer()) return;
    const id = window.setTimeout(() => {
      const sel = editSoTypeSelectRef.current;
      if (sel && !sel.disabled) sel.focus({ preventScroll: true });
      else editDraftPoRefInputRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(id);
  }, [editSo?.id]);

  React.useEffect(() => {
    if (!createFromPreviousOpen) return;
    setPreviousPickLoading(true);
    const qUrl = "/api/sales-orders/regular-copy-sources/quotations";
    const soUrl = "/api/sales-orders/regular-copy-sources/sales-orders";
    Promise.all([
      apiFetch<typeof quotationPickOptions>(qUrl).catch(() => []),
      apiFetch<typeof soPickOptions>(soUrl).catch(() => []),
    ])
      .then(([qRows, soRows]) => {
        setQuotationPickOptions(Array.isArray(qRows) ? qRows : []);
        setSoPickOptions(Array.isArray(soRows) ? soRows : []);
      })
      .finally(() => setPreviousPickLoading(false));
  }, [createFromPreviousOpen]);

  /** `/sales-orders?action=new-so` sends users to Quotations (workflow continuation); `no-qty-so` opens exceptional NO_QTY create. */
  const quickEntryAction = searchParams.get("action") ?? "";
  React.useEffect(() => {
    if (quickEntryAction !== "new-so" && quickEntryAction !== "no-qty-so") return;
    patch({ action: null });
    if (quickEntryAction === "new-so") {
      navigate("/quotations", { replace: true });
      return;
    }
    openNoQtyCreateModal();
  }, [quickEntryAction, patch, navigate]);

  async function createFromPreviousSnapshot() {
    if (!copyPreview) return;
    const po = createPoRef.trim();
    if (!po) {
      setCreatePoTouched(true);
      setError("Customer PO reference is required.");
      toast.showError("Customer PO reference is required.");
      createPoRefInputRef.current?.focus();
      return;
    }
    if (
      !window.confirm(
        "Create a new approved Sales Order from this template? Original quotation or sales order records are not modified.",
      )
    ) {
      return;
    }
    if (quoteCreateLines.length !== copyPreview.lines.length) {
      const msg = "Lines do not match the template. Reload and try again.";
      setError(msg);
      toast.showError(msg);
      return;
    }
    for (let i = 0; i < copyPreview.lines.length; i += 1) {
      if (Number(quoteCreateLines[i]?.itemId) !== Number(copyPreview.lines[i]?.itemId)) {
        const msg = "Line items are out of order. Reload and try again.";
        setError(msg);
        toast.showError(msg);
        return;
      }
    }
    if (
      quoteCreateLines.some(
        (l) => !Number.isFinite(Number(l.customerPoQty)) || Math.floor(Number(l.customerPoQty)) <= 0,
      )
    ) {
      setError("Enter a valid Customer PO Qty (greater than zero) for every line.");
      toast.showError("Enter a valid Customer PO Qty for every line.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: number; docNo?: string | null }>(`/api/sales-orders/from-previous`, {
        method: "POST",
        body: JSON.stringify({
          sourceType: copyPreview.sourceType,
          sourceId: copyPreview.sourceId,
          customerPoReference: po,
          remarks: createRemarks.trim() || null,
          lines: quoteCreateLines.map((l) => ({
            itemId: l.itemId,
            customerPoQty: Math.floor(Number(l.customerPoQty)),
            bufferPercent: 0,
          })),
        }),
      });
      toast.showSuccess(REGULAR_TERMS.TOAST_CONTINUE_PREPARE_WORK_ORDER);
      patch({ copySource: null, copyId: null });
      navigate(`/work-orders/prepare?salesOrderId=${encodeURIComponent(String(created.id))}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setCreating(false);
    }
  }

  async function createFromQuotation() {
    if (copyFromPreviousActive && copyPreview) {
      await createFromPreviousSnapshot();
      return;
    }
    if (!qDetail || qDetail.workflowStatus !== "APPROVED" || qDetail.salesOrder) return;
    const po = createPoRef.trim();
    if (!po) {
      setCreatePoTouched(true);
      setError("Customer PO reference is required.");
      toast.showError("Customer PO reference is required.");
      createPoRefInputRef.current?.focus();
      return;
    }
    if (!window.confirm("Create approved Sales Order from this approved quotation?")) {
      return;
    }
    if (quoteCreateLines.length !== qDetail.lines.length) {
      const msg = "Quotation lines do not match the form. Reload and try again.";
      setError(msg);
      toast.showError(msg);
      return;
    }
    for (let i = 0; i < qDetail.lines.length; i += 1) {
      if (Number(quoteCreateLines[i]?.itemId) !== Number(qDetail.lines[i].itemId)) {
        const msg = "Line items are out of order. Reload and try again.";
        setError(msg);
        toast.showError(msg);
        return;
      }
    }
    if (
      quoteCreateLines.some(
        (l) => !Number.isFinite(Number(l.customerPoQty)) || Math.floor(Number(l.customerPoQty)) <= 0,
      )
    ) {
      setError("Enter a valid Customer PO Qty (greater than zero) for every line.");
      toast.showError("Enter a valid Customer PO Qty for every line.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: number; docNo?: string | null }>(`/api/sales-orders/from-quotation/${qDetail.id}`, {
        method: "POST",
        body: JSON.stringify({
          customerPoReference: po,
          remarks: createRemarks.trim() || null,
          lines: quoteCreateLines.map((l) => ({
            itemId: l.itemId,
            customerPoQty: Math.floor(Number(l.customerPoQty)),
            bufferPercent: 0,
          })),
        }),
      });
      toast.showSuccess(REGULAR_TERMS.TOAST_CONTINUE_PREPARE_WORK_ORDER);
      // Guided: go straight to the next operational step (Work Order planning).
      navigate(`/work-orders/prepare?salesOrderId=${encodeURIComponent(String(created.id))}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(so: SoRow) {
    setEditSo(so);
    setEditPoRef(so.customerPoReference ?? "");
    setEditRemarks(so.remarks ?? "");
    setEditCustomerDetail(null);
    setEditShipToId(so.shipToAddressId != null ? String(so.shipToAddressId) : "");
    setEditShowAddress(false);
    setEditLines(
      so.lines.map((l) => {
        const qf = l.quotationLine?.isFree ?? l.isFree;
        const rateLabel =
          so.orderType === "NO_QTY"
            ? Number(l.rate ?? 0).toFixed(2)
            : l.quotationLine != null
              ? qf
                ? "0 (Free)"
                : Number(l.quotationLine.rate).toFixed(2)
              : "—";
        if (so.orderType === "NORMAL") {
          return {
            lineId: l.id,
            itemName: l.item.itemName,
            isFree: Boolean(qf),
            rateLabel,
            customerPoQty: String(Number(l.customerPoQty ?? l.qty)),
          };
        }
        return {
          lineId: l.id,
          itemName: l.item.itemName,
          isFree: Boolean(qf),
          rateLabel,
          qty: String(l.qty),
        };
      }),
    );
  }

  React.useEffect(() => {
    if (!editSo || !editSo.customerId) {
      setEditCustomerDetail(null);
      return;
    }
    let cancelled = false;
    apiFetch<CustomerDetail>(`/api/customers/${editSo.customerId}`)
      .then((c) => {
        if (cancelled) return;
        setEditCustomerDetail(c ?? null);
      })
      .catch(() => {
        if (!cancelled) setEditCustomerDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [editSo?.id, editSo?.customerId]);

  function openNoQtyCreateModal() {
    void loadCustomers();
    setError(null);
    setNoQtyCreateOpen(true);
    setNoQtyCustomerId(0);
    setNoQtyPoRef("");
    setNoQtyRemarks("");
    setNoQtyLines([{ key: String(Date.now()), itemId: 0 }]);
    if (fgItems.length === 0) {
      apiFetch<FgItemOption[]>("/api/items?type=FG")
        .then((xs) => setFgItems(Array.isArray(xs) ? xs : []))
        .catch(() => setFgItems([]));
    }
  }

  const demoNoQtyPrefilledRef = React.useRef(false);
  React.useEffect(() => {
    if (!noQtyCreateOpen) demoNoQtyPrefilledRef.current = false;
  }, [noQtyCreateOpen]);
  React.useEffect(() => {
    if (!demo.enabled || demo.flow !== "no_qty" || demo.step !== 1) return;
    if (!noQtyCreateOpen || demoNoQtyPrefilledRef.current) return;
    if (customers.length < 1 || fgItems.length < 1) return;
    demoNoQtyPrefilledRef.current = true;
    setNoQtyCustomerId(customers[0].id);
    setNoQtyPoRef("DEMO-PO-001");
    setNoQtyRemarks("Demo walkthrough");
    setNoQtyLines([{ key: "demo-1", itemId: fgItems[0].id }]);
  }, [demo.enabled, demo.flow, demo.step, noQtyCreateOpen, customers, fgItems]);

  async function saveNoQtyCreate(e: React.FormEvent) {
    e.preventDefault();
    if (noQtyCustomerId <= 0) {
      setError("Customer is required.");
      toast.showError("Customer is required.");
      return;
    }
    const noQtyPoTrimmed = noQtyPoRef.trim();
    if (!noQtyPoTrimmed) {
      setError("Customer PO reference is required.");
      toast.showError("Customer PO reference is required.");
      return;
    }
    const items = noQtyLines.map((l) => ({ itemId: Number(l.itemId) })).filter((x) => Number.isFinite(x.itemId) && x.itemId > 0);
    if (items.length < 1) {
      setError("At least one item is required.");
      toast.showError("At least one item is required.");
      return;
    }
    setSavingNoQty(true);
    setError(null);
    try {
      await apiFetch("/api/sales-orders/no-qty", {
        method: "POST",
        body: JSON.stringify({
          customerId: noQtyCustomerId,
          customerPoReference: noQtyPoTrimmed,
          remarks: noQtyRemarks.trim() || null,
          items,
        }),
      });
      setNoQtyCreateOpen(false);
      load();
      toast.showSuccess("No Qty SO created");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSavingNoQty(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editSo) return;
    if (editLines.length < 1) {
      setError("At least one line is required.");
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const isNoQty = editSo.orderType === "NO_QTY";
      const isNormal = editSo.orderType === "NORMAL";
      const lines = isNoQty
        ? editLines.map((l) => ({ lineId: l.lineId, qty: 0 }))
        : isNormal
          ? editLines.map((l) => ({
              lineId: l.lineId,
              customerPoQty: Number(l.customerPoQty),
              bufferPercent: 0,
            }))
          : editLines.map((l) => ({ lineId: l.lineId, qty: Number(l.qty) }));
      if (isNormal) {
        if (
          lines.some(
            (x) =>
              !Number.isFinite((x as { customerPoQty: number }).customerPoQty) ||
              (x as { customerPoQty: number }).customerPoQty <= 0,
          )
        ) {
          setError("Enter a valid Customer PO Qty for all lines.");
          setSavingEdit(false);
          return;
        }
      } else if (!isNoQty && lines.some((x) => !Number.isFinite((x as { qty: number }).qty) || (x as { qty: number }).qty <= 0)) {
        setError("Enter valid quantities for all lines.");
        setSavingEdit(false);
        return;
      }
      await apiFetch(`/api/sales-orders/${editSo.id}`, {
        method: "PUT",
        body: JSON.stringify({
          customerPoReference: editPoRef.trim() || null,
          remarks: editRemarks.trim() || null,
          shipToAddressId: editShipToId ? Number(editShipToId) : null,
          // Keep regular SO flow unchanged: qty edits only apply to non-NO_QTY draft SOs.
          lines,
        }),
      });
      setEditSo(null);
      load();
      toast.showSuccess("Sales order updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingEdit(false);
    }
  }

  async function approveSo(id: number) {
    if (!confirm("Approve this sales order?")) return;
    setError(null);
    try {
      await apiFetch(`/api/sales-orders/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ internalStatus: "APPROVED" }),
      });
      load();
      toast.showSuccess("Sales order approved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg);
      toast.showError(msg);
    }
  }

  async function onDelete(id: number) {
    if (
      !confirm(
        "Delete this Sales Order permanently?\n\nThis will remove the Sales Order and any draft requirement data linked to it.\nThis action cannot be undone.",
      )
    ) {
      return;
    }
    try {
      await apiFetch(`/api/sales-orders/${id}`, { method: "DELETE" });
      load();
      toast.showSuccess("Deleted");
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Failed";
      setError(msg);
      toast.showError(msg);
    }
  }

  function removeEditLine(lineId: number) {
    setEditLines((prev) => prev.filter((l) => l.lineId !== lineId));
  }

  const firstEditLineIdRef = React.useRef<number | null>(null);
  firstEditLineIdRef.current = editSo ? (editLines[0]?.lineId ?? null) : null;

  const editSoRef = React.useRef(editSo);
  editSoRef.current = editSo;

  const quotePoBind = shortcutHints.bindField("soQuotePoRef", {
    onChange: (e) => setCreatePoRef((e.target as HTMLInputElement).value),
  });

  const soEditQtyBind = shortcutHints.bindField("soEditQty", {
    onChange: (e) => {
      const fid = firstEditLineIdRef.current;
      if (fid == null) return;
      const v = (e.target as HTMLInputElement).value;
      const ot = editSoRef.current?.orderType;
      setEditLines((prev) =>
        prev.map((x) =>
          x.lineId === fid
            ? ot === "NORMAL"
              ? { ...x, customerPoQty: v }
              : { ...x, qty: v }
            : x,
        ),
      );
    },
  });

  const soEditSaveFocusBind = shortcutHints.bindField("soEditSave");
  const quoteCreateFocusBind = shortcutHints.bindField("soQuoteCreate");

  const creatingRef = React.useRef(creating);
  creatingRef.current = creating;
  const savingEditRef = React.useRef(savingEdit);
  savingEditRef.current = savingEdit;

  const createFromQuotationRef = React.useRef(createFromQuotation);
  createFromQuotationRef.current = createFromQuotation;

  const canCreateFromQuoteRef = React.useRef(false);
  canCreateFromQuoteRef.current = Boolean(
    quoteDetailForCreate &&
      !quoteFlowLoading &&
      (copyFromPreviousActive ||
        (quoteDetailForCreate.workflowStatus === "APPROVED" && !quoteDetailForCreate.salesOrder)),
  );

  const markShortcutRef = React.useRef(shortcutHints.markFieldShortcutUsed);
  markShortcutRef.current = shortcutHints.markFieldShortcutUsed;

  React.useEffect(() => {
    function onGlobalKey(ev: KeyboardEvent) {
      if (ev.defaultPrevented) return;
      if (invoiceModalSoId != null) return;

      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "Digit1") {
        if (!canCreateFromQuoteRef.current || creatingRef.current) return;
        ev.preventDefault();
        markShortcutRef.current("soQuotePoRef");
        createPoRefInputRef.current?.focus();
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyS") {
        if (editSoRef.current && !savingEditRef.current) {
          ev.preventDefault();
          markShortcutRef.current("soEditSave");
          editFormRef.current?.requestSubmit();
          return;
        }
        const el = document.activeElement;
        const inQuote =
          canCreateFromQuoteRef.current &&
          !creatingRef.current &&
          createFromQuoteRef.current &&
          el instanceof Node &&
          createFromQuoteRef.current.contains(el);
        if (inQuote) {
          ev.preventDefault();
          markShortcutRef.current("soQuoteCreate");
          void createFromQuotationRef.current();
        }
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        if (editSoRef.current && !savingEditRef.current) {
          ev.preventDefault();
          markShortcutRef.current("soEditSave");
          editFormRef.current?.requestSubmit();
          return;
        }
        const el = document.activeElement;
        const inQuote =
          canCreateFromQuoteRef.current &&
          !creatingRef.current &&
          createFromQuoteRef.current &&
          el instanceof Node &&
          createFromQuoteRef.current.contains(el);
        if (inQuote) {
          ev.preventDefault();
          markShortcutRef.current("soQuoteCreate");
          void createFromQuotationRef.current();
        }
        return;
      }
    }
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, [invoiceModalSoId]);

  return (
    <PageContainer className="pb-10 sm:pb-14">
      {quotationFromUrl || copyFromPreviousActive ? (
        <>
          <StickyWorkspaceHead
            lead={
              copyFromPreviousActive ? (
                <PageSmartBackLink defaultTo="/sales-orders" defaultLabel="Back to sales orders" />
              ) : (
                <PageSmartBackLink defaultTo="/quotations" defaultLabel="Back to Quotations" />
              )
            }
          >
            <PageHeader
              title={
                copyFromPreviousActive
                  ? copyPreview?.sourceType === "SO"
                    ? "Create Sales Order from previous order"
                    : "Create Sales Order from previous quotation"
                  : quoteDetailForCreate?.quotationNo
                    ? `Create Sales Order from Quotation (${quoteDetailForCreate.quotationNo})`
                    : "Create Sales Order from Quotation"
              }
              actions={null}
            />
          </StickyWorkspaceHead>

          <div className="grid gap-4">
            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
            ) : null}

            <Card className="border-slate-200 shadow-sm" data-testid="create-so-from-quotation-btn">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Sales Order details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {quoteFlowLoading ? <p className="text-slate-600">Loading…</p> : null}

                {!quoteFlowLoading && quoteDetailForCreate ? (
                  <>
                    {!copyFromPreviousActive && quoteDetailForCreate.workflowStatus !== "APPROVED" ? (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                        Only an <strong>approved</strong> quotation can generate a sales order. This quotation is{" "}
                        <strong>{quoteDetailForCreate.workflowStatus.replace(/_/g, " ")}</strong>.
                      </p>
                    ) : !copyFromPreviousActive && quoteDetailForCreate.salesOrder ? (
                      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800">
                        A sales order already exists for this quotation:{" "}
                        <span className="font-mono">
                          {displaySalesOrderNo(
                            quoteDetailForCreate.salesOrder.id,
                            quoteDetailForCreate.salesOrder.docNo,
                          )}
                        </span>
                      </p>
                    ) : (
                      <>
                        {copyFromPreviousActive && copyPreview?.existingSalesOrder && copyPreview.sourceType === "QUOTATION" ? (
                          <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] leading-snug text-sky-950">
                            This quotation already has{" "}
                            <span className="font-mono font-semibold">
                              {displaySalesOrderNo(
                                copyPreview.existingSalesOrder.id,
                                copyPreview.existingSalesOrder.docNo,
                              )}
                            </span>
                            . You are creating an <strong>additional</strong> sales order using the same commercial snapshot;
                            existing documents are unchanged.
                          </p>
                        ) : null}
                        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] leading-snug text-sky-950">
                          This sales order will be created as <strong>Approved</strong>
                          {copyFromPreviousActive ? (
                            <> using the selected template snapshot.</>
                          ) : (
                            <>
                              {" "}
                              because the quotation is already approved. {REGULAR_TERMS.SALES_ORDER_APPROVED_RM_CHECK_HINT}
                            </>
                          )}{" "}
                          Set <strong>Customer PO Qty</strong> as the customer commitment (dispatch cap). Production buffer,
                          if needed, is set later on the work order.
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="erp-form-field">
                            <span className="erp-form-label">Customer</span>
                            <Input value={quoteDetailForCreate.enquiry.customer.name} disabled />
                          </div>
                          <div className="erp-form-field">
                            <span className="erp-form-label">
                              {copyFromPreviousActive && copyPreview?.sourceType === "SO" ? "Previous sales order" : "Quotation"}
                            </span>
                            <Input
                              value={
                                copyFromPreviousActive && copyPreview?.sourceType === "SO"
                                  ? copyPreview.quotationNo || `SO-${copyPreview.sourceId}`
                                  : quoteDetailForCreate.quotationNo || `#${quoteDetailForCreate.id}`
                              }
                              disabled
                            />
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Lines — customer commitment
                          </div>
                          <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
                            <table className="min-w-full text-sm">
                              <thead className="bg-slate-50">
                                <tr className="text-left text-xs font-semibold text-slate-600">
                                  <th className="px-3 py-2">Item</th>
                                  <th className="px-3 py-2 text-right">Customer PO Qty</th>
                                  <th className="px-3 py-2 text-right">Rate</th>
                                  <th className="px-3 py-2 text-right">GST %</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {quoteDetailForCreate.lines.map((ln, idx) => {
                                  const row = quoteCreateLines[idx];
                                  const gstPctStr = ln.gstPct;
                                  const gstLabel =
                                    gstPctStr != null && String(gstPctStr).trim() !== ""
                                      ? `${Number(gstPctStr).toFixed(0)}%`
                                      : "—";
                                  return (
                                    <tr
                                      key={ln.id != null ? `ql-${ln.id}` : `${quoteDetailForCreate.id}-ln-${idx}`}
                                      className="bg-white"
                                    >
                                      <td className="px-3 py-2 font-medium text-slate-900">
                                        {ln.item.itemName}
                                        {ln.isFree ? (
                                          <span className="ml-2 text-xs font-semibold text-emerald-800">(Free)</span>
                                        ) : null}
                                      </td>
                                      <td className="px-3 py-2 text-right align-middle">
                                        <Input
                                          className="ml-auto w-28 text-right tabular-nums"
                                          inputMode="numeric"
                                          value={row?.customerPoQty ?? ""}
                                          onChange={(e) =>
                                            setQuoteCreateLines((prev) => {
                                              const next = [...prev];
                                              if (next[idx]) next[idx] = { ...next[idx], customerPoQty: e.target.value };
                                              return next;
                                            })
                                          }
                                        />
                                      </td>
                                      <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                                        {ln.isFree ? "0 (Free)" : Number(ln.rate).toFixed(2)}
                                      </td>
                                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{gstLabel}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Customer PO Qty is stored as-is on the sales order. Optional production buffer for rejection
                            risk is applied on work order planning only.
                          </p>
                        </div>

                        <div ref={createFromQuoteRef} className="grid gap-3">
                          <div className="erp-form-field">
                            <span className="erp-form-label">Customer PO reference (required)</span>
                            <Input
                              ref={createPoRefInputRef}
                              data-testid="customer-po-input"
                              {...quotePoBind}
                              value={createPoRef}
                              onChange={(e) => {
                                setCreatePoRef(e.target.value);
                                setCreatePoTouched(true);
                                if (error === "Customer PO reference is required." && e.target.value.trim()) {
                                  setError(null);
                                }
                              }}
                              placeholder="Customer PO number"
                            />
                            {createPoTouched && !createPoRef.trim() ? (
                              <div className="mt-1 text-xs font-medium text-red-700">
                                Customer PO reference is required.
                              </div>
                            ) : null}
                          </div>

                          <div className="erp-form-field">
                            <span className="erp-form-label">Remarks (optional)</span>
                            <Input
                              value={createRemarks}
                              onChange={(e) => setCreateRemarks(e.target.value)}
                              placeholder="Internal notes"
                            />
                          </div>

                          <div className="flex flex-wrap justify-end gap-2 pt-1">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => patch({ quotationId: null, copySource: null, copyId: null })}
                              disabled={creating}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              data-testid="create-so-submit-btn"
                              onFocus={quoteCreateFocusBind.onFocus}
                              onBlur={quoteCreateFocusBind.onBlur}
                              onClick={() => {
                                shortcutHints.markFieldShortcutUsed("soQuoteCreate");
                                void createFromQuotation();
                              }}
                              disabled={creating}
                            >
                              {creating ? "Creating…" : "Create Sales Order"}
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {quotationFromUrl || copyFromPreviousActive ? null : (
        <>
          <StickyWorkspaceHead
            lead={
              /* Uses ?from= / ?source=, navigation state, session workflow hint (after Enquiries/Quotations), then dashboard. */
              <PageSmartBackLink
                workflowSessionFallback
                defaultTo="/dashboard"
                defaultLabel="Back to Dashboard"
              />
            }
          >
            <div className="erp-page-header mb-1 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="erp-type-page-title text-xl font-extrabold uppercase tracking-[0.14em] text-slate-900">
                  SALES ORDERS
                </h2>
                <p className="mt-1 max-w-xl text-[12.5px] font-medium leading-snug text-slate-600">
                  Operational customer order tracking
                </p>
              </div>
              {canUseCommercialQuotations ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Link
                    to="/quotations"
                    className={cn(buttonVariants({ size: "sm" }), "no-underline")}
                    data-testid="open-approved-quotations-btn"
                    title="Open Quotations — create a sales order from an approved quotation"
                    {...(soDemoHlRegular ? { "data-demo-highlight": soDemoHlRegular } : {})}
                  >
                    Open approved quotations
                  </Link>
                </div>
              ) : null}
            </div>
          </StickyWorkspaceHead>

          <div className="sales-orders-page-shell grid gap-1">
            <DemoFlowBanner />

            <div
              className="flex border-b border-slate-200"
              role="tablist"
              aria-label="Sales order list type"
            >
              {(
                [
                  { id: "REGULAR" as const, label: "Regular Orders" },
                  { id: "NO_QTY" as const, label: "NO_QTY Agreements" },
                ] as const
              ).map((tab) => {
                const selected = soTypeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={cn(
                      "-mb-px border-b-2 px-4 py-2 text-[13px] font-semibold transition-colors",
                      selected
                        ? "border-slate-900 text-slate-900"
                        : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800",
                    )}
                    onClick={() => patch({ soType: tab.id === "REGULAR" ? null : tab.id })}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <details
              className="erp-advanced-section opacity-95"
              {...(soDemoHlNoQty ? { "data-demo-highlight": soDemoHlNoQty } : {})}
            >
              <summary>
                <span className="font-normal normal-case tracking-normal text-slate-500">
                  Advanced · Exceptional creation (bypasses enquiry → quotation)
                </span>
              </summary>
              <div className="erp-advanced-body">
                <p className="mb-1.5 text-slate-500">For admin / edge cases only. Prefer Quotations for normal work.</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="erp-soft-action"
                    data-testid="create-from-previous-btn"
                    onClick={() => {
                      setPreviousKind("QUOTATION");
                      setPreviousPickId(0);
                      setCreateFromPreviousOpen(true);
                    }}
                  >
                    Create from previous…
                  </button>
                  <button
                    type="button"
                    className="erp-soft-action"
                    onClick={() => openNoQtyCreateModal()}
                  >
                    New NO_QTY SO (exception)
                  </button>
                </div>
              </div>
            </details>

      {createFromPreviousOpen ? (
        <ErpModal onClose={() => setCreateFromPreviousOpen(false)} aria-labelledby="so-create-from-prev-title">
          <Card className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle id="so-create-from-prev-title" className="text-base">
                  Create from previous
                </CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreateFromPreviousOpen(false)}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Select source</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
                  <input
                    type="radio"
                    name="copy-prev-kind"
                    checked={previousKind === "QUOTATION"}
                    onChange={() => {
                      setPreviousKind("QUOTATION");
                      setPreviousPickId(0);
                    }}
                  />
                  Previous quotation
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
                  <input
                    type="radio"
                    name="copy-prev-kind"
                    checked={previousKind === "SO"}
                    onChange={() => {
                      setPreviousKind("SO");
                      setPreviousPickId(0);
                    }}
                  />
                  Previous sales order
                </label>
              </div>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">
                  {previousKind === "QUOTATION" ? "Approved quotation" : "Sales order"}
                </span>
                <select
                  className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={previousPickId || ""}
                  disabled={previousPickLoading}
                  onChange={(e) => setPreviousPickId(Number(e.target.value) || 0)}
                >
                  <option value="">{previousPickLoading ? "Loading…" : "Select…"}</option>
                  {previousKind === "QUOTATION"
                    ? quotationPickOptions.map((q) => (
                        <option key={q.id} value={q.id}>
                          {(q.quotationNo || `#${q.id}`) + ` — ${q.customerName}`}
                          {q.existingSalesOrderId != null ? " (has SO)" : ""}
                        </option>
                      ))
                    : soPickOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {(s.docNo || `SO-${s.id}`) + ` — ${s.customerName}`} · {s.lineCount} line(s)
                        </option>
                      ))}
                </select>
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setCreateFromPreviousOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={previousPickId <= 0 || previousPickLoading}
                  onClick={() => {
                    setCreateFromPreviousOpen(false);
                    patch({
                      copySource: previousKind,
                      copyId: previousPickId,
                      quotationId: null,
                    });
                  }}
                >
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}

      {noQtyCreateOpen ? (
        <ErpModal onClose={() => setNoQtyCreateOpen(false)}>
          <Card className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Create No Qty SO</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveNoQtyCreate} className="erp-form space-y-3">
                <div className="erp-form-field">
                  <span className="erp-form-label">SO type</span>
                  <Input value="No Qty SO" disabled />
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Customer *</span>
                  <select
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                    value={noQtyCustomerId || ""}
                    onChange={(e) => setNoQtyCustomerId(Number(e.target.value) || 0)}
                  >
                    <option value="">Select…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Customer PO reference *</span>
                  <Input
                    value={noQtyPoRef}
                    onChange={(e) => {
                      setNoQtyPoRef(e.target.value);
                      if (error === "Customer PO reference is required." && e.target.value.trim()) setError(null);
                    }}
                    aria-invalid={noQtyPoRef.trim() === ""}
                  />
                  {noQtyPoRef.trim() === "" ? (
                    <div className="mt-1 text-xs font-medium text-red-700">Customer PO reference is required.</div>
                  ) : null}
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Remarks</span>
                  <Input value={noQtyRemarks} onChange={(e) => setNoQtyRemarks(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-800">Items</div>
                  <p className="text-xs leading-relaxed text-slate-600">
                    Commercial rates are loaded from approved rate contracts as of today (not from requirement sheets).
                  </p>
                  <p className="text-xs font-medium text-slate-700">Quantity will be defined later in Requirement Sheet (RS).</p>
                  {noQtyLines.map((ln) => (
                    <div key={ln.key} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 p-2">
                      <label className="grid min-w-0 flex-1 gap-1 text-sm">
                        <span className="text-slate-600">Item *</span>
                        <select
                          className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                          value={ln.itemId || ""}
                          onChange={(e) => {
                            const selectedItemId = Number(e.target.value) || 0;
                            const alreadySelected = noQtyLines.some((i) => i.key !== ln.key && i.itemId === selectedItemId);
                            if (selectedItemId > 0 && alreadySelected) {
                              toast.showError("Item already added");
                              return;
                            }
                            setNoQtyLines((p) =>
                              p.map((x) => (x.key === ln.key ? { ...x, itemId: selectedItemId } : x)),
                            );
                          }}
                        >
                          <option value="">Select…</option>
                          {fgItems.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.itemName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setNoQtyLines((p) => p.filter((x) => x.key !== ln.key))}
                        disabled={noQtyLines.length <= 1}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setNoQtyLines((p) => [...p, { key: String(Date.now()), itemId: 0 }])}
                  >
                    + Add item
                  </Button>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setNoQtyCreateOpen(false)} disabled={savingNoQty}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      savingNoQty ||
                      noQtyCustomerId <= 0 ||
                      noQtyPoRef.trim() === "" ||
                      noQtyLines.filter((l) => Number(l.itemId) > 0).length === 0
                    }
                  >
                    {savingNoQty ? "Saving…" : "Save"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}

      {showSalesOrdersFocusedChrome ? (
        <div
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] text-slate-800"
          role="status"
        >
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-slate-900">Focused SO:</span>{" "}
            <span className="font-mono font-medium tabular-nums text-slate-900">
              {displaySalesOrderNo(focusSalesOrderId, drillSoDocNo)}
            </span>
            {listLoaded && focusSalesOrderId > 0 && !soDrillTargetInData ? (
              <span className="ml-2 text-xs font-normal text-amber-800">{DRILL_FOCUS_HINT_NOT_IN_LIST.salesOrder}</span>
            ) : null}
            {soDrillHiddenByFilters ? (
              <span className="ml-2 text-xs font-normal text-amber-800">{DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS.salesOrder}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {soDrillHiddenByFilters ? (
              <Button type="button" variant="outline" size="sm" onClick={revealSalesOrderDrillTarget}>
                {DRILL_RECOVERY_LABEL.salesOrder}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-slate-700" onClick={clearSalesOrderDrillFocus}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <Card className="border border-slate-300 bg-white shadow-none">
        <CardHeader className="flex flex-col gap-1 space-y-0 border-b border-slate-200 bg-slate-100 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-800">Sales order list</CardTitle>
            {listFiltersActive && rows.length > 0 ? (
              <span className="text-[11px] text-slate-500">
                <span className="font-semibold tabular-nums text-slate-700">{visibleRows.length}</span>
                <span> / </span>
                <span className="tabular-nums">{rows.length}</span>
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="erp-soft-action"
            disabled={!listFiltersActive}
            onClick={clearListFilters}
          >
            Clear filters
          </button>
        </CardHeader>
        <CardContent className="space-y-1.5 px-0 pb-2 pt-0">
          <div ref={listFiltersRef} className="erp-filter-bar px-2.5 py-1">
            <label className="erp-filter-field">
              <span className="text-slate-500">Status</span>
              <select
                ref={listFilterStatusSelectRef}
                value={statusFilter}
                onChange={(e) => patch({ status: e.target.value as typeof statusFilter })}
              >
                <option value="ALL">All</option>
                <option value="DRAFT">Draft</option>
                <option value="OPEN">Open</option>
                <option value="APPROVED">Approved</option>
                <option value="IN_PROCESS">In Process</option>
                <option value="COMPLETED">Completed</option>
                <option value="CLOSED">Closed</option>
              </select>
            </label>
            {soTypeFilter !== "NO_QTY" ? (
              <label className="erp-filter-field">
                <span className="text-slate-500">Show</span>
                <select
                  value={prodFilter}
                  onChange={(e) => patch({ prod: e.target.value as typeof prodFilter })}
                >
                  <option value="ALL">All</option>
                  <option value="PENDING">Pending production</option>
                  <option value="NONE">No pending</option>
                </select>
              </label>
            ) : null}
            <label className="erp-filter-field">
              <span className="text-slate-500">Customer</span>
              <select
                value={customerIdFilter || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  patch({ customerId: v ? Number(v) : null });
                }}
              >
                <option value="">All</option>
                {customerOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <span className="erp-filter-divider" aria-hidden />
            <label className="erp-filter-field">
              <span className="text-slate-500">Sort</span>
              <select
                value={sortKey}
                onChange={(e) => patch({ sort: e.target.value as "date" | "id" })}
              >
                <option value="date">Date</option>
                <option value="id">SO #</option>
              </select>
            </label>
            <button
              type="button"
              className="erp-soft-action shrink-0"
              onClick={() => patch({ dir: sortDir === "asc" ? "desc" : "asc" })}
              aria-label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
              title={sortDir === "asc" ? "Ascending" : "Descending"}
            >
              {sortDir === "asc" ? (
                <>
                  Asc <ChevronUp className="ml-0.5 inline h-3 w-3" />
                </>
              ) : (
                <>
                  Desc <ChevronDown className="ml-0.5 inline h-3 w-3" />
                </>
              )}
            </button>
            <label className="erp-filter-field erp-filter-grow">
              <span className="sr-only">Search</span>
              <input
                type="search"
                className="search-input w-full"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search SO #, customer, PO ref, quotation…"
                data-erp-enter-default
              />
            </label>
          </div>
          <div className="space-y-2 px-2.5 pb-0.5 pt-0">
            {soTypeFilter === "NO_QTY" && visibleRows.length > 0 ? (
              <div className="erp-table-wrap border-x-0 border-t-0">
                <table className="erp-table sales-orders-so-table w-full min-w-[1000px]">
                  <colgroup>
                    <col style={{ width: "7.25rem" }} />
                    <col style={{ width: "5.75rem" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "9rem" }} />
                    <col style={{ width: "9rem" }} />
                    <col style={{ width: "17%" }} />
                    <col style={{ width: "19%" }} />
                    <col style={{ width: "8.5rem" }} />
                    <col style={{ width: "11rem" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={cn(sortKey === "id" && "bg-slate-300/80")}>SO No.</th>
                      <th className={cn(sortKey === "date" && "bg-slate-300/80")}>Date</th>
                      <th>Customer</th>
                      <th>PO Ref</th>
                      <th>Type</th>
                      <th>Current position</th>
                      <th>Commercial status</th>
                      <th className="text-right">Next action</th>
                      <th className="erp-table-action-col erp-so-th-num">Actions</th>
                    </tr>
                  </thead>
                <tbody>
                  {visibleRows.map((so) => {
                    const meta = getNoQtySoStageMeta(so, { isAdmin });
                    const isClosed =
                      so.internalStatus === "MANUALLY_CLOSED" ||
                      so.internalStatus === "CLOSED" ||
                      so.internalStatus === "COMPLETED" ||
                      so.processStage?.key === "COMPLETED";
                    const hasDraftRequirementSheet = Boolean(noQtyDraftRsBySoId[so.id]);
                    const stage = meta.stage;
                    const displayStage =
                      so.internalStatus === "CLOSED" || so.internalStatus === "MANUALLY_CLOSED" ? "CLOSED" : "OPEN";
                    const progress = isClosed ? "Sales order closed" : noQtyProgressSummary(stage, so);
                    const customer = so.customer?.name ?? so.po?.customer?.name ?? "—";
                    const dateStr = new Date(so.createdAt).toLocaleDateString();
                    const guidedCycleId =
                      so.noQtyGuidedCycleId != null &&
                      Number.isFinite(Number(so.noQtyGuidedCycleId)) &&
                      Number(so.noQtyGuidedCycleId) > 0
                        ? Number(so.noQtyGuidedCycleId)
                        : null;
                    const positionLabel =
                      (so.noQtyListPositionLabel && String(so.noQtyListPositionLabel).trim()) || (isClosed ? "Closed" : "—");
                    const commercialDisplay =
                      (so.commercialStatusLabel && String(so.commercialStatusLabel).trim()) ||
                      (so.noQtyCommercialCaption && String(so.noQtyCommercialCaption).trim()) ||
                      (isClosed ? "—" : progress);

                    const noQtySoGuided = (() => {
                      const next = so.noQtyNextAction ?? null;
                      const cycleId = guidedCycleId;
                      const ctx = { salesOrderId: so.id, cycleId };
                      switch (next) {
                        case "CREATE_NEXT_RS":
                          return {
                            nextStep: "Create next RS",
                            label: "Create next RS",
                            to: buildNoQtyGuidedHref({
                              to: `/sales-orders/${so.id}/requirement-sheets?intent=add`,
                              salesOrderId: so.id,
                              cycleId: guidedCycleId,
                              fromStep: "requirement",
                            }),
                            isPlanningAction: true as const,
                            waitingLabel: "Create next RS",
                          };
                        case "COMPLETED":
                          return {
                            nextStep: "Cycle Completed",
                            label: isAdmin ? "Reopen Cycle" : "Cycle Completed",
                            to: buildNoQtyGuidedHref({ to: `/sales-orders/${so.id}/requirement-sheets`, ...ctx }),
                            // Reopen is admin-only and lives in the planning workspace.
                            isPlanningAction: true as const,
                            waitingLabel: "Cycle Completed",
                          };
                        case "WORK_ORDER":
                          return {
                            // NO_QTY rule: do not route operators to WO as the primary step.
                            // Requirement Sheet remains the canonical "flow hub" for WO readiness and next-step guidance.
                            nextStep: "Requirement Ready · With Planning",
                            label: "Open Requirement Sheet",
                            to: buildNoQtyGuidedHref({ to: `/sales-orders/${so.id}/requirement-sheets`, ...ctx, fromStep: "requirement" }),
                            isPlanningAction: true as const,
                            waitingLabel: "Requirement Ready · With Planning",
                          };
                        case "PRODUCTION":
                          if (!hasErpRole(role, PRODUCTION_WRITE_ROLES)) {
                            return {
                              nextStep: "In Production",
                              label: "Open Production",
                              to: buildNoQtyGuidedHref({ to: `/production`, ...ctx, fromStep: "requirement" }),
                              isPlanningAction: false as const,
                              waitingLabel: "In Production",
                              surfaceChip: "Production is owned by the Production team.",
                            };
                          }
                          return {
                            nextStep: "In Production",
                            label: "Open Production",
                            to: buildNoQtyGuidedHref({ to: `/production`, ...ctx, fromStep: "requirement" }),
                            isPlanningAction: false as const,
                            waitingLabel: "In Production",
                          };
                        case "QC":
                          if (!hasErpRole(role, QC_PAGE_ROLES)) {
                            return {
                              nextStep: "Awaiting QA",
                              label: "Complete QA",
                              to: buildNoQtyGuidedHref({ to: `/qc-entry`, ...ctx, fromStep: "production" }),
                              isPlanningAction: false as const,
                              waitingLabel: "Awaiting QA",
                              surfaceChip: "Complete QA from Production or Production QA workspace.",
                            };
                          }
                          return {
                            nextStep: "Awaiting QA",
                            label: "Complete QA",
                            to: buildNoQtyGuidedHref({ to: `/qc-entry`, ...ctx, fromStep: "production" }),
                            isPlanningAction: false as const,
                            waitingLabel: "Awaiting QA",
                          };
                        case "DISPATCH":
                          if (!hasErpRole(role, DISPATCH_READ_ROLES)) {
                            return {
                              nextStep: "Ready for Dispatch",
                              label: "Open Dispatch",
                              to: buildNoQtyGuidedHref({ to: `/dispatch`, ...ctx, fromStep: "qc" }),
                              isPlanningAction: false as const,
                              waitingLabel: "Ready for Dispatch",
                              surfaceChip: "Dispatch is owned by the Store team.",
                            };
                          }
                          return {
                            nextStep: "Ready for Dispatch",
                            label: "Open Dispatch",
                            to: buildNoQtyGuidedHref({ to: `/dispatch`, ...ctx, fromStep: "qc" }),
                            isPlanningAction: false as const,
                            waitingLabel: "Ready for Dispatch",
                          };
                        case "SALES_BILL":
                          if (!hasErpRole(role, SALES_BILL_WRITE_ROLES)) {
                            return {
                              nextStep: "Ready for Billing",
                              label: "Open Sales Bill",
                              to: buildNoQtyGuidedHref({ to: `/sales-bills`, ...ctx, fromStep: "dispatch" }),
                              isPlanningAction: false as const,
                              waitingLabel: "Ready for Billing",
                              surfaceChip: "Billing is owned by the Accounts team.",
                            };
                          }
                          return {
                            nextStep: "Ready for Billing",
                            label: "Open Sales Bill",
                            to: buildNoQtyGuidedHref({ to: `/sales-bills`, ...ctx, fromStep: "dispatch" }),
                            isPlanningAction: false as const,
                            waitingLabel: "Ready for Billing",
                          };
                        case "CLOSE_SO":
                          if (!hasErpRole(role, SALES_BILL_WRITE_ROLES)) {
                            return {
                              nextStep: "Review & Close SO",
                              label: "Open Sales Bill",
                              to: buildNoQtyGuidedHref({ to: `/sales-bills`, ...ctx, fromStep: "dispatch" }),
                              isPlanningAction: false as const,
                              waitingLabel: "Billing completed",
                              surfaceChip: "Commercial close: use Close SO when operations are complete.",
                            };
                          }
                          return {
                            nextStep: "Review & Close SO",
                            label: "Open Sales Bill",
                            to: buildNoQtyGuidedHref({ to: `/sales-bills`, ...ctx, fromStep: "dispatch" }),
                            isPlanningAction: false as const,
                            waitingLabel: "Billing completed",
                          };
                        case "REQUIREMENT":
                        default:
                          return {
                            nextStep: "Planning Pending",
                            label: "Open Requirement Sheet",
                            to: buildNoQtyGuidedHref({ to: `/sales-orders/${so.id}/requirement-sheets`, ...ctx }),
                            isPlanningAction: true as const,
                            waitingLabel: "Waiting for Planning Team",
                          };
                      }
                    })();

                    const noQtySurfaceChip = (noQtySoGuided as { surfaceChip?: string }).surfaceChip;

                    // NO_QTY: primary CTAs in Actions column; next action is informational only.

                    // STRICT: derive Next Step text + CTA label + href from the SAME source: `so.noQtyNextAction`.
                    const nextStep: NoQtyNextStep = isClosed ? null : (noQtySoGuided.nextStep as NoQtyNextStep);
                    const nextStepDisplay =
                      !isClosed &&
                      so.noQtyNextActionLabel &&
                      String(so.noQtyNextActionLabel).trim() &&
                      so.noQtyNextActionLabel !== "—"
                        ? so.noQtyNextActionLabel
                        : nextStep ?? "—";
                    return (
                      <tr key={so.id} {...{ [DRILL_DATA.salesOrderId]: so.id }}>
                        <td className="erp-so-td-mono whitespace-nowrap">
                          {displaySalesOrderNo(so.id, so.docNo)}
                        </td>
                        <td className="whitespace-nowrap tabular-nums text-[12px] text-slate-700">{dateStr}</td>
                        <td className="min-w-0 max-w-0 truncate text-[12.5px] text-slate-900" title={customer}>
                          {customer}
                        </td>
                        <td
                          className="min-w-0 max-w-0 truncate font-mono text-[11px] text-slate-700"
                          title={so.customerPoReference ?? ""}
                        >
                          {so.customerPoReference ?? "—"}
                        </td>
                        <td className="whitespace-nowrap">
                          <div className="flex flex-col items-start gap-0.5">
                            <Badge variant="info" className="w-fit px-1.5 py-0 text-[10px] leading-tight">
                              NO_QTY
                            </Badge>
                            <span
                              title={
                                isClosed
                                  ? "This cycle is finished. Admin Reopen starts the next cycle on this same No Qty SO; past cycles stay in history."
                                  : stage === "DRAFT"
                                    ? "Waiting for first Requirement Sheet of this cycle."
                                    : undefined
                              }
                            >
                              <Badge variant={statusBadgeVariant(displayStage)} className="w-fit px-1.5 py-0 text-[10px] leading-tight">
                                {displayStage}
                              </Badge>
                            </span>
                          </div>
                        </td>
                        <td className="min-w-0 text-[12px] leading-snug text-slate-800">{positionLabel}</td>
                        <td className="min-w-0 text-[12px] leading-snug text-slate-700">{commercialDisplay}</td>
                        <td className="text-right">
                          <span className="text-[12px] font-semibold text-slate-800">{nextStepDisplay}</span>
                        </td>
                        <td className="erp-table-action-col">
                          <div className="erp-table-actions">
                            {!isClosed ? (
                                noQtySurfaceChip ? (
                                  <PlanningStatusChip inline label={noQtySurfaceChip} />
                                ) : hasDraftRequirementSheet ? (
                                  canOpenRs ? (
                                    <Link
                                      className={cn(
                                        buttonVariants({ variant: "outline", size: "sm" }),
                                        "erp-so-act-secondary",
                                      )}
                                      to={buildNoQtyGuidedHref({
                                        to: `/sales-orders/${so.id}/requirement-sheets`,
                                        salesOrderId: so.id,
                                        cycleId: guidedCycleId,
                                        fromStep: "requirement",
                                      })}
                                    >
                                      Open Draft Requirement Sheet
                                    </Link>
                                  ) : (
                                    <PlanningStatusChip
                                      inline
                                      label="Draft Requirement Sheet · With Planning"
                                    />
                                  )
                                ) : (
                                  <>
                                    {noQtySoGuided.isPlanningAction && !canOpenRs ? (
                                      <PlanningStatusChip
                                        inline
                                        label={noQtySoGuided.waitingLabel}
                                      />
                                    ) : (
                                      <Link
                                        className={cn(buttonVariants({ size: "sm" }), "erp-so-act-primary")}
                                        to={noQtySoGuided.to}
                                      >
                                        {noQtySoGuided.label}
                                      </Link>
                                    )}
                                    {so.noQtyCreateNextRsEligible &&
                                    canCreateNextRs &&
                                    so.noQtyNextAction !== "CREATE_NEXT_RS" ? (
                                      <Link
                                        className={cn(
                                          buttonVariants({ variant: "outline", size: "sm" }),
                                          "erp-so-act-secondary",
                                        )}
                                        to={buildNoQtyGuidedHref({
                                          to: `/sales-orders/${so.id}/requirement-sheets?intent=add`,
                                          salesOrderId: so.id,
                                          cycleId: guidedCycleId,
                                          fromStep: "requirement",
                                        })}
                                      >
                                        Create Next RS
                                      </Link>
                                    ) : null}
                                  </>
                                )
                              ) : null}
                              {so.internalStatus !== "CLOSED" && so.internalStatus !== "MANUALLY_CLOSED" && canCloseNoQtySo ? (
                                so.noQtyManualCloseEligible === true ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="erp-so-act-secondary"
                                    onClick={() => setNoQtyCloseDialog({ soId: so.id, docNo: so.docNo })}
                                  >
                                    Close SO
                                  </Button>
                                ) : so.noQtyManualCloseBlockReason ? (
                                  <span
                                    className="max-w-[14rem] text-[11px] leading-snug text-amber-900"
                                    title={so.noQtyManualCloseBlockReason}
                                  >
                                    {so.noQtyManualCloseBlockReason}
                                  </span>
                                ) : null
                              ) : null}
                              {(so.internalStatus === "CLOSED" || so.internalStatus === "MANUALLY_CLOSED") && isAdmin ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="erp-so-act-secondary"
                                  onClick={() => setNoQtyReopenDialog({ soId: so.id, docNo: so.docNo })}
                                >
                                  Reopen SO
                                </Button>
                              ) : null}
                              {isAdmin && so.deleteAllowed === true ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 px-2"
                                  onClick={() => onDelete(so.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                            {!isClosed &&
                            !hasDraftRequirementSheet &&
                            !so.noQtyCreateNextRsEligible &&
                            so.noQtyNextRsAlreadyCreatedDocNo ? (
                              <p className="mt-0.5 max-w-[18rem] text-right text-[11px] leading-snug text-slate-500">
                                Next RS already created: {so.noQtyNextRsAlreadyCreatedDocNo}
                              </p>
                            ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            ) : null}
            {soTypeFilter === "REGULAR" && visibleRows.length > 0 ? (
              <div className="erp-table-wrap border-x-0 border-t-0">
                <table className="erp-table sales-orders-so-table w-full min-w-[1000px]">
                  <colgroup>
                    <col style={{ width: "7.25rem" }} />
                    <col style={{ width: "5.75rem" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "9rem" }} />
                    <col style={{ width: "9rem" }} />
                    <col style={{ width: "20%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "11rem" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={cn(sortKey === "id" && "bg-slate-300/80")}>SO No.</th>
                      <th className={cn(sortKey === "date" && "bg-slate-300/80")}>Date</th>
                      <th>Customer</th>
                      <th>PO Ref</th>
                      <th>Type</th>
                      <th>Current position</th>
                      <th>Commercial status</th>
                      <th className="erp-table-action-col erp-so-th-num">Actions</th>
                    </tr>
                  </thead>
                <tbody>
                  {visibleRows.map((so) => {
                    const showPlanningStockActions =
                      !isReplacementSalesOrder(so) && shouldShowCheckStockAndRmCheck(so);
                    const pending = Number(so.dispatchSummary?.totalPending ?? 0) || 0;
                    const dispatchedQty = Number(so.dispatchSummary?.totalDispatched ?? 0) || 0;
                    const invoicedQty = Number(so.invoicedQty ?? 0) || 0;
                    const invoicePendingQty = Math.max(0, dispatchedQty - invoicedQty);
                    const dispStatus = displaySoStatus(so, null);

                    const primaryCta = getPrimaryCta(so, role);
                    const showInvoice = showPlanningStockActions && invoicePendingQty > 0;
                    const showViewInvoice = showPlanningStockActions && !showInvoice && invoicedQty > 0;
                    const customerNm = so.customer?.name ?? so.po?.customer?.name ?? "—";
                    const positionLine =
                      so.processStage != null ? (
                        <Badge
                          variant={processStageBadgeVariant(so.processStage.key, so.woPrepareOperational?.key)}
                          className="w-fit text-[10px]"
                        >
                          {regularSoPositionLabel(so)}
                        </Badge>
                      ) : so.dispatchSummary && so.dispatchSummary.totalOrdered > 0 ? (
                        `${so.dispatchSummary.fullyDispatched ? "Fully dispatched" : so.dispatchSummary.totalDispatched > 0 ? "Partial dispatch" : "Dispatch pending"} · Ord ${so.dispatchSummary.totalOrdered} · Out ${so.dispatchSummary.totalDispatched} · Pend ${so.dispatchSummary.totalPending}`
                      ) : (
                        "—"
                      );
                    return (
                      <tr
                        key={so.id}
                        {...{ [DRILL_DATA.salesOrderId]: so.id }}
                        className={pending > 0 && !isReplacementSalesOrder(so) ? "bg-amber-50/50" : undefined}
                      >
                        <td className="erp-so-td-mono whitespace-nowrap">
                          {displaySalesOrderNo(so.id, so.docNo)}
                        </td>
                        <td className="whitespace-nowrap tabular-nums text-[12px] text-slate-700">
                          {new Date(so.createdAt).toLocaleDateString()}
                        </td>
                        <td className="min-w-0 max-w-0 truncate text-[12.5px] text-slate-900" title={customerNm}>
                          {customerNm}
                        </td>
                        <td
                          className="min-w-0 max-w-0 truncate font-mono text-[11px] text-slate-700"
                          title={so.customerPoReference ?? ""}
                        >
                          {so.customerPoReference ?? "—"}
                        </td>
                        <td className="whitespace-nowrap">
                          <div className="flex flex-col items-start gap-0.5">
                            {isReplacementSalesOrder(so) ? (
                              <Badge variant="warning" className="w-fit px-1.5 py-0 text-[10px] leading-tight">
                                REPLACEMENT
                              </Badge>
                            ) : (
                              <span className="text-[11px] font-semibold text-slate-600">REGULAR</span>
                            )}
                            <Badge variant={statusBadgeVariant(dispStatus)} className="w-fit px-1.5 py-0 text-[10px] leading-tight">
                              {dispStatus.replace(/_/g, " ")}
                            </Badge>
                          </div>
                        </td>
                        <td className="min-w-0 text-[12px] leading-snug text-slate-800">
                          <div>{positionLine}</div>
                          {isReplacementSalesOrder(so) ? (
                            <div className="mt-0.5 text-[11px] text-slate-600">
                              RET {so.customerReturnId != null ? String(so.customerReturnId) : "—"} · Orig SO{" "}
                              {so.originalSalesOrderId != null ? String(so.originalSalesOrderId) : "—"}
                            </div>
                          ) : null}
                        </td>
                        <td className="min-w-0 text-[12px] leading-snug text-slate-700">
                          <div>{regularSoCommercialSummary(so)}</div>
                          {so.quotation ? (
                            <div className="mt-0.5">
                              <Link to="/quotations" className="text-sky-800 underline underline-offset-2">
                                {so.quotation.quotationNo || `#${so.quotation.id}`}
                              </Link>
                            </div>
                          ) : null}
                        </td>
                        <td className="erp-table-action-col">
                          <div className="erp-table-actions">
                            {primaryCta ? (
                              <Link
                                to={primaryCta.to}
                                state={primaryCta.state}
                                className={cn(buttonVariants({ variant: "default", size: "sm" }), "erp-so-act-primary")}
                              >
                                {primaryCta.label}
                              </Link>
                            ) : null}

                            {showInvoice ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="erp-so-act-secondary"
                                onClick={() => setInvoiceModalSoId(so.id)}
                              >
                                Invoice
                              </Button>
                            ) : showViewInvoice ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="erp-so-act-secondary"
                                onClick={() => setInvoiceModalSoId(so.id)}
                              >
                                View Invoice
                              </Button>
                            ) : null}
                            {so.internalStatus === "DRAFT" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="erp-so-act-secondary"
                                onClick={() => openEdit(so)}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                Edit
                              </Button>
                            ) : null}
                            {so.internalStatus === "DRAFT" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="erp-so-act-secondary"
                                onClick={() => approveSo(so.id)}
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                Approve
                              </Button>
                            ) : null}
                            {isAdmin && so.deleteAllowed === true ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                className="h-7 px-2"
                                onClick={() => onDelete(so.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            ) : null}
          </div>
          {!rows.length ? (
            <div
              className="rounded border border-slate-200/90 bg-slate-50/80 px-3 py-2.5 text-[13px] leading-snug text-slate-600"
              data-testid="sales-orders-empty-state"
            >
              <span className="font-medium text-slate-800">No sales orders yet.</span>{" "}
              {canUseCommercialQuotations ? (
                <>
                  Create the first SO from an approved quotation (use{" "}
                  <strong className="font-medium text-slate-700">Open approved quotations</strong> above). Flow type follows
                  the enquiry.
                </>
              ) : (
                <>Sales orders will appear here when Sales creates them from the quotation workflow.</>
              )}
            </div>
          ) : null}
          {rows.length > 0 && visibleRows.length === 0 ? (
            soTypeFilter === "NO_QTY" ? (
              <div className="py-5 text-center">
                <p className="text-sm font-medium text-slate-800">No NO_QTY sales orders match the current filters.</p>
                <p className="mt-1 text-[13px] text-slate-600">
                  NO_QTY sales orders normally follow an approved NO_QTY quotation. Use{" "}
                  <Link to="/quotations" className="font-medium text-blue-800 underline">
                    Quotations
                  </Link>{" "}
                  to continue the workflow, or use Advanced on this page only for exceptional cases.
                </p>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-slate-600">
                No orders match the current filters.
                {soDrillHiddenByFilters ? ` ${DRILL_FOCUS_EMPTY_FILTERED_SUFFIX.salesOrder}` : ""}
              </p>
            )
          ) : null}
        </CardContent>
      </Card>

      {focusSalesOrderId > 0 ? (
        <div className="mt-2 max-w-3xl px-0 sm:px-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs font-medium"
            onClick={() => setActivityHistoryOpen((o) => !o)}
            aria-expanded={activityHistoryOpen}
          >
            {activityHistoryOpen ? "Hide activity history" : "View activity history"}
          </Button>
          {activityHistoryOpen ? (
            <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 shadow-sm">
              <ActivityHistoryCard
                title={`History — ${displaySalesOrderNo(focusSalesOrderId, drillSoDocNo)}`}
                query={`entityType=SALES_ORDER&entityId=${encodeURIComponent(String(focusSalesOrderId))}&limit=50`}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {editSo ? (
        <ErpModal onClose={() => setEditSo(null)}>
          <Card className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">
                Edit draft — Sales Order No: {displaySalesOrderNo(editSo.id, editSo.docNo)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form ref={editFormRef} onSubmit={saveEdit} className="erp-form space-y-3">
                <p className="text-sm text-slate-600">
                  {editSo.orderType === "NORMAL" ? (
                    <>
                      Item names and pricing come from the quotation. Set Customer PO Qty (dispatch cap) per line. Production
                      buffer, if needed, is applied on work order planning. Free lines stay at zero rate and cannot be priced
                      here.
                    </>
                  ) : (
                    <>
                      Item names and pricing come from the quotation. You may change quantities or remove lines. Free lines stay
                      at zero rate and cannot be priced here.
                    </>
                  )}
                </p>
                <div className="erp-form-field">
                  <span className="erp-form-label">SO type</span>
                  <select
                    ref={editSoTypeSelectRef}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                    value={editSo.orderType ?? "NORMAL"}
                    disabled={Boolean(editSo.quotationId) || editSo.orderType === "REPLACEMENT"}
                    onChange={(e) => {
                      const v = e.target.value as "NORMAL" | "NO_QTY";
                      const so = editSoRef.current;
                      if (!so) return;
                      setEditSo({ ...so, orderType: v });
                      if (v === "NO_QTY") {
                        setEditLines((prev) =>
                          prev.map((x) => ({
                            ...x,
                            qty: "0",
                            customerPoQty: undefined,
                          })),
                        );
                      } else {
                        setEditLines(
                          so.lines.map((l) => {
                            const qf = l.quotationLine?.isFree ?? l.isFree;
                            const rateLabel =
                              l.quotationLine != null
                                ? qf
                                  ? "0 (Free)"
                                  : Number(l.quotationLine.rate).toFixed(2)
                                : "—";
                            return {
                              lineId: l.id,
                              itemName: l.item.itemName,
                              isFree: Boolean(qf),
                              rateLabel,
                              customerPoQty: String(Number(l.customerPoQty ?? l.qty)),
                            };
                          }),
                        );
                      }
                    }}
                  >
                    <option value="NORMAL">Regular</option>
                    <option value="NO_QTY">No Qty SO</option>
                  </select>
                  {Boolean(editSo.quotationId) ? (
                    <div className="mt-1 text-xs text-slate-500">Quotation-based SOs stay Regular.</div>
                  ) : null}
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Customer PO reference</span>
                  <Input ref={editDraftPoRefInputRef} value={editPoRef} onChange={(e) => setEditPoRef(e.target.value)} />
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Remarks</span>
                  <Input value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} />
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-800">Commercial</div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        {editSo.snapshotState ?? "LIVE"}
                      </span>
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                          ((editSo.resolvedPOS?.gstMode ?? null) === "INTERSTATE"
                            ? "bg-purple-100 text-purple-900"
                            : (editSo.resolvedPOS?.gstMode ?? null) === "LOCAL"
                              ? "bg-emerald-100 text-emerald-900"
                              : "bg-slate-100 text-slate-700")
                        }
                        title={editSo.resolvedPOS?.stateName ?? ""}
                      >
                        {(editSo.resolvedPOS?.gstMode ?? null) === "INTERSTATE"
                          ? "Interstate"
                          : (editSo.resolvedPOS?.gstMode ?? null) === "LOCAL"
                            ? "Local"
                            : "POS Pending"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
                      <div className="text-[11px] font-medium text-slate-600">Bill To</div>
                      <div className="mt-0.5 text-[13px] font-semibold text-slate-900">
                        {editSo.resolvedBillTo?.name ?? editSo.customer?.name ?? "—"}
                      </div>
                      <div className="mt-0.5 text-[12px] text-slate-600">
                        {(editSo.resolvedBillTo?.stateCode ?? "") || (editSo.resolvedBillTo?.stateName ?? "") ? (
                          <>
                            {(editSo.resolvedBillTo?.stateCode ?? "").trim()}
                            {(editSo.resolvedBillTo?.stateCode ?? "").trim() && (editSo.resolvedBillTo?.stateName ?? "").trim()
                              ? " · "
                              : ""}
                            {(editSo.resolvedBillTo?.stateName ?? "").trim()}
                          </>
                        ) : (
                          "State not set"
                        )}
                        {editSo.resolvedBillTo?.gstin ? (
                          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                            {editSo.resolvedBillTo.gstin}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-medium text-slate-600">Ship To</div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setEditShowAddress((s) => !s)}
                          aria-expanded={editShowAddress}
                        >
                          {editShowAddress ? "Hide address" : "View address"}
                        </Button>
                      </div>
                      <select
                        className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                        value={editShipToId}
                        onChange={(e) => setEditShipToId(e.target.value)}
                        disabled={savingEdit || (editSo.snapshotState ?? "") === "FROZEN"}
                      >
                        <option value="">Auto (default)</option>
                        {(editCustomerDetail?.deliveryAddresses ?? [])
                          .filter((a) => a.isActive)
                          .map((a) => {
                            const sc = a.stateRef?.stateCode ? ` · ${a.stateRef.stateCode}` : "";
                            return (
                              <option key={a.id} value={String(a.id)}>
                                {a.label}
                                {sc}
                                {a.isDefault ? " (Default)" : ""}
                              </option>
                            );
                          })}
                      </select>
                      {editShowAddress ? (
                        <div className="mt-1 rounded border border-slate-200 bg-slate-50 p-2 text-[12px] leading-snug text-slate-700">
                          <div className="font-medium text-slate-800">
                            {editSo.resolvedShipTo?.label ?? "—"}
                            {editSo.resolvedShipTo?.stateCode ? ` · ${editSo.resolvedShipTo.stateCode}` : ""}
                          </div>
                          <div className="mt-0.5 whitespace-pre-wrap break-words">
                            {editSo.resolvedShipTo?.address ?? "Address not set"}
                          </div>
                        </div>
                      ) : null}
                      {(editSo.snapshotState ?? "") === "FROZEN" ? (
                        <div className="mt-1 text-[11px] text-slate-500">Ship To is frozen for this sales order.</div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-800">Lines</div>
                  {editLines.map((ln) => {
                    const isFirst = editLines.length > 0 && ln.lineId === editLines[0].lineId;
                    const disableQty = editSo.orderType === "NO_QTY";
                    const isNormalEdit = editSo.orderType === "NORMAL";
                    return (
                      <div key={ln.lineId} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 p-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-slate-500">Item</div>
                          <div className="text-sm font-medium text-slate-900">
                            {ln.itemName}
                            {ln.isFree ? (
                              <span className="ml-2 font-semibold text-emerald-800">(Free)</span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-600">
                            {editSo.orderType === "NO_QTY" ? (
                              <>
                                Rate snapshot: <span className="tabular-nums font-medium">{ln.rateLabel}</span>
                                <span className="text-slate-500"> — from rate contract at creation</span>
                              </>
                            ) : (
                              <>
                                Quotation rate: <span className="tabular-nums font-medium">{ln.rateLabel}</span>
                                {ln.isFree ? <span className="text-slate-500"> — not editable</span> : null}
                              </>
                            )}
                          </div>
                        </div>
                        {isNormalEdit ? (
                          <div className="flex flex-wrap items-end gap-2">
                            {isFirst ? (
                              <FieldShortcutHint
                                show={shortcutHints.activeFieldId === "soEditQty"}
                                hint={shortcutHints.activeFieldHintText ?? ""}
                                placement="below-end"
                                className="inline-block shrink-0"
                              >
                                <label className="grid gap-1 text-sm">
                                  <span className="text-slate-600">Customer PO Qty</span>
                                  <Input
                                    className="w-28"
                                    inputMode="numeric"
                                    {...soEditQtyBind}
                                    value={ln.customerPoQty ?? ""}
                                    disabled={disableQty}
                                  />
                                </label>
                              </FieldShortcutHint>
                            ) : (
                              <label className="grid gap-1 text-sm">
                                <span className="text-slate-600">Customer PO Qty</span>
                                <Input
                                  className="w-28"
                                  inputMode="numeric"
                                  value={ln.customerPoQty ?? ""}
                                  disabled={disableQty}
                                  onChange={(e) =>
                                    setEditLines((prev) =>
                                      prev.map((x) =>
                                        x.lineId === ln.lineId ? { ...x, customerPoQty: e.target.value } : x,
                                      ),
                                    )
                                  }
                                />
                              </label>
                            )}
                          </div>
                        ) : isFirst ? (
                          <FieldShortcutHint
                            show={shortcutHints.activeFieldId === "soEditQty"}
                            hint={shortcutHints.activeFieldHintText ?? ""}
                            placement="below-end"
                            className="inline-block shrink-0"
                          >
                            <label className="grid gap-1 text-sm">
                              <span className="text-slate-600">Qty</span>
                              <Input className="w-24" {...soEditQtyBind} value={ln.qty ?? ""} disabled={disableQty} />
                            </label>
                          </FieldShortcutHint>
                        ) : (
                          <label className="grid gap-1 text-sm">
                            <span className="text-slate-600">Qty</span>
                            <Input
                              className="w-24"
                              value={ln.qty ?? ""}
                              disabled={disableQty}
                              onChange={(e) =>
                                setEditLines((prev) =>
                                  prev.map((x) => (x.lineId === ln.lineId ? { ...x, qty: e.target.value } : x)),
                                )
                              }
                            />
                          </label>
                        )}
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeEditLine(ln.lineId)}>
                          Remove
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setEditSo(null)} disabled={savingEdit}>
                    Cancel
                  </Button>
                  <FieldShortcutHint
                    show={shortcutHints.activeFieldId === "soEditSave"}
                    hint={shortcutHints.activeFieldHintText ?? ""}
                    placement="above"
                    className="inline-block"
                  >
                    <Button
                      type="submit"
                      onFocus={soEditSaveFocusBind.onFocus}
                      onBlur={soEditSaveFocusBind.onBlur}
                      onClick={() => shortcutHints.markFieldShortcutUsed("soEditSave")}
                      disabled={savingEdit}
                    >
                      {savingEdit ? "Saving…" : "Save"}
                    </Button>
                  </FieldShortcutHint>
                </div>
              </form>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}

      {noQtyCloseDialog ? (
        <ErpModal onClose={() => setNoQtyCloseDialog(null)} aria-labelledby="no-qty-close-title">
          <Card className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle id="no-qty-close-title" className="text-base">
                  Close NO_QTY sales order?
                </CardTitle>
                <Button type="button" variant="ghost" size="sm" onClick={() => setNoQtyCloseDialog(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-700">
              <p className="leading-relaxed">
                Closing this NO_QTY SO will freeze current carry-forward shortage as <strong>Closed Shortage</strong>.
                Stock will not be moved. Current usable, rework, hold, and scrap quantities stay in inventory as free
                stock (no ledger postings on close).
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setNoQtyCloseDialog(null)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void runNoQtyClose()}>
                  Close SO
                </Button>
              </div>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}

      {noQtyReopenDialog ? (
        <ErpModal onClose={() => setNoQtyReopenDialog(null)} aria-labelledby="no-qty-reopen-title">
          <Card className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle id="no-qty-reopen-title" className="text-base">
                  Reopen NO_QTY sales order
                </CardTitle>
                <Button type="button" variant="ghost" size="sm" onClick={() => setNoQtyReopenDialog(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-700">
              <p className="text-xs text-slate-500">
                Admin password required. Demand-only: planning will use <strong>current</strong> usable inventory — never a
                frozen stock snapshot.
              </p>
              {reopenPreviewLoading ? <p className="text-xs text-slate-500">Loading preview…</p> : null}
              {reopenPreviewError ? <p className="text-xs text-amber-800">{reopenPreviewError}</p> : null}
              {reopenPreview?.stockMayHaveChangedWarning ? (
                <p className="text-xs text-amber-800">
                  Inventory may have changed since this SO was closed. Reopen still uses live stock when you continue.
                </p>
              ) : null}
              {reopenPreview?.closedShortageLines?.length ? (
                <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                  <div className="font-medium text-slate-600">Frozen closed shortage (demand)</div>
                  <ul className="mt-1 list-inside list-disc">
                    {reopenPreview.closedShortageLines.map((ln) => (
                      <li key={ln.itemId}>
                        Item #{ln.itemId}: {ln.closedShortageQty}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {reopenPreview?.currentUsableByItem?.length ? (
                <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                  <div className="font-medium text-slate-600">Current usable stock (reference)</div>
                  <ul className="mt-1 list-inside list-disc">
                    {reopenPreview.currentUsableByItem.map((u) => (
                      <li key={u.itemId}>
                        Item #{u.itemId}: {u.usableQty}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <label className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">Admin password</span>
                <Input
                  type="password"
                  autoComplete="off"
                  value={reopenAdminPassword}
                  onChange={(e) => setReopenAdminPassword(e.target.value)}
                  className="max-w-sm"
                />
              </label>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-2">
                  <input
                    type="radio"
                    name="nq-reopen-mode"
                    checked={reopenMode === "CONTINUE_SHORTAGE"}
                    onChange={() => setReopenMode("CONTINUE_SHORTAGE")}
                  />
                  <span>
                    <span className="font-medium text-slate-900">Continue with previous shortage</span>
                    <span className="mt-0.5 block text-xs text-slate-600">
                      Restore closed shortage as carry-forward demand. Stock will be recalculated from current inventory.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-2">
                  <input
                    type="radio"
                    name="nq-reopen-mode"
                    checked={reopenMode === "IGNORE_SHORTAGE"}
                    onChange={() => setReopenMode("IGNORE_SHORTAGE")}
                  />
                  <span>
                    <span className="font-medium text-slate-900">Start fresh, ignore previous shortage</span>
                    <span className="mt-0.5 block text-xs text-slate-600">
                      Keep old shortage as history only. New planning starts without old shortage carry-forward.
                    </span>
                  </span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setNoQtyReopenDialog(null)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void runNoQtyReopen()}>
                  Reopen SO
                </Button>
              </div>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}

      {invoiceModalSoId != null ? (
        <ErpModal
          onClose={() => setInvoiceModalSoId(null)}
          closeOnBackdropClick
          aria-labelledby="sales-commercial-invoice-title"
        >
          <Card className="erp-modal-shell flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 border-b border-slate-200 pb-4">
              <CardTitle id="sales-commercial-invoice-title" className="text-lg font-semibold tracking-tight">
                Tax invoice
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label="Close"
                onClick={() => setInvoiceModalSoId(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto pt-4">
              {invoiceLoading ? <p className="text-sm text-slate-600">Loading invoice…</p> : null}
              {invoiceError ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{invoiceError}</div>
              ) : null}
              {invoiceSo && !invoiceLoading ? <SalesCommercialInvoiceView so={invoiceSo} /> : null}
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}
          </div>
        </>
      )}
    </PageContainer>
  );
}
