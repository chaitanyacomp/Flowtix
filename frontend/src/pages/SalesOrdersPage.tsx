import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { applySearchParamsPatch, deleteUrlParamKeys } from "../lib/urlSearchParamsPatch";
import { DrillFocusBanner } from "../components/DrillFocusBanner";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import {
  DRILL_FOCUS_EMPTY_FILTERED_SUFFIX,
  DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS,
  DRILL_FOCUS_HINT_NOT_IN_LIST,
  DRILL_RECOVERY_LABEL,
  drillFocusTitleSalesOrder,
} from "../lib/drillFocusCopy";
import { DRILL_DATA, DRILL_QUERY } from "../lib/drillDownRoutes";
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
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useToast } from "../contexts/ToastContext";
import { Trash2, Pencil, CheckCircle2, ChevronDown, ChevronUp, X } from "lucide-react";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useShortcutHints } from "../hooks/useShortcutHints";
import { FieldShortcutHint } from "../components/ui/FieldShortcutHint";
import { ShortcutHintBar } from "../components/ui/ShortcutHintBar";
import {
  FIELD_HINT_SO_CREATE,
  FIELD_HINT_SO_EDIT_QTY,
  FIELD_HINT_SO_EDIT_SAVE,
  FIELD_HINT_SO_QUOTE_PO,
  SALES_ORDERS_SHORTCUT_BAR,
} from "../lib/shortcutHintCopy";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
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
  /** NO_QTY only: next actionable module (current cycle). */
  noQtyNextAction?: "REQUIREMENT" | "WORK_ORDER" | "PRODUCTION" | "QC" | "DISPATCH" | "SALES_BILL" | "COMPLETED";
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
  currentCycle?: { id: number; cycleNo: number; status?: string } | null;
  /** Admin-only temporary debug payload for NO_QTY stage derivation (current cycle only). */
  noQtyStageDebug?: {
    salesOrderId: number;
    orderType: string;
    currentCycleId: number;
    cycleNo: number | null;
    requirementExists: boolean;
    workOrderExists: boolean;
    productionExists: boolean;
    qcExists: boolean;
    dispatchExists: boolean;
    salesBillExists: boolean;
  } | null;
  /** Admin-only: hard-delete eligibility for non-connected sales orders (server source of truth). */
  deleteAllowed?: boolean;
  /** Admin-only: reasons that block hard delete. */
  deleteBlockedReasons?: string[];
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
    item: { itemName: string };
  }[];
  salesOrder: { id: number; docNo?: string | null } | null;
};

/** Per-line buffer planning when creating a NORMAL SO from an approved quotation (order matches `qDetail.lines`). */
type QuoteCreateBufferLine = { itemId: number; customerPoQty: string; bufferPercent: string };

type RmCheckPayload = {
  fgLines: {
    lineId: number;
    fgName: string;
    orderQty: number;
    fgStock: number;
    toProduce: number;
    note?: string;
  }[];
  rmSummary: { rmItemId: number; itemName: string; enough: boolean; shortage: number }[];
  allRmEnough: boolean;
  allFgEnough: boolean;
  strictInventoryControl: boolean;
  proceedAllowed: boolean;
  blockMessage: string | null;
};

type DraftLineEdit = {
  lineId: number;
  itemName: string;
  isFree: boolean;
  rateLabel: string;
  /** Regular (NORMAL) SO */
  customerPoQty?: string;
  bufferPercent?: string;
  /** NO_QTY / REPLACEMENT */
  qty?: string;
};

function computePlannedQtyPreview(customerPoQty: number, bufferPercent: number): number {
  const c = Math.max(0, Math.floor(Number(customerPoQty) || 0));
  const b = Math.max(0, Number(bufferPercent) || 0);
  return c + Math.ceil((c * b) / 100);
}

function clampBufferPercentInput(raw: string, maxB: number): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return "0";
  return String(Math.min(Math.max(0, maxB), Math.floor(n)));
}

type FgItemOption = { id: number; itemName: string; itemType?: string | null };
type NoQtyCreateLine = { key: string; itemId: number; rate: string };

function statusBadgeVariant(s: string): "default" | "success" | "warning" | "info" {
  if (s === "APPROVED") return "success";
  if (s === "COMPLETED") return "info";
  if (s === "CLOSED") return "info";
  if (s === "IN_PROCESS") return "warning";
  return "default";
}

