import * as React from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { deleteUrlParamKeys } from "../lib/urlSearchParamsPatch";
import { DrillFocusBanner } from "../components/DrillFocusBanner";
import {
  DRILL_FOCUS_EMPTY_FILTERED_SUFFIX,
  DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS,
  DRILL_FOCUS_HINT_NOT_IN_LIST,
  DRILL_RECOVERY_LABEL,
  drillFocusTitleWorkOrder,
} from "../lib/drillFocusCopy";
import { DRILL_DATA, DRILL_QUERY } from "../lib/drillDownRoutes";
import { useDrillFocus } from "../hooks/useDrillFocus";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ApiRequestError, apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useAuth } from "../hooks/useAuth";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { ErpModal } from "../components/erp/ErpModal";
import { useDependentFieldFocus } from "../hooks/useDependentFieldFocus";
import { parsePositiveQuantityDraft } from "../lib/quantityDraft";
import { cn } from "../lib/utils";
import { REGULAR_TERMS } from "../lib/flowTerminology";
import { RM_PURCHASE_POST_GRN_MESSAGES } from "../lib/rmPurchaseWoContinuity";
import { WoInfoPanel } from "../components/erp/WoInfoPanel";
import { PlanningStatusChip } from "../components/erp/PlanningStatusChip";
import { useCanOpenRequirementSheet } from "../hooks/useIsAdmin";
import { X } from "lucide-react";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";
import {
  NoQtyCycleBanner,
  PageContainer,
  PageNoQtyFlowBackLink,
  PageSmartBackLink,
  StickyWorkspaceHead,
} from "../components/PageHeader";
import { ErpEmptyState } from "../components/erp/foundation/ErpEmptyState";
import { useErpRoleUi } from "../hooks/useErpRoleUi";
import { getRoleEmptyState } from "../lib/erpRoleEmptyStates";
import { NextStepStrip } from "../components/erp/NextStepStrip";
import type { ProductionRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import { isProductionBlockedByRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import { buildRmIssueNextStep } from "../lib/regularSoOperationalGuidance";
import { displaySalesOrderNo, displayWorkOrderNo } from "../lib/docNoDisplay";
import { NoQtyCycleContextBar } from "../components/erp/foundation/NoQtyCycleContextBar";
import { buildNoQtyGuidedHref, useNoQtyFlowState } from "../lib/noQtyFlowState";
import { isWorkOrderWorkspaceEntry } from "../lib/operationalPageEntry";
import { OperationalWorkOrderWorkspace } from "../components/erp/OperationalWorkOrderWorkspace";
import { useErpRefreshTick } from "../hooks/useErpRefreshTick";
import type { DashboardProductionStatusSource } from "../lib/dashboardProductionStatus";
import { resolveNoQtyCycleDisplayStatusForWorkOrder } from "../lib/noQtyCycleDisplayStatus";
import { formatErpStatusLabel } from "../lib/erpStatusTone";
import {
  workOrderStatusDisplayLabel,
  workOrderStatusBadgeVariant,
} from "../lib/workOrderLifecycle";
import { WorkOrderLifecyclePanel } from "../components/erp/WorkOrderLifecyclePanel";

type WoLine = { id: number; fgItemId: number; qty: string; fgItem: { itemName: string } };
type WoRow = {
  id: number;
  docNo?: string | null;
  status: string;
  holdReason?: string | null;
  holdRemarks?: string | null;
  shortfallQty?: number | string | null;
  closureReason?: string | null;
  salesOrderId: number;
  salesOrder?: { docNo?: string | null } | null;
  cycleId?: number | null;
  cycle?: { cycleNo?: number | null } | null;
  requirementSheetId?: number | null;
  lines: WoLine[];
};

type SoListRow = {
  id: number;
  docNo?: string | null;
  internalStatus: string;
  customer: { name: string } | null;
  /** Present on GET /api/sales-orders — used to show approved SOs with FG in WO form without gating on eligible ids only. */
  lines?: { item?: { itemType?: string } }[];
};

type SoDetail = {
  id: number;
  docNo?: string | null;
  internalStatus: string;
  orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY";
  customer?: { name: string } | null;
  po?: { customer?: { name: string } | null } | null;
  currentCycle?: { cycleNo?: number | null; status?: string | null } | null;
  processStage?: { key?: string | null } | null;
  lines: { itemId: number; qty: string; item: { itemName: string; itemType: string } }[];
};

type RmCheckResponse = {
  fgLines: {
    fgItemId: number;
    customerCommittedQty?: number;
    orderQty: number;
    productionBufferPercent?: number;
    productionBufferQty?: number;
    plannedProductionQty?: number;
    fgStockAdjustmentQty?: number;
    fgStock: number;
    rmPlanningQty?: number;
    toProduce: number;
    note?: string;
  }[];
};

type RmCheckFgPlanning = {
  customerCommittedQty?: number;
  orderQty: number;
  productionBufferPercent?: number;
  productionBufferQty?: number;
  plannedProductionQty?: number;
  fgStockAdjustmentQty?: number;
  fgStock: number;
  rmPlanningQty?: number;
  toProduce: number;
};

/** Default WO planning buffer when the field is blank (user may raise manually). */
const DEFAULT_SHORTFALL_BUFFER_PERCENT = 0;
const SHORTFALL_BUFFER_PERCENT_MAX = 10;

function parseShortfallBufferPercentInput(raw: string): number | null {
  const t = String(raw).trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Suggested WO qty for shortfall production: remaining + ceil(remaining × bufferPercent / 100).
 * `bufferPercent` is clamped to 0–10 for the calculation.
 */
function getShortfallSuggestedQty(shortfallQty: number, bufferPercent: number): number {
  const s = Number(shortfallQty);
  if (!Number.isFinite(s) || s <= 0) return 0;
  const bp = Math.min(SHORTFALL_BUFFER_PERCENT_MAX, Math.max(0, Number(bufferPercent)));
  if (!Number.isFinite(bp)) return s;
  const bufferQty = Math.ceil((s * bp) / 100);
  return s + bufferQty;
}

function fmtWoExplainQty(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(3).replace(/\.?0+$/, "");
}

/** qtyStr blank until user enters a value — avoids accidental qty=1 submits. */
type WoFormLine = { fgItemId: number; qtyStr: string };

type FgWoBalanceItem = {
  itemId: number;
  itemName: string;
  soOrderedQty: number;
  /** Confirmed net dispatched (locked + reversals); draft UNLOCKED not included. */
  dispatchedQty: number;
  /** APPROVED production on WO lines for this SO + FG (from balance API). */
  producedQty?: number;
  plannedOnOtherWorkOrdersQty: number;
  /** Net carry-forward from previous COMPLETED WO shortfall (planned − QC accepted), computed server-side. */
  carryForwardShortfallQty?: number;
  balanceQty: number;
  pendingSoQty?: number;
  stockAvailableQty?: number;
  qcAcceptedGross?: number;
  qcApprovedRemaining?: number;
  dispatchableQty?: number;
  shortageQty?: number;
  suggestedWoQty?: number;
  /** NO_QTY planning (current cycle, latest locked requirement sheet) */
  noQtyBalanceQty?: number;
  noQtyLatestRsQty?: number;
  noQtyQcPassedStockQty?: number;
  noQtyFinalWoQty?: number;
};

type LocationState = {
  salesOrderId?: number;
  woLines?: { fgItemId: number; qty: number }[];
  /** When editing a WO, pass this so “Planned” excludes that work order’s lines */
  excludeWorkOrderId?: number;
  source?: "requirementSheet" | "other" | "rmCheck";
  requirementSheetId?: number;
  fromRequirementSheet?: boolean;
};

const QTY_EPS = 1e-6;

const WO_LIST_URL_OMIT: Record<string, string> = {
  woStatus: "OPEN",
  sort: "id",
  dir: "desc",
  woCPage: "1",
};

const DEFAULT_WO_STATUS_FILTER = "OPEN" as const;
const COMPLETED_PAGE_SIZE = 10;

function filterSortWoList(
  list: WoRow[],
  qDraft: string,
  listSortKey: "id" | "so" | "status",
  listSortDir: "asc" | "desc",
): WoRow[] {
  const q = qDraft.trim().toLowerCase();
  let out = list.filter((r) => {
    if (!q) return true;
    const inLines = r.lines.some((l) => l.fgItem.itemName.toLowerCase().includes(q));
    const woNo = (r.docNo ?? "").toLowerCase();
    const soNo = (r.salesOrder?.docNo ?? "").toLowerCase();
    return (
      String(r.id).includes(q) ||
      String(r.salesOrderId).includes(q) ||
      woNo.includes(q) ||
      soNo.includes(q) ||
      inLines
    );
  });
  out = [...out];
  out.sort((a, b) => {
    let cmp = 0;
    if (listSortKey === "so") cmp = a.salesOrderId - b.salesOrderId;
    else if (listSortKey === "status") cmp = a.status.localeCompare(b.status, undefined, { sensitivity: "base" });
    else cmp = a.id - b.id;
    return listSortDir === "asc" ? cmp : -cmp;
  });
  return out;
}

function totalParsedQtyForItem(lines: WoFormLine[], itemId: number): number | null {
  let s = 0;
  for (const l of lines) {
    if (l.fgItemId !== itemId) continue;
    const q = parsePositiveQuantityDraft(l.qtyStr);
    if (q == null) return null;
    s += q;
  }
  return s;
}

function friendlyErrorMessage(raw: string): string {
  if (
    raw.includes("Foreign key") ||
    raw.includes("constraint") ||
    raw.toLowerCase().includes("prisma")
  ) {
    return "Could not save work order. Check the sales order and quantities, then try again.";
  }
  return raw;
}

type WoLineRow = {
  woId: number;
  woDocNo?: string | null;
  salesOrderId: number;
  soDocNo?: string | null;
  cycleNo?: number | null;
  status: string;
  holdReason?: string | null;
  fgName: string;
  qty: string;
  woLineId: number;
  requirementSheetId?: number | null;
};

function woListStatusBadgeVariant(label: string, rawStatus: string): "success" | "warning" | "default" {
  if (label === "Completed" || rawStatus === "COMPLETED") return "success";
  if (label === "Carried Forward" || label === "Closed") return "default";
  return "warning";
}

function renderWoListStatusBadge(
  row: WoLineRow,
  noQtySelected: boolean,
  noQtyWoDisplayStatusById: Map<number, { label: string; rawStatus: string }>,
) {
  const display = noQtySelected
    ? (noQtyWoDisplayStatusById.get(row.woId)?.label ?? formatErpStatusLabel(row.status))
    : workOrderStatusDisplayLabel({ status: row.status, holdReason: row.holdReason });
  const variant = noQtySelected
    ? woListStatusBadgeVariant(display, row.status)
    : workOrderStatusBadgeVariant(row.status);
  return (
    <Badge variant={variant} className="text-[10px] font-medium">
      {display}
    </Badge>
  );
}

function flattenWoLines(list: WoRow[]): WoLineRow[] {
  const out: WoLineRow[] = [];
  for (const wo of list) {
    for (const l of wo.lines || []) {
      out.push({
        woId: wo.id,
        woDocNo: wo.docNo ?? null,
        salesOrderId: wo.salesOrderId,
        soDocNo: wo.salesOrder?.docNo ?? null,
        cycleNo: wo.cycle?.cycleNo != null ? Number(wo.cycle.cycleNo) : null,
        status: wo.status,
        holdReason: wo.holdReason ?? null,
        fgName: l.fgItem?.itemName ?? "—",
        qty: l.qty,
        woLineId: l.id,
        requirementSheetId: wo.requirementSheetId ?? null,
      });
    }
  }
  return out;
}

/**
 * WORK ORDERS — MIXED SURFACE (REGULAR + NO_QTY)
 *
 * REGULAR FLOW (fixed-qty WO):
 * Enquiry → Quotation → Sales Order → RM Check (`/work-orders/prepare`) → Work Order (this page) → Production → QC → Dispatch → Sales Bill.
 *
 * NO_QTY rows may appear with cycle banners — use NO_QTY helpers only for those rows.
 *
 * DO NOT merge requirement-sheet shortage math or cycle dispatch assumptions into REGULAR WO line builders.
 *
 * Default “back” from REGULAR entry must not push operators into `/planning-dashboard` (NO_QTY hub).
 */
export function WorkOrdersPage() {
  const auth = useAuth();
  const isAdmin = auth.user?.role === "ADMIN";
  const roleUi = useErpRoleUi();
  const canProd = isAdmin || auth.user?.role === "PRODUCTION";
  const canOpenRs = useCanOpenRequirementSheet();

  const loc = useLocation() as { state?: LocationState };

  /** Captured once on mount so Regular planning entry logic survives after `location.state` is consumed. */
  const [cameFromRmCheckPlanning] = React.useState(
    () => (loc.state as LocationState | undefined)?.source === "rmCheck",
  );

  const nav = useNavigate();
  const demo = useDemoMode();
  const woDemoHl =
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "regular", 2) ??
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "no_qty", 3);
  const [sp] = useSearchParams();
  const source = sp.get("source") ?? "";
  const fromRmPurchase = sp.get("from") === "rm-purchase";
  const fromNoQtySo = source === "no_qty_so";
  const focusSoIdFromUrl = Number(sp.get("salesOrderId") ?? 0);
  const rawGuidedCycleId = Number(sp.get("cycleId") ?? 0);
  const noQtyCycleIdFromUrl =
    Number.isFinite(rawGuidedCycleId) && rawGuidedCycleId > 0 ? rawGuidedCycleId : null;
  const rawGuidedRsId = Number(sp.get("requirementSheetId") ?? 0);
  const noQtyRequirementSheetIdFromUrl =
    Number.isFinite(rawGuidedRsId) && rawGuidedRsId > 0 ? rawGuidedRsId : null;
  const shortfallQtyCustomerTracking = Number(sp.get("shortfallQty") ?? 0);
  const fromCustomerTrackingWo = sp.get("from") === "customer-tracking";
  const fromQcEntryWo = sp.get("from") === "qc-entry";
  /** Pre-fill WO qty from Customer Tracking or QC entry “produce shortfall” links. */
  const woShortfallFromGuidedEntry = fromCustomerTrackingWo || fromQcEntryWo;
  /** REGULAR shortfall: editable buffer % (0–10). Invalid high/low still clamp for suggested qty. */
  const [shortfallBufferPercentInput, setShortfallBufferPercentInput] = React.useState("0");
  const shortfallWoQtyUserTouchedRef = React.useRef<Set<number>>(new Set());

  const shortfallBufferParsed = parseShortfallBufferPercentInput(shortfallBufferPercentInput);
  const shortfallBufferPercentForCalc =
    shortfallBufferParsed == null
      ? DEFAULT_SHORTFALL_BUFFER_PERCENT
      : Math.min(SHORTFALL_BUFFER_PERCENT_MAX, Math.max(0, shortfallBufferParsed));
  const shortfallBufferPercentInvalidHigh =
    shortfallBufferParsed != null && shortfallBufferParsed > SHORTFALL_BUFFER_PERCENT_MAX + 1e-9;
  const shortfallBufferPercentInvalidLow = shortfallBufferParsed != null && shortfallBufferParsed < 0 - 1e-9;

  const { searchParams, setSearchParams, patch, read } = useUrlQueryState(WO_LIST_URL_OMIT);
  const focusWorkOrderId = Number(searchParams.get(DRILL_QUERY.workOrderId)) || 0;
  const soFromUrl = read.int("so");
  /** Regular SO deep-link: `?so=` or `?salesOrderId=` (without NO_QTY source). */
  const regularSoIdFromUrl = fromNoQtySo
    ? 0
    : soFromUrl > 0
      ? soFromUrl
      : focusSoIdFromUrl > 0
        ? focusSoIdFromUrl
        : 0;

  const woStatusFilter = read.enum("woStatus", ["ALL", "OPEN", "COMPLETED"] as const, DEFAULT_WO_STATUS_FILTER);
  const completedPageFromUrl = read.int("woCPage", 1);
  const listSortKey = read.enum("sort", ["id", "so", "status"] as const, "id");
  const listSortDir = read.enum("dir", ["asc", "desc"] as const, "desc");
  const qFromUrl = read.string("q");
  const prefillItemIdFromUrl = read.int("prefillItemId");
  const prefillQtyFromUrl = read.string("prefillQty");
  const [qDraft, setQDraft] = useDebouncedUrlStringParam({ urlValue: qFromUrl, patch, paramKey: "q" });
  const [openWoRows, setOpenWoRows] = React.useState<WoRow[]>([]);
  const [completedWoRows, setCompletedWoRows] = React.useState<WoRow[]>([]);
  const [completedTotal, setCompletedTotal] = React.useState(0);
  const [listLoaded, setListLoaded] = React.useState(false);
  const [salesOrders, setSalesOrders] = React.useState<SoListRow[]>([]);
  const [eligibleSoIds, setEligibleSoIds] = React.useState<Set<number>>(new Set());
  const [soDetail, setSoDetail] = React.useState<SoDetail | null>(null);
  const [fgBalances, setFgBalances] = React.useState<FgWoBalanceItem[]>([]);
  const [rmCheckFgPlanningByItemId, setRmCheckFgPlanningByItemId] = React.useState<Map<number, RmCheckFgPlanning>>(
    () => new Map(),
  );
  const [error, setError] = React.useState<string | null>(null);

  const [salesOrderId, setSalesOrderId] = React.useState<number | "">(() => {
    const st = loc.state as LocationState | undefined;
    if (st?.source === "rmCheck" && st.salesOrderId != null) {
      const n = Number(st.salesOrderId);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return "";
  });

  React.useEffect(() => {
    setShortfallBufferPercentInput("0");
    shortfallWoQtyUserTouchedRef.current.clear();
  }, [salesOrderId]);

  const [woLines, setWoLines] = React.useState<WoFormLine[]>([{ fgItemId: 0, qtyStr: "" }]);
  /** Regular (non–NO_QTY) new WO: per–FG-item selection + WO qty draft for the planning table. */
  const [regularWoByItemId, setRegularWoByItemId] = React.useState<Record<number, { sel: boolean; qtyStr: string }>>({});
  const [creatingWo, setCreatingWo] = React.useState(false);
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [overrideShowReason, setOverrideShowReason] = React.useState(false);
  const [overrideSaving, setOverrideSaving] = React.useState(false);
  const [overridePayload, setOverridePayload] = React.useState<{ salesOrderId: number; lines: WoFormLine[] } | null>(
    null,
  );
  const overrideReasonInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (overrideOpen && overrideShowReason) {
      overrideReasonInputRef.current?.focus();
    }
  }, [overrideOpen, overrideShowReason]);

  const woFormRef = React.useRef<HTMLDivElement | null>(null);
  const salesOrderSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const fgItemSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const woQtyPrimaryRef = React.useRef<HTMLInputElement | null>(null);

  const appliedPrefill = React.useRef(false);
  const appliedPlanningPrefill = React.useRef(false);
  const isEditMode = read.int("excludeWo") > 0;
  const noQtySelected = soDetail?.orderType === "NO_QTY";
  const editingWoId = read.int("excludeWo");
  const editingWo = React.useMemo(() => {
    if (!(editingWoId > 0)) return null;
    return [...openWoRows, ...completedWoRows].find((w) => w.id === editingWoId) ?? null;
  }, [editingWoId, openWoRows, completedWoRows]);
  const showRegularLifecyclePanel =
    isEditMode && editingWo != null && !noQtySelected && editingWo.requirementSheetId == null;
  /** Simplified multi-line FG table for new Regular SO work orders only. */
  const useRegularWoPlanningTable = !fromNoQtySo && !noQtySelected && !isEditMode;
  const lockSalesOrderSelector =
    useRegularWoPlanningTable &&
    (soFromUrl > 0 || (focusSoIdFromUrl > 0 && source !== "no_qty_so"));
  const isPrefilledFromRequirementSheet =
    loc.state?.fromRequirementSheet === true || loc.state?.source === "requirementSheet";
  const noQtyBlocked = noQtySelected && !isPrefilledFromRequirementSheet;

  const showWoWorkspace = isWorkOrderWorkspaceEntry({
    fromNoQtySo,
    regularSoIdFromUrl,
    focusSoIdFromUrl,
    isEditMode,
    focusWorkOrderId,
    salesOrderId,
    fromRequirementSheet: isPrefilledFromRequirementSheet,
    fromRmCheck: cameFromRmCheckPlanning,
  });

  React.useEffect(() => {
    if (!fromNoQtySo) return;
    if (!(Number.isFinite(focusSoIdFromUrl) && focusSoIdFromUrl > 0)) return;
    if (salesOrderId !== "") return;
    setSalesOrderId(focusSoIdFromUrl);
    loadSoDetail(focusSoIdFromUrl).catch(() => {
      /* handled by loadSoDetail error flow */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromNoQtySo, focusSoIdFromUrl]);

  /** Approved SOs with FG and positive WO-planning remainder (server: getEligibleSalesOrderIdsForWorkOrder). */
  const approvedSos = React.useMemo(() => {
    const base = salesOrders.filter((s) => s.internalStatus === "APPROVED");
    const rmCheckIncludeSoId =
      cameFromRmCheckPlanning && salesOrderId !== ""
        ? Number(salesOrderId)
        : loc.state?.source === "rmCheck" && loc.state?.salesOrderId != null
          ? Number(loc.state.salesOrderId)
          : undefined;
    const rmPurchaseIncludeSoId =
      fromRmPurchase && regularSoIdFromUrl > 0 ? regularSoIdFromUrl : undefined;
    const includeId =
      isEditMode && soFromUrl > 0
        ? soFromUrl
        : isPrefilledFromRequirementSheet && loc.state?.salesOrderId != null
          ? loc.state.salesOrderId
          : rmPurchaseIncludeSoId != null
            ? rmPurchaseIncludeSoId
          : rmCheckIncludeSoId != null && Number.isFinite(rmCheckIncludeSoId) && rmCheckIncludeSoId > 0
            ? rmCheckIncludeSoId
            : undefined;
    return base.filter((s) => {
      if (includeId != null && s.id === includeId) return true;
      if (!eligibleSoIds.has(s.id)) return false;
      return (s.lines ?? []).some((l) => l.item?.itemType === "FG");
    });
  }, [
    salesOrders,
    eligibleSoIds,
    soFromUrl,
    isEditMode,
    isPrefilledFromRequirementSheet,
    loc.state?.salesOrderId,
    loc.state?.source,
    cameFromRmCheckPlanning,
    salesOrderId,
    fromRmPurchase,
    regularSoIdFromUrl,
  ]);

  useFastEntryForm({
    containerRef: woFormRef,
    initialFocusRef: salesOrderSelectRef,
    initialFocusEnabled: Boolean(canProd && approvedSos.length > 0 && !lockSalesOrderSelector),
  });

  const fgSoLines = React.useMemo(
    () => soDetail?.lines.filter((l) => l.item.itemType === "FG") ?? [],
    [soDetail],
  );

  const fgBalanceByItemId = React.useMemo(() => new Map(fgBalances.map((b) => [b.itemId, b])), [fgBalances]);
  const [fgBalancesLoading, setFgBalancesLoading] = React.useState(false);

  /** REGULAR (NORMAL) SO work-order planning only — not NO_QTY / REPLACEMENT. */
  const isRegularNormalOrderForWoPlanning =
    useRegularWoPlanningTable &&
    soDetail != null &&
    (soDetail.orderType === "NORMAL" || soDetail.orderType == null);

  const shortfallQtyUrlActive =
    isRegularNormalOrderForWoPlanning && shortfallQtyCustomerTracking > QTY_EPS;

  /** Any FG still has WO-planning remainder (QC recovery, partial dispatch, etc.) — does not depend on URL. */
  const hasAnyFgRemainingForShortfall = React.useMemo(() => {
    if (!isRegularNormalOrderForWoPlanning) return false;
    return fgSoLines.some((sl) => {
      const bal = fgBalanceByItemId.get(sl.itemId);
      return (bal?.balanceQty ?? 0) > QTY_EPS;
    });
  }, [isRegularNormalOrderForWoPlanning, fgSoLines, fgBalanceByItemId]);

  /** Net order need vs production / QC cleared — catches edge cases where balance row is still catching up. */
  const hasOrderProductionShortfallSignal = React.useMemo(() => {
    if (!isRegularNormalOrderForWoPlanning) return false;
    return fgSoLines.some((sl) => {
      const bal = fgBalanceByItemId.get(sl.itemId);
      if (!bal) return false;
      const ord = Number(bal.soOrderedQty ?? 0);
      const disp = Number(bal.dispatchedQty ?? 0);
      const netOrd = Math.max(0, ord - disp);
      const prod = Number(bal.producedQty ?? 0);
      const qcOk = Number(bal.qcAcceptedGross ?? 0);
      const completedLike = Math.max(prod, qcOk);
      return netOrd > completedLike + QTY_EPS;
    });
  }, [isRegularNormalOrderForWoPlanning, fgSoLines, fgBalanceByItemId]);

  const pageIsShortfallProduction =
    shortfallQtyUrlActive || hasAnyFgRemainingForShortfall || hasOrderProductionShortfallSignal;

  /** REGULAR (NORMAL) SO shortfall recovery only — backend relaxes WO cap when these are sent. */
  const sendShortfallWoBufferToApi =
    !cameFromRmCheckPlanning &&
    pageIsShortfallProduction &&
    !fromNoQtySo &&
    soDetail != null &&
    soDetail.orderType !== "NO_QTY" &&
    (soDetail.orderType === "NORMAL" || soDetail.orderType == null);

  const firstShortfallEligibleItemId = React.useMemo(() => {
    if (!isRegularNormalOrderForWoPlanning) return null;
    const f = fgSoLines.find((sl) => (fgBalanceByItemId.get(sl.itemId)?.balanceQty ?? 0) > QTY_EPS);
    return f?.itemId ?? null;
  }, [isRegularNormalOrderForWoPlanning, fgSoLines, fgBalanceByItemId]);

  function rowUsesShortfallBufferFeatures(itemId: number): boolean {
    if (!useRegularWoPlanningTable || !isRegularNormalOrderForWoPlanning) return false;
    if (!pageIsShortfallProduction) return false;
    const bal = fgBalanceByItemId.get(itemId);
    if (!bal || bal.balanceQty <= QTY_EPS) return false;
    return true;
  }

  function shortfallBaseQtyForRow(itemId: number, balanceQty: number): number {
    if (shortfallQtyUrlActive && firstShortfallEligibleItemId === itemId) {
      return Math.min(shortfallQtyCustomerTracking, balanceQty);
    }
    return balanceQty;
  }

  React.useEffect(() => {
    if (salesOrderId === "") {
      setFgBalances([]);
      setFgBalancesLoading(false);
      setRmCheckFgPlanningByItemId(new Map());
      return;
    }
    const id = Number(salesOrderId);
    if (!Number.isFinite(id) || id <= 0) {
      setFgBalances([]);
      setFgBalancesLoading(false);
      setRmCheckFgPlanningByItemId(new Map());
      return;
    }
    const excl = read.int("excludeWo") > 0 ? read.int("excludeWo") : undefined;
    const qs = excl != null ? `?excludeWorkOrderId=${excl}` : "";
    let cancelled = false;
    setFgBalancesLoading(true);
    (async () => {
      try {
        if (!cameFromRmCheckPlanning) {
          await apiFetch(`/api/sales-orders/${id}/production-planning-snapshot`, {
            method: "PUT",
            body: JSON.stringify({ bufferPercent: shortfallBufferPercentForCalc }),
          });
        }
        const [balPayload, rmPayload] = await Promise.all([
          apiFetch<{ items: FgWoBalanceItem[] }>(`/api/production/sales-orders/${id}/fg-work-order-balance${qs}`),
          apiFetch<RmCheckResponse>(`/api/sales-orders/${id}/rm-check`),
        ]);
        if (cancelled) return;
        setFgBalances(balPayload.items ?? []);
        const m = new Map<number, RmCheckFgPlanning>();
        for (const f of rmPayload?.fgLines ?? []) {
          if (f.note) continue;
          const itemId = Number(f.fgItemId);
          if (!Number.isFinite(itemId) || itemId <= 0) continue;
          m.set(itemId, {
            customerCommittedQty: Number(f.customerCommittedQty ?? f.orderQty),
            orderQty: Number(f.orderQty),
            productionBufferPercent: Number(f.productionBufferPercent ?? 0),
            productionBufferQty: Number(f.productionBufferQty ?? 0),
            plannedProductionQty: Number(f.plannedProductionQty ?? f.orderQty),
            fgStockAdjustmentQty: Number(f.fgStockAdjustmentQty ?? f.fgStock),
            fgStock: Number(f.fgStock),
            rmPlanningQty: Number(f.rmPlanningQty ?? f.toProduce),
            toProduce: Number(f.toProduce),
          });
        }
        setRmCheckFgPlanningByItemId(m);
      } catch {
        if (cancelled) return;
        setFgBalances([]);
        setRmCheckFgPlanningByItemId(new Map());
      } finally {
        if (!cancelled) setFgBalancesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [salesOrderId, openWoRows, completedWoRows, read, searchParams.toString(), shortfallBufferPercentForCalc, cameFromRmCheckPlanning]);

  /** When balance API returns after FG is chosen, prefill WO qty with suggested shortage (if field still empty). */
  React.useEffect(() => {
    if (fgBalancesLoading || fgBalances.length === 0) return;
    setWoLines((p) => {
      if (!p.length) return p;
      const id = p[0].fgItemId;
      if (id <= 0 || p[0].qtyStr.trim() !== "") return p;
      const bal = fgBalances.find((b) => b.itemId === id);
      const sq = bal?.suggestedWoQty;
      if (sq == null || sq <= QTY_EPS || !Number.isFinite(sq)) return p;
      const s = Number.isInteger(sq) ? String(sq) : String(Number(sq.toFixed(3)));
      const next = [...p];
      next[0] = { ...next[0], qtyStr: s };
      return next;
    });
  }, [fgBalances, fgBalancesLoading]);

  const eligibleFgSoLines = React.useMemo(() => {
    // For NEW WO creation: FG when planning remainder > 0 (server: same formula as eligible SO list).
    // For edit mode (excludeWo present), keep showing all FG lines so the existing selection remains visible.
    const excl = read.int("excludeWo") > 0 ? read.int("excludeWo") : undefined;
    if (excl != null) return fgSoLines;
    // REGULAR RM check / prepare-WO payload: trust planning payload; do not hide FGs behind balance/eligibility filters.
    if (cameFromRmCheckPlanning) return fgSoLines;
    // Requirement Sheet prefill must be allowed even when SO qty is 0 (NO_QTY) and eligibility filters would hide it.
    if (isPrefilledFromRequirementSheet) return fgSoLines;
    if (fgBalancesLoading) return [];
    // Pending-only rule aligned with RM-check “To produce” minus active planned WOs:
    // remainingAfterConfirmedDispatch = max(0, soOrderedQty - confirmedDispatchedQty)
    // pending_for_wo = max(0, min(toProduce, remainingAfterConfirmedDispatch) - plannedOnOtherWorkOrdersQty)
    return fgSoLines.filter((sl) => {
      const toProduce = rmCheckFgPlanningByItemId.get(sl.itemId)?.toProduce ?? 0;
      const bal = fgBalanceByItemId.get(sl.itemId);
      const planned = bal?.plannedOnOtherWorkOrdersQty ?? 0;
      const soOrdered = bal?.soOrderedQty ?? 0;
      const dispatched = bal?.dispatchedQty ?? 0;
      const remainingAfterConfirmedDispatch = Math.max(0, soOrdered - dispatched);
      const pendingForWo = Math.max(0, Math.min(toProduce, remainingAfterConfirmedDispatch) - planned);
      return pendingForWo > QTY_EPS;
    });
  }, [
    fgSoLines,
    rmCheckFgPlanningByItemId,
    fgBalanceByItemId,
    read,
    fgBalancesLoading,
    isPrefilledFromRequirementSheet,
    cameFromRmCheckPlanning,
  ]);

  /** FG options in the primary (and extra-line) selectors: planning entry uses full SO FG list. */
  const fgPickOptions = cameFromRmCheckPlanning ? fgSoLines : eligibleFgSoLines;

  const primaryLine = woLines[0] ?? { fgItemId: 0, qtyStr: "" };

  const firstFgId = fgPickOptions[0]?.itemId ?? 0;
  const extraWoLines = woLines.length > 1 ? woLines.slice(1) : [];
  const primaryFgSoLine = fgSoLines.find((s) => s.itemId === primaryLine.fgItemId);
  const primaryItemTotalDraft =
    primaryLine.fgItemId > 0 ? totalParsedQtyForItem(woLines, primaryLine.fgItemId) : null;
  const primaryBalRow = primaryLine.fgItemId > 0 ? fgBalanceByItemId.get(primaryLine.fgItemId) : undefined;
  const primaryMaxAllowed = primaryBalRow?.balanceQty ?? null;
  const primaryNoRemaining =
    primaryMaxAllowed != null && Number.isFinite(primaryMaxAllowed) && primaryMaxAllowed <= QTY_EPS;
  const primaryExceedsAllowed =
    primaryLine.fgItemId > 0 &&
    primaryItemTotalDraft != null &&
    primaryBalRow != null &&
    primaryItemTotalDraft > primaryBalRow.balanceQty + QTY_EPS;

  /** Same figures as RM check (`/api/sales-orders/:id/rm-check`); USABLE FG stock only. */
  const regularWoRmCheckPlan =
    !noQtySelected && primaryLine.fgItemId > 0
      ? rmCheckFgPlanningByItemId.get(primaryLine.fgItemId) ?? null
      : null;

  /** Open (non-completed) WO on this SO that includes the primary FG line — used for “next step” UX only. */
  const openWoForPrimaryFg = React.useMemo(() => {
    if (salesOrderId === "" || primaryLine.fgItemId <= 0) return { woId: null as number | null };
    const soId = Number(salesOrderId);
    if (!Number.isFinite(soId) || soId <= 0) return { woId: null };
    const fgId = primaryLine.fgItemId;
    const matches = openWoRows.filter(
      (w) => w.salesOrderId === soId && (w.lines ?? []).some((l) => Number(l.fgItemId) === fgId),
    );
    if (!matches.length) return { woId: null };
    return { woId: Math.max(...matches.map((w) => w.id)) };
  }, [salesOrderId, primaryLine.fgItemId, openWoRows]);

  const hasOpenWoCoveringPrimaryFg = openWoForPrimaryFg.woId != null;

  const openWoPrimaryLineId = React.useMemo(() => {
    const woId = openWoForPrimaryFg.woId;
    if (woId == null) return null;
    const wo = openWoRows.find((w) => w.id === woId);
    if (!wo?.lines?.length) return null;
    const fgId = primaryLine.fgItemId;
    const line = wo.lines.find((l) => Number(l.fgItemId) === fgId) ?? wo.lines[0];
    return line?.id ?? null;
  }, [openWoForPrimaryFg.woId, openWoRows, primaryLine.fgItemId]);

  const [woRmReadiness, setWoRmReadiness] = React.useState<ProductionRmReadiness | null>(null);
  React.useEffect(() => {
    if (!openWoPrimaryLineId) {
      setWoRmReadiness(null);
      return;
    }
    let cancelled = false;
    void apiFetch<ProductionRmReadiness | { skipped: boolean }>(
      `/api/production/work-order-lines/${openWoPrimaryLineId}/rm-readiness`,
    )
      .then((res) => {
        if (cancelled) return;
        if ("skipped" in res && res.skipped) {
          setWoRmReadiness(null);
          return;
        }
        setWoRmReadiness(res as ProductionRmReadiness);
      })
      .catch(() => {
        if (!cancelled) setWoRmReadiness(null);
      });
    return () => {
      cancelled = true;
    };
  }, [openWoPrimaryLineId]);

  const rmIssueNextStep =
    !fromNoQtySo &&
    !noQtySelected &&
    woRmReadiness != null &&
    isProductionBlockedByRmReadiness(woRmReadiness)
      ? buildRmIssueNextStep(woRmReadiness, showWoWorkspace ? "work-order-workspace" : "work-orders")
      : null;

  const showProductionNextStep =
    !fromNoQtySo &&
    !noQtySelected &&
    !fgBalancesLoading &&
    soDetail?.internalStatus === "APPROVED" &&
    primaryLine.fgItemId > 0 &&
    primaryNoRemaining &&
    hasOpenWoCoveringPrimaryFg;

  const showProductionNextStepEffective = showProductionNextStep && rmIssueNextStep == null;

  const productionEntryHref =
    showProductionNextStepEffective && salesOrderId !== "" && openWoForPrimaryFg.woId != null
      ? `/production?${new URLSearchParams({
          salesOrderId: String(salesOrderId),
          woId: String(openWoForPrimaryFg.woId),
          from: showWoWorkspace ? "work-order-workspace" : "work-orders",
        }).toString()}`
      : null;

  useDependentFieldFocus({
    targetRef: fgItemSelectRef,
    enabled: Boolean(
      canProd &&
        !useRegularWoPlanningTable &&
        salesOrderId !== "" &&
        soDetail != null &&
        soDetail.internalStatus === "APPROVED" &&
        fgPickOptions.length > 0,
    ),
    deps: [salesOrderId, soDetail?.id, fgPickOptions.length, useRegularWoPlanningTable],
  });
  useDependentFieldFocus({
    targetRef: woQtyPrimaryRef,
    enabled: Boolean(
      canProd &&
        !useRegularWoPlanningTable &&
        salesOrderId !== "" &&
        primaryLine.fgItemId > 0 &&
        soDetail != null &&
        soDetail.internalStatus === "APPROVED",
    ),
    deps: [primaryLine.fgItemId, useRegularWoPlanningTable],
  });

  const woFormCanSubmit = React.useMemo(() => {
    if (fgBalancesLoading) return false;
    if (salesOrderId === "" || !soDetail || soDetail.internalStatus !== "APPROVED" || fgSoLines.length === 0) {
      return false;
    }
    if (noQtyBlocked) return false;
    if (!woLines.length) return false;
    const allowed = new Set(fgSoLines.map((l) => l.itemId));
    if (!woLines.every((l) => allowed.has(l.fgItemId) && l.fgItemId > 0 && parsePositiveQuantityDraft(l.qtyStr) != null)) {
      return false;
    }
    const sums = new Map<number, number>();
    for (const l of woLines) {
      const q = parsePositiveQuantityDraft(l.qtyStr);
      if (q == null) return false;
      sums.set(l.fgItemId, (sums.get(l.fgItemId) || 0) + q);
    }
    for (const [itemId, sum] of sums) {
      if (rowUsesShortfallBufferFeatures(itemId)) {
        if (sum <= QTY_EPS) return false;
        continue;
      }
      const bal = fgBalanceByItemId.get(itemId);
      if (!bal) return false;
      if (sum > bal.balanceQty + QTY_EPS) return false;
    }
    return true;
  }, [
    salesOrderId,
    soDetail,
    fgSoLines,
    woLines,
    fgBalanceByItemId,
    fgBalancesLoading,
    noQtyBlocked,
    pageIsShortfallProduction,
    isRegularNormalOrderForWoPlanning,
    shortfallQtyUrlActive,
    shortfallQtyCustomerTracking,
  ]);

  /** Dedupes REGULAR shortfall buffered prefill when balances / open WOs change. */
  const regularShortfallPrefillKeyRef = React.useRef("");

  React.useEffect(() => {
    if (!useRegularWoPlanningTable) return;
    if (salesOrderId === "") {
      setRegularWoByItemId({});
      regularShortfallPrefillKeyRef.current = "";
      return;
    }
    setRegularWoByItemId((prev) => {
      const next: Record<number, { sel: boolean; qtyStr: string }> = {};
      for (const sl of fgSoLines) {
        next[sl.itemId] = prev[sl.itemId] ?? { sel: false, qtyStr: "" };
      }
      return next;
    });
  }, [salesOrderId, fgSoLines, useRegularWoPlanningTable]);

  React.useEffect(() => {
    // Prepare-WO deep-link: after SO is selected, auto-select the item and prefill qty.
    if (!useRegularWoPlanningTable) return;
    if (appliedPlanningPrefill.current) return;
    if (salesOrderId === "") return; // user still needs to choose SO
    if (!(prefillItemIdFromUrl > 0)) return;
    const parsedQty = Number(prefillQtyFromUrl);
    const qtyStr = Number.isFinite(parsedQty) && parsedQty > QTY_EPS ? String(parsedQty) : "";

    const soHasItem = fgSoLines.some((l) => l.itemId === prefillItemIdFromUrl);
    if (!soHasItem) return;

    setRegularWoByItemId((prev) => {
      const cur = prev[prefillItemIdFromUrl] ?? { sel: false, qtyStr: "" };
      return {
        ...prev,
        [prefillItemIdFromUrl]: {
          sel: true,
          qtyStr: cur.qtyStr.trim() !== "" ? cur.qtyStr : qtyStr,
        },
      };
    });

    appliedPlanningPrefill.current = true;
    // Remove prefill params so refresh doesn't keep re-applying.
    setSearchParams((prev) => deleteUrlParamKeys(prev, ["prefillItemId", "prefillQty"]), { replace: true });
  }, [
    useRegularWoPlanningTable,
    salesOrderId,
    fgSoLines,
    prefillItemIdFromUrl,
    prefillQtyFromUrl,
    setSearchParams,
  ]);

  /**
   * REGULAR NORMAL: pre-fill first FG that still has remaining WO qty and no open WO on that FG.
   * Uses `?shortfallQty=` base when present; otherwise remaining from balance API. Always applies buffer.
   */
  React.useEffect(() => {
    if (!useRegularWoPlanningTable || !isRegularNormalOrderForWoPlanning) return;
    if (!pageIsShortfallProduction) return;
    if (salesOrderId === "" || fgBalancesLoading) return;
    if (!fgSoLines.length) return;

    const soId = Number(salesOrderId);
    const first = fgSoLines.find((sl) => {
      const rem = fgBalanceByItemId.get(sl.itemId)?.balanceQty ?? 0;
      if (!(rem > QTY_EPS)) return false;
      const hasOpen = openWoRows.some(
        (w) => w.salesOrderId === soId && (w.lines ?? []).some((l) => Number(l.fgItemId) === sl.itemId),
      );
      return !hasOpen;
    });
    if (!first) return;

    const rem = fgBalanceByItemId.get(first.itemId)?.balanceQty ?? 0;
    const base = shortfallQtyUrlActive ? Math.min(shortfallQtyCustomerTracking, rem) : rem;
    if (!(base > QTY_EPS)) return;
    const suggested = getShortfallSuggestedQty(base, shortfallBufferPercentForCalc);
    if (!(suggested > QTY_EPS)) return;

    const openSig = openWoRows
      .filter((w) => w.salesOrderId === soId)
      .map((w) => w.id)
      .sort((a, b) => a - b)
      .join(",");
    const applyKey = `${soId}:${first.itemId}:${openSig}:${rem.toFixed(6)}:sf:${shortfallQtyUrlActive ? String(shortfallQtyCustomerTracking) : "x"}:bp:${shortfallBufferPercentForCalc}`;
    if (regularShortfallPrefillKeyRef.current === applyKey) return;

    setRegularWoByItemId((prev) => {
      const cur = prev[first.itemId] ?? { sel: false, qtyStr: "" };
      if (cur.sel && cur.qtyStr.trim() !== "") return prev;
      return {
        ...prev,
        [first.itemId]: {
          sel: true,
          qtyStr: Number.isInteger(suggested) ? String(suggested) : String(Number(suggested.toFixed(4))),
        },
      };
    });
    regularShortfallPrefillKeyRef.current = applyKey;
  }, [
    useRegularWoPlanningTable,
    isRegularNormalOrderForWoPlanning,
    pageIsShortfallProduction,
    salesOrderId,
    fgBalancesLoading,
    fgSoLines,
    fgBalanceByItemId,
    openWoRows,
    shortfallQtyUrlActive,
    shortfallQtyCustomerTracking,
    shortfallBufferPercentForCalc,
  ]);

  /** When buffer % changes, refresh suggested WO qty for rows the user has not edited manually. */
  React.useEffect(() => {
    if (!useRegularWoPlanningTable || !isRegularNormalOrderForWoPlanning || !pageIsShortfallProduction) return;
    if (fgBalancesLoading) return;
    setRegularWoByItemId((prev) => {
      let changed = false;
      const next: Record<number, { sel: boolean; qtyStr: string }> = { ...prev };
      for (const sl of fgSoLines) {
        const id = sl.itemId;
        if (shortfallWoQtyUserTouchedRef.current.has(id)) continue;
        const cell = prev[id];
        if (!cell?.sel) continue;
        if (!rowUsesShortfallBufferFeatures(id)) continue;
        const rem = fgBalanceByItemId.get(id)?.balanceQty ?? 0;
        const base = shortfallBaseQtyForRow(id, rem);
        const sug = getShortfallSuggestedQty(base, shortfallBufferPercentForCalc);
        const newStr = Number.isInteger(sug) ? String(sug) : String(Number(sug.toFixed(4)));
        if (cell.qtyStr !== newStr) {
          next[id] = { ...cell, qtyStr: newStr };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [
    shortfallBufferPercentForCalc,
    pageIsShortfallProduction,
    isRegularNormalOrderForWoPlanning,
    useRegularWoPlanningTable,
    fgBalancesLoading,
    fgSoLines,
    fgBalanceByItemId,
    shortfallQtyUrlActive,
    firstShortfallEligibleItemId,
    shortfallQtyCustomerTracking,
  ]);

  React.useEffect(() => {
    if (!useRegularWoPlanningTable) return;
    if (fgBalancesLoading) return;
    const lines: WoFormLine[] = [];
    for (const sl of fgSoLines) {
      const c = regularWoByItemId[sl.itemId];
      if (c?.sel) {
        lines.push({ fgItemId: sl.itemId, qtyStr: c.qtyStr ?? "" });
      }
    }
    setWoLines((prev) => {
      const same =
        lines.length === prev.length &&
        lines.every((l, i) => l.fgItemId === prev[i]?.fgItemId && l.qtyStr === prev[i]?.qtyStr);
      if (same) return prev;
      return lines.length ? lines : [{ fgItemId: 0, qtyStr: "" }];
    });
  }, [regularWoByItemId, fgSoLines, fgBalancesLoading, useRegularWoPlanningTable]);

  async function loadSoDetail(id: number, initialWoLines?: WoFormLine[] | null) {
    const d = await apiFetch<SoDetail>(`/api/sales-orders/${id}`);
    setSoDetail(d);
    if (initialWoLines != null && initialWoLines.length > 0) {
      const mapped = initialWoLines.map((l) => ({ fgItemId: l.fgItemId, qtyStr: l.qtyStr }));
      setWoLines(mapped);
      if (d.orderType !== "NO_QTY") {
        const rows: Record<number, { sel: boolean; qtyStr: string }> = {};
        for (const l of mapped) {
          if (l.fgItemId > 0) rows[l.fgItemId] = { sel: true, qtyStr: l.qtyStr };
        }
        setRegularWoByItemId((prev) => ({ ...prev, ...rows }));
      }
    } else {
      setWoLines([{ fgItemId: 0, qtyStr: "" }]);
      setRegularWoByItemId({});
    }
  }

  function onSalesOrderSelect(id: number | "") {
    setError(null);
    setSalesOrderId(id);
    setSoDetail(null);
    setFgBalances([]);
    setFgBalancesLoading(false);
    setRegularWoByItemId({});
    patch({ so: id === "" ? null : String(id) });
    if (id === "") {
      setWoLines([{ fgItemId: 0, qtyStr: "" }]);
      return;
    }
    loadSoDetail(id).catch((e) => {
      setError(e instanceof Error ? e.message : "Failed to load sales order");
      setSalesOrderId("");
    });
  }

  const loadWorkOrderList = React.useCallback(async () => {
    const limit = COMPLETED_PAGE_SIZE;
    const page = Math.max(1, completedPageFromUrl);
    try {
      if (woStatusFilter === "OPEN") {
        const w = await apiFetch<WoRow[]>("/api/production/work-orders?listScope=nonCompleted");
        setOpenWoRows(w);
        setCompletedWoRows([]);
        setCompletedTotal(0);
      } else if (woStatusFilter === "COMPLETED") {
        const data = await apiFetch<{ rows: WoRow[]; total: number; page: number; limit: number }>(
          `/api/production/work-orders?listScope=completed&completedPage=${page}&limit=${limit}`,
        );
        setOpenWoRows([]);
        setCompletedWoRows(data.rows ?? []);
        setCompletedTotal(typeof data.total === "number" ? data.total : 0);
      } else {
        const data = await apiFetch<{
          nonCompleted: WoRow[];
          completed: WoRow[];
          completedTotal: number;
          completedPage: number;
          completedLimit: number;
        }>(`/api/production/work-orders?listScope=all&completedPage=${page}&limit=${limit}`);
        setOpenWoRows(data.nonCompleted ?? []);
        setCompletedWoRows(data.completed ?? []);
        setCompletedTotal(typeof data.completedTotal === "number" ? data.completedTotal : 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setOpenWoRows([]);
      setCompletedWoRows([]);
      setCompletedTotal(0);
    }
  }, [woStatusFilter, completedPageFromUrl]);

  async function refresh() {
    try {
      const includeSalesOrderId = isEditMode && soFromUrl > 0 ? soFromUrl : undefined;
      const includeQs = includeSalesOrderId ? `?includeSalesOrderId=${includeSalesOrderId}` : "";
      const [sos, eligible] = await Promise.all([
        apiFetch<SoListRow[]>("/api/sales-orders"),
        apiFetch<{ ids: number[] }>(`/api/production/eligible-sales-orders-for-wo${includeQs}`),
      ]);
      setSalesOrders(sos);
      setEligibleSoIds(new Set((eligible?.ids ?? []).map(Number)));
      await loadWorkOrderList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setListLoaded(true);
    }
  }

  React.useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isEditMode) return;
    if (salesOrderId === "") return;
    const id = Number(salesOrderId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!eligibleSoIds.has(id)) {
      if (cameFromRmCheckPlanning) return;
      if (regularSoIdFromUrl > 0 && id === regularSoIdFromUrl) return;
      if (fromRmPurchase && regularSoIdFromUrl > 0 && id === regularSoIdFromUrl) return;
      setSalesOrderId("");
      setSoDetail(null);
      setFgBalances([]);
    }
  }, [isEditMode, salesOrderId, eligibleSoIds, cameFromRmCheckPlanning, regularSoIdFromUrl, fromRmPurchase]);

  React.useEffect(() => {
    if (!fromRmPurchase || !listLoaded || salesOrderId === "") return;
    if (fgBalancesLoading) return;
    const t = window.setTimeout(() => {
      woFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [fromRmPurchase, listLoaded, salesOrderId, fgBalancesLoading]);

  const skipWoListFilterEffect = React.useRef(true);
  React.useEffect(() => {
    if (skipWoListFilterEffect.current) {
      skipWoListFilterEffect.current = false;
      return;
    }
    void loadWorkOrderList();
  }, [woStatusFilter, completedPageFromUrl, loadWorkOrderList]);

  const didInitialWoSoFocusRef = React.useRef(false);
  React.useEffect(() => {
    if (!canProd || !listLoaded || approvedSos.length === 0 || noQtySelected) {
      didInitialWoSoFocusRef.current = false;
      return;
    }
    if (lockSalesOrderSelector) {
      didInitialWoSoFocusRef.current = true;
      return;
    }
    if (didInitialWoSoFocusRef.current) return;
    didInitialWoSoFocusRef.current = true;
    const id = window.setTimeout(() => salesOrderSelectRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [canProd, listLoaded, approvedSos.length, noQtySelected, lockSalesOrderSelector]);

  const noQtySoScopeId = noQtySelected && salesOrderId !== "" ? Number(salesOrderId) : null;
  const scopedOpenWoRows = React.useMemo(() => {
    if (!noQtySoScopeId || !Number.isFinite(noQtySoScopeId) || noQtySoScopeId <= 0) return openWoRows;
    return openWoRows.filter((w) => w.salesOrderId === noQtySoScopeId);
  }, [openWoRows, noQtySoScopeId]);
  const scopedCompletedWoRows = React.useMemo(() => {
    if (!noQtySoScopeId || !Number.isFinite(noQtySoScopeId) || noQtySoScopeId <= 0) return completedWoRows;
    return completedWoRows.filter((w) => w.salesOrderId === noQtySoScopeId);
  }, [completedWoRows, noQtySoScopeId]);

  const visibleOpenRows = React.useMemo(
    () => filterSortWoList(scopedOpenWoRows, qDraft, listSortKey, listSortDir),
    [scopedOpenWoRows, qDraft, listSortKey, listSortDir],
  );
  const visibleCompletedRows = React.useMemo(
    () => filterSortWoList(scopedCompletedWoRows, qDraft, listSortKey, listSortDir),
    [scopedCompletedWoRows, qDraft, listSortKey, listSortDir],
  );

  const rows = React.useMemo(() => {
    if (woStatusFilter === "ALL") return [...scopedOpenWoRows, ...scopedCompletedWoRows];
    if (woStatusFilter === "OPEN") return scopedOpenWoRows;
    return scopedCompletedWoRows;
  }, [woStatusFilter, scopedOpenWoRows, scopedCompletedWoRows]);

  const woListFiltersActive =
    woStatusFilter !== DEFAULT_WO_STATUS_FILTER ||
    qDraft.trim().length > 0 ||
    listSortKey !== "id" ||
    listSortDir !== "desc" ||
    completedPageFromUrl > 1;

  function clearWoListFilters() {
    setQDraft("");
    patch({ woStatus: null, q: null, sort: null, dir: null, woCPage: null });
  }

  const completedTotalPages = Math.max(1, Math.ceil(completedTotal / COMPLETED_PAGE_SIZE) || 1);
  const canCompletedPrev = completedPageFromUrl > 1;
  const canCompletedNext = completedPageFromUrl < completedTotalPages;

  const listInfoCompleted =
    woStatusFilter === "COMPLETED" || woStatusFilter === "ALL"
      ? completedTotal === 0
        ? "No completed work orders."
        : `Showing ${completedWoRows.length} completed work orders (page ${completedPageFromUrl} of ${completedTotalPages}, ${completedTotal} total).`
      : null;

  const clearWorkOrderDrillFocus = React.useCallback(() => {
    setSearchParams((prev) => deleteUrlParamKeys(prev, [DRILL_QUERY.workOrderId]), { replace: true });
  }, [setSearchParams]);

  /** Clears list filters that can hide the focused WO; keeps sort, dir, so, workOrderId. */
  const revealWorkOrderDrillTarget = React.useCallback(() => {
    setQDraft("");
    patch({ woStatus: null, q: null, woCPage: null });
  }, [patch, setQDraft]);

  const woDrillInData = focusWorkOrderId > 0 && rows.some((r) => r.id === focusWorkOrderId);
  const woDrillVisible =
    focusWorkOrderId > 0 &&
    (visibleOpenRows.some((r) => r.id === focusWorkOrderId) ||
      visibleCompletedRows.some((r) => r.id === focusWorkOrderId));
  const woDrillHiddenByFilters = listLoaded && woDrillInData && !woDrillVisible;

  useDrillFocus({
    attribute: DRILL_DATA.workOrderId,
    id: focusWorkOrderId,
    ready: listLoaded,
    enabled: focusWorkOrderId > 0,
    retryDeps: [rows.length, woDrillVisible],
  });

  React.useEffect(() => {
    const st = loc.state;
    if (appliedPrefill.current) return;
    if (!st) return;
    const hasMeaningfulNavState =
      st.salesOrderId != null ||
      (Array.isArray(st.woLines) && st.woLines.length > 0) ||
      (st.excludeWorkOrderId != null && st.excludeWorkOrderId > 0) ||
      (st.requirementSheetId != null && Number(st.requirementSheetId) > 0) ||
      st.fromRequirementSheet === true ||
      st.source === "requirementSheet" ||
      (st.source === "rmCheck" && (st.salesOrderId != null || (Array.isArray(st.woLines) && st.woLines.length > 0)));
    if (!hasMeaningfulNavState) return;
    appliedPrefill.current = true;
    void (async () => {
      if (st.salesOrderId != null) {
        setSalesOrderId(st.salesOrderId);
        const mappedLines: WoFormLine[] | null =
          Array.isArray(st.woLines) && st.woLines.length > 0
            ? st.woLines.map((l) => ({
                fgItemId: l.fgItemId,
                qtyStr: String(l.qty),
              }))
            : null;
        try {
          await loadSoDetail(st.salesOrderId, mappedLines);
        } catch {
          /* list may load later */
        }
      }
      if (st.excludeWorkOrderId != null && st.excludeWorkOrderId > 0) {
        patch({ excludeWo: String(st.excludeWorkOrderId) });
      }
      if (st.requirementSheetId != null && Number(st.requirementSheetId) > 0) {
        // Prefill NO_QTY WO lines from the locked requirement sheet (SO-scoped navigation).
        try {
          const pf = await apiFetch<{ salesOrderId: number; lines: { fgItemId: number; qty: number }[] }>(
            `/api/requirement-sheets/${Number(st.requirementSheetId)}/wo-prefill`,
          );
          if (pf?.salesOrderId != null && Number.isFinite(Number(pf.salesOrderId)) && Number(pf.salesOrderId) > 0) {
            setSalesOrderId(Number(pf.salesOrderId));
            try {
              await loadSoDetail(Number(pf.salesOrderId));
            } catch {
              /* list may load later */
            }
          }
          const lines = Array.isArray(pf?.lines) ? pf.lines : [];
          if (lines.length) {
            setWoLines(lines.map((l) => ({ fgItemId: Number(l.fgItemId), qtyStr: String(l.qty) })));
          }
        } catch {
          // If prefill fails, keep the default empty line; operator can still view the created WO in the list.
        }
      }
    })();
  }, [loc.state]);

  React.useEffect(() => {
    if (fromNoQtySo) return;
    if (appliedPrefill.current) return;
    if (!listLoaded || !approvedSos.length) return;
    const id = regularSoIdFromUrl;
    if (id <= 0 || !approvedSos.some((s) => s.id === id)) return;
    appliedPrefill.current = true;
    setSalesOrderId(id);
    if (soFromUrl <= 0 && id > 0) {
      patch({ so: String(id) });
    }
    loadSoDetail(id).catch((e) => {
      setError(e instanceof Error ? e.message : "Failed to load sales order");
      setSalesOrderId("");
      appliedPrefill.current = false;
    });
  }, [listLoaded, approvedSos, regularSoIdFromUrl, fromNoQtySo, soFromUrl, patch]);

  async function createWo(opts?: { override: boolean; reason?: string }) {
    setError(null);
    if (salesOrderId === "") {
      setError("Select an approved sales order.");
      return;
    }
    if (!soDetail || soDetail.internalStatus !== "APPROVED") {
      setError("Sales order must be approved.");
      return;
    }
    if (noQtyBlocked) {
      setError("For No Qty Sales Orders, Work Orders must be created from Requirement Sheet.");
      return;
    }
    if (!fgSoLines.length) {
      setError("This sales order has no finished goods lines. Add FG lines on the sales order first.");
      return;
    }
    const allowed = new Set(fgSoLines.map((l) => l.itemId));
    if (woLines.some((l) => !allowed.has(l.fgItemId) || l.fgItemId === 0)) {
      setError("Each line must use a finished good from the selected sales order.");
      return;
    }
    const parsedLines: { fgItemId: number; qty: number }[] = [];
    for (const l of woLines) {
      const q = parsePositiveQuantityDraft(l.qtyStr);
      if (q == null) {
        setError("Enter WO quantity");
        return;
      }
      parsedLines.push({ fgItemId: l.fgItemId, qty: q });
    }
    const agg = new Map<number, number>();
    for (const pl of parsedLines) {
      agg.set(pl.fgItemId, (agg.get(pl.fgItemId) || 0) + pl.qty);
    }
    for (const [itemId, qty] of agg) {
      const bal = fgBalanceByItemId.get(itemId);
      const allowed = bal?.balanceQty ?? 0;
      if (rowUsesShortfallBufferFeatures(itemId)) continue;
      if (qty > allowed + QTY_EPS) {
        setError("Exceeds allowed quantity");
        return;
      }
    }
    setCreatingWo(true);
    try {
      const payload = {
        salesOrderId: Number(salesOrderId),
        lines: parsedLines,
        ...(opts?.override
          ? {
              fgStockOverride: {
                enabled: true,
                reason: (opts.reason || "").trim(),
              },
            }
          : {}),
        ...(sendShortfallWoBufferToApi ? { shortfallMode: true, shortfallBufferPercent: shortfallBufferPercentForCalc } : {}),
      };
      await apiFetch("/api/production/work-orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refresh();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "FG_STOCK_SUFFICIENT_ADMIN_OVERRIDE_REQUIRED" && isAdmin) {
        setOverridePayload({ salesOrderId: Number(salesOrderId), lines: woLines.map((x) => ({ ...x })) });
        setOverrideReason("");
        setOverrideShowReason(false);
        setOverrideOpen(true);
        setError(null);
        return;
      }
      const raw = e instanceof Error ? e.message : "Failed";
      setError(friendlyErrorMessage(raw));
    } finally {
      setCreatingWo(false);
    }
  }

  async function onCreateWo() {
    return createWo({ override: false });
  }

  function closeOverrideModal() {
    setOverrideOpen(false);
    setOverridePayload(null);
    setOverrideReason("");
    setOverrideShowReason(false);
  }

  async function submitOverride() {
    if (!overridePayload) return;
    const reason = overrideReason.trim();
    if (!reason) {
      setError("Override reason is required.");
      return;
    }
    setOverrideSaving(true);
    try {
      const overrideParsed: { fgItemId: number; qty: number }[] = [];
      for (const l of overridePayload.lines) {
        const q = parsePositiveQuantityDraft(l.qtyStr);
        if (q == null) {
          setError("Enter WO quantity");
          return;
        }
        overrideParsed.push({ fgItemId: l.fgItemId, qty: q });
      }
      const overrideAgg = new Map<number, number>();
      for (const pl of overrideParsed) {
        overrideAgg.set(pl.fgItemId, (overrideAgg.get(pl.fgItemId) || 0) + pl.qty);
      }
      for (const [itemId, qty] of overrideAgg) {
        const bal = fgBalanceByItemId.get(itemId);
        const allowed = bal?.balanceQty ?? 0;
        if (rowUsesShortfallBufferFeatures(itemId)) continue;
        if (qty > allowed + QTY_EPS) {
          setError("Exceeds allowed quantity");
          return;
        }
      }
      // Use the saved payload snapshot so the override always applies to the same lines the user attempted.
      setSalesOrderId(overridePayload.salesOrderId);
      setWoLines(overridePayload.lines);
      await apiFetch("/api/production/work-orders", {
        method: "POST",
        body: JSON.stringify({
          salesOrderId: overridePayload.salesOrderId,
          lines: overrideParsed,
          fgStockOverride: { enabled: true, reason },
          ...(sendShortfallWoBufferToApi ? { shortfallMode: true, shortfallBufferPercent: shortfallBufferPercentForCalc } : {}),
        }),
      });
      closeOverrideModal();
      await refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Failed";
      setError(friendlyErrorMessage(raw));
    } finally {
      setOverrideSaving(false);
    }
  }

  async function onDeleteWo(id: number) {
    const reasonRaw = window.prompt("Reason for cancelling this work order (required):");
    if (reasonRaw == null) return;
    const reason = reasonRaw.trim();
    if (!reason) {
      setError("Reason is required to cancel a work order.");
      return;
    }
    if (!confirm("Cancel (delete) this work order?")) return;
    try {
      await apiFetch(`/api/production/work-orders/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const { state: noQtyFlowState } = useNoQtyFlowState(
    fromNoQtySo && Number.isFinite(focusSoIdFromUrl) && focusSoIdFromUrl > 0 ? focusSoIdFromUrl : null,
    Boolean(fromNoQtySo && Number.isFinite(focusSoIdFromUrl) && focusSoIdFromUrl > 0),
    fromNoQtySo ? { cycleId: noQtyCycleIdFromUrl } : undefined,
  );
  /** Guided links + list filtering: URL cycle wins over flow-state cycle (RS may be on an older cycle than SO.currentCycleId). */
  const noQtyGuidedCycleForLinks =
    fromNoQtySo ? noQtyCycleIdFromUrl ?? noQtyFlowState?.cycleId ?? null : null;

  const noQtyOpenWoContext = React.useMemo(() => {
    if (!fromNoQtySo || focusSoIdFromUrl <= 0) {
      return { primary: null as WoRow | null, older: [] as WoRow[] };
    }
    const scopedForSo = visibleOpenRows.filter((w) => w.salesOrderId === focusSoIdFromUrl);
    const matchesNoQtyContext = (w: WoRow) => {
      if (noQtyRequirementSheetIdFromUrl != null) {
        return Number(w.requirementSheetId ?? 0) === noQtyRequirementSheetIdFromUrl;
      }
      if (noQtyCycleIdFromUrl != null) {
        return Number(w.cycleId ?? 0) === noQtyCycleIdFromUrl;
      }
      const flowC = noQtyFlowState?.cycleId ?? null;
      if (flowC != null) return Number(w.cycleId ?? 0) === Number(flowC);
      return true;
    };
    const matched = scopedForSo.filter(matchesNoQtyContext);
    return {
      primary: matched[0] ?? null,
      older: scopedForSo.filter((w) => !matchesNoQtyContext(w)),
    };
  }, [
    fromNoQtySo,
    focusSoIdFromUrl,
    visibleOpenRows,
    noQtyRequirementSheetIdFromUrl,
    noQtyCycleIdFromUrl,
    noQtyFlowState?.cycleId,
  ]);
  const noQtyGuidedCycleNoForDisplay = React.useMemo((): number | null => {
    const primaryNo = noQtyOpenWoContext.primary?.cycle?.cycleNo;
    if (primaryNo != null && Number.isFinite(Number(primaryNo))) return Number(primaryNo);
    const guidedId = noQtyGuidedCycleForLinks;
    if (guidedId == null) return null;
    const match = [...openWoRows, ...completedWoRows].find((w) => Number(w.cycleId ?? 0) === Number(guidedId));
    const n = match?.cycle?.cycleNo;
    return n != null && Number.isFinite(Number(n)) ? Number(n) : null;
  }, [noQtyOpenWoContext.primary, noQtyGuidedCycleForLinks, openWoRows, completedWoRows]);

  const liveTick = useErpRefreshTick(["production", "dashboard", "workorders"], { pollIntervalMs: 0 });
  const [noQtyProductionQueue, setNoQtyProductionQueue] = React.useState<DashboardProductionStatusSource[]>([]);

  React.useEffect(() => {
    if (!noQtySelected) return;
    let mounted = true;
    void apiFetch<DashboardProductionStatusSource[]>("/api/dashboard/production-queue")
      .then((data) => {
        if (mounted) setNoQtyProductionQueue(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (mounted) setNoQtyProductionQueue([]);
      });
    return () => {
      mounted = false;
    };
  }, [noQtySelected, liveTick]);

  const noQtyWoDisplayStatusById = React.useMemo(() => {
    const map = new Map<number, { label: string; rawStatus: string }>();
    if (!noQtySelected) return map;
    const currentCycleId = noQtyFlowState?.canonicalCycleId ?? noQtyFlowState?.cycleId ?? null;
    for (const wo of [...openWoRows, ...completedWoRows]) {
      const isPriorCycle =
        currentCycleId != null &&
        Number(wo.cycleId ?? 0) > 0 &&
        Number(wo.cycleId) !== Number(currentCycleId);
      const display = resolveNoQtyCycleDisplayStatusForWorkOrder(wo, noQtyProductionQueue, {
        isPriorCycle,
        scope: isPriorCycle ? "historical" : "auto",
      });
      map.set(wo.id, { label: display.label, rawStatus: wo.status });
    }
    return map;
  }, [noQtySelected, openWoRows, completedWoRows, noQtyProductionQueue, noQtyFlowState?.canonicalCycleId, noQtyFlowState?.cycleId]);

  const noQtyGuidedCycleDisplayStatus = React.useMemo(() => {
    const wo = noQtyOpenWoContext.primary;
    if (!fromNoQtySo || !wo) return null;
    const currentCycleId = noQtyFlowState?.canonicalCycleId ?? noQtyFlowState?.cycleId ?? null;
    const viewedCycleId = noQtyCycleIdFromUrl ?? (Number(wo.cycleId ?? 0) > 0 ? Number(wo.cycleId) : null);
    const isPriorCycle =
      currentCycleId != null &&
      viewedCycleId != null &&
      Number(viewedCycleId) > 0 &&
      Number(viewedCycleId) !== Number(currentCycleId);
    return resolveNoQtyCycleDisplayStatusForWorkOrder(wo, noQtyProductionQueue, {
      isPriorCycle,
      scope: isPriorCycle ? "historical" : "auto",
    });
  }, [
    fromNoQtySo,
    noQtyOpenWoContext.primary,
    noQtyProductionQueue,
    noQtyFlowState?.canonicalCycleId,
    noQtyFlowState?.cycleId,
    noQtyCycleIdFromUrl,
  ]);

  const cameFromRegularPlanning =
    !fromNoQtySo &&
    cameFromRmCheckPlanning &&
    soDetail?.orderType === "NORMAL" &&
    salesOrderId !== "";

  const eligibleFgItemIdsForWoTable = React.useMemo(() => {
    if (!useRegularWoPlanningTable) return [] as number[];
    return fgSoLines
      .map((sl) => sl.itemId)
      .filter((id) => (fgBalanceByItemId.get(id)?.balanceQty ?? 0) > QTY_EPS);
  }, [useRegularWoPlanningTable, fgSoLines, fgBalanceByItemId]);

  const allEligibleFgSelected =
    eligibleFgItemIdsForWoTable.length > 0 &&
    eligibleFgItemIdsForWoTable.every((id) => regularWoByItemId[id]?.sel === true);

  function toggleSelectAllEligibleRows() {
    if (!eligibleFgItemIdsForWoTable.length) return;
    const on = !allEligibleFgSelected;
    setRegularWoByItemId((prev) => {
      const next: Record<number, { sel: boolean; qtyStr: string }> = { ...prev };
      for (const sl of fgSoLines) {
        const id = sl.itemId;
        const rem = fgBalanceByItemId.get(id)?.balanceQty ?? 0;
        if (rem <= QTY_EPS) {
          next[id] = { sel: false, qtyStr: "" };
        } else if (on) {
          let s: string;
          if (rowUsesShortfallBufferFeatures(id)) {
            shortfallWoQtyUserTouchedRef.current.delete(id);
            const base = shortfallBaseQtyForRow(id, rem);
            const sug = getShortfallSuggestedQty(base, shortfallBufferPercentForCalc);
            s = Number.isInteger(sug) ? String(sug) : String(Number(sug.toFixed(4)));
          } else {
            s = Number.isInteger(rem) ? String(rem) : String(Number(rem.toFixed(3)));
          }
          next[id] = { sel: true, qtyStr: s };
        } else {
          next[id] = { sel: false, qtyStr: "" };
        }
      }
      return next;
    });
  }

  const regularWoSelectedCount = React.useMemo(() => {
    if (!useRegularWoPlanningTable) return 0;
    return fgSoLines.filter((sl) => regularWoByItemId[sl.itemId]?.sel === true).length;
  }, [useRegularWoPlanningTable, fgSoLines, regularWoByItemId]);

  const regularWoTotalQtySelected = React.useMemo(() => {
    if (!useRegularWoPlanningTable) return 0;
    let t = 0;
    for (const sl of fgSoLines) {
      const c = regularWoByItemId[sl.itemId];
      if (!c?.sel) continue;
      const q = parsePositiveQuantityDraft(c.qtyStr);
      if (q != null && Number.isFinite(q)) t += q;
    }
    return t;
  }, [useRegularWoPlanningTable, fgSoLines, regularWoByItemId]);

  /** Hide “exceeds planning remainder” in WoInfoPanel when REGULAR shortfall buffer allows draft &gt; remaining. */
  const woInfoRelaxPlanningDraftOverCap = React.useMemo(() => {
    if (!useRegularWoPlanningTable || !isRegularNormalOrderForWoPlanning || !pageIsShortfallProduction) return false;
    if (primaryLine.fgItemId <= 0) return false;
    return rowUsesShortfallBufferFeatures(primaryLine.fgItemId);
  }, [
    useRegularWoPlanningTable,
    isRegularNormalOrderForWoPlanning,
    pageIsShortfallProduction,
    primaryLine.fgItemId,
    fgBalanceByItemId,
  ]);

  const shortfallSuggestedCapFromUrl =
    shortfallQtyUrlActive && shortfallQtyCustomerTracking > 0
      ? getShortfallSuggestedQty(shortfallQtyCustomerTracking, shortfallBufferPercentForCalc)
      : null;

  /** Sum of per-line buffered suggestions for currently selected FG rows (no URL shortfall). */
  const regularWoSuggestedBufferTotalSelectedCap = React.useMemo(() => {
    if (!pageIsShortfallProduction || !isRegularNormalOrderForWoPlanning || !useRegularWoPlanningTable) return null;
    let sum = 0;
    for (const sl of fgSoLines) {
      const c = regularWoByItemId[sl.itemId];
      if (!c?.sel) continue;
      const rem = fgBalanceByItemId.get(sl.itemId)?.balanceQty ?? 0;
      if (!(rem > QTY_EPS)) continue;
      sum += getShortfallSuggestedQty(rem, shortfallBufferPercentForCalc);
    }
    return sum > QTY_EPS ? sum : null;
  }, [
    pageIsShortfallProduction,
    isRegularNormalOrderForWoPlanning,
    useRegularWoPlanningTable,
    fgSoLines,
    regularWoByItemId,
    fgBalanceByItemId,
    shortfallBufferPercentForCalc,
  ]);

  const customerTrackingWoQtyExceedsShortfall =
    shortfallSuggestedCapFromUrl != null
      ? (woShortfallFromGuidedEntry || shortfallQtyUrlActive) &&
        regularWoTotalQtySelected > shortfallSuggestedCapFromUrl + QTY_EPS
      : pageIsShortfallProduction &&
        regularWoSuggestedBufferTotalSelectedCap != null &&
        regularWoTotalQtySelected > regularWoSuggestedBufferTotalSelectedCap + QTY_EPS;

  const openWoCount = openWoRows.length;
  const listFilteredOut =
    rows.length > 0 && visibleOpenRows.length === 0 && visibleCompletedRows.length === 0;

  return (
    <PageContainer className={cn("erp-flow-page -mt-2 space-y-1.5 pb-3", cameFromRegularPlanning && "space-y-1.5")}>
      <StickyWorkspaceHead
        lead={
          <>
            <DemoFlowBanner />
            {fromNoQtySo ? (
              <PageNoQtyFlowBackLink step="WORK_ORDER" />
            ) : (
              <PageSmartBackLink defaultTo="/sales-orders" defaultLabel={REGULAR_TERMS.SIDEBAR_BACK_TO_SALES_ORDERS} />
            )}
          </>
        }
      >
        <div className="min-w-0 space-y-0.5">
          <h1 className="text-base font-semibold leading-tight tracking-tight text-slate-900">
            {showWoWorkspace ? "Work Order Workspace" : "Work Order"}
          </h1>
          <p className="erp-type-helper text-slate-500">
            {showWoWorkspace
              ? "Track open and completed work orders across REGULAR and NO_QTY."
              : "Select SO · set WO qty · create work order."}
          </p>
        </div>
      </StickyWorkspaceHead>
      {fromNoQtySo && salesOrderId !== "" ? <NoQtyCycleBanner so={soDetail as any} /> : null}
      {fromRmPurchase && !fromNoQtySo && salesOrderId !== "" ? (
        <div
          className="rounded-md border border-emerald-200 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-950 shadow-sm"
          data-testid="wo-rm-purchase-continuity-banner"
        >
          <p className="font-semibold">{RM_PURCHASE_POST_GRN_MESSAGES.fulfilledHeadline}</p>
          <p className="mt-0.5">{RM_PURCHASE_POST_GRN_MESSAGES.fulfilledDetail}</p>
          <p className="mt-1 text-emerald-900">{RM_PURCHASE_POST_GRN_MESSAGES.fulfilledNextStep}</p>
        </div>
      ) : null}
      {!fromNoQtySo && isRegularNormalOrderForWoPlanning && pageIsShortfallProduction && salesOrderId !== "" && !cameFromRmCheckPlanning ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-3 text-sm text-amber-950 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="erp-form-field min-w-0">
              <label className="erp-form-label text-xs" htmlFor="shortfall-buffer-pct">
                Production buffer % (optional)
              </label>
              <Input
                id="shortfall-buffer-pct"
                type="number"
                min={0}
                max={10}
                step={0.5}
                className="h-9 w-28 tabular-nums"
                value={shortfallBufferPercentInput}
                onChange={(e) => setShortfallBufferPercentInput(e.target.value)}
              />
            </div>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-amber-900">
            Optional production buffer to cover rejection risk. Default is 0% — WO qty starts at remaining planned qty.
            Use 0–10%; extra production goes to usable stock.
          </p>
          {shortfallBufferPercentInvalidHigh ? (
            <p className="mt-1 text-[11px] font-medium text-amber-900">Maximum shortfall buffer allowed is 10%.</p>
          ) : null}
          {shortfallBufferPercentInvalidLow ? (
            <p className="mt-1 text-[11px] font-medium text-amber-900">Minimum shortfall buffer is 0%.</p>
          ) : null}
          {!woShortfallFromGuidedEntry && hasAnyFgRemainingForShortfall && shortfallBufferPercentForCalc > 0 ? (
            <p className="mt-2 text-xs text-amber-950">
              <span className="font-semibold">Tip:</span> Suggested WO qty adds{" "}
              <span className="tabular-nums font-semibold">{shortfallBufferPercentForCalc}</span>% to each line&apos;s
              remaining qty until you edit WO qty manually.
            </p>
          ) : !woShortfallFromGuidedEntry && hasAnyFgRemainingForShortfall ? (
            <p className="mt-2 text-xs text-amber-950">
              <span className="font-semibold">Tip:</span> WO qty defaults to each line&apos;s remaining planned qty. Raise
              buffer % only if you want extra production for rejection risk.
            </p>
          ) : null}
        </div>
      ) : null}
      {!fromNoQtySo && isRegularNormalOrderForWoPlanning && pageIsShortfallProduction && salesOrderId !== "" && cameFromRmCheckPlanning ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-xs font-medium text-emerald-950 shadow-sm">
          Buffer already applied in planning. Work Order quantities use the prepared planned production quantity.
        </div>
      ) : null}
      {!fromNoQtySo && woShortfallFromGuidedEntry && shortfallQtyCustomerTracking > 0 && salesOrderId !== "" ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 shadow-sm">
          {fromQcEntryWo ? (
            <>
              <span className="font-semibold">Shortfall production:</span> At least{" "}
              <span className="tabular-nums font-semibold">{fmtWoExplainQty(shortfallQtyCustomerTracking)}</span> is still
              needed on the order. The table suggests{" "}
              <span className="tabular-nums font-semibold">
                {fmtWoExplainQty(getShortfallSuggestedQty(shortfallQtyCustomerTracking, shortfallBufferPercentForCalc))}
              </span>{" "}
              {shortfallBufferPercentForCalc > 0
                ? ` (includes ${shortfallBufferPercentForCalc}% optional buffer)`
                : " (remaining qty, no buffer)"}{" "}
              — you can change WO qty anytime.
            </>
          ) : (
            <>
              <span className="font-semibold">Customer Tracking shortfall:</span>{" "}
              <span className="tabular-nums">{fmtWoExplainQty(shortfallQtyCustomerTracking)}</span> still pending to
              deliver. Suggested WO qty:{" "}
              <span className="tabular-nums font-semibold">
                {fmtWoExplainQty(getShortfallSuggestedQty(shortfallQtyCustomerTracking, shortfallBufferPercentForCalc))}
              </span>
              {shortfallBufferPercentForCalc > 0 ? ` (includes ${shortfallBufferPercentForCalc}% optional buffer)` : ""}. You
              can lower or raise qty in the table.
            </>
          )}
        </div>
      ) : null}

      <NextStepStrip
        visible={Boolean(
          roleUi.showWoNoQtyProductionHandoffStrip &&
            fromNoQtySo &&
            noQtySelected &&
            noQtyFlowState?.nextAction === "PRODUCTION" &&
            noQtyFlowState,
        )}
        density="compact"
        variant="action"
        title="Start Production"
        subtitle="Work order is ready."
        primaryAction={{
          label: "Go to Production",
          testId: "next-start-production",
          onClick: () =>
            noQtyFlowState &&
            nav(
              buildNoQtyGuidedHref({
                to: "/production",
                salesOrderId: noQtyFlowState.salesOrderId,
                cycleId: noQtyFlowState.cycleId,
                fromStep: "requirement",
              }),
            ),
        }}
      />
      <NextStepStrip
        visible={Boolean(
          roleUi.showWoNoQtyQcHandoffStrip &&
            fromNoQtySo &&
            noQtySelected &&
            noQtyFlowState?.nextAction === "QC" &&
            noQtyFlowState,
        )}
        density="compact"
        variant="action"
        title="QA in progress"
        subtitle="Production entries exist for this cycle."
        primaryAction={{
          label: "Complete QA",
          testId: "next-save-qc",
          onClick: () =>
            noQtyFlowState &&
            nav(
              buildNoQtyGuidedHref({
                to: "/qc-entry",
                salesOrderId: noQtyFlowState.salesOrderId,
                cycleId: noQtyFlowState.cycleId,
                fromStep: "production",
              }),
            ),
        }}
      />

      {fromNoQtySo && noQtySelected && soDetail && salesOrderId !== "" ? (
        <NoQtyCycleContextBar
          soId={soDetail.id}
          soDocNo={soDetail.docNo ?? null}
          customerName={soDetail.customer?.name ?? soDetail.po?.customer?.name ?? "—"}
          cycleNo={noQtyGuidedCycleNoForDisplay}
          erpAdjustedPlanningQty={fgBalances.reduce((s, b) => s + Number(b.carryForwardShortfallQty ?? 0), 0)}
          operatorPendingQty={fgBalances.reduce((s, b) => s + Math.max(0, Number(b.balanceQty ?? 0)), 0)}
          totalToProduceQty={fgBalances.reduce((s, b) => s + Number(b.noQtyFinalWoQty ?? b.noQtyLatestRsQty ?? 0), 0)}
          qcPassedQty={fgBalances.reduce((s, b) => s + Number(b.noQtyQcPassedStockQty ?? 0), 0)}
        />
      ) : null}

      <DrillFocusBanner
        active={focusWorkOrderId > 0}
        title={drillFocusTitleWorkOrder(focusWorkOrderId)}
        variant={
          listLoaded && focusWorkOrderId > 0 && !woDrillInData
            ? "soft"
            : woDrillHiddenByFilters
              ? "soft"
              : "default"
        }
        hint={
          listLoaded && focusWorkOrderId > 0 && !woDrillInData
            ? DRILL_FOCUS_HINT_NOT_IN_LIST.workOrder
            : woDrillHiddenByFilters
              ? DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS.workOrder
              : undefined
        }
        recoveryAction={
          woDrillHiddenByFilters ? { label: DRILL_RECOVERY_LABEL.workOrder, onClick: revealWorkOrderDrillTarget } : undefined
        }
        onClearFocus={clearWorkOrderDrillFocus}
      />
      {showWoWorkspace ? (
        <OperationalWorkOrderWorkspace />
      ) : (
      <Card className="erp-op-workspace-primary min-w-0 overflow-hidden">
        <CardHeader className="space-y-0 border-b border-slate-100 bg-white px-3 py-2">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Create Work Order</CardTitle>
        </CardHeader>
        <CardContent className="px-3 py-2">
          {error ? <div className="mb-2 text-sm text-red-700">{error}</div> : null}
          {showRegularLifecyclePanel && editingWo ? (
            <WorkOrderLifecyclePanel
              className="mb-3"
              wo={editingWo}
              onUpdated={() => {
                void refresh();
              }}
            />
          ) : null}
          {canProd ? (
            <div
              ref={woFormRef}
              className={cn("erp-form w-full max-w-full", cameFromRegularPlanning ? "space-y-2" : "space-y-3")}
            >
              {fromNoQtySo && focusSoIdFromUrl > 0 ? (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current cycle summary</div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-[13px] text-slate-700">
                      <span className="font-medium text-slate-900">
                        SO {displaySalesOrderNo(focusSoIdFromUrl, (soDetail as any)?.docNo)}
                      </span>
                      {soDetail?.customer?.name || soDetail?.po?.customer?.name ? (
                        <span className="text-slate-400"> · </span>
                      ) : null}
                      <span className="truncate">{soDetail?.customer?.name ?? soDetail?.po?.customer?.name ?? "—"}</span>
                      {noQtyGuidedCycleNoForDisplay != null ? (
                        <>
                          <span className="text-slate-400"> · </span>
                          <span className="font-medium">Cycle {Number(noQtyGuidedCycleNoForDisplay)}</span>
                        </>
                      ) : null}
                      {noQtyGuidedCycleDisplayStatus ? (
                        <>
                          <span className="text-slate-400"> · </span>
                          <Badge
                            variant={woListStatusBadgeVariant(
                              noQtyGuidedCycleDisplayStatus.label,
                              noQtyOpenWoContext.primary?.status ?? "",
                            )}
                            className="text-[10px] font-medium"
                          >
                            {noQtyGuidedCycleDisplayStatus.label}
                          </Badge>
                        </>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {canOpenRs ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const base = buildNoQtyGuidedHref({
                              to: `/sales-orders/${focusSoIdFromUrl}/requirement-sheets`,
                              salesOrderId: focusSoIdFromUrl,
                              cycleId: noQtyGuidedCycleForLinks,
                              requirementSheetId: noQtyRequirementSheetIdFromUrl,
                            });
                            const sep = base.includes("?") ? "&" : "?";
                            nav(
                              noQtyRequirementSheetIdFromUrl != null
                                ? `${base}${sep}sheetId=${encodeURIComponent(String(noQtyRequirementSheetIdFromUrl))}`
                                : base,
                            );
                          }}
                        >
                          Open Requirement Sheet
                        </Button>
                      ) : (
                        <PlanningStatusChip inline label="Planned in Requirement Sheet" />
                      )}
                      {noQtyOpenWoContext.primary ? (
                        <Link
                          to={buildNoQtyGuidedHref({
                            to: "/production",
                            salesOrderId: focusSoIdFromUrl,
                            cycleId: noQtyGuidedCycleForLinks,
                            fromStep: "work_order",
                          })}
                        >
                          <Button type="button" size="sm">
                            Go to Production
                          </Button>
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  {(() => {
                    const wo = noQtyOpenWoContext.primary;
                    const older = noQtyOpenWoContext.older;

                    if (!wo) {
                      return (
                        <div className="mt-2 text-xs text-slate-600">
                          No active work order lines found for the current cycle.
                        </div>
                      );
                    }
                    return (
                      <div className="mt-2 space-y-2">
                        <div className="overflow-x-auto rounded border border-slate-200 bg-slate-50 px-2 py-2">
                          <div className="text-[12px] font-semibold text-slate-700">
                            WO {displayWorkOrderNo(wo.id, wo.docNo)}
                            {wo.cycle?.cycleNo != null ? (
                              <span className="text-violet-900">
                                {" "}
                                · Cycle {Number(wo.cycle.cycleNo)}
                              </span>
                            ) : null}{" "}
                            · {wo.lines.length} line(s)
                          </div>
                          <table className="mt-2 w-full min-w-[520px] text-[12px]">
                            <thead>
                              <tr className="border-b border-slate-200 text-left text-[11px] font-medium text-slate-600">
                                <th className="py-1 pr-2">Item</th>
                                <th className="py-1 text-right">Planned qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(wo.lines || []).map((ln) => (
                                <tr key={ln.id} className="border-b border-slate-100">
                                  <td className="py-1 pr-2">{ln.fgItem.itemName}</td>
                                  <td className="py-1 text-right tabular-nums">{ln.qty}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {older.length > 0 ? (
                          <details className="rounded border border-slate-200 bg-white px-2.5 py-2">
                            <summary className="cursor-pointer text-[12px] font-medium text-slate-700">
                              Older history ({older.length})
                            </summary>
                            <div className="mt-2 space-y-2">
                              {older.slice(0, 8).map((w) => (
                                <div key={w.id} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[12px]">
                                  <div className="font-medium text-slate-800">
                                    WO {displayWorkOrderNo(w.id, w.docNo)}
                                    {w.cycle?.cycleNo != null ? (
                                      <span className="text-slate-600">
                                        {" "}
                                        · Cycle {Number(w.cycle.cycleNo)}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-slate-600">
                                    {(w.lines || []).slice(0, 3).map((ln) => ln.fgItem.itemName).join(", ")}
                                    {(w.lines || []).length > 3 ? "…" : ""}
                                  </div>
                                </div>
                              ))}
                              {older.length > 8 ? (
                                <div className="text-[11px] text-slate-600">Showing 8 of {older.length} older work orders.</div>
                              ) : null}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              ) : null}
              {noQtySelected ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                  <div className="font-medium">No Qty SO workflow</div>
                  <div className="mt-1 text-[13px] text-slate-700">
                    Work Orders are automatically created from Requirement Sheet in No Qty SO workflow.
                  </div>
                  {salesOrderId !== "" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] text-slate-700">
                        <span className="font-medium">
                Sales Order No: {displaySalesOrderNo(Number(salesOrderId), soDetail?.docNo)}
              </span>
                      </span>
                      {canOpenRs ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => nav(`/sales-orders/${Number(salesOrderId)}/requirement-sheets`)}
                        >
                          Open Requirement Sheet
                        </Button>
                      ) : (
                        <PlanningStatusChip inline label="Waiting for Planning Team" />
                      )}
                    </div>
                  ) : null}
                  {salesOrderId !== "" && !fgBalancesLoading && fgBalances.length > 0 ? (
                    <div className="mt-3">
                      <div className="text-[12px] font-semibold text-slate-700">Next WO planning (No Qty SO)</div>
                      <div className="mt-1 text-[11px] text-slate-600">
                        Final WO Qty = Balance Qty + Latest RS Qty − QC Passed Stock (then minus open WO reserved qty).
                      </div>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[760px] text-[12px]">
                          <thead>
                            <tr className="border-b border-slate-200 text-left text-[11px] font-medium text-slate-600">
                              <th className="py-1 pr-2">FG</th>
                              <th className="py-1 pr-2 text-right">Balance Qty</th>
                              <th className="py-1 pr-2 text-right">Latest RS Qty</th>
                              <th className="py-1 pr-2 text-right">QC Passed Stock</th>
                              <th className="py-1 pr-2 text-right">Open WO reserved</th>
                              <th className="py-1 text-right">Final WO Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fgBalances.map((b) => (
                              <tr key={b.itemId} className="border-b border-slate-100">
                                <td className="py-1 pr-2">{b.itemName}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{Number(b.noQtyBalanceQty ?? 0).toFixed(3).replace(/\.?0+$/, "")}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{Number(b.noQtyLatestRsQty ?? 0).toFixed(3).replace(/\.?0+$/, "")}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{Number(b.noQtyQcPassedStockQty ?? b.stockAvailableQty ?? 0).toFixed(3).replace(/\.?0+$/, "")}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{Number(b.plannedOnOtherWorkOrdersQty ?? 0).toFixed(3).replace(/\.?0+$/, "")}</td>
                                <td className="py-1 text-right tabular-nums font-semibold text-slate-800">{Number(b.noQtyFinalWoQty ?? b.suggestedWoQty ?? 0).toFixed(3).replace(/\.?0+$/, "")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {isPrefilledFromRequirementSheet ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  <span className="font-medium">Created from Requirement Sheet</span>
                  {loc.state?.requirementSheetId ? (
                    <span className="text-emerald-800"> · Sheet #{loc.state.requirementSheetId}</span>
                  ) : null}
                </div>
              ) : null}
              {useRegularWoPlanningTable ? (
                  <div className="space-y-2 border-t border-slate-100 pt-2.5">
                  <NextStepStrip
                    className="w-full"
                    density="compact"
                    visible={Boolean(rmIssueNextStep)}
                    variant="blocked"
                    title={rmIssueNextStep?.statusTitle ?? "Waiting for RM Issue"}
                    subtitle={
                      rmIssueNextStep?.blockingReason
                        ? `${rmIssueNextStep.statusSubtitle ?? ""} · ${rmIssueNextStep.blockingReason}`
                        : rmIssueNextStep?.statusSubtitle
                    }
                    primaryAction={{
                      label: rmIssueNextStep?.primaryAction.label ?? "Issue RM to Production",
                      testId: rmIssueNextStep?.primaryAction.testId,
                      onClick: () => {
                        const href = rmIssueNextStep?.primaryAction.href;
                        if (href) nav(href);
                      },
                    }}
                  />
                  <NextStepStrip
                    className="w-full"
                    density="compact"
                    visible={Boolean(showProductionNextStepEffective && productionEntryHref)}
                    variant="action"
                    title="RM Issued – Start Production"
                    subtitle="Work order is ready for production entry."
                    primaryAction={{
                      label: "Enter Production",
                      testId: "next-enter-production-from-wo",
                      onClick: () => productionEntryHref && nav(productionEntryHref),
                    }}
                  />
                  <div className="erp-form-field min-w-0 max-w-full space-y-1.5">
                    <span className="erp-form-label">Sales order</span>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <div className="min-w-0 w-full sm:w-[73%] sm:max-w-[75%]">
                        {lockSalesOrderSelector && salesOrderId !== "" ? (
                          <div className="flex h-9 min-w-0 flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-800">
                            <span className="font-medium">Sales Order No:</span>
                            <span className="tabular-nums">{displaySalesOrderNo(Number(salesOrderId), soDetail?.docNo)}</span>
                            {soDetail?.customer?.name || soDetail?.po?.customer?.name ? (
                              <span className="truncate text-slate-600">· {soDetail?.customer?.name ?? soDetail?.po?.customer?.name}</span>
                            ) : null}
                            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-slate-500">Locked</span>
                          </div>
                        ) : (
                          <select
                            ref={salesOrderSelectRef}
                            className="erp-select h-9 w-full min-w-0"
                            value={salesOrderId === "" ? "" : String(salesOrderId)}
                            onChange={(e) => {
                              const v = e.target.value;
                              onSalesOrderSelect(v === "" ? "" : Number(v));
                            }}
                          >
                            <option value="">Select sales order…</option>
                            {approvedSos.map((s) => (
                              <option key={s.id} value={s.id}>
                                Sales Order No: {displaySalesOrderNo(s.id, s.docNo)}
                                {s.customer?.name ? ` — ${s.customer.name}` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <Button
                        type="button"
                        className="h-9 w-full shrink-0 sm:ml-0 sm:w-auto sm:min-w-[10.5rem]"
                        data-testid="create-wo-btn"
                        onClick={onCreateWo}
                        disabled={creatingWo || !woFormCanSubmit || showProductionNextStep}
                        {...(woDemoHl ? { "data-demo-highlight": woDemoHl } : {})}
                      >
                        {creatingWo ? "Saving…" : "Create Work Order"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] leading-snug text-slate-500">
                    {lockSalesOrderSelector
                      ? "Work order is being created for this sales order (opened from navigation)."
                      : "Only approved sales orders are shown."}
                  </p>
                  {salesOrderId === "" ? null : fgBalancesLoading ? (
                    <p className="text-sm text-slate-600">Loading FG planning…</p>
                  ) : !fgSoLines.length ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      This sales order has no finished goods lines.
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                        <table className="w-full min-w-[880px] border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              <th className="w-12 px-2 py-1.5">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300"
                                  checked={allEligibleFgSelected}
                                  disabled={!eligibleFgItemIdsForWoTable.length}
                                  onChange={toggleSelectAllEligibleRows}
                                  title="Select all items with remaining WO quantity"
                                  aria-label="Select all eligible FG lines"
                                />
                              </th>
                              <th className="px-2 py-1.5">Item</th>
                              <th className="px-2 py-1.5 text-right">Customer Qty</th>
                              <th className="px-2 py-1.5 text-right">Already planned</th>
                              <th className="px-2 py-1.5 text-right font-medium text-slate-600">Remaining</th>
                              <th className="min-w-[7rem] px-2 py-1.5 text-right font-semibold text-slate-800">Planned Production Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fgSoLines.map((sl) => {
                              const bal = fgBalanceByItemId.get(sl.itemId);
                              const orderQty = bal?.soOrderedQty ?? Number(sl.qty);
                              const planned = bal?.plannedOnOtherWorkOrdersQty ?? 0;
                              const remaining = bal?.balanceQty ?? 0;
                              const cell = regularWoByItemId[sl.itemId] ?? { sel: false, qtyStr: "" };
                              const selectable = remaining > QTY_EPS && !fgBalancesLoading;
                              const q = parsePositiveQuantityDraft(cell.qtyStr);
                              const rowShortfallBuf = rowUsesShortfallBufferFeatures(sl.itemId);
                              const baseForSuggest = shortfallBaseQtyForRow(sl.itemId, remaining);
                              const suggestedQty =
                                rowShortfallBuf && remaining > QTY_EPS
                                  ? getShortfallSuggestedQty(baseForSuggest, shortfallBufferPercentForCalc)
                                  : null;
                              const rowErr =
                                cell.sel && (q == null || q <= 0)
                                  ? "Enter a quantity greater than zero."
                                  : !rowShortfallBuf && cell.sel && q != null && q > remaining + QTY_EPS
                                    ? `Max ${fmtWoExplainQty(remaining)}.`
                                    : null;
                              const rowWarnShort =
                                rowShortfallBuf &&
                                cell.sel &&
                                q != null &&
                                q > QTY_EPS &&
                                q < remaining - QTY_EPS
                                  ? "Entered qty is less than remaining. Shortfall may remain."
                                  : null;
                              const rowInfoExtra =
                                rowShortfallBuf && cell.sel && q != null && q > remaining + QTY_EPS
                                  ? "Extra production will go to usable stock."
                                  : null;
                              return (
                                <tr key={sl.itemId} className="border-b border-slate-100 transition-colors hover:bg-slate-50/90">
                                  <td className="px-2 py-1.5 align-middle">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-slate-300"
                                      checked={Boolean(cell.sel)}
                                      disabled={!selectable}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setRegularWoByItemId((prev) => {
                                          const rem = fgBalanceByItemId.get(sl.itemId)?.balanceQty ?? 0;
                                          let s = "";
                                          if (checked && rem > QTY_EPS) {
                                            if (rowUsesShortfallBufferFeatures(sl.itemId)) {
                                              shortfallWoQtyUserTouchedRef.current.delete(sl.itemId);
                                              const base = shortfallBaseQtyForRow(sl.itemId, rem);
                                              const sug = getShortfallSuggestedQty(base, shortfallBufferPercentForCalc);
                                              s = Number.isInteger(sug) ? String(sug) : String(Number(sug.toFixed(4)));
                                            } else {
                                              s = Number.isInteger(rem) ? String(rem) : String(Number(rem.toFixed(3)));
                                            }
                                          }
                                          return {
                                            ...prev,
                                            [sl.itemId]: { sel: checked, qtyStr: checked ? s : "" },
                                          };
                                        });
                                      }}
                                      aria-label={`Select ${sl.item.itemName}`}
                                    />
                                  </td>
                                  <td className="px-2 py-1.5 text-[13px] font-medium text-slate-900">{sl.item.itemName}</td>
                                  <td className="px-2 py-1.5 text-right text-[13px] tabular-nums text-slate-800">
                                    {fmtWoExplainQty(orderQty)}
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-[13px] tabular-nums text-slate-700">{fmtWoExplainQty(planned)}</td>
                                  <td className="px-2 py-1.5 text-right text-[13px] tabular-nums text-slate-800">{fmtWoExplainQty(remaining)}</td>
                                  <td className="px-2 py-1.5 text-right">
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      autoComplete="off"
                                      className="h-9 w-full min-w-[6rem] tabular-nums"
                                      placeholder="0"
                                      value={cell.qtyStr}
                                      disabled={!cell.sel || !selectable}
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        if (rowShortfallBuf) {
                                          shortfallWoQtyUserTouchedRef.current.add(sl.itemId);
                                        }
                                        setRegularWoByItemId((prev) => ({
                                          ...prev,
                                          [sl.itemId]: { ...cell, sel: prev[sl.itemId]?.sel ?? false, qtyStr: raw },
                                        }));
                                      }}
                                    />
                                    {rowShortfallBuf && suggestedQty != null && suggestedQty > QTY_EPS ? (
                                      <div className="mt-1 space-y-0.5 text-left text-[11px] leading-snug text-slate-600">
                                        <div>
                                          Remaining:{" "}
                                          <span className="font-semibold tabular-nums text-slate-800">
                                            {fmtWoExplainQty(remaining)}
                                          </span>
                                        </div>
                                        <div>
                                          Suggested:{" "}
                                          <span className="font-semibold tabular-nums text-slate-800">
                                            {fmtWoExplainQty(suggestedQty)}
                                          </span>{" "}
                                          {shortfallBufferPercentForCalc > 0
                                            ? ` (includes ${shortfallBufferPercentForCalc}% optional buffer)`
                                            : " (same as remaining)"}
                                        </div>
                                      </div>
                                    ) : null}
                                    {rowErr ? <p className="mt-1 text-left text-[11px] font-medium text-amber-800">{rowErr}</p> : null}
                                    {rowWarnShort ? (
                                      <p className="mt-1 text-left text-[11px] font-medium text-amber-800">{rowWarnShort}</p>
                                    ) : null}
                                    {rowInfoExtra ? (
                                      <p className="mt-1 text-left text-[11px] leading-snug text-sky-900/90">{rowInfoExtra}</p>
                                    ) : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="border-t border-slate-100 pt-2.5 text-xs text-slate-600">
                        <span className="font-semibold text-slate-800">{regularWoSelectedCount}</span> item(s) selected · Total WO qty{" "}
                        <span className="font-mono font-semibold tabular-nums text-slate-900">
                          {regularWoTotalQtySelected.toFixed(3).replace(/\.?0+$/, "")}
                        </span>
                      </div>
                      {customerTrackingWoQtyExceedsShortfall ? (
                        <div className="rounded-md border border-amber-300 bg-amber-50/90 px-3 py-2 text-xs font-medium text-amber-950">
                          Total selected WO qty is above the suggested amount with buffer (
                          <span className="tabular-nums">
                            {fmtWoExplainQty(
                              shortfallSuggestedCapFromUrl ?? regularWoSuggestedBufferTotalSelectedCap ?? 0,
                            )}
                          </span>
                          ). Reduce quantities unless you intentionally plan more production.
                        </div>
                      ) : null}
                      <details className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2 text-sm">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-700">More planning details</summary>
                        <div className="mt-2 space-y-2">
                          {regularWoRmCheckPlan ? (
                            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">WO calculation (first selected FG)</div>
                              <div className="mt-1.5 grid max-w-md gap-1 text-[13px]">
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                                  <span>Customer Qty</span>
                                  <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.customerCommittedQty ?? regularWoRmCheckPlan.orderQty)}</span>
                                </div>
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                                  <span>FG buffer %</span>
                                  <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.fgStock)}</span>
                                </div>
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-t border-slate-200/80 pt-1">
                                  <span className="font-medium">RM planning qty</span>
                                  <span className="tabular-nums font-semibold text-slate-900">
                                    {fmtWoExplainQty(regularWoRmCheckPlan.rmPlanningQty ?? regularWoRmCheckPlan.toProduce)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : null}
                          <div>
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Planning context</div>
                            <WoInfoPanel
                              balance={primaryBalRow}
                              fallbackSoOrdered={primaryFgSoLine != null ? Number(primaryFgSoLine.qty) : undefined}
                              draftEntryQty={primaryLine.fgItemId > 0 ? primaryItemTotalDraft : null}
                              isEditingWorkOrder={isEditMode}
                              relaxPlanningDraftOverCap={woInfoRelaxPlanningDraftOverCap}
                            />
                          </div>
                        </div>
                      </details>
                    </>
                  )}
                </div>
              ) : null}
              {!fromNoQtySo && !noQtySelected && !useRegularWoPlanningTable ? (
                <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:grid-cols-2">
                <NextStepStrip
                  className="sm:col-span-2"
                  visible={Boolean(rmIssueNextStep)}
                  variant="blocked"
                  title={rmIssueNextStep?.statusTitle ?? "Waiting for RM Issue"}
                  subtitle={
                    rmIssueNextStep?.blockingReason
                      ? `${rmIssueNextStep.statusSubtitle ?? ""} · ${rmIssueNextStep.blockingReason}`
                      : rmIssueNextStep?.statusSubtitle
                  }
                  primaryAction={{
                    label: rmIssueNextStep?.primaryAction.label ?? "Issue RM to Production",
                    testId: rmIssueNextStep?.primaryAction.testId,
                    onClick: () => {
                      const href = rmIssueNextStep?.primaryAction.href;
                      if (href) nav(href);
                    },
                  }}
                />
                <NextStepStrip
                  className="sm:col-span-2"
                  visible={Boolean(showProductionNextStepEffective && productionEntryHref)}
                  variant="action"
                  title="RM Issued – Start Production"
                  subtitle="Work order is ready for production entry."
                  primaryAction={{
                    label: "Enter Production",
                    testId: "next-enter-production-from-wo",
                    onClick: () => productionEntryHref && nav(productionEntryHref),
                  }}
                />
                <div className="erp-form-field min-w-0 w-full sm:max-w-[31.25rem]">
                  <span className="erp-form-label">Sales order</span>
                  <select
                    ref={salesOrderSelectRef}
                    className="erp-select h-9 w-full min-w-0"
                    value={salesOrderId === "" ? "" : String(salesOrderId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      onSalesOrderSelect(v === "" ? "" : Number(v));
                    }}
                  >
                    <option value="">Select sales order…</option>
                    {approvedSos.map((s) => (
                      <option key={s.id} value={s.id}>
                        Sales Order No: {displaySalesOrderNo(s.id, s.docNo)}
                        {s.customer?.name ? ` — ${s.customer.name}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500">Only approved sales orders are shown.</p>
                </div>
                <div className="erp-form-field min-w-0 w-full">
                  <span className="erp-form-label">Finished good</span>
                  <select
                    ref={fgItemSelectRef}
                    className="erp-select h-9 w-full min-w-0"
                    value={primaryLine.fgItemId === 0 ? "" : String(primaryLine.fgItemId)}
                    disabled={
                      salesOrderId === "" ||
                      !soDetail ||
                      noQtyBlocked ||
                      (cameFromRmCheckPlanning
                        ? fgSoLines.length === 0
                        : fgBalancesLoading || !eligibleFgSoLines.length)
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      const id = v === "" ? 0 : Number(v);
                      setWoLines((p) => {
                        const next = [...p];
                        if (!next.length) return [{ fgItemId: id, qtyStr: "" }];
                        const prev = next[0];
                        const bal = id > 0 ? fgBalanceByItemId.get(id) : undefined;
                        const suggested =
                          bal != null &&
                          bal.suggestedWoQty != null &&
                          bal.suggestedWoQty > QTY_EPS &&
                          Number.isFinite(bal.suggestedWoQty)
                            ? Number.isInteger(bal.suggestedWoQty)
                              ? String(bal.suggestedWoQty)
                              : String(Number(bal.suggestedWoQty.toFixed(3)))
                            : "";
                        const keepTyped = prev.qtyStr.trim() !== "";
                        next[0] = {
                          ...prev,
                          fgItemId: id,
                          qtyStr: id === 0 ? "" : keepTyped ? prev.qtyStr : suggested,
                        };
                        return next;
                      });
                    }}
                  >
                    {!cameFromRmCheckPlanning && fgBalancesLoading ? (
                      <option value="" disabled>
                        Loading FG items…
                      </option>
                    ) : noQtyBlocked ? (
                      <option value="" disabled>
                        Requirement Sheet only
                      </option>
                    ) : !fgPickOptions.length ? (
                      <option value="" disabled>
                        {cameFromRmCheckPlanning
                          ? "No finished goods on this sales order"
                          : "No FG with remaining balance"}
                      </option>
                    ) : (
                      <>
                        <option value="">{salesOrderId ? "Select finished good…" : "Select sales order first…"}</option>
                        {fgPickOptions.map((sl) => (
                          <option key={sl.itemId} value={sl.itemId}>
                            {sl.item.itemName}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                    Finished goods with planning room or dispatch pending (confirmed dispatched subtracts from planning;
                    draft dispatches do not).
                  </p>
                </div>
                </div>
              ) : null}

              {!noQtySelected && salesOrderId !== "" && soDetail && !fgSoLines.length && !useRegularWoPlanningTable ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  This sales order has no finished goods lines.
                </div>
              ) : null}

              {!fromNoQtySo && !noQtySelected && !useRegularWoPlanningTable ? (
                <div className="flex flex-col gap-3 border-t border-slate-100 pt-3">
                {regularWoRmCheckPlan ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2 text-slate-800">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">WO calculation</div>
                    <div className="mt-1.5 grid max-w-md gap-1 text-[13px]">
                      <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                        <span>Customer Qty</span>
                        <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.customerCommittedQty ?? regularWoRmCheckPlan.orderQty)}</span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                                  <span>FG buffer %</span>
                                  <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.productionBufferPercent ?? 0)}</span>
                                </div>
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                                  <span>Buffer Qty</span>
                                  <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.productionBufferQty ?? 0)}</span>
                                </div>
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                                  <span>Planned Production Qty</span>
                                  <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.plannedProductionQty ?? regularWoRmCheckPlan.orderQty)}</span>
                                </div>
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                                  <span>FG buffer %</span>
                                  <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.fgStock)}</span>
                                </div>
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-t border-slate-200/80 pt-1">
                                  <span className="font-medium">RM planning qty</span>
                                  <span className="tabular-nums font-semibold text-slate-900">
                                    {fmtWoExplainQty(regularWoRmCheckPlan.rmPlanningQty ?? regularWoRmCheckPlan.toProduce)}
                                  </span>
                                </div>
                              </div>
                              <p className="mt-2 text-[11px] leading-snug text-slate-600">
                                Planned Production Qty is calculated from Customer Qty plus FG buffer. RM planning qty then subtracts available FG stock.
                              </p>
                  </div>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="erp-form-field w-full min-w-[7rem] max-w-[12rem] shrink-0 sm:w-40">
                  <span className="erp-form-label">Planned Production Qty</span>
                  <Input
                    ref={woQtyPrimaryRef}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="w-full tabular-nums"
                    placeholder="Enter WO quantity"
                    value={primaryLine.qtyStr}
                    disabled={!primaryLine.fgItemId || primaryNoRemaining || noQtyBlocked}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setWoLines((p) => {
                        const next = [...p];
                        if (!next.length) return [{ fgItemId: 0, qtyStr: raw }];
                        next[0] = { ...next[0], qtyStr: raw };
                        return next;
                      });
                    }}
                  />
                  {primaryLine.fgItemId > 0 && primaryMaxAllowed != null && Number.isFinite(primaryMaxAllowed) ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Max allowed: <span className="font-semibold tabular-nums text-slate-800">{primaryMaxAllowed.toFixed(3).replace(/\.?0+$/, "")}</span>
                    </p>
                  ) : null}
                  {primaryLine.fgItemId > 0 && primaryNoRemaining ? (
                    <p className="mt-1 text-xs font-medium text-emerald-800">
                      {hasOpenWoCoveringPrimaryFg
                        ? "Work Order already fully planned. Proceed to Production."
                        : "No more production required for this item."}
                    </p>
                  ) : null}
                  {primaryLine.fgItemId > 0 && parsePositiveQuantityDraft(primaryLine.qtyStr) == null ? (
                    <p className="mt-1 text-xs font-medium text-amber-800">Enter WO quantity</p>
                  ) : null}
                  {primaryExceedsAllowed ? (
                    <p className="mt-1 text-xs font-medium text-amber-800">Exceeds allowed quantity</p>
                  ) : null}
                  {primaryLine.fgItemId > 0 && primaryItemTotalDraft != null && primaryBalRow != null ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Total planned for this FG (all lines):{" "}
                      <span className="font-medium tabular-nums text-slate-700">
                        {Number(primaryItemTotalDraft.toFixed(3)).toString().replace(/\.?0+$/, "")}
                      </span>{" "}
                      /{" "}
                      <span className="tabular-nums">
                        {Number(primaryBalRow.balanceQty.toFixed(3)).toString().replace(/\.?0+$/, "")}
                      </span>
                    </p>
                  ) : null}
                </div>
                <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-1 sm:flex-row sm:items-end sm:justify-end sm:gap-4">
                  <div className="min-w-0 sm:max-w-xl">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Planning context</div>
                    <WoInfoPanel
                      balance={primaryBalRow}
                      fallbackSoOrdered={primaryFgSoLine != null ? Number(primaryFgSoLine.qty) : undefined}
                      draftEntryQty={primaryLine.fgItemId > 0 ? primaryItemTotalDraft : null}
                      isEditingWorkOrder={isEditMode}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={!firstFgId || creatingWo || noQtyBlocked || showProductionNextStep}
                      onClick={() => setWoLines((p) => [...p, { fgItemId: firstFgId, qtyStr: "" }])}
                    >
                      Add line
                    </Button>
                    <Button
                      type="button"
                      className="h-9"
                      onClick={onCreateWo}
                      disabled={creatingWo || !woFormCanSubmit || showProductionNextStep}
                    >
                      {creatingWo ? "Saving…" : "Create WO"}
                    </Button>
                  </div>
                </div>
                </div>
                </div>
              ) : null}

              {!fromNoQtySo && !noQtySelected && !useRegularWoPlanningTable && extraWoLines.length > 0 ? (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {extraWoLines.map((l, idx) => {
                    const i = idx + 1;
                    return (
                      <div
                        key={`wo-line-extra-${i}`}
                        className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_auto_auto]"
                      >
                        <div className="erp-form-field min-w-0 sm:col-span-1">
                          <span className="erp-form-label">Finished good (line {i + 1})</span>
                          <select
                            className="erp-select h-9 w-full min-w-0"
                            value={l.fgItemId === 0 ? "" : String(l.fgItemId)}
                            disabled={
                              salesOrderId === "" ||
                              !soDetail ||
                              (cameFromRmCheckPlanning
                                ? fgSoLines.length === 0
                                : fgBalancesLoading || !eligibleFgSoLines.length)
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              const id = v === "" ? 0 : Number(v);
                              setWoLines((p) => p.map((x, j) => (j === i ? { ...x, fgItemId: id } : x)));
                            }}
                          >
                            {!cameFromRmCheckPlanning && fgBalancesLoading ? (
                              <option value="" disabled>
                                Loading…
                              </option>
                            ) : !fgPickOptions.length ? (
                              <option value="" disabled>
                                {cameFromRmCheckPlanning ? "No finished goods on this sales order" : "No FG available"}
                              </option>
                            ) : (
                              <>
                                <option value="">Select finished good…</option>
                                {fgPickOptions.map((sl) => (
                                  <option key={sl.itemId} value={sl.itemId}>
                                    {sl.item.itemName}
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                        </div>
                        <div className="erp-form-field w-full min-w-[7rem] max-w-[10rem] sm:w-28">
                          <span className="erp-form-label">Planned Production Qty</span>
                          <Input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            className="h-9 w-full tabular-nums"
                            placeholder="Enter WO quantity"
                            value={l.qtyStr}
                            disabled={!l.fgItemId || noQtyBlocked}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setWoLines((p) =>
                                p.map((x, j) => {
                                  if (j !== i) return x;
                                  return { ...x, qtyStr: raw };
                                }),
                              );
                            }}
                          />
                        </div>
                        <div className="flex justify-end pb-0.5 sm:justify-start">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9"
                            onClick={() => setWoLines((p) => p.filter((_, j) => j !== i))}
                          >
                            <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                            Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

            </div>
          ) : (
            <p className="text-sm text-slate-600">Production / Admin only.</p>
          )}
        </CardContent>
      </Card>
      )}

      {overrideOpen ? (
        <ErpModal onClose={closeOverrideModal} aria-labelledby="wo-override-title">
          <div className="w-full max-w-[480px] rounded-xl border border-slate-200/90 bg-white p-4 shadow-xl sm:p-5">
            <h2 id="wo-override-title" className="text-base font-bold leading-snug text-slate-900">
              Dispatch-ready stock covers the order
            </h2>
            <p className="mt-3 text-sm font-normal leading-relaxed text-slate-700">
              Dispatch-ready quantity already covers the remaining sales order quantity for the selected finished
              good. A work order is not required to clear that remainder.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              If you still want to produce anyway, continue with admin approval and a reason.
            </p>
            {overrideShowReason ? (
              <label className="mt-4 grid gap-2">
                <span className="text-sm font-medium text-slate-700">Enter reason for production</span>
                <Input
                  ref={overrideReasonInputRef}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="text-sm"
                  placeholder=""
                  autoComplete="off"
                />
              </label>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeOverrideModal} disabled={overrideSaving}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!overrideShowReason) {
                    setOverrideShowReason(true);
                    return;
                  }
                  void submitOverride();
                }}
                disabled={overrideSaving || (overrideShowReason && overrideReason.trim() === "")}
              >
                {overrideSaving ? "Creating…" : "Create with Reason"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}

      {!showWoWorkspace ? (
      <Card className="erp-op-workspace-secondary min-w-0 overflow-hidden">
        <CardHeader className="space-y-0 border-b border-slate-100/80 bg-slate-50/40 px-3 py-2">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <CardTitle className="text-[12px] font-semibold text-slate-600">Work orders list</CardTitle>
            <p className="whitespace-nowrap text-[11px] tabular-nums text-slate-500" title="Open work orders loaded">
              {openWoCount} open
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 px-3 py-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid w-full min-w-[9.5rem] shrink-0 gap-1 sm:w-[11rem]">
              <span className="text-[11px] font-medium text-slate-600">Status</span>
              <select
                className="erp-flow-filter-input h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm"
                value={woStatusFilter}
                onChange={(e) => patch({ woStatus: e.target.value as typeof woStatusFilter, woCPage: null })}
              >
                <option value="ALL">All</option>
                <option value="OPEN">Open (not completed)</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
            <label className="grid min-w-[10rem] flex-1 basis-[min(100%,20rem)] gap-1">
              <span className="text-[11px] font-medium text-slate-600">Search</span>
              <Input
                className="erp-flow-filter-input h-9 text-sm"
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                placeholder="WO #, SO #, or FG name…"
              />
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid w-[10.5rem] min-w-[9rem] shrink-0 gap-1">
                <span className="text-[11px] font-medium text-slate-600">Sort by</span>
                <select
                  className="erp-flow-filter-input h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm"
                  value={listSortKey}
                  onChange={(e) => patch({ sort: e.target.value as "id" | "so" | "status" })}
                >
                  <option value="id">Work order #</option>
                  <option value="so">Sales order #</option>
                  <option value="status">Status</option>
                </select>
              </div>
              <div className="grid w-[5.75rem] min-w-[5.25rem] shrink-0 gap-1">
                <span className="text-[11px] font-medium text-slate-600">Direction</span>
                <select
                  className="erp-flow-filter-input h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm"
                  value={listSortDir}
                  onChange={(e) => patch({ dir: e.target.value as "asc" | "desc" })}
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
              <div className="grid gap-1">
                <span className="text-[11px] font-medium text-slate-600 opacity-0 select-none" aria-hidden>
                  Reset
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 px-3 text-xs"
                  disabled={!woListFiltersActive}
                  onClick={clearWoListFilters}
                >
                  Reset
                </Button>
              </div>
            </div>
            {(woStatusFilter === "COMPLETED" || woStatusFilter === "ALL") && completedTotal > 0 ? (
              <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 min-w-[4.75rem]"
                  disabled={!canCompletedPrev}
                  onClick={() => patch({ woCPage: completedPageFromUrl <= 2 ? null : completedPageFromUrl - 1 })}
                >
                  Previous
                </Button>
                <span className="text-[11px] tabular-nums text-slate-600">
                  Page {completedPageFromUrl} of {completedTotalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 min-w-[4.75rem]"
                  disabled={!canCompletedNext}
                  onClick={() => patch({ woCPage: completedPageFromUrl + 1 })}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </div>
          {qDraft.trim() && (woStatusFilter === "OPEN" || woStatusFilter === "ALL") ? (
            <p className="text-[11px] text-slate-500">
              Open / in progress — {visibleOpenRows.length} match search (all loaded).
            </p>
          ) : null}
          {(woStatusFilter === "COMPLETED" || woStatusFilter === "ALL") && listInfoCompleted ? (
            <p className="text-[11px] text-slate-500">{listInfoCompleted}</p>
          ) : null}
          <div className="space-y-2">
            {(woStatusFilter === "OPEN" || woStatusFilter === "ALL") && (
              <div className="space-y-1.5">
                {woStatusFilter === "ALL" ? (
                  <div className="text-[11px] font-semibold text-slate-600">Open / in progress</div>
                ) : null}
                {!listFilteredOut && woStatusFilter === "ALL" && visibleOpenRows.length === 0 && openWoRows.length > 0 ? (
                  <ErpEmptyState variant="inline" title="No open work orders match filters" body="Try another status or search." />
                ) : null}
                {!listFilteredOut &&
                woStatusFilter === "ALL" &&
                visibleOpenRows.length === 0 &&
                openWoRows.length === 0 &&
                completedTotal > 0 ? (
                  <ErpEmptyState variant="inline" title="No open work orders" body="Completed work orders are listed below." />
                ) : null}
                {visibleOpenRows.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full min-w-[720px] border-collapse text-[13px]">
                      <thead className="border-b border-slate-200 bg-slate-50 shadow-[0_1px_0_rgba(15,23,42,0.06)]">
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-1.5">WO No</th>
                          <th className="px-3 py-1.5">Sales order</th>
                          <th className="px-3 py-1.5 text-center">Cycle</th>
                          <th className="px-3 py-1.5">FG item</th>
                          <th className="px-3 py-1.5 text-right">Qty</th>
                          <th className="px-3 py-1.5">Status</th>
                          <th className="px-3 py-1.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flattenWoLines(visibleOpenRows).map((row) => (
                          <tr
                            key={`${row.woId}:${row.woLineId}`}
                            {...{ [DRILL_DATA.workOrderId]: row.woId }}
                            className="border-b border-slate-100 transition-colors hover:bg-slate-50/90"
                          >
                            <td className="px-3 py-1.5 align-top">
                              <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-900">
                                {displayWorkOrderNo(row.woId, row.woDocNo)}
                              </div>
                              {noQtySelected && row.requirementSheetId ? (
                                <div className="mt-0.5 text-[10px] font-medium text-emerald-700">From Requirement Sheet</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[13px] tabular-nums text-slate-800">
                              {displaySalesOrderNo(row.salesOrderId, row.soDocNo)}
                            </td>
                            <td className="px-3 py-1.5 text-center tabular-nums text-[12px] text-slate-700">
                              {row.cycleNo != null ? row.cycleNo : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-[13px] text-slate-800">{row.fgName}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{row.qty}</td>
                            <td className="px-3 py-1.5">
                              {renderWoListStatusBadge(row, noQtySelected, noQtyWoDisplayStatusById)}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {isAdmin && !noQtySelected ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 border-red-200 text-xs font-medium text-red-700 hover:bg-red-50"
                                  onClick={() => onDeleteWo(row.woId)}
                                >
                                  Delete
                                </Button>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            )}
            {(woStatusFilter === "COMPLETED" || woStatusFilter === "ALL") && (
              <div className="space-y-1.5">
                {woStatusFilter === "ALL" ? (
                  <div className="text-[11px] font-semibold text-slate-600">Completed</div>
                ) : null}
                {woStatusFilter === "ALL" && visibleCompletedRows.length === 0 && completedTotal === 0 ? (
                  <ErpEmptyState variant="inline" title="No completed work orders" body="Completed work orders will appear here." />
                ) : null}
                {(woStatusFilter === "ALL" || woStatusFilter === "COMPLETED") &&
                visibleCompletedRows.length === 0 &&
                completedTotal > 0 ? (
                  <ErpEmptyState variant="inline" title="No completed work orders match search" body="Clear search or switch status filter." />
                ) : null}
                {visibleCompletedRows.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full min-w-[720px] border-collapse text-[13px]">
                      <thead className="border-b border-slate-200 bg-slate-50 shadow-[0_1px_0_rgba(15,23,42,0.06)]">
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-1.5">WO No</th>
                          <th className="px-3 py-1.5">Sales order</th>
                          <th className="px-3 py-1.5 text-center">Cycle</th>
                          <th className="px-3 py-1.5">FG item</th>
                          <th className="px-3 py-1.5 text-right">Qty</th>
                          <th className="px-3 py-1.5">Status</th>
                          <th className="px-3 py-1.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flattenWoLines(visibleCompletedRows).map((row) => (
                          <tr
                            key={`${row.woId}:${row.woLineId}`}
                            {...{ [DRILL_DATA.workOrderId]: row.woId }}
                            className="border-b border-slate-100 transition-colors hover:bg-slate-50/90"
                          >
                            <td className="px-3 py-1.5 align-top">
                              <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-900">
                                {displayWorkOrderNo(row.woId, row.woDocNo)}
                              </div>
                              {noQtySelected && row.requirementSheetId ? (
                                <div className="mt-0.5 text-[10px] font-medium text-emerald-700">From Requirement Sheet</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[13px] tabular-nums text-slate-800">
                              {displaySalesOrderNo(row.salesOrderId, row.soDocNo)}
                            </td>
                            <td className="px-3 py-1.5 text-center tabular-nums text-[12px] text-slate-700">
                              {row.cycleNo != null ? row.cycleNo : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-[13px] text-slate-800">{row.fgName}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{row.qty}</td>
                            <td className="px-3 py-1.5">
                              {renderWoListStatusBadge(row, noQtySelected, noQtyWoDisplayStatusById)}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {isAdmin && !noQtySelected ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 border-red-200 text-xs font-medium text-red-700 hover:bg-red-50"
                                  onClick={() => onDeleteWo(row.woId)}
                                >
                                  Delete
                                </Button>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {listFilteredOut ? (
            <ErpEmptyState
              className="mt-1"
              variant="inline"
              title="No work orders match filters"
              body={
                woDrillHiddenByFilters
                  ? DRILL_FOCUS_EMPTY_FILTERED_SUFFIX.workOrder
                  : "Adjust status or search to see work orders."
              }
            />
          ) : null}
          {!listFilteredOut && woStatusFilter === "OPEN" && openWoRows.length === 0 ? (
            <ErpEmptyState
              className="mt-2"
              variant="inline"
              title={getRoleEmptyState("work_orders_open", roleUi.role).title}
              body={getRoleEmptyState("work_orders_open", roleUi.role).body}
              action={
                roleUi.role === "STORE" || roleUi.role === "ADMIN" ? (
                  <Link
                    to="/sales-orders"
                    className={cn(buttonVariants({ variant: "default", size: "sm" }), "no-underline")}
                  >
                    Open Sales Orders
                  </Link>
                ) : undefined
              }
            />
          ) : null}
          {!listFilteredOut && woStatusFilter === "COMPLETED" && completedTotal === 0 ? (
            <ErpEmptyState className="mt-1" variant="inline" title="No completed work orders yet" body="Completed work orders will appear here." />
          ) : null}
          {!listFilteredOut && woStatusFilter === "ALL" && openWoRows.length === 0 && completedTotal === 0 ? (
            <ErpEmptyState
              className="mt-2"
              variant="inline"
              title={getRoleEmptyState("work_orders_none", roleUi.role).title}
              body={getRoleEmptyState("work_orders_none", roleUi.role).body}
              action={
                roleUi.role === "STORE" || roleUi.role === "ADMIN" ? (
                  <Link
                    to="/sales-orders"
                    className={cn(buttonVariants({ variant: "default", size: "sm" }), "no-underline")}
                  >
                    Open Sales Orders
                  </Link>
                ) : undefined
              }
            />
          ) : null}
        </CardContent>
      </Card>
      ) : null}
    </PageContainer>
  );
}
