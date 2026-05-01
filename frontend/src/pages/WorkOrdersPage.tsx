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
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useAuth } from "../hooks/useAuth";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useDependentFieldFocus } from "../hooks/useDependentFieldFocus";
import { parsePositiveQuantityDraft } from "../lib/quantityDraft";
import { cn } from "../lib/utils";
import { WoInfoPanel } from "../components/erp/WoInfoPanel";
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
import { NextStepStrip } from "../components/erp/NextStepStrip";
import { displaySalesOrderNo, displayWorkOrderNo } from "../lib/docNoDisplay";
import { NoQtyCycleSummaryCard } from "../components/NoQtyCycleSummaryCard";
import { buildNoQtyGuidedHref, useNoQtyFlowState } from "../lib/noQtyFlowState";

type WoLine = { id: number; fgItemId: number; qty: string; fgItem: { itemName: string } };
type WoRow = {
  id: number;
  docNo?: string | null;
  status: string;
  salesOrderId: number;
  salesOrder?: { docNo?: string | null } | null;
  cycleId?: number | null;
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
    orderQty: number;
    fgStock: number;
    toProduce: number;
    note?: string;
  }[];
};

type RmCheckFgPlanning = { orderQty: number; fgStock: number; toProduce: number };

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
  status: string;
  fgName: string;
  qty: string;
  woLineId: number;
  requirementSheetId?: number | null;
};

function flattenWoLines(list: WoRow[]): WoLineRow[] {
  const out: WoLineRow[] = [];
  for (const wo of list) {
    for (const l of wo.lines || []) {
      out.push({
        woId: wo.id,
        woDocNo: wo.docNo ?? null,
        salesOrderId: wo.salesOrderId,
        soDocNo: wo.salesOrder?.docNo ?? null,
        status: wo.status,
        fgName: l.fgItem?.itemName ?? "—",
        qty: l.qty,
        woLineId: l.id,
        requirementSheetId: wo.requirementSheetId ?? null,
      });
    }
  }
  return out;
}

