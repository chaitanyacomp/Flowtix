import * as React from "react";
import { Keyboard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ApiRequestError, apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useAuth } from "../hooks/useAuth";
import { isValidNumberDraft, type NumberDraft, toNumberDraft } from "../lib/numberDraft";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useDependentFieldFocus } from "../hooks/useDependentFieldFocus";
import { useMandatoryPositiveQtyDraft } from "../hooks/useMandatoryPositiveQtyDraft";
import { sanitizeProductionQtyDraftInput } from "../lib/quantityDraft";
import {
  OperatorMetricBadge,
  OperatorPageBody,
  OperatorTopBar,
  operatorInputClass,
} from "../components/erp/OperatorWorkbench";
import { cn } from "../lib/utils";
import { ErpModal } from "../components/erp/ErpModal";
import { useShortcutHints } from "../hooks/useShortcutHints";
import { FieldShortcutHint } from "../components/ui/FieldShortcutHint";
import {
  FIELD_HINT_ENTER_NEXT,
  FIELD_HINT_PROD_LINE,
  FIELD_HINT_PROD_SAVE,
  FIELD_HINT_PROD_WO,
  PRODUCTION_SHORTCUT_BAR,
} from "../lib/shortcutHintCopy";
import {
  PageContainer,
  PageNoQtyFlowBackLink,
  PageSmartBackLink,
} from "../components/PageHeader";
import { NextStepStrip } from "../components/erp/NextStepStrip";
import { NoQtyCycleContextBar } from "../components/erp/foundation/NoQtyCycleContextBar";
import { OperationalContextBar, OperationalContextSticky, OpCtxSep } from "../components/erp/OperationalWorkspaceChrome";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { buildNoQtyGuidedHref, buildQcEntryHref, useNoQtyFlowState } from "../lib/noQtyFlowState";
import { prepareNoQtyNextRequirementSheetAndNavigate } from "../lib/noQtyPrepareNextRsNavigate";
import { useToast } from "../contexts/ToastContext";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { DemoSafeNoQtyContinue } from "../components/demo/DemoSafeNoQtyContinue";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";
import { displayRequirementSheetNo, displaySalesOrderNo, displayWorkOrderNo } from "../lib/docNoDisplay";
import { useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { useErpRoleUi } from "../hooks/useErpRoleUi";
import { useCanCreateNextRs } from "../hooks/useIsAdmin";
import { getRoleEmptyState } from "../lib/erpRoleEmptyStates";
import { isProductionWorkspaceEntry } from "../lib/operationalPageEntry";
import { productionHrefFromDashboardRow } from "../lib/operationalWorkspaceLinks";
import {
  materialRequestsQueueHref,
  rmControlCenterHref,
} from "../lib/materialWorkflowLinks";
import { OperationalProductionWorkspace } from "../components/erp/OperationalProductionWorkspace";
import {
  ProductionMaterialWorkflowCard,
} from "../components/erp/ProductionMaterialWorkflowCard";
import { ProductionRmBlockedBanner } from "../components/erp/ProductionRmBlockedBanner";
import {
  isRegularProductionEntryBlocked,
  resolveRegularRmAllowedNowQty,
  resolveRegularRmEntryQtyCap,
  type ProductionRmReadiness,
} from "../components/erp/ProductionRmReadinessStrip";
import { ProductionRmConsumptionReviewModal } from "../components/erp/ProductionRmConsumptionReviewModal";
import type { DashboardProductionStatusSource } from "../lib/dashboardProductionStatus";
import {
  resolveNoQtyCycleDisplayStatus,
  resolveNoQtyCycleDisplayStatusForWorkOrder,
} from "../lib/noQtyCycleDisplayStatus";
import { PRODUCTION_QA_TERMS } from "../lib/productionQaTerminology";
import {
  noQtyErpAdjustedPlanningQtyForWorkOrder,
  noQtyOperatorPendingQtyForWorkOrder,
} from "../lib/noQtyShortagePresentation";
import {
  isWorkOrderPausedStatus,
  isWorkOrderProductionBlocked,
  resumeWorkOrderApi,
  workOrderProductionBlockedMessage,
  workOrderStatusDisplayLabel,
} from "../lib/workOrderLifecycle";
import {
  buildCompleteQaNextStep,
  buildRmIssueNextStep,
  buildRmReadyProductionNextStep,
  resolveProductionStickyContext,
  resolveProductionStickyMetrics,
} from "../lib/regularSoOperationalGuidance";

type WoLine = {
  id: number;
  fgItemId: number;
  qty: string;
  /** Sum of APPROVED production batches on this line (draft excluded). */
  approvedProducedQty?: number;
  /** max(0, WO line qty − approved produced); lines with 0 are omitted when pendingOnly=1. */
  remainingQty?: number;
  fgItem: { itemName: string };
};
type WoRow = {
  id: number;
  salesOrderId: number;
  docNo?: string | null;
  status?: string;
  holdReason?: string | null;
  holdRemarks?: string | null;
  shortfallQty?: number | string | null;
  closureReason?: string | null;
  requirementSheetId?: number | null;
  cycleId?: number | null;
  cycle?: { cycleNo?: number | null; id?: number | null } | null;
  /** Present when `salesOrder: true` on work-orders API. */
  salesOrder?: { orderType?: string | null; docNo?: string | null } | null;
  lines: WoLine[];
};

type FlatLine = WoLine & { workOrderId: number; salesOrderId: number };

type ProdEntryRow = {
  id: number;
  producedQty: string;
  date: string;
  /** When API includes it on the batch (uncommon). */
  orderType?: string;
  /** When API embeds sales order at entry level. */
  salesOrder?: { orderType?: string };
  /** DRAFT = editable, not QC-eligible; APPROVED = locked, QC-eligible */
  workflowStatus?: string;
  qcAcceptedQty?: number;
  qcRejectedQty?: number;
  qcPendingQty?: number;
  workOrderLine: {
    id: number;
    fgItem: { itemName: string };
    workOrder: {
      id: number;
      salesOrderId: number;
      cycleId?: number | null;
      cycle?: { cycleNo?: number | null } | null;
      /** When API includes WO-level type (uncommon). */
      orderType?: string;
      /** When API embeds sales order on WO include. */
      salesOrder?: { orderType?: string };
    };
  };
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return todayYmd();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isDraft(e: ProdEntryRow): boolean {
  return (e.workflowStatus ?? "APPROVED") === "DRAFT";
}

function isApproved(e: ProdEntryRow): boolean {
  return (e.workflowStatus ?? "APPROVED") === "APPROVED";
}

function qcCompleted(e: ProdEntryRow): boolean {
  if (!isApproved(e)) return false;
  const pending = Number(e.qcPendingQty ?? NaN);
  return Number.isFinite(pending) && pending <= 1e-6;
}

function qcPendingEntry(e: ProdEntryRow): boolean {
  return isApproved(e) && !qcCompleted(e);
}

/** Approved batches only; quantity eligible before backend QC/stock rules. */
function reversibleProductionQty(e: ProdEntryRow): number {
  const pq = Number(e.producedQty);
  return Number.isFinite(pq) ? Math.max(0, pq) : 0;
}

/** Production-page reverse (approval rollback): ADMIN only, never after QC is fully done on this batch. */
function canOfferProductionReverse(r: ProdEntryRow, isAdminUser: boolean): boolean {
  if (!isAdminUser || !isApproved(r) || qcCompleted(r)) return false;
  return reversibleProductionQty(r) > 1e-6;
}

/** Raw order type from API: entry row, optional flat salesOrder, or WO-embedded sales order. */
function prodEntryOrderTypeRaw(e: ProdEntryRow): string {
  const top = e.orderType;
  const flatSo = e.salesOrder?.orderType;
  const nestedSo = e.workOrderLine?.workOrder?.salesOrder?.orderType;
  const pick = [top, flatSo, nestedSo].find((v) => v != null && String(v).trim() !== "");
  return pick != null ? String(pick).trim() : "";
}

type ProductionSoTypeUi =
  | { kind: "badge"; variant: "regular" | "no_qty" }
  | { kind: "muted"; text: string };

/** Maps NORMAL → REGULAR display; no default when missing or unrecognized. */
function productionSoTypeUi(e: ProdEntryRow): ProductionSoTypeUi {
  const raw = prodEntryOrderTypeRaw(e);
  if (!raw) return { kind: "muted", text: "—" };
  if (raw === "NO_QTY") return { kind: "badge", variant: "no_qty" };
  if (raw === "NORMAL") return { kind: "badge", variant: "regular" };
  return { kind: "muted", text: raw };
}

/** REGULAR (non–NO_QTY) batches use RM consumption review before approve (Phase 3E). */
function entryUsesRmConsumptionReview(e: ProdEntryRow | undefined): boolean {
  if (!e) return false;
  return prodEntryOrderTypeRaw(e) !== "NO_QTY";
}

function fmtProdQty(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1000) / 1000;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return String(r);
}

/** REGULAR flow only — smart back targets from `from` / `source` query (UI navigation). */
function resolveProductionRegularBack(args: {
  fromParam: string;
  sourceParam: string;
  salesOrderId: number;
}): { label: string; to: string } {
  const from = args.fromParam.trim().toLowerCase();
  const src = args.sourceParam.trim().toLowerCase();
  const sid = args.salesOrderId;
  const soQs = sid > 0 ? `?salesOrderId=${encodeURIComponent(String(sid))}` : "";
  if (from === "dashboard" || src === "dashboard") return { label: "Dashboard", to: "/dashboard" };
  if (from === "work-order-workspace")
    return { label: "Back to Work Order Workspace", to: "/work-orders" };
  if (from === "work-orders" || from === "wo-list")
    return { label: "Work Orders", to: sid > 0 ? `/work-orders${soQs}` : "/work-orders" };
  if (from === "sales-orders" || from === "sales-order")
    return { label: "Sales Orders", to: sid > 0 ? `/sales-orders${soQs}` : "/sales-orders" };
  if (from === "rm-check" || from === "prepare-wo")
    return {
      label: "Prepare Work Order",
      to: sid > 0 ? `/work-orders/prepare?salesOrderId=${encodeURIComponent(String(sid))}` : "/work-orders/prepare",
    };
  return { label: "Work Orders", to: sid > 0 ? `/work-orders${soQs}` : "/work-orders" };
}

type NoQtyRmShortagePayload = {
  shortages?: Array<{
    rmItemId: number;
    rmItemName: string;
    requiredQty: number;
    availableQty: number;
    shortageQty: number;
    unitName: string;
  }>;
  context?: {
    salesOrderId: number;
    cycleId: number | null;
    workOrderId: number;
    workOrderLineId: number;
    itemId: number;
  };
};

type NoQtyRsListRow = {
  id: number;
  cycleId: number | null;
  cycleNo: number | null;
  status: string;
};

type NoQtyRsDisplayLine = {
  itemId: number;
  itemName: string;
  newRequirement: number;
  lastShortageAdded: number;
  finalPlannedQty: number;
  coveredFromStockQty: number;
};

type NoQtyShortageHistorySheet = {
  sheetId: number;
  cycleId: number | null;
  cycleNo: number | null;
  lines: NoQtyRsDisplayLine[];
};

type NoQtyProductShortageHistoryRow = {
  key: string;
  cycleId: number | null;
  cycleNo: number | null;
  itemId: number;
  itemName: string;
  newRequirement: number;
  lastShortageAdded: number;
  finalPlannedQty: number;
  producedQty: number;
  shortageQty: number;
  isCurrentCycle: boolean;
};

function safeProdNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function lineRemaining(l: FlatLine): number {
  const approved = l.approvedProducedQty ?? 0;
  return l.remainingQty != null && Number.isFinite(l.remainingQty)
    ? l.remainingQty
    : Math.max(0, Number(l.qty) - approved);
}

function formatNoQtyProductionWoLabel(
  w: WoRow,
  soId: number,
  soDoc: string | null | undefined,
): string {
  const cyc =
    w.cycle?.cycleNo != null && Number.isFinite(Number(w.cycle.cycleNo))
      ? `Cycle ${Number(w.cycle.cycleNo)}`
      : "Cycle —";
  return `WO #${w.id} | ${displaySalesOrderNo(soId, soDoc)} | ${cyc}`;
}

function cycleNoForWorkOrder(workOrders: WoRow[], workOrderId: number): number | null {
  const wo = workOrders.find((w) => w.id === workOrderId);
  const n = wo?.cycle?.cycleNo;
  return n != null && Number.isFinite(Number(n)) ? Number(n) : null;
}

function formatNoQtyProductionContextLabel(opts: {
  soId: number;
  soDoc?: string | null;
  cycleNo?: number | null;
  itemName?: string | null;
}): string {
  const cyc =
    opts.cycleNo != null && Number.isFinite(Number(opts.cycleNo)) ? `Cycle ${Number(opts.cycleNo)}` : "Cycle —";
  const so = displaySalesOrderNo(opts.soId, opts.soDoc);
  const item = (opts.itemName ?? "").trim() ? `Item: ${String(opts.itemName).trim()}` : "Item: —";
  return [so, cyc, item].join(" | ");
}

type ProductionFlowMode = "NO_QTY" | "REGULAR" | "NONE";

function formatNoQtyProductionEntryContextLine(opts: {
  cycleNo: number | null;
  workOrderId: number;
  woDocNo?: string | null;
  requirementSheetId?: number | null;
  itemName: string;
  remainingQty: number;
}): string {
  const cycle =
    opts.cycleNo != null && Number.isFinite(Number(opts.cycleNo)) ? `Cycle ${Number(opts.cycleNo)}` : "Cycle —";
  const wo = displayWorkOrderNo(opts.workOrderId, opts.woDocNo ?? null);
  const rs =
    opts.requirementSheetId != null && Number(opts.requirementSheetId) > 0
      ? displayRequirementSheetNo(Number(opts.requirementSheetId), null)
      : "RS —";
  return `${cycle} · ${wo} · ${rs} · ${opts.itemName} · Remaining ${fmtProdQty(opts.remainingQty)}`;
}

function sortFlatByPriority(lines: FlatLine[]): FlatLine[] {
  return [...lines].sort((a, b) => {
    const d = lineRemaining(b) - lineRemaining(a);
    if (Math.abs(d) > 1e-9) return d;
    if (b.workOrderId !== a.workOrderId) return b.workOrderId - a.workOrderId;
    return b.id - a.id;
  });
}

export function ProductionPage() {
  const auth = useAuth();
  const roleUi = useErpRoleUi();
  const canCreateNextRs = useCanCreateNextRs();
  const canProd = auth.user?.role === "ADMIN" || auth.user?.role === "PRODUCTION";
  const isAdmin = auth.user?.role === "ADMIN";
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const demo = useDemoMode();
  const prodDemoHl =
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "regular", 3) ??
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "no_qty", 4);
  const showDemoNoQtyProdContinue = demo.enabled && demo.flow === "no_qty" && demo.step === 4;
  const liveTick = useErpRefreshTick(["production", "qc", "dashboard", "reports"], { pollIntervalMs: 0 });

  const source = searchParams.get("source") ?? "";
  const fromParam = searchParams.get("from") ?? "";
  const fromNoQtySo = source === "no_qty_so";
  const focusSoId = Number(searchParams.get("salesOrderId") ?? 0);
  const focusSoIdValid = Number.isFinite(focusSoId) && focusSoId > 0;
  const cycleIdQs = searchParams.get("cycleId");
  const cycleIdFromUrl =
    cycleIdQs != null &&
    cycleIdQs !== "" &&
    Number.isFinite(Number(cycleIdQs)) &&
    Number(cycleIdQs) > 0
      ? Number(cycleIdQs)
      : null;
  const workOrderLineIdFromUrl = Number(searchParams.get("workOrderLineId") ?? 0);
  const woIdFromWorkOrderParam = Number(searchParams.get("workOrderId") ?? 0);
  const woIdFromLegacy = Number(searchParams.get("woId") ?? 0);
  const woIdFromUrlPick =
    Number.isFinite(woIdFromWorkOrderParam) && woIdFromWorkOrderParam > 0
      ? woIdFromWorkOrderParam
      : Number.isFinite(woIdFromLegacy) && woIdFromLegacy > 0
        ? woIdFromLegacy
        : 0;
  const woIdFromUrlValid = woIdFromUrlPick > 0;
  const workOrderLineIdFromUrlValid =
    Number.isFinite(workOrderLineIdFromUrl) && workOrderLineIdFromUrl > 0;
  /** Dashboard Continue Production / deep-link with WO identity — not bare sidebar entry. */
  const noQtyContinueProductionIntent =
    searchParams.get("fromDashboard") === "1" ||
    (focusSoIdValid && (woIdFromUrlValid || workOrderLineIdFromUrlValid));

  const [workOrders, setWorkOrders] = React.useState<WoRow[]>([]);
  const [entries, setEntries] = React.useState<ProdEntryRow[]>([]);
  const [woId, setWoId] = React.useState(0);
  const [wolId, setWolId] = React.useState(0);
  /** Locked when operator picks a work-queue row (menu entry); prevents NO_QTY/REGULAR layout oscillation. */
  const [userLockedFlowMode, setUserLockedFlowMode] = React.useState<ProductionFlowMode | null>(null);
  const [soOrderTypeById, setSoOrderTypeById] = React.useState<Record<number, string>>({});
  /**
   * Flips to true once the initial WO/entries `refresh()` settles (success or failure).
   * Lets `productionIdentityUnresolved` distinguish "WO not loaded yet" from "WO not in
   * pending list", which is critical to avoid blocking REGULAR flow indefinitely when the
   * URL references a completed/non-pending WO id.
   */
  const [initialRefreshDone, setInitialRefreshDone] = React.useState(false);

  /**
   * NO_QTY identity recovery from currently loaded production entries.
   *
   * Definitive only — uses `prodEntryOrderTypeRaw(e)` which reads the actual API-provided
   * `orderType` fields (entry-level, flat salesOrder, or nested WO-embedded salesOrder).
   * No inference, no labels, no partial UI state.
   *
   * URL-bound: we only consider entries that belong to the SO or WO referenced by the URL.
   * Without a URL hint, a broad `/production` view aggregates all org-wide pending entries —
   * any one NO_QTY entry would over-recover the entire page to NO_QTY. Binding to the URL
   * keeps REGULAR flows untouched while still catching deep-links that omit `source=no_qty_so`.
   */
  const noQtyRecoveryFromEntries = React.useMemo(() => {
    if (!focusSoIdValid && !woIdFromUrlValid) return false;
    for (const e of entries) {
      if (prodEntryOrderTypeRaw(e) !== "NO_QTY") continue;
      const eSoId = Number(e.workOrderLine?.workOrder?.salesOrderId ?? 0);
      const eWoId = Number(e.workOrderLine?.workOrder?.id ?? 0);
      if (focusSoIdValid && eSoId === focusSoId) return true;
      if (woIdFromUrlValid && eWoId === woIdFromUrlPick) return true;
    }
    return false;
  }, [focusSoIdValid, focusSoId, woIdFromUrlValid, woIdFromUrlPick, entries]);

  /**
   * NO_QTY identity recovery from the WO referenced by `?workOrderId=` in URL.
   *
   * We only switch when `soOrderTypeById[wo.salesOrderId] === "NO_QTY"` — i.e. the SO master
   * has been fetched and definitively typed as NO_QTY. The `ensureSoOrderType` auto-load effect
   * below kicks the fetch as soon as `workOrders` resolves.
   */
  const noQtyRecoveryFromSelectedWo = React.useMemo(() => {
    if (!woIdFromUrlValid) return false;
    const wo = workOrders.find((w) => w.id === woIdFromUrlPick);
    if (!wo || !(wo.salesOrderId > 0)) return false;
    return String(soOrderTypeById[wo.salesOrderId] ?? "") === "NO_QTY";
  }, [woIdFromUrlValid, woIdFromUrlPick, workOrders, soOrderTypeById]);

  /**
   * URL-only NO_QTY identity (never inferred from menu WO selection alone — that uses productionFlowMode).
   */
  const explicitNoQtyUrlNavigate =
    (focusSoIdValid &&
      (fromNoQtySo || String(soOrderTypeById[focusSoId] ?? "") === "NO_QTY")) ||
    noQtyRecoveryFromSelectedWo ||
    noQtyRecoveryFromEntries ||
    noQtyContinueProductionIntent;

  /**
   * Identity resolving guard — prevents REGULAR flicker on NO_QTY deep-links.
   *
   * The page must render one of:
   *   1. NO_QTY branch — when `navigateNoQtyContext` is definitively true.
   *   2. REGULAR branch — when identity is definitively not NO_QTY.
   *   3. "Resolving production context…" — when async identity recovery may still flip
   *      `navigateNoQtyContext` to true.
   *
   * We sit in (3) only while a URL hint that could resolve to NO_QTY is still pending its
   * own resolver:
   *   - URL has `?salesOrderId=` and `soOrderTypeById` hasn't recorded the master fetch yet.
   *   - URL has `?workOrderId=` and either `workOrders` hasn't settled yet OR the linked WO's
   *     SO master fetch hasn't recorded yet.
   *
   * Cases that bypass the guard (always render immediately):
   *   - `fromNoQtySo` URL signal → NO_QTY branch (no wait).
   *   - `navigateNoQtyContext` already true via any source → NO_QTY branch.
   *   - No NO_QTY-identifying URL hint at all (`/production` plain) → REGULAR branch
   *     (operator-driven queue; entry-based recovery is URL-bound so it won't flip later).
   *
   * Fail-safe: once `initialRefreshDone` is true and the WO is not in the pending list, we
   * stop waiting — defer to REGULAR. `ensureSoOrderType` also writes the key on fetch failure
   * so a transient API error can never strand the page in "Resolving…".
   */
  const productionIdentityUnresolved = React.useMemo(() => {
    if (fromNoQtySo) return false;
    if (explicitNoQtyUrlNavigate) return false;

    if (focusSoIdValid && !Object.prototype.hasOwnProperty.call(soOrderTypeById, focusSoId)) {
      return true;
    }

    if (woIdFromUrlValid) {
      if (!initialRefreshDone) return true;
      const wo = workOrders.find((w) => w.id === woIdFromUrlPick);
      if (wo && wo.salesOrderId > 0 && !Object.prototype.hasOwnProperty.call(soOrderTypeById, wo.salesOrderId)) {
        return true;
      }
    }

    return false;
  }, [
    fromNoQtySo,
    explicitNoQtyUrlNavigate,
    focusSoIdValid,
    focusSoId,
    soOrderTypeById,
    woIdFromUrlValid,
    woIdFromUrlPick,
    workOrders,
    initialRefreshDone,
  ]);

  const [error, setError] = React.useState<string | null>(null);
  const [focusSo, setFocusSo] = React.useState<{
    id: number;
    customerName: string;
    docNo?: string | null;
    cycleNo?: number | null;
    /** DB id of SalesOrderCycle — aligns production/QC with backend scope */
    currentCycleId?: number | null;
    cycleStatus?: "Active Cycle" | "Closed Cycle";
  } | null>(null);

  const [noQtyEmptyMsg, setNoQtyEmptyMsg] = React.useState<string>("");

  const [prodDate, setProdDate] = React.useState(todayYmd);
  const {
    raw: producedQtyStr,
    setRaw: setProducedQtyStr,
    parsed: producedQtyParsed,
    isValid: producedQtyValid,
    reset: resetProducedQty,
  } = useMandatoryPositiveQtyDraft();
  /** Prevents async line prefill / RM clamp from overwriting manual qty entry. */
  const producedQtyUserTouchedRef = React.useRef(false);
  const resetProducedQtyField = React.useCallback(() => {
    producedQtyUserTouchedRef.current = false;
    resetProducedQty();
  }, [resetProducedQty]);
  const onProducedQtyInputChange = React.useCallback(
    (raw: string) => {
      producedQtyUserTouchedRef.current = true;
      setProducedQtyStr(sanitizeProductionQtyDraftInput(raw));
    },
    [setProducedQtyStr],
  );
  const [posting, setPosting] = React.useState(false);

  const demoProdQtyPrefilledRef = React.useRef(false);
  React.useEffect(() => {
    if (!prodDemoHl) demoProdQtyPrefilledRef.current = false;
  }, [prodDemoHl]);
  React.useEffect(() => {
    if (!demo.enabled || !prodDemoHl) return;
    if (!woId || !wolId || demoProdQtyPrefilledRef.current) return;
    if (String(producedQtyStr ?? "").trim()) return;
    demoProdQtyPrefilledRef.current = true;
    setProducedQtyStr("10");
  }, [demo.enabled, prodDemoHl, woId, wolId, producedQtyStr, setProducedQtyStr]);

  const [editing, setEditing] = React.useState<ProdEntryRow | null>(null);
  const [editQty, setEditQty] = React.useState<NumberDraft>("");
  const [editDate, setEditDate] = React.useState(todayYmd);
  const [editSaving, setEditSaving] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<number | null>(null);
  const [reverseModalEntry, setReverseModalEntry] = React.useState<ProdEntryRow | null>(null);
  const [consumptionApproveId, setConsumptionApproveId] = React.useState<number | null>(null);
  const [reverseQtyDraft, setReverseQtyDraft] = React.useState("");
  const [reverseReasonDraft, setReverseReasonDraft] = React.useState("");
  const [reverseModalError, setReverseModalError] = React.useState<string | null>(null);
  const [entryFilter, setEntryFilter] = React.useState<"ALL" | "DRAFT" | "APPROVED">("ALL");
  const [noQtyRmShortage, setNoQtyRmShortage] = React.useState<NoQtyRmShortagePayload | null>(null);
  const [noQtyManualContinue, setNoQtyManualContinue] = React.useState(
    () => noQtyContinueProductionIntent,
  );
  const noQtyAllowShopFloorContinue = noQtyManualContinue || noQtyContinueProductionIntent;
  const noQtyContinueAutoPickDoneRef = React.useRef(false);

  React.useEffect(() => {
    noQtyContinueAutoPickDoneRef.current = false;
  }, [focusSoId, woIdFromUrlPick, workOrderLineIdFromUrl]);

  const clearWoLineSelection = React.useCallback(() => {
    setWoId((prev) => (prev !== 0 ? 0 : prev));
    setWolId((prev) => (prev !== 0 ? 0 : prev));
    setUserLockedFlowMode(null);
    resetProducedQtyField();
  }, [resetProducedQtyField]);

  const [noQtyShortageHistorySheets, setNoQtyShortageHistorySheets] = React.useState<NoQtyShortageHistorySheet[]>([]);
  const [noQtyShortageHistoryWorkOrders, setNoQtyShortageHistoryWorkOrders] = React.useState<WoRow[]>([]);
  const [noQtyShortageHistoryEntriesByCycle, setNoQtyShortageHistoryEntriesByCycle] = React.useState<
    Record<number, ProdEntryRow[]>
  >({});
  const [noQtyProductionQueue, setNoQtyProductionQueue] = React.useState<DashboardProductionStatusSource[]>([]);

  const shortcutHints = useShortcutHints({
    pageKey: "production",
    fieldShortcuts: {
      prodWo: FIELD_HINT_PROD_WO,
      prodLine: FIELD_HINT_PROD_LINE,
      prodQty: FIELD_HINT_ENTER_NEXT,
      prodSave: FIELD_HINT_PROD_SAVE,
    },
    firstUseTipText: "Tip: Enter moves to the next field. Ctrl+Enter saves a draft when the form is ready.",
  });

  const [kbHelpOpen, setKbHelpOpen] = React.useState(false);
  React.useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = (el.tagName ?? "").toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
    }

    function onKey(ev: KeyboardEvent) {
      // '?' = Shift + '/'
      if (ev.key === "?" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        if (isTypingTarget(ev.target)) return;
        ev.preventDefault();
        setKbHelpOpen((v) => !v);
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kbHelpOpen]);

  const createFormRef = React.useRef<HTMLFormElement | null>(null);
  const woSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const lineSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const producedQtyRef = React.useRef<HTMLInputElement | null>(null);

  const flatLines = React.useMemo<FlatLine[]>(
    () =>
      workOrders.flatMap((wo) =>
        wo.lines.map((l) => ({
          ...l,
          workOrderId: wo.id,
          salesOrderId: wo.salesOrderId,
        })),
      ),
    [workOrders],
  );

  const sortedFlatLines = React.useMemo(() => sortFlatByPriority(flatLines), [flatLines]);

  const flowResolutionSoId = React.useMemo(() => {
    if (focusSoIdValid) return focusSoId;
    if (woId > 0) {
      const w = workOrders.find((x) => x.id === woId);
      if (w && w.salesOrderId > 0) return w.salesOrderId;
    }
    if (wolId > 0) {
      const l = flatLines.find((x) => x.id === wolId);
      if (l && l.salesOrderId > 0) return l.salesOrderId;
    }
    if (woIdFromUrlValid) {
      const w = workOrders.find((x) => x.id === woIdFromUrlPick);
      if (w && w.salesOrderId > 0) return w.salesOrderId;
    }
    return 0;
  }, [focusSoIdValid, focusSoId, woId, wolId, flatLines, workOrders, woIdFromUrlValid, woIdFromUrlPick]);

  const productionFlowMode = React.useMemo((): ProductionFlowMode => {
    if (userLockedFlowMode) return userLockedFlowMode;
    if (fromNoQtySo) return "NO_QTY";
    if (noQtyContinueProductionIntent) return "NO_QTY";
    if (noQtyRecoveryFromSelectedWo) return "NO_QTY";
    if (noQtyRecoveryFromEntries) return "NO_QTY";

    const soId = flowResolutionSoId;
    if (soId > 0 && Object.prototype.hasOwnProperty.call(soOrderTypeById, soId)) {
      return String(soOrderTypeById[soId] ?? "") === "NO_QTY" ? "NO_QTY" : "REGULAR";
    }

    const menuNeutral =
      !focusSoIdValid && !woIdFromUrlValid && !fromNoQtySo && !noQtyContinueProductionIntent;
    if (menuNeutral && woId === 0 && wolId === 0) return "NONE";

    if (soId > 0 && !Object.prototype.hasOwnProperty.call(soOrderTypeById, soId)) return "NONE";

    if (woId === 0 && wolId === 0) return "NONE";

    return "REGULAR";
  }, [
    userLockedFlowMode,
    fromNoQtySo,
    noQtyContinueProductionIntent,
    noQtyRecoveryFromSelectedWo,
    noQtyRecoveryFromEntries,
    flowResolutionSoId,
    soOrderTypeById,
    focusSoIdValid,
    woIdFromUrlValid,
    woId,
    wolId,
  ]);

  const navigateNoQtyContext = productionFlowMode === "NO_QTY";

  const showProductionWorkspace = React.useMemo(
    () =>
      isProductionWorkspaceEntry({
        fromNoQtySo,
        focusSoIdValid,
        woIdFromUrlValid,
        workOrderLineIdFromUrlValid,
        fromDashboardWithTarget: noQtyContinueProductionIntent,
      }) &&
      woId === 0 &&
      wolId === 0 &&
      userLockedFlowMode == null,
    [
      fromNoQtySo,
      focusSoIdValid,
      woIdFromUrlValid,
      workOrderLineIdFromUrlValid,
      noQtyContinueProductionIntent,
      woId,
      wolId,
      userLockedFlowMode,
    ],
  );

  const openProductionFromWorkspace = React.useCallback(
    (row: DashboardProductionStatusSource) => {
      const href = productionHrefFromDashboardRow({
        orderType: row.orderType,
        salesOrderId: row.salesOrderId,
        workOrderId: row.workOrderId,
        workOrderLineId: row.workOrderLineId,
        cycleId: row.cycleId ?? null,
        actionHref: row.actionHref,
      });
      navigate(href, { state: { from: "dashboard" } });
    },
    [navigate],
  );

  const noQtyCycleAnchorWoId = React.useMemo(() => {
    if (woId > 0) return woId;
    if (woIdFromUrlValid) return woIdFromUrlPick;
    return 0;
  }, [woId, woIdFromUrlValid, woIdFromUrlPick]);

  const selectedWoForNoQtyProductionCycle = React.useMemo(() => {
    if (!navigateNoQtyContext || noQtyCycleAnchorWoId <= 0) return null;
    return workOrders.find((w) => w.id === noQtyCycleAnchorWoId) ?? null;
  }, [navigateNoQtyContext, noQtyCycleAnchorWoId, workOrders]);

  const woScopedNoQtyCycleId = React.useMemo((): number | null => {
    const wo = selectedWoForNoQtyProductionCycle;
    if (!wo) return null;
    const raw = wo.cycleId ?? wo.cycle?.id ?? null;
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [selectedWoForNoQtyProductionCycle]);

  const noQtyFlowStateCycleQueryId = React.useMemo((): number | null => {
    if (!navigateNoQtyContext) return null;
    return woScopedNoQtyCycleId ?? cycleIdFromUrl ?? null;
  }, [navigateNoQtyContext, woScopedNoQtyCycleId, cycleIdFromUrl]);

  const noQtyFlowSoId = React.useMemo((): number | null => {
    if (focusSoIdValid) return focusSoId;
    if (flowResolutionSoId > 0) return flowResolutionSoId;
    return null;
  }, [focusSoIdValid, focusSoId, flowResolutionSoId]);

  const { state: noQtyFlowState } = useNoQtyFlowState(noQtyFlowSoId, navigateNoQtyContext, {
    cycleId: noQtyFlowStateCycleQueryId,
  });
  const noQtyNextRsReady = noQtyFlowState?.overallWorkflowState === "NEXT_RS_READY";
  const noQtyCarryForwardQtyFromEngine = Number(noQtyFlowState?.productionRemainingQty ?? 0);

  const effectiveNoQtyCycleId = React.useMemo(() => {
    if (!navigateNoQtyContext) return null;
    return woScopedNoQtyCycleId ?? cycleIdFromUrl ?? noQtyFlowState?.cycleId ?? null;
  }, [navigateNoQtyContext, woScopedNoQtyCycleId, cycleIdFromUrl, noQtyFlowState?.cycleId]);

  const noQtyCycleNoFromWorkOrders = React.useMemo((): number | null => {
    if (effectiveNoQtyCycleId == null) return null;
    const match = workOrders.find((w) => Number(w.cycleId ?? w.cycle?.id ?? 0) === Number(effectiveNoQtyCycleId));
    const n = match?.cycle?.cycleNo;
    return n != null && Number.isFinite(Number(n)) ? Number(n) : null;
  }, [effectiveNoQtyCycleId, workOrders]);

  const noQtyBannerCycleNo = React.useMemo((): number | null => {
    const n = selectedWoForNoQtyProductionCycle?.cycle?.cycleNo;
    if (n != null && Number.isFinite(Number(n))) return Number(n);
    return null;
  }, [selectedWoForNoQtyProductionCycle]);

  useFastEntryForm({
    containerRef: createFormRef,
    initialFocusRef: woSelectRef,
    initialFocusEnabled: Boolean(canProd && flatLines.length > 0),
  });

  const noQtyQcPendingByWolId = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const e of entries) {
      if (!isApproved(e)) continue;
      const id = Number(e.workOrderLine?.id ?? 0);
      if (!(id > 0)) continue;
      const pending = Number(e.qcPendingQty ?? 0) || 0;
      m.set(id, (m.get(id) ?? 0) + Math.max(0, pending));
    }
    return m;
  }, [entries]);

  const noQtyHasApprovedByWolId = React.useMemo(() => {
    const s = new Set<number>();
    for (const e of entries) {
      if (!isApproved(e)) continue;
      const id = Number(e.workOrderLine?.id ?? 0);
      if (id > 0) s.add(id);
    }
    return s;
  }, [entries]);

  const ensureSoOrderType = React.useCallback(
    async (soId: number): Promise<string> => {
      if (!Number.isFinite(soId) || soId <= 0) return "";
      const cached = soOrderTypeById[soId];
      if (cached) return cached;
      try {
        const so = await apiFetch<any>(`/api/sales-orders/${soId}`);
        const t = String(so?.orderType ?? "");
        setSoOrderTypeById((prev) => (prev[soId] ? prev : { ...prev, [soId]: t }));
        return t;
      } catch {
        /**
         * Mark the key as attempted (empty value). The `productionIdentityUnresolved` guard uses
         * key presence (`soId in soOrderTypeById`) to know that the SO master fetch has settled,
         * so a transient API failure must not leave the page stuck in "Resolving…" forever.
         */
        setSoOrderTypeById((prev) =>
          Object.prototype.hasOwnProperty.call(prev, soId) ? prev : { ...prev, [soId]: "" },
        );
        return "";
      }
    },
    [soOrderTypeById],
  );

  React.useEffect(() => {
    if (!focusSoIdValid) return;
    void ensureSoOrderType(focusSoId);
  }, [focusSoIdValid, focusSoId, ensureSoOrderType]);

  /**
   * Identity recovery: when the URL has `?workOrderId=…` but no `salesOrderId`/`source`,
   * resolve the WO's SO orderType once `workOrders` has loaded. Enables NO_QTY recovery
   * via `noQtyRecoveryFromSelectedWo` without forcing the caller to know the SO id upfront.
   */
  React.useEffect(() => {
    if (!woIdFromUrlValid) return;
    const wo = workOrders.find((w) => w.id === woIdFromUrlPick);
    if (wo && wo.salesOrderId > 0) {
      void ensureSoOrderType(wo.salesOrderId);
    }
  }, [woIdFromUrlValid, woIdFromUrlPick, workOrders, ensureSoOrderType]);

  const isCarryForwardLine = React.useCallback(
    (l: FlatLine, soOrderType?: string): boolean => {
      const eps = 1e-6;
      const t = String(soOrderType ?? "");
      if (t !== "NO_QTY") return false;
      const produced = l.approvedProducedQty ?? 0;
      const awaitingQcQty = noQtyQcPendingByWolId.get(l.id) ?? 0;
      const remainingQty = lineRemaining(l);
      return produced > eps && awaitingQcQty <= eps && remainingQty > eps;
    },
    [noQtyQcPendingByWolId],
  );

  const selected = flatLines.find((l) => l.id === wolId);

  const noQtyCycleNoForDisplay = React.useMemo((): number | null => {
    if (noQtyBannerCycleNo != null) return noQtyBannerCycleNo;
    if (noQtyCycleNoFromWorkOrders != null) return noQtyCycleNoFromWorkOrders;
    if (selected) return cycleNoForWorkOrder(workOrders, selected.workOrderId);
    if (woId > 0) return cycleNoForWorkOrder(workOrders, woId);
    return null;
  }, [noQtyBannerCycleNo, noQtyCycleNoFromWorkOrders, selected, workOrders, woId]);

  const noQtyWorkbenchSoId = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return 0;
    if (focusSoIdValid) return focusSoId;
    if (selected && selected.salesOrderId > 0) return selected.salesOrderId;
    if (woId > 0) {
      const w = workOrders.find((x) => x.id === woId);
      if (w && w.salesOrderId > 0) return w.salesOrderId;
    }
    return 0;
  }, [productionFlowMode, focusSoIdValid, focusSoId, selected, woId, workOrders]);

  const showNoQtyScopedProductionCard = productionFlowMode === "NO_QTY" && noQtyWorkbenchSoId > 0;
  const noQtyQcPendingStable = showNoQtyScopedProductionCard && entries.some((e) => qcPendingEntry(e));

  const selectedWoForNoQtyChrome = React.useMemo(() => {
    const id = woId > 0 ? woId : selected?.workOrderId ?? 0;
    if (!(id > 0)) return null;
    return workOrders.find((w) => w.id === id) ?? null;
  }, [woId, selected?.workOrderId, workOrders]);

  const noQtyCarryForwardLines = React.useMemo(() => {
    if (!showNoQtyScopedProductionCard) return [];
    return sortedFlatLines
      .filter((l) => l.salesOrderId === noQtyWorkbenchSoId)
      .filter((l) => isCarryForwardLine(l, "NO_QTY"));
  }, [showNoQtyScopedProductionCard, sortedFlatLines, noQtyWorkbenchSoId, isCarryForwardLine]);

  type NoQtyWorkQueueRow = FlatLine & {
    cycleNo: number | null;
    balance: number;
    queueStatus: "ready" | "qc_pending" | "carry_forward";
  };

  const noQtyWorkQueueRows = React.useMemo((): NoQtyWorkQueueRow[] => {
    if (!showNoQtyScopedProductionCard) return [];
    const eps = 1e-6;
    return sortFlatByPriority(sortedFlatLines.filter((l) => l.salesOrderId === noQtyWorkbenchSoId)).map((l) => {
      const approved = l.approvedProducedQty ?? 0;
      const qcPending = noQtyQcPendingByWolId.get(l.id) ?? 0;
      const carryForward = approved > eps && qcPending <= eps && noQtyHasApprovedByWolId.has(l.id);
      const queueStatus: NoQtyWorkQueueRow["queueStatus"] =
        qcPending > eps ? "qc_pending" : carryForward ? "carry_forward" : "ready";
      return {
        ...l,
        cycleNo: cycleNoForWorkOrder(workOrders, l.workOrderId),
        balance: lineRemaining(l),
        queueStatus,
      };
    });
  }, [
    showNoQtyScopedProductionCard,
    sortedFlatLines,
    noQtyWorkbenchSoId,
    workOrders,
    noQtyQcPendingByWolId,
    noQtyHasApprovedByWolId,
  ]);

  const noQtyWaitingRequirementRows = React.useMemo(() => {
    if (!showNoQtyScopedProductionCard) return [];
    const eps = 1e-6;
    const activeItemIds = new Set(noQtyWorkQueueRows.map((l) => l.fgItemId));
    const rows: { key: string; itemName: string; cycleNo: number | null }[] = [];
    for (const sh of noQtyShortageHistorySheets) {
      if (
        effectiveNoQtyCycleId != null &&
        sh.cycleId != null &&
        Number(sh.cycleId) !== Number(effectiveNoQtyCycleId)
      ) {
        continue;
      }
      for (const ln of sh.lines) {
        if (ln.finalPlannedQty > eps) continue;
        if (activeItemIds.has(ln.itemId)) continue;
        rows.push({
          key: `${sh.sheetId}-${ln.itemId}`,
          itemName: ln.itemName,
          cycleNo: sh.cycleNo,
        });
      }
    }
    return rows;
  }, [
    showNoQtyScopedProductionCard,
    noQtyWorkQueueRows,
    noQtyShortageHistorySheets,
    effectiveNoQtyCycleId,
  ]);

  /**
   * NO_QTY-only APIs may run only after `soOrderTypeById` confirms the scoped SO is NO_QTY
   * (avoids calling no-qty endpoints while flow mode is transitional or mis-recovered).
   */
  const confirmedNoQtySoId = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return 0;
    const soId = noQtyWorkbenchSoId > 0 ? noQtyWorkbenchSoId : focusSoIdValid ? focusSoId : 0;
    if (!(soId > 0)) return 0;
    if (!Object.prototype.hasOwnProperty.call(soOrderTypeById, soId)) return 0;
    if (String(soOrderTypeById[soId] ?? "") !== "NO_QTY") return 0;
    return soId;
  }, [productionFlowMode, noQtyWorkbenchSoId, focusSoIdValid, focusSoId, soOrderTypeById]);

  const noQtyRequirementSheetsEnabled = confirmedNoQtySoId > 0;

  React.useEffect(() => {
    if (!noQtyRequirementSheetsEnabled) {
      setNoQtyShortageHistorySheets([]);
      setNoQtyShortageHistoryWorkOrders([]);
      setNoQtyShortageHistoryEntriesByCycle({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [list, wos] = await Promise.all([
          apiFetch<NoQtyRsListRow[]>(`/api/sales-orders/${noQtyWorkbenchSoId}/requirement-sheets`),
          apiFetch<WoRow[]>(`/api/production/work-orders?pendingOnly=0&salesOrderId=${noQtyWorkbenchSoId}`),
        ]);
        if (cancelled) return;
        const locked = (list ?? []).filter((s) => String(s.status ?? "") === "LOCKED");
        const sheetDetails = await Promise.all(
          locked.map(async (s) => {
            const detail = await apiFetch<{
              lines?: Array<{
                itemId: number;
                itemName?: string;
                newWoQty?: string;
                requirementQty?: string;
                shortfallQty?: number | null;
                productionRequiredQty?: number | null;
                fulfillmentQty?: number | null;
                totalWoQty?: number | null;
                coveredFromStockQty?: number | null;
              }>;
            }>(`/api/requirement-sheets/${s.id}`);
            const lines: NoQtyRsDisplayLine[] = (detail.lines ?? []).map((ln) => {
              const newRequirement = safeProdNum(ln.newWoQty ?? ln.requirementQty);
              const lastShortageAdded = safeProdNum(ln.shortfallQty);
              const coveredFromStockQty = safeProdNum(ln.coveredFromStockQty);
              const finalPlannedQty = safeProdNum(
                ln.productionRequiredQty ?? ln.totalWoQty ?? ln.fulfillmentQty ?? newRequirement + lastShortageAdded,
              );
              return {
                itemId: ln.itemId,
                itemName: String(ln.itemName ?? `Item #${ln.itemId}`),
                newRequirement,
                lastShortageAdded,
                finalPlannedQty,
                coveredFromStockQty,
              };
            });
            return {
              sheetId: s.id,
              cycleId: s.cycleId,
              cycleNo: s.cycleNo,
              lines,
            };
          }),
        );
        if (cancelled) return;
        setNoQtyShortageHistorySheets(sheetDetails);
        setNoQtyShortageHistoryWorkOrders(wos ?? []);

        const cycleIds = [
          ...new Set(
            sheetDetails
              .map((sh) => (sh.cycleId != null && Number(sh.cycleId) > 0 ? Number(sh.cycleId) : null))
              .filter((id): id is number => id != null),
          ),
        ];
        const entryPairs = await Promise.all(
          cycleIds.map(async (cycleId) => {
            const rows = await apiFetch<ProdEntryRow[]>(
              `/api/production/production-entries?salesOrderId=${noQtyWorkbenchSoId}&cycleId=${cycleId}`,
            );
            return [cycleId, rows ?? []] as const;
          }),
        );
        if (cancelled) return;
        setNoQtyShortageHistoryEntriesByCycle(Object.fromEntries(entryPairs));
      } catch {
        if (!cancelled) {
          setNoQtyShortageHistorySheets([]);
          setNoQtyShortageHistoryWorkOrders([]);
          setNoQtyShortageHistoryEntriesByCycle({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noQtyRequirementSheetsEnabled, noQtyWorkbenchSoId, liveTick]);

  const noQtyProductShortageHistoryRows = React.useMemo((): NoQtyProductShortageHistoryRow[] => {
    if (!showNoQtyScopedProductionCard) return [];
    const itemIds = new Set(noQtyCarryForwardLines.map((l) => l.fgItemId));
    if (itemIds.size === 0) return [];

    const currentCycleId =
      effectiveNoQtyCycleId != null
        ? Number(effectiveNoQtyCycleId)
        : focusSo?.currentCycleId != null
          ? Number(focusSo.currentCycleId)
          : null;

    const rows: NoQtyProductShortageHistoryRow[] = [];
    for (const sheet of noQtyShortageHistorySheets) {
      const cycleId = sheet.cycleId != null && Number(sheet.cycleId) > 0 ? Number(sheet.cycleId) : null;
      const cycleEntries = cycleId != null ? noQtyShortageHistoryEntriesByCycle[cycleId] ?? [] : [];
      const woForSheet = noQtyShortageHistoryWorkOrders.find((w) => Number(w.requirementSheetId) === sheet.sheetId);

      for (const line of sheet.lines) {
        if (!itemIds.has(line.itemId)) continue;
        const woLine = woForSheet?.lines.find((wl) => wl.fgItemId === line.itemId);
        const finalPlannedQty =
          woLine != null && Number.isFinite(Number(woLine.qty))
            ? safeProdNum(woLine.qty)
            : line.finalPlannedQty;
        let producedQty = safeProdNum(woLine?.approvedProducedQty);
        if (producedQty <= 1e-6 && woLine) {
          producedQty = cycleEntries
            .filter((e) => isApproved(e) && Number(e.workOrderLine?.id ?? 0) === woLine.id)
            .reduce((s, e) => s + safeProdNum(e.producedQty), 0);
        } else if (producedQty <= 1e-6) {
          const itemName = line.itemName.trim().toLowerCase();
          producedQty = cycleEntries
            .filter(
              (e) =>
                isApproved(e) &&
                String(e.workOrderLine?.fgItem?.itemName ?? "")
                  .trim()
                  .toLowerCase() === itemName,
            )
            .reduce((s, e) => s + safeProdNum(e.producedQty), 0);
        }
        const shortageQty =
          woLine != null
            ? lineRemaining({
                ...woLine,
                workOrderId: woForSheet?.id ?? 0,
                salesOrderId: focusSoId,
              })
            : Math.max(0, finalPlannedQty - producedQty);

        rows.push({
          key: `${sheet.sheetId}-${line.itemId}`,
          cycleId,
          cycleNo: sheet.cycleNo,
          itemId: line.itemId,
          itemName: line.itemName,
          newRequirement: line.newRequirement,
          lastShortageAdded: line.lastShortageAdded,
          finalPlannedQty,
          producedQty,
          shortageQty,
          isCurrentCycle: currentCycleId != null && cycleId != null && cycleId === currentCycleId,
        });
      }
    }

    return rows.sort((a, b) => {
      const cA = a.cycleNo ?? 0;
      const cB = b.cycleNo ?? 0;
      if (cB !== cA) return cB - cA;
      return a.itemName.localeCompare(b.itemName);
    });
  }, [
    showNoQtyScopedProductionCard,
    noQtyCarryForwardLines,
    noQtyShortageHistorySheets,
    noQtyShortageHistoryWorkOrders,
    noQtyShortageHistoryEntriesByCycle,
    effectiveNoQtyCycleId,
    focusSo?.currentCycleId,
    focusSoId,
  ]);

  const noQtyAutoPickLines = React.useMemo(() => {
    if (!showNoQtyScopedProductionCard) return [];
    if (noQtyNextRsReady) return [];
    if (noQtyQcPendingStable) return [];
    const eps = 1e-6;
    const forSo = flatLines.filter((l) => l.salesOrderId === noQtyWorkbenchSoId);
    const ready = forSo.filter((l) => {
      const rem = lineRemaining(l);
      if (!(rem > eps)) return false;
      const produced = l.approvedProducedQty ?? 0;
      const qcPending = noQtyQcPendingByWolId.get(l.id) ?? 0;
      const carryForward = produced > eps && qcPending <= eps && noQtyHasApprovedByWolId.has(l.id);
      return !carryForward && qcPending <= eps;
    });
    return sortFlatByPriority(ready);
  }, [
    flatLines,
    noQtyWorkbenchSoId,
    showNoQtyScopedProductionCard,
    noQtyHasApprovedByWolId,
    noQtyQcPendingByWolId,
    noQtyNextRsReady,
    noQtyQcPendingStable,
  ]);

  /**
   * NO_QTY: hide Add Production Entry (WO/item/qty/save) when approved batches exist and no line is in the
   * “ready to produce” bucket — next step is QC, dispatch, or carry-forward remainder only.
   */
  const hideNoQtyAddProductionEntry = React.useMemo(() => {
    if (noQtyNextRsReady && !noQtyAllowShopFloorContinue) return true;
    if (!navigateNoQtyContext || noQtyAllowShopFloorContinue || !showNoQtyScopedProductionCard) return false;
    const approvedForSo = entries.some(
      (e) =>
        isApproved(e) && Number(e.workOrderLine?.workOrder?.salesOrderId ?? 0) === noQtyWorkbenchSoId,
    );
    if (!approvedForSo) return false;
    return noQtyAutoPickLines.length === 0;
  }, [
    navigateNoQtyContext,
    noQtyAllowShopFloorContinue,
    showNoQtyScopedProductionCard,
    entries,
    noQtyWorkbenchSoId,
    noQtyAutoPickLines.length,
    noQtyNextRsReady,
  ]);

  const pickNoQtyContinueProductionLine = React.useCallback((): FlatLine | null => {
    const eps = 1e-6;
    if (workOrderLineIdFromUrlValid) {
      const byUrl = flatLines.find((l) => l.id === workOrderLineIdFromUrl);
      if (byUrl && lineRemaining(byUrl) > eps) return byUrl;
    }
    if (woIdFromUrlValid) {
      const forWo = sortFlatByPriority(flatLines.filter((l) => l.workOrderId === woIdFromUrlPick));
      const pick = forWo.find((l) => lineRemaining(l) > eps) ?? forWo[0];
      if (pick) return pick;
    }
    const forSo = sortFlatByPriority(
      flatLines.filter((l) => l.salesOrderId === noQtyWorkbenchSoId && lineRemaining(l) > eps),
    );
    if (forSo.length > 0) return forSo[0];
    const cf = sortFlatByPriority(noQtyCarryForwardLines);
    return cf.length > 0 ? cf[0] : null;
  }, [
    flatLines,
    noQtyWorkbenchSoId,
    noQtyCarryForwardLines,
    woIdFromUrlValid,
    woIdFromUrlPick,
    workOrderLineIdFromUrl,
    workOrderLineIdFromUrlValid,
  ]);

  const linesForWo = React.useMemo(() => workOrders.find((w) => w.id === woId)?.lines ?? [], [workOrders, woId]);

  /** Hide carry-forward WO lines from the production entry dropdown unless operator opts in. */
  const linesForNoQtyEntryForm = React.useMemo(() => {
    if (!navigateNoQtyContext || noQtyAllowShopFloorContinue) return linesForWo;
    const soId = workOrders.find((w) => w.id === woId)?.salesOrderId ?? 0;
    return linesForWo.filter((l) => {
      const fl: FlatLine = { ...l, workOrderId: woId, salesOrderId: soId };
      return !isCarryForwardLine(fl, "NO_QTY");
    });
  }, [navigateNoQtyContext, noQtyAllowShopFloorContinue, linesForWo, workOrders, woId, isCarryForwardLine]);

  const applyLine = React.useCallback(
    (l: FlatLine) => {
      setWoId((prev) => (prev === l.workOrderId ? prev : l.workOrderId));
      setWolId((prev) => (prev === l.id ? prev : l.id));
      const rem = lineRemaining(l);
      resetProducedQtyField();
      const woRow = workOrders.find((w) => w.id === l.workOrderId);
      const embeddedType = String(
        woRow?.salesOrder?.orderType ?? soOrderTypeById[l.salesOrderId] ?? "",
      ).trim();
      if (embeddedType === "NO_QTY") setUserLockedFlowMode("NO_QTY");
      else if (embeddedType) setUserLockedFlowMode("REGULAR");
      void (async () => {
        const t = await ensureSoOrderType(l.salesOrderId);
        // Only refine the synchronous lock above when the async fetch resolved to a
        // concrete order type. An empty `t` (transient API failure / unknown SO) must
        // not silently clobber a correct NO_QTY lock back to REGULAR — that is what
        // hid the Next RS strip when Admin opened Production from the left menu.
        if (t === "NO_QTY") setUserLockedFlowMode("NO_QTY");
        else if (t) setUserLockedFlowMode("REGULAR");
        if (isCarryForwardLine(l, t) && !noQtyAllowShopFloorContinue) return;
        if (rem > 1e-9 && !producedQtyUserTouchedRef.current) {
          setProducedQtyStr(fmtProdQty(rem));
        }
      })();
    },
    [
      workOrders,
      soOrderTypeById,
      ensureSoOrderType,
      isCarryForwardLine,
      noQtyAllowShopFloorContinue,
      resetProducedQtyField,
      setProducedQtyStr,
    ],
  );

  useDependentFieldFocus({
    targetRef: producedQtyRef,
    enabled: Boolean(canProd && flatLines.length > 0 && wolId > 0),
    deps: [wolId],
  });

  const [rmReadiness, setRmReadiness] = React.useState<ProductionRmReadiness | null>(null);
  const [rmReadinessLoading, setRmReadinessLoading] = React.useState(false);
  const isNoQtyProductionFlow =
    fromNoQtySo || productionFlowMode === "NO_QTY" || navigateNoQtyContext;
  const showRegularRmReadiness = !isNoQtyProductionFlow && wolId > 0;
  const rmProductionEntryBlocked =
    showRegularRmReadiness && isRegularProductionEntryBlocked(rmReadiness, rmReadinessLoading);

  const selectedWoForLifecycle = React.useMemo(() => {
    const id = woId > 0 ? woId : selected?.workOrderId ?? 0;
    if (!(id > 0)) return null;
    return workOrders.find((w) => w.id === id) ?? null;
  }, [woId, selected?.workOrderId, workOrders]);

  const woProductionLifecycleBlocked =
    !isNoQtyProductionFlow &&
    selectedWoForLifecycle != null &&
    isWorkOrderProductionBlocked(selectedWoForLifecycle.status);
  const woProductionLifecycleMessage = selectedWoForLifecycle
    ? workOrderProductionBlockedMessage(selectedWoForLifecycle)
    : null;
  const selectedWoPaused = isWorkOrderPausedStatus(selectedWoForLifecycle?.status);
  const [resumeWoBusy, setResumeWoBusy] = React.useState(false);

  /** Active DRAFT on the selected WO line — REGULAR create form must not add a second batch. */
  const latestDraftForSelectedWoLine = React.useMemo(() => {
    if (!selected || !canProd || isNoQtyProductionFlow) return null;
    const lineId = selected.id;
    const draftsForLine = entries.filter(
      (e) => isDraft(e) && Number(e.workOrderLine?.id ?? 0) === lineId,
    );
    if (!draftsForLine.length) return null;
    const latest = draftsForLine
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const qty = Number(latest?.producedQty ?? 0);
    const producedQty = Number.isFinite(qty) ? qty : 0;
    return { latest, producedQty };
  }, [selected, canProd, entries, isNoQtyProductionFlow]);

  const regularCreateFormLockedByDraft = Boolean(latestDraftForSelectedWoLine);

  const selectedMetrics = React.useMemo(() => {
    if (!selected) return null;
    const approved = selected.approvedProducedQty ?? 0;
    // Production planning is scoped to the selected WO line, not the SO item total.
    const woLineQty = Number(selected.qty);
    const remaining = lineRemaining(selected);
    return {
      woLineQty: Number.isFinite(woLineQty) ? woLineQty : 0,
      usedQty: approved,
      remainingQty: remaining,
    };
  }, [selected]);

  const pausedWoQtyStrip = React.useMemo(() => {
    if (!selected || !selectedWoPaused || !selectedMetrics) return null;
    const lineEntries = entries.filter(
      (e) => Number(e.workOrderLine?.id ?? 0) === Number(selected.id) && isApproved(e),
    );
    const qcAcceptedQty = lineEntries.reduce((s, e) => s + Math.max(0, Number(e.qcAcceptedQty ?? 0)), 0);
    return {
      plannedQty: selectedMetrics.woLineQty,
      producedQty: selectedMetrics.usedQty,
      qcAcceptedQty,
      remainingProductionQty: selectedMetrics.remainingQty,
    };
  }, [selected, selectedWoPaused, selectedMetrics, entries]);

  const [pausedFgBalance, setPausedFgBalance] = React.useState<{ dispatchedQty: number; reservedFgQty: number } | null>(
    null,
  );
  React.useEffect(() => {
    if (!selectedWoPaused || !focusSoIdValid || !selected) {
      setPausedFgBalance(null);
      return;
    }
    let cancelled = false;
    void apiFetch<{ items?: Array<{ itemId: number; qcApprovedRemaining?: number; dispatchedQty?: number }> }>(
      `/api/production/sales-orders/${focusSoId}/fg-work-order-balance`,
    )
      .then((payload) => {
        if (cancelled) return;
        const row = (payload.items ?? []).find((x) => Number(x.itemId) === Number(selected.fgItemId));
        const reservedFgQty = Math.max(0, Number(row?.qcApprovedRemaining ?? 0));
        const dispatchedQty = Math.max(0, Number(row?.dispatchedQty ?? 0));
        setPausedFgBalance({ dispatchedQty, reservedFgQty });
      })
      .catch(() => {
        if (!cancelled) setPausedFgBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWoPaused, focusSoIdValid, focusSoId, selected?.fgItemId, selected?.id]);

  /** Matches RM readiness strip headline ("Production allowed now"). */
  const rmAllowedNowQty = React.useMemo(() => {
    if (!showRegularRmReadiness) return null;
    return resolveRegularRmAllowedNowQty(rmReadiness);
  }, [showRegularRmReadiness, rmReadiness]);

  /** Max qty for save/approve/clamp — same readiness payload, WO balance from API when present. */
  const rmEntryQtyCap = React.useMemo(() => {
    if (!showRegularRmReadiness || !selectedMetrics) return null;
    return resolveRegularRmEntryQtyCap(rmReadiness, {
      lineWoRemaining: selectedMetrics.remainingQty,
      excludeProductionQty: editing?.workOrderLine?.id === wolId ? Number(editing.producedQty) : undefined,
    });
  }, [showRegularRmReadiness, rmReadiness, selectedMetrics, editing, wolId]);

  const producedQtyWithinCaps = React.useMemo(() => {
    if (!producedQtyValid || producedQtyParsed == null) return false;
    if (selectedMetrics && producedQtyParsed > selectedMetrics.remainingQty + 1e-6) return false;
    if (
      showRegularRmReadiness &&
      rmEntryQtyCap != null &&
      !rmReadinessLoading &&
      producedQtyParsed > rmEntryQtyCap + 1e-6
    ) {
      return false;
    }
    return true;
  }, [
    producedQtyValid,
    producedQtyParsed,
    selectedMetrics,
    showRegularRmReadiness,
    rmEntryQtyCap,
    rmReadinessLoading,
  ]);

  const createFormCanSubmit = Boolean(
    wolId > 0 &&
      flatLines.some((l) => l.id === wolId) &&
      producedQtyValid &&
      producedQtyWithinCaps &&
      !rmProductionEntryBlocked &&
      !woProductionLifecycleBlocked &&
      !regularCreateFormLockedByDraft,
  );

  const onRmReadinessLoaded = React.useCallback((data: ProductionRmReadiness | null) => {
    setRmReadiness(data);
  }, []);

  const onRmReadinessLoadingChange = React.useCallback((loading: boolean) => {
    setRmReadinessLoading(loading);
  }, []);

  React.useEffect(() => {
    if (!showRegularRmReadiness) {
      setRmReadiness(null);
      setRmReadinessLoading(false);
      return;
    }
    setRmReadiness(null);
    setRmReadinessLoading(true);
  }, [showRegularRmReadiness, wolId]);

  const productionMaterialContext = React.useMemo(() => {
    if (!selected || !selectedMetrics) return undefined;
    const woRow = workOrders.find((w) => w.id === selected.workOrderId);
    return {
      flowLabel: "REGULAR FLOW",
      soLabel: displaySalesOrderNo(selected.salesOrderId, woRow?.salesOrder?.docNo ?? null),
      woLabel: displayWorkOrderNo(selected.workOrderId, woRow?.docNo ?? null),
      fgName: selected.fgItem.itemName,
      planned: selectedMetrics.woLineQty,
      produced: selectedMetrics.usedQty,
      remaining: selectedMetrics.remainingQty,
    };
  }, [selected, selectedMetrics, workOrders]);

  const showRegularProductionEntry =
    showRegularRmReadiness && !rmProductionEntryBlocked && !rmReadinessLoading;

  React.useEffect(() => {
    if (!regularCreateFormLockedByDraft) return;
    if (producedQtyStr.trim()) resetProducedQtyField();
  }, [regularCreateFormLockedByDraft, producedQtyStr, resetProducedQtyField]);

  const noQtyEntryContextLine = React.useMemo(() => {
    if (!selected || !selectedMetrics) return "";
    const woRow = workOrders.find((w) => w.id === selected.workOrderId);
    return formatNoQtyProductionEntryContextLine({
      cycleNo: noQtyCycleNoForDisplay,
      workOrderId: selected.workOrderId,
      woDocNo: woRow?.docNo ?? null,
      requirementSheetId: woRow?.requirementSheetId ?? null,
      itemName: selected.fgItem.itemName,
      remainingQty: selectedMetrics.remainingQty,
    });
  }, [selected, selectedMetrics, workOrders, noQtyCycleNoForDisplay]);

  /** SO rolling-cycle pointer advanced — WO is an allowed optional carry-forward production surface. */
  const showNoQtyOptionalPriorCycleStrip = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY" || focusSo?.currentCycleId == null) return false;
    const woRow = workOrders.find((w) => w.id === woId);
    if (!woRow) return false;
    const rawC = woRow.cycleId ?? (woRow as { cycle?: { id?: number } }).cycle?.id ?? null;
    const woCid = rawC != null ? Number(rawC) : NaN;
    if (!Number.isFinite(woCid) || woCid <= 0) return false;
    const ptr = Number(focusSo.currentCycleId);
    if (!Number.isFinite(ptr) || ptr <= 0) return false;
    return woCid !== ptr;
  }, [navigateNoQtyContext, focusSo?.currentCycleId, workOrders, woId]);

  React.useEffect(() => {
    if (productionFlowMode !== "NO_QTY" && !navigateNoQtyContext) {
      setNoQtyProductionQueue([]);
      return;
    }
    let cancelled = false;
    void apiFetch<DashboardProductionStatusSource[]>("/api/dashboard/production-queue")
      .then((data) => {
        if (!cancelled) setNoQtyProductionQueue(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setNoQtyProductionQueue([]);
      });
    return () => {
      cancelled = true;
    };
  }, [productionFlowMode, navigateNoQtyContext, liveTick]);

  const noQtyViewingPriorCycle = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return false;
    if (showNoQtyOptionalPriorCycleStrip) return true;
    const ptr =
      focusSo?.currentCycleId ?? noQtyFlowState?.canonicalCycleId ?? noQtyFlowState?.cycleId ?? null;
    const viewed = effectiveNoQtyCycleId;
    return (
      ptr != null &&
      viewed != null &&
      Number(viewed) > 0 &&
      Number(viewed) !== Number(ptr)
    );
  }, [
    productionFlowMode,
    showNoQtyOptionalPriorCycleStrip,
    focusSo?.currentCycleId,
    noQtyFlowState?.canonicalCycleId,
    noQtyFlowState?.cycleId,
    effectiveNoQtyCycleId,
  ]);

  const noQtyCycleDisplayStatus = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return null;
    const woIdForStatus = woId > 0 ? woId : selected?.workOrderId ?? 0;
    if (!(woIdForStatus > 0)) return null;
    const woRow =
      workOrders.find((w) => w.id === woIdForStatus) ??
      noQtyShortageHistoryWorkOrders.find((w) => w.id === woIdForStatus);
    if (woRow) {
      return resolveNoQtyCycleDisplayStatusForWorkOrder(
        {
          id: woRow.id,
          status: woRow.status ?? "IN_PROGRESS",
          salesOrderId: woRow.salesOrderId,
          cycleId: woRow.cycleId ?? woRow.cycle?.id ?? null,
          cycle: woRow.cycle,
          lines: woRow.lines,
        },
        noQtyProductionQueue,
        {
          isPriorCycle: noQtyViewingPriorCycle,
          scope: noQtyViewingPriorCycle ? "historical" : "auto",
        },
      );
    }
    if (!selected || !selectedMetrics) return null;
    return resolveNoQtyCycleDisplayStatus({
      workOrderId: woIdForStatus,
      workOrderNo: `WO-${woIdForStatus}`,
      itemName: selected.fgItem.itemName,
      requiredQty: selectedMetrics.woLineQty,
      producedQty: selectedMetrics.usedQty,
      balanceQty: selectedMetrics.remainingQty,
      orderType: "NO_QTY",
      salesOrderId: selected.salesOrderId,
      cycleId: effectiveNoQtyCycleId,
      cycleNo: noQtyCycleNoForDisplay,
      allQueueRows: noQtyProductionQueue,
      isPriorCycle: noQtyViewingPriorCycle,
      scope: noQtyViewingPriorCycle ? "historical" : "auto",
    });
  }, [
    productionFlowMode,
    woId,
    selected,
    selectedMetrics,
    workOrders,
    noQtyShortageHistoryWorkOrders,
    noQtyProductionQueue,
    noQtyViewingPriorCycle,
    effectiveNoQtyCycleId,
    noQtyCycleNoForDisplay,
  ]);

  const noQtyDisplayOperatorPendingQty = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return null;
    if (selectedMetrics) {
      const planned = Number(selectedMetrics.woLineQty ?? 0);
      const produced = Number(selectedMetrics.usedQty ?? 0);
      const pending = Math.max(0, planned - produced);
      if (pending > 1e-6) return pending;
    }
    const woIdFor = woId > 0 ? woId : selected?.workOrderId ?? 0;
    if (!(woIdFor > 0)) return null;
    const fromQueue = noQtyOperatorPendingQtyForWorkOrder(woIdFor, noQtyProductionQueue);
    return fromQueue > 1e-6 ? fromQueue : null;
  }, [productionFlowMode, woId, selected?.workOrderId, selectedMetrics, noQtyProductionQueue]);

  const noQtyErpAdjustedPlanningQty = React.useMemo(() => {
    if (productionFlowMode !== "NO_QTY") return null;
    const woIdFor = woId > 0 ? woId : selected?.workOrderId ?? 0;
    if (!(woIdFor > 0)) return null;
    const fromQueue = noQtyErpAdjustedPlanningQtyForWorkOrder(woIdFor, noQtyProductionQueue);
    return fromQueue > 1e-6 ? fromQueue : null;
  }, [productionFlowMode, woId, selected?.workOrderId, noQtyProductionQueue]);

  const visibleEntries = React.useMemo(() => {
    if (entryFilter === "ALL") return entries;
    if (entryFilter === "DRAFT") return entries.filter((e) => isDraft(e));
    return entries.filter((e) => isApproved(e));
  }, [entries, entryFilter]);

  const noQtyProductionStatusMsg = React.useMemo(() => {
    if (!navigateNoQtyContext || !focusSoIdValid) return "";
    // When opened from a No Qty SO, entries are already scoped by salesOrderId.
    // Never show "completed" when there are zero entries.
    if (!entries.length) return "No production started for this cycle";
    if (entries.some((e) => isDraft(e))) return "Production in progress";
    return "All production completed for this cycle";
  }, [navigateNoQtyContext, focusSoIdValid, entries]);

  const qcBannerSoId = React.useMemo(() => {
    const pending = entries.find((e) => qcPendingEntry(e));
    if (focusSoIdValid) return focusSoId;
    return pending?.workOrderLine.workOrder.salesOrderId ?? 0;
  }, [entries, focusSoId, focusSoIdValid]);

  const firstPendingProductionEntryId = React.useMemo(() => {
    const pending = entries.find((e) => qcPendingEntry(e));
    return pending?.id ?? 0;
  }, [entries]);

  const showQcNextBanner = React.useMemo(
    () => entries.some((e) => qcPendingEntry(e)) && qcBannerSoId > 0,
    [entries, qcBannerSoId],
  );

  /** REGULAR: QC next step is scoped to the selected WO line (not every pending batch on the SO). */
  const selectedLineQcPending = React.useMemo(() => {
    if (navigateNoQtyContext || !selected) return false;
    return entries.some(
      (e) => Number(e.workOrderLine?.id ?? 0) === Number(selected.id) && qcPendingEntry(e),
    );
  }, [navigateNoQtyContext, selected, entries]);

  const selectedLinePendingProductionId = React.useMemo(() => {
    if (!selected) return 0;
    const pending = entries.find(
      (e) => Number(e.workOrderLine?.id ?? 0) === Number(selected.id) && qcPendingEntry(e),
    );
    return pending?.id ?? 0;
  }, [selected, entries]);

  const regularQcBannerHref = React.useMemo(() => {
    if (!selected || !selectedLineQcPending) return "";
    const ot =
      String(soOrderTypeById[selected.salesOrderId] ?? "").trim() ||
      (fromNoQtySo && selected.salesOrderId === focusSoId ? "NO_QTY" : "NORMAL");
    return buildQcEntryHref({
      salesOrderId: selected.salesOrderId,
      productionId: selectedLinePendingProductionId > 0 ? selectedLinePendingProductionId : null,
      orderType: ot,
      fromStep: "production",
    });
  }, [
    selected,
    selectedLineQcPending,
    selectedLinePendingProductionId,
    soOrderTypeById,
    fromNoQtySo,
    focusSoId,
  ]);

  const productionStickyContext = React.useMemo(
    () =>
      resolveProductionStickyContext({
        selected: selected ?? null,
        woId,
        wolId,
        workOrders,
        entries: visibleEntries,
        focusSo,
      }),
    [selected, woId, wolId, workOrders, visibleEntries, focusSo],
  );

  const showQcCompletedStrip = React.useMemo(() => {
    if (navigateNoQtyContext) return false;
    if (!canProd) return false;
    if (!selected) return false;
    // Show "QC completed" only for the currently selected WO line (never previous cycles / other lines).
    const rows = entries.filter((e) => Number(e?.workOrderLine?.id ?? 0) === Number(selected.id));
    if (rows.length === 0) return false;
    if (!rows.some((e) => isApproved(e))) return false;
    return !rows.some((e) => qcPendingEntry(e));
  }, [navigateNoQtyContext, canProd, selected, entries]);

  const qcBannerHref = React.useMemo(() => {
    if (qcBannerSoId <= 0) return "";
    const ot =
      String(soOrderTypeById[qcBannerSoId] ?? "").trim() ||
      (fromNoQtySo && qcBannerSoId === focusSoId ? "NO_QTY" : "") ||
      (() => {
        const row = entries.find((e) => Number(e.workOrderLine?.workOrder?.salesOrderId ?? 0) === qcBannerSoId);
        return row ? prodEntryOrderTypeRaw(row) : "";
      })();
    return buildQcEntryHref({
      salesOrderId: qcBannerSoId,
      productionId: firstPendingProductionEntryId > 0 ? firstPendingProductionEntryId : null,
      cycleId: effectiveNoQtyCycleId,
      orderType: ot,
      fromStep: "production",
    });
  }, [
    qcBannerSoId,
    firstPendingProductionEntryId,
    effectiveNoQtyCycleId,
    soOrderTypeById,
    fromNoQtySo,
    focusSoId,
    entries,
  ]);

  /** Dedupe top “Go to QC” strip when NO_QTY Production card already guides next steps for the selected line. */
  const hideTopQcNextStrip =
    Boolean(showQcNextBanner && qcBannerHref) &&
    navigateNoQtyContext &&
    focusSoIdValid &&
    flatLines.length > 0 &&
    canProd &&
    Boolean(selected);

  /** One primary QC / dispatch CTA surface — suppress in-card duplicates when the top strip is shown. */
  const showRegularQcNextStrip = Boolean(
    !navigateNoQtyContext && selectedLineQcPending && regularQcBannerHref,
  );
  const showNoQtyQcNextStrip = Boolean(
    navigateNoQtyContext && showQcNextBanner && qcBannerHref && !hideTopQcNextStrip,
  );
  const showTopQcNextStrip = showRegularQcNextStrip || showNoQtyQcNextStrip;
  const suppressDuplicateQcWorkflowUi = showTopQcNextStrip;

  const displayHeaderMetrics = React.useMemo(
    () => resolveProductionStickyMetrics({ selectedMetrics, wolId, flatLines }),
    [selectedMetrics, wolId, flatLines],
  );

  const qcEntryHrefForEntry = React.useCallback(
    (r: ProdEntryRow) => {
      const soId = r.workOrderLine.workOrder.salesOrderId;
      const ot =
        prodEntryOrderTypeRaw(r) ||
        String(soOrderTypeById[soId] ?? "").trim() ||
        (fromNoQtySo && soId === focusSoId ? "NO_QTY" : "");
      return buildQcEntryHref({
        salesOrderId: soId,
        productionId: r.id,
        cycleId: effectiveNoQtyCycleId,
        orderType: ot,
        fromStep: "production",
      });
    },
    [effectiveNoQtyCycleId, soOrderTypeById, fromNoQtySo, focusSoId],
  );

  const productionWarnings = React.useMemo(() => {
    if (!selectedMetrics) return [];
    const w: string[] = [];
    if (!fromNoQtySo && selectedMetrics.remainingQty <= 0) w.push("No remaining quantity on this line.");
    if (
      producedQtyValid &&
      producedQtyParsed != null &&
      selectedMetrics.remainingQty > 0 &&
      producedQtyParsed > selectedMetrics.remainingQty
    ) {
      w.push("Entered quantity exceeds remaining capacity.");
    }
    if (
      !fromNoQtySo &&
      producedQtyValid &&
      producedQtyParsed != null &&
      rmEntryQtyCap != null &&
      !rmReadinessLoading &&
      producedQtyParsed > rmEntryQtyCap + 1e-6
    ) {
      const capLabel = rmAllowedNowQty != null ? rmAllowedNowQty : rmEntryQtyCap;
      w.push(`Entered quantity exceeds production allowed now (${fmtProdQty(capLabel ?? 0)}).`);
    }
    return w;
  }, [
    fromNoQtySo,
    selectedMetrics,
    producedQtyParsed,
    producedQtyValid,
    rmEntryQtyCap,
    rmAllowedNowQty,
    rmReadinessLoading,
  ]);

  async function refresh(): Promise<FlatLine[]> {
    const includeWorkOrderLineId = editing?.workOrderLine?.id ?? 0;
    const includeQs = includeWorkOrderLineId > 0 ? `&includeWorkOrderLineId=${includeWorkOrderLineId}` : "";
    /** When `salesOrderId` is in the URL, scope pending WOs to that SO (regular + NO_QTY). */
    const soScopeQs = focusSoIdValid ? `&salesOrderId=${focusSoId}` : "";
    const [w, e] = await Promise.all([
      apiFetch<WoRow[]>(`/api/production/work-orders?pendingOnly=1${includeQs}${soScopeQs}`),
      apiFetch<ProdEntryRow[]>(
        `/api/production/production-entries${
          navigateNoQtyContext && focusSoIdValid
            ? `?salesOrderId=${focusSoId}${
                effectiveNoQtyCycleId != null
                  ? `&cycleId=${encodeURIComponent(String(effectiveNoQtyCycleId))}`
                  : ""
              }`
            : ""
        }`,
      ),
    ]);
    setWorkOrders(w);
    setEntries(e);
    return w.flatMap((wo) =>
      wo.lines.map((l) => ({
        ...l,
        workOrderId: wo.id,
        salesOrderId: wo.salesOrderId,
      })),
    );
  }

  React.useEffect(() => {
    if (navigateNoQtyContext && focusSoIdValid && effectiveNoQtyCycleId != null) return;
    // NO_QTY deep-link: wait for cycle-scoped refresh so WO/line auto-pick does not run twice.
    if (focusSoIdValid && (fromNoQtySo || noQtyContinueProductionIntent) && cycleIdFromUrl != null) return;
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setInitialRefreshDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick]);

  // NO_QTY: once cycleId is known (flow API or URL), refetch entries scoped to that cycle.
  React.useEffect(() => {
    if (productionFlowMode !== "NO_QTY") return;
    if (!focusSoIdValid && noQtyWorkbenchSoId <= 0) return;
    if (effectiveNoQtyCycleId == null) return;
    refresh()
      .catch(() => {
        /* refresh sets its own error */
      })
      .finally(() => setInitialRefreshDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionFlowMode, focusSoIdValid, noQtyWorkbenchSoId, focusSoId, effectiveNoQtyCycleId, liveTick]);

  // When scoped to a confirmed NO_QTY SO, show a context-aware empty state if nothing is eligible.
  React.useEffect(() => {
    if (confirmedNoQtySoId <= 0) {
      setNoQtyEmptyMsg("");
      return;
    }
    if (!canProd) return;
    if (flatLines.length > 0) {
      setNoQtyEmptyMsg("");
      return;
    }
    apiFetch<{ reason: string; message: string }>(
      `/api/production/no-qty-so/${confirmedNoQtySoId}/production-context`,
    )
      .then((ctx) => setNoQtyEmptyMsg(ctx?.message ?? ""))
      .catch(() => setNoQtyEmptyMsg(""));
  }, [confirmedNoQtySoId, canProd, flatLines.length]);

  // Load SO header for NO_QTY guided production (URL may omit `source=no_qty_so` until order type is resolved).
  React.useEffect(() => {
    if (productionFlowMode !== "NO_QTY") {
      setFocusSo(null);
      return;
    }
    const soId = noQtyWorkbenchSoId > 0 ? noQtyWorkbenchSoId : focusSoIdValid ? focusSoId : 0;
    if (!(soId > 0)) {
      setFocusSo(null);
      return;
    }
    apiFetch<any>(`/api/sales-orders/${soId}`)
      .then((so) => {
        const customerName = so?.customer?.name ?? so?.po?.customer?.name ?? "—";
        const cycleNo =
          so?.orderType === "NO_QTY"
            ? null
            : so?.currentCycle?.cycleNo != null
              ? Number(so.currentCycle.cycleNo)
              : null;
        const currentCycleId = so?.currentCycle?.id != null ? Number(so.currentCycle.id) : null;
        const closed =
          String(so?.internalStatus ?? "") === "COMPLETED" ||
          String(so?.internalStatus ?? "") === "CLOSED" ||
          String(so?.processStage?.key ?? "") === "COMPLETED";
        setFocusSo({
          id: soId,
          customerName,
          docNo: so?.docNo ?? null,
          cycleNo,
          currentCycleId,
          cycleStatus: closed ? "Closed Cycle" : "Active Cycle",
        });
      })
      .catch(() =>
        setFocusSo({
          id: soId,
          customerName: "—",
          docNo: null,
          cycleNo: null,
          currentCycleId: null,
          cycleStatus: "Active Cycle",
        }),
      );
  }, [productionFlowMode, noQtyWorkbenchSoId, focusSoId, focusSoIdValid]);

  React.useEffect(() => {
    if (productionFlowMode !== "NONE") return;
    if (flowResolutionSoId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(soOrderTypeById, flowResolutionSoId)) return;
    void ensureSoOrderType(flowResolutionSoId);
  }, [productionFlowMode, flowResolutionSoId, soOrderTypeById, ensureSoOrderType]);

  // Keep UI consistent with backend eligibility filtering (especially NO_QTY cycle rules).
  // If previously selected WO is no longer present, clear selection and hide the entry form.
  React.useEffect(() => {
    if (woId !== 0 && !workOrders.some((w) => w.id === woId)) {
      clearWoLineSelection();
      setError(null);
    }
  }, [workOrders, woId, clearWoLineSelection]);

  React.useEffect(() => {
    if (wolId === 0) return;
    if (!flatLines.some((l) => l.id === wolId)) {
      clearWoLineSelection();
    }
  }, [flatLines, wolId, clearWoLineSelection]);

  React.useEffect(() => {
    if (!canProd || flatLines.length === 0 || wolId !== 0) return;
    if (productionFlowMode === "NONE") return;
    if (showProductionWorkspace) return;

    if (productionFlowMode === "NO_QTY") {
      if (!showNoQtyScopedProductionCard) return;
      if (noQtyQcPendingStable) {
        return;
      }
      if (noQtyNextRsReady && !noQtyAllowShopFloorContinue) {
        if (woId !== 0 || wolId !== 0) {
          clearWoLineSelection();
        }
        return;
      }
      if (noQtyContinueProductionIntent && !noQtyContinueAutoPickDoneRef.current) {
        const target = pickNoQtyContinueProductionLine();
        if (target) {
          noQtyContinueAutoPickDoneRef.current = true;
          applyLine(target);
          return;
        }
      }
      if (Number.isFinite(workOrderLineIdFromUrl) && workOrderLineIdFromUrl > 0) {
        const byUrl = flatLines.find((l) => l.id === workOrderLineIdFromUrl);
        if (byUrl) {
          applyLine(byUrl);
          return;
        }
      }
      if (noQtyAutoPickLines.length > 0) {
        applyLine(noQtyAutoPickLines[0]);
        return;
      }
      if (!noQtyContinueProductionIntent && (woId !== 0 || wolId !== 0)) {
        clearWoLineSelection();
      }
      return;
    }

    if (productionFlowMode !== "REGULAR") return;

    // Regular flow: default WO/line — URL woId, else latest WO (highest id), else best line globally.
    if (woIdFromUrlValid && workOrders.some((w) => w.id === woIdFromUrlPick)) {
      const forWo = sortFlatByPriority(flatLines.filter((l) => l.workOrderId === woIdFromUrlPick));
      if (forWo.length > 0) {
        applyLine(forWo[0]);
        return;
      }
    }
    if (workOrders.length > 0) {
      const latestWoId = Math.max(...workOrders.map((w) => w.id));
      const forLatest = sortFlatByPriority(flatLines.filter((l) => l.workOrderId === latestWoId));
      if (forLatest.length > 0) {
        applyLine(forLatest[0]);
        return;
      }
    }
    // Final fallback: pick first NON carry-forward line (so /production doesn't force old NO_QTY balance).
    let cancelled = false;
    void (async () => {
      const eps = 1e-6;
      const candidates = sortFlatByPriority(flatLines).filter((l) => lineRemaining(l) > eps);
      for (const l of candidates) {
        const t = await ensureSoOrderType(l.salesOrderId);
        if (cancelled) return;
        if (isCarryForwardLine(l, t)) continue;
        applyLine(l);
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    canProd,
    flatLines,
    wolId,
    applyLine,
    productionFlowMode,
    showNoQtyScopedProductionCard,
    focusSoIdValid,
    focusSoId,
    workOrders,
    woIdFromUrlValid,
    woIdFromUrlPick,
    resetProducedQty,
    noQtyAutoPickLines,
    noQtyNextRsReady,
    noQtyQcPendingStable,
    noQtyContinueProductionIntent,
    noQtyAllowShopFloorContinue,
    pickNoQtyContinueProductionLine,
    clearWoLineSelection,
    showProductionWorkspace,
    ensureSoOrderType,
    isCarryForwardLine,
    workOrderLineIdFromUrl,
  ]);

  React.useEffect(() => {
    if (productionFlowMode !== "NO_QTY" || !showNoQtyScopedProductionCard) return;
    if (noQtyContinueProductionIntent) return;
    if (noQtyManualContinue) setNoQtyManualContinue(false);
  }, [productionFlowMode, showNoQtyScopedProductionCard, wolId, noQtyContinueProductionIntent, noQtyManualContinue]);

  React.useEffect(() => {
    if (productionFlowMode !== "NO_QTY" || !showNoQtyScopedProductionCard) return;
    if (!noQtyNextRsReady || noQtyAllowShopFloorContinue) return;
    if (woId === 0 && wolId === 0) return;
    clearWoLineSelection();
  }, [
    productionFlowMode,
    showNoQtyScopedProductionCard,
    noQtyNextRsReady,
    noQtyAllowShopFloorContinue,
    woId,
    wolId,
    clearWoLineSelection,
  ]);

  React.useEffect(() => {
    const l = flatLines.find((x) => x.id === wolId);
    if (l) setWoId((prev) => (prev === l.workOrderId ? prev : l.workOrderId));
  }, [wolId, flatLines]);

  /** After QC completes on produced qty, WO remainder is carry-forward — drop selection so the entry form is not the default view. */
  React.useEffect(() => {
    if (productionFlowMode !== "NO_QTY" || !showNoQtyScopedProductionCard || noQtyAllowShopFloorContinue) return;
    const sel = flatLines.find((x) => x.id === wolId);
    if (!sel) return;
    if ((noQtyQcPendingByWolId.get(sel.id) ?? 0) > 1e-6) return;
    if (!isCarryForwardLine(sel, "NO_QTY")) return;
    clearWoLineSelection();
  }, [
    entries,
    flatLines,
    wolId,
    productionFlowMode,
    showNoQtyScopedProductionCard,
    noQtyAllowShopFloorContinue,
    isCarryForwardLine,
    noQtyQcPendingByWolId,
    clearWoLineSelection,
  ]);

  function advanceAfterSave(flat: FlatLine[], prevWolId: number) {
    const sorted = sortFlatByPriority(flat);
    if (sorted.length === 0) {
      clearWoLineSelection();
      return;
    }
    if (sorted.length === 1) {
      applyLine(sorted[0]);
      return;
    }
    const i = sorted.findIndex((l) => l.id === prevWolId);
    let next = sorted[0];
    if (i >= 0 && i < sorted.length - 1) next = sorted[i + 1];
    else if (i === sorted.length - 1) next = sorted[0];
    applyLine(next);
  }

  function openEdit(e: ProdEntryRow) {
    setEditing(e);
    setEditQty(Number(e.producedQty));
    setEditDate(toYmd(e.date));
  }

  async function onPost(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (regularCreateFormLockedByDraft) {
      setError(
        "A draft production batch already exists for this line. Edit, approve, or cancel it above before recording another batch.",
      );
      return;
    }
    if (!wolId || !flatLines.some((l) => l.id === wolId)) {
      setError("Select a work order line.");
      return;
    }
    if (!producedQtyValid || producedQtyParsed == null) {
      setError("Enter produced quantity.");
      return;
    }
    if (woProductionLifecycleBlocked && woProductionLifecycleMessage) {
      setError(woProductionLifecycleMessage);
      return;
    }
    if (rmProductionEntryBlocked) {
      setError(
        rmReadiness?.gate === "WAITING_STORE_ISSUE"
          ? "Production is blocked until Store issues material to the production location."
          : "Production is blocked until a material request is submitted and Store issues RM.",
      );
      return;
    }
    if (
      showRegularRmReadiness &&
      rmEntryQtyCap != null &&
      producedQtyParsed > rmEntryQtyCap + 1e-6
    ) {
      setError(
        `Production entry cannot exceed ${rmEntryQtyCap} based on issued RM at production location.`,
      );
      return;
    }
    const prevWol = wolId;
    setPosting(true);
    try {
      await apiFetch("/api/production/production-entries", {
        method: "POST",
        body: JSON.stringify({
          workOrderLineId: wolId,
          producedQty: producedQtyParsed,
          date: prodDate,
        }),
      });
      setEditing(null);
      resetProducedQtyField();
      const nextFlat = await refresh();
      // NO_QTY: do not auto-advance / push operators to complete production.
      // Keep the current selection stable; partial production is a valid state.
      if (!showNoQtyScopedProductionCard) {
        advanceAfterSave(nextFlat, prevWol);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setPosting(false);
    }
  }

  async function saveEditDraft() {
    if (!editing) return;
    setError(null);
    if (!isValidNumberDraft(editQty) || editQty <= 0) {
      setError("Produced qty is required.");
      return;
    }
    setEditSaving(true);
    try {
      await apiFetch(`/api/production/production-entries/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({ producedQty: editQty, date: editDate }),
      });
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update draft");
    } finally {
      setEditSaving(false);
    }
  }

  async function afterProductionApproveSuccess(
    _id: number,
    approvedRow: ProdEntryRow | undefined,
    consumptionWarnings?: string[],
  ) {
    setEditing(null);
    setNoQtyRmShortage(null);
    await refresh();
    const woIdNav = approvedRow ? Number(approvedRow.workOrderLine?.workOrder?.id ?? 0) : 0;
    if (navigateNoQtyContext && Number.isFinite(woIdNav) && woIdNav > 0) {
      const replaceParams = new URLSearchParams();
      replaceParams.set("workOrderId", String(woIdNav));
      replaceParams.set("source", "no_qty_so");
      if (focusSoIdValid) replaceParams.set("salesOrderId", String(focusSoId));
      else if (approvedRow?.workOrderLine?.workOrder?.salesOrderId) {
        replaceParams.set(
          "salesOrderId",
          String(approvedRow.workOrderLine.workOrder.salesOrderId),
        );
      }
      const cycleForReplace =
        effectiveNoQtyCycleId ?? approvedRow?.workOrderLine?.workOrder?.cycleId ?? null;
      if (cycleForReplace != null && Number(cycleForReplace) > 0) {
        replaceParams.set("cycleId", String(cycleForReplace));
      }
      const nextSearch = `?${replaceParams.toString()}`;
      if (location.search !== nextSearch) {
        navigate(`/production${nextSearch}`, { replace: true });
      }
    }
    if (consumptionWarnings?.length) {
      toast.showSuccess(`Production approved. ${consumptionWarnings.join(" ")}`);
    } else if (navigateNoQtyContext && focusSoIdValid) {
      toast.showSuccess("Production approved.");
    } else if (!navigateNoQtyContext) {
      toast.showSuccess("Production approved.");
    }
  }

  async function approveDraftNoQty(id: number) {
    if (!window.confirm("Approve this batch? Raw material stock will be issued and the batch will move to QC.")) {
      return;
    }
    setError(null);
    setNoQtyRmShortage(null);
    setRowBusy(id);
    const approvedRow = entries.find((e) => e.id === id);
    try {
      await apiFetch(`/api/production/production-entries/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await afterProductionApproveSuccess(id, approvedRow);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "INSUFFICIENT_RM_FOR_NO_QTY_PRODUCTION" && err.body) {
        setNoQtyRmShortage(err.body as NoQtyRmShortagePayload);
        setError(null);
      } else {
        setNoQtyRmShortage(null);
        const msg = err instanceof Error ? err.message : "Approve failed";
        setError(msg);
        toast.showError(msg);
      }
    } finally {
      setRowBusy(null);
    }
  }

  const closeConsumptionApproveModal = React.useCallback(() => {
    setConsumptionApproveId((openId) => {
      if (openId != null) {
        setRowBusy((busy) => (busy === openId ? null : busy));
      }
      return null;
    });
  }, []);

  const onConsumptionPreviewSettled = React.useCallback(() => {
    setRowBusy(null);
  }, []);

  function approveDraft(id: number) {
    const row = entries.find((e) => e.id === id);
    if (entryUsesRmConsumptionReview(row)) {
      setRowBusy(id);
      setConsumptionApproveId(id);
      return;
    }
    void approveDraftNoQty(id);
  }

  function renderApproveButtonLabel(entryId: number, idleLabel: string, compact?: boolean) {
    if (rowBusy !== entryId) return idleLabel;
    return (
      <span className="inline-flex items-center gap-1">
        <span
          className={cn(
            "inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2",
            compact ? "border-slate-300 border-t-slate-700" : "border-white/40 border-t-white",
          )}
          aria-hidden
        />
        Opening…
      </span>
    );
  }

  function openReverseModal(entry: ProdEntryRow) {
    if (!canOfferProductionReverse(entry, isAdmin)) return;
    const safe = reversibleProductionQty(entry);
    setReverseModalEntry(entry);
    setReverseQtyDraft(fmtProdQty(safe));
    setReverseReasonDraft("");
    setReverseModalError(null);
  }

  function closeReverseModal() {
    setReverseModalEntry(null);
    setReverseQtyDraft("");
    setReverseReasonDraft("");
    setReverseModalError(null);
  }

  function reverseModalFillFull() {
    if (!reverseModalEntry) return;
    const pq = Number(reverseModalEntry.producedQty);
    setReverseQtyDraft(fmtProdQty(Number.isFinite(pq) ? pq : 0));
    setReverseModalError(null);
  }

  async function confirmReverseModal() {
    if (!reverseModalEntry || !isAdmin) return;
    if (!canOfferProductionReverse(reverseModalEntry, isAdmin)) {
      setReverseModalError("This entry cannot be reversed from Production (QC already completed or not reversible).");
      return;
    }
    const id = reverseModalEntry.id;
    const EPS = 1e-6;
    const raw = reverseQtyDraft.trim().replace(/,/g, "");
    const rq = Number(raw);
    if (!Number.isFinite(rq) || rq <= EPS) {
      setReverseModalError("Reverse qty must be greater than zero.");
      return;
    }
    const available = reversibleProductionQty(reverseModalEntry);
    if (rq > available + EPS) {
      setReverseModalError(`Reverse qty cannot exceed available qty (${fmtProdQty(available)}).`);
      return;
    }
    if (rq < available - EPS) {
      setReverseModalError(
        "Partial reversal is not supported for production entries yet. Enter the full produced quantity or use Reverse Full.",
      );
      return;
    }
    const reason = reverseReasonDraft.trim();
    if (!reason) {
      setReverseModalError("Reason is required.");
      return;
    }
    setReverseModalError(null);
    setError(null);
    setRowBusy(id);
    try {
      await apiFetch(`/api/production/production-entries/${id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      closeReverseModal();
      if (editing?.id === id) setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reverse failed");
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteDraft(id: number) {
    if (!window.confirm("Delete this draft production batch?")) return;
    setError(null);
    setRowBusy(id);
    try {
      await apiFetch(`/api/production/production-entries/${id}`, { method: "DELETE" });
      if (editing?.id === id) setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setRowBusy(null);
    }
  }

  const prodWoBind = shortcutHints.bindField("prodWo", {
    onChange: (e) => {
      const v = (e.target as HTMLSelectElement).value;
      const id = v === "" ? 0 : Number(v);
      setWoId(id);
      const wo = workOrders.find((w) => w.id === id);
      const first = wo?.lines[0];
      if (first && wo) {
        const fl: FlatLine = {
          ...first,
          workOrderId: id,
          salesOrderId: wo.salesOrderId,
        };
        applyLine(fl);
      } else {
        setWolId(0);
        resetProducedQtyField();
      }
    },
  });

  const prodLineBind = shortcutHints.bindField("prodLine", {
    onChange: (e) => {
      const v = (e.target as HTMLSelectElement).value;
      const id = v === "" ? 0 : Number(v);
      const line = linesForWo.find((l) => l.id === id);
      const wo = workOrders.find((w) => w.id === woId);
      if (line && wo) {
        applyLine({ ...line, workOrderId: wo.id, salesOrderId: wo.salesOrderId });
      } else {
        setWolId(0);
        resetProducedQtyField();
      }
    },
  });

  const prodQtyBind = shortcutHints.bindField("prodQty", {
    onChange: (e) => onProducedQtyInputChange((e.target as HTMLInputElement).value),
  });

  const prodSaveFocusBind = shortcutHints.bindField("prodSave");

  const shortcutFlagsRef = React.useRef({ canSubmit: false });
  shortcutFlagsRef.current = { canSubmit: createFormCanSubmit && !editing && canProd };
  const markShortcutRef = React.useRef(shortcutHints.markFieldShortcutUsed);
  markShortcutRef.current = shortcutHints.markFieldShortcutUsed;

  React.useEffect(() => {
    function onGlobalKey(ev: KeyboardEvent) {
      if (ev.defaultPrevented) return;

      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "Digit1") {
        ev.preventDefault();
        markShortcutRef.current("prodWo");
        woSelectRef.current?.focus();
        return;
      }
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "Digit2") {
        ev.preventDefault();
        markShortcutRef.current("prodLine");
        lineSelectRef.current?.focus();
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyS") {
        ev.preventDefault();
        if (shortcutFlagsRef.current.canSubmit) {
          markShortcutRef.current("prodSave");
          createFormRef.current?.requestSubmit();
        }
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        if (shortcutFlagsRef.current.canSubmit) {
          markShortcutRef.current("prodSave");
          createFormRef.current?.requestSubmit();
        }
        return;
      }

      if (ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        setError((cur) => (cur ? null : cur));
      }
    }
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, []);

  const placeDraftInNoQtyPrimaryCard =
    showNoQtyScopedProductionCard && flatLines.length > 0 && canProd;
  const placeDraftAfterRegularProductionCard =
    !fromNoQtySo && flatLines.length > 0 && canProd;

  /** Latest DRAFT batch on the currently selected WO — drives top approval strip + avoids duplicate actions in the ledger row. */
  const latestDraftForSelectedWo = React.useMemo(() => {
    if (!selected || !canProd) return null;
    const woIdNum = Number(selected.workOrderId);
    if (!Number.isFinite(woIdNum) || woIdNum <= 0) return null;
    const draftsForWo = (visibleEntries || []).filter(
      (e) => isDraft(e) && Number(e?.workOrderLine?.workOrder?.id ?? 0) === woIdNum,
    );
    if (!draftsForWo.length) return null;
    const latest = draftsForWo
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const qty = Number(latest?.producedQty ?? 0);
    const producedQty = Number.isFinite(qty) ? qty : 0;
    return { latest, producedQty };
  }, [selected, canProd, visibleEntries]);

  /** Regular flow: draft on selected line blocks RM Ready and duplicate workflow surfaces. */
  const draftApprovalPendingRegular =
    !navigateNoQtyContext && Boolean(latestDraftForSelectedWoLine && selected);

  /** One primary next-action strip per screen state (NO_QTY + regular). */
  const productionPrimaryStrip = React.useMemo((): {
    variant: "action" | "success" | "info" | "blocked";
    title: string;
    subtitle?: string;
    primaryAction?: { label: string; onClick: () => void; testId?: string };
  } | null => {
    if (draftApprovalPendingRegular && latestDraftForSelectedWoLine) {
      return {
        variant: "action",
        title: "Draft Production Entry Awaiting Approval",
        subtitle: `Qty ${fmtProdQty(latestDraftForSelectedWoLine.producedQty)} · Approve, edit, or cancel from the entries table below`,
        primaryAction: {
          label: "Approve Draft",
          testId: "next-approve-production-draft",
          onClick: () => approveDraft(latestDraftForSelectedWoLine.latest.id),
        },
      };
    }
    if (!navigateNoQtyContext && showRegularRmReadiness && rmReadiness && rmProductionEntryBlocked) {
      const step = buildRmIssueNextStep(rmReadiness, "production-workspace");
      return {
        variant: "blocked",
        title: step.statusTitle,
        subtitle: step.blockingReason
          ? `${step.statusSubtitle ?? ""} · ${step.blockingReason}`
          : step.statusSubtitle,
        primaryAction: {
          label: step.primaryAction.label,
          testId: step.primaryAction.testId,
          onClick: () => {
            if (step.primaryAction.href) navigate(step.primaryAction.href);
          },
        },
      };
    }
    if (!navigateNoQtyContext && woProductionLifecycleBlocked && woProductionLifecycleMessage) {
      const paused = isWorkOrderPausedStatus(selectedWoForLifecycle?.status);
      const hold = !paused && String(selectedWoForLifecycle?.status ?? "").toUpperCase() === "HOLD";
      return {
        variant: "info",
        title: paused
          ? "Work Order paused"
          : hold
            ? workOrderStatusDisplayLabel({
                status: selectedWoForLifecycle?.status ?? "HOLD",
                holdReason: selectedWoForLifecycle?.holdReason,
              })
            : "Production blocked",
        subtitle: woProductionLifecycleMessage,
        primaryAction: paused
          ? {
              label: resumeWoBusy ? "Resuming…" : "Resume Production",
              testId: "next-resume-production",
              onClick: () => {
                const id = selectedWoForLifecycle?.id ?? 0;
                if (!(id > 0) || resumeWoBusy) return;
                setResumeWoBusy(true);
                void resumeWorkOrderApi(id)
                  .then(() => refresh())
                  .catch((e) => setError(e instanceof Error ? e.message : "Resume failed"))
                  .finally(() => setResumeWoBusy(false));
              },
            }
          : hold
            ? {
                label: "Open work order",
                onClick: () =>
                  navigate(
                    `/work-orders?excludeWo=${selectedWoForLifecycle?.id ?? 0}&so=${selectedWoForLifecycle?.salesOrderId ?? selected?.salesOrderId ?? 0}`,
                  ),
              }
            : undefined,
      };
    }
    if (showTopQcNextStrip) {
      const qcHref = navigateNoQtyContext ? qcBannerHref : regularQcBannerHref;
      if (qcHref) {
        if (!navigateNoQtyContext) {
          const qaSoId = selected?.salesOrderId ?? qcBannerSoId;
          const step = buildCompleteQaNextStep(
            qaSoId,
            selectedLinePendingProductionId > 0 ? selectedLinePendingProductionId : null,
          );
          return {
            variant: "action",
            title: step.statusTitle,
            subtitle: step.statusSubtitle,
            primaryAction: {
              label: step.primaryAction.label,
              testId: step.primaryAction.testId,
              onClick: () => navigate(qcHref),
            },
          };
        }
        return {
          variant: "action",
          title: navigateNoQtyContext ? PRODUCTION_QA_TERMS.QA_PENDING_STRIP : PRODUCTION_QA_TERMS.NEXT_STEP_COMPLETE_QA,
          subtitle: navigateNoQtyContext
            ? "Production is approved."
            : PRODUCTION_QA_TERMS.NEXT_STEP_COMPLETE_QA_NO_QTY,
          primaryAction: {
            label: PRODUCTION_QA_TERMS.COMPLETE_QA,
            onClick: () => navigate(qcHref),
          },
        };
      }
    }
    if (navigateNoQtyContext && showNoQtyScopedProductionCard) {
      if (
        roleUi.showPlanningWorkflowActions &&
        canCreateNextRs &&
        noQtyNextRsReady &&
        noQtyFlowState?.primaryActionForCurrentUser === "CREATE_NEXT_RS"
      ) {
        return {
          variant: "action",
          title: "Next RS",
          subtitle: noQtyFlowState?.workflowSummary ?? "Create the next requirement sheet.",
          primaryAction: {
            label: "Next RS",
            onClick: () =>
              prepareNoQtyNextRequirementSheetAndNavigate({
                salesOrderId: focusSoId,
                navigate,
                toast,
                navigateState: { from: "production_screen" },
              }),
          },
        };
      }
      if (
        roleUi.showPlanningWorkflowActions &&
        noQtyNextRsReady &&
        noQtyFlowState?.primaryActionForCurrentUser !== "CREATE_NEXT_RS"
      ) {
        return {
          variant: "success",
          title: "Cycle ready for Next RS",
          subtitle:
            noQtyCarryForwardQtyFromEngine > 1e-6
              ? `Includes previous cycle shortage (${fmtProdQty(noQtyCarryForwardQtyFromEngine)}).`
              : noQtyFlowState?.message ?? "Waiting for Sales to create Next RS.",
        };
      }
      if (
        roleUi.showProductionDispatchHandoff &&
        noQtyFlowState?.primaryActionForCurrentUser === "DISPATCH" &&
        noQtyFlowState?.nextAction === "DISPATCH" &&
        !entries.some((e) => qcPendingEntry(e))
      ) {
        return {
          variant: "action",
          title: "Dispatch ready",
          subtitle: "Ship QC-passed quantity when stock is available.",
          primaryAction: {
            label: "Go to Dispatch",
            onClick: () =>
              navigate(
                buildNoQtyGuidedHref({
                  to: "/dispatch",
                  salesOrderId: focusSoId,
                  cycleId: effectiveNoQtyCycleId ?? null,
                  fromStep: "production",
                }),
              ),
          },
        };
      }
      if (
        selectedMetrics &&
        selectedMetrics.remainingQty > 1e-6 &&
        canProd &&
        flatLines.length > 0 &&
        !latestDraftForSelectedWo &&
        (!noQtyNextRsReady ||
          noQtyFlowState?.roleAllowedOptionalActions?.includes("PRODUCTION") ||
          noQtyFlowState?.optionalActions?.includes("PRODUCTION"))
      ) {
        return {
          variant: "info",
          title: "Continue production",
          subtitle: `Unresolved qty: ${fmtProdQty(selectedMetrics.remainingQty)}.`,
          primaryAction: {
            label: "Continue Production",
            onClick: () => {
              document.getElementById("regular-production-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
              window.setTimeout(() => producedQtyRef.current?.focus(), 120);
            },
          },
        };
      }
      return null;
    }
    if (!showQcNextBanner && showQcCompletedStrip && selected) {
      return {
        variant: "success",
        title: "Next Step: Review or continue downstream",
        subtitle: PRODUCTION_QA_TERMS.CLEARED_QA_SUBTITLE,
        primaryAction: {
          label: PRODUCTION_QA_TERMS.VIEW_QA_ENTRIES,
          onClick: () =>
            navigate(
              buildQcEntryHref({
                salesOrderId: selected.salesOrderId,
                productionId: null,
                orderType: String(soOrderTypeById[selected.salesOrderId] ?? "").trim() || "NORMAL",
                fromStep: "production",
              }),
            ),
        },
      };
    }
    if (
      showRegularRmReadiness &&
      rmReadiness &&
      rmReadiness.rmLines.some((ln) => (ln.returnableQty ?? 0) > 0)
    ) {
      return {
        variant: "info",
        title: "Unused RM at production",
        subtitle: "Return surplus RM to store (MRN). Does not reverse production consumption.",
        primaryAction: {
          label: "Return unused RM",
          onClick: () =>
            navigate(
              `/production/rm-returns?workOrderId=${rmReadiness.workOrderId}${
                rmReadiness.latestPmrId ? `&pmrId=${rmReadiness.latestPmrId}` : ""
              }`,
            ),
        },
      };
    }
    if (
      !navigateNoQtyContext &&
      showRegularRmReadiness &&
      rmReadiness &&
      !rmProductionEntryBlocked &&
      !regularCreateFormLockedByDraft &&
      !woProductionLifecycleBlocked &&
      selectedMetrics &&
      selectedMetrics.remainingQty > 1e-6 &&
      canProd &&
      flatLines.length > 0
    ) {
      const step = buildRmReadyProductionNextStep(selected!.workOrderId, wolId);
      return {
        variant: "action",
        title: step.statusTitle,
        subtitle: step.statusSubtitle,
        primaryAction: {
          label: step.primaryAction.label,
          testId: step.primaryAction.testId,
          onClick: () => {
            document.getElementById("regular-production-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
            window.setTimeout(() => producedQtyRef.current?.focus(), 120);
          },
        },
      };
    }
    if (
      selectedMetrics &&
      selectedMetrics.remainingQty > 1e-6 &&
      canProd &&
      flatLines.length > 0 &&
      !latestDraftForSelectedWo &&
      !regularCreateFormLockedByDraft &&
      !rmProductionEntryBlocked &&
      !woProductionLifecycleBlocked
    ) {
      const rmCap =
        showRegularRmReadiness && rmReadiness
          ? fmtProdQty(rmReadiness.productionAllowedNowQty)
          : null;
      return {
        variant: "info",
        title: "Next Step: Record production",
        subtitle:
          rmCap != null
            ? `Production allowed now: ${rmCap} ${rmReadiness?.fgUnit || ""}. WO balance: ${fmtProdQty(selectedMetrics.remainingQty)}.`
            : `Remaining production pending: ${fmtProdQty(selectedMetrics.remainingQty)}`,
        primaryAction: {
          label: "Continue production",
          onClick: () => {
            document.getElementById("regular-production-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
            window.setTimeout(() => producedQtyRef.current?.focus(), 120);
          },
        },
      };
    }
    return null;
  }, [
    showTopQcNextStrip,
    qcBannerHref,
    regularQcBannerHref,
    qcBannerSoId,
    selectedLinePendingProductionId,
    selectedLineQcPending,
    firstPendingProductionEntryId,
    navigateNoQtyContext,
    showNoQtyScopedProductionCard,
    roleUi.showPlanningWorkflowActions,
    roleUi.showProductionDispatchHandoff,
    canCreateNextRs,
    noQtyNextRsReady,
    noQtyFlowState,
    noQtyCarryForwardQtyFromEngine,
    entries,
    selectedMetrics,
    canProd,
    flatLines.length,
    latestDraftForSelectedWo,
    latestDraftForSelectedWoLine,
    regularCreateFormLockedByDraft,
    draftApprovalPendingRegular,
    showQcNextBanner,
    showQcCompletedStrip,
    selected,
    focusSoId,
    effectiveNoQtyCycleId,
    navigate,
    toast,
    soOrderTypeById,
    showRegularRmReadiness,
    rmReadiness,
    rmProductionEntryBlocked,
    woProductionLifecycleBlocked,
    woProductionLifecycleMessage,
    selectedWoForLifecycle,
    resumeWoBusy,
  ]);

  const productionPrimaryStripCoversDraft = draftApprovalPendingRegular;
  const productionPrimaryStripCoversRmIssue = productionPrimaryStrip?.title === "Waiting for RM Issue";
  const productionPrimaryStripCoversRmReady = productionPrimaryStrip?.title === "RM Ready – Enter Production";
  const productionPrimaryStripCoversPause = productionPrimaryStrip?.title === "Work Order paused";
  const productionPrimaryStripCoversMaterialCard =
    productionPrimaryStripCoversDraft ||
    productionPrimaryStripCoversRmIssue ||
    productionPrimaryStripCoversRmReady ||
    productionPrimaryStrip?.title === "Unused RM at production";

  /**
   * Parallel "Create Next RS" strip for NO_QTY production screen.
   *
   * Renders independently of {@link productionPrimaryStrip}: NO_QTY rolling planning is
   * parallel to shop-floor work. When QC is pending and Next RS is eligible, ADMIN/SALES
   * see both "Go to QC" (primary) AND "Create Next RS" (this strip). De-duplicates when
   * the primary strip is already the Next RS action.
   *
   * SO id resolution does **not** require `?source=no_qty_so` in the URL — when Admin opens
   * Production from the left menu and selects a NO_QTY work order line, the workbench SO id
   * is derived from `noQtyWorkbenchSoId` / `noQtyFlowSoId`. This is the same identity the
   * `noQtyFlowState` hook uses, so eligibility, action, and CTA all act on the same SO.
   *
   * Visibility: ADMIN + SALES only ({@link useCanCreateNextRs}); NO_QTY context with
   * `createNextRsEligible` and no existing later RS. Other roles never see this strip.
   */
  const productionNextRsParallelStrip = React.useMemo((): {
    subtitle: string;
    onClick: () => void;
  } | null => {
    if (!navigateNoQtyContext) return null;
    if (!roleUi.showPlanningWorkflowActions || !canCreateNextRs) return null;
    if (!noQtyFlowState?.createNextRsEligible) return null;
    if (noQtyFlowState?.nextRsAlreadyCreatedDocNo) return null;
    const targetSoId =
      noQtyWorkbenchSoId > 0
        ? noQtyWorkbenchSoId
        : noQtyFlowSoId != null && noQtyFlowSoId > 0
          ? noQtyFlowSoId
          : 0;
    if (targetSoId <= 0) return null;
    if (
      productionPrimaryStrip?.title === "Next RS" ||
      productionPrimaryStrip?.title === "Cycle ready for Next RS"
    ) {
      return null;
    }
    const subtitle = noQtyFlowState.qcPendingForCycle
      ? "Planning runs in parallel — start the next requirement sheet while QC clears this cycle."
      : "Planning runs in parallel — start the next requirement sheet now.";
    return {
      subtitle,
      onClick: () =>
        prepareNoQtyNextRequirementSheetAndNavigate({
          salesOrderId: targetSoId,
          navigate,
          toast,
          navigateState: { from: "production_screen" },
        }),
    };
  }, [
    navigateNoQtyContext,
    roleUi.showPlanningWorkflowActions,
    canCreateNextRs,
    noQtyFlowState,
    productionPrimaryStrip,
    noQtyWorkbenchSoId,
    noQtyFlowSoId,
    navigate,
    toast,
  ]);

  const renderDraftProductionBanner = (opts?: { compact?: boolean }) => {
    if (!latestDraftForSelectedWo) return null;
    const { latest, producedQty } = latestDraftForSelectedWo;

    const soDoc = selected!.salesOrderId === focusSoId ? focusSo?.docNo : undefined;
    const woRow = workOrders.find((x) => x.id === selected!.workOrderId);
    const contextStrip =
      navigateNoQtyContext && woRow
        ? formatNoQtyProductionContextLabel({
            soId: selected!.salesOrderId,
            soDoc,
            cycleNo: woRow.cycle?.cycleNo ?? null,
            itemName: selected!.fgItem.itemName,
          })
        : [
            `WO #${selected!.workOrderId}`,
            displaySalesOrderNo(selected!.salesOrderId, soDoc),
            woRow?.cycle?.cycleNo != null && Number.isFinite(Number(woRow.cycle.cycleNo))
              ? `Cycle ${Number(woRow.cycle.cycleNo)}`
              : null,
            `Item: ${selected!.fgItem.itemName}`,
          ]
            .filter((x) => x != null && String(x).trim() !== "")
            .join(" | ");

    const compact = opts?.compact ?? false;

    const actions = (
      <div className="erp-workflow-actions shrink-0">
        <Button
          type="button"
          size="sm"
          variant="default"
          className={compact ? "h-8 px-3 text-[11px] font-semibold shadow-sm" : "h-9 px-3 text-xs font-semibold shadow-sm"}
          disabled={rowBusy === latest.id}
          onClick={() => approveDraft(latest.id)}
        >
          {renderApproveButtonLabel(latest.id, "Approve")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={compact ? "h-8 px-2.5 text-[11px]" : "h-9 px-3 text-xs"}
          disabled={rowBusy === latest.id}
          onClick={() => openEdit(latest)}
        >
          Edit
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            compact ? "h-8 px-2.5 text-[11px]" : "h-9 px-3 text-xs",
            "border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800",
          )}
          disabled={rowBusy === latest.id}
          onClick={() => deleteDraft(latest.id)}
        >
          Cancel
        </Button>
      </div>
    );

    if (compact) {
      if (!navigateNoQtyContext) {
        const soDocInner = selected!.salesOrderId === focusSoId ? focusSo?.docNo : undefined;
        return (
          <div
            className="sticky top-0 z-30 rounded-md border border-amber-400/90 bg-gradient-to-r from-amber-50 to-amber-50/80 px-2 py-1.5 text-[11px] text-amber-950 shadow-md ring-1 ring-amber-300/60 backdrop-blur-[2px]"
            data-testid="draft-production-ready-banner"
          >
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="font-mono text-[11px] font-bold tabular-nums text-slate-900">
                    WO #{selected!.workOrderId}
                    <span className="mx-1 font-normal text-slate-400">·</span>
                    {displaySalesOrderNo(selected!.salesOrderId, soDocInner)}
                  </div>
                  <div className="truncate text-[11px] font-medium text-slate-800" title={selected!.fgItem.itemName}>
                    {selected!.fgItem.itemName}
                  </div>
                  <div className="text-[10px] text-amber-900/95">
                    Draft qty{" "}
                    <span className="font-semibold tabular-nums text-amber-950">{fmtProdQty(producedQty)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 justify-center">
                  <span className="rounded border border-amber-300 bg-white/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
                    Draft · approval required
                  </span>
                </div>
                <div className="min-w-0 sm:text-right">{actions}</div>
              </div>
            </div>
          </div>
        );
      }
      return (
        <div
          className="rounded-md border border-amber-400/85 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950 shadow-sm"
          data-testid="draft-production-ready-banner"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-950">Draft · approve</div>
              <p className="mt-0.5 truncate text-[11px] font-medium text-violet-950/95" title={contextStrip}>
                {contextStrip}
              </p>
              <div className="mt-0.5 text-[11px] text-amber-900">
                Produced Qty: <span className="font-semibold tabular-nums">{fmtProdQty(producedQty)}</span>
              </div>
            </div>
            {actions}
          </div>
        </div>
      );
    }

    return (
      <div
        className="rounded-lg border-2 border-amber-400/85 bg-gradient-to-br from-amber-50 via-amber-50/95 to-white px-3 py-3 text-[12px] text-amber-950 shadow-sm ring-1 ring-amber-200/70"
        data-testid="draft-production-ready-banner"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold tracking-tight text-amber-950">Draft · approve</div>
            <p className="mt-1 truncate text-[12px] font-medium text-slate-900/90" title={contextStrip}>
              {contextStrip}
            </p>
            <div className="mt-1 text-[12px] text-amber-900/90">
              Produced qty: <span className="font-bold tabular-nums text-amber-950">{fmtProdQty(producedQty)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actions}
          </div>
        </div>
      </div>
    );
  };

  /** Top strip owns draft approval — hide duplicate Approve/Edit/Cancel on ledger rows. */
  const showCompactDraftApprovalStrip = React.useMemo(() => {
    if (draftApprovalPendingRegular) return true;
    if (!latestDraftForSelectedWo || !selected || !(flatLines.length > 0) || !canProd) return false;
    return (
      placeDraftInNoQtyPrimaryCard ||
      placeDraftAfterRegularProductionCard ||
      (Boolean(fromNoQtySo) && !showNoQtyScopedProductionCard)
    );
  }, [
    draftApprovalPendingRegular,
    latestDraftForSelectedWo,
    selected,
    flatLines.length,
    canProd,
    placeDraftInNoQtyPrimaryCard,
    placeDraftAfterRegularProductionCard,
    fromNoQtySo,
    showNoQtyScopedProductionCard,
  ]);

  const openedFromWorkOrderWorkspace = fromParam.trim().toLowerCase() === "work-order-workspace";

  const productionRegularBackNav = React.useMemo(() => {
    const sid =
      selected && Number(selected.salesOrderId) > 0
        ? Number(selected.salesOrderId)
        : focusSoIdValid
          ? focusSoId
          : 0;
    const back = resolveProductionRegularBack({ fromParam, sourceParam: source, salesOrderId: sid });
    if (openedFromWorkOrderWorkspace) return back;
    if (navigateNoQtyContext) return null;
    return back;
  }, [
    navigateNoQtyContext,
    openedFromWorkOrderWorkspace,
    selected?.salesOrderId,
    focusSoIdValid,
    focusSoId,
    fromParam,
    source,
  ]);

  /** REGULAR render branch only: NO_QTY WOs can appear here when URL omits `source=no_qty_so` — align chrome with SO/WO type. */
  const activeWoForRegularShell = React.useMemo(() => {
    if (woId > 0) return workOrders.find((w) => w.id === woId) ?? null;
    if (selected && selected.workOrderId > 0) return workOrders.find((w) => w.id === selected.workOrderId) ?? null;
    return null;
  }, [woId, selected, workOrders]);

  const regularShellOrderType = React.useMemo(() => {
    const sid =
      selected && selected.salesOrderId > 0
        ? selected.salesOrderId
        : activeWoForRegularShell && activeWoForRegularShell.salesOrderId > 0
          ? activeWoForRegularShell.salesOrderId
          : 0;
    if (sid > 0) {
      const fromMap = String(soOrderTypeById[sid] ?? "").trim();
      if (fromMap) return fromMap;
    }
    const fromWoSo = String(activeWoForRegularShell?.salesOrder?.orderType ?? "").trim();
    if (fromWoSo) return fromWoSo;
    return "";
  }, [selected, activeWoForRegularShell, soOrderTypeById]);

  const isRegularShellNoQtyUi = productionFlowMode === "REGULAR" && regularShellOrderType === "NO_QTY";

  const regularShellRsHref = React.useMemo(() => {
    if (!isRegularShellNoQtyUi) return null;
    const sid =
      selected && selected.salesOrderId > 0
        ? selected.salesOrderId
        : activeWoForRegularShell?.salesOrderId ?? 0;
    if (!(sid > 0)) return null;
    const rsId = activeWoForRegularShell?.requirementSheetId;
    const cyc = activeWoForRegularShell?.cycleId ?? activeWoForRegularShell?.cycle?.id ?? null;
    const base = `/sales-orders/${encodeURIComponent(String(sid))}/requirement-sheets`;
    const qs = new URLSearchParams();
    if (rsId != null && Number.isFinite(Number(rsId)) && Number(rsId) > 0) {
      qs.set("requirementSheetId", String(rsId));
    }
    if (cyc != null && Number.isFinite(Number(cyc)) && Number(cyc) > 0) {
      qs.set("cycleId", String(cyc));
    }
    qs.set("source", "no_qty_so");
    const q = qs.toString();
    return q ? `${base}?${q}` : base;
  }, [isRegularShellNoQtyUi, selected, activeWoForRegularShell]);

  const regularWorkflowStageLabel = React.useMemo(() => {
    if (navigateNoQtyContext) return "";
    if (draftApprovalPendingRegular) return "Draft approval pending";
    if (selectedLineQcPending && regularQcBannerHref) return "QC pending";
    if (woProductionLifecycleBlocked && isWorkOrderPausedStatus(selectedWoForLifecycle?.status)) return "Paused";
    if (rmProductionEntryBlocked && showRegularRmReadiness) return "Waiting for RM issue";
    if (selectedMetrics && selectedMetrics.remainingQty > 1e-6) return "In progress";
    if (showQcCompletedStrip) return "Complete";
    if (selectedMetrics && selectedMetrics.remainingQty <= 1e-6) return "Line complete";
    if (!selected && wolId > 0) {
      const lineEntries = entries.filter((e) => Number(e.workOrderLine?.id ?? 0) === wolId);
      if (lineEntries.some((e) => qcPendingEntry(e))) return "QC pending";
      if (lineEntries.some((e) => isDraft(e))) return "Draft";
      if (lineEntries.some((e) => isApproved(e))) return "Approved";
    }
    if (productionStickyContext) return "Production";
    return "Production";
  }, [
    navigateNoQtyContext,
    draftApprovalPendingRegular,
    latestDraftForSelectedWoLine,
    selectedLineQcPending,
    regularQcBannerHref,
    woProductionLifecycleBlocked,
    selectedWoForLifecycle?.status,
    rmProductionEntryBlocked,
    showRegularRmReadiness,
    selectedMetrics,
    showQcCompletedStrip,
    selected,
    wolId,
    entries,
    productionStickyContext,
  ]);

  /** Single SO/WO/Item context — rendered below the primary action strip (not duplicated in form). */
  const productionCompactContextBar =
    !navigateNoQtyContext && !showProductionWorkspace && (selected || productionStickyContext) ? (
      <OperationalContextBar className="rounded-md border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-2 py-1 text-[11px] shadow-sm">
        <span className="font-semibold text-slate-600">SO</span>
        <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-sky-900">
          {(() => {
            const soId = selected?.salesOrderId ?? productionStickyContext?.salesOrderId ?? 0;
            if (!(soId > 0)) return "—";
            const soDoc =
              selected && selected.salesOrderId === focusSoId
                ? focusSo?.docNo
                : productionStickyContext?.soDocNo ?? (soId === focusSoId ? focusSo?.docNo : null);
            return displaySalesOrderNo(soId, soDoc);
          })()}
        </span>
        {isRegularShellNoQtyUi ? (
          <>
            <OpCtxSep />
            <span className="text-slate-500">Cycle</span>
            <span className="font-semibold tabular-nums text-slate-900">
              {activeWoForRegularShell?.cycle?.cycleNo != null
                ? Number(activeWoForRegularShell.cycle.cycleNo)
                : "—"}
            </span>
            <OpCtxSep />
            <span className="text-slate-500">RS</span>
            <span className="rounded border border-violet-200 bg-violet-50/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-violet-950">
              {activeWoForRegularShell?.requirementSheetId != null &&
              Number(activeWoForRegularShell.requirementSheetId) > 0
                ? displayRequirementSheetNo(Number(activeWoForRegularShell.requirementSheetId), null)
                : "—"}
            </span>
          </>
        ) : null}
        <OpCtxSep />
        <span className="font-semibold text-slate-600">WO</span>
        <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-900">
          {(() => {
            const id =
              woId > 0
                ? woId
                : selected?.workOrderId ??
                  productionStickyContext?.workOrderId ??
                  activeWoForRegularShell?.id ??
                  0;
            if (!(id > 0)) return "—";
            const woDoc =
              activeWoForRegularShell?.id === id
                ? activeWoForRegularShell?.docNo
                : productionStickyContext?.woDocNo ?? workOrders.find((w) => w.id === id)?.docNo ?? null;
            return displayWorkOrderNo(id, woDoc);
          })()}
        </span>
        <OpCtxSep />
        <span className="text-slate-500">Item</span>
        <span className="max-w-[12rem] truncate font-semibold text-slate-900">
          {selected?.fgItem.itemName ?? productionStickyContext?.itemName ?? "—"}
        </span>
        <OpCtxSep />
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Status
        </span>
        <span className="font-semibold text-slate-900">
          {isRegularShellNoQtyUi && noQtyCycleDisplayStatus
            ? noQtyCycleDisplayStatus.label
            : regularWorkflowStageLabel}
        </span>
        {displayHeaderMetrics && (selected || productionStickyContext) ? (
          <>
            <OpCtxSep />
            <span className="text-slate-500">Planned</span>
            <span className="font-bold tabular-nums text-slate-900">{fmtProdQty(displayHeaderMetrics.woLineQty)}</span>
            <OpCtxSep />
            <span className="text-slate-500">Produced</span>
            <span className="font-bold tabular-nums text-slate-900">{fmtProdQty(displayHeaderMetrics.usedQty)}</span>
            <OpCtxSep />
            <span className="text-emerald-800">Remaining</span>
            <span className="font-bold tabular-nums text-emerald-950">{fmtProdQty(displayHeaderMetrics.remainingQty)}</span>
          </>
        ) : null}
      </OperationalContextBar>
    ) : null;

  const main = (
    <OperatorPageBody
      className={cn(
        canProd && flatLines.length > 0 && "pb-3",
        "gap-1",
        // Desktop workbench: keep split panels above fold (page should not scroll much).
        // Use dvh to avoid scrollbar flicker from classic vh behavior on Windows/browser chrome.
        // Desktop workbench: REGULAR shell adds a taller sticky header — reserve slightly more vertical space.
        navigateNoQtyContext
          ? "lg:h-[calc(100dvh-11.25rem)]"
          : "lg:h-[calc(100dvh-13.25rem)]",
      )}
    >
      {fromNoQtySo ? (
        <div className="mb-0.5">
          <DemoFlowBanner />
        </div>
      ) : null}

      {showNoQtyOptionalPriorCycleStrip ? (
        <div className="rounded border border-slate-200/90 bg-slate-50/95 px-2 py-1 text-[12px] font-medium text-slate-700">
          Optional production from previous cycle
        </div>
      ) : null}
      {error ? <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[13px] text-red-800">{error}</div> : null}
      {woProductionLifecycleBlocked && woProductionLifecycleMessage && !productionPrimaryStripCoversPause && !draftApprovalPendingRegular ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
          {selectedWoPaused ? (
            <>
              <div className="font-semibold">Work Order paused</div>
              <p className="mt-1 text-[12px] leading-snug text-amber-900">
                Accepted FG stock is kept in store. Production can be resumed later.
              </p>
              {pausedWoQtyStrip ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-5">
                  <div>
                    <dt className="text-amber-800/80">Planned</dt>
                    <dd className="font-bold tabular-nums">{fmtProdQty(pausedWoQtyStrip.plannedQty)}</dd>
                  </div>
                  <div>
                    <dt className="text-amber-800/80">Produced</dt>
                    <dd className="font-bold tabular-nums">{fmtProdQty(pausedWoQtyStrip.producedQty)}</dd>
                  </div>
                  <div>
                    <dt className="text-amber-800/80">QC accepted</dt>
                    <dd className="font-bold tabular-nums">{fmtProdQty(pausedWoQtyStrip.qcAcceptedQty)}</dd>
                  </div>
                  <div>
                    <dt className="text-amber-800/80">Dispatched</dt>
                    <dd className="font-bold tabular-nums">
                      {fmtProdQty(pausedFgBalance?.dispatchedQty ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-amber-800/80">Remaining production</dt>
                    <dd className="font-bold tabular-nums">{fmtProdQty(pausedWoQtyStrip.remainingProductionQty)}</dd>
                  </div>
                </dl>
              ) : null}
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-amber-800 text-white hover:bg-amber-900"
                  disabled={resumeWoBusy}
                  onClick={() => {
                    const id = selectedWoForLifecycle?.id ?? 0;
                    if (!(id > 0)) return;
                    setResumeWoBusy(true);
                    void resumeWorkOrderApi(id)
                      .then(() => refresh())
                      .catch((e) => setError(e instanceof Error ? e.message : "Resume failed"))
                      .finally(() => setResumeWoBusy(false));
                  }}
                >
                  {resumeWoBusy ? "Resuming…" : "Resume Production"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="font-semibold">Production paused — </span>
              {woProductionLifecycleMessage}
              {String(selectedWoForLifecycle?.status ?? "").toUpperCase() === "HOLD" ? (
                <span className="mt-1 block">
                  <Link
                    to={`/work-orders?excludeWo=${selectedWoForLifecycle?.id ?? 0}&so=${selectedWoForLifecycle?.salesOrderId ?? selected?.salesOrderId ?? 0}`}
                    className="font-medium text-amber-900 underline underline-offset-2"
                  >
                    Resume on Work Orders
                  </Link>
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {noQtyRmShortage?.shortages?.length ? (
        <div className="rm-shortage-panel rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
          <h3 className="text-sm font-semibold text-amber-950">RM shortage detected</h3>
          <p className="mt-1 text-xs font-medium text-amber-900/90">
            Store owns procurement and RM purchase. Production can report the shortage and track status — do not create PO
            from here.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {noQtyRmShortage.shortages!.map((s) => (
              <li key={s.rmItemId}>
                {s.rmItemName} | Req: {fmtProdQty(s.requiredQty)} | Avl: {fmtProdQty(s.availableQty)} | Short:{" "}
                {fmtProdQty(s.shortageQty)}
                {s.unitName ? ` ${s.unitName}` : ""}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {noQtyRmShortage.context?.workOrderId ? (
              <Link
                to={rmControlCenterHref({
                  workOrderId: noQtyRmShortage.context.workOrderId,
                  onlyBlocked: true,
                  returnTo: "production",
                })}
                className={cn(buttonVariants({ size: "sm" }), "h-8 no-underline")}
              >
                Open RM Control Center
              </Link>
            ) : null}
            {noQtyRmShortage.context?.workOrderId ? (
              <Link
                to={materialRequestsQueueHref({
                  workOrderId: noQtyRmShortage.context.workOrderId,
                  workOrderLineId: noQtyRmShortage.context.workOrderLineId,
                  returnTo: "production-workspace",
                })}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 no-underline")}
              >
                Material Requests
              </Link>
            ) : null}
            <button
              type="button"
              className="text-[11px] font-medium text-amber-900/80 underline decoration-amber-700/40 underline-offset-2 hover:text-amber-950"
              onClick={() => setNoQtyRmShortage(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      <DemoSafeNoQtyContinue
        visible={showDemoNoQtyProdContinue}
        body="Demo mode: No production is saved in Safe Demo. Continue the tour without posting real batches."
        actionLabel="Continue Demo → QC"
      />
      {productionPrimaryStrip && !showNoQtyScopedProductionCard ? (
        <NextStepStrip
          visible
          density="compact"
          variant={productionPrimaryStrip.variant}
          title={productionPrimaryStrip.title}
          subtitle={productionPrimaryStrip.subtitle}
          className="gap-1.5 rounded-md px-2 py-1.5"
          primaryAction={productionPrimaryStrip.primaryAction}
        />
      ) : null}
      {productionCompactContextBar}
      {productionNextRsParallelStrip ? (
        <NextStepStrip
          visible
          variant="action"
          title="Create Next RS"
          subtitle={productionNextRsParallelStrip.subtitle}
          className="gap-1.5 rounded-md px-2 py-1.5"
          primaryAction={{
            label: "Create Next RS",
            onClick: productionNextRsParallelStrip.onClick,
            testId: "production-next-rs-parallel-cta",
          }}
        />
      ) : null}
      {showProductionWorkspace ? (
        <OperationalProductionWorkspace onOpenRow={openProductionFromWorkspace} />
      ) : showNoQtyScopedProductionCard ? (
        <div className="min-w-0">
            {!canProd ? (
              <p className="text-[13px] text-slate-600">Production / Admin only.</p>
            ) : !flatLines.length ? (
              <p className="text-[13px] text-slate-600">
                {noQtyProductionStatusMsg ||
                  noQtyEmptyMsg ||
                  (focusSo ? `No eligible work orders · ${focusSo.customerName}` : "No eligible work orders")}
              </p>
            ) : (
              <>
                <Card className="erp-op-workspace-primary min-w-0 overflow-hidden">
                  <CardHeader className="space-y-0.5 border-b border-slate-100 bg-white px-2.5 py-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Production</CardTitle>
                        <p className="erp-type-helper mt-0 text-[11px] text-slate-500">WO · Item · Qty · Save</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 py-2.5">
                    <form ref={createFormRef} onSubmit={onPost} className="flex flex-col gap-2">
                {!hideNoQtyAddProductionEntry ? (
                  <>
                    {navigateNoQtyContext ? (
                      <>
                        <select
                          ref={woSelectRef}
                          {...prodWoBind}
                          className="sr-only"
                          aria-hidden="true"
                          tabIndex={-1}
                          value={woId === 0 ? "" : String(woId)}
                          disabled
                        >
                          <option value="">Select…</option>
                          {workOrders.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.id}
                            </option>
                          ))}
                        </select>
                        <select
                          ref={lineSelectRef}
                          {...prodLineBind}
                          className="sr-only"
                          aria-hidden="true"
                          tabIndex={-1}
                          value={wolId === 0 ? "" : String(wolId)}
                          disabled
                        >
                          <option value="">Select…</option>
                          {(linesForNoQtyEntryForm ?? []).map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.id}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <div className="grid gap-2 lg:grid-cols-2 lg:items-end">
                    <FieldShortcutHint
                      show={shortcutHints.activeFieldId === "prodWo"}
                      hint={shortcutHints.activeFieldHintText ?? ""}
                      placement="below"
                      className="min-w-0"
                    >
                      <div className="erp-form-field min-w-0">
                        <span className="text-[12px] font-medium text-slate-600">
                          Select Work Order to Produce
                        </span>
                        <select
                          ref={woSelectRef}
                          {...prodWoBind}
                          className={cn("erp-select mt-0.5 w-full min-w-0 text-[13px]", operatorInputClass)}
                          value={woId === 0 ? "" : String(woId)}
                        >
                          <option value="">Select…</option>
                          {workOrders.map((w) => (
                            <option key={w.id} value={w.id}>
                              {`WO #${w.id} · SO #${w.salesOrderId}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </FieldShortcutHint>
                    <FieldShortcutHint
                      show={shortcutHints.activeFieldId === "prodLine"}
                      hint={shortcutHints.activeFieldHintText ?? ""}
                      placement="below"
                      className="min-w-0"
                    >
                      <div className="erp-form-field min-w-0">
                        <span className="text-[12px] font-medium text-slate-600">Item</span>
                        <select
                          ref={lineSelectRef}
                          {...prodLineBind}
                          className={cn("erp-select mt-0.5 w-full min-w-0 text-[13px]", operatorInputClass)}
                          value={wolId === 0 ? "" : String(wolId)}
                          disabled={!woId || !(navigateNoQtyContext ? linesForNoQtyEntryForm : linesForWo).length}
                        >
                          <option value="">{woId ? "Select line…" : "Select WO first…"}</option>
                          {(navigateNoQtyContext ? linesForNoQtyEntryForm : linesForWo).map((l) => {
                            const fl = {
                              ...l,
                              workOrderId: woId,
                              salesOrderId: workOrders.find((w) => w.id === woId)?.salesOrderId ?? 0,
                            };
                            const rem = lineRemaining(fl as FlatLine);
                            return (
                              <option key={l.id} value={l.id}>
                                {l.fgItem.itemName} · {navigateNoQtyContext ? "Last shortage Qty" : "balance"} {fmtProdQty(rem)}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </FieldShortcutHint>
                    </div>
                    )}
                  </>
                ) : null}

                <div className="grid gap-3 lg:min-h-0 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                  <div className="min-w-0 space-y-2 lg:order-2 lg:min-h-0">
                    <div className="flex flex-col gap-2">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-[12px] font-semibold text-slate-700">Work queue</h3>
                          <span className="text-[11px] text-slate-400">Cycle · WO · Item</span>
                        </div>
                        {noQtyWorkQueueRows.length === 0 ? (
                          <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 text-[12px] text-slate-700">
                            No production required right now for this cycle.
                          </div>
                        ) : (
                          <div className="max-h-[min(32vh,280px)] overflow-auto rounded-md border border-slate-200/90 bg-white shadow-sm">
                            <table className="w-full table-fixed text-[11px]">
                              <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                                <tr className="text-left text-[11px] text-slate-600">
                                  <th className="w-12 px-2 py-0.5 font-medium">Cycle</th>
                                  <th className="w-14 px-2 py-0.5 font-medium">WO</th>
                                  <th className="px-2 py-0.5 font-medium">Item</th>
                                  <th className="w-16 px-2 py-0.5 text-right font-medium">Planned</th>
                                  <th className="w-16 px-2 py-0.5 text-right font-medium">Produced</th>
                                  <th className="w-16 px-2 py-0.5 text-right font-medium">Balance</th>
                                  <th className="w-10 px-1 py-0.5 text-right font-medium">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {noQtyWorkQueueRows.map((l) => {
                                  const sel = wolId === l.id;
                                  return (
                                    <tr
                                      key={l.id}
                                      className={cn(
                                        "border-t border-slate-100",
                                        sel && "bg-emerald-50",
                                        l.queueStatus === "qc_pending" && !sel && "bg-amber-50/40",
                                      )}
                                    >
                                      <td className="px-2 py-0.5 tabular-nums font-medium text-slate-800">
                                        {l.cycleNo != null ? l.cycleNo : "—"}
                                      </td>
                                      <td className="px-2 py-0.5 tabular-nums">#{l.workOrderId}</td>
                                      <td className="truncate px-2 py-0.5 font-medium" title={l.fgItem.itemName}>
                                        {l.fgItem.itemName}
                                      </td>
                                      <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(Number(l.qty))}</td>
                                      <td className="px-2 py-0.5 text-right tabular-nums">
                                        {fmtProdQty(l.approvedProducedQty ?? 0)}
                                      </td>
                                      <td className="px-2 py-0.5 text-right font-semibold tabular-nums">
                                        {fmtProdQty(l.balance)}
                                      </td>
                                      <td className="px-1 py-0.5 text-right">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 shrink-0 p-0 text-[13px]"
                                          onClick={() => applyLine(l)}
                                          aria-label={`Select ${l.fgItem.itemName}`}
                                        >
                                          ▶
                                        </Button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {noQtyWaitingRequirementRows.length > 0 ? (
                          <div className="rounded-md border border-dashed border-slate-200/90 bg-slate-50/80 px-2 py-1.5">
                            <p className="text-[11px] font-semibold text-slate-600">Other RS items (no production this cycle)</p>
                            <ul className="mt-1 space-y-0.5">
                              {noQtyWaitingRequirementRows.map((r) => (
                                <li key={r.key} className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-600">
                                  <span className="truncate font-medium text-slate-700">{r.itemName}</span>
                                  <span className="text-slate-400">·</span>
                                  <span>Waiting for requirement</span>
                                  {r.cycleNo != null ? (
                                    <span className="text-slate-400">· Cycle {r.cycleNo}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {noQtyProductShortageHistoryRows.length > 0 ? (
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h3 className="text-[12px] font-semibold text-slate-700">
                                Product-wise shortage history
                              </h3>
                              <span className="text-[11px] text-slate-400">Latest cycle first</span>
                            </div>
                            <p className="text-[11px] leading-snug text-slate-500">
                              Shortage is carried forward product-wise only when the next RS is created for the same
                              product.
                            </p>
                            <div className="max-h-[min(28vh,220px)] overflow-auto rounded-md border border-slate-200/90 bg-slate-50/80 shadow-sm">
                              <table className="w-full min-w-0 text-[11px]">
                                <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-100/90">
                                  <tr className="text-left text-[11px] text-slate-600">
                                    <th className="px-2 py-0.5 font-medium">Cycle</th>
                                    <th className="px-2 py-0.5 font-medium">Item</th>
                                    <th className="px-2 py-0.5 text-right font-medium">New Requirement</th>
                                    <th className="px-2 py-0.5 text-right font-medium">Last Shortage Added</th>
                                    <th className="px-2 py-0.5 text-right font-medium">Final Planned Qty</th>
                                    <th className="px-2 py-0.5 text-right font-medium">Produced Qty</th>
                                    <th className="px-2 py-0.5 text-right font-medium">Shortage</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {noQtyProductShortageHistoryRows.map((r) => (
                                    <tr
                                      key={r.key}
                                      className={cn(
                                        "border-t border-slate-100",
                                        r.isCurrentCycle && "bg-blue-50/90 ring-1 ring-inset ring-blue-200/80",
                                      )}
                                    >
                                      <td className="px-2 py-0.5 tabular-nums font-semibold text-slate-800">
                                        {r.cycleNo != null ? r.cycleNo : "—"}
                                        {r.isCurrentCycle ? (
                                          <span className="ml-1 rounded bg-blue-100 px-1 py-px text-[10px] font-semibold text-blue-800">
                                            Current
                                          </span>
                                        ) : null}
                                      </td>
                                      <td
                                        className="max-w-[9rem] truncate px-2 py-0.5 font-medium text-slate-900"
                                        title={r.itemName}
                                      >
                                        {r.itemName}
                                      </td>
                                      <td className="px-2 py-0.5 text-right tabular-nums text-slate-700">
                                        {fmtProdQty(r.newRequirement)}
                                      </td>
                                      <td className="px-2 py-0.5 text-right tabular-nums text-slate-700">
                                        {fmtProdQty(r.lastShortageAdded)}
                                      </td>
                                      <td className="px-2 py-0.5 text-right tabular-nums font-medium text-slate-800">
                                        {fmtProdQty(r.finalPlannedQty)}
                                      </td>
                                      <td className="px-2 py-0.5 text-right tabular-nums text-slate-700">
                                        {fmtProdQty(r.producedQty)}
                                      </td>
                                      <td className="px-2 py-0.5 text-right font-semibold tabular-nums text-slate-900">
                                        {fmtProdQty(r.shortageQty)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-2 lg:order-1 lg:min-h-0">
                    <div className="space-y-2 lg:min-h-0">
                      {hideNoQtyAddProductionEntry ? (
                        <div className="flex min-h-[10rem] flex-col justify-center rounded-md border border-indigo-200 bg-indigo-50/90 px-3 py-3 text-sm text-indigo-950">
                          <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                            {noQtyNextRsReady ? "Cycle ready for Next RS" : "Production entry completed for this cycle"}
                          </div>
                          {productionPrimaryStrip ? (
                            <p className="mt-2 text-[12px] leading-snug text-slate-600">Your next action is shown above.</p>
                          ) : (
                            <>
                              <p className="mt-2 text-[13px] leading-snug text-slate-700">
                                {noQtyNextRsReady && noQtyCarryForwardQtyFromEngine > 1e-6
                                  ? `Includes previous cycle shortage (${fmtProdQty(noQtyCarryForwardQtyFromEngine)}).`
                                  : "Includes previous cycle shortage when applicable."}
                              </p>
                              <p className="mt-1 text-[11px] leading-snug text-slate-600">
                                More production this cycle is optional.
                              </p>
                            </>
                          )}
                          <div className="mt-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setNoQtyManualContinue(true);
                                window.setTimeout(() => woSelectRef.current?.focus(), 0);
                              }}
                            >
                              Continue producing more in same cycle
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                      {(() => {
                        if (!selected) {
                          return (
                            <div className="space-y-1">
                              <div className="text-[12px] font-semibold tracking-tight text-slate-700">
                                Continue Production
                              </div>
                              <p className="text-[11px] text-slate-500">Select a row from the work queue.</p>
                            </div>
                          );
                        }
                        const eps = 1e-6;
                        const rem = lineRemaining(selected);
                        const produced = selected.approvedProducedQty ?? 0;
                        const qcPendingLine = noQtyQcPendingByWolId.get(selected.id) ?? 0;
                        if (qcPendingLine > eps && !suppressDuplicateQcWorkflowUi) {
                          const cycleIdNav = effectiveNoQtyCycleId ?? null;
                          const pendingEntryOnLine = entries.find(
                            (e) => Number(e.workOrderLine?.id ?? 0) === Number(selected.id) && qcPendingEntry(e),
                          );
                          const prodQs =
                            pendingEntryOnLine != null
                              ? `&productionId=${encodeURIComponent(String(pendingEntryOnLine.id))}`
                              : "";
                          const qcHref = `${buildNoQtyGuidedHref({
                            to: "/qc-entry",
                            salesOrderId: focusSoId,
                            cycleId: cycleIdNav,
                            fromStep: "production",
                          })}${prodQs}&from=production_screen`;
                          return (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-[12px] text-emerald-950">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold text-emerald-900/90">
                                    Approved · ready for QC
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-emerald-900/90">
                                    QC pending:{" "}
                                    <span className="font-semibold tabular-nums text-emerald-950">
                                      {fmtProdQty(qcPendingLine)}
                                    </span>
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="default"
                                  className="h-8 px-3 text-[11px] font-semibold shadow-sm"
                                  onClick={() => navigate(qcHref)}
                                >
                                  {PRODUCTION_QA_TERMS.COMPLETE_QA}
                                </Button>
                              </div>
                            </div>
                          );
                        }
                        const noQtyCarryForwardIdle =
                          navigateNoQtyContext &&
                          isCarryForwardLine(selected, "NO_QTY") &&
                          !noQtyManualContinue;
                        const needsNextActionChoice =
                          produced > eps &&
                          rem > eps &&
                          noQtyHasApprovedByWolId.has(selected.id) &&
                          !noQtyCarryForwardIdle;
                        if (!needsNextActionChoice || noQtyManualContinue) {
                          return (
                            <div className="space-y-1">
                              <div className="text-[12px] font-semibold tracking-tight text-slate-700">
                                Continue Production
                              </div>
                              {noQtyEntryContextLine ? (
                                <p className="text-[11px] leading-snug text-slate-600">{noQtyEntryContextLine}</p>
                              ) : null}
                            </div>
                          );
                        }

                        const cycleIdNav = effectiveNoQtyCycleId ?? null;
                        const qcSoId = noQtyWorkbenchSoId > 0 ? noQtyWorkbenchSoId : focusSoId;
                        const qcHref = `${buildNoQtyGuidedHref({
                          to: "/qc-entry",
                          salesOrderId: qcSoId,
                          cycleId: cycleIdNav,
                          fromStep: "production",
                        })}&from=production_screen`;

                        if (suppressDuplicateQcWorkflowUi) {
                          return (
                            <div className="space-y-1">
                              <div className="text-[12px] font-semibold tracking-tight text-slate-700">
                                Continue Production
                              </div>
                              {noQtyEntryContextLine ? (
                                <p className="text-[11px] leading-snug text-slate-600">{noQtyEntryContextLine}</p>
                              ) : null}
                            </div>
                          );
                        }

                        return (
                          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-800">
                            <div className="font-semibold text-slate-900">Next action</div>
                            <div className="mt-1 grid gap-1 text-slate-700">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Produced qty</span>
                                <span className="font-semibold tabular-nums text-slate-900">{fmtProdQty(produced)}</span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">{navigateNoQtyContext ? "Last shortage Qty" : "Remaining qty"}</span>
                                <span className="font-semibold tabular-nums text-slate-900">{fmtProdQty(rem)}</span>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap justify-end gap-2">
                              <Button type="button" size="sm" variant="default" className="font-semibold shadow-sm" onClick={() => navigate(qcHref)}>
                                Move to QC
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                      {selected && !navigateNoQtyContext ? (
                        <p className="text-[11px] text-slate-600">
                          <span className="font-medium text-slate-800">{selected.fgItem.itemName}</span>
                          <span className="text-slate-400"> · </span>
                          <span className="font-medium text-slate-700">
                            {displaySalesOrderNo(selected.salesOrderId, focusSo?.docNo)}
                          </span>
                        </p>
                      ) : null}
                      {(() => {
                        if (!selected) return null;
                        const eps = 1e-6;
                        const rem = lineRemaining(selected);
                        const produced = selected.approvedProducedQty ?? 0;
                        const qcPendingLine = noQtyQcPendingByWolId.get(selected.id) ?? 0;
                        const noQtyCfBlockForm =
                          navigateNoQtyContext &&
                          isCarryForwardLine(selected, "NO_QTY") &&
                          !noQtyManualContinue;
                        const needsDecisionForm =
                          produced > eps && rem > eps && noQtyHasApprovedByWolId.has(selected.id);
                        if ((needsDecisionForm || noQtyCfBlockForm) && !noQtyManualContinue) return null;
                        const approvedOnLine = navigateNoQtyContext && noQtyHasApprovedByWolId.has(selected.id);
                        const remainingUi = selectedMetrics?.remainingQty ?? rem;
                        const noRemaining = Number.isFinite(Number(remainingUi)) && Number(remainingUi) <= eps;
                        if (approvedOnLine && noRemaining && !editing && !(suppressDuplicateQcWorkflowUi && qcPendingLine > eps)) {
                          const cycleIdNav = effectiveNoQtyCycleId ?? null;
                          const pendingEntryOnLine = entries.find(
                            (e) => Number(e.workOrderLine?.id ?? 0) === Number(selected.id) && qcPendingEntry(e),
                          );
                          const prodQs =
                            pendingEntryOnLine != null
                              ? `&productionId=${encodeURIComponent(String(pendingEntryOnLine.id))}`
                              : "";
                          const qcHref = `${buildNoQtyGuidedHref({
                            to: "/qc-entry",
                            salesOrderId: focusSoId,
                            cycleId: cycleIdNav,
                            fromStep: "production",
                          })}${prodQs}&from=production_screen`;
                          return (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] text-emerald-950">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold text-emerald-900/90">
                                    Approved
                                  </div>
                                  <div className="mt-0.5 grid gap-0.5 text-[11px] text-emerald-950/90">
                                    <div>
                                      Produced:{" "}
                                      <span className="font-semibold tabular-nums text-emerald-950">{fmtProdQty(produced)}</span>
                                    </div>
                                    <div>
                                      Status:{" "}
                                      <span className="font-semibold text-emerald-950">
                                        {qcPendingLine > eps
                                          ? suppressDuplicateQcWorkflowUi
                                            ? "QC wait"
                                            : "Pending QC"
                                          : "QC done / ready"}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="default"
                                  className="h-8 px-3 text-[11px] font-semibold shadow-sm"
                                  onClick={() => navigate(qcHref)}
                                >
                                  {PRODUCTION_QA_TERMS.COMPLETE_QA}
                                </Button>
                              </div>
                            </div>
                          );
                        }
                        const hasDraftLocked =
                          showCompactDraftApprovalStrip &&
                          latestDraftForSelectedWo != null &&
                          selected != null &&
                          Number(latestDraftForSelectedWo.latest.workOrderLine?.workOrder?.id ?? 0) === Number(selected.workOrderId);
                        if (hasDraftLocked && !editing) {
                          return (
                            <div className="space-y-2">
                              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                                Draft saved. Review the draft and proceed.
                              </div>
                              <div>{renderDraftProductionBanner({ compact: false })}</div>
                            </div>
                          );
                        }
                        if (editing && navigateNoQtyContext) {
                          return (
                            <div className="space-y-2">
                              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-800">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                  Edit draft
                                </div>
                                <div className="mt-0.5 text-[11px] text-slate-600">
                                  Update produced qty, then save draft again.
                                </div>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
                                <label className="grid gap-1 text-[12px]">
                                  <span className="text-slate-600">Date</span>
                                  <Input
                                    className={operatorInputClass}
                                    type="date"
                                    value={editDate}
                                    onChange={(e) => setEditDate(e.target.value)}
                                  />
                                </label>
                                <label className="grid gap-1 text-[12px]">
                                  <span className="text-slate-600">Produced qty</span>
                                  <Input
                                    className={operatorInputClass}
                                    type="number"
                                    min={0.001}
                                    step="any"
                                    value={editQty}
                                    onChange={(e) => setEditQty(toNumberDraft(e.target.value))}
                                  />
                                </label>
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 text-[13px]"
                                    onClick={saveEditDraft}
                                    disabled={editSaving}
                                  >
                                    {editSaving ? "Saving…" : "Save draft"}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-[13px]"
                                    onClick={() => setEditing(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <>
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                              <div className="erp-form-field w-fit shrink-0">
                                <span className="text-[12px] font-medium text-slate-600">Date</span>
                                <Input
                                  type="date"
                                  className={cn("mt-0.5 w-[11rem] tabular-nums text-[13px]", operatorInputClass)}
                                  value={prodDate}
                                  onChange={(e) => setProdDate(e.target.value)}
                                  required
                                />
                              </div>
                              <FieldShortcutHint
                                show={shortcutHints.activeFieldId === "prodQty"}
                                hint={shortcutHints.activeFieldHintText ?? ""}
                                placement="below-end"
                                className="w-full min-w-0 sm:w-[11rem] sm:max-w-[14rem]"
                              >
                                <div className="erp-form-field min-w-0">
                                  <span className="text-[12px] font-medium text-slate-600">Produced qty</span>
                                  <Input
                                    ref={producedQtyRef}
                                    {...prodQtyBind}
                                    type="text"
                                    data-testid="production-qty-input"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    className="mt-0.5 h-9 w-full min-w-[8rem] max-w-[14rem] tabular-nums text-[15px] font-semibold"
                                    placeholder="Qty"
                                    value={producedQtyStr}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                                        shortcutHints.markFieldShortcutUsed("prodQty");
                                      }
                                    }}
                                  />
                                  <div className="mt-0.5 min-h-[1rem] text-[11px] leading-snug">
                                    {wolId > 0 && !producedQtyValid ? (
                                      <span className="font-medium text-amber-800">Enter produced quantity.</span>
                                    ) : selectedMetrics ? (
                                      <span className="text-slate-500">
                                        Remaining:{" "}
                                        <span className="font-medium tabular-nums text-slate-700">
                                          {fmtProdQty(selectedMetrics.remainingQty)}
                                        </span>
                                      </span>
                                    ) : (
                                      <span className="text-transparent">.</span>
                                    )}
                                  </div>
                                </div>
                              </FieldShortcutHint>
                              <div className="flex shrink-0 flex-wrap items-end gap-1.5">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-9 shrink-0 text-[13px]"
                                  disabled={posting || !selectedMetrics || selectedMetrics.remainingQty <= 0}
                                  onClick={() => {
                                    producedQtyUserTouchedRef.current = true;
                                    setProducedQtyStr(fmtProdQty(selectedMetrics?.remainingQty ?? 0));
                                  }}
                                >
                                  Use full
                                </Button>
                                <FieldShortcutHint
                                  show={shortcutHints.activeFieldId === "prodSave"}
                                  hint={shortcutHints.activeFieldHintText ?? ""}
                                  placement="above"
                                  className="inline-block shrink-0"
                                >
                                  <Button
                                    type="submit"
                                    size="sm"
                                    data-testid="save-production-btn"
                                    className="h-9 shrink-0 px-4 text-[13px] font-semibold"
                                    title={noQtyEntryContextLine || undefined}
                                    onFocus={prodSaveFocusBind.onFocus}
                                    onBlur={prodSaveFocusBind.onBlur}
                                    onClick={() => shortcutHints.markFieldShortcutUsed("prodSave")}
                                    disabled={posting || !createFormCanSubmit}
                                    {...(prodDemoHl ? { "data-demo-highlight": prodDemoHl } : {})}
                                  >
                                    {posting ? "Saving…" : "Save draft"}
                                  </Button>
                                </FieldShortcutHint>
                              </div>
                            </div>
                            {noQtyEntryContextLine ? (
                              <p className="text-[10px] leading-snug text-slate-500">{noQtyEntryContextLine}</p>
                            ) : null}
                            {productionWarnings.length > 0 ? (
                              <ul className="space-y-0.5 text-[11px] font-medium text-amber-900">
                                {productionWarnings.map((w) => (
                                  <li key={w}>{w}</li>
                                ))}
                              </ul>
                            ) : null}
                          </>
                        );
                      })()}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                </form>
                  </CardContent>
                </Card>
              </>
            )}

          </div>
      ) : !canProd ? (
        <p className="text-[13px] text-slate-600">Production / Admin only.</p>
      ) : !flatLines.length ? (
        <>
          {showNoQtyScopedProductionCard ? (
            <p className="text-xs leading-snug text-slate-600">
              {noQtyProductionStatusMsg ||
                noQtyEmptyMsg ||
                (focusSo ? `No eligible work orders · ${focusSo.customerName}` : "No eligible work orders")}
            </p>
          ) : workOrders.length === 0 ? (
            <p className="text-xs leading-snug text-slate-600">
              {getRoleEmptyState("production_queue", roleUi.role).title}{" "}
              {getRoleEmptyState("production_queue", roleUi.role).body ?? ""}
            </p>
          ) : null}
        </>
      ) : (
        <form ref={createFormRef} onSubmit={onPost} className={cn("flex flex-col", !fromNoQtySo ? "gap-1.5" : "gap-3")}>
          {!fromNoQtySo ? (
            <>
              {showRegularRmReadiness && !draftApprovalPendingRegular ? (
                <>
                  {rmProductionEntryBlocked &&
                  rmReadiness &&
                  rmReadiness.gate !== "NO_PMR" &&
                  rmReadiness.gate !== "PMR_DRAFT_ONLY" &&
                  !productionPrimaryStripCoversRmIssue ? (
                    <ProductionRmBlockedBanner
                      workOrderId={rmReadiness.workOrderId}
                      workOrderNo={productionMaterialContext?.woLabel ?? null}
                      gate={rmReadiness.gate}
                    />
                  ) : null}
                  <div
                    className={cn(
                      ((rmProductionEntryBlocked &&
                        rmReadiness &&
                        rmReadiness.gate !== "NO_PMR" &&
                        rmReadiness.gate !== "PMR_DRAFT_ONLY") ||
                        productionPrimaryStripCoversMaterialCard) &&
                        "sr-only",
                    )}
                  >
                    <ProductionMaterialWorkflowCard
                      workOrderLineId={wolId}
                      refreshKey={liveTick}
                      context={productionMaterialContext}
                      onLoaded={onRmReadinessLoaded}
                      onLoadingChange={onRmReadinessLoadingChange}
                    />
                  </div>
                </>
              ) : null}
              {showRegularProductionEntry ? (
              <Card
                id="regular-production-entry"
                className={cn(
                  "erp-op-workspace-primary min-w-0 scroll-mt-24 overflow-hidden",
                  regularCreateFormLockedByDraft && "border-amber-200/80",
                )}
              >
                <CardHeader className="border-b border-slate-100 bg-white px-2.5 py-1">
                  <CardTitle className="text-[13px] font-semibold tracking-tight text-slate-900">Production entry</CardTitle>
                  {!regularCreateFormLockedByDraft ? (
                    <p className="erp-type-helper mt-0.5 text-[11px] text-slate-500">Date · Qty · Save</p>
                  ) : null}
                </CardHeader>
                <CardContent className="px-2.5 py-1">
                  {regularCreateFormLockedByDraft ? (
                    <p
                      className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] leading-snug text-amber-950"
                      data-testid="regular-draft-owns-create-form"
                    >
                      Draft already exists. Approve, edit, or cancel the draft to continue.
                    </p>
                  ) : (
                  <>
                  <div className="flex flex-col gap-1.5 lg:flex-row lg:flex-wrap lg:items-end lg:gap-x-2 lg:gap-y-1">
                        <div className="grid w-full min-w-[9rem] shrink-0 gap-0.5 sm:w-[10.25rem]">
                          <span className="text-[11px] font-medium text-slate-600">Date</span>
                          <Input
                            type="date"
                            className="erp-flow-filter-input h-8 w-full tabular-nums text-[13px]"
                            value={prodDate}
                            onChange={(e) => setProdDate(e.target.value)}
                            required
                          />
                        </div>
                        <FieldShortcutHint
                          show={shortcutHints.activeFieldId === "prodQty"}
                          hint={shortcutHints.activeFieldHintText ?? ""}
                          placement="below-end"
                          className="w-full min-w-[7rem] max-w-[9rem] shrink-0"
                        >
                          <div className="grid gap-0.5">
                            <span className="text-[11px] font-medium text-slate-600">Qty</span>
                            <Input
                              ref={producedQtyRef}
                              {...prodQtyBind}
                              type="text"
                              data-testid="production-qty-input"
                              inputMode="decimal"
                              autoComplete="off"
                              className="erp-flow-filter-input h-8 tabular-nums text-[13px] font-semibold"
                              placeholder="0"
                              value={producedQtyStr}
                              disabled={rmProductionEntryBlocked}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                                  shortcutHints.markFieldShortcutUsed("prodQty");
                                }
                              }}
                            />
                            {rmReadinessLoading ? (
                              <p className="text-[11px] text-slate-500">Checking RM readiness…</p>
                            ) : rmAllowedNowQty != null && !rmProductionEntryBlocked ? (
                              <p className="text-[11px] text-emerald-800">
                                Max from issued RM: {fmtProdQty(rmAllowedNowQty)}
                              </p>
                            ) : null}
                            {wolId > 0 && !producedQtyValid ? (
                              <p className="text-[11px] font-medium text-amber-800">Enter quantity.</p>
                            ) : null}
                          </div>
                        </FieldShortcutHint>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 shrink-0 px-2.5 text-[12px]"
                          disabled={
                            posting ||
                            !selectedMetrics ||
                            selectedMetrics.remainingQty <= 0 ||
                            rmProductionEntryBlocked
                          }
                          onClick={() => {
                            const woRem = selectedMetrics?.remainingQty ?? 0;
                            const cap = rmEntryQtyCap != null ? Math.min(woRem, rmEntryQtyCap) : woRem;
                            producedQtyUserTouchedRef.current = true;
                            setProducedQtyStr(fmtProdQty(cap));
                          }}
                        >
                          Use full
                        </Button>
                        <FieldShortcutHint
                          show={shortcutHints.activeFieldId === "prodSave"}
                          hint={shortcutHints.activeFieldHintText ?? ""}
                          placement="above"
                          className="inline-block shrink-0"
                        >
                          <div className="grid gap-0.5">
                            <span className="text-[11px] font-medium text-transparent select-none" aria-hidden>
                              ·
                            </span>
                            <Button
                              type="submit"
                              data-testid="save-production-btn"
                              className="h-8 px-3 text-[13px] font-semibold shadow-sm"
                              onFocus={prodSaveFocusBind.onFocus}
                              onBlur={prodSaveFocusBind.onBlur}
                              onClick={() => shortcutHints.markFieldShortcutUsed("prodSave")}
                              disabled={posting || !createFormCanSubmit}
                              {...(prodDemoHl ? { "data-demo-highlight": prodDemoHl } : {})}
                            >
                              {posting ? "Saving…" : "Save"}
                            </Button>
                          </div>
                        </FieldShortcutHint>
                  </div>
                  {productionWarnings.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-[11px] font-medium text-amber-900">
                      {productionWarnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                  </>
                  )}
                </CardContent>
              </Card>
              ) : null}

              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[11px] font-semibold text-slate-600">Work queue</h3>
                  <span className="text-[10px] text-slate-400">▶ selects row</span>
                </div>
                <div className="max-h-[min(32vh,220px)] overflow-auto rounded-md border border-slate-200 bg-white">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                      <tr className="text-left text-[11px] text-slate-600">
                        {navigateNoQtyContext ? null : <th className="px-2 py-1 font-medium">WO</th>}
                        <th className="px-2 py-1 font-medium">Item</th>
                        <th className="px-2 py-1 text-right font-medium">Planned</th>
                        <th className="px-2 py-1 text-right font-medium">Produced</th>
                        <th className="px-2 py-1 text-right font-medium">Balance</th>
                        <th className="w-10 px-1 py-1 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedFlatLines.map((l) => {
                        const approved = l.approvedProducedQty ?? 0;
                        const rem = lineRemaining(l);
                        const sel = wolId === l.id;
                        return (
                          <tr
                            key={l.id}
                            className={cn(
                              "border-t border-slate-100 py-0 transition-colors hover:bg-slate-50/90",
                              navigateNoQtyContext
                                ? sel && "bg-emerald-50/90 ring-1 ring-inset ring-emerald-200/80"
                                : sel && "border-l-[3px] border-l-sky-600 bg-sky-50 shadow-[inset_3px_0_0_rgba(14,165,233,0.25)]",
                            )}
                          >
                            {navigateNoQtyContext ? null : (
                              <td className="px-2 py-0.5 tabular-nums">#{l.workOrderId}</td>
                            )}
                            <td className="max-w-[11rem] truncate px-2 py-0.5 font-medium" title={l.fgItem.itemName}>
                              {l.fgItem.itemName}
                            </td>
                            <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(Number(l.qty))}</td>
                            <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(approved)}</td>
                            <td
                              className={cn(
                                "px-2 py-0.5 text-right tabular-nums",
                                !navigateNoQtyContext && "font-bold text-slate-950",
                              )}
                            >
                              {fmtProdQty(rem)}
                            </td>
                            <td className="px-1 py-1 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 shrink-0 p-0 text-[13px]"
                                onClick={() => applyLine(l)}
                                aria-label={`Select ${l.fgItem.itemName}`}
                              >
                                ▶
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <>
              {fromNoQtySo && !showNoQtyScopedProductionCard && flatLines.length > 0 && canProd ? (
                <div className="pb-0.5">{renderDraftProductionBanner({ compact: true })}</div>
              ) : null}
              <OperatorTopBar className="rounded border border-slate-200 bg-white p-1.5 shadow-sm">
                <FieldShortcutHint
                  show={shortcutHints.activeFieldId === "prodWo"}
                  hint={shortcutHints.activeFieldHintText ?? ""}
                  placement="below"
                  className="min-w-[9rem] max-w-[14rem] shrink-0"
                >
                  <div className="erp-form-field min-w-0">
                    <span className="text-[12px] font-medium text-slate-600">Select Work Order to Produce</span>
                    <select
                      ref={woSelectRef}
                      {...prodWoBind}
                      className={cn("erp-select mt-0.5 w-full min-w-0 text-[13px]", operatorInputClass)}
                      value={woId === 0 ? "" : String(woId)}
                    >
                      <option value="">Select…</option>
                      {workOrders.map((w) => (
                        <option key={w.id} value={w.id}>
                          {navigateNoQtyContext
                            ? formatNoQtyProductionWoLabel(
                                w,
                                w.salesOrderId,
                                w.salesOrderId === focusSoId ? focusSo?.docNo : undefined,
                              )
                            : `WO #${w.id} · SO #${w.salesOrderId}`}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] leading-snug text-slate-500">
                      Work orders created earlier appear here. Select one to start production.
                    </p>
                  </div>
                </FieldShortcutHint>
                <FieldShortcutHint
                  show={shortcutHints.activeFieldId === "prodLine"}
                  hint={shortcutHints.activeFieldHintText ?? ""}
                  placement="below"
                  className="min-w-[10rem] max-w-[20rem] flex-1"
                >
                  <div className="erp-form-field min-w-0">
                    <span className="text-[12px] font-medium text-slate-600">Item</span>
                    <select
                      ref={lineSelectRef}
                      {...prodLineBind}
                      className={cn("erp-select mt-0.5 w-full min-w-0 text-[13px]", operatorInputClass)}
                      value={wolId === 0 ? "" : String(wolId)}
                      disabled={!woId || !linesForWo.length}
                    >
                      <option value="">{woId ? "Select line…" : "Select WO first…"}</option>
                      {linesForWo.map((l) => {
                        const fl = {
                          ...l,
                          workOrderId: woId,
                          salesOrderId: workOrders.find((w) => w.id === woId)?.salesOrderId ?? 0,
                        };
                        const rem = lineRemaining(fl as FlatLine);
                        return (
                          <option key={l.id} value={l.id}>
                            {l.fgItem.itemName} · {fromNoQtySo ? "last shortage" : "balance"} {fmtProdQty(rem)}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </FieldShortcutHint>
                {fromNoQtySo && selected && selectedMetrics ? (
                  <div className="flex flex-wrap items-stretch gap-1">
                    <OperatorMetricBadge label="Planned qty" value={fmtProdQty(selectedMetrics.woLineQty)} />
                    <OperatorMetricBadge label="Produced qty" value={fmtProdQty(selectedMetrics.usedQty)} />
                    <OperatorMetricBadge
                      label="Last shortage Qty"
                      value={fmtProdQty(selectedMetrics.remainingQty)}
                    />
                  </div>
                ) : null}
              </OperatorTopBar>

              <div className="grid gap-3 lg:grid-cols-[45%_55%]">
                <div className="min-w-0">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-[12px] font-semibold text-slate-600">
                        {focusSoIdValid ? "Current cycle work" : "Work queue"}
                      </h3>
                      <span className="text-[11px] text-slate-400">▶ selects row{focusSoIdValid ? " · This SO/cycle" : ""}</span>
                    </div>
                    <div className="max-h-[min(38vh,280px)] overflow-auto rounded border border-slate-200 bg-white">
                      <table className="w-full text-[12px]">
                        <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                          <tr className="text-left text-[11px] text-slate-600">
                            {navigateNoQtyContext ? null : <th className="px-2 py-0.5 font-medium">WO</th>}
                            <th className="px-2 py-0.5 font-medium">Item</th>
                            <th className="px-2 py-0.5 text-right font-medium">Planned</th>
                            <th className="px-2 py-0.5 text-right font-medium">Produced</th>
                            <th className="px-2 py-0.5 text-right font-medium">Balance</th>
                            <th className="w-10 px-1 py-0.5 text-right font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedFlatLines.map((l) => {
                            const approved = l.approvedProducedQty ?? 0;
                            const rem = lineRemaining(l);
                            const sel = wolId === l.id;
                            return (
                              <tr
                                key={l.id}
                                className={cn(
                                  "border-t border-slate-100 py-0.5 transition-colors hover:bg-slate-50/90",
                                  sel && "bg-emerald-50 ring-1 ring-inset ring-emerald-200/80",
                                )}
                              >
                                {navigateNoQtyContext ? null : (
                                  <td className="px-2 py-0.5 tabular-nums">#{l.workOrderId}</td>
                                )}
                                <td className="max-w-[11rem] truncate px-2 py-0.5 font-medium" title={l.fgItem.itemName}>
                                  {l.fgItem.itemName}
                                </td>
                                <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(Number(l.qty))}</td>
                                <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(approved)}</td>
                                <td className="px-2 py-0.5 text-right font-semibold tabular-nums">{fmtProdQty(rem)}</td>
                                <td className="px-1 py-0.5 text-right">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 shrink-0 p-0 text-[13px]"
                                    onClick={() => applyLine(l)}
                                    aria-label={`Select ${l.fgItem.itemName}`}
                                  >
                                    ▶
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="space-y-3">
                    <div className="text-[12px] font-semibold tracking-tight text-slate-700">
                      {navigateNoQtyContext ? "Continue Production" : "Log production"}
                    </div>
                    {fromNoQtySo && selected ? (
                      <p className="text-[12px] text-slate-600">
                        <span className="font-medium text-slate-800">{selected.fgItem.itemName}</span>
                        <span className="text-slate-400"> · </span>
                        <span className="font-medium text-slate-700">
                          {displaySalesOrderNo(focusSoIdValid ? focusSoId : selected.salesOrderId, focusSo?.docNo)}
                        </span>
                        <span className="text-slate-400"> · </span>
                        <span className="font-medium text-slate-700">
                                Cycle {noQtyCycleNoForDisplay != null ? `#${noQtyCycleNoForDisplay}` : "—"}
                        </span>
                      </p>
                    ) : null}
                    {selectedMetrics ? (
                      <div className="grid grid-cols-3 gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px]">
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-slate-600">Planned</div>
                          <div className="font-semibold tabular-nums text-slate-900">{fmtProdQty(selectedMetrics.woLineQty)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-slate-600">Produced</div>
                          <div className="font-semibold tabular-nums text-slate-900">{fmtProdQty(selectedMetrics.usedQty)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-slate-600">
                            {navigateNoQtyContext ? "Remaining" : fromNoQtySo ? "Last shortage Qty" : "Remaining"}
                          </div>
                          <div className="font-semibold tabular-nums text-slate-900">{fmtProdQty(selectedMetrics.remainingQty)}</div>
                        </div>
                      </div>
                    ) : null}
                    <div className="erp-form-field w-fit max-w-full">
                      <span className="text-[12px] font-medium text-slate-600">Date</span>
                      <Input
                        type="date"
                        className={cn("mt-0.5 w-[11rem] tabular-nums text-[13px]", operatorInputClass)}
                        value={prodDate}
                        onChange={(e) => setProdDate(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <FieldShortcutHint
                        show={shortcutHints.activeFieldId === "prodQty"}
                        hint={shortcutHints.activeFieldHintText ?? ""}
                        placement="below-end"
                        className="w-[12rem] shrink-0"
                      >
                        <div className="erp-form-field min-w-0">
                          <span className="text-[12px] font-medium text-slate-600">Produced qty</span>
                          <Input
                            ref={producedQtyRef}
                            {...prodQtyBind}
                            type="text"
                            data-testid="production-qty-input"
                            inputMode="decimal"
                            autoComplete="off"
                            className={cn("mt-0.5 h-10 tabular-nums text-[16px] font-semibold", operatorInputClass)}
                            placeholder="Qty"
                            value={producedQtyStr}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                                shortcutHints.markFieldShortcutUsed("prodQty");
                              }
                            }}
                          />
                          {selectedMetrics ? (
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {fromNoQtySo ? (
                                <>
                                  WO line headroom (informational). Last shortage Qty{" "}
                                  <span className="font-medium tabular-nums text-slate-700">
                                    {fmtProdQty(selectedMetrics.remainingQty)}
                                  </span>{" "}
                                  can roll to the next RS if the cycle closes with open work.
                                </>
                              ) : (
                                <>
                                  Remaining allowed:{" "}
                                  <span className="font-medium tabular-nums text-slate-700">
                                    {fmtProdQty(selectedMetrics.remainingQty)}
                                  </span>
                                </>
                              )}
                            </p>
                          ) : null}
                          {wolId > 0 && !producedQtyValid ? (
                            <p className="mt-0.5 text-[11px] font-medium text-amber-800">Enter produced quantity.</p>
                          ) : null}
                        </div>
                      </FieldShortcutHint>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn("h-10 shrink-0 text-[13px]", operatorInputClass)}
                        disabled={posting || !selectedMetrics || selectedMetrics.remainingQty <= 0}
                        onClick={() => {
                          producedQtyUserTouchedRef.current = true;
                          setProducedQtyStr(fmtProdQty(selectedMetrics?.remainingQty ?? 0));
                        }}
                      >
                        Use full
                      </Button>
                      <FieldShortcutHint
                        show={shortcutHints.activeFieldId === "prodSave"}
                        hint={shortcutHints.activeFieldHintText ?? ""}
                        placement="above"
                        className="inline-block shrink-0"
                      >
                        <Button
                          type="submit"
                          size="sm"
                          data-testid="save-production-btn"
                          className={cn("h-10 shrink-0 px-4 text-[14px] font-semibold", operatorInputClass)}
                          onFocus={prodSaveFocusBind.onFocus}
                          onBlur={prodSaveFocusBind.onBlur}
                          onClick={() => shortcutHints.markFieldShortcutUsed("prodSave")}
                          disabled={posting || !createFormCanSubmit}
                          {...(prodDemoHl ? { "data-demo-highlight": prodDemoHl } : {})}
                        >
                          {posting ? "Saving…" : "Save draft"}
                        </Button>
                      </FieldShortcutHint>
                    </div>
                    {productionWarnings.length > 0 ? (
                      <ul className="space-y-0.5 text-[11px] font-medium text-amber-900">
                        {productionWarnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          )}
        </form>
      )}

      {!placeDraftInNoQtyPrimaryCard &&
      !placeDraftAfterRegularProductionCard &&
      !productionPrimaryStripCoversDraft &&
      !(fromNoQtySo && !showNoQtyScopedProductionCard && flatLines.length > 0 && canProd) ? (
        <div className="mb-1.5">{renderDraftProductionBanner({ compact: true })}</div>
      ) : null}

      <Card
        className={cn(
          "erp-op-workspace-secondary min-w-0 overflow-hidden",
          !fromNoQtySo && flatLines.length > 0 && "mt-1",
        )}
      >
        <CardHeader
          className={cn(
            "border-b border-slate-100/80 bg-slate-50/40 px-3",
            navigateNoQtyContext ? "py-1.5" : "py-1",
          )}
        >
          <CardTitle className="text-[12px] font-semibold text-slate-600">
            {showProductionWorkspace ? "Recent Production Entries" : "Production entries"}
          </CardTitle>
        </CardHeader>
        <CardContent className={cn("space-y-2 px-3 py-2", !navigateNoQtyContext && "px-0 pb-2 pt-0")}>
          <div
            className={cn(
              "flex flex-wrap items-end gap-2 border-b border-slate-100 bg-white px-3 py-1.5",
              !navigateNoQtyContext && "sticky top-0 z-[2] shadow-[0_1px_0_rgba(15,23,42,0.05)]",
            )}
          >
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Show
              <select
                className={cn(
                  "erp-flow-filter-input rounded-md border border-slate-200 bg-white px-2.5 text-sm",
                  navigateNoQtyContext ? "h-9" : "h-8",
                )}
                value={entryFilter}
                onChange={(e) => setEntryFilter(e.target.value as typeof entryFilter)}
              >
                <option value="ALL">All</option>
                <option value="DRAFT">Draft</option>
                <option value="APPROVED">Posted (QC)</option>
              </select>
            </label>
          </div>
          {(() => {
            const cycleScoped =
              navigateNoQtyContext && focusSoIdValid && effectiveNoQtyCycleId != null
                ? visibleEntries.filter(
                    (r) => Number((r as any)?.workOrderLine?.workOrder?.cycleId ?? 0) === Number(effectiveNoQtyCycleId),
                  )
                : visibleEntries;
            const older =
              navigateNoQtyContext && focusSoIdValid && effectiveNoQtyCycleId != null
                ? visibleEntries.filter(
                    (r) => Number((r as any)?.workOrderLine?.workOrder?.cycleId ?? 0) !== Number(effectiveNoQtyCycleId),
                  )
                : [];

            const table = (rowsToShow: ProdEntryRow[]) => {
              const rowsOrdered =
                navigateNoQtyContext
                  ? rowsToShow
                  : [...rowsToShow].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
              return !rowsOrdered.length ? (
                <p className="text-xs leading-snug text-slate-600">
                  {workOrders.length === 0 ? "Create a work order to begin production." : "No production entries yet."}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="table-fixed w-full min-w-[880px] border-collapse text-[12px]">
                    <colgroup>
                      <col className="w-[110px]" />
                      <col className="w-[70px]" />
                      {navigateNoQtyContext ? <col className="w-[72px]" /> : null}
                      <col className="w-[70px]" />
                      <col className="w-[160px]" />
                      <col className="w-[100px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[70px]" />
                    </colgroup>
                    <thead className="border-b border-slate-200 bg-slate-50 shadow-[0_1px_0_rgba(15,23,42,0.06)]">
                      <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-1 text-left font-medium">Date</th>
                        {navigateNoQtyContext ? null : <th className="px-1 py-1 text-center font-medium">WO</th>}
                        {navigateNoQtyContext ? (
                          <th className="px-1 py-1 text-center font-medium">Cycle</th>
                        ) : null}
                        <th className="px-1 py-1 text-center font-medium">SO</th>
                        <th className="min-w-0 px-2 py-1 text-left font-medium">Item</th>
                        <th className="px-1 py-1 text-center font-medium">SO Type</th>
                        <th className="px-2 py-1 text-right font-medium">Produced</th>
                        <th className="px-1 py-1 text-center font-medium">Status</th>
                        <th className="px-1 py-1 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowsOrdered.map((r, idx) => (
                        <tr
                          key={r.id}
                          className={cn(
                            "border-b border-slate-100 transition-colors hover:bg-slate-50/90",
                            !navigateNoQtyContext && "[&_td]:py-0.5",
                            idx === 0 && isDraft(r) && "bg-amber-50/60",
                            idx === 0 && !navigateNoQtyContext && !isDraft(r) && "bg-sky-50/60",
                          )}
                        >
                          <td className="whitespace-nowrap px-2 py-1 align-middle tabular-nums text-slate-700">
                            {new Date(r.date).toLocaleDateString()}
                          </td>
                          {navigateNoQtyContext ? null : (
                            <td className="px-1 py-1 text-center align-middle tabular-nums text-[12px] text-slate-800">
                              #{r.workOrderLine.workOrder.id}
                            </td>
                          )}
                          {navigateNoQtyContext ? (
                            <td className="px-1 py-1 text-center align-middle tabular-nums text-[11px] text-slate-700">
                              {r.workOrderLine.workOrder.cycle?.cycleNo != null
                                ? Number(r.workOrderLine.workOrder.cycle.cycleNo)
                                : "—"}
                            </td>
                          ) : null}
                          <td className="px-1 py-1 text-center align-middle tabular-nums text-[12px] text-slate-800">
                            #{r.workOrderLine.workOrder.salesOrderId}
                          </td>
                          <td className="min-w-0 px-2 py-1 align-middle">
                            <div className="truncate text-[12px] text-slate-800" title={r.workOrderLine.fgItem.itemName}>
                              {r.workOrderLine.fgItem.itemName}
                            </div>
                          </td>
                          <td className="px-1 py-1 text-center align-middle">
                            {(() => {
                              const ui = productionSoTypeUi(r);
                              if (ui.kind === "muted") {
                                return (
                                  <span className="text-[11px] tabular-nums text-slate-400">{ui.text}</span>
                                );
                              }
                              if (ui.variant === "no_qty") {
                                return (
                                  <Badge className="border-violet-200 bg-violet-50 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-violet-800">
                                    NO_QTY
                                  </Badge>
                                );
                              }
                              return (
                                <Badge variant="info" className="px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide">
                                  REGULAR
                                </Badge>
                              );
                            })()}
                          </td>
                          <td className="px-2 py-1 text-right align-middle text-[12px] font-bold tabular-nums text-slate-900">
                            {Number(r.producedQty)}
                          </td>
                          <td className="px-1 py-1 text-center align-middle">
                            {isDraft(r) ? (
                              <Badge variant="warning" className="px-1.5 py-0 text-[10px] font-medium">
                                Draft
                              </Badge>
                            ) : qcCompleted(r) ? (
                              <Badge variant="success" className="px-1.5 py-0 text-[10px] font-medium">
                                QC Done
                              </Badge>
                            ) : (
                              <Badge variant="warning" className="px-1.5 py-0 text-[10px] font-medium">
                                Pending QC
                              </Badge>
                            )}
                          </td>
                          <td className="px-1 py-1 text-right align-middle">
                            {canProd && isDraft(r) ? (
                              showCompactDraftApprovalStrip &&
                              latestDraftForSelectedWo &&
                              r.id === latestDraftForSelectedWo.latest.id ? (
                                <span className="inline-block text-[10px] font-medium text-slate-400">
                                  <span className="sr-only">Approve, edit, or cancel from the banner above.</span>—
                                </span>
                              ) : (
                                <div className="erp-table-actions">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 max-w-[70px] px-1.5 text-[10px]"
                                    disabled={rowBusy === r.id}
                                    onClick={() => openEdit(r)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="h-7 max-w-[70px] px-1.5 text-[10px]"
                                    disabled={rowBusy === r.id}
                                    onClick={() => approveDraft(r.id)}
                                  >
                                    {renderApproveButtonLabel(r.id, "Approve", true)}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    className="h-7 max-w-[70px] px-1.5 text-[10px]"
                                    disabled={rowBusy === r.id}
                                    onClick={() => deleteDraft(r.id)}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              )
                            ) : isApproved(r) && qcPendingEntry(r) ? (
                              <div className="flex flex-col items-end gap-1">
                                {/*
                                 * Per-batch "Go to QC" link. Hidden when the page-level top
                                 * QC strip ({@link suppressDuplicateQcWorkflowUi}) already
                                 * surfaces the same action — operators only see one canonical
                                 * QC CTA per screen state, never two.
                                 */}
                                {!suppressDuplicateQcWorkflowUi ? (
                                  <Link
                                    to={qcEntryHrefForEntry(r)}
                                    className={cn(
                                      buttonVariants({ variant: "secondary", size: "sm" }),
                                      "inline-flex h-7 max-w-[70px] items-center justify-center px-1.5 text-[10px]",
                                    )}
                                  >
                                    {PRODUCTION_QA_TERMS.COMPLETE_QA}
                                  </Link>
                                ) : null}
                                {canOfferProductionReverse(r, isAdmin) ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 max-w-[70px] border-slate-300 px-1.5 text-[10px] font-normal text-slate-600 hover:bg-slate-50"
                                    disabled={rowBusy === r.id}
                                    onClick={() => openReverseModal(r)}
                                  >
                                    {rowBusy === r.id ? "…" : "Reverse"}
                                  </Button>
                                ) : null}
                              </div>
                            ) : isApproved(r) && qcCompleted(r) ? (
                              <span className="text-[11px] text-slate-400">—</span>
                            ) : (
                              <span className="text-[11px] text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            };

            return (
              <div className={cn("space-y-2", !navigateNoQtyContext && "px-3")}>
                {fromNoQtySo && focusSoIdValid ? (
                  <div className="text-[11px] font-semibold text-slate-600">Current cycle work</div>
                ) : null}
                {table(cycleScoped)}
                {fromNoQtySo && focusSoIdValid && older.length > 0 ? (
                  <details className="mt-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <summary className="cursor-pointer text-[12px] font-medium text-slate-700">
                      Older production history ({older.length})
                    </summary>
                    <div className="mt-2">{table(older)}</div>
                  </details>
                ) : null}
              </div>
            );
          })()}

          {editing && canProd && !navigateNoQtyContext ? (
            <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2">
              <div className="mb-2 text-[13px] font-medium text-slate-800">Edit draft #{editing.id}</div>
              <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
                <label className="grid gap-1 text-[12px]">
                  <span className="text-slate-600">Date</span>
                  <Input
                    className={operatorInputClass}
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-[12px]">
                  <span className="text-slate-600">Produced qty</span>
                  <Input
                    className={operatorInputClass}
                    type="number"
                    min={0.001}
                    step="any"
                    value={editQty}
                    onChange={(e) => setEditQty(toNumberDraft(e.target.value))}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-[13px]"
                    onClick={saveEditDraft}
                    disabled={editSaving}
                  >
                    {editSaving ? "Saving…" : "Save changes"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-[13px]"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {reverseModalEntry && isAdmin ? (
        <ErpModal onClose={closeReverseModal} closeOnBackdropClick aria-labelledby="prod-admin-reverse-title">
          <div className="w-full max-w-lg rounded-xl border border-slate-200/90 bg-white p-4 shadow-xl sm:p-5">
            <h2 id="prod-admin-reverse-title" className="text-base font-semibold leading-snug text-slate-900">
              Admin Reversal
            </h2>
            {(() => {
              const producedSafe = reversibleProductionQty(reverseModalEntry);
              const alreadyReversed = 0;
              const available = Math.max(0, producedSafe - alreadyReversed);
              return (
                <div className="mt-3 space-y-3 text-sm">
                  <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-[12px]">
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      <div className="min-w-0">
                        <span className="text-[11px] font-medium text-slate-500">Production #</span>
                        <div className="font-mono text-[13px] font-semibold text-slate-900">#{reverseModalEntry.id}</div>
                      </div>
                      {navigateNoQtyContext ? null : (
                        <div className="min-w-0">
                          <span className="text-[11px] font-medium text-slate-500">WO #</span>
                          <div className="font-mono text-[13px] font-semibold text-slate-900">
                            #{reverseModalEntry.workOrderLine.workOrder.id}
                          </div>
                        </div>
                      )}
                      <div className="min-w-0 sm:col-span-2">
                        <span className="text-[11px] font-medium text-slate-500">Item</span>
                        <div className="truncate text-[13px] text-slate-900" title={reverseModalEntry.workOrderLine.fgItem.itemName}>
                          {reverseModalEntry.workOrderLine.fgItem.itemName}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11px] font-medium text-slate-500">Produced qty</span>
                        <div className="tabular-nums text-[13px] font-medium text-slate-900">{fmtProdQty(producedSafe)}</div>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11px] font-medium text-slate-500">Available to reverse</span>
                        <div className="tabular-nums text-[13px] font-semibold text-slate-900">{fmtProdQty(available)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-1">
                    <label className="text-[11px] font-medium text-slate-600" htmlFor="prod-reverse-qty">
                      Reverse Qty <span className="font-normal text-slate-500">(required)</span>
                    </label>
                    <Input
                      id="prod-reverse-qty"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      className="h-9 tabular-nums text-sm"
                      value={reverseQtyDraft}
                      onChange={(e) => {
                        setReverseQtyDraft(e.target.value);
                        setReverseModalError(null);
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 text-xs"
                      onClick={reverseModalFillFull}
                      disabled={rowBusy === reverseModalEntry.id}
                    >
                      Reverse Full
                    </Button>
                  </div>

                  <div className="grid gap-1">
                    <label className="text-[11px] font-medium text-slate-600" htmlFor="prod-reverse-reason">
                      Reason <span className="font-normal text-slate-500">(required)</span>
                    </label>
                    <Input
                      id="prod-reverse-reason"
                      type="text"
                      autoComplete="off"
                      className="h-9 text-sm"
                      placeholder="Why this reversal"
                      value={reverseReasonDraft}
                      onChange={(e) => {
                        setReverseReasonDraft(e.target.value);
                        setReverseModalError(null);
                      }}
                    />
                  </div>

                  {reverseModalError ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-900">{reverseModalError}</p>
                  ) : null}

                  <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                    <Button type="button" variant="outline" className="h-9" onClick={closeReverseModal}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      className="h-9"
                      disabled={rowBusy === reverseModalEntry.id}
                      onClick={() => void confirmReverseModal()}
                    >
                      {rowBusy === reverseModalEntry.id ? "Working…" : "Confirm Reverse"}
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        </ErpModal>
      ) : null}
    </OperatorPageBody>
  );

  /** REGULAR approve modal — must render on every branch (REGULAR early returns omitted it previously). */
  const rmConsumptionApproveModal = (
    <ProductionRmConsumptionReviewModal
      open={consumptionApproveId != null}
      productionEntryId={consumptionApproveId}
      onClose={closeConsumptionApproveModal}
      onPreviewSettled={onConsumptionPreviewSettled}
      onApproved={(res) => {
        setConsumptionApproveId((openId) => {
          if (openId != null) {
            const approvedRow = entries.find((e) => e.id === openId);
            setRowBusy(openId);
            void afterProductionApproveSuccess(openId, approvedRow, res.consumptionWarnings).finally(
              () => setRowBusy(null),
            );
          }
          return null;
        });
      }}
    />
  );

  /**
   * Identity resolving state — placed BEFORE the REGULAR branch return.
   *
   * For NO_QTY deep-links that omit `source=no_qty_so` (e.g. `/production?salesOrderId=X` or
   * `/production?workOrderId=Y` from older callers, dispatch, QC, or RM check), the page used
   * to flash the REGULAR FLOW badge for one render before async identity recovery flipped to
   * NO_QTY. Holding this thin loading state until identity settles eliminates that flicker.
   *
   * Explicit `source=no_qty_so` URLs and definitive REGULAR resolutions bypass this guard.
   */
  if (productionIdentityUnresolved) {
    return (
      <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-2 pb-2">
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-testid="production-identity-resolving"
          className="mx-auto mt-6 flex max-w-md items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-700 shadow-sm"
        >
          <span
            aria-hidden
            className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
          />
          <span>Resolving production context&hellip;</span>
        </div>
      </PageContainer>
    );
  }

  if (productionFlowMode !== "NO_QTY") {
    if (showProductionWorkspace) {
      return (
        <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-1.5">
          <OperationalContextSticky className="sticky top-0 z-20 space-y-1 border-b border-slate-200/90 bg-white/95 pb-1.5 pt-0.5 shadow-sm backdrop-blur-sm">
            <DemoFlowBanner />
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <PageSmartBackLink defaultTo="/dashboard" defaultLabel="Back to Dashboard" />
                <h1 className="text-sm font-semibold leading-tight tracking-tight text-slate-900">Production Workspace</h1>
                <p className="text-[11px] leading-snug text-slate-600">
                  Active shop-floor work across REGULAR and NO_QTY.
                </p>
              </div>
              {canProd ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  title="Keyboard shortcuts (?)"
                  aria-label="Keyboard shortcuts"
                  onClick={() => setKbHelpOpen(true)}
                >
                  <Keyboard className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </OperationalContextSticky>
          {main}
          {rmConsumptionApproveModal}
        </PageContainer>
      );
    }
    return (
      <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-1.5">
        {kbHelpOpen && canProd ? (
          <ErpModal onClose={() => setKbHelpOpen(false)} aria-label="Keyboard shortcuts">
            <Card className="erp-modal-shell-md max-w-[640px] overflow-hidden">
              <CardHeader className="space-y-0.5 border-b border-slate-100 bg-slate-50 px-4 py-3">
                <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Keyboard shortcuts</CardTitle>
                <p className="text-[11px] text-slate-600">Press ? to toggle. Esc to close.</p>
              </CardHeader>
              <CardContent className="p-4">
                <div className="rounded-md border border-slate-200">
                  <table className="w-full text-[12px]">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2">Keys</th>
                        <th className="px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PRODUCTION_SHORTCUT_BAR.map((it, idx) => (
                        <tr key={`${it.keys}-${it.action}-${idx}`} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{it.keys}</td>
                          <td className="px-3 py-2 text-slate-700">{it.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="outline" className="h-9" onClick={() => setKbHelpOpen(false)}>
                    Close
                  </Button>
                </div>
              </CardContent>
            </Card>
          </ErpModal>
        ) : null}
        <OperationalContextSticky className="sticky top-0 z-20 space-y-1 border-b border-slate-200/90 bg-white/95 pb-1.5 pt-0.5 shadow-sm backdrop-blur-sm">
          <DemoFlowBanner />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium leading-tight text-slate-900"
              aria-label="Workflow location"
            >
              {productionRegularBackNav ? (
                <Link
                  to={productionRegularBackNav.to}
                  className="text-sky-900 underline decoration-sky-700/40 underline-offset-2 hover:decoration-sky-800"
                >
                  ← {productionRegularBackNav.label}
                </Link>
              ) : (
                <PageSmartBackLink defaultTo="/work-orders" defaultLabel="Back to Work Orders" />
              )}
              <span className="text-slate-300" aria-hidden>
                /
              </span>
              {isRegularShellNoQtyUi && roleUi.showProductionPlanningBreadcrumb && !openedFromWorkOrderWorkspace ? (
                <>
                  {regularShellRsHref ? (
                    <Link
                      to={regularShellRsHref}
                      className="text-sky-900 underline decoration-sky-700/40 underline-offset-2 hover:decoration-sky-800"
                    >
                      Requirement Sheet
                    </Link>
                  ) : (
                    <span className="font-semibold text-slate-800">Requirement Sheet</span>
                  )}
                  <span className="text-slate-300" aria-hidden>
                    /
                  </span>
                </>
              ) : null}
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {(() => {
                  const id = woId > 0 ? woId : activeWoForRegularShell?.id ?? 0;
                  if (!(id > 0)) return "—";
                  return displayWorkOrderNo(id, activeWoForRegularShell?.docNo ?? null);
                })()}
              </span>
              <span className="text-slate-300" aria-hidden>
                /
              </span>
              <span className="font-semibold text-slate-950">Production</span>
            </nav>
            {canProd ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                title="Keyboard shortcuts (?)"
                aria-label="Keyboard shortcuts"
                onClick={() => setKbHelpOpen(true)}
              >
                <Keyboard className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          {roleUi.showProductionWorkflowTrail ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            {isRegularShellNoQtyUi ? (
              <span className="rounded border border-violet-300 bg-violet-100 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-violet-950">
                NO_QTY FLOW
              </span>
            ) : (
              <span className="rounded bg-slate-900 px-1.5 py-0.5 text-white">Regular flow</span>
            )}
            <span className="font-normal normal-case tracking-normal text-slate-500">
              {isRegularShellNoQtyUi ? (
                <>
                  Requirement Sheet → Work Order → <span className="font-semibold text-slate-800">Production</span>
                </>
              ) : (
                <>
                  Sales Order → Work Order → <span className="font-semibold text-slate-800">Production</span>
                </>
              )}
            </span>
            {isRegularShellNoQtyUi ? (
              <>
                <span className="hidden sm:inline text-slate-300" aria-hidden>
                  ·
                </span>
                <span className="font-normal normal-case tracking-normal text-slate-500">
                  Cycle{" "}
                  <span className="font-mono font-semibold tabular-nums text-slate-800">
                    {activeWoForRegularShell?.cycle?.cycleNo != null
                      ? Number(activeWoForRegularShell.cycle.cycleNo)
                      : "—"}
                  </span>
                  {" · RS "}
                  <span className="font-mono font-semibold tabular-nums text-slate-800">
                    {activeWoForRegularShell?.requirementSheetId != null &&
                    Number(activeWoForRegularShell.requirementSheetId) > 0
                      ? displayRequirementSheetNo(
                          Number(activeWoForRegularShell.requirementSheetId),
                          null,
                        )
                      : "—"}
                  </span>
                  {" · "}
                  <span className="font-mono font-semibold tabular-nums text-slate-800">
                    {(() => {
                      const id = woId > 0 ? woId : activeWoForRegularShell?.id ?? 0;
                      if (!(id > 0)) return "—";
                      return displayWorkOrderNo(id, activeWoForRegularShell?.docNo ?? null);
                    })()}
                  </span>
                </span>
              </>
            ) : null}
            <span className="hidden sm:inline text-slate-300" aria-hidden>
              ·
            </span>
            <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-semibold normal-case tracking-normal text-violet-950">
              Current stage: {regularWorkflowStageLabel}
            </span>
          </div>
          ) : null}
          {selected && Number(selected.salesOrderId) > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold">
              <Link
                className="text-sky-900 underline-offset-2 hover:underline"
                to={`/work-orders?salesOrderId=${encodeURIComponent(String(selected.salesOrderId))}&from=production`}
              >
                View WO list
              </Link>
              {isRegularShellNoQtyUi && regularShellRsHref && roleUi.showProductionPlanningBreadcrumb ? (
                <Link className="text-sky-900 underline-offset-2 hover:underline" to={regularShellRsHref}>
                  Requirement Sheet
                </Link>
              ) : !isRegularShellNoQtyUi ? (
                <Link
                  className="text-sky-900 underline-offset-2 hover:underline"
                  to={`/sales-orders?salesOrderId=${encodeURIComponent(String(selected.salesOrderId))}`}
                >
                  Sales Order
                </Link>
              ) : null}
              {regularQcBannerHref && !showTopQcNextStrip && selectedLineQcPending ? (
                /*
                 * Breadcrumb "Open QC" link. Hidden when the page-level top QC strip already
                 * exposes the same action — keeps a single canonical QC CTA per screen state.
                 */
                <Link className="text-sky-900 underline-offset-2 hover:underline" to={regularQcBannerHref}>
                  {PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA}
                </Link>
              ) : qcBannerHref && !showTopQcNextStrip && navigateNoQtyContext ? (
                <Link className="text-sky-900 underline-offset-2 hover:underline" to={qcBannerHref}>
                  {PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA}
                </Link>
              ) : null}
              {selectedMetrics &&
              selectedMetrics.remainingQty > 1e-6 &&
              !latestDraftForSelectedWo &&
              !draftApprovalPendingRegular &&
              canProd &&
              !rmProductionEntryBlocked &&
              !(isRegularShellNoQtyUi && noQtyNextRsReady) ? (
                <button
                  type="button"
                  className="text-left text-sky-900 underline-offset-2 hover:underline"
                  onClick={() => {
                    document.getElementById("regular-production-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    window.setTimeout(() => producedQtyRef.current?.focus(), 120);
                  }}
                >
                  Continue production
                </button>
              ) : null}
            </div>
          ) : null}
          {navigateNoQtyContext || showProductionWorkspace ? (
          <OperationalContextBar className="rounded-md border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-2 py-1 shadow-sm">
            <span className="font-semibold text-slate-600">SO</span>
            <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-sky-900">
              {(() => {
                const soId =
                  selected?.salesOrderId ??
                  productionStickyContext?.salesOrderId ??
                  0;
                if (!(soId > 0)) return "—";
                const soDoc =
                  selected && selected.salesOrderId === focusSoId
                    ? focusSo?.docNo
                    : productionStickyContext?.soDocNo ?? (soId === focusSoId ? focusSo?.docNo : null);
                return displaySalesOrderNo(soId, soDoc);
              })()}
            </span>
            {isRegularShellNoQtyUi ? (
              <>
                <OpCtxSep />
                <span className="text-slate-500">Cycle</span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {activeWoForRegularShell?.cycle?.cycleNo != null
                    ? Number(activeWoForRegularShell.cycle.cycleNo)
                    : "—"}
                </span>
                <OpCtxSep />
                <span className="text-slate-500">RS</span>
                <span className="rounded border border-violet-200 bg-violet-50/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-violet-950">
                  {activeWoForRegularShell?.requirementSheetId != null &&
                  Number(activeWoForRegularShell.requirementSheetId) > 0
                    ? displayRequirementSheetNo(Number(activeWoForRegularShell.requirementSheetId), null)
                    : "—"}
                </span>
              </>
            ) : null}
            <OpCtxSep />
            <span className="font-semibold text-slate-600">WO</span>
            <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-900">
              {(() => {
                const id =
                  woId > 0
                    ? woId
                    : selected?.workOrderId ??
                      productionStickyContext?.workOrderId ??
                      activeWoForRegularShell?.id ??
                      0;
                if (!(id > 0)) return "—";
                const woDoc =
                  activeWoForRegularShell?.id === id
                    ? activeWoForRegularShell?.docNo
                    : productionStickyContext?.woDocNo ??
                      workOrders.find((w) => w.id === id)?.docNo ??
                      null;
                return displayWorkOrderNo(id, woDoc);
              })()}
            </span>
            <OpCtxSep />
            <span className="text-slate-500">Item</span>
            <span className="max-w-[12rem] truncate font-semibold text-slate-900">
              {selected?.fgItem.itemName ?? productionStickyContext?.itemName ?? "—"}
            </span>
            <OpCtxSep />
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Status
            </span>
            <span className="font-semibold text-slate-900">
              {isRegularShellNoQtyUi && noQtyCycleDisplayStatus
                ? noQtyCycleDisplayStatus.label
                : regularWorkflowStageLabel}
            </span>
            {displayHeaderMetrics && (selected || productionStickyContext) ? (
              <>
                <OpCtxSep />
                <span className="text-slate-500">Planned</span>
                <span className="font-bold tabular-nums text-slate-900">{fmtProdQty(displayHeaderMetrics.woLineQty)}</span>
                <OpCtxSep />
                <span className="text-slate-500">Produced</span>
                <span className="font-bold tabular-nums text-slate-900">{fmtProdQty(displayHeaderMetrics.usedQty)}</span>
                <OpCtxSep />
                <span className="text-emerald-800">Remaining</span>
                <span className="font-bold tabular-nums text-emerald-950">{fmtProdQty(displayHeaderMetrics.remainingQty)}</span>
              </>
            ) : null}
          </OperationalContextBar>
          ) : null}
        </OperationalContextSticky>
        {main}
        {rmConsumptionApproveModal}
      </PageContainer>
    );
  }
  return (
    <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-2">
      {kbHelpOpen && canProd ? (
        <ErpModal onClose={() => setKbHelpOpen(false)} aria-label="Keyboard shortcuts">
          <Card className="erp-modal-shell-md max-w-[640px] overflow-hidden">
            <CardHeader className="space-y-0.5 border-b border-slate-100 bg-slate-50 px-4 py-3">
              <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Keyboard shortcuts</CardTitle>
              <p className="text-[11px] text-slate-600">Press ? to toggle. Esc to close.</p>
            </CardHeader>
            <CardContent className="p-4">
              <div className="rounded-md border border-slate-200">
                <table className="w-full text-[12px]">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Keys</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRODUCTION_SHORTCUT_BAR.map((it, idx) => (
                      <tr key={`${it.keys}-${it.action}-${idx}`} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{it.keys}</td>
                        <td className="px-3 py-2 text-slate-700">{it.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="outline" className="h-9" onClick={() => setKbHelpOpen(false)}>
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}
      <OperationalContextSticky className="space-y-1">
        <PageNoQtyFlowBackLink step="PRODUCTION" />
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <h1 className="text-sm font-semibold leading-tight tracking-tight text-slate-900">Production</h1>
            <p className="text-[11px] leading-snug text-slate-600">Record output and track progress.</p>
          </div>
          {canProd ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-[11px]"
              onClick={() => setKbHelpOpen(true)}
            >
              ? Keys
            </Button>
          ) : null}
        </div>
        {showNoQtyScopedProductionCard ? (
          <OperationalContextBar className="rounded-md border border-slate-200/90 bg-gradient-to-r from-slate-50 to-white px-2.5 py-1.5 text-[11px] text-slate-800 shadow-sm">
            <span className="font-mono font-semibold tabular-nums text-slate-900">
              {displaySalesOrderNo(noQtyWorkbenchSoId, focusSo?.docNo ?? null)}
            </span>
            <OpCtxSep />
            <span>
              Cycle{" "}
              <span className="font-bold tabular-nums text-slate-950">
                {noQtyCycleNoForDisplay != null ? noQtyCycleNoForDisplay : "—"}
              </span>
            </span>
            <OpCtxSep />
            <span>
              RS{" "}
              <span className="font-mono font-semibold tabular-nums text-violet-950">
                {selectedWoForNoQtyChrome?.requirementSheetId != null &&
                Number(selectedWoForNoQtyChrome.requirementSheetId) > 0
                  ? displayRequirementSheetNo(Number(selectedWoForNoQtyChrome.requirementSheetId), null)
                  : "—"}
              </span>
            </span>
            <OpCtxSep />
            <span className="font-mono font-semibold tabular-nums">
              {woId > 0 ? displayWorkOrderNo(woId, selectedWoForNoQtyChrome?.docNo ?? null) : "—"}
            </span>
            <OpCtxSep />
            <span className="max-w-[10rem] truncate font-semibold text-slate-900" title={selected?.fgItem.itemName ?? ""}>
              {selected?.fgItem.itemName ?? "—"}
            </span>
            {selectedMetrics ? (
              <>
                <OpCtxSep />
                <span>
                  Planned <span className="font-bold tabular-nums">{fmtProdQty(selectedMetrics.woLineQty)}</span>
                </span>
                <OpCtxSep />
                <span>
                  Produced <span className="font-bold tabular-nums">{fmtProdQty(selectedMetrics.usedQty)}</span>
                </span>
                {noQtyDisplayOperatorPendingQty != null ? (
                  <>
                    <OpCtxSep />
                    <span className="text-amber-900">
                      Remaining qty{" "}
                      <span className="font-bold tabular-nums text-amber-950">
                        {fmtProdQty(noQtyDisplayOperatorPendingQty)}
                      </span>
                    </span>
                  </>
                ) : null}
              </>
            ) : null}
            {noQtyCycleDisplayStatus ? (
              <>
                <OpCtxSep />
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Status
                </span>
                <span className="font-semibold text-slate-900">{noQtyCycleDisplayStatus.label}</span>
              </>
            ) : null}
          </OperationalContextBar>
        ) : navigateNoQtyContext && focusSoIdValid ? (
          <NoQtyCycleContextBar
            compact
            soId={focusSoId}
            soDocNo={focusSo?.docNo ?? null}
            customerName={focusSo?.customerName ?? null}
            cycleNo={noQtyCycleNoForDisplay}
            itemName={selected?.fgItem.itemName ?? null}
            operatorPendingQty={noQtyDisplayOperatorPendingQty}
            erpAdjustedPlanningQty={noQtyErpAdjustedPlanningQty}
            totalToProduceQty={selectedMetrics?.woLineQty ?? null}
            qcPassedQty={selectedMetrics?.usedQty ?? null}
          />
        ) : (
          <OperationalContextBar>
            <span className="font-semibold text-slate-600">SO</span>
            <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-sky-900">
              {focusSoIdValid
                ? displaySalesOrderNo(focusSoId, focusSo?.docNo ?? null)
                : selected
                  ? displaySalesOrderNo(selected.salesOrderId, null)
                  : "—"}
            </span>
            <OpCtxSep />
            <span className="max-w-[14rem] truncate font-medium text-slate-800">{focusSo?.customerName ?? "—"}</span>
            <OpCtxSep />
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-800 ring-1 ring-slate-200">
              PRODUCTION
            </span>
            {selectedMetrics && selected ? (
              <>
                <OpCtxSep />
                <span className="text-slate-500">Planned</span>
                <span className="font-semibold tabular-nums text-slate-900">{fmtProdQty(selectedMetrics.woLineQty)}</span>
                <OpCtxSep />
                <span className="text-slate-500">Produced</span>
                <span className="font-semibold tabular-nums text-slate-900">{fmtProdQty(selectedMetrics.usedQty)}</span>
                <OpCtxSep />
                <span className="text-emerald-800">Rem.</span>
                <span className="font-semibold tabular-nums text-emerald-950">{fmtProdQty(selectedMetrics.remainingQty)}</span>
              </>
            ) : null}
          </OperationalContextBar>
        )}
        {navigateNoQtyContext && focusSoIdValid && noQtyCycleDisplayStatus ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200/90 bg-white px-2.5 py-1 text-[11px] text-slate-800 shadow-sm">
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Cycle status
            </span>
            <span className="font-semibold text-slate-900">{noQtyCycleDisplayStatus.label}</span>
          </div>
        ) : null}
      </OperationalContextSticky>
      {/*
       * Phase 1: "Create Next RS" CTA removed from the Production page.
       * NO_QTY Next RS ownership now lives only on Dashboard, NO_QTY SO detail and Requirement Sheet pages.
       */}
      {main}
      {rmConsumptionApproveModal}
    </PageContainer>
  );
}