function processStageBadgeVariant(key: string): "default" | "success" | "warning" | "info" {
  if (key === "COMPLETED") return "info";
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

function displaySoStatus(row: SoRow, noQtyStage: NoQtyStage | null): "DRAFT" | "OPEN" | "APPROVED" | "IN_PROCESS" | "COMPLETED" | "CLOSED" {
  const raw = (row.internalStatus ?? "DRAFT") as "DRAFT" | "OPEN" | "APPROVED" | "IN_PROCESS" | "COMPLETED" | "CLOSED";
  // NO_QTY lifecycle is manually controlled: only CLOSED is terminal; everything else is OPEN for display/filtering.
  if (row.orderType === "NO_QTY") return raw === "CLOSED" ? "CLOSED" : "OPEN";
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
  | "COMPLETED";

type NoQtyNextStep = "Create Requirement" | "Work Order" | "Dispatch" | "Sales Bill" | "Billed" | null;

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
    isClosed: row.internalStatus === "COMPLETED" || row.internalStatus === "CLOSED" || row.processStage?.key === "COMPLETED",
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
  if (key === "NO_QTY_DISPATCH_BILLING") return { stage: "DISPATCH / BILLING", ctx, reason: "backend stage: dispatch/billing" };
  if (key === "NO_QTY_IN_PRODUCTION") return { stage: "IN PRODUCTION", ctx, reason: "backend stage: in production" };
  if (key === "NO_QTY_WORK_ORDER") return { stage: "WORK ORDER", ctx, reason: "backend stage: work order" };
  if (key === "NO_QTY_REQUIREMENT_READY") return { stage: "REQUIREMENT READY", ctx, reason: "backend stage: requirement ready" };
  if (key === "NO_QTY_DRAFT") return { stage: "DRAFT", ctx, reason: "backend stage: draft" };

  const hasReq = ctx.hasActiveRequirementSheet === true;
  const noReq = ctx.hasActiveRequirementSheet === false;

  // Dispatch/billing signals we can trust from list payload:
  if ((ctx.unbilledDispatchedQty != null && ctx.unbilledDispatchedQty > 0) || ctx.actualDispatchedQty > 0 || (key === "DISPATCH_PENDING" && pendingDispatch > 0)) {
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

type NoQtyPrimaryAction =
  | { label: string; action: "OPEN_RS" | "OPEN_WORK_ORDERS" | "OPEN_PRODUCTION" | "VIEW_PRODUCTION" | "OPEN_DISPATCH" | "OPEN_SALES_BILL" | "VIEW_SALES_BILLS" }
  | { label: string; action: "REOPEN_SO" }
  | null;

function getNoQtySoPrimaryAction(
  stage: NoQtyStage,
  opts: { isAdmin: boolean; hasSalesBillForCycle: boolean; strandedWithoutActiveCycle: boolean },
): NoQtyPrimaryAction {
  if (opts.isAdmin && opts.strandedWithoutActiveCycle) {
    return { label: "Start next cycle", action: "REOPEN_SO" };
  }
  switch (stage) {
    case "COMPLETED":
      return opts.isAdmin ? { label: "Reopen", action: "REOPEN_SO" } : null;
    case "DRAFT":
      return { label: "Create Requirement", action: "OPEN_RS" };
    case "REQUIREMENT READY":
      return { label: "Open Requirement", action: "OPEN_RS" };
    case "WORK ORDER":
      return { label: "Work Order", action: "OPEN_WORK_ORDERS" };
    case "IN PRODUCTION":
      return { label: "View Production Flow", action: "VIEW_PRODUCTION" };
    case "DISPATCH / BILLING":
      return opts.hasSalesBillForCycle
        ? { label: "View Sales Bills", action: "VIEW_SALES_BILLS" }
        : { label: "Sales Bill", action: "OPEN_SALES_BILL" };
    default:
      return { label: "Open Requirement", action: "OPEN_RS" };
  }
}

function noQtyProgressSummary(stage: NoQtyStage, so: SoRow): string {
  const fgCount = Array.isArray(so.lines) ? so.lines.length : 0;
  const disp = Number(so.dispatchSummary?.totalDispatched ?? 0) || 0;
  const pend = Number(so.dispatchSummary?.totalPending ?? 0) || 0;
  if (stage === "COMPLETED") return "Current cycle closed";
  if (stage === "DRAFT") return "Awaiting requirement";
  if (stage === "REQUIREMENT READY") return "Requirement prepared";
  if (stage === "WORK ORDER") return "Work order ready";
  if (stage === "IN PRODUCTION") return "Production / QC in progress";
  if (stage === "DISPATCH / BILLING")
    return disp > 0 || pend > 0
      ? `Dispatch or billing pending · Out ${disp} · Pend ${pend}`
      : "Dispatch or billing pending";
  return `${fgCount} item(s)`;
}

function noQtyPrimaryHref(primary: NoQtyPrimaryAction, soId: number): string {
  if (!primary || primary.action === "REOPEN_SO") return "#";
  if (primary.action === "OPEN_WORK_ORDERS") {
    const qs = new URLSearchParams();
    qs.set("salesOrderId", String(soId));
    qs.set("source", "no_qty_so");
    qs.set("soMode", "NO_QTY");
    return `/work-orders?${qs.toString()}`;
  }
  if (primary.action === "OPEN_PRODUCTION" || primary.action === "VIEW_PRODUCTION") {
    const qs = new URLSearchParams();
    qs.set("salesOrderId", String(soId));
    qs.set("source", "no_qty_so");
    qs.set("soMode", "NO_QTY");
    return `/production?${qs.toString()}`;
  }
  if (primary.action === "VIEW_SALES_BILLS") {
    return `/sales-bills?source=no_qty_so&salesOrderId=${soId}`;
  }
  if (primary.action === "OPEN_DISPATCH") {
    return `/dispatch?source=no_qty_so&salesOrderId=${soId}`;
  }
  if (primary.action === "OPEN_SALES_BILL") {
    return `/sales-bills/new?source=no_qty_so&salesOrderId=${soId}`;
  }
  if (primary.action === "OPEN_RS") {
    // For NO_QTY, show the Requirement Sheet page; it handles state-driven CTAs.
    return `/sales-orders/${soId}/requirement-sheets`;
  }
  return `/sales-orders/${soId}/requirement-sheets`;
}

/** Uses `dispatchSummary` from the SO list API — same fields as the "Fully dispatched" badge. Normal SOs only. */
function shouldShowCheckStockAndRmCheck(so: SoRow): boolean {
  const ds = so.dispatchSummary;
  if (!ds || ds.totalOrdered <= 0) return false;
  if (ds.fullyDispatched) return false;
  if (ds.totalPending <= 0) return false;
  return true;
}

/** Primary row CTA from `processStage` for all non–NO_QTY orders (NORMAL, REPLACEMENT, etc.). */
function getPrimaryCta(so: SoRow): { label: string; to: string } | null {
  if (so.orderType === "NO_QTY") return null;
  const stage = so.processStage?.key;
  const sid = encodeURIComponent(String(so.id));
  switch (stage) {
    case "WO_PENDING":
      return { label: "Create Work Order", to: `/rm-check?soId=${sid}` };
    case "PRODUCTION_PENDING":
      return { label: "Start Production", to: `/production?salesOrderId=${sid}` };
    case "QC_PENDING":
      return { label: "Go to QC", to: `/qc-entry?salesOrderId=${sid}` };
    case "DISPATCH_PENDING":
      return { label: "Go to Dispatch", to: `/dispatch?salesOrderId=${sid}` };
    case "SALES_BILL_PENDING":
      return { label: "Create Sales Bill", to: `/sales-bills?salesOrderId=${sid}` };
    default:
      return null;
  }
}

const SO_LIST_URL_OMIT: Record<string, string> = {
  status: "ALL",
  prod: "ALL",
  soType: "ALL",
  sort: "date",
  dir: "desc",
};

function stockStripClass(data: RmCheckPayload | undefined): string {
  if (!data) return "border-slate-200 bg-slate-50 text-slate-700";
  const sufficient = data.allFgEnough && data.allRmEnough;
  if (sufficient) return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (data.strictInventoryControl) return "border-red-200 bg-red-50 text-red-900";
  return "border-amber-200 bg-amber-50 text-amber-950";
}

export function SalesOrdersPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const demo = useDemoMode();
  const soDemoHlRegular = demoHighlightKey(demo.enabled, demo.flow, demo.step, "regular", 1);
  const soDemoHlNoQty = demoHighlightKey(demo.enabled, demo.flow, demo.step, "no_qty", 1);
  const isAdmin = useIsAdmin();
  const { searchParams, setSearchParams, patch, read } = useUrlQueryState(SO_LIST_URL_OMIT);
  const quotationFromUrl = read.int("quotationId");
  const focusSalesOrderId = Number(searchParams.get(DRILL_QUERY.salesOrderId)) || 0;

  const statusFilter = read.enum(
    "status",
    ["ALL", "DRAFT", "OPEN", "APPROVED", "IN_PROCESS", "COMPLETED", "CLOSED"] as const,
    "ALL",
  );
  const prodFilter = read.enum("prod", ["ALL", "PENDING", "NONE"] as const, "ALL");
  const soTypeFilter = read.enum("soType", ["ALL", "REGULAR", "NO_QTY"] as const, "ALL");
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
  const [stockBySoId, setStockBySoId] = React.useState<Record<number, RmCheckPayload | "loading">>({});
  const [stockLoadingId, setStockLoadingId] = React.useState(0);

  const [qDetail, setQDetail] = React.useState<QuotationDetail | null>(null);
  const [qLoading, setQLoading] = React.useState(false);
  const [createPoRef, setCreatePoRef] = React.useState("");
  const [createRemarks, setCreateRemarks] = React.useState("");
  const [createPoTouched, setCreatePoTouched] = React.useState(false);
  const [quoteCreateLines, setQuoteCreateLines] = React.useState<QuoteCreateBufferLine[]>([]);
  const createFromQuoteRef = React.useRef<HTMLDivElement | null>(null);
  const createPoRefInputRef = React.useRef<HTMLInputElement | null>(null);
  useFastEntryForm({ containerRef: createFromQuoteRef, initialFocusRef: createPoRefInputRef });

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
  useFastEntryForm({ containerRef: editFormRef });

  const [creating, setCreating] = React.useState(false);
  const [createChoiceOpen, setCreateChoiceOpen] = React.useState(false);
  const [noQtyCreateOpen, setNoQtyCreateOpen] = React.useState(false);
  const [noQtyCustomerId, setNoQtyCustomerId] = React.useState<number>(0);
  const [noQtyPoRef, setNoQtyPoRef] = React.useState("");
  const [noQtyRemarks, setNoQtyRemarks] = React.useState("");
  const [noQtyLines, setNoQtyLines] = React.useState<NoQtyCreateLine[]>([{ key: "1", itemId: 0, rate: "" }]);
  const [customers, setCustomers] = React.useState<Array<{ id: number; name: string }>>([]);
  const [fgItems, setFgItems] = React.useState<FgItemOption[]>([]);
  const [savingNoQty, setSavingNoQty] = React.useState(false);

  const demoRegularStep1ChoiceModal =
    demo.enabled && demo.flow === "regular" && demo.step === 1 && createChoiceOpen;

  const [editSo, setEditSo] = React.useState<SoRow | null>(null);
  const [editPoRef, setEditPoRef] = React.useState("");
  const [editRemarks, setEditRemarks] = React.useState("");
  const [editLines, setEditLines] = React.useState<DraftLineEdit[]>([]);
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [maxRegularSoBufferPercent, setMaxRegularSoBufferPercent] = React.useState(10);

  const [invoiceModalSoId, setInvoiceModalSoId] = React.useState<number | null>(null);
  const [invoiceSo, setInvoiceSo] = React.useState<SalesInvoiceSoDetail | null>(null);
  const [invoiceLoading, setInvoiceLoading] = React.useState(false);
  const [invoiceError, setInvoiceError] = React.useState<string | null>(null);
  const [noQtyDraftRsBySoId, setNoQtyDraftRsBySoId] = React.useState<Record<number, boolean>>({});

  const [closingEmptyCycleSoId, setClosingEmptyCycleSoId] = React.useState<number | null>(null);
  /** Doc no for drill-focused SO when missing from list row (e.g. list not yet refreshed). */
  const [drillSoDocNo, setDrillSoDocNo] = React.useState<string | null>(null);

  const mode = soTypeFilter === "NO_QTY" ? "NO_QTY" : "REGULAR";
  const isNoQtyMode = mode === "NO_QTY";

  const demoForcedMode: "REGULAR" | "NO_QTY" | null =
    demo.enabled && demo.flow === "regular" ? "REGULAR" : demo.enabled && demo.flow === "no_qty" ? "NO_QTY" : null;
  React.useEffect(() => {
    if (!demoForcedMode) return;
    if (mode === demoForcedMode) return;
    patch({ soType: demoForcedMode });
  }, [demoForcedMode, mode, patch]);

  const planningHref = React.useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("source", "no_qty_so");
    if (Number.isFinite(focusSalesOrderId) && focusSalesOrderId > 0) qs.set("salesOrderId", String(focusSalesOrderId));
    const q = qs.toString();
    return q ? `/planning-dashboard?${q}` : "/planning-dashboard";
  }, [focusSalesOrderId]);

  function load() {
    setError(null);
    return apiFetch<SoRow[]>("/api/sales-orders")
      .then(async (fetchedRows) => {
        setRows(fetchedRows);
        const noQtyRows = fetchedRows.filter((so) => so.orderType === "NO_QTY" && Number(so.currentCycle?.id) > 0);
        const draftStatusPairs = await Promise.all(
          noQtyRows.map(async (so) => {
            try {
              const sheets = await apiFetch<RequirementSheetListRow[]>(`/api/sales-orders/${so.id}/requirement-sheets`);
              const currentCycleId = Number(so.currentCycle?.id);
              const hasDraftInCurrentCycle = sheets.some(
                (sheet) => Number(sheet.cycleId) === currentCycleId && sheet.status === "DRAFT",
              );
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

  async function submitCloseEmptyCycle(soId: number) {
    if (
      !window.confirm(
        "Close this empty active cycle? The No Qty sales order will return to completed status, and this cycle will be marked closed in history.",
      )
    )
      return;
    setClosingEmptyCycleSoId(soId);
    try {
      await apiFetch(`/api/sales-orders/${soId}/no-qty-cycle/close-empty`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.showSuccess("Empty cycle closed. Sales order is now closed.");
      await load();
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "Could not close cycle.");
    } finally {
      setClosingEmptyCycleSoId(null);
    }
  }

  async function submitNoQtyStatus(soId: number, nextStatus: "OPEN" | "CLOSED") {
    const endpoint = nextStatus === "CLOSED" ? "close" : "reopen";
    try {
      await apiFetch(`/api/sales-orders/${soId}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.showSuccess(
        nextStatus === "CLOSED"
          ? `Sales Order ${displaySalesOrderNo(soId, rows.find((r) => r.id === soId)?.docNo)} closed.`
          : `Sales Order ${displaySalesOrderNo(soId, rows.find((r) => r.id === soId)?.docNo)} reopened.`,
      );
      await load();
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : `Failed to set status ${nextStatus}.`);
    }
  }

  React.useEffect(() => {
    // In quotation-mode we render a single-purpose screen; skip list/customer preloads.
    if (quotationFromUrl) return;
    void load();
    void loadCustomers();
  }, [quotationFromUrl]);

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

  React.useEffect(() => {
    if (invoiceModalSoId == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setInvoiceModalSoId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      const stageMetaForFilter = isNoQtyMode ? getNoQtySoStageMeta(so, { isAdmin }) : null;
      const displayStatusForFilter = displaySoStatus(so, stageMetaForFilter?.stage ?? null);
      if (statusFilter !== "ALL" && displayStatusForFilter !== statusFilter) return false;
      // Top-level mode switch controls type visibility (do not mix Regular + No Qty UI).
      if (mode === "NO_QTY") {
        if (so.orderType !== "NO_QTY") return false;
      } else {
        // Regular includes NORMAL + REPLACEMENT.
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
      // Production filter is only relevant in Regular mode.
      if (mode !== "NO_QTY" && prodFilter !== "ALL") {
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
  }, [rows, statusFilter, customerIdFilter, listSearch, prodFilter, sortKey, sortDir, mode]);

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
    });
  }, [patch, setSearchDraft]);

  const soDrillTargetInData = focusSalesOrderId > 0 && rows.some((r) => r.id === focusSalesOrderId);
  const soDrillTargetVisible = focusSalesOrderId > 0 && visibleRows.some((r) => r.id === focusSalesOrderId);
  const soDrillHiddenByFilters = listLoaded && soDrillTargetInData && !soDrillTargetVisible;

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
            bufferPercent: "0",
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

  /** Dashboard (and bookmarks): `/sales-orders?action=new-so` | `?action=no-qty-so` opens the same flows as in-page CTAs. */
  const quickEntryAction = searchParams.get("action") ?? "";
  React.useEffect(() => {
    if (quickEntryAction !== "new-so" && quickEntryAction !== "no-qty-so") return;
    if (quickEntryAction === "new-so") {
      setCreateChoiceOpen(true);
      patch({ action: null });
      return;
    }
    openNoQtyCreateModal({ alsoClearAction: true });
  }, [quickEntryAction, patch]);

  async function runStockCheck(soId: number) {
    setStockLoadingId(soId);
    setStockBySoId((s) => ({ ...s, [soId]: "loading" }));
    setError(null);
    try {
      const res = await apiFetch<RmCheckPayload>(`/api/sales-orders/${soId}/rm-check`);
      setStockBySoId((s) => ({ ...s, [soId]: res }));
    } catch (e) {
      setStockBySoId((s) => {
        const next = { ...s };
        delete next[soId];
        return next;
      });
      setError(e instanceof Error ? e.message : "Stock check failed");
    } finally {
      setStockLoadingId(0);
    }
  }

  async function createFromQuotation() {
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
            bufferPercent: Number(l.bufferPercent ?? 0),
          })),
        }),
      });
      toast.showSuccess("Sales order created as Approved — continue to production planning.");
      // Guided: go straight to the next operational step (Work Order planning).
      navigate(`/rm-check?soId=${encodeURIComponent(String(created.id))}`);
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
    setEditLines(
      so.lines.map((l) => {
        const qf = l.quotationLine?.isFree ?? l.isFree;
        const rateLabel =
          l.quotationLine != null
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
            bufferPercent: String(Number(l.bufferPercent ?? 0)),
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

  function openNoQtyCreateModal(opts?: { alsoClearAction?: boolean }) {
    void loadCustomers();
    setNoQtyCreateOpen(true);
    setNoQtyCustomerId(0);
    setNoQtyPoRef("");
    setNoQtyRemarks("");
    setNoQtyLines([{ key: String(Date.now()), itemId: 0, rate: "" }]);
    patch(opts?.alsoClearAction ? { soType: "NO_QTY", action: null } : { soType: "NO_QTY" });
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
    setNoQtyLines([{ key: "demo-1", itemId: fgItems[0].id, rate: "1" }]);
  }, [demo.enabled, demo.flow, demo.step, noQtyCreateOpen, customers, fgItems]);

  async function saveNoQtyCreate(e: React.FormEvent) {
    e.preventDefault();
    if (noQtyCustomerId <= 0) {
      setError("Customer is required.");
      return;
    }
    const items = noQtyLines
      .map((l) => ({ itemId: Number(l.itemId), rate: Number(l.rate) }))
      .filter((x) => Number.isFinite(x.itemId) && x.itemId > 0);
    if (items.length < 1) {
      setError("At least one item is required.");
      return;
    }
    if (items.some((x) => !Number.isFinite(x.rate) || x.rate <= 0)) {
      toast.showError("Enter valid rate");
      setError("Enter a valid rate for all items.");
      return;
    }
    setSavingNoQty(true);
    setError(null);
    try {
      await apiFetch("/api/sales-orders/no-qty", {
        method: "POST",
        body: JSON.stringify({
          customerId: noQtyCustomerId,
          customerPoReference: noQtyPoRef.trim() || null,
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
              bufferPercent: Number(l.bufferPercent ?? 0),
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

  React.useEffect(() => {
    const needMaxBuffer =
      Boolean(editSo && editSo.orderType === "NORMAL") || Boolean(quotationFromUrl && quotationFromUrl > 0);
    if (!needMaxBuffer) return;
    let cancelled = false;
    void apiFetch<{ maxRegularSoBufferPercent?: number }>("/api/settings/regular-so-buffer")
      .then((r) => {
        if (cancelled || r == null || typeof r.maxRegularSoBufferPercent !== "number") return;
        setMaxRegularSoBufferPercent(Math.max(0, Math.floor(r.maxRegularSoBufferPercent)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [editSo?.id, editSo?.orderType, quotationFromUrl]);
  const creatingRef = React.useRef(creating);
  creatingRef.current = creating;
  const savingEditRef = React.useRef(savingEdit);
  savingEditRef.current = savingEdit;

  const createFromQuotationRef = React.useRef(createFromQuotation);
  createFromQuotationRef.current = createFromQuotation;

  const canCreateFromQuoteRef = React.useRef(false);
  canCreateFromQuoteRef.current = Boolean(
    quotationFromUrl &&
      qDetail &&
      qDetail.workflowStatus === "APPROVED" &&
      !qDetail.salesOrder,
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
    <PageContainer className="pb-[5.5rem] sm:pb-20">
      {quotationFromUrl ? (
        <>
          <StickyWorkspaceHead
            lead={<PageSmartBackLink defaultTo="/quotations" defaultLabel="Back to Quotations" />}
          >
            <PageHeader
              title={
                qDetail?.quotationNo
                  ? `Create Sales Order from Quotation (${qDetail.quotationNo})`
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
                {qLoading ? <p className="text-slate-600">Loading quotation…</p> : null}

                {!qLoading && qDetail ? (
                  <>
                    {qDetail.workflowStatus !== "APPROVED" ? (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                        Only an <strong>approved</strong> quotation can generate a sales order. This quotation is{" "}
                        <strong>{qDetail.workflowStatus.replace(/_/g, " ")}</strong>.
                      </p>
                    ) : qDetail.salesOrder ? (
                      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800">
                        A sales order already exists for this quotation:{" "}
                        <span className="font-mono">
                          {displaySalesOrderNo(qDetail.salesOrder.id, qDetail.salesOrder.docNo)}
                        </span>
                      </p>
                    ) : (
                      <>
                        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] leading-snug text-sky-950">
                          This sales order will be created as <strong>Approved</strong> because the quotation is already
                          approved. You can go straight to production planning (RM check / work order) — no second
                          approval on the sales order. Set <strong>Customer PO Qty</strong> (dispatch cap) and optional{" "}
                          <strong>Buffer %</strong>; <strong>Planned Qty</strong> is what production and RM check use.
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="erp-form-field">
                            <span className="erp-form-label">Customer</span>
                            <Input value={qDetail.enquiry.customer.name} disabled />
                          </div>
                          <div className="erp-form-field">
                            <span className="erp-form-label">Quotation</span>
                            <Input value={qDetail.quotationNo || `#${qDetail.id}`} disabled />
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Lines — customer commitment and production plan
                          </div>
                          <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
                            <table className="min-w-full text-sm">
                              <thead className="bg-slate-50">
                                <tr className="text-left text-xs font-semibold text-slate-600">
                                  <th className="px-3 py-2">Item</th>
                                  <th className="px-3 py-2 text-right">Customer PO Qty</th>
                                  <th className="px-3 py-2 text-right">Buffer %</th>
                                  <th className="px-3 py-2 text-right">Planned Qty</th>
                                  <th className="px-3 py-2 text-right">Rate</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {qDetail.lines.map((ln, idx) => {
                                  const row = quoteCreateLines[idx];
                                  const cp = Number(row?.customerPoQty ?? ln.qty);
                                  const buf = Number(row?.bufferPercent ?? 0);
                                  const planned = computePlannedQtyPreview(cp, buf);
                                  return (
                                    <tr key={ln.id != null ? `ql-${ln.id}` : `${qDetail.id}-ln-${idx}`} className="bg-white">
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
                                      <td className="px-3 py-2 text-right align-middle">
                                        <Input
                                          className="ml-auto w-24 text-right tabular-nums"
                                          inputMode="numeric"
                                          title={`Max ${maxRegularSoBufferPercent}%`}
                                          value={row?.bufferPercent ?? "0"}
                                          onChange={(e) =>
                                            setQuoteCreateLines((prev) => {
                                              const next = [...prev];
                                              if (next[idx])
                                                next[idx] = {
                                                  ...next[idx],
                                                  bufferPercent: clampBufferPercentInput(
                                                    e.target.value,
                                                    maxRegularSoBufferPercent,
                                                  ),
                                                };
                                              return next;
                                            })
                                          }
                                        />
                                      </td>
                                      <td className="px-3 py-2 text-right align-middle tabular-nums text-slate-800">
                                        <Input className="ml-auto w-28 text-right tabular-nums" readOnly value={planned} />
                                      </td>
                                      <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                                        {ln.isFree ? "0 (Free)" : Number(ln.rate).toFixed(2)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Buffer % is capped at the admin maximum ({maxRegularSoBufferPercent}%). With buffer 0,
                            planned qty equals Customer PO Qty.
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
                              onClick={() => navigate("/quotations")}
                              disabled={creating}
                            >
                              Cancel / Back
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

      {quotationFromUrl ? null : (
        <>
          <StickyWorkspaceHead
            lead={<PageSmartBackLink defaultTo="/dashboard" defaultLabel="Back to Dashboard" />}
          >
            <PageHeader
              title="Sales orders"
              actions={
                isNoQtyMode ? (
                  <Button
                    type="button"
                    size="sm"
                    data-testid="create-sales-order-btn"
                    onClick={() => openNoQtyCreateModal()}
                    {...(soDemoHlNoQty && !createChoiceOpen ? { "data-demo-highlight": soDemoHlNoQty } : {})}
                  >
                    + New No Qty SO
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    data-testid="create-sales-order-btn"
                    onClick={() => setCreateChoiceOpen(true)}
                    {...(soDemoHlRegular && !createChoiceOpen ? { "data-demo-highlight": soDemoHlRegular } : {})}
                  >
                    + New Sales Order
                  </Button>
                )
              }
            />
          </StickyWorkspaceHead>

          <div className="grid gap-4">
            <DemoFlowBanner />

      <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</div>
        </div>
        <div className="mt-1 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="so-mode"
              checked={mode === "REGULAR"}
              onChange={() => patch({ soType: "REGULAR" })}
              disabled={demoForcedMode === "NO_QTY"}
            />
            Regular SO
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="so-mode"
              checked={mode === "NO_QTY"}
              onChange={() => patch({ soType: "NO_QTY" })}
              disabled={demoForcedMode === "REGULAR"}
            />
            No Qty SO
          </label>
        </div>
      </div>

      {createChoiceOpen ? (
        <div className="erp-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="so-create-choice-title">
          <Card className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle id="so-create-choice-title" className="text-base">
                  New sales order
                </CardTitle>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCreateChoiceOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <button
                type="button"
                className="w-full rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
                onClick={() => {
                  setCreateChoiceOpen(false);
                  // Regular SO flow remains quotation-based (existing screen).
                  window.location.assign("/quotations");
                }}
                {...(demoRegularStep1ChoiceModal && soDemoHlRegular ? { "data-demo-highlight": soDemoHlRegular } : {})}
              >
                <div className="text-sm font-semibold text-slate-900">Regular SO</div>
                <div className="mt-0.5 text-xs text-slate-600">Create from approved quotation</div>
              </button>

              <button
                type="button"
                disabled={demo.enabled && demo.flow === "regular" && demo.step === 1}
                className={cn(
                  "w-full rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors",
                  demo.enabled && demo.flow === "regular" && demo.step === 1
                    ? "cursor-not-allowed opacity-45"
                    : "hover:border-slate-300 hover:bg-slate-50",
                )}
                onClick={() => {
                  setCreateChoiceOpen(false);
                  openNoQtyCreateModal();
                }}
              >
                <div className="text-sm font-semibold text-slate-900">No Qty SO</div>
                <div className="mt-0.5 text-xs text-slate-600">Create open PO based sales order without quotation link</div>
              </button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {noQtyCreateOpen ? (
        <div className="erp-modal-backdrop" role="dialog" aria-modal="true">
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
                  <span className="erp-form-label">Customer</span>
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
                  <span className="erp-form-label">Customer PO reference</span>
                  <Input value={noQtyPoRef} onChange={(e) => setNoQtyPoRef(e.target.value)} />
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Remarks</span>
                  <Input value={noQtyRemarks} onChange={(e) => setNoQtyRemarks(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-800">Items</div>
                  {noQtyLines.map((ln) => (
                    <div key={ln.key} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 p-2">
                      <label className="grid flex-1 gap-1 text-sm">
                        <span className="text-slate-600">Item</span>
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
                            setNoQtyLines((p) => p.map((x) => (x.key === ln.key ? { ...x, itemId: selectedItemId } : x)));
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
                      <label className="grid gap-1 text-sm">
                        <span className="text-slate-600">Rate</span>
                        <Input
                          className="w-28 tabular-nums"
                          value={ln.rate}
                          onChange={(e) =>
                            setNoQtyLines((p) => p.map((x) => (x.key === ln.key ? { ...x, rate: e.target.value } : x)))
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="text-slate-600">Qty</span>
                        <Input className="w-20 tabular-nums" value="0" disabled />
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
                    onClick={() => setNoQtyLines((p) => [...p, { key: String(Date.now()), itemId: 0, rate: "" }])}
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
                    disabled={savingNoQty || noQtyLines.filter((l) => Number(l.itemId) > 0).length === 0}
                  >
                    {savingNoQty ? "Saving…" : "Save"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <DrillFocusBanner
        active={focusSalesOrderId > 0}
        title={drillFocusTitleSalesOrder(focusSalesOrderId)}
        variant={
          listLoaded && focusSalesOrderId > 0 && !soDrillTargetInData
            ? "soft"
            : soDrillHiddenByFilters
              ? "soft"
              : "default"
        }
        hint={
          listLoaded && focusSalesOrderId > 0 && !soDrillTargetInData
            ? DRILL_FOCUS_HINT_NOT_IN_LIST.salesOrder
            : soDrillHiddenByFilters
              ? DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS.salesOrder
              : undefined
        }
        recoveryAction={
          soDrillHiddenByFilters ? { label: DRILL_RECOVERY_LABEL.salesOrder, onClick: revealSalesOrderDrillTarget } : undefined
        }
        onClearFocus={clearSalesOrderDrillFocus}
      />

      {quotationFromUrl ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Create from quotation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {qLoading ? <p className="text-slate-600">Loading quotation…</p> : null}
            {!qLoading && qDetail ? (
              <>
                {qDetail.workflowStatus !== "APPROVED" ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                    Only an <strong>approved</strong> quotation can generate a sales order. This quotation is{" "}
                    <strong>{qDetail.workflowStatus.replace(/_/g, " ")}</strong>.
                  </p>
                ) : qDetail.salesOrder ? (
                  <p className="text-slate-700">
                    A sales order already exists for this quotation (
                    <Link className="text-primary underline" to="/sales-orders">
                      Sales Order No: {displaySalesOrderNo(qDetail.salesOrder.id, qDetail.salesOrder.docNo)}
                    </Link>
                    ).
                  </p>
                ) : (
                  <>
                    <p className="text-slate-700">
                      <span className="font-medium">{qDetail.quotationNo || `#${qDetail.id}`}</span> ·{" "}
                      {qDetail.enquiry.customer.name} · {qDetail.lines.length} line(s). Use Customer PO Qty and buffer
                      below; planned qty updates for production.
                    </p>
                    <div className="overflow-x-auto rounded-md border border-slate-200">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr className="text-left text-xs font-semibold text-slate-600">
                            <th className="px-3 py-2">Item</th>
                            <th className="px-3 py-2 text-right">Customer PO Qty</th>
                            <th className="px-3 py-2 text-right">Buffer %</th>
                            <th className="px-3 py-2 text-right">Planned</th>
                            <th className="px-3 py-2 text-right">Rate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {qDetail.lines.map((ln, idx) => {
                            const row = quoteCreateLines[idx];
                            const cp = Number(row?.customerPoQty ?? ln.qty);
                            const buf = Number(row?.bufferPercent ?? 0);
                            const planned = computePlannedQtyPreview(cp, buf);
                            return (
                              <tr key={ln.id != null ? `ql2-${ln.id}` : `${qDetail.id}-ln2-${idx}`}>
                                <td className="px-3 py-2 font-medium text-slate-900">
                                  {ln.item.itemName}
                                  {ln.isFree ? <span className="ml-1 text-emerald-800">(Free)</span> : null}
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
                                <td className="px-3 py-2 text-right align-middle">
                                  <Input
                                    className="ml-auto w-24 text-right tabular-nums"
                                    inputMode="numeric"
                                    value={row?.bufferPercent ?? "0"}
                                    onChange={(e) =>
                                      setQuoteCreateLines((prev) => {
                                        const next = [...prev];
                                        if (next[idx])
                                          next[idx] = {
                                            ...next[idx],
                                            bufferPercent: clampBufferPercentInput(
                                              e.target.value,
                                              maxRegularSoBufferPercent,
                                            ),
                                          };
                                        return next;
                                      })
                                    }
                                  />
                                </td>
                                <td className="px-3 py-2 text-right align-middle tabular-nums text-slate-800">
                                  <Input className="ml-auto w-24 text-right tabular-nums" readOnly value={planned} />
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                                  {ln.isFree ? "—" : Number(ln.rate).toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="erp-form max-w-xl">
                      <FieldShortcutHint
                        show={shortcutHints.activeFieldId === "soQuotePoRef"}
                        hint={shortcutHints.activeFieldHintText ?? ""}
                        placement="below"
                        className="erp-form-field"
                      >
                        <div>
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
                            <div className="mt-1 text-xs font-medium text-red-700">Customer PO reference is required.</div>
                          ) : null}
                        </div>
                      </FieldShortcutHint>
                      <div className="erp-form-field">
                        <span className="erp-form-label">Remarks (optional)</span>
                        <Input value={createRemarks} onChange={(e) => setCreateRemarks(e.target.value)} placeholder="Internal notes" />
                      </div>
                      <FieldShortcutHint
                        show={shortcutHints.activeFieldId === "soQuoteCreate"}
                        hint={shortcutHints.activeFieldHintText ?? ""}
                        placement="above"
                        className="inline-block"
                      >
                        <Button
                          type="button"
                          onFocus={quoteCreateFocusBind.onFocus}
                          onBlur={quoteCreateFocusBind.onBlur}
                          onClick={() => {
                            shortcutHints.markFieldShortcutUsed("soQuoteCreate");
                            void createFromQuotation();
                          }}
                          disabled={creating}
                        >
                          {creating ? "Creating…" : "Create sales order"}
                        </Button>
                      </FieldShortcutHint>
                    </div>
                  </>
                )}
              </>
            ) : null}
            {!qLoading && qDetail === null && quotationFromUrl && !error ? (
              <p className="text-slate-600">Loading…</p>
            ) : null}
        <div className="pt-1">
          <button
            type="button"
            className="text-sm text-slate-600 underline"
            onClick={() =>
              setSearchParams((prev) => applySearchParamsPatch(prev, { quotationId: null }), { replace: true })
            }
          >
            Clear quotation selection
          </button>
        </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 pb-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <CardTitle className="text-base">All sales orders</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8" disabled={!listFiltersActive} onClick={clearListFilters}>
              Clear list filters
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Status
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                value={statusFilter}
                onChange={(e) => patch({ status: e.target.value as typeof statusFilter })}
              >
                <option value="ALL">All statuses</option>
                <option value="DRAFT">DRAFT</option>
                <option value="OPEN">OPEN</option>
                <option value="APPROVED">APPROVED</option>
                <option value="IN_PROCESS">IN PROCESS</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </label>
            {mode !== "NO_QTY" ? (
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Show
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={prodFilter}
                  onChange={(e) => patch({ prod: e.target.value as typeof prodFilter })}
                >
                  <option value="ALL">All</option>
                  <option value="PENDING">Pending production</option>
                  <option value="NONE">No pending (completed)</option>
                </select>
              </label>
            ) : (
              <div className="hidden lg:block" />
            )}
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Customer
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                value={customerIdFilter || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  patch({ customerId: v ? Number(v) : null });
                }}
              >
                <option value="">All customers</option>
                {customerOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600 sm:col-span-2 lg:col-span-2">
              Search
              <Input
                className="h-9"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="SO #, customer, PO ref, quotation…"
              />
            </label>
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Sort by
                <select
                  className="h-9 w-[10rem] rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={sortKey}
                  onChange={(e) => patch({ sort: e.target.value as "date" | "id" })}
                >
                  <option value="date">Order date</option>
                  <option value="id">SO number</option>
                </select>
              </label>
              <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => patch({ dir: sortDir === "asc" ? "desc" : "asc" })}>
                {sortDir === "asc" ? (
                  <>
                    Asc <ChevronUp className="ml-1 inline h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    Desc <ChevronDown className="ml-1 inline h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
          {listFiltersActive && rows.length > 0 ? (
            <p className="text-xs text-slate-600">
              Showing <span className="font-semibold tabular-nums text-slate-900">{visibleRows.length}</span> of{" "}
              <span className="tabular-nums">{rows.length}</span> orders
            </p>
          ) : null}
          <div className="erp-table-wrap">
            {mode === "NO_QTY" ? (
              <table className="erp-table">
                <thead>
                  <tr>
                    <th className={cn(sortKey === "id" && "bg-slate-100/90")}>SO</th>
                    <th>Stage</th>
                    <th>Progress</th>
                    <th className="text-right">Next step</th>
                    <th className="text-right">View</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((so) => {
                    const meta = getNoQtySoStageMeta(so, { isAdmin });
                    const isClosed = so.internalStatus === "CLOSED" || so.internalStatus === "COMPLETED" || so.processStage?.key === "COMPLETED";
                    const hasDraftRequirementSheet = Boolean(noQtyDraftRsBySoId[so.id]);
                    const stage = meta.stage;
                    const displayStage = so.internalStatus === "CLOSED" ? "CLOSED" : "OPEN";
                    const progress = isClosed ? "Sales order closed" : noQtyProgressSummary(stage, so);
                    const hasSalesBillForCycle = Boolean(so.hasCurrentCycleSalesBill);
                    const primary = getNoQtySoPrimaryAction(stage, {
                      isAdmin,
                      hasSalesBillForCycle,
                      strandedWithoutActiveCycle: Boolean(so.noQtyStrandedWithoutActiveCycle),
                    });
                    const showRequirementButton = !isClosed;
                    const customer = so.customer?.name ?? so.po?.customer?.name ?? "—";
                    const dateStr = new Date(so.createdAt).toLocaleDateString();
                    const primaryHref = noQtyPrimaryHref(primary, so.id);

                    const noQtySoGuided = (() => {
                      const next = so.noQtyNextAction ?? null;
                      const cycleId = so.currentCycle?.id ?? null;
                      const ctx = { salesOrderId: so.id, cycleId };
                      switch (next) {
                        case "COMPLETED":
                          return {
                            nextStep: "Cycle Completed",
                            label: isAdmin ? "Reopen Cycle" : "Cycle Completed",
                            to: buildNoQtyGuidedHref({ to: `/sales-orders/${so.id}/requirement-sheets`, ...ctx }),
                          };
                        case "WORK_ORDER":
                          return {
                            // NO_QTY rule: do not route operators to WO as the primary step.
                            // Requirement Sheet remains the canonical "flow hub" for WO readiness and next-step guidance.
                            nextStep: "Requirement Ready",
                            label: "Open Requirement Sheet",
                            to: buildNoQtyGuidedHref({ to: `/sales-orders/${so.id}/requirement-sheets`, ...ctx, fromStep: "requirement" }),
                          };
                        case "PRODUCTION":
                          return {
                            nextStep: "In Production",
                            label: "Open Production",
                            to: buildNoQtyGuidedHref({ to: `/production`, ...ctx, fromStep: "requirement" }),
                          };
                        case "QC":
                          return {
                            nextStep: "Awaiting QC",
                            label: "Open QC",
                            to: buildNoQtyGuidedHref({ to: `/qc-entry`, ...ctx, fromStep: "production" }),
                          };
                        case "DISPATCH":
                          return {
                            nextStep: "Ready for Dispatch",
                            label: "Open Dispatch",
                            to: buildNoQtyGuidedHref({ to: `/dispatch`, ...ctx, fromStep: "qc" }),
                          };
                        case "SALES_BILL":
                          return {
                            nextStep: "Ready for Billing",
                            label: "Open Sales Bill",
                            to: buildNoQtyGuidedHref({ to: `/sales-bills`, ...ctx, fromStep: "dispatch" }),
                          };
                        case "REQUIREMENT":
                        default:
                          return {
                            nextStep: "Requirement Pending",
                            label: "Open Requirement Sheet",
                            to: buildNoQtyGuidedHref({ to: `/sales-orders/${so.id}/requirement-sheets`, ...ctx }),
                          };
                      }
                    })();

                    // NO_QTY: keep a single primary CTA (in the View column). Next step column is informational only.

                    // STRICT: derive Next Step text + CTA label + href from the SAME source: `so.noQtyNextAction`.
                    const nextStep: NoQtyNextStep = isClosed ? null : (noQtySoGuided.nextStep as NoQtyNextStep);
                    return (
                      <tr key={so.id} {...{ [DRILL_DATA.salesOrderId]: so.id }}>
                        <td>
                          <div className="flex min-w-0 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-600">SO No</span>
                                <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-sky-900">
                                  {displaySalesOrderNo(so.id, so.docNo)}
                                </span>
                              </span>
                              {so.currentCycle?.cycleNo != null && Number.isFinite(Number(so.currentCycle.cycleNo)) ? (
                                <span className="text-[11px] font-medium text-slate-500">
                                  Cycle: {so.currentCycle.cycleNo}
                                </span>
                              ) : null}
                              <Badge variant="info">No Qty SO</Badge>
                              {/* Hide base internalStatus badge for NO_QTY to avoid conflicting status systems. */}
                            </div>
                            <div className="text-xs text-slate-600">
                              <span className="font-medium text-slate-800">{customer}</span>
                              <span className="text-slate-400"> · </span>
                              <span>{dateStr}</span>
                              <span className="text-slate-400"> · </span>
                              <span className="truncate">{so.customerPoReference ?? "—"}</span>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          <span
                            title={
                              isClosed
                                ? "This cycle is finished. Admin Reopen starts the next cycle on this same No Qty SO; past cycles stay in history."
                                : stage === "DRAFT"
                                  ? "Waiting for first Requirement Sheet of this cycle."
                                  : undefined
                            }
                            className="inline-flex items-center gap-1"
                          >
                            <Badge variant={statusBadgeVariant(displayStage)}>{displayStage}</Badge>
                          </span>
                        </td>
                        <td className="text-xs text-slate-700">{progress}</td>
                        <td className="text-right">
                          <span className="text-xs text-slate-500">{nextStep ?? "—"}</span>
                        </td>
                        <td className="text-right">
                          {/* Keep a single primary CTA per row: show actions only here; Next step remains informational. */}
                          <div className="inline-flex flex-wrap justify-end gap-2">
                            {!isClosed ? (
                              hasDraftRequirementSheet ? (
                                <Link
                                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                                  to={buildNoQtyGuidedHref({
                                    to: `/sales-orders/${so.id}/requirement-sheets`,
                                    salesOrderId: so.id,
                                    cycleId: so.currentCycle?.id ?? null,
                                    fromStep: "requirement",
                                  })}
                                >
                                  Open Draft Requirement Sheet
                                </Link>
                              ) : (
                                <Link
                                  className={cn(buttonVariants({ size: "sm" }))}
                                  to={buildNoQtyGuidedHref({
                                    to: `/sales-orders/${so.id}/requirement-sheets?intent=add`,
                                    salesOrderId: so.id,
                                    cycleId: so.currentCycle?.id ?? null,
                                    fromStep: "requirement",
                                  })}
                                >
                                  Create Next RS
                                </Link>
                              )
                            ) : null}
                            {so.internalStatus !== "CLOSED" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void submitNoQtyStatus(so.id, "CLOSED")}
                              >
                                Close SO
                              </Button>
                            ) : null}
                            {so.internalStatus === "CLOSED" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void submitNoQtyStatus(so.id, "OPEN")}
                              >
                                Reopen SO
                              </Button>
                            ) : null}
                            {isAdmin && so.deleteAllowed === true ? (
                              <Button type="button" size="sm" variant="destructive" onClick={() => onDelete(so.id)}>
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
            ) : (
              <table className="erp-table">
                <thead>
                  <tr>
                    <th className={cn(sortKey === "id" && "bg-slate-100/90")}>SO No</th>
                    <th className={cn(sortKey === "date" && "bg-slate-100/90")}>Date</th>
                    <th>Customer</th>
                    <th>Quotation</th>
                    <th>Status</th>
                    <th>Stage</th>
                    <th>PO ref</th>
                    <th>Stock</th>
                    <th className="text-right">Pending dispatch</th>
                    <th className="text-right">Actions</th>
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

                    const primaryCta = getPrimaryCta(so);
                    const showInvoice = showPlanningStockActions && invoicePendingQty > 0;
                    const showViewInvoice = showPlanningStockActions && !showInvoice && invoicedQty > 0;
                    return (
                      <React.Fragment key={so.id}>
                        <tr
                          {...{ [DRILL_DATA.salesOrderId]: so.id }}
                          className={pending > 0 ? "bg-amber-50/60" : undefined}
                        >
                          <td className="font-medium tabular-nums">
                            <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold text-sky-900">
                              {displaySalesOrderNo(so.id, so.docNo)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap">{new Date(so.createdAt).toLocaleDateString()}</td>
                          <td>{so.customer?.name ?? so.po?.customer?.name ?? "—"}</td>
                          <td>
                            {so.quotation ? (
                              <Link to="/quotations" className="text-primary underline">
                                {so.quotation.quotationNo || `#${so.quotation.id}`}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <div className="flex flex-wrap items-center gap-2">
                              {isReplacementSalesOrder(so) ? <Badge variant="warning">Replacement</Badge> : null}
                              <Badge variant={statusBadgeVariant(dispStatus)}>{dispStatus.replace(/_/g, " ")}</Badge>
                            </div>
                            {isReplacementSalesOrder(so) ? (
                              <div className="mt-1 text-[11px] text-slate-600">
                                Return Ref:{" "}
                                <span className="font-mono">
                                  {so.customerReturnId != null ? `RET-${String(so.customerReturnId).padStart(6, "0")}` : "—"}
                                </span>{" "}
                                · Original SO:{" "}
                                <span className="font-mono">{so.originalSalesOrderId != null ? `SO-${so.originalSalesOrderId}` : "—"}</span>{" "}
                                · Original Dispatch:{" "}
                                <span className="font-mono">
                                  {so.originalDispatchId != null ? `DSP-${String(so.originalDispatchId).padStart(6, "0")}` : "—"}
                                </span>
                              </div>
                            ) : null}
                          </td>
                          <td className="max-w-[240px] align-top text-xs">
                            <div className="space-y-1">
                              {so.processStage ? (
                                <Badge variant={processStageBadgeVariant(so.processStage.key)}>{so.processStage.label}</Badge>
                              ) : so.dispatchSummary && so.dispatchSummary.totalOrdered > 0 ? (
                                so.dispatchSummary.fullyDispatched ? (
                                  <Badge variant="success">Fully dispatched</Badge>
                                ) : so.dispatchSummary.totalDispatched > 0 ? (
                                  <Badge variant="warning">Partially dispatched</Badge>
                                ) : (
                                  <Badge variant="default">Dispatch pending</Badge>
                                )
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                              {so.dispatchSummary && so.dispatchSummary.totalOrdered > 0 ? (
                                <div className="tabular-nums text-slate-500">
                                  Ord {so.dispatchSummary.totalOrdered} · Out {so.dispatchSummary.totalDispatched} · Pend{" "}
                                  {so.dispatchSummary.totalPending}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="max-w-[140px] truncate">{so.customerPoReference ?? "—"}</td>
                          <td>
                            <span className="text-xs text-slate-500">—</span>
                          </td>
                          <td className="text-right tabular-nums">
                            {isReplacementSalesOrder(so) ? (
                              <span className="text-xs text-slate-500">—</span>
                            ) : pending > 0 ? (
                              <span className="font-semibold text-amber-900">{pending}</span>
                            ) : (
                              <span className="text-xs font-medium text-emerald-800">0</span>
                            )}
                          </td>
                          <td>
                            <div className="erp-table-actions flex-wrap justify-end">
                              {primaryCta ? (
                                <Link
                                  to={primaryCta.to}
                                  className={cn(buttonVariants({ variant: "default", size: "sm" }))}
                                >
                                  {primaryCta.label}
                                </Link>
                              ) : null}

                              {showInvoice ? (
                                <Button type="button" variant="outline" size="sm" onClick={() => setInvoiceModalSoId(so.id)}>
                                  Invoice
                                </Button>
                              ) : showViewInvoice ? (
                                <Button type="button" variant="outline" size="sm" onClick={() => setInvoiceModalSoId(so.id)}>
                                  View Invoice
                                </Button>
                              ) : null}
                              {so.internalStatus === "DRAFT" ? (
                                <Button type="button" size="sm" variant="outline" onClick={() => openEdit(so)}>
                                  <Pencil className="mr-1 h-3.5 w-3.5" />
                                  Edit
                                </Button>
                              ) : null}
                              {so.internalStatus === "DRAFT" ? (
                                <Button type="button" size="sm" variant="outline" onClick={() => approveSo(so.id)}>
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                  Approve
                                </Button>
                              ) : null}
                              {isAdmin && so.deleteAllowed === true ? (
                                <Button type="button" size="sm" variant="destructive" onClick={() => onDelete(so.id)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {/* Removed non-critical inline planning summary to reduce vertical clutter (Regular SO only). */}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {!rows.length ? <p className="py-6 text-center text-sm text-slate-600">No sales orders yet.</p> : null}
          {rows.length > 0 && visibleRows.length === 0 ? (
            mode === "NO_QTY" ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-slate-800">No No Qty Sales Orders found.</p>
                <p className="mt-1 text-sm text-slate-600">
                  Create a No Qty SO to begin Requirement → Production → QC → Dispatch → Sales Bill for a cycle. The same SO can run many cycles over time (add
                  requirements while active, or admin Reopen after a cycle completes); older cycles stay in history.
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
        <div className="mt-3 max-w-3xl">
          <ActivityHistoryCard
            title={`History — ${displaySalesOrderNo(focusSalesOrderId, drillSoDocNo)}`}
            query={`entityType=SALES_ORDER&entityId=${encodeURIComponent(String(focusSalesOrderId))}&limit=50`}
          />
        </div>
      ) : null}

      {editSo ? (
        <div className="erp-modal-backdrop" role="dialog" aria-modal="true">
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
                      Item names and pricing come from the quotation. For each line set Customer PO Qty (dispatch cap) and
                      optional Buffer %; Planned Qty updates for production. Free lines stay at zero rate and cannot be priced
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
                            bufferPercent: undefined,
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
                              bufferPercent: String(Number(l.bufferPercent ?? 0)),
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
                  <Input value={editPoRef} onChange={(e) => setEditPoRef(e.target.value)} />
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Remarks</span>
                  <Input value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-800">Lines</div>
                  {editLines.map((ln) => {
                    const isFirst = editLines.length > 0 && ln.lineId === editLines[0].lineId;
                    const disableQty = editSo.orderType === "NO_QTY";
                    const isNormalEdit = editSo.orderType === "NORMAL";
                    const cpNum = Number(ln.customerPoQty ?? 0);
                    const bufNum = Number(ln.bufferPercent ?? 0);
                    const plannedDisplay = isNormalEdit
                      ? computePlannedQtyPreview(cpNum, bufNum)
                      : Number(ln.qty ?? 0);
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
                            Quotation rate: <span className="tabular-nums font-medium">{ln.rateLabel}</span>
                            {ln.isFree ? <span className="text-slate-500"> — not editable</span> : null}
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
                            <label className="grid gap-1 text-sm">
                              <span className="text-slate-600">Buffer % (max {maxRegularSoBufferPercent})</span>
                              <Input
                                className="w-24"
                                inputMode="numeric"
                                value={ln.bufferPercent ?? "0"}
                                disabled={disableQty}
                                onChange={(e) =>
                                  setEditLines((prev) =>
                                    prev.map((x) =>
                                      x.lineId === ln.lineId
                                        ? {
                                            ...x,
                                            bufferPercent: clampBufferPercentInput(
                                              e.target.value,
                                              maxRegularSoBufferPercent,
                                            ),
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label className="grid gap-1 text-sm">
                              <span className="text-slate-600">Planned Qty</span>
                              <Input className="w-28 tabular-nums" readOnly value={plannedDisplay} disabled={disableQty} />
                            </label>
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
        </div>
      ) : null}

      {invoiceModalSoId != null ? (
        <div
          className="erp-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sales-commercial-invoice-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInvoiceModalSoId(null);
          }}
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
        </div>
      ) : null}

            <ShortcutHintBar items={SALES_ORDERS_SHORTCUT_BAR} />
          </div>
        </>
      )}
    </PageContainer>
  );
}