export function WorkOrdersPage() {
  const auth = useAuth();
  const isAdmin = auth.user?.role === "ADMIN";
  const canProd = isAdmin || auth.user?.role === "PRODUCTION";

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
  const fromNoQtySo = source === "no_qty_so";
  const focusSoIdFromUrl = Number(sp.get("salesOrderId") ?? 0);
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

  useFastEntryForm({ containerRef: woFormRef });

  const appliedPrefill = React.useRef(false);
  const appliedPlanningPrefill = React.useRef(false);
  const isEditMode = read.int("excludeWo") > 0;
  const noQtySelected = soDetail?.orderType === "NO_QTY";
  /** Simplified multi-line FG table for new Regular SO work orders only. */
  const useRegularWoPlanningTable = !fromNoQtySo && !noQtySelected && !isEditMode;
  const lockSalesOrderSelector =
    useRegularWoPlanningTable &&
    (soFromUrl > 0 || (focusSoIdFromUrl > 0 && source !== "no_qty_so"));
  const isPrefilledFromRequirementSheet =
    loc.state?.fromRequirementSheet === true || loc.state?.source === "requirementSheet";
  const noQtyBlocked = noQtySelected && !isPrefilledFromRequirementSheet;

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
    const includeId =
      isEditMode && soFromUrl > 0
        ? soFromUrl
        : isPrefilledFromRequirementSheet && loc.state?.salesOrderId != null
          ? loc.state.salesOrderId
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
  ]);

  const fgSoLines = React.useMemo(
    () => soDetail?.lines.filter((l) => l.item.itemType === "FG") ?? [],
    [soDetail],
  );

  const fgBalanceByItemId = React.useMemo(() => new Map(fgBalances.map((b) => [b.itemId, b])), [fgBalances]);
  const [fgBalancesLoading, setFgBalancesLoading] = React.useState(false);

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
    Promise.all([
      apiFetch<{ items: FgWoBalanceItem[] }>(`/api/production/sales-orders/${id}/fg-work-order-balance${qs}`),
      apiFetch<RmCheckResponse>(`/api/sales-orders/${id}/rm-check`),
    ])
      .then(([balPayload, rmPayload]) => {
        if (cancelled) return;
        setFgBalances(balPayload.items ?? []);
        const m = new Map<number, RmCheckFgPlanning>();
        for (const f of rmPayload?.fgLines ?? []) {
          if (f.note) continue;
          const itemId = Number(f.fgItemId);
          if (!Number.isFinite(itemId) || itemId <= 0) continue;
          m.set(itemId, {
            orderQty: Number(f.orderQty),
            fgStock: Number(f.fgStock),
            toProduce: Number(f.toProduce),
          });
        }
        setRmCheckFgPlanningByItemId(m);
      })
      .catch(() => {
        if (cancelled) return;
        setFgBalances([]);
        setRmCheckFgPlanningByItemId(new Map());
      })
      .finally(() => {
        if (!cancelled) setFgBalancesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [salesOrderId, openWoRows, completedWoRows, read, searchParams.toString()]);

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
    // Regular Production Planning → WO: trust planning payload; do not hide FGs behind balance/eligibility filters.
    if (cameFromRmCheckPlanning) return fgSoLines;
    // Requirement Sheet prefill must be allowed even when SO qty is 0 (NO_QTY) and eligibility filters would hide it.
    if (isPrefilledFromRequirementSheet) return fgSoLines;
    if (fgBalancesLoading) return [];
    // Pending-only rule aligned with Production Planning "To produce" minus active planned WOs:
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

  /** Same figures as Production Planning (`/api/sales-orders/:id/rm-check`); USABLE FG stock only. */
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

  const showProductionNextStep =
    !fromNoQtySo &&
    !noQtySelected &&
    !fgBalancesLoading &&
    soDetail?.internalStatus === "APPROVED" &&
    primaryLine.fgItemId > 0 &&
    primaryNoRemaining &&
    hasOpenWoCoveringPrimaryFg;

  const productionEntryHref =
    showProductionNextStep && salesOrderId !== "" && openWoForPrimaryFg.woId != null
      ? `/production?${new URLSearchParams({
          salesOrderId: String(salesOrderId),
          woId: String(openWoForPrimaryFg.woId),
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
      const bal = fgBalanceByItemId.get(itemId);
      if (!bal || sum > bal.balanceQty + QTY_EPS) return false;
    }
    return true;
  }, [salesOrderId, soDetail, fgSoLines, woLines, fgBalanceByItemId, fgBalancesLoading, noQtyBlocked]);

  React.useEffect(() => {
    if (!useRegularWoPlanningTable) return;
    if (salesOrderId === "") {
      setRegularWoByItemId({});
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
    // Production Planning Dashboard deep-link: after SO is selected, auto-select the item and prefill qty.
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
      setSalesOrderId("");
      setSoDetail(null);
      setFgBalances([]);
    }
  }, [isEditMode, salesOrderId, eligibleSoIds, cameFromRmCheckPlanning, regularSoIdFromUrl]);

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
  );
  const noQtyCycleId = fromNoQtySo ? (noQtyFlowState?.cycleId ?? null) : null;

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
          const s = Number.isInteger(rem) ? String(rem) : String(Number(rem.toFixed(3)));
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

  const openWoCount = openWoRows.length;
  const listFilteredOut =
    rows.length > 0 && visibleOpenRows.length === 0 && visibleCompletedRows.length === 0;

  return (
    <PageContainer className={cn("erp-flow-page -mt-2 space-y-2.5 pb-6", cameFromRegularPlanning && "space-y-2")}>
      <StickyWorkspaceHead
        lead={
          <>
            <DemoFlowBanner />
            {fromNoQtySo ? (
              <PageNoQtyFlowBackLink step="WORK_ORDER" />
            ) : (
              <PageSmartBackLink defaultTo="/planning-dashboard" defaultLabel="Back to Planning" />
            )}
          </>
        }
      >
        <div className="min-w-0 space-y-0.5">
          <h1 className="text-base font-semibold leading-tight tracking-tight text-slate-900">Work Order</h1>
          <p className="text-xs leading-snug text-slate-600">Create and manage work orders for production.</p>
        </div>
      </StickyWorkspaceHead>
      {fromNoQtySo && salesOrderId !== "" ? <NoQtyCycleBanner so={soDetail as any} /> : null}

      <NextStepStrip
        visible={Boolean(fromNoQtySo && noQtySelected && noQtyFlowState?.nextAction === "PRODUCTION" && noQtyFlowState)}
        variant="action"
        title="Next Step: Start Production"
        subtitle="Work Order created successfully."
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
        visible={Boolean(fromNoQtySo && noQtySelected && noQtyFlowState?.nextAction === "QC" && noQtyFlowState)}
        variant="action"
        title="Next Step: Send items to QC"
        subtitle="Production entries exist for this cycle."
        primaryAction={{
          label: "Go to QC",
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
        <NoQtyCycleSummaryCard
          soId={soDetail.id}
          soDocNo={soDetail.docNo ?? null}
          customerName={soDetail.customer?.name ?? soDetail.po?.customer?.name ?? "—"}
          cycleNo={soDetail.currentCycle?.cycleNo != null ? Number(soDetail.currentCycle.cycleNo) : null}
          cycleStatus={
            soDetail.currentCycle?.status === "ACTIVE" && String(soDetail.processStage?.key ?? "") !== "COMPLETED"
              ? "Active Cycle"
              : "Closed Cycle"
          }
          currentStage="WORK_ORDER"
          nextStep={(() => {
            const soIdNum = Number(salesOrderId);
            const hasOpenWoForSo = openWoRows.some((w) => w.salesOrderId === soIdNum);
            if (!hasOpenWoForSo) return "Create Work Order";
            return "Start Production";
          })()}
          metrics={(() => {
            const planned = fgBalances.reduce((s, b) => s + Number(b.noQtyFinalWoQty ?? b.noQtyLatestRsQty ?? 0), 0);
            const qcPassed = fgBalances.reduce((s, b) => s + Number(b.noQtyQcPassedStockQty ?? 0), 0);
            const lastShort = fgBalances.reduce((s, b) => s + Number(b.carryForwardShortfallQty ?? 0), 0);
            const out: Array<{ label: any; value: number; subtle?: boolean }> = [];
            if (Number.isFinite(planned) && planned > 0) out.push({ label: "Planned Qty", value: planned });
            if (Number.isFinite(qcPassed) && qcPassed > 0) out.push({ label: "QC Passed Qty", value: qcPassed });
            if (Number.isFinite(lastShort) && lastShort > 0) out.push({ label: "Last Shortage Qty", value: lastShort, subtle: true });
            return out;
          })()}
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
      <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="space-y-0 border-b border-slate-100 bg-slate-50/50 px-3 py-2">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Create Work Order</CardTitle>
        </CardHeader>
        <CardContent className="px-3 py-2">
          {error ? <div className="mb-2 text-sm text-red-700">{error}</div> : null}
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
                      {soDetail?.currentCycle?.cycleNo != null ? (
                        <>
                          <span className="text-slate-400"> · </span>
                          <span className="font-medium">Cycle {Number(soDetail.currentCycle.cycleNo)}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => nav(buildNoQtyGuidedHref({ to: `/sales-orders/${focusSoIdFromUrl}/requirement-sheets`, salesOrderId: focusSoIdFromUrl, cycleId: noQtyCycleId }))}
                      >
                        Open Requirement Sheet
                      </Button>
                      <Link
                        to={buildNoQtyGuidedHref({
                          to: "/production",
                          salesOrderId: focusSoIdFromUrl,
                          cycleId: noQtyCycleId,
                          fromStep: "work_order",
                        })}
                      >
                        <Button type="button" size="sm">
                          Go to Production
                        </Button>
                      </Link>
                    </div>
                  </div>
                  {(() => {
                    const current = visibleOpenRows.filter(
                      (w) =>
                        w.salesOrderId === focusSoIdFromUrl &&
                        (noQtyCycleId == null || Number(w.cycleId ?? 0) === Number(noQtyCycleId)),
                    );
                    const older =
                      noQtyCycleId != null
                        ? visibleOpenRows.filter(
                            (w) => w.salesOrderId === focusSoIdFromUrl && Number(w.cycleId ?? 0) !== Number(noQtyCycleId),
                          )
                        : [];
                    const wo = current[0] ?? null;
                    if (!wo) return <div className="mt-2 text-xs text-slate-600">No active work order lines found for the current cycle.</div>;
                    return (
                      <div className="mt-2 space-y-2">
                        <div className="overflow-x-auto rounded border border-slate-200 bg-slate-50 px-2 py-2">
                          <div className="text-[12px] font-semibold text-slate-700">
                            WO {displayWorkOrderNo(wo.id, wo.docNo)} · {wo.lines.length} line(s)
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
                                    {w.cycleId != null ? <span className="text-slate-400"> · </span> : null}
                                    {w.cycleId != null ? <span className="text-slate-700">Cycle {Number(w.cycleId)}</span> : null}
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
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => nav(`/sales-orders/${Number(salesOrderId)}/requirement-sheets`)}
                      >
                        Open Requirement Sheet
                      </Button>
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
                    visible={Boolean(showProductionNextStep && productionEntryHref)}
                    variant="action"
                    title="Next Step: Start Production"
                    subtitle="Work Order created successfully."
                    primaryAction={{
                      label: "Go to Production",
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
                              <th className="px-2 py-1.5 text-right">Order Qty</th>
                              <th className="px-2 py-1.5 text-right">Already planned</th>
                              <th className="px-2 py-1.5 text-right">Remaining</th>
                              <th className="min-w-[7rem] px-2 py-1.5 text-right">WO Qty</th>
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
                              const rowErr =
                                cell.sel && (q == null || q <= 0)
                                  ? "Enter a quantity greater than zero."
                                  : cell.sel && q != null && q > remaining + QTY_EPS
                                    ? `Max ${fmtWoExplainQty(remaining)}.`
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
                                          const s =
                                            rem > QTY_EPS
                                              ? Number.isInteger(rem)
                                                ? String(rem)
                                                : String(Number(rem.toFixed(3)))
                                              : "";
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
                                        setRegularWoByItemId((prev) => ({
                                          ...prev,
                                          [sl.itemId]: { ...cell, sel: prev[sl.itemId]?.sel ?? false, qtyStr: raw },
                                        }));
                                      }}
                                    />
                                    {rowErr ? <p className="mt-1 text-left text-[11px] font-medium text-amber-800">{rowErr}</p> : null}
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
                      <details className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2 text-sm">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-700">More planning details</summary>
                        <div className="mt-2 space-y-2">
                          {regularWoRmCheckPlan ? (
                            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">WO calculation (first selected FG)</div>
                              <div className="mt-1.5 grid max-w-md gap-1 text-[13px]">
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                                  <span>Order Qty</span>
                                  <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.orderQty)}</span>
                                </div>
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                                  <span>Less Available FG stock</span>
                                  <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.fgStock)}</span>
                                </div>
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-t border-slate-200/80 pt-1">
                                  <span className="font-medium">WO Qty to produce</span>
                                  <span className="tabular-nums font-semibold text-slate-900">
                                    {fmtWoExplainQty(regularWoRmCheckPlan.toProduce)}
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
                  visible={Boolean(showProductionNextStep && productionEntryHref)}
                  variant="action"
                  title="Next Step: Start Production"
                  subtitle="Work Order created successfully."
                  primaryAction={{
                    label: "Go to Production",
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
                        <span>Order Qty</span>
                        <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.orderQty)}</span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                        <span>Less Available FG stock</span>
                        <span className="tabular-nums font-medium">{fmtWoExplainQty(regularWoRmCheckPlan.fgStock)}</span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-t border-slate-200/80 pt-1">
                        <span className="font-medium">WO Qty to produce</span>
                        <span className="tabular-nums font-semibold text-slate-900">
                          {fmtWoExplainQty(regularWoRmCheckPlan.toProduce)}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-slate-600">
                      WO Qty is calculated as Order Qty minus available FG stock.
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="erp-form-field w-full min-w-[7rem] max-w-[12rem] shrink-0 sm:w-40">
                  <span className="erp-form-label">WO Qty</span>
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
                          <span className="erp-form-label">WO Qty</span>
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

      {overrideOpen ? (
        <div className="erp-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="wo-override-title">
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
        </div>
      ) : null}

      <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="space-y-0 border-b border-slate-100 bg-slate-50/50 px-3 py-2">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Work Orders</CardTitle>
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
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Open / in progress</div>
                ) : null}
                {!listFilteredOut && woStatusFilter === "ALL" && visibleOpenRows.length === 0 && openWoRows.length > 0 ? (
                  <p className="text-xs leading-snug text-slate-600">No work orders match the selected filters.</p>
                ) : null}
                {!listFilteredOut &&
                woStatusFilter === "ALL" &&
                visibleOpenRows.length === 0 &&
                openWoRows.length === 0 &&
                completedTotal > 0 ? (
                  <p className="text-xs leading-snug text-slate-600">No open work orders in this view.</p>
                ) : null}
                {visibleOpenRows.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full min-w-[720px] border-collapse text-[13px]">
                      <thead className="border-b border-slate-200 bg-slate-50 shadow-[0_1px_0_rgba(15,23,42,0.06)]">
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-1.5">WO No</th>
                          <th className="px-3 py-1.5">Sales order</th>
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
                            <td className="px-3 py-1.5 text-[13px] text-slate-800">{row.fgName}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{row.qty}</td>
                            <td className="px-3 py-1.5">
                              <Badge variant={row.status === "COMPLETED" ? "success" : "warning"} className="text-[10px] font-medium">
                                {row.status}
                              </Badge>
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
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Completed</div>
                ) : null}
                {woStatusFilter === "ALL" && visibleCompletedRows.length === 0 && completedTotal === 0 ? (
                  <p className="text-xs leading-snug text-slate-600">No completed work orders.</p>
                ) : null}
                {(woStatusFilter === "ALL" || woStatusFilter === "COMPLETED") &&
                visibleCompletedRows.length === 0 &&
                completedTotal > 0 ? (
                  <p className="text-xs leading-snug text-slate-600">No completed work orders match the current search.</p>
                ) : null}
                {visibleCompletedRows.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full min-w-[720px] border-collapse text-[13px]">
                      <thead className="border-b border-slate-200 bg-slate-50 shadow-[0_1px_0_rgba(15,23,42,0.06)]">
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-1.5">WO No</th>
                          <th className="px-3 py-1.5">Sales order</th>
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
                            <td className="px-3 py-1.5 text-[13px] text-slate-800">{row.fgName}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{row.qty}</td>
                            <td className="px-3 py-1.5">
                              <Badge variant={row.status === "COMPLETED" ? "success" : "warning"} className="text-[10px] font-medium">
                                {row.status}
                              </Badge>
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
            <p className="mt-1 text-xs leading-snug text-slate-600">
              No work orders match the selected filters.
              {woDrillHiddenByFilters ? ` ${DRILL_FOCUS_EMPTY_FILTERED_SUFFIX.workOrder}` : ""}
            </p>
          ) : null}
          {!listFilteredOut && woStatusFilter === "OPEN" && openWoRows.length === 0 ? (
            <p className="mt-1 text-xs leading-snug text-slate-600">
              No work orders yet. Select an approved sales order to create one.
            </p>
          ) : null}
          {!listFilteredOut && woStatusFilter === "COMPLETED" && completedTotal === 0 ? (
            <p className="mt-1 text-xs leading-snug text-slate-600">No completed work orders yet.</p>
          ) : null}
          {!listFilteredOut && woStatusFilter === "ALL" && openWoRows.length === 0 && completedTotal === 0 ? (
            <p className="mt-1 text-xs leading-snug text-slate-600">
              No work orders yet. Select an approved sales order to create one.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
