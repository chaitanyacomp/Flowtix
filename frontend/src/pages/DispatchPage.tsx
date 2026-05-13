import * as React from "react";
import { flushSync } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch, ApiRequestError } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useDependentFieldFocus } from "../hooks/useDependentFieldFocus";
import { prefersFinePointer } from "../lib/erpFocus";
import { useMandatoryPositiveQtyDraft } from "../hooks/useMandatoryPositiveQtyDraft";
import { useIsAdmin, useCanOpenRequirementSheet } from "../hooks/useIsAdmin";
import { PlanningStatusChip } from "../components/erp/PlanningStatusChip";
import { useShortcutHints } from "../hooks/useShortcutHints";
import { FieldShortcutHint } from "../components/ui/FieldShortcutHint";
import {
  FIELD_HINT_DISPATCH_LINE,
  FIELD_HINT_DISPATCH_PREPARE,
  FIELD_HINT_DISPATCH_SO,
  FIELD_HINT_ENTER_NEXT,
} from "../lib/shortcutHintCopy";
import { cn } from "../lib/utils";
import {
  OperatorMainSplit,
  OperatorPageBody,
  OperatorTopBar,
  operatorInputClass,
  operatorTableRowClass,
} from "../components/erp/OperatorWorkbench";
import { NoQtyCycleBanner, PageContainer } from "../components/PageHeader";
import {
  OperationalContextBar,
  OperationalContextSticky,
  OperationalWorkspaceFooter,
  OpCtxSep,
  type OperationalFooterSection,
} from "../components/erp/OperationalWorkspaceChrome";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { displayDispatchNo, displaySalesOrderNo } from "../lib/docNoDisplay";
import { ActivityHistoryCard } from "../components/ActivityHistoryCard";
import { buildNoQtyGuidedHref, useNoQtyFlowState } from "../lib/noQtyFlowState";
import { useToast } from "../contexts/ToastContext";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { DemoSafeNoQtyContinue } from "../components/demo/DemoSafeNoQtyContinue";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";
import { NO_QTY_TERMS, REGULAR_TERMS } from "../lib/flowTerminology";

/** Soft flag for optional dashboard reminders — user chose “wait” on NORMAL partial dispatch (no API). */
const DISPATCH_PARTIAL_WAIT_STORAGE_PREFIX = "erp:dispatch:partial-wait:";

/** Soft warning: if dispatch qty is much lower than available-to-dispatch, confirm (does not block). */
const DISPATCH_LOW_QTY_WARN_RATIO = 0.5;

function recordDispatchPartialWaitChoice(soId: number, salesOrderLineId: number, itemId: number) {
  try {
    const key = `${DISPATCH_PARTIAL_WAIT_STORAGE_PREFIX}${soId}:${salesOrderLineId}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        at: new Date().toISOString(),
        soId,
        salesOrderLineId,
        itemId,
      }),
    );
  } catch {
    // Quota / private mode — ignore
  }
}

type LineStat = {
  lineId: number;
  itemId: number;
  itemName: string;
  /** NO_QTY: SalesOrderCycle.id for this row (multi-cycle line stats). */
  noQtyCycleId?: number | null;
  /** NO_QTY: human cycle number when present. */
  noQtyCycleNo?: number | null;
  /** Commercial-only; does not affect dispatchable qty or stock rules. */
  isFree?: boolean;
  /** NORMAL SO only — from API when present. */
  customerPoQty?: number;
  bufferPercent?: number;
  plannedQty?: number;
  orderQty: number;
  /** Confirmed (locked) dispatch attributed to this line (FIFO). */
  dispatched: number;
  /** Qty on draft (unlocked) rows attributed to this line — not yet final. */
  dispatchPendingLock?: number;
  /** Operational: ordered qty minus operational dispatch attribution (draft + locked + reversals). Planning headroom. */
  remaining: number;
  /** Confirmed backlog: max(0, ordered − confirmed/locked dispatch on this line). Drives open-order list visibility. */
  pendingDispatchQty?: number;
  onHand: number;
  /** Alias of onHand — usable FG for SKU (GET /api/stock/summary basis). */
  totalStock?: number;
  /** Sum of active QC acceptedQty for this SO + FG item (via work orders). */
  qcAccepted: number;
  /** Gross QC accepted for this SO + item (same as qcAccepted; API alias). */
  qcApprovedStock?: number;
  /** max(0, qcAccepted − net dispatched for this SO+FG item); shared pool for all SO lines with same item. */
  qcApprovedRemaining: number;
  /** Operational net dispatch qty for this SO + FG item (draft + locked forwards and reversals). */
  operationalNetDispatchedQty?: number;
  /** NO_QTY: sum of QC accepted qty attributed to the current sales-order cycle (WO.cycleId or RS via WO). */
  cycleQcAcceptedQty?: number;
  /** NO_QTY: rework/recheck qty accepted to USABLE for this cycle (from dispatch API when present). */
  cycleRecheckAcceptedQty?: number;
  /** NO_QTY: qty approved to USABLE after a prior cycle closed (same SO + cycle context; included in dispatch pool). */
  postCycleApprovalQty?: number;
  dispatchable: number;
  dispatchableQty?: number;
  // NO_QTY cycle-cap fields (present only when SO.orderType === "NO_QTY")
  cycleCap?: number;
  cycleDispatchedQty?: number;
  cycleCapRemaining?: number;
  /** NO_QTY: requirement sheet snapshots (latest locked sheet for selected cycle). */
  fulfillmentQtySnapshot?: number | null;
  coveredFromStockQtySnapshot?: number | null;
  productionRequiredQtySnapshot?: number | null;
  requirementSheetAvailableStockQtySnapshot?: number | null;
  shortfallQtySnapshot?: number | null;
  /** Customer qty still pending overall for this SO + FG item (FIFO vs operational dispatch). */
  soRemainingDemandQty?: number;
  /** Legacy NO_QTY concept: cycle capacity (informational only). */
  lastShortageQty?: number;
  usableQcPassedStock?: number;
  /** Why backlog cannot ship when dispatchable is 0 */
  dispatchBlockedReason?: string | null;
  /** NORMAL only — server UX hint: READY_FULL vs PARTIAL_AVAILABLE vs NOT_READY (vs pending). */
  regularDispatchReadiness?: "READY_FULL" | "PARTIAL_AVAILABLE" | "NOT_READY";
  /** FG in QC hold + awaiting QC + rework (global for SKU). */
  inQcReworkQty?: number;
  /** Display-only: bucket rollups (global by SKU). */
  qcHoldQty?: number;
  qcPendingQty?: number;
  reworkQty?: number;
  /** IN PROCESS = QC_HOLD + QC_PENDING + REWORK */
  inProcessQty?: number;
  /** SCRAP bucket net (global by SKU). */
  scrapQty?: number;
  quantityContexts?: {
    soLineRemaining: { qty: number; metricContext: string };
    qcPoolRemaining: { qty: number; metricContext: string };
    dispatchableQty: { qty: number; metricContext: string };
  };
};

type DispatchWorkflowStatus = "UNLOCKED" | "LOCKED";

type DispatchEvent = {
  id: number;
  docNo?: string | null;
  soId: number;
  itemId: number;
  /** NO_QTY: SalesOrderCycle.id; omit/null on legacy rows. */
  cycleId?: number | null;
  dispatchedQty: string | number;
  reversalOfId?: number | null;
  reversalReason?: string | null;
  workflowStatus?: DispatchWorkflowStatus;
  date: string;
  /** Remaining qty that can be reversed for this forward row (server-computed from ledger). */
  maxReversibleQty?: number | null;
  ledgerMetricContext?: string;
};

type DispatchLedgerRow = {
  id: number;
  docNo?: string | null;
  date: string;
  soId: number;
  cycleId?: number | null;
  soDocNo?: string | null;
  soOrderType: "NORMAL" | "REPLACEMENT" | "NO_QTY" | null;
  customerName: string | null;
  itemId: number;
  itemName: string | null;
  dispatchedQty: string | number;
  reversalOfId: number | null;
  reversalReason: string | null;
  workflowStatus: DispatchWorkflowStatus;
  salesBillId?: number | null;
  salesBillExists?: boolean;
  salesBillIsExported?: boolean;
  salesBillStatus?: string | null;
};

type SoRow = {
  id: number;
  docNo?: string | null;
  /** NO_QTY: active SalesOrderCycle.id (from API). */
  currentCycleId?: number | null;
  /** Backend source-of-truth: separate NO_QTY vs Regular dispatch flows. */
  flowMode?: "REGULAR_SO" | "NO_QTY_SO";
  /** NO_QTY: cycle used for lineStats (query override or current). */
  noQtyDispatchContext?: { selectedCycleId: number; cycleNo: number | null; cycleLabel: string | null } | null;
  /** NO_QTY: when lineStats are empty (e.g. no locked RS for cycle). */
  noQtyDispatchBlockedReason?: string | null;
  orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY";
  customerReturnId?: number | null;
  originalSalesOrderId?: number | null;
  originalDispatchId?: number | null;
  customer?: { name: string } | null;
  po?: { customer?: { name: string } | null } | null;
  /** True when SO is COMPLETED — no new drafts, locks, or draft deletes (reversal may reopen SO). */
  dispatchReadOnly?: boolean;
  lineStats: LineStat[];
  dispatch?: DispatchEvent[];
};

function customerDisplayName(so: SoRow): string {
  return so.customer?.name?.trim() || so.po?.customer?.name?.trim() || "Unknown Customer";
}

function fmtDispatchQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

function safeNum(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Matches backend NO_QTY cycle FK rules (SalesOrderCycle.id). */
function normalizePositiveCycleId(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type NoQtyCycleOption = {
  cycleId: number;
  cycleNo: number;
  cycleLabel: string;
  /** Sum of QC-backed dispatch headroom for this cycle (from API). */
  dispatchableQty?: number;
  /** Only one sequential gate cycle may be dispatched at a time. */
  eligible?: boolean;
  sequentialLockReason?: string | null;
  status: string;
  lockedRequirementSheetId: number | null;
};

const NO_QTY_BLOCK_EPS = 1e-9;

/** Operator-facing one-liner for queue / Cannot Dispatch Now (NO_QTY). */
function noQtyBlockedReasonPlain(ls: LineStat): string {
  const d = safeNum(ls.dispatchable ?? ls.dispatchableQty ?? 0);
  if (d > NO_QTY_BLOCK_EPS) return "—";
  const pool =
    safeNum(ls.cycleQcAcceptedQty ?? ls.qcAccepted) +
    safeNum(ls.cycleRecheckAcceptedQty ?? 0) +
    safeNum(ls.postCycleApprovalQty ?? 0);
  if (pool <= NO_QTY_BLOCK_EPS) {
    return "No QC-accepted qty for this cycle";
  }
  return "QC-accepted qty fully dispatched for this cycle";
}

function mapNoQtySoBlockedReasonApi(raw: string): string {
  const t = raw.trim();
  if (t.includes("noQtyCycleId is not an active cycle for this sales order")) {
    return "Selected cycle is no longer active for this sales order. Please choose the active cycle.";
  }
  if (t.includes("Select a valid active cycle")) {
    return "Selected cycle is no longer active for this sales order. Please choose the active cycle.";
  }
  if (t.toLowerCase().includes("completed") && t.toLowerCase().includes("view") && t.toLowerCase().includes("only")) {
    return "This sales order is completed. Dispatch is view-only.";
  }
  if (t.includes("Dispatch is view-only")) {
    return "This sales order is completed. Dispatch is view-only.";
  }
  if (t.includes("No QC is pending")) {
    return "No QC is pending for the current cycle.";
  }
  if (t.includes("Requirement Sheet must be locked")) {
    return "Cannot dispatch: requirement sheet for the selected cycle is not locked. Complete planning and lock the sheet for this cycle.";
  }
  if (t.includes("No active cycle")) {
    return "Cannot dispatch: no active cycle. Reopen the sales order to start or continue a cycle.";
  }
  return t;
}

function noQtyDispatchNextActionMessage(params: {
  ls: LineStat;
  dispatchable: number;
  existingDraftQty: number;
  headroomToPrepare: number;
}): string | null {
  const { ls, dispatchable, existingDraftQty, headroomToPrepare } = params;
  if (dispatchable > NO_QTY_BLOCK_EPS) return null;
  const qcCycle =
    safeNum(ls.cycleQcAcceptedQty ?? ls.qcAccepted) +
    safeNum(ls.cycleRecheckAcceptedQty ?? 0) +
    safeNum(ls.postCycleApprovalQty ?? 0);
  const stock = safeNum(ls.usableQcPassedStock ?? ls.onHand ?? ls.totalStock);
  const lastShort = safeNum(ls.lastShortageQty);

  if (existingDraftQty > NO_QTY_BLOCK_EPS && headroomToPrepare <= NO_QTY_BLOCK_EPS) {
    return "Draft ready — click Finalize to confirm dispatch.";
  }
  if (qcCycle > NO_QTY_BLOCK_EPS) {
    return "QC-accepted quantity for this cycle is fully dispatched (same-cycle basis).";
  }
  if (stock <= NO_QTY_BLOCK_EPS) {
    return "No QC acceptance posted for this cycle yet — complete production approval and QC when ready.";
  }
  if (lastShort > NO_QTY_BLOCK_EPS) {
    return "Nothing to dispatch from usable stock right now — continue production/QC if needed, then dispatch a combined qty later.";
  }
  return "Nothing to dispatch for this cycle yet — complete QC for this cycle when ready.";
}

type DispatchContextPick =
  | {
      kind: "ACTIONABLE_DRAFT";
      draftDispatchId: number;
    }
  | {
      kind: "DISPATCHABLE_CONTEXT";
      soId: number;
      lineId: number;
      /** NO_QTY only */
      cycleId: number | null;
    };

function getUsableStock(ls: LineStat): number {
  return safeNum(ls.usableQcPassedStock ?? ls.totalStock ?? ls.onHand);
}

/** Confirmed pending qty on the SO line (open-lines table). */
function linePendingOnOrderDisplay(ls: LineStat): number {
  return Math.max(0, safeNum(ls.pendingDispatchQty ?? 0));
}

/** Stock column for open-lines table (usable FG; NO_QTY uses same usable fields). */
function lineAvailableStockTable(so: SoRow, ls: LineStat): number {
  if (so.orderType === "NO_QTY") return safeNum(ls.usableQcPassedStock ?? ls.totalStock ?? ls.onHand);
  return getUsableStock(ls);
}

/** Standard (non–No Qty, non–replacement) sales order — wording treats usable stock as optional, not auto-next-step. */
function isRegularNormalSalesOrder(so: SoRow | null | undefined): boolean {
  const t = so?.orderType;
  return t === "NORMAL" || t == null;
}

/** Ledger row SO type — billing shortcuts apply only to standard (non–No Qty, non–replacement) orders. */
function isRegularNormalLedgerSoOrderType(t: DispatchLedgerRow["soOrderType"]): boolean {
  return t === "NORMAL" || t == null;
}

type RegularDispatchReadiness = "READY_FULL" | "PARTIAL_AVAILABLE" | "NOT_READY";

function effectiveRegularDispatchReadiness(so: SoRow, ls: LineStat): RegularDispatchReadiness | null {
  if (!isRegularNormalSalesOrder(so)) return null;
  const fromApi = ls.regularDispatchReadiness;
  if (fromApi === "READY_FULL" || fromApi === "PARTIAL_AVAILABLE" || fromApi === "NOT_READY") {
    return fromApi;
  }
  const pending = confirmedBacklogQty(ls);
  const cap = safeNum(ls.dispatchable ?? ls.dispatchableQty ?? 0);
  const eps = 1e-9;
  if (pending <= eps) return "NOT_READY";
  if (cap <= eps) return "NOT_READY";
  if (cap + eps >= pending) return "READY_FULL";
  return "PARTIAL_AVAILABLE";
}

type DispatchBacklogStatus = "READY_FULL" | "PARTIAL_AVAILABLE" | "WAITING";

function backlogStatus(pendingQty: number, maxDispatchableNow: number): DispatchBacklogStatus {
  const pending = Math.max(0, safeNum(pendingQty));
  const maxNow = safeNum(maxDispatchableNow);
  const eps = 1e-9;
  if (maxNow > eps && maxNow + eps >= pending) return "READY_FULL";
  if (maxNow > eps && pending > eps) return "PARTIAL_AVAILABLE";
  return "WAITING";
}

function backlogStatusLabel(s: DispatchBacklogStatus): string {
  if (s === "READY_FULL") return "Ready to Dispatch";
  if (s === "PARTIAL_AVAILABLE") return "Partial Available";
  return "Waiting for Stock/QC";
}

function backlogStatusBadgeClass(s: DispatchBacklogStatus): string {
  if (s === "READY_FULL") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (s === "PARTIAL_AVAILABLE") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

/** Sort key: NORMAL (incl. legacy null type) partial-after-full; then dispatchable qty high → low. */
function normalPartialPrepareTier(so: SoRow, ls: LineStat): 0 | 1 {
  if (!isRegularNormalSalesOrder(so)) return 0;
  return effectiveRegularDispatchReadiness(so, ls) === "PARTIAL_AVAILABLE" ? 1 : 0;
}

function comparePrepareQueueEntries(a: { so: SoRow; ls: LineStat }, b: { so: SoRow; ls: LineStat }): number {
  const cycleA =
    a.so.orderType === "NO_QTY"
      ? normalizePositiveCycleId(
          a.ls.noQtyCycleId ?? a.so.noQtyDispatchContext?.selectedCycleId ?? a.so.currentCycleId,
        )
      : null;
  const cycleB =
    b.so.orderType === "NO_QTY"
      ? normalizePositiveCycleId(
          b.ls.noQtyCycleId ?? b.so.noQtyDispatchContext?.selectedCycleId ?? b.so.currentCycleId,
        )
      : null;
  const tierA = normalPartialPrepareTier(a.so, a.ls);
  const tierB = normalPartialPrepareTier(b.so, b.ls);
  if (tierA !== tierB) return tierA - tierB;
  const d =
    (b.so.orderType === "NO_QTY"
      ? computeNoQtyAutoReadyQty({ so: b.so, ls: b.ls })
      : computeDispatchableNow({ so: b.so, ls: b.ls, cycleIdOverride: cycleB })) -
    (a.so.orderType === "NO_QTY"
      ? computeNoQtyAutoReadyQty({ so: a.so, ls: a.ls })
      : computeDispatchableNow({ so: a.so, ls: a.ls, cycleIdOverride: cycleA }));
  if (Math.abs(d) > 1e-9) return d;
  if (b.so.id !== a.so.id) return b.so.id - a.so.id;
  return b.ls.lineId - a.ls.lineId;
}

function computeDispatchableBaseNoDraft(params: {
  so: SoRow;
  ls: LineStat;
}): number {
  const { so, ls } = params;
  if (so.orderType === "NO_QTY") {
    const net = safeNum(ls.operationalNetDispatchedQty ?? ls.cycleDispatchedQty ?? 0);
    const qc = safeNum(ls.cycleQcAcceptedQty ?? ls.qcAccepted ?? 0);
    const recheck = safeNum(ls.cycleRecheckAcceptedQty ?? 0);
    const post = safeNum(ls.postCycleApprovalQty ?? 0);
    return Math.max(0, qc + recheck + post - net);
  }
  const usable = getUsableStock(ls);
  const soRemaining = confirmedBacklogQty(ls);
  // REPLACEMENT: server dispatchable is driven by customer-return QC pool minus net dispatch — not global on-hand.
  if (so.orderType === "REPLACEMENT") {
    const serverCap = safeNum(ls.dispatchable ?? ls.dispatchableQty);
    return Math.min(soRemaining, serverCap);
  }
  // NORMAL Regular SO: min(confirmed SO backlog, usable FG). Usable stock stays in USABLE until prepare/finalize;
  // positive headroom is optional capacity (Dispatch UI), not an automatic "next mandatory stage" trigger.
  return Math.min(soRemaining, usable);
}

/** NO_QTY only: QC + in-cycle disposition→USABLE + post-cycle approvals − same-cycle operational dispatch (matches API). */
function computeNoQtyAutoReadyQty(params: { so: SoRow; ls: LineStat }): number {
  const { so, ls } = params;
  if (so.orderType !== "NO_QTY") return 0;
  return computeDispatchableBaseNoDraft({ so, ls });
}

function computeDispatchableNow(params: {
  so: SoRow;
  ls: LineStat;
  /** NO_QTY only: override selected cycle id */
  cycleIdOverride?: number | null;
}): number {
  const { so, ls, cycleIdOverride } = params;
  const base = computeDispatchableBaseNoDraft({ so, ls });
  const existingDraftQty = draftQtyForSoItem(so, ls.itemId, cycleIdOverride, ls.noQtyCycleId ?? null);
  return Math.max(0, base - existingDraftQty);
}

/**
 * Frontend picker: prefer actionable prepared draft, else any dispatchable context.
 * IMPORTANT RULE: never show "Dispatch complete" if this can return non-null.
 */
function pickBestDispatchContext(params: { rows: SoRow[]; ledgerRows: DispatchLedgerRow[] }): DispatchContextPick | null {
  const { rows, ledgerRows } = params;

  const actionableDrafts = (ledgerRows || [])
    .filter((r) => r.workflowStatus === "UNLOCKED" && !r.reversalOfId)
    .sort((a, b) => Number(b.id) - Number(a.id));
  if (actionableDrafts.length > 0) {
    return { kind: "ACTIONABLE_DRAFT", draftDispatchId: Number(actionableDrafts[0].id) };
  }

  // Best dispatchable context for the workbench (Dispatch page). NO_QTY uses QC-backed auto-ready; others use operational headroom
  // (including NORMAL min(backlog, usable) so operators can prepare when they open Dispatch). Dashboard KPI for NORMAL is separate.
  // NORMAL: prefer full-pending coverage over partial stock (same qty → lower tier wins).
  let best: { soId: number; lineId: number; cycleId: number | null; qty: number; tier: number } | null = null;
  for (const so of rows || []) {
    for (const ls of so.lineStats || []) {
      const cycleId =
        so.orderType === "NO_QTY"
          ? normalizePositiveCycleId(ls.noQtyCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId)
          : null;
      const qty = computeDispatchableNow({ so, ls, cycleIdOverride: cycleId });
      if (!(qty > 1e-9)) continue;
      const tier = so.orderType === "NO_QTY" ? 0 : normalPartialPrepareTier(so, ls);
      if (
        !best ||
        tier < best.tier ||
        (Math.abs(tier - best.tier) < 1e-9 && qty > best.qty + 1e-9)
      ) {
        best = { soId: so.id, lineId: ls.lineId, cycleId: so.orderType === "NO_QTY" ? cycleId : null, qty, tier };
      }
    }
  }
  if (best) return { kind: "DISPATCHABLE_CONTEXT", soId: best.soId, lineId: best.lineId, cycleId: best.cycleId };

  return null;
}

function isCurrentDispatchSelectionStillValid(params: {
  rows: SoRow[];
  soId: number;
  salesOrderLineId: number;
  noQtySelectedCycleId: number | null;
}): boolean {
  const { rows, soId, salesOrderLineId, noQtySelectedCycleId } = params;
  if (!(soId > 0) || !(salesOrderLineId > 0)) return false;
  const so = (rows || []).find((r) => Number(r.id) === Number(soId));
  if (!so) return false;
  const ls = (so.lineStats || []).find((l) => Number(l.lineId) === Number(salesOrderLineId));
  if (!ls) return false;
  if (so.orderType === "NO_QTY") {
    const cyc = normalizePositiveCycleId(
      ls.noQtyCycleId ?? noQtySelectedCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId,
    );
    if (cyc == null) return false;
    // Still actionable if either draft exists for this context or dispatchable now > 0.
    const draftQty = draftQtyForSoItem(so, ls.itemId, noQtySelectedCycleId, ls.noQtyCycleId ?? null);
    if (draftQty > 1e-9) return true;
    const can = computeDispatchableNow({ so, ls, cycleIdOverride: cyc });
    return can > 1e-9;
  }
  const draftQty = draftQtyForSoItem(so, ls.itemId, null);
  if (draftQty > 1e-9) return true;
  return computeDispatchableNow({ so, ls }) > 1e-9;
}

function buildReadySorted(rows: SoRow[]): { so: SoRow; ls: LineStat }[] {
  const flat = rows.flatMap((so) => (so.lineStats ?? []).map((ls) => ({ so, ls })));
  return flat
    .filter(({ so, ls }) => {
      const cycleId =
        so.orderType === "NO_QTY"
          ? normalizePositiveCycleId(ls.noQtyCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId)
          : null;
      return computeDispatchableNow({ so, ls, cycleIdOverride: cycleId }) > 1e-9;
    })
    .sort(comparePrepareQueueEntries);
}

type PrepareQueueSection = {
  key: "full" | "partial" | "other";
  label: string;
  rows: { so: SoRow; ls: LineStat }[];
};

/** Open-lines queue: NORMAL lines grouped for partial-stock UX; NO_QTY and REPLACEMENT stay in other. */
function buildPrepareQueueSections(rows: SoRow[]): PrepareQueueSection[] {
  const ready = buildReadySorted(rows);
  const full: { so: SoRow; ls: LineStat }[] = [];
  const partial: { so: SoRow; ls: LineStat }[] = [];
  const other: { so: SoRow; ls: LineStat }[] = [];
  for (const e of ready) {
    if (e.so.orderType === "NO_QTY") {
      other.push(e);
      continue;
    }
    if (e.so.orderType === "NORMAL" || e.so.orderType == null) {
      if (effectiveRegularDispatchReadiness(e.so, e.ls) === "PARTIAL_AVAILABLE") partial.push(e);
      else full.push(e);
      continue;
    }
    other.push(e);
  }
  const sections: PrepareQueueSection[] = [];
  if (full.length) {
    sections.push({
      key: "full",
      label: "Ready for full dispatch",
      rows: [...full].sort(comparePrepareQueueEntries),
    });
  }
  if (partial.length) {
    sections.push({
      key: "partial",
      label: "Partial stock available",
      rows: [...partial].sort(comparePrepareQueueEntries),
    });
  }
  if (other.length) {
    sections.push({
      key: "other",
      label: "Other open lines",
      rows: [...other].sort(comparePrepareQueueEntries),
    });
  }
  return sections;
}

function buildAllLineEntries(rows: SoRow[]): { so: SoRow; ls: LineStat }[] {
  return rows.flatMap((so) => (so.lineStats ?? []).map((ls) => ({ so, ls })));
}

function confirmedBacklogQty(ls: LineStat): number {
  return Math.max(0, Number(ls.pendingDispatchQty ?? 0));
}

function draftQtyForSoItem(
  so: SoRow | undefined,
  itemId: number,
  noQtySelectedCycleId?: number | null,
  /** When set, scopes NO_QTY drafts to this SalesOrderCycle.id (per-cycle line stats). */
  rowNoQtyCycleId?: number | null,
): number {
  if (!so || !itemId) return 0;
  const want =
    so.orderType === "NO_QTY"
      ? normalizePositiveCycleId(
          rowNoQtyCycleId ?? noQtySelectedCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId,
        )
      : null;
  const drafts = (so.dispatch || []).filter((d) => {
    if (d.reversalOfId != null || d.workflowStatus !== "UNLOCKED" || d.itemId !== itemId) return false;
    if (so.orderType === "NO_QTY") {
      const got = normalizePositiveCycleId(d.cycleId);
      if (want == null || got !== want) return false;
    }
    return true;
  });
  return drafts.reduce((s, d) => s + Number(d.dispatchedQty || 0), 0);
}

/** NO_QTY: sum of prepared (UNLOCKED) draft qty for this FG across all cycles. */
function totalNoQtyDraftQtyForItem(so: SoRow, itemId: number): number {
  if (so.orderType !== "NO_QTY" || !itemId) return 0;
  return (so.dispatch || [])
    .filter(
      (d) =>
        Number(d.itemId) === Number(itemId) &&
        d.reversalOfId == null &&
        d.workflowStatus === "UNLOCKED",
    )
    .reduce((s, d) => s + Number(d.dispatchedQty || 0), 0);
}

/** NO_QTY: total QC-backed prepare headroom for one FG (sum per-cycle dispatchable now — FIFO pools). */
function computeNoQtyTotalPrepareHeadroomForItem(so: SoRow, itemId: number): number {
  if (so.orderType !== "NO_QTY") return 0;
  const lines = (so.lineStats || []).filter((l) => Number(l.itemId) === Number(itemId));
  let sum = 0;
  for (const ls of lines) {
    const cyc = normalizePositiveCycleId(
      ls.noQtyCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId,
    );
    sum += computeDispatchableNow({ so, ls, cycleIdOverride: cyc });
  }
  return sum;
}

const LEDGER_PAGE_SIZE = 10;

function rowStatusBadge(d: DispatchEvent): { label: string; className: string } {
  if (d.reversalOfId != null) {
    return { label: "Reversed", className: "bg-red-50 text-red-900 border-red-200" };
  }
  if (d.workflowStatus === "UNLOCKED") {
    return { label: "Prepared", className: "bg-amber-50 text-amber-900 border-amber-200" };
  }
  return { label: "Finalized", className: "bg-emerald-50 text-emerald-900 border-emerald-200" };
}

/** Compact QC vs dispatch context for the active line (matches GET /api/dispatch/sales-orders fields). */
function DispatchAvailabilityStrip({
  orderType,
  line,
  readyToShip,
  noQtyNextAction,
}: {
  orderType?: string;
  line: LineStat;
  readyToShip: number;
  /** NO_QTY: plain-language next step when Dispatchable Now is 0 */
  noQtyNextAction?: string | null;
}) {
  const qcPassed = safeNum(line.qcAccepted);
  const netDispatched = safeNum(line.operationalNetDispatchedQty ?? line.dispatched);
  const poolRemaining = safeNum(line.qcApprovedRemaining);
  const stock = safeNum(line.totalStock ?? line.onHand);
  const reworkHint = safeNum(line.inQcReworkQty);

  if (orderType === "NO_QTY") {
    const usable = safeNum(line.usableQcPassedStock ?? line.onHand);
    const qcAcc = safeNum(line.cycleQcAcceptedQty ?? line.qcAccepted);
    const postCycle = safeNum(line.postCycleApprovalQty ?? 0);
    const planned = safeNum(line.cycleCap);
    const soRem = safeNum(line.soRemainingDemandQty);
    const fulfillSnap = line.fulfillmentQtySnapshot != null ? safeNum(line.fulfillmentQtySnapshot) : null;
    const coveredSnap = line.coveredFromStockQtySnapshot != null ? safeNum(line.coveredFromStockQtySnapshot) : null;
    const prodReqSnap = line.productionRequiredQtySnapshot != null ? safeNum(line.productionRequiredQtySnapshot) : null;
    return (
      <div className="rounded-md border border-sky-200 bg-sky-50/90 px-3 py-2.5 text-[11px] leading-snug text-slate-800">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-900/90">Selected cycle — dispatch basis</div>
        <dl className="mt-2 grid grid-cols-1 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded border border-sky-100 bg-white/80 px-2 py-1.5">
            <dt className="text-[10px] font-medium text-slate-600">SO Remaining Demand</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(soRem)}</dd>
            <p className="mt-0.5 text-[9px] text-slate-500">Customer qty still pending on this sales order (all cycles).</p>
          </div>
          <div className="rounded border border-sky-100 bg-white/80 px-2 py-1.5">
            <dt className="text-[10px] font-medium text-slate-600">Fulfillment Qty (cycle cap)</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(planned)}</dd>
            <p className="mt-0.5 text-[9px] text-slate-500">From locked requirement sheet (current required qty).</p>
          </div>
          <div className="rounded border border-sky-100 bg-white/80 px-2 py-1.5">
            <dt className="text-[10px] font-medium text-slate-600">History only</dt>
            <dd className="text-[10px] text-slate-600">Not used for current dispatch limit.</dd>
          </div>
          {fulfillSnap != null || prodReqSnap != null || coveredSnap != null ? (
            <div className="rounded border border-slate-200 bg-white/70 px-2 py-1.5">
              <dt className="text-[10px] font-medium text-slate-600">Requirement Sheet snapshot (locked)</dt>
              <dd className="mt-0.5 space-y-0.5 text-[10px] text-slate-800">
                {fulfillSnap != null ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">Fulfillment qty</span>
                    <span className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(fulfillSnap)}</span>
                  </div>
                ) : null}
                {coveredSnap != null ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">Covered from stock</span>
                    <span className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(coveredSnap)}</span>
                  </div>
                ) : null}
                {prodReqSnap != null ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">Production required</span>
                    <span className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(prodReqSnap)}</span>
                  </div>
                ) : null}
              </dd>
              <p className="mt-0.5 text-[9px] text-slate-500">For clarity only; dispatch uses current usable stock + remaining cycle cap.</p>
            </div>
          ) : null}
          <div className="rounded border border-sky-100 bg-white/80 px-2 py-1.5">
            <dt className="text-[10px] font-medium text-slate-600">QC accepted (this cycle)</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(qcAcc)}</dd>
            <p className="mt-0.5 text-[9px] text-slate-500">Dispatch limit uses this cycle only — not global stock.</p>
          </div>
          {postCycle > NO_QTY_BLOCK_EPS ? (
            <div className="rounded border border-teal-100 bg-teal-50/70 px-2 py-1.5">
              <dt className="text-[10px] font-medium text-teal-900/90">Post-cycle approvals (in pool)</dt>
              <dd className="font-semibold tabular-nums text-teal-950">{fmtDispatchQty(postCycle)}</dd>
              <p className="mt-0.5 text-[9px] text-teal-900/80" title="Qty approved after previous cycle was closed">
                Included in dispatchable for this cycle — does not reopen the prior cycle.
              </p>
            </div>
          ) : null}
          <div className="rounded border border-sky-100 bg-white/80 px-2 py-1.5">
            <dt className="text-[10px] font-medium text-slate-600">Usable QC-Passed Stock</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(usable)}</dd>
          </div>
          <div className="rounded border border-emerald-200 bg-emerald-50/90 px-2 py-1.5 sm:col-span-2 lg:col-span-1">
            <dt className="text-[10px] font-medium text-emerald-900/90">Dispatchable Now</dt>
            <dd className="text-[15px] font-bold tabular-nums text-emerald-950">{fmtDispatchQty(readyToShip)}</dd>
            <p className="mt-0.5 text-[9px] text-emerald-900/80">
              QC this cycle + in-cycle hold/rework releases + post-cycle approvals − same-cycle dispatch, after prepared draft.
            </p>
          </div>
        </dl>
        {readyToShip <= NO_QTY_BLOCK_EPS && noQtyNextAction ? (
          <p className="mt-2 rounded border border-slate-200 bg-slate-50/90 px-2 py-1.5 text-[11px] leading-snug text-slate-700">
            {noQtyNextAction}
          </p>
        ) : null}
      </div>
    );
  }

  if (orderType === "REPLACEMENT") {
    return (
      <div className="rounded-md border border-violet-200 bg-violet-50/90 px-2.5 py-2 text-[11px] leading-snug text-slate-800">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-900/90">Replacement dispatch — return QC pool</div>
        <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
          <div>
            <dt className="text-slate-600">Return QC passed (SO+item)</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(qcPassed)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Already dispatched (net operational)</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(netDispatched)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Replacement pool remaining</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(poolRemaining)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Max prepare now</dt>
            <dd className="font-semibold tabular-nums text-emerald-900">{fmtDispatchQty(readyToShip)}</dd>
          </div>
        </dl>
        <p className="mt-1.5 text-[10px] text-slate-600">
          Replacement pool remaining = max(0, return QC accepted for this replacement SO and item − net operational dispatch).
          Max prepare is also limited by SO line backlog and usable stock ({fmtDispatchQty(stock)} on hand).
        </p>
        {reworkHint > 1e-9 ? (
          <p className="mt-0.5 text-[10px] text-slate-500">QC hold / pending / rework (SKU, not dispatchable): {fmtDispatchQty(reworkHint)}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/90 px-2.5 py-2 text-[11px] leading-snug text-slate-800">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-900/90">Dispatch basis (QC vs shipped)</div>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
        <div>
          <dt className="text-slate-600">QC passed qty (SO+item)</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(qcPassed)}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Already dispatched (net operational)</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(netDispatched)}</dd>
        </div>
        <div>
          <dt className="text-slate-600">QC pool remaining</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(poolRemaining)}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Max prepare now</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(readyToShip)}</dd>
        </div>
      </dl>
      <p className="mt-1.5 text-[10px] text-slate-600">
        QC pool remaining = max(0, QC passed − net operational dispatch for this item). &quot;Net operational&quot; includes prepared (draft) rows.
        <span className="font-medium text-slate-700"> Usable stock on hand: {fmtDispatchQty(stock)}.</span> You may prepare a dispatch up to the
        figure above when required; usable stock stays in USABLE until you prepare and finalize. Max prepare is capped by pending SO qty and this
        headroom (not a mandatory next workflow step).
      </p>
      {reworkHint > 1e-9 ? (
        <p className="mt-0.5 text-[10px] text-slate-500">QC hold / pending / rework (SKU, not dispatchable): {fmtDispatchQty(reworkHint)}</p>
      ) : null}
    </div>
  );
}

function NoQtyAdminDispatchDebugPanel(props: {
  expanded: boolean;
  onToggle: () => void;
  loading: boolean;
  error: string | null;
  json: string | null;
  onLoad: () => void;
  uiSnapshot: Record<string, unknown> | null;
}) {
  return (
    <div className="rounded border border-amber-200/80 bg-amber-50/60 px-2 py-1.5 text-[11px] text-amber-950">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left font-semibold text-amber-950 hover:underline"
        onClick={() => props.onToggle()}
      >
        <span>Admin dispatch debug</span>
        <span className="text-slate-500">{props.expanded ? "▼" : "▶"}</span>
      </button>
      {props.expanded ? (
        <div className="mt-2 border-t border-amber-200/80 pt-2">
          <p className="text-[10px] text-amber-900/90">
            Same numbers as <code className="rounded bg-amber-100/80 px-0.5">computeNoQtyDispatchHeadroom</code> for this SO + item.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-amber-300 text-[12px] text-amber-950 hover:bg-amber-100/80"
              disabled={props.loading}
              onClick={() => props.onLoad()}
            >
              {props.loading ? "Loading…" : "Load server dispatch debug (API)"}
            </Button>
          </div>
          {props.error ? <p className="mt-1.5 text-[11px] text-red-800">{props.error}</p> : null}
          {props.uiSnapshot ? (
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-[11px] font-medium text-amber-900">UI snapshot (selected cycle)</summary>
              <pre className="mt-1.5 max-h-44 overflow-auto rounded border border-amber-100 bg-white p-2 font-mono text-[10px] leading-snug text-slate-800">
                {JSON.stringify(props.uiSnapshot, null, 2)}
              </pre>
            </details>
          ) : null}
          {props.json ? (
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-[11px] font-medium text-amber-900">Server debug JSON</summary>
              <pre className="mt-1.5 max-h-72 overflow-auto rounded border border-amber-100 bg-white p-2 font-mono text-[10px] leading-snug text-slate-800">
                {props.json}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Primary decision summary: demand vs stock vs max prepare (Regular / replacement). Technical breakdown in collapsible. */
function DispatchDecisionSummaryCard(props: {
  so: SoRow;
  ls: LineStat;
  readyToShip: number;
  noQtyNextAction?: string | null;
  regularReadiness?: RegularDispatchReadiness | null;
}) {
  const { so, ls, readyToShip, noQtyNextAction, regularReadiness } = props;
  const ordered = safeNum(ls.orderQty);
  const pending = confirmedBacklogQty(ls);
  const delivered = Math.max(0, ordered - pending);
  const usable = getUsableStock(ls);
  const maxNow = Math.max(0, readyToShip);
  const regNormal = isRegularNormalSalesOrder(so);
  const isRep = so.orderType === "REPLACEMENT";
  const partialRegularUx =
    regNormal && regularReadiness === "PARTIAL_AVAILABLE" && pending > NO_QTY_BLOCK_EPS && maxNow > NO_QTY_BLOCK_EPS;
  const displayMaxPrepare = regNormal && !partialRegularUx ? Math.min(maxNow, pending) : maxNow;

  let shortNote = "";
  if (pending <= NO_QTY_BLOCK_EPS) {
    shortNote = "Nothing left to ship on this line.";
  } else if (usable <= NO_QTY_BLOCK_EPS) {
    shortNote = "No stock available for this item yet.";
  } else if (maxNow <= NO_QTY_BLOCK_EPS) {
    shortNote = "Cannot prepare a quantity right now for this line (see more details if needed).";
  } else if (partialRegularUx) {
    // Long-form partial guidance lives only in the prepare panel (right column).
    shortNote = "";
  } else if (regNormal) {
    shortNote = `Ready to dispatch — max prepare now ${fmtDispatchQty(Math.min(maxNow, pending))} (${fmtDispatchQty(
      pending,
    )} pending on order).`;
  } else if (isRep) {
    shortNote = `You can prepare up to ${fmtDispatchQty(maxNow)} within return limits and stock.`;
  } else {
    shortNote = `You can prepare up to ${fmtDispatchQty(maxNow)}.`;
  }

  return (
    <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Selected</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] text-slate-900">
          <span className="font-mono font-semibold tabular-nums">{displaySalesOrderNo(so.id, so.docNo)}</span>
          <span className="text-slate-400">·</span>
          <span className="font-medium">{customerDisplayName(so)}</span>
          <span className="text-slate-400">·</span>
          <span className="font-semibold">{ls.itemName}</span>
        </div>

        <div className="mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">Summary</div>
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1.5">
            <dt className="text-[11px] font-medium text-slate-600">Order qty</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">{fmtDispatchQty(ordered)}</dd>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1.5">
            <dt className="text-[11px] font-medium text-slate-600">Already shipped</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">{fmtDispatchQty(delivered)}</dd>
          </div>
          <div className="rounded-md border border-amber-100 bg-amber-50/60 px-2 py-1.5">
            <dt className="text-[11px] font-medium text-amber-900/90">Pending on order</dt>
            <dd className="text-lg font-semibold tabular-nums text-amber-950">{fmtDispatchQty(pending)}</dd>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1.5">
            <dt className="text-[11px] font-medium text-slate-600">{regNormal ? "Available stock to use" : "Stock / pool"}</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">{fmtDispatchQty(usable)}</dd>
          </div>
          <div
            className={
              partialRegularUx
                ? "rounded-md border border-slate-200 bg-slate-50/80 px-2 py-1.5 sm:col-span-2 lg:col-span-1"
                : "rounded-md border border-emerald-200 bg-emerald-50/70 px-2 py-1.5 sm:col-span-2 lg:col-span-1"
            }
          >
            <dt className={partialRegularUx ? "text-[11px] font-medium text-slate-600" : "text-[11px] font-medium text-emerald-900/90"}>
              {partialRegularUx ? "Partial stock available" : "Max prepare now"}
            </dt>
            <dd
              className={
                partialRegularUx ? "text-xl font-bold tabular-nums text-slate-900" : "text-xl font-bold tabular-nums text-emerald-950"
              }
            >
              {fmtDispatchQty(displayMaxPrepare)}
            </dd>
          </div>
        </dl>
        {shortNote.trim() ? <p className="mt-2 text-[12px] leading-snug text-slate-700">{shortNote}</p> : null}

        <details className="mt-3 rounded-md border border-slate-200 bg-slate-50/50">
          <summary className="cursor-pointer select-none px-2 py-1.5 text-[12px] font-semibold text-slate-700">
            More details (QC / pool / planning)
          </summary>
          <div className="border-t border-slate-200 px-2 py-2">
            <DispatchAvailabilityStrip
              orderType={so.orderType}
              line={ls}
              readyToShip={readyToShip}
              noQtyNextAction={noQtyNextAction}
            />
          </div>
        </details>
      </div>
    </div>
  );
}

export function DispatchPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const demo = useDemoMode();
  const finalizeDemoHl =
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "regular", 5) ??
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "no_qty", 6);
  const showDemoNoQtyDispatchContinue = demo.enabled && demo.flow === "no_qty" && demo.step === 6;
  const [sp, setSearchParams] = useSearchParams();
  const source = sp.get("source") ?? "";
  const fromNoQtySo = source === "no_qty_so";
  const fromGlobalSearch = source === "global_search";
  const draftDispatchId = Number(sp.get("draftDispatchId") ?? 0);
  const focusSoId = Number(sp.get("salesOrderId") ?? 0);
  const focusLedgerDispatchId = Number(sp.get("dispatchId") ?? 0);
  const focusLedgerDispatchIdValid = Number.isFinite(focusLedgerDispatchId) && focusLedgerDispatchId > 0;
  const focusSoIdValid = Number.isFinite(focusSoId) && focusSoId > 0;
  const focusItemId = Number(sp.get("itemId") ?? 0);
  const focusCycleId = Number(sp.get("cycleId") ?? 0);
  const focusCycleIdValid = Number.isFinite(focusCycleId) && focusCycleId > 0;
  const focusItemIdValid = Number.isFinite(focusItemId) && focusItemId > 0;
  const [focusSo, setFocusSo] = React.useState<{ id: number; customerName: string; docNo?: string | null } | null>(null);

  const isAdmin = useIsAdmin();
  const canOpenRs = useCanOpenRequirementSheet();
  const [rows, setRows] = React.useState<SoRow[]>([]);
  /** When GET /api/dispatch/sales-orders omits a focused NO_QTY SO, hydrate from GET /api/sales-orders/:id (FG lines, zeroed metrics). */
  const [fallbackSoRow, setFallbackSoRow] = React.useState<SoRow | null>(null);
  /** When reopening a draft from history, ensure its SO exists in the dropdown options. */
  const [reopenFallbackSoRow, setReopenFallbackSoRow] = React.useState<SoRow | null>(null);
  const [ledgerRows, setLedgerRows] = React.useState<DispatchLedgerRow[]>([]);
  const [ledgerPage, setLedgerPage] = React.useState(1);
  const [ledgerDateFrom, setLedgerDateFrom] = React.useState("");
  const [ledgerDateTo, setLedgerDateTo] = React.useState("");
  const [ledgerTotal, setLedgerTotal] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  /** Non-error user feedback (e.g. idempotency “already processing”). */
  const [dispatchInfo, setDispatchInfo] = React.useState<string | null>(null);
  /** NO_QTY FIFO preview line from POST /dispatches/no-qty-fifo-preview. */
  const [, setNoQtyFifoPreviewLine] = React.useState<string | null>(null);
  const [noQtyLastFinalizedDispatchId, setNoQtyLastFinalizedDispatchId] = React.useState<number | null>(null);
  const [reopenedPreparedDraft, setReopenedPreparedDraft] = React.useState<{
    id: number;
    workflowStatus: "UNLOCKED";
    soId: number;
    itemId: number;
    cycleId: number | null;
    qty: string;
    docNo?: string | null;
  } | null>(null);

  const [soId, setSoId] = React.useState(0);
  /** SO line id (unique); dispatch API still posts itemId from the selected line */
  const [salesOrderLineId, setSalesOrderLineId] = React.useState(0);
  const {
    raw: dispatchQtyStr,
    setRaw: setDispatchQtyStr,
    parsed: dispatchQtyParsed,
    isValid: dispatchQtyValid,
    reset: resetDispatchQty,
  } = useMandatoryPositiveQtyDraft();
  const [dispatching, setDispatching] = React.useState(false);
  const [reversingId, setReversingId] = React.useState<number | null>(null);
  const [lockingId, setLockingId] = React.useState<number | null>(null);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  const [blockedOpen, setBlockedOpen] = React.useState(false);
  const dispatchSubmitLockRef = React.useRef(false);
  const lastNoQtyDispatchPrefillKeyRef = React.useRef<string>("");
  /** Admin-only: raw JSON from GET /api/dispatch/no-qty-debug (same inputs as computeNoQtyDispatchHeadroom). */
  const [noQtyDebugJson, setNoQtyDebugJson] = React.useState<string | null>(null);
  const [noQtyDebugData, setNoQtyDebugData] = React.useState<any | null>(null);
  const [noQtyDebugLoading, setNoQtyDebugLoading] = React.useState(false);
  const [noQtyDebugError, setNoQtyDebugError] = React.useState<string | null>(null);
  const [noQtyAdminDebugOpen, setNoQtyAdminDebugOpen] = React.useState(false);
  /** Admin: cycle dropdown + per-cycle labels. Operators use SO + item + FIFO only. */
  const [noQtyAdminAdvancedOpen, setNoQtyAdminAdvancedOpen] = React.useState(false);
  const noQtyStrictCycleGuidance = isAdmin && noQtyAdminAdvancedOpen;

  const [noQtyCycles, setNoQtyCycles] = React.useState<NoQtyCycleOption[]>([]);
  const [noQtyCyclesLoading, setNoQtyCyclesLoading] = React.useState(false);
  /** Selected ACTIVE cycle (SalesOrderCycle.id) driving NO_QTY dispatch math. */
  const [noQtySelectedCycleId, setNoQtySelectedCycleId] = React.useState<number | null>(null);
  /** NORMAL + PARTIAL_AVAILABLE: operator must tick before Prepare Dispatch is enabled. */
  const [normalPartialDispatchAck, setNormalPartialDispatchAck] = React.useState(false);
  /** Partial qty UI only after explicit opt-in (avoids validating/showing qty when using Dispatch Full only). */
  const [isPartialMode, setIsPartialMode] = React.useState(false);
  /** After finalize, prompt Create Sales Bill in the dispatch work area (cleared on new prepare / delete bill flow). */
  const [salesBillStepDispatchId, setSalesBillStepDispatchId] = React.useState<number | null>(null);
  /** When prepared-draft card is shown, open-lines queue starts collapsed. */
  const [showOpenLinesQueue, setShowOpenLinesQueue] = React.useState(false);

  async function openDraftById(dispatchId: number) {
    const id = Number(dispatchId);
    if (!(Number.isFinite(id) && id > 0)) return;
    try {
      setError(null);
      const draft = await apiFetch<{
        id: number;
        docNo: string | null;
        workflowStatus: "UNLOCKED";
        soId: number;
        soDocNo: string | null;
        soOrderType: "NORMAL" | "REPLACEMENT" | "NO_QTY" | null;
        itemId: number;
        itemName: string | null;
        cycleId: number | null;
        qty: string;
        salesOrderLineId: number | null;
      }>(`/api/dispatch/dispatches/${id}`);

      if (!draft || draft.workflowStatus !== "UNLOCKED") {
        toast.showError("Could not reopen this dispatch draft.");
        return;
      }

      // Baseline reopen: load the draft context without entering a dedicated “reopened draft mode”.
      // TEMP DEBUG (remove after stabilization)
      console.debug("[DISPATCH_DEBUG] openDraftById: loaded draft", {
        id: draft.id,
        soId: draft.soId,
        salesOrderLineId: draft.salesOrderLineId,
        itemId: draft.itemId,
        cycleId: draft.cycleId,
        qty: draft.qty,
      });
      // TEMP DEBUG (remove after verification)
      console.debug("[DRAFT_VERIFY]", {
        draftId: draft.id,
        docNo: draft.docNo,
        soId: draft.soId,
        itemId: draft.itemId,
        cycleId: draft.cycleId,
        workflowStatus: draft.workflowStatus,
        qty: draft.qty,
      });
      // Ensure the reopened SO exists in the visible dropdown options even if it’s not in /api/dispatch/sales-orders.
      // Uses existing SO read endpoint; no backend changes.
      try {
        const so = await apiFetch<any>(`/api/sales-orders/${Number(draft.soId)}`);
        const fg = (so?.lines ?? []).filter((l: any) => l?.item?.itemType === "FG");
        const lineStats: LineStat[] = fg.map((l: any) => ({
          // Keep NO_QTY selection stable: backend NO_QTY uses synthetic lineId = itemId.
          lineId: Number(l.itemId),
          itemId: Number(l.itemId),
          itemName: (l?.item?.itemName ?? "").trim() || `Item #${l.itemId}`,
          orderQty: safeNum(l?.qty),
          dispatched: 0,
          remaining: 0,
          pendingDispatchQty: 0,
          onHand: 0,
          totalStock: 0,
          qcAccepted: 0,
          qcApprovedRemaining: 0,
          cycleQcAcceptedQty: 0,
          dispatchable: 0,
          dispatchableQty: 0,
          cycleCap: 0,
          cycleDispatchedQty: 0,
          cycleCapRemaining: 0,
          soRemainingDemandQty: 0,
          lastShortageQty: 0,
          usableQcPassedStock: 0,
          dispatchBlockedReason:
            "Draft reopened from history. Dispatchable metrics may be filtered out of the open queue; finalize via SO ledger.",
        }));
        setReopenFallbackSoRow({
          id: Number(so?.id ?? draft.soId),
          docNo: so?.docNo ?? null,
          orderType: so?.orderType ?? (draft.soOrderType ?? "NORMAL"),
          flowMode: (so?.orderType ?? draft.soOrderType) === "NO_QTY" ? "NO_QTY_SO" : "REGULAR_SO",
          customer: so?.customer ?? null,
          po: so?.po ?? null,
          lineStats,
          dispatch: so?.dispatch ?? [],
          // NO_QTY: completed should not hard-block dispatch; only CLOSED is view-only.
          dispatchReadOnly: so?.internalStatus === "CLOSED",
          noQtyDispatchBlockedReason: null,
        } as any);
      } catch {
        setReopenFallbackSoRow(null);
      }

      // Bind the visible selects to the draft context.
      if (draft.soOrderType === "NO_QTY" && draft.cycleId != null && Number(draft.cycleId) > 0) {
        setNoQtySelectedCycleId(Number(draft.cycleId));
      }
      setSoId(Number(draft.soId));
      setSalesOrderLineId(
        draft.soOrderType === "NO_QTY"
          ? Number(draft.itemId) // NO_QTY: visible Item select is keyed by synthetic lineId=itemId
          : draft.salesOrderLineId != null && Number(draft.salesOrderLineId) > 0
            ? Number(draft.salesOrderLineId)
            : 0,
      );
      setDispatchQtyStr(String(draft.qty ?? ""));
      setReopenedPreparedDraft({
        id: draft.id,
        workflowStatus: "UNLOCKED",
        soId: Number(draft.soId),
        itemId: Number(draft.itemId),
        cycleId: draft.cycleId != null ? Number(draft.cycleId) : null,
        qty: String(draft.qty ?? ""),
        docNo: draft.docNo ?? null,
      });
      setDispatchInfo(`Reopened prepared dispatch ${draft.docNo ?? `#${draft.id}`}.`);
      // Persist in URL for stable “reopened draft mode”.
      {
        const params = new URLSearchParams(sp);
        params.set("draftDispatchId", String(draft.id));
        navigate(`/dispatch?${params.toString()}`, { replace: true });
      }

      // Ensure NO_QTY cap/remaining values come from backend debug payload (fallback SO rows may have 0s).
      if (draft.soOrderType === "NO_QTY") {
        try {
          const cyc = draft.cycleId != null ? `&cycleId=${encodeURIComponent(String(draft.cycleId))}` : "";
          const dbg = await apiFetch<any>(`/api/dispatch/no-qty-debug?soId=${draft.soId}&itemId=${draft.itemId}${cyc}`);
          setNoQtyDebugData(dbg);
          setNoQtyDebugJson(JSON.stringify(dbg, null, 2));
        } catch {
          // Keep existing debug values; do not block reopen.
        }
      }
      // Refresh standard page data (no special ledger includes / scroll / highlights).
      await refresh();
    } catch (e) {
      toast.showError("Could not reopen this dispatch draft.");
      setError(e instanceof Error ? e.message : "Could not reopen this dispatch draft.");
    }
  }

  const reopenedPreparedDraftMode =
    Number.isFinite(draftDispatchId) &&
    draftDispatchId > 0 &&
    reopenedPreparedDraft != null &&
    reopenedPreparedDraft.workflowStatus === "UNLOCKED" &&
    Number(reopenedPreparedDraft.id) === Number(draftDispatchId);

  const shortcutHints = useShortcutHints({
    pageKey: "dispatch",
    fieldShortcuts: {
      dispatchSo: FIELD_HINT_DISPATCH_SO,
      dispatchFg: FIELD_HINT_DISPATCH_LINE,
      dispatchQty: FIELD_HINT_ENTER_NEXT,
      dispatchPrepare: FIELD_HINT_DISPATCH_PREPARE,
    },
    firstUseTipText: "Tip: Enter moves to the next field. Ctrl+Enter prepares dispatch when the button is enabled.",
  });

  const loadSalesOrders = React.useCallback(async (): Promise<SoRow[]> => {
    // TEMP DEBUG (remove after live verification)
    const params = new URLSearchParams();
    const pinSo =
      (fromNoQtySo && focusSoIdValid) || (fromGlobalSearch && focusSoIdValid) ? focusSoId : soId;
    const pinCycle = noQtySelectedCycleId;
    const selectedRow = displayRowsRef.current.find((r) => r.id === pinSo);
    const allowNoQtyCycleQuery =
      pinSo > 0 &&
      pinCycle != null &&
      ((fromNoQtySo && focusSoIdValid && pinSo === focusSoId) || selectedRow?.orderType === "NO_QTY");
    if (allowNoQtyCycleQuery) {
      params.set("noQtySoId", String(pinSo));
      params.set("noQtyCycleId", String(pinCycle));
    }
    const qs = params.toString();
    const url = `/api/dispatch/sales-orders${qs ? `?${qs}` : ""}`;
    const list = await apiFetch<SoRow[]>(url);
    const finalRows =
      (fromNoQtySo || fromGlobalSearch) && focusSoIdValid ? (list || []).filter((r) => r.id === focusSoId) : list || [];
    console.debug("[DISPATCH_UI_TRACE][sales-orders-response]", {
      url,
      rawCount: Array.isArray(list) ? list.length : null,
      finalCount: Array.isArray(finalRows) ? finalRows.length : null,
      soIds: Array.isArray(finalRows) ? finalRows.map((r) => r.id).slice(0, 50) : null,
      so26: Array.isArray(finalRows)
        ? finalRows.find((r) => Number(r.id) === 26) ?? null
        : null,
    });
    setRows(finalRows);
    return finalRows;
  }, [fromNoQtySo, fromGlobalSearch, focusSoId, focusSoIdValid, soId, noQtySelectedCycleId]);

  const displayRows = React.useMemo(() => {
    if ((fromNoQtySo || fromGlobalSearch) && focusSoIdValid) {
      const hit = rows.find((r) => r.id === focusSoId);
      if (hit) return rows;
      if (fallbackSoRow?.id === focusSoId) return [fallbackSoRow];
      return rows;
    }
    if (soId > 0) {
      const hit = rows.find((r) => r.id === soId);
      if (!hit && reopenFallbackSoRow?.id === soId) return [reopenFallbackSoRow];
    }
    return rows;
  }, [rows, fallbackSoRow, reopenFallbackSoRow, soId, fromNoQtySo, fromGlobalSearch, focusSoId, focusSoIdValid]);

  const displayRowsRef = React.useRef(displayRows);
  displayRowsRef.current = displayRows;

  React.useEffect(() => {
    if (!(fromNoQtySo || fromGlobalSearch) || !focusSoIdValid) {
      setFallbackSoRow(null);
      return;
    }
    if (rows.some((r) => r.id === focusSoId)) {
      setFallbackSoRow(null);
      return;
    }
    let cancelled = false;
    apiFetch<{
      id: number;
      docNo?: string | null;
      orderType?: string;
      internalStatus?: string;
      customer?: SoRow["customer"];
      po?: SoRow["po"];
      lines?: Array<{
        id: number;
        itemId: number;
        qty?: unknown;
        item?: { itemName?: string | null; itemType?: string | null } | null;
      }>;
      dispatch?: SoRow["dispatch"];
    }>(`/api/sales-orders/${focusSoId}`)
      .then((so) => {
        if (cancelled || !so || so.id !== focusSoId) return;
        if (so.orderType !== "NO_QTY") {
          setFallbackSoRow(null);
          return;
        }
        const fg = (so.lines ?? []).filter((l) => l.item?.itemType === "FG");
        const lineStats: LineStat[] = fg.map((l) => ({
          lineId: l.itemId,
          itemId: l.itemId,
          itemName: l.item?.itemName?.trim() || `Item #${l.itemId}`,
          orderQty: safeNum(l.qty),
          dispatched: 0,
          remaining: 0,
          pendingDispatchQty: 0,
          onHand: 0,
          totalStock: 0,
          qcAccepted: 0,
          qcApprovedRemaining: 0,
          cycleQcAcceptedQty: 0,
          dispatchable: 0,
          dispatchableQty: 0,
          cycleCap: 0,
          cycleDispatchedQty: 0,
          cycleCapRemaining: 0,
          soRemainingDemandQty: 0,
          lastShortageQty: 0,
          usableQcPassedStock: 0,
          dispatchBlockedReason:
            "Not on the dispatch queue yet — check active cycle, locked requirement sheet, QC, and stock.",
        }));
        setFallbackSoRow({
          id: so.id,
          docNo: so.docNo ?? null,
          orderType: "NO_QTY",
          flowMode: "NO_QTY_SO",
          customer: so.customer ?? null,
          po: so.po ?? null,
          lineStats,
          dispatch: so.dispatch ?? [],
          // NO_QTY: backend treats MANUALLY_CLOSED and CLOSED as view-only.
          dispatchReadOnly: so.internalStatus === "CLOSED" || so.internalStatus === "MANUALLY_CLOSED",
          noQtyDispatchBlockedReason: null,
        });
      })
      .catch(() => {
        if (!cancelled) setFallbackSoRow(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fromNoQtySo, fromGlobalSearch, focusSoIdValid, focusSoId, rows]);

  const selectedSo = React.useMemo(() => displayRows.find((r) => r.id === soId), [displayRows, soId]);

  const noQtyFlowTargetId = React.useMemo(() => {
    if (selectedSo != null) {
      return selectedSo.orderType === "NO_QTY" && selectedSo.id > 0 ? selectedSo.id : null;
    }
    return fromNoQtySo && focusSoIdValid ? focusSoId : null;
  }, [selectedSo, fromNoQtySo, focusSoIdValid, focusSoId]);

  const { state: noQtyFlowState } = useNoQtyFlowState(
    noQtyFlowTargetId,
    noQtyFlowTargetId != null && noQtyFlowTargetId > 0,
  );

  // NO_QTY guided entry: when routed from QC/Production with itemId, preselect that item’s first eligible line.
  React.useEffect(() => {
    if (!fromNoQtySo || !focusSoIdValid) return;
    if (!selectedSo || selectedSo.id !== focusSoId) return;
    if (!focusItemIdValid) return;
    if (salesOrderLineId > 0) return;
    const hits = (selectedSo.lineStats || []).filter((l) => Number(l.itemId) === Number(focusItemId));
    if (!hits.length) return;
    const scored = hits.map((l) => ({ l, pend: linePendingOnOrderDisplay(l), cyc: Number(l.noQtyCycleNo ?? 0) }));
    scored.sort((a, b) => b.pend - a.pend || a.cyc - b.cyc);
    const hit = scored[0]?.l ?? hits[0];
    setSalesOrderLineId(hit.lineId);
  }, [fromNoQtySo, focusSoIdValid, focusSoId, selectedSo, focusItemId, focusItemIdValid, salesOrderLineId]);
  // Read-only should still apply in NO_QTY (completed/closed SOs are view-only).
  const dispatchReadOnly = Boolean(selectedSo?.dispatchReadOnly);

  React.useEffect(() => {
    setNoQtySelectedCycleId(null);
    setNoQtyCycles([]);
  }, [soId]);

  React.useEffect(() => {
    if (selectedSo?.orderType !== "NO_QTY") return;
    let cancelled = false;
    setNoQtyCyclesLoading(true);
    apiFetch<{ cycles: NoQtyCycleOption[]; sequentialGateCycleId?: number | null }>(
      `/api/dispatch/no-qty-cycles?soId=${selectedSo.id}`,
    )
      .then((data) => {
        if (cancelled) return;
        setNoQtyCycles(Array.isArray(data.cycles) ? data.cycles : []);
      })
      .catch(() => {
        if (!cancelled) setNoQtyCycles([]);
      })
      .finally(() => {
        if (!cancelled) setNoQtyCyclesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSo?.id, selectedSo?.orderType]);

  React.useEffect(() => {
    if (selectedSo?.orderType !== "NO_QTY" || noQtyCyclesLoading) return;
    if (reopenedPreparedDraftMode) return;
    if (noQtyCycles.length === 0) {
      setNoQtySelectedCycleId(null);
      return;
    }
    setNoQtySelectedCycleId((prev) => {
      const isEligible = (c: NoQtyCycleOption) => c.eligible !== false;
      const eligibleCycles = noQtyCycles.filter(isEligible);
      const hasDispatchable = (c: NoQtyCycleOption) => safeNum(c.dispatchableQty) > 1e-9;
      if (
        fromNoQtySo &&
        focusSoIdValid &&
        selectedSo?.id === focusSoId &&
        focusCycleIdValid &&
        noQtyCycles.some((c) => c.cycleId === focusCycleId)
      ) {
        const urlHit = noQtyCycles.find((c) => c.cycleId === focusCycleId);
        // CONFIRMED: if URL cycle has dispatchable qty, respect it even if sequential gating marks it ineligible.
        if (urlHit && (hasDispatchable(urlHit) || isEligible(urlHit))) return focusCycleId;
      }
      if (prev != null) {
        const p = noQtyCycles.find((c) => c.cycleId === prev);
        if (p && isEligible(p)) return prev;
      }
      const dispatchableCycles = noQtyCycles.filter(hasDispatchable);
      if (dispatchableCycles.length === 1) return dispatchableCycles[0].cycleId;
      if (eligibleCycles.length === 1) return eligibleCycles[0].cycleId;
      const firstEligible = noQtyCycles.find(isEligible);
      if (firstEligible) return firstEligible.cycleId;
      return noQtyCycles[0]?.cycleId ?? null;
    });
  }, [
    selectedSo?.orderType,
    selectedSo?.id,
    selectedSo?.currentCycleId,
    noQtyCycles,
    noQtyCyclesLoading,
    reopenedPreparedDraftMode,
    fromNoQtySo,
    focusSoIdValid,
    focusSoId,
    focusCycleIdValid,
    focusCycleId,
  ]);

  React.useEffect(() => {
    setNoQtyDebugJson(null);
    setNoQtyDebugError(null);
  }, [soId, salesOrderLineId]);

  const dispatchFormRef = React.useRef<HTMLDivElement | null>(null);
  const soSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const fgLineSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const dispatchQtyRef = React.useRef<HTMLInputElement | null>(null);
  useFastEntryForm({
    containerRef: dispatchFormRef,
    initialFocusRef: soSelectRef,
    initialFocusEnabled: displayRows.length > 0,
  });

  useDependentFieldFocus({
    targetRef: fgLineSelectRef,
    enabled: Boolean(soId > 0 && displayRows.length > 0),
    deps: [soId],
  });
  useDependentFieldFocus({
    targetRef: dispatchQtyRef,
    enabled: Boolean(salesOrderLineId > 0 && !dispatchReadOnly && displayRows.length > 0),
    deps: [salesOrderLineId],
  });

  const loadLedger = React.useCallback(async (opts?: {
    soId?: number;
    itemId?: number;
    cycleId?: number | null;
    ignoreDateFilters?: boolean;
  }) => {
    const override = opts ?? null;
    const overrideSoId = override?.soId != null ? Number(override.soId) : null;
    const overrideCycleId = override?.cycleId != null ? Number(override.cycleId) : null;

    const offset = override ? 0 : (ledgerPage - 1) * LEDGER_PAGE_SIZE;
    const params = new URLSearchParams();
    params.set("limit", String(LEDGER_PAGE_SIZE));
    params.set("offset", String(offset));

    const ignoreDates = Boolean(override?.ignoreDateFilters);
    if (!ignoreDates) {
      if (ledgerDateFrom) params.set("from", ledgerDateFrom);
      if (ledgerDateTo) params.set("to", ledgerDateTo);
    }

    if (overrideSoId != null && overrideSoId > 0) {
      params.set("soId", String(overrideSoId));
      if (overrideCycleId != null && overrideCycleId > 0) params.set("cycleId", String(overrideCycleId));
    } else {
      const pin = displayRowsRef.current.find((r) => r.id === soId);
      // NO_QTY: load ledger for the whole SO (all cycles) so multi-cycle prepared rows are visible without switching cycles.
      if (pin?.orderType === "NO_QTY" && soId > 0) {
        params.set("soId", String(soId));
      } else if ((fromNoQtySo || fromGlobalSearch) && focusSoIdValid) {
        params.set("soId", String(focusSoId));
        const pinF = displayRowsRef.current.find((r) => r.id === focusSoId);
        if (pinF?.orderType !== "NO_QTY" && noQtySelectedCycleId != null) {
          params.set("cycleId", String(noQtySelectedCycleId));
        }
      }
    }
    const ledger = await apiFetch<{ rows: DispatchLedgerRow[]; total?: number }>(
      `/api/dispatch/ledger?${params.toString()}`,
    );
    let rows = ledger.rows || [];
    let total = typeof ledger.total === "number" ? ledger.total : 0;
    if ((fromNoQtySo || fromGlobalSearch) && focusSoIdValid && !params.has("cycleId")) {
      rows = rows.filter((r) => r.soId === focusSoId);
      total = rows.length;
    }
    const lastPage = Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE) || 1);
    if (total > 0 && ledgerPage > lastPage) {
      setLedgerPage(lastPage);
      return;
    }
    setLedgerRows(rows);
    setLedgerTotal(total);
    // TEMP DEBUG (remove after stabilization)
    console.debug("[DISPATCH_DEBUG] loadLedger: result", {
      soId,
      cycleId: params.get("cycleId"),
      rows: rows.length,
      total,
      unlockedForwards: rows.filter((r) => r.workflowStatus === "UNLOCKED" && r.reversalOfId == null).map((r) => r.id),
    });
  }, [ledgerPage, ledgerDateFrom, ledgerDateTo, fromNoQtySo, fromGlobalSearch, focusSoId, focusSoIdValid, soId, noQtySelectedCycleId]);

  React.useEffect(() => {
    void loadLedger();
    const row = displayRowsRef.current.find((r) => r.id === soId);
    if (row?.orderType === "NO_QTY" && noQtySelectedCycleId != null) {
      void loadSalesOrders();
    }
  }, [noQtySelectedCycleId, soId, loadLedger, loadSalesOrders]);

  React.useEffect(() => {
    if (!(fromNoQtySo || fromGlobalSearch) || !focusSoIdValid) setFocusSo(null);
  }, [fromNoQtySo, fromGlobalSearch, focusSoIdValid]);

  // When opened from NO_QTY Sales Orders, auto-select that SO and load context.
  React.useEffect(() => {
    if ((!fromNoQtySo && !fromGlobalSearch) || !focusSoIdValid) return;
    setSoId(focusSoId);
    setSalesOrderLineId(0);
    resetDispatchQty();
    apiFetch<any>(`/api/sales-orders/${focusSoId}`)
      .then((so) => {
        const customerName = so?.customer?.name ?? so?.po?.customer?.name ?? "—";
        setFocusSo({ id: focusSoId, customerName, docNo: so?.docNo ?? null });
      })
      .catch(() => setFocusSo({ id: focusSoId, customerName: "—", docNo: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromNoQtySo, fromGlobalSearch, focusSoId, focusSoIdValid]);

  const refresh = React.useCallback(async () => {
    await loadSalesOrders();
    await loadLedger();
  }, [loadSalesOrders, loadLedger]);

  /** Select SO line; leave dispatch qty blank so operators use Dispatch Full or expand partial dispatch intentionally. */
  const selectLineFromBacklog = React.useCallback(
    (r: SoRow, ls: LineStat) => {
      setError(null);
      setDispatchInfo(null);
      setSoId(r.id);
      setSalesOrderLineId(ls.lineId);
      if (r.orderType === "NO_QTY") {
        const c = normalizePositiveCycleId(ls.noQtyCycleId);
        if (c != null) setNoQtySelectedCycleId(c);
      }
      setIsPartialMode(false);
      resetDispatchQty();
      window.requestAnimationFrame(() => {
        dispatchFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [resetDispatchQty],
  );

  // NO_QTY usability: when a focused SO is pre-selected, also pre-select the best dispatchable line.
  React.useEffect(() => {
    if (!fromNoQtySo || !focusSoIdValid) return;
    if (!selectedSo || selectedSo.id !== focusSoId) return;
    if (salesOrderLineId > 0) return;
    if (dispatchReadOnly) return;
    const best = (selectedSo.lineStats || []).find((l) => {
      const cyc = normalizePositiveCycleId(
        l.noQtyCycleId ?? noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId,
      );
      return computeDispatchableNow({ so: selectedSo, ls: l, cycleIdOverride: cyc }) > 1e-9;
    });
    const fallback = (selectedSo.lineStats || [])[0];
    const pick = best ?? fallback;
    if (pick) selectLineFromBacklog(selectedSo, pick);
  }, [fromNoQtySo, focusSoId, focusSoIdValid, selectedSo, salesOrderLineId, dispatchReadOnly, selectLineFromBacklog, noQtySelectedCycleId]);

  const prepareQueueSections = React.useMemo(() => buildPrepareQueueSections(displayRows), [displayRows]);
  const prepareQueueRowCount = React.useMemo(
    () => prepareQueueSections.reduce((n, s) => n + s.rows.length, 0),
    [prepareQueueSections],
  );
  const blockedLines = React.useMemo(
    () =>
      buildAllLineEntries(displayRows).filter(({ so, ls }) => {
        if (so.orderType !== "NO_QTY") {
          return computeDispatchableNow({ so, ls }) <= 1e-9;
        }
        const cycleId = normalizePositiveCycleId(
          ls.noQtyCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId,
        );
        return computeDispatchableNow({ so, ls, cycleIdOverride: cycleId }) <= 1e-9;
      }),
    [displayRows],
  );

  React.useEffect(() => {
    if (displayRows.length === 0 || soId !== 0) return;
    const sections = buildPrepareQueueSections(displayRows);
    const first = sections[0]?.rows[0];
    if (first) {
      selectLineFromBacklog(first.so, first.ls);
    }
  }, [displayRows, soId, selectLineFromBacklog]);

  React.useEffect(() => {
    setNormalPartialDispatchAck(false);
  }, [soId, salesOrderLineId]);

  React.useEffect(() => {
    loadSalesOrders().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [loadSalesOrders]);

  // Reopened prepared draft mode: load draft by id from URL.
  React.useEffect(() => {
    if (!(Number.isFinite(draftDispatchId) && draftDispatchId > 0)) return;
    void openDraftById(draftDispatchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftDispatchId]);

  /** Global search / deep link: scroll ledger to dispatch row once, then drop `dispatchId` from URL. */
  React.useEffect(() => {
    if (!focusLedgerDispatchIdValid) return;
    if (!ledgerRows.some((r) => r.id === focusLedgerDispatchId)) return;
    const t = window.setTimeout(() => {
      document
        .querySelector(`[data-ledger-dispatch-id="${focusLedgerDispatchId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete("dispatchId");
          return n;
        },
        { replace: true },
      );
    }, 150);
    return () => window.clearTimeout(t);
  }, [ledgerRows, focusLedgerDispatchId, focusLedgerDispatchIdValid, setSearchParams]);

  React.useEffect(() => {
    loadLedger().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [loadLedger]);

  const selectedSoReplacement = selectedSo?.orderType === "REPLACEMENT";

  /** Clear FG + qty when SO cleared; drop stale line id when it no longer exists on the SO. */
  React.useEffect(() => {
    if (!soId) {
      setSalesOrderLineId(0);
      resetDispatchQty();
      return;
    }
    const so = displayRows.find((r) => r.id === soId);
    if (!so) return;
    const isNoQty = so.orderType === "NO_QTY";
    const selectable = isNoQty
      ? (so.lineStats || []).filter((l) => {
          const cyc = normalizePositiveCycleId(
            l.noQtyCycleId ?? noQtySelectedCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId,
          );
          return computeDispatchableNow({ so, ls: l, cycleIdOverride: cyc }) > 1e-9;
        })
      : (so.lineStats ?? []).filter((l) => (l.pendingDispatchQty ?? 0) > 0);
    if (!selectable.length) {
      // Keep SO/FG selection when a prepared draft was reopened from history — finalize path even if headroom shows 0.
      if (
        reopenedPreparedDraft &&
        Number(reopenedPreparedDraft.soId) === Number(so.id) &&
        Number.isFinite(draftDispatchId) &&
        draftDispatchId > 0 &&
        Number(reopenedPreparedDraft.id) === draftDispatchId
      ) {
        return;
      }
      setSalesOrderLineId(0);
      resetDispatchQty();
      return;
    }
    if (salesOrderLineId === 0) return;
    const stillValid = selectable.some((l) => l.lineId === salesOrderLineId);
    if (!stillValid) {
      setSalesOrderLineId(0);
      resetDispatchQty();
    }
  }, [soId, displayRows, salesOrderLineId, resetDispatchQty, reopenedPreparedDraft, draftDispatchId]);

  const allLines = selectedSo?.lineStats ?? [];
  /** Regular SO: confirmed backlog (`pendingDispatchQty` > 0). NO_QTY: all cycle / FG lines so reasons stay visible at 0 dispatchable. */
  const selectableLines = React.useMemo(() => {
    if (!selectedSo) return [];
    if (selectedSo.flowMode === "NO_QTY_SO") {
      return allLines.filter((l) => {
        const cyc = normalizePositiveCycleId(
          l.noQtyCycleId ?? noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId,
        );
        const can = computeDispatchableNow({ so: selectedSo, ls: l, cycleIdOverride: cyc });
        return can > 1e-9 || linePendingOnOrderDisplay(l) > 1e-9;
      });
    }
    return allLines.filter((l) => (l.pendingDispatchQty ?? 0) > 0);
  }, [selectedSo, allLines, noQtySelectedCycleId]);

  /** Single source of truth for selection: salesOrderLineId, looked up on full lineStats (not the filtered dropdown). */
  const currentLine = allLines.find((l) => l.lineId === salesOrderLineId);

  /** NO_QTY operator mode: one menu row per item (FIFO); admin advanced: all cycle rows. */
  const fgLineSelectOptions = React.useMemo(() => {
    const raw =
      currentLine && !selectableLines.some((x) => x.lineId === currentLine.lineId)
        ? [currentLine, ...selectableLines]
        : selectableLines;
    if (!selectedSo || selectedSo.orderType !== "NO_QTY" || noQtyStrictCycleGuidance) return raw;
    const byItem = new Map<number, LineStat[]>();
    for (const l of raw) {
      const arr = byItem.get(l.itemId) ?? [];
      arr.push(l);
      byItem.set(l.itemId, arr);
    }
    const out: LineStat[] = [];
    for (const [, lines] of byItem) {
      const sorted = lines.sort(
        (a, b) => safeNum(a.noQtyCycleNo) - safeNum(b.noQtyCycleNo) || a.lineId - b.lineId,
      );
      const pick = sorted.find((l) => l.lineId === salesOrderLineId) ?? sorted[0];
      if (pick) out.push(pick);
    }
    return out.sort((a, b) => a.itemId - b.itemId);
  }, [selectedSo, selectableLines, currentLine, noQtyStrictCycleGuidance, salesOrderLineId]);

  const noQtyDebugItemId = React.useMemo(() => {
    if (!selectedSo || selectedSo.orderType !== "NO_QTY") return 0;
    if (currentLine?.itemId) return currentLine.itemId;
    const first = selectedSo.lineStats?.[0];
    return first?.itemId ?? 0;
  }, [selectedSo, currentLine?.itemId]);

  const loadNoQtyDispatchDebug = React.useCallback(async () => {
    if (!isAdmin || !selectedSo || selectedSo.orderType !== "NO_QTY" || !noQtyDebugItemId) return;
    setNoQtyDebugLoading(true);
    setNoQtyDebugError(null);
    try {
      const cycId = normalizePositiveCycleId(currentLine?.noQtyCycleId ?? noQtySelectedCycleId);
      const cyc = cycId != null ? `&cycleId=${encodeURIComponent(String(cycId))}` : "";
      const data = await apiFetch<any>(
        `/api/dispatch/no-qty-debug?soId=${selectedSo.id}&itemId=${noQtyDebugItemId}${cyc}`,
      );
      setNoQtyDebugData(data);
      setNoQtyDebugJson(JSON.stringify(data, null, 2));
    } catch (e) {
      setNoQtyDebugJson(null);
      setNoQtyDebugData(null);
      setNoQtyDebugError(
        e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Request failed",
      );
    } finally {
      setNoQtyDebugLoading(false);
    }
  }, [isAdmin, selectedSo, noQtyDebugItemId, noQtySelectedCycleId, currentLine?.noQtyCycleId]);

  const noQtyServerCap = React.useMemo(() => {
    if (!noQtyDebugData) return null;
    const cap = Number((noQtyDebugData as any).cycleCapQty ?? NaN);
    const rem = Number((noQtyDebugData as any).cycleCapRemaining ?? NaN);
    if (!Number.isFinite(cap) || !Number.isFinite(rem)) return null;
    return { cycleCapQty: cap, cycleCapRemaining: rem };
  }, [noQtyDebugData]);

  // Clear stale NO_QTY cycle messages when the currently selected line is dispatchable.
  React.useEffect(() => {
    if (!error) return;
    if (!selectedSo || selectedSo.orderType !== "NO_QTY") return;
    if (!currentLine) return;
    const cyc = normalizePositiveCycleId(
      currentLine.noQtyCycleId ??
        noQtySelectedCycleId ??
        selectedSo.noQtyDispatchContext?.selectedCycleId ??
        selectedSo.currentCycleId,
    );
    const dispatchable = computeDispatchableNow({ so: selectedSo, ls: currentLine, cycleIdOverride: cyc });
    if (!(dispatchable > 1e-9)) return;
    const t = error.trim();
    if (t === "No dispatchable quantity remaining for this cycle." || t.toLowerCase().includes("cycle")) {
      setError(null);
    }
  }, [error, selectedSo, currentLine, noQtySelectedCycleId]);
  const noQtyCycleResolved = normalizePositiveCycleId(
    currentLine?.noQtyCycleId ??
      noQtySelectedCycleId ??
      selectedSo?.noQtyDispatchContext?.selectedCycleId ??
      selectedSo?.currentCycleId,
  );
  const noQtyBlocked =
    selectedSo?.orderType === "NO_QTY" &&
    (noQtyCyclesLoading || (noQtyCycles.length === 0 && noQtyCycleResolved == null && !reopenedPreparedDraftMode));
  const selectedNoQtyCycleMeta = React.useMemo(() => {
    if (noQtySelectedCycleId == null) return null;
    return noQtyCycles.find((c) => c.cycleId === noQtySelectedCycleId) ?? null;
  }, [noQtySelectedCycleId, noQtyCycles]);

  const selectedNoQtyCycleStatusLabel = React.useMemo(() => {
    const cyc = noQtySelectedCycleId;
    if (cyc == null) return null;
    const meta = selectedNoQtyCycleMeta;
    const cycleNo = meta?.cycleNo;
    const status = String(meta?.status ?? "");
    const suffix = status === "ACTIVE" ? "Active" : status === "CLOSED" ? "Closed" : status ? status : "—";
    if (cycleNo != null && Number.isFinite(Number(cycleNo))) return `Cycle ${Number(cycleNo)} (${suffix})`;
    return `Cycle ${cyc} (${suffix})`;
  }, [noQtySelectedCycleId, selectedNoQtyCycleMeta]);

  const soLedgerDispatches = React.useMemo(() => {
    if (!selectedSo?.dispatch?.length) return [];
    if (selectedSo.orderType !== "NO_QTY") return selectedSo.dispatch;
    const itemId = currentLine?.itemId;
    if (itemId == null || itemId === 0) return selectedSo.dispatch;
    return selectedSo.dispatch.filter((d) => Number(d.itemId) === Number(itemId));
  }, [selectedSo, currentLine?.itemId]);

  const soLedgerDispatchesOtherCycles = React.useMemo(() => [] as DispatchEvent[], []);

  const showSoDispatchLedger = React.useMemo(() => {
    if (!selectedSo) return false;
    if (selectedSo.orderType !== "NO_QTY") return (selectedSo.dispatch?.length ?? 0) > 0;
    return soLedgerDispatches.length > 0 || soLedgerDispatchesOtherCycles.length > 0;
  }, [selectedSo, soLedgerDispatches, soLedgerDispatchesOtherCycles]);

  const noQtyUiDebugSnapshot = React.useMemo(() => {
    if (selectedSo?.orderType !== "NO_QTY" || !currentLine) return null;
    const w = normalizePositiveCycleId(currentLine.noQtyCycleId ?? noQtySelectedCycleId);
    if (w == null) return null;
    const all = selectedSo.dispatch || [];
    const relevant = all.filter(
      (d) =>
        d.itemId === currentLine.itemId &&
        d.reversalOfId == null &&
        normalizePositiveCycleId(d.cycleId) === w,
    );
    const finalizedRows = relevant.filter((d) => d.workflowStatus !== "UNLOCKED");
    const draftRows = relevant.filter((d) => d.workflowStatus === "UNLOCKED");
    const currentCycleCap = noQtyServerCap?.cycleCapQty ?? Number(currentLine.cycleCap ?? 0);
    const finalDispatchableQty = computeDispatchableBaseNoDraft({ so: selectedSo, ls: currentLine });
    const dispatchableNowAfterDraft = computeDispatchableNow({
      so: selectedSo,
      ls: currentLine,
      cycleIdOverride: w,
    });
    return {
      salesOrderId: selectedSo.id,
      itemId: currentLine.itemId,
      selectedCycleId: w,
      finalizedDispatchRowIds: finalizedRows.map((d) => d.id),
      draftDispatchRowIds: draftRows.map((d) => d.id),
      currentCycleCap,
      currentCycleQcAccepted: Number(currentLine.cycleQcAcceptedQty ?? currentLine.qcAccepted ?? 0),
      finalDispatchableQty,
      dispatchableNowAfterDraft,
      soRemainingDemandQty: Number(currentLine.soRemainingDemandQty ?? 0),
      usableQcPassedStock: Number(currentLine.usableQcPassedStock ?? currentLine.totalStock ?? currentLine.onHand ?? 0),
      lastShortageQty: Number(currentLine.lastShortageQty ?? 0),
    };
  }, [selectedSo, currentLine, noQtySelectedCycleId, noQtyServerCap, currentLine?.noQtyCycleId]);

  const existingDraftQty =
    currentLine && selectedSo
      ? selectedSo.orderType === "NO_QTY"
        ? totalNoQtyDraftQtyForItem(selectedSo, currentLine.itemId)
        : draftQtyForSoItem(selectedSo, currentLine.itemId, noQtySelectedCycleId, currentLine.noQtyCycleId ?? null)
      : 0;

  const currentDispatchableBase =
    currentLine && selectedSo
      ? computeDispatchableBaseNoDraft({ so: selectedSo, ls: currentLine })
      : 0;

  const noQtyTotalHeadroomForCurrentItem =
    selectedSo?.orderType === "NO_QTY" && currentLine
      ? computeNoQtyTotalPrepareHeadroomForItem(selectedSo, currentLine.itemId)
      : null;

  /** Max qty you can enter for prepare = Dispatchable Now (draft-aware). NO_QTY uses summed FIFO pools across cycles. */
  const headroomToPrepare =
    selectedSo?.orderType === "NO_QTY" && noQtyTotalHeadroomForCurrentItem != null
      ? noQtyTotalHeadroomForCurrentItem
      : Math.max(0, currentDispatchableBase - existingDraftQty);
  const readyToShip = headroomToPrepare;
  const currentDispatchableQty = headroomToPrepare;

  const noQtySelectedCycleIdResolved = React.useMemo(
    () =>
      normalizePositiveCycleId(
        currentLine?.noQtyCycleId ??
          noQtySelectedCycleId ??
          selectedSo?.noQtyDispatchContext?.selectedCycleId ??
          selectedSo?.currentCycleId,
      ),
    [
      currentLine?.noQtyCycleId,
      noQtySelectedCycleId,
      selectedSo?.noQtyDispatchContext?.selectedCycleId,
      selectedSo?.currentCycleId,
    ],
  );

  const noQtyFinalizedQtyThisCycleForCurrentItem = React.useMemo(() => {
    if (!selectedSo || selectedSo.orderType !== "NO_QTY" || !currentLine) return 0;
    const cyc = noQtySelectedCycleIdResolved;
    if (cyc == null) return 0;
    return (ledgerRows || [])
      .filter(
        (r) =>
          Number(r.soId) === Number(selectedSo.id) &&
          Number(r.itemId) === Number(currentLine.itemId) &&
          r.reversalOfId == null &&
          r.workflowStatus === "LOCKED" &&
          Number(r.cycleId ?? 0) === Number(cyc),
      )
      .reduce((s, r) => s + safeNum(r.dispatchedQty), 0);
  }, [selectedSo, currentLine, ledgerRows, noQtySelectedCycleIdResolved]);

  const noQtyPartialAfterFirstDispatchThisCycle = React.useMemo(() => {
    if (!selectedSo || selectedSo.orderType !== "NO_QTY") return false;
    if (!(noQtyFinalizedQtyThisCycleForCurrentItem > 1e-9)) return false;
    return safeNum(currentDispatchableQty) > 1e-9;
  }, [selectedSo, noQtyFinalizedQtyThisCycleForCurrentItem, currentDispatchableQty]);

  const remainingSoLine = currentLine ? confirmedBacklogQty(currentLine) : 0;

  const currentRegularReadiness =
    selectedSo && currentLine ? effectiveRegularDispatchReadiness(selectedSo, currentLine) : null;
  const needsPartialDispatchAck = currentRegularReadiness === "PARTIAL_AVAILABLE";

  const noQtySelectedNextAction =
    selectedSo?.orderType === "NO_QTY" && currentLine
      ? noQtyDispatchNextActionMessage({
          ls: currentLine,
          dispatchable: noQtyTotalHeadroomForCurrentItem ?? currentDispatchableBase,
          existingDraftQty,
          headroomToPrepare,
        })
      : null;

  const qtyInputDisabled =
    dispatching ||
    dispatchReadOnly ||
    reopenedPreparedDraftMode ||
    !currentLine ||
    readyToShip <= 1e-9 ||
    noQtyBlocked;

  const canNoQtyDispatchNow = Boolean(
    selectedSo?.orderType === "NO_QTY" &&
      !qtyInputDisabled &&
      dispatchQtyValid &&
      dispatchQtyParsed != null &&
      dispatchQtyParsed > 1e-9 &&
      dispatchQtyParsed <= headroomToPrepare + 1e-6,
  );

  const dispatchQtyHintPrimary =
    noQtyBlocked && selectedSo?.orderType === "NO_QTY"
      ? "Cannot dispatch: wait for cycle data to load, or reopen the sales order if no active cycle."
      : currentLine && readyToShip > 1e-9
        ? isRegularNormalSalesOrder(selectedSo)
          ? needsPartialDispatchAck
            ? existingDraftQty > 1e-9
              ? `Prepared draft: ${fmtDispatchQty(existingDraftQty)}.`
              : null
            : `You can prepare up to ${fmtDispatchQty(Math.min(readyToShip, remainingSoLine))} (ready to dispatch — ${fmtDispatchQty(
                remainingSoLine,
              )} pending on order).${existingDraftQty > 1e-9 ? ` Draft already prepared: ${fmtDispatchQty(existingDraftQty)}.` : ""}`
          : selectedSo?.orderType === "NO_QTY"
            ? `You may ship up to ${fmtDispatchQty(readyToShip)} when ready (optional).${
                existingDraftQty > 1e-9 ? ` Prepared draft: ${fmtDispatchQty(existingDraftQty)}.` : ""
              }`
            : `Max prepare now: ${fmtDispatchQty(readyToShip)}${
                existingDraftQty > 1e-9 ? ` · Prepared draft: ${fmtDispatchQty(existingDraftQty)}` : ""
              }`
        : currentLine && selectedSo?.orderType === "NO_QTY" && currentDispatchableBase <= 1e-9
          ? noQtySelectedNextAction
          : currentLine && remainingSoLine > 1e-9
            ? (currentLine.dispatchBlockedReason?.trim() ??
                (isRegularNormalSalesOrder(selectedSo)
                  ? "Nothing can be prepared on this line yet (see limits above)."
                  : "Nothing is ready to ship on this line yet."))
            : null;

  React.useEffect(() => {
    if (selectedSo?.orderType !== "NO_QTY" || !currentLine || dispatchQtyParsed == null || !(dispatchQtyParsed > 1e-9)) {
      setNoQtyFifoPreviewLine(null);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await apiFetch<{
            allocation?: { cycleNo: number; qty: number | string }[];
            wouldExceedTotal?: boolean;
            gateBlockedReason?: string | null;
            totalAvailable?: number;
          }>("/api/dispatch/dispatches/no-qty-fifo-preview", {
            method: "POST",
            body: JSON.stringify({
              soId: selectedSo.id,
              itemId: currentLine.itemId,
              dispatchedQty: dispatchQtyParsed,
            }),
            signal: ac.signal,
          });
          if (ac.signal.aborted) return;
          if (r.gateBlockedReason) {
            setNoQtyFifoPreviewLine(r.gateBlockedReason);
            return;
          }
          if (r.wouldExceedTotal) {
            setNoQtyFifoPreviewLine(
              `Exceeds total available (${fmtDispatchQty(Number(r.totalAvailable ?? 0))}) across cycles.`,
            );
            return;
          }
          const alloc = r.allocation ?? [];
          if (!alloc.length) {
            setNoQtyFifoPreviewLine(null);
            return;
          }
          const parts = alloc.map((a) => `${fmtDispatchQty(Number(a.qty))} from Cycle ${a.cycleNo}`);
          setNoQtyFifoPreviewLine(`This dispatch will use ${parts.join(" and ")}.`);
        } catch {
          if (!ac.signal.aborted) setNoQtyFifoPreviewLine(null);
        }
      })();
    }, 450);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [selectedSo?.id, selectedSo?.orderType, currentLine?.itemId, dispatchQtyParsed]);

  async function onReverseDispatch(dispatchId: number, maxQty: number, _opts?: { exported?: boolean }) {
    const reverseQty = (() => {
      const qtyStr = window.prompt(`Quantity to reverse (max ${maxQty})`, String(maxQty));
      if (qtyStr == null) return null;
      const q = Number(qtyStr);
      if (!Number.isFinite(q) || q <= 0) {
        setError("Reverse quantity must be a positive number");
        return null;
      }
      return q;
    })();
    if (reverseQty == null) return;
    const reasonIn = window.prompt("Reversal reason (required)", "");
    if (reasonIn == null) return;
    const reason = reasonIn.trim();
    if (!reason) {
      setError("Reversal reason is required.");
      return;
    }
    setError(null);
    setReversingId(dispatchId);
    try {
      await apiFetch("/api/dispatch/reverse", {
        method: "POST",
        body: JSON.stringify({ dispatchId, reverseQty, reason }),
      });
      setDispatchInfo(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reverse failed");
    } finally {
      setReversingId(null);
    }
  }


  async function onLockDispatch(dispatchId: number) {
    // Legacy path (ledger button). Keep for compatibility but route through the unified finalize helper.
    await finalizeDispatchOnce(dispatchId, { clearDraftMode: false });
  }

  const finalizeInFlightRef = React.useRef<Set<number>>(new Set());

  async function finalizeDispatchOnce(
    dispatchId: number,
    opts: { clearDraftMode: boolean },
  ) {
    const id = Number(dispatchId);
    if (!(Number.isFinite(id) && id > 0)) return;
    if (finalizeInFlightRef.current.has(id)) return;
    finalizeInFlightRef.current.add(id);
    const idempotencyKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `finalize-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setError(null);
    setLockingId(id);
    try {
      // Unified finalize path: use /lock for both normal ledger and reopened-draft UX.
      await apiFetch(`/api/dispatch/dispatches/${id}/lock`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({}),
      });
      toast.showSuccess("Dispatch finalized — stock posted.");
      setError(null);
      setDispatchInfo("Dispatch finalized — stock posted.");
      setSalesBillStepDispatchId(id);
      if (selectedSo?.orderType === "NO_QTY") setNoQtyLastFinalizedDispatchId(id);
      window.requestAnimationFrame(() => {
        guidedTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      if (opts.clearDraftMode) {
        // Clear draft mode + return to normal dispatch state.
        setReopenedPreparedDraft(null);
        setReopenFallbackSoRow(null);
        const params = new URLSearchParams(sp);
        params.delete("draftDispatchId");
        navigate(`/dispatch?${params.toString()}`, { replace: true });
      }
      await refresh();
      window.requestAnimationFrame(() => {
        if (!prefersFinePointer()) return;
        fgLineSelectRef.current?.focus({ preventScroll: true });
      });
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Finalize failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setLockingId(null);
      finalizeInFlightRef.current.delete(id);
    }
  }

  async function onFinalizeDraftDispatch(dispatchId: number) {
    await finalizeDispatchOnce(dispatchId, { clearDraftMode: true });
  }

  async function onDeleteDraft(dispatchId: number) {
    if (!window.confirm("Remove this prepared dispatch? Stock has not been posted yet.")) return;
    setError(null);
    setDeletingId(dispatchId);
    try {
      await apiFetch(`/api/dispatch/dispatches/${dispatchId}`, { method: "DELETE" });
      setDispatchInfo("Prepared dispatch removed.");
      if (reopenedPreparedDraftMode && reopenedPreparedDraft?.id === dispatchId) {
        setReopenedPreparedDraft(null);
        setReopenFallbackSoRow(null);
        // Clear draftDispatchId from URL and return to normal dispatch state.
        const params = new URLSearchParams(sp);
        params.delete("draftDispatchId");
        navigate(`/dispatch?${params.toString()}`, { replace: true });
        toast.showSuccess("Prepared dispatch removed.");
      }
      setSalesBillStepDispatchId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function onCreateSalesBillFromDispatch(dispatchId: number) {
    setError(null);
    try {
      const res = await apiFetch<{ id: number }>(`/api/sales-bills/from-dispatch/${dispatchId}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setSalesBillStepDispatchId(null);
      navigate(`/sales-bills/${res.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create sales bill.";
      setError(msg);
      alert(msg);
    }
  }

  async function onDispatch() {
    if (dispatchSubmitLockRef.current || dispatching) return;
    if (!currentLine) return;
    dispatchSubmitLockRef.current = true;
    setError(null);
    setDispatchInfo(null);
    if (!dispatchQtyValid || dispatchQtyParsed == null) {
      if (isPartialMode) {
        setError("Enter dispatch quantity");
      }
      dispatchSubmitLockRef.current = false;
      return;
    }
    if (dispatchQtyParsed > currentDispatchableQty + 1e-6) {
      setError("Exceeds dispatchable quantity");
      dispatchSubmitLockRef.current = false;
      return;
    }
    const avail = safeNum(currentDispatchableQty);
    if (avail > 1e-9 && dispatchQtyParsed < DISPATCH_LOW_QTY_WARN_RATIO * avail - 1e-9) {
      const remainingUsable = Math.max(0, safeNum(getUsableStock(currentLine)) - dispatchQtyParsed);
      const proceed = window.confirm(
        `You are dispatching only ${fmtDispatchQty(dispatchQtyParsed)} out of ${fmtDispatchQty(avail)} available units.\n\n` +
          `Remaining ${fmtDispatchQty(Math.max(0, avail - dispatchQtyParsed))} units will stay in Usable stock and may reduce future requirement planning.\n\n` +
          `After dispatch, remaining usable (preview): ${fmtDispatchQty(remainingUsable)}.\n\nContinue?`,
      );
      if (!proceed) {
        dispatchSubmitLockRef.current = false;
        return;
      }
    }
    setDispatching(true);
    const idempotencyKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `dispatch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const dispatchBody =
        selectedSo?.orderType === "NO_QTY"
          ? { soId, itemId: currentLine.itemId, dispatchedQty: dispatchQtyParsed, autoAllocateAcrossCycles: true }
          : { soId, itemId: currentLine.itemId, dispatchedQty: dispatchQtyParsed };
      const prepRes = await apiFetch<{
        allocation?: { cycleNo: number; qty: number | string }[];
        autoAllocated?: boolean;
      }>("/api/dispatch/dispatches", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(dispatchBody),
      });
      const alloc = prepRes?.allocation;
      if (selectedSo?.orderType === "NO_QTY" && Array.isArray(alloc) && alloc.length > 0) {
        const totalAlloc = alloc.reduce((s, a) => s + safeNum(a.qty), 0);
        const lines = alloc.map((a) => `Cycle ${a.cycleNo} → ${fmtDispatchQty(Number(a.qty))}`);
        const footer =
          alloc.length > 1 ? "Finalize each prepared row to post stock." : "Finalize to post stock.";
        setDispatchInfo([...lines, `Total → ${fmtDispatchQty(totalAlloc)}`, footer].join("\n"));
      } else {
        setDispatchInfo("Prepared dispatch saved. Finalize to post stock.");
      }
      setSalesBillStepDispatchId(null);
      const list = await loadSalesOrders();
      await loadLedger();
      const ready = buildReadySorted(list);
      let next: { so: SoRow; ls: LineStat } | null = null;
      if (ready.length === 1) {
        next = ready[0];
      } else if (ready.length > 1) {
        const i = ready.findIndex((x) => x.so.id === soId && x.ls.lineId === salesOrderLineId);
        if (i >= 0 && i < ready.length - 1) next = ready[i + 1];
        else if (i === ready.length - 1) next = ready[0];
        else next = ready[0];
      }
      if (next) {
        selectLineFromBacklog(next.so, next.ls);
      } else {
        setSoId(0);
        setSalesOrderLineId(0);
        resetDispatchQty();
      }
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "IDEMPOTENCY_IN_PROGRESS") {
        setDispatchInfo(
          "This dispatch is already being processed. Please wait a few seconds for it to finish — the list will refresh automatically. Avoid clicking again right away.",
        );
      } else {
        setError(e instanceof Error ? e.message : "Failed");
      }
    } finally {
      dispatchSubmitLockRef.current = false;
      setDispatching(false);
    }
  }

  /** Partial dispatch only (isPartialMode): qty strictly between 0 and max (not equal to full headroom — use Dispatch Full). */
  const partialDispatchQtySubmit = Boolean(
    isPartialMode &&
      !dispatchReadOnly &&
      !dispatching &&
      !noQtyBlocked &&
      selectableLines.length > 0 &&
      currentLine &&
      readyToShip > 1e-9 &&
      dispatchQtyValid &&
      dispatchQtyParsed != null &&
      dispatchQtyParsed > 1e-9 &&
      dispatchQtyParsed < headroomToPrepare - 1e-6 &&
      dispatchQtyParsed <= currentDispatchableQty + 1e-6 &&
      (!needsPartialDispatchAck || normalPartialDispatchAck),
  );

  const qtyMatchesFullHeadroom =
    dispatchQtyValid &&
    dispatchQtyParsed != null &&
    headroomToPrepare > 1e-9 &&
    Math.abs(dispatchQtyParsed - headroomToPrepare) <= 1e-6;

  const canDispatchFull = Boolean(
    !dispatchReadOnly &&
      !dispatching &&
      !noQtyBlocked &&
      selectableLines.length > 0 &&
      currentLine &&
      headroomToPrepare > 1e-9 &&
      !qtyInputDisabled &&
      (!needsPartialDispatchAck || normalPartialDispatchAck),
  );

  async function onDispatchFullPrepare() {
    if (dispatchSubmitLockRef.current || dispatching) return;
    if (!canDispatchFull) return;
    const qty = headroomToPrepare;
    if (!(qty > 1e-9)) return;
    flushSync(() => {
      setDispatchQtyStr(String(qty));
    });
    shortcutHints.markFieldShortcutUsed("dispatchPrepare");
    await onDispatch();
  }

  const dispatchSoBind = shortcutHints.bindField("dispatchSo", {
    onChange: (e) => {
      const v = (e.target as HTMLSelectElement).value;
      setError(null);
      setDispatchInfo(null);
      setSoId(v === "" ? 0 : Number(v));
    },
  });
  const dispatchFgBind = shortcutHints.bindField("dispatchFg", {
    onChange: (e) => {
      const v = (e.target as HTMLSelectElement).value;
      const lid = v === "" ? 0 : Number(v);
      const so = displayRows.find((r) => r.id === soId);
      setError(null);
      setDispatchInfo(null);
      if (lid === 0) {
        setSalesOrderLineId(0);
        resetDispatchQty();
        return;
      }
      const ls = (so?.lineStats ?? []).find((x) => x.lineId === lid);
      if (so && ls) {
        selectLineFromBacklog(so, ls);
      } else {
        setSalesOrderLineId(lid);
      }
    },
  });
  const dispatchQtyBind = shortcutHints.bindField("dispatchQty", {
    onChange: (e) => setDispatchQtyStr((e.target as HTMLInputElement).value),
  });

  const shortcutFlagsRef = React.useRef({ canPrepareSubmit: false, canPrepareFull: false });
  shortcutFlagsRef.current = { canPrepareSubmit: partialDispatchQtySubmit, canPrepareFull: canDispatchFull };
  const dispatchActionRef = React.useRef(onDispatch);
  dispatchActionRef.current = onDispatch;
  const dispatchFullPrepareRef = React.useRef(onDispatchFullPrepare);
  dispatchFullPrepareRef.current = onDispatchFullPrepare;
  const markShortcutRef = React.useRef(shortcutHints.markFieldShortcutUsed);
  markShortcutRef.current = shortcutHints.markFieldShortcutUsed;

  React.useEffect(() => {
    function onGlobalKey(ev: KeyboardEvent) {
      if (ev.defaultPrevented) return;

      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "Digit1") {
        ev.preventDefault();
        markShortcutRef.current("dispatchSo");
        soSelectRef.current?.focus();
        return;
      }
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "Digit2") {
        ev.preventDefault();
        markShortcutRef.current("dispatchFg");
        fgLineSelectRef.current?.focus();
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyS") {
        ev.preventDefault();
        if (shortcutFlagsRef.current.canPrepareSubmit) {
          markShortcutRef.current("dispatchPrepare");
          void dispatchActionRef.current();
        } else if (shortcutFlagsRef.current.canPrepareFull) {
          markShortcutRef.current("dispatchPrepare");
          void dispatchFullPrepareRef.current();
        }
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        if (shortcutFlagsRef.current.canPrepareSubmit) {
          markShortcutRef.current("dispatchPrepare");
          void dispatchActionRef.current();
        } else if (shortcutFlagsRef.current.canPrepareFull) {
          markShortcutRef.current("dispatchPrepare");
          void dispatchFullPrepareRef.current();
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

  const ledgerOffset = (ledgerPage - 1) * LEDGER_PAGE_SIZE;
  const ledgerLastPage = Math.max(1, Math.ceil(ledgerTotal / LEDGER_PAGE_SIZE) || 1);
  const canLedgerPrev = ledgerPage > 1;
  const canLedgerNext = ledgerTotal > 0 && ledgerPage * LEDGER_PAGE_SIZE < ledgerTotal;
  const ledgerRangeStart = ledgerTotal === 0 ? 0 : ledgerOffset + 1;
  const ledgerRangeEnd = ledgerOffset + ledgerRows.length;
  const ledgerInfoText =
    ledgerTotal === 0
      ? ledgerDateFrom || ledgerDateTo
        ? "No dispatch records match the selected dates."
        : "No dispatch records found."
      : ledgerPage === 1 && !ledgerDateFrom && !ledgerDateTo
        ? `Showing the latest ${ledgerRows.length} of ${ledgerTotal} records (newest first).`
        : `Showing ${ledgerRangeStart}–${ledgerRangeEnd} of ${ledgerTotal}${ledgerDateFrom || ledgerDateTo ? " (date filter on)" : ""}.`;

  const hasPreparedDraftLedger = ledgerRows.some(
    (r) => r.workflowStatus === "UNLOCKED" && r.reversalOfId == null,
  );
  const hasUnexportedSalesBillsInHistory = ledgerRows.some(
    (r) => r.workflowStatus === "LOCKED" && r.reversalOfId == null && r.salesBillExists === true && r.salesBillIsExported !== true,
  );

  /** Latest finalized REGULAR dispatch on the current ledger page with no reversals and no sales bill yet. */
  const latestRegularUnbilledDispatchId = React.useMemo(() => {
    const eps = 1e-9;
    const reversedSumByForwardId = new Map<number, number>();
    for (const r of ledgerRows) {
      if (r.reversalOfId == null) continue;
      const fwdId = Number(r.reversalOfId);
      if (!Number.isFinite(fwdId) || fwdId <= 0) continue;
      const qty = Math.abs(Number(r.dispatchedQty || 0));
      reversedSumByForwardId.set(fwdId, (reversedSumByForwardId.get(fwdId) || 0) + qty);
    }
    const candidates = ledgerRows.filter((r) => {
      if (r.reversalOfId != null) return false;
      if (r.workflowStatus !== "LOCKED") return false;
      if (!Number.isFinite(Number(r.dispatchedQty)) || Number(r.dispatchedQty) <= eps) return false;
      if (!isRegularNormalLedgerSoOrderType(r.soOrderType)) return false;
      if (r.salesBillExists === true) return false;
      const rev = reversedSumByForwardId.get(r.id) || 0;
      if (rev > eps) return false;
      return true;
    });
    if (!candidates.length) return null;
    const sorted = [...candidates].sort(
      (a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) || Number(b.id) - Number(a.id),
    );
    return sorted[0]!.id;
  }, [ledgerRows]);

  const bestContext = React.useMemo(
    () => {
      const pick = pickBestDispatchContext({ rows: displayRows, ledgerRows });
      console.debug("[DISPATCH_UI_TRACE][picker]", {
        rowsCount: displayRows.length,
        ledgerRowsCount: ledgerRows.length,
        so26InRows: displayRows.some((r) => Number(r.id) === 26),
        pick,
      });
      return pick;
    },
    [displayRows, ledgerRows],
  );
  const hasActionableDraft = bestContext?.kind === "ACTIONABLE_DRAFT" || reopenedPreparedDraftMode;
  const hasDispatchableContext = bestContext?.kind === "DISPATCHABLE_CONTEXT";
  console.debug("[DISPATCH_UI_TRACE][flags]", {
    hasActionableDraft,
    hasDispatchableContext,
    reopenedPreparedDraftMode,
    soId,
    salesOrderLineId,
    noQtySelectedCycleId,
  });

  /** Show workbench when drafts, dispatchable headroom (including NORMAL usable-backed), or any SO rows are loaded. */
  const showMainDispatchUi = hasActionableDraft || hasDispatchableContext || displayRows.length > 0;

  // Page load / refresh: validate current selection; auto-repair via picker when invalid or empty.
  const autoOpenedDraftRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (reopenedPreparedDraftMode) return;
    if (!bestContext) return;

    if (bestContext.kind === "ACTIONABLE_DRAFT") {
      if (autoOpenedDraftRef.current === bestContext.draftDispatchId) return;
      autoOpenedDraftRef.current = bestContext.draftDispatchId;
      void openDraftById(bestContext.draftDispatchId);
      return;
    }

  const valid = isCurrentDispatchSelectionStillValid({
      rows: displayRows,
      soId,
      salesOrderLineId,
      noQtySelectedCycleId,
    });

    if (!valid) {
      const so = displayRows.find((r) => Number(r.id) === Number(bestContext.soId));
      const ls = so?.lineStats?.find((l) => Number(l.lineId) === Number(bestContext.lineId));
      if (so && ls) {
        if (so.orderType === "NO_QTY") setNoQtySelectedCycleId(bestContext.cycleId);
        selectLineFromBacklog(so, ls);
      }
    }
  }, [
    bestContext,
    reopenedPreparedDraftMode,
    displayRows,
    ledgerRows,
    soId,
    salesOrderLineId,
    noQtySelectedCycleId,
    selectLineFromBacklog,
  ]);

  // TEMP DEBUG (remove after stabilization)
  React.useEffect(() => {
    console.debug("[DISPATCH_DEBUG] showMainDispatchUi", {
      displayRowsLength: displayRows.length,
      soId,
      hasPreparedDraftLedger,
      result: showMainDispatchUi,
    });
  }, [showMainDispatchUi, displayRows.length, fromNoQtySo, focusSoIdValid, soId, selectedSo?.id, hasPreparedDraftLedger]);

  // TEMP DEBUG (remove after stabilization)
  React.useEffect(() => {
    const soOptionExists = displayRows.some((r) => Number(r.id) === Number(soId));
    const itemOptionExists = selectableLines.some((l) => Number(l.lineId) === Number(salesOrderLineId));
    console.debug("[DISPATCH_DEBUG] visibleControlValues", {
      soId,
      soOptionExists,
      salesOrderLineId,
      itemOptionExists,
      currentLineId: currentLine?.lineId ?? null,
      noQtySelectedCycleId,
      selectableLinesCount: selectableLines.length,
      draftDispatchId,
      reopenedPreparedDraftMode,
      reopenedPreparedDraftId: reopenedPreparedDraft?.id ?? null,
    });
  }, [soId, salesOrderLineId, noQtySelectedCycleId, selectableLines.length, currentLine?.lineId, displayRows, selectableLines]);

  const noQtyLineEntries = React.useMemo(() => {
    if (!fromNoQtySo) return null;
    const flat = displayRows
      .filter((so) => so.orderType === "NO_QTY")
      .flatMap((so) => (so.lineStats ?? []).map((ls) => ({ so, ls })));
    const filtered = flat.filter(({ so, ls }) => {
      const cycleId = normalizePositiveCycleId(so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId);
      // NO_QTY: do not treat cycle-remaining as a limiter; show lines when something is dispatchable now.
      return computeDispatchableNow({ so, ls, cycleIdOverride: cycleId }) > 1e-9;
    });
    return filtered.length ? filtered : null;
  }, [fromNoQtySo, displayRows]);

  const guidedNoQtyRequested = fromNoQtySo && focusSoIdValid && focusItemIdValid && focusCycleIdValid;
  const guidedNoQtyCanResolve =
    guidedNoQtyRequested &&
    selectedSo?.id === focusSoId &&
    selectedSo?.orderType === "NO_QTY" &&
    (selectedSo?.lineStats ?? []).some((l) => Number(l.itemId) === Number(focusItemId)) &&
    (noQtyCyclesLoading
      ? true
      : noQtyStrictCycleGuidance
        ? noQtyCycles.some((c) => c.cycleId === focusCycleId)
        : noQtyCycles.length > 0);
  const guidedNoQtyResolved =
    guidedNoQtyCanResolve &&
    currentLine?.itemId != null &&
    Number(currentLine.itemId) === Number(focusItemId) &&
    (!noQtyStrictCycleGuidance || normalizePositiveCycleId(noQtySelectedCycleId) === Number(focusCycleId));
  const guidedNoQtyLockUi = guidedNoQtyCanResolve && !reopenedPreparedDraftMode;

  // Guided NO_QTY: make sure ledger includes the current cycle context (ignore date filters),
  // so the operator doesn't have to hunt for finalize/billing actions.
  React.useEffect(() => {
    if (!guidedNoQtyResolved) return;
    void loadLedger({ soId: focusSoId, cycleId: focusCycleId, ignoreDateFilters: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedNoQtyResolved, focusSoId, focusCycleId]);

  const guidedTopRef = React.useRef<HTMLDivElement | null>(null);

  const guidedLedgerContext = React.useMemo(() => {
    if (!guidedNoQtyResolved || !selectedSo || !currentLine) return null;
    const cycleId = Number(focusCycleId);
    const selectedCycle = normalizePositiveCycleId(
      noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId,
    );
    const rows = ledgerRows.filter(
      (r) =>
        r.soId === selectedSo.id &&
        r.itemId === currentLine.itemId &&
        !r.reversalOfId &&
        // CONFIRMED: cycle-wise status. Never use other-cycle finalized dispatch to mark current cycle as completed.
        Number(r.cycleId ?? 0) === Number(selectedCycle ?? cycleId),
    );
    const preparedDraft = rows.find((r) => r.workflowStatus === "UNLOCKED");
    const finalized = rows.filter((r) => r.workflowStatus === "LOCKED");
    const latestFinalized =
      finalized.length === 0
        ? null
        : finalized
            .slice()
            .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) || Number(b.id) - Number(a.id))[0];
    return { rows, preparedDraft, latestFinalized };
  }, [guidedNoQtyResolved, selectedSo, currentLine, focusCycleId, ledgerRows, noQtySelectedCycleId]);

  const primaryFinalizeDraftId = React.useMemo(() => {
    if (reopenedPreparedDraft?.id) return reopenedPreparedDraft.id;
    if (guidedLedgerContext?.preparedDraft?.id) return guidedLedgerContext.preparedDraft.id;
    if (!selectedSo?.dispatch?.length || !currentLine) return null;
    if (selectedSo.orderType === "NO_QTY") {
      const drafts = selectedSo.dispatch.filter(
        (x) =>
          x.itemId === currentLine.itemId &&
          !x.reversalOfId &&
          x.workflowStatus === "UNLOCKED",
      );
      if (!drafts.length) return null;
      drafts.sort((a, b) => {
        const ca = normalizePositiveCycleId(a.cycleId) ?? 999999999;
        const cb = normalizePositiveCycleId(b.cycleId) ?? 999999999;
        return ca - cb || Number(a.id) - Number(b.id);
      });
      return drafts[0]?.id ?? null;
    }
    const d = soLedgerDispatches.find(
      (x) => x.itemId === currentLine.itemId && !x.reversalOfId && x.workflowStatus === "UNLOCKED",
    );
    return d?.id ?? null;
  }, [reopenedPreparedDraft, guidedLedgerContext, selectedSo, currentLine, soLedgerDispatches]);

  const guidedBillAction = React.useMemo(() => {
    const latest = guidedLedgerContext?.latestFinalized ?? null;
    if (!latest) return null;
    const billExists = latest.salesBillExists === true;
    const billExported = latest.salesBillIsExported === true;
    // Dispatch screen is operational-only; do not surface billing/export status here.
    if (billExported) return null;
    if (billExists && latest.salesBillId != null) return null;
    if (!billExists) return { kind: "CREATE" as const, dispatchId: latest.id };
    return null;
  }, [guidedLedgerContext]);

  const topStripSalesBillNext =
    !guidedNoQtyLockUi &&
    fromNoQtySo &&
    focusSoIdValid &&
    noQtyFlowState?.nextAction === "SALES_BILL" &&
    selectedSo?.orderType !== "NO_QTY";

  const dqEps = 1e-9;
  const showCompactDispatchStrip =
    showMainDispatchUi &&
    selectedSo != null &&
    currentLine != null &&
    (selectedSo.orderType === "NO_QTY" || !topStripSalesBillNext);

  const noQtyPreviousDispatchBillWarning = React.useMemo(() => {
    if (selectedSo?.orderType !== "NO_QTY") return false;
    const sel = normalizePositiveCycleId(
      noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId,
    );
    return ledgerRows.some((r) => {
      if (r.soId !== selectedSo.id || r.reversalOfId) return false;
      if (r.workflowStatus !== "LOCKED") return false;
      const c = normalizePositiveCycleId(r.cycleId);
      if (c == null || sel == null || c === sel) return false;
      if (r.salesBillExists === true && r.salesBillIsExported === true) return false;
      return true;
    });
  }, [selectedSo, noQtySelectedCycleId, ledgerRows]);

  const stripDispatchingNow =
    showCompactDispatchStrip && currentLine
      ? existingDraftQty > dqEps
        ? fmtDispatchQty(existingDraftQty)
        : dispatchQtyValid && dispatchQtyParsed != null
          ? fmtDispatchQty(dispatchQtyParsed)
          : "—"
      : "—";
  const stripReady = showCompactDispatchStrip && currentLine ? fmtDispatchQty(currentDispatchableQty) : "—";

  const stripShowFinalize = Boolean(
    showCompactDispatchStrip && primaryFinalizeDraftId != null && !dispatchReadOnly,
  );

  const noQtyShowCompletedSalesBillNext =
    selectedSo?.orderType === "NO_QTY" && noQtyLastFinalizedDispatchId != null && !stripShowFinalize;

  /** Prepared draft exists for current context: prioritize finalize UX over open-lines / cycle messaging. */
  const finalizePrepDraftMode = Boolean(
    showMainDispatchUi &&
      selectedSo &&
      currentLine &&
      primaryFinalizeDraftId != null &&
      existingDraftQty > dqEps,
  );

  React.useEffect(() => {
    if (selectedSo?.orderType !== "NO_QTY") return;
    if (reopenedPreparedDraftMode || finalizePrepDraftMode) return;
    const key = `${soId}:${salesOrderLineId}`;
    if (key === lastNoQtyDispatchPrefillKeyRef.current && lastNoQtyDispatchPrefillKeyRef.current !== "") return;
    lastNoQtyDispatchPrefillKeyRef.current = key;
    if (salesOrderLineId === 0 || !currentLine || !selectedSo) {
      resetDispatchQty();
      return;
    }
    const hr = computeNoQtyTotalPrepareHeadroomForItem(selectedSo, currentLine.itemId);
    if (hr > 1e-9) setDispatchQtyStr(String(hr));
    else resetDispatchQty();
  }, [
    selectedSo,
    soId,
    salesOrderLineId,
    currentLine,
    reopenedPreparedDraftMode,
    finalizePrepDraftMode,
    resetDispatchQty,
    setDispatchQtyStr,
  ]);

  /**
   * Prepared-draft action card: show when a draft exists for this context and operator can finalize/delete.
   * Do not require currentLine — NO_QTY reopen can temporarily clear line selection when computeDispatchableNow is 0 on all lines.
   * URL draftDispatchId + reopenedPreparedDraft must match (reopenedPreparedDraftMode).
   */
  const showPreparedDispatchActionCard = Boolean(
    showMainDispatchUi &&
      selectedSo &&
      !dispatchReadOnly &&
      primaryFinalizeDraftId != null &&
      (finalizePrepDraftMode || reopenedPreparedDraftMode),
  );

  /** Next billing step: in-session finalize sets salesBillStepDispatchId; refresh uses ledger + guided CREATE or SO/cycle match. */
  const billingTargetDispatchId = React.useMemo(() => {
    if (dispatchReadOnly || !selectedSo) return null;
    if (salesBillStepDispatchId != null) return salesBillStepDispatchId;
    if (guidedBillAction?.kind === "CREATE") return guidedBillAction.dispatchId;

    const cid = normalizePositiveCycleId(
      noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId,
    );

    const pickLatestLedgerDispatchId = (rows: typeof ledgerRows): number | null => {
      const forwards = rows.filter((r) => !r.reversalOfId && r.workflowStatus === "LOCKED" && r.salesBillExists !== true);
      if (forwards.length === 0) return null;
      return [...forwards].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) || b.id - a.id)[0]!.id;
    };

    if (currentLine) {
      const candidates = ledgerRows.filter((r) => {
        if (r.soId !== selectedSo.id || r.itemId !== currentLine.itemId || r.reversalOfId || r.workflowStatus !== "LOCKED")
          return false;
        if (r.salesBillExists === true) return false;
        if (selectedSo.orderType === "NO_QTY" && cid != null && Number(r.cycleId ?? 0) !== cid) return false;
        return true;
      });
      if (candidates.length === 0) return null;
      return [...candidates].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) || b.id - a.id)[0]!.id;
    }

    // NO_QTY: finalize clears line selection when nothing is dispatchable — still pick a billing target from the ledger (Regular SO unchanged).
    if (selectedSo.orderType === "NO_QTY") {
      const forSo = ledgerRows.filter((r) => r.soId === selectedSo.id);
      const scoped =
        cid != null ? forSo.filter((r) => Number(r.cycleId ?? 0) === cid) : forSo;
      const strictId = pickLatestLedgerDispatchId(scoped);
      if (strictId != null) return strictId;
      if (cid != null) {
        const relaxedId = pickLatestLedgerDispatchId(forSo);
        if (relaxedId != null) return relaxedId;
      }
      return null;
    }

    return null;
  }, [
    dispatchReadOnly,
    selectedSo,
    salesBillStepDispatchId,
    guidedBillAction,
    currentLine,
    ledgerRows,
    noQtySelectedCycleId,
  ]);

  const billingTargetLedgerRow = React.useMemo(
    () =>
      billingTargetDispatchId != null ? ledgerRows.find((r) => r.id === billingTargetDispatchId) ?? null : null,
    [billingTargetDispatchId, ledgerRows],
  );

  const showDispatchCompletedBillingCard = Boolean(
    showMainDispatchUi &&
      selectedSo &&
      !dispatchReadOnly &&
      billingTargetDispatchId != null &&
      primaryFinalizeDraftId == null &&
      !showPreparedDispatchActionCard &&
      // NO_QTY: dispatch completion is cycle-wise only (other cycle completion must not hide Dispatch Now).
      (selectedSo.orderType !== "NO_QTY" || safeNum(currentDispatchableQty) <= 1e-9),
  );

  /** Finalized NO_QTY dispatch but billing dispatch id could not be tied to ledger/session (cycle mismatch, stale selection). */
  const showDispatchCompletedBillingFallback = Boolean(
    showMainDispatchUi &&
      selectedSo?.orderType === "NO_QTY" &&
      !dispatchReadOnly &&
      billingTargetDispatchId == null &&
      primaryFinalizeDraftId == null &&
      !showPreparedDispatchActionCard &&
      safeNum(currentDispatchableQty) <= 1e-9 &&
      (noQtyLastFinalizedDispatchId != null ||
        ledgerRows.some(
          (r) =>
            r.soId === selectedSo.id &&
            !r.reversalOfId &&
            r.workflowStatus === "LOCKED" &&
            r.salesBillExists !== true,
        )),
  );

  const dispatchCompletedDocLabel =
    billingTargetDispatchId != null
      ? displayDispatchNo(billingTargetDispatchId, billingTargetLedgerRow?.docNo ?? null)
      : "";
  const dispatchCompletedQtyLabel =
    billingTargetLedgerRow != null ? fmtDispatchQty(safeNum(billingTargetLedgerRow.dispatchedQty)) : "—";
  const dispatchCompletedSubtitle =
    billingTargetDispatchId != null
      ? isRegularNormalSalesOrder(selectedSo)
        ? "Dispatch completed. Create sales bill for this dispatch."
        : `${dispatchCompletedDocLabel} for ${dispatchCompletedQtyLabel} qty is finalized.`
      : "";

  const primaryDraftLedgerRow = React.useMemo(
    () =>
      primaryFinalizeDraftId != null ? ledgerRows.find((r) => r.id === primaryFinalizeDraftId) ?? null : null,
    [ledgerRows, primaryFinalizeDraftId],
  );

  const preparedDispatchDocLabel =
    primaryFinalizeDraftId != null
      ? displayDispatchNo(primaryFinalizeDraftId, primaryDraftLedgerRow?.docNo ?? reopenedPreparedDraft?.docNo ?? null)
      : "";

  const preparedDispatchQtyLabel = (() => {
    if (existingDraftQty > dqEps) return fmtDispatchQty(existingDraftQty);
    if (primaryDraftLedgerRow) return fmtDispatchQty(safeNum(primaryDraftLedgerRow.dispatchedQty));
    if (reopenedPreparedDraft?.qty) return fmtDispatchQty(safeNum(reopenedPreparedDraft.qty));
    return "—";
  })();

  const stripShowGuidedBill =
    showCompactDispatchStrip &&
    guidedNoQtyResolved &&
    guidedLedgerContext?.latestFinalized &&
    guidedBillAction != null &&
    !stripShowFinalize;

  const dispatchGuidedBillActions =
    Boolean(
      stripShowGuidedBill &&
        guidedBillAction &&
        (guidedBillAction.kind === "CREATE" || guidedBillAction.kind === "OPEN") &&
        !showDispatchCompletedBillingCard &&
        !showDispatchCompletedBillingFallback,
    );

  // Keep dispatch screen operational-only: do not surface billing/export steps here.
  const dispatchGuidedExported = false;

  const dispatchBlockedStripVisible =
    Boolean(
      showCompactDispatchStrip &&
        selectedSo &&
        currentLine &&
        selectedSo.orderType !== "NO_QTY" &&
        !finalizePrepDraftMode &&
        !stripShowFinalize &&
        !topStripSalesBillNext &&
        !dispatchGuidedBillActions &&
        !dispatchGuidedExported &&
        headroomToPrepare <= 1e-9 &&
        primaryFinalizeDraftId == null &&
        billingTargetDispatchId == null,
    );

  const dispatchBlockedSubtitle = dispatchBlockedStripVisible
    ? (dispatchQtyHintPrimary?.trim() ||
        currentLine?.dispatchBlockedReason?.trim() ||
        (noQtyBlocked && selectedSo?.orderType === "NO_QTY"
          ? "Cannot dispatch: pick an active cycle above, or reopen the sales order if no cycles appear."
          : isRegularNormalSalesOrder(selectedSo)
            ? "Nothing can be prepared on this line yet (usable stock may still be available for other needs)."
            : "Nothing is ready to ship on this line yet."))
    : "";

  const finalizeStripSubtitle =
    showCompactDispatchStrip && selectedSo && currentLine
      ? `${displaySalesOrderNo(selectedSo.id, selectedSo.docNo)} | ${currentLine.itemName} | Dispatching now: ${stripDispatchingNow}`
      : "";

  const finalizePreparedStripTitle =
    stripShowFinalize && existingDraftQty > dqEps ? "Next Step: Finalize Prepared Dispatch" : "Next Step: Finalize Dispatch";
  const finalizePreparedStripSubtitle =
    stripShowFinalize && existingDraftQty > dqEps
      ? `Prepared qty: ${fmtDispatchQty(existingDraftQty)}\n${
          isRegularNormalSalesOrder(selectedSo) ? "Max prepare now" : "Ready now"
        }: ${fmtDispatchQty(currentDispatchableQty)}\n\nThis dispatch was already prepared earlier. You can finalize it even if nothing is currently ready.`
      : `${finalizeStripSubtitle} · ${isRegularNormalSalesOrder(selectedSo) ? "Max prepare" : "Ready"}: ${stripReady}`;

  const salesBillFlowHref =
    topStripSalesBillNext && (noQtyFlowTargetId != null && noQtyFlowTargetId > 0 || focusSoIdValid)
      ? buildNoQtyGuidedHref({
          to: "/sales-bills",
          salesOrderId: noQtyFlowTargetId != null && noQtyFlowTargetId > 0 ? noQtyFlowTargetId : focusSoId,
          cycleId: noQtyFlowState?.cycleId,
          fromStep: "dispatch",
        })
      : "";

  const dispatchHistoryAnchorRef = React.useRef<HTMLDivElement | null>(null);

  const dispatchUnifiedFooterSections = React.useMemo((): OperationalFooterSection[] => {
    const soFooter = selectedSo;
    const soIdFooter = soFooter?.id ?? (focusSoIdValid ? focusSoId : 0);
    const soIdValidFooter = Number.isFinite(soIdFooter) && soIdFooter > 0;
    const noQtyFooter = soFooter?.orderType === "NO_QTY";
    const rsHref = soIdValidFooter ? `/sales-orders/${soIdFooter}/requirement-sheets` : "/sales-orders";
    const planningHubHref = soIdValidFooter
      ? `/planning-dashboard?salesOrderId=${encodeURIComponent(String(soIdFooter))}&source=dispatch_footer`
      : "/planning-dashboard";
    const prepareWoHref = soIdValidFooter
      ? `/work-orders/prepare?salesOrderId=${encodeURIComponent(String(soIdFooter))}`
      : "/work-orders/prepare";
    const woListHref = soIdValidFooter
      ? `/work-orders?salesOrderId=${encodeURIComponent(String(soIdFooter))}`
      : "/work-orders";
    const salesOrderSpotHref = soIdValidFooter
      ? `/sales-orders?salesOrderId=${encodeURIComponent(String(soIdFooter))}`
      : "/sales-orders";
    const prodHref = soIdValidFooter ? `/production?salesOrderId=${soIdFooter}&fromStep=dispatch` : "/production";
    const qcHref = soIdValidFooter ? `/qc-entry?salesOrderId=${soIdFooter}&fromStep=dispatch` : "/qc-entry";
    const dispatchHref = soIdValidFooter ? `/dispatch?salesOrderId=${soIdFooter}` : "/dispatch";
    const billHref = soIdValidFooter ? `/sales-bills?salesOrderId=${soIdFooter}` : "/sales-bills";

    const relatedChildren = soIdValidFooter ? (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {noQtyFooter ? (
          <>
            {canOpenRs ? (
              <>
                <Link
                  to={rsHref}
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 px-2 text-[11px] font-semibold")}
                >
                  {NO_QTY_TERMS.REQUIREMENT_SHEET_LINK}
                </Link>
                <Link
                  to={planningHubHref}
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 px-2 text-[11px] font-semibold")}
                >
                  {NO_QTY_TERMS.OPEN_REQUIREMENT_AND_CYCLE_PLANNING}
                </Link>
              </>
            ) : (
              <PlanningStatusChip inline label="Planning Owned by Store" />
            )}
          </>
        ) : (
          <>
            <Link
              to={prepareWoHref}
              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 px-2 text-[11px] font-semibold")}
            >
              {REGULAR_TERMS.WORK_ORDER_PREPARE_TITLE}
            </Link>
            <Link
              to={woListHref}
              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 px-2 text-[11px] font-semibold")}
            >
              {REGULAR_TERMS.OPEN_WORK_ORDERS}
            </Link>
            <Link
              to={salesOrderSpotHref}
              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 px-2 text-[11px] font-semibold")}
            >
              {REGULAR_TERMS.VIEW_SALES_ORDER_SPOTLIGHT}
            </Link>
          </>
        )}
        <Link
          to={prodHref}
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 px-2 text-[11px] font-semibold")}
        >
          Production
        </Link>
        <Link
          to={qcHref}
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 px-2 text-[11px] font-semibold")}
        >
          QC
        </Link>
        <Link
          to={dispatchHref}
          className={cn(buttonVariants({ size: "sm", variant: "default" }), "h-7 px-2 text-[11px] font-semibold")}
        >
          Dispatch
        </Link>
        <Link
          to={billHref}
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 px-2 text-[11px] font-semibold")}
        >
          Sales Bill
        </Link>
        <Link to="/qc-report" className="text-[11px] font-semibold text-sky-800 hover:underline">
          QC Report
        </Link>
      </div>
    ) : null;

    const sections: OperationalFooterSection[] = [];

    const hid = focusSoIdValid ? focusSoId : soIdFooter > 0 ? soIdFooter : 0;
    const showInlineHistory = hid > 0;

    if (showInlineHistory) {
      const soRow =
        displayRows.find((r) => r.id === hid) ?? (fallbackSoRow && fallbackSoRow.id === hid ? fallbackSoRow : undefined);
      const docNoForLabel = soRow?.docNo ?? (focusSo?.id === hid ? focusSo.docNo : null);
      const soLabel = displaySalesOrderNo(hid, docNoForLabel ?? null);
      sections.push({
        key: "history",
        title: "History",
        children: (
          <div ref={dispatchHistoryAnchorRef} className="max-h-44 overflow-auto" aria-label={`Dispatch history ${soLabel}`}>
            <ActivityHistoryCard
              title=""
              density="compact"
              query={`module=DISPATCH&salesOrderId=${encodeURIComponent(String(hid))}&limit=50`}
            />
          </div>
        ),
      });
    }

    if (dispatchBlockedStripVisible) {
      sections.push({
        key: "next",
        title: "Next action",
        children: (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]">
            <span className="font-semibold text-red-900">Blocked</span>
            <span className="text-slate-700">{dispatchBlockedSubtitle}</span>
          </div>
        ),
      });
    } else if (stripShowFinalize && primaryFinalizeDraftId != null && !showPreparedDispatchActionCard) {
      sections.push({
        key: "next",
        title: "Next action",
        children: (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="max-w-[min(100%,28rem)] text-[12px] leading-snug text-slate-700">{finalizePreparedStripTitle}</span>
            <Button
              type="button"
              size="sm"
              className="font-semibold"
              data-testid="next-finalize-dispatch"
              disabled={lockingId === primaryFinalizeDraftId}
              {...(finalizeDemoHl ? { "data-demo-highlight": finalizeDemoHl } : {})}
              onClick={() => primaryFinalizeDraftId != null && void onFinalizeDraftDispatch(primaryFinalizeDraftId)}
            >
              {lockingId === primaryFinalizeDraftId ? "…" : "Finalize Dispatch"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="font-semibold"
              disabled={deletingId === primaryFinalizeDraftId}
              onClick={() => primaryFinalizeDraftId != null && void onDeleteDraft(primaryFinalizeDraftId)}
            >
              {deletingId === primaryFinalizeDraftId ? "…" : "Delete Draft"}
            </Button>
            {finalizePreparedStripSubtitle ? (
              <span className="w-full text-[11px] whitespace-pre-line text-slate-600">{finalizePreparedStripSubtitle}</span>
            ) : null}
          </div>
        ),
      });
    } else if (
      topStripSalesBillNext &&
      focusSoIdValid &&
      salesBillFlowHref &&
      salesBillStepDispatchId == null &&
      !showDispatchCompletedBillingCard &&
      !showDispatchCompletedBillingFallback
    ) {
      sections.push({
        key: "next",
        title: "Next action",
        children: (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-slate-700">Next: Sales Bill</span>
            <Button
              type="button"
              size="sm"
              className="font-semibold"
              data-testid="next-create-sales-bill"
              onClick={() => navigate(salesBillFlowHref)}
            >
              Go to Sales Bill
            </Button>
          </div>
        ),
      });
    } else if (
      noQtyShowCompletedSalesBillNext &&
      selectedSo &&
      salesBillStepDispatchId == null &&
      !showDispatchCompletedBillingCard &&
      !showDispatchCompletedBillingFallback
    ) {
      sections.push({
        key: "next",
        title: "Next action",
        children: (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-slate-700">Dispatch completed — bill next</span>
            <Button
              type="button"
              size="sm"
              className="font-semibold"
              data-testid="noqty-create-sales-bill-after-dispatch"
              onClick={() => {
                if (!selectedSo) return;
                navigate(`/sales-bills?source=no_qty_so&salesOrderId=${selectedSo.id}`);
              }}
            >
              Create Sales Bill
            </Button>
          </div>
        ),
      });
    } else if (
      dispatchGuidedBillActions &&
      salesBillStepDispatchId == null &&
      !showDispatchCompletedBillingCard &&
      !showDispatchCompletedBillingFallback &&
      guidedBillAction?.kind === "CREATE"
    ) {
      sections.push({
        key: "next",
        title: "Next action",
        children: (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-slate-700">Finalize dispatch is done — create bill.</span>
            <Button
              type="button"
              size="sm"
              className="font-semibold"
              data-testid="next-create-sales-bill"
              disabled={dispatchReadOnly}
              onClick={() => void onCreateSalesBillFromDispatch(guidedBillAction.dispatchId)}
            >
              Create Sales Bill
            </Button>
          </div>
        ),
      });
    }

    if (relatedChildren) {
      sections.push({ key: "related", title: "Related links", children: relatedChildren });
    }

    return sections;
  }, [
    deletingId,
    dispatchBlockedStripVisible,
    dispatchBlockedSubtitle,
    dispatchGuidedBillActions,
    displayRows,
    fallbackSoRow,
    finalizeDemoHl,
    finalizePreparedStripSubtitle,
    finalizePreparedStripTitle,
    focusSo,
    focusSoId,
    focusSoIdValid,
    guidedBillAction,
    lockingId,
    navigate,
    noQtyShowCompletedSalesBillNext,
    onCreateSalesBillFromDispatch,
    onDeleteDraft,
    onFinalizeDraftDispatch,
    primaryFinalizeDraftId,
    salesBillFlowHref,
    salesBillStepDispatchId,
    selectedSo,
    showDispatchCompletedBillingCard,
    showDispatchCompletedBillingFallback,
    showPreparedDispatchActionCard,
    stripShowFinalize,
    topStripSalesBillNext,
  ]);

  React.useEffect(() => {
    if (showPreparedDispatchActionCard || showDispatchCompletedBillingCard || showDispatchCompletedBillingFallback)
      setShowOpenLinesQueue(false);
  }, [showPreparedDispatchActionCard, showDispatchCompletedBillingCard, showDispatchCompletedBillingFallback]);

  function renderSoDispatchLedger(layout: "panel" | "belowPrepared") {
    if (!showSoDispatchLedger || !selectedSo) return null;
    const so = selectedSo;
    const outer =
      layout === "belowPrepared"
        ? "rounded-lg border border-slate-200/80 bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100/70"
        : "mt-2 border-t border-slate-100 pt-2";
    const titleCls =
      layout === "belowPrepared"
        ? "mb-1 text-[11px] font-semibold text-slate-700"
        : "mb-1 text-[12px] font-semibold text-slate-700";
    const scrollMax = layout === "belowPrepared" ? "max-h-36" : "max-h-52";
    return (
      <div className={outer}>
        <div className={titleCls}>Dispatch ledger</div>
        <div className={cn(scrollMax, "overflow-auto")}>
          <table className="erp-table erp-table-dense w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[12px] text-slate-600">
                <th className="py-0.5 pr-2">#</th>
                <th className="py-0.5 pr-2">Status</th>
                <th className="py-0.5 pr-2">Type</th>
                <th className="py-0.5 pr-2">Item</th>
                <th className="py-0.5 pr-2 text-right">Qty</th>
                <th className="py-0.5 pr-2">Note</th>
                <th className="py-0.5" />
              </tr>
            </thead>
            {(() => {
              function rowEl(d: DispatchEvent) {
                const isRev = d.reversalOfId != null;
                const qty = Number(d.dispatchedQty);
                const itemName = (so.lineStats ?? []).find((ls) => ls.itemId === d.itemId)?.itemName ?? `Item #${d.itemId}`;
                const maxRev = typeof d.maxReversibleQty === "number" ? d.maxReversibleQty : 0;
                const badge = rowStatusBadge(d);
                const isUnlockedForward = !isRev && d.workflowStatus === "UNLOCKED";
                const isLockedForward = !isRev && (d.workflowStatus === "LOCKED" || d.workflowStatus == null);
                return (
                  <tr
                    key={d.id}
                    id={`so-dispatch-ledger-row-${d.id}`}
                    className={cn("border-t border-slate-100", isRev && "bg-red-50/40")}
                  >
                    <td className="py-0.5 pr-2 tabular-nums">{d.id}</td>
                    <td className="py-0.5 pr-2">
                      <span
                        className={`inline-flex rounded border px-1 py-0.5 text-[10px] font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-0.5 pr-2">{isRev ? "Reversal" : "Dispatch"}</td>
                    <td className="max-w-[10rem] truncate py-0.5 pr-2" title={itemName}>
                      {itemName}
                    </td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{isRev ? qty : `+${qty}`}</td>
                    <td className="py-0.5 pr-2 text-slate-600">{isRev ? (d.reversalReason?.trim() || "—") : "—"}</td>
                    <td className="py-0.5 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {isUnlockedForward && !so.dispatchReadOnly ? (
                          primaryFinalizeDraftId != null && d.id === primaryFinalizeDraftId ? null : (
                            <>
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                data-testid="finalize-dispatch-btn"
                                className="h-7 px-2 text-[11px]"
                                disabled={lockingId === d.id}
                                onClick={() => onLockDispatch(d.id)}
                              >
                                {lockingId === d.id ? "…" : "Finalize Dispatch"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                disabled={deletingId === d.id}
                                onClick={() => onDeleteDraft(d.id)}
                              >
                                {deletingId === d.id ? "…" : "Remove"}
                              </Button>
                            </>
                          )
                        ) : null}
                        {isLockedForward && maxRev > 0 ? (
                          <details className="inline-block text-right">
                            <summary className="cursor-pointer list-none text-[10px] font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 [&::-webkit-details-marker]:hidden">
                              More actions
                            </summary>
                            <div className="mt-1 flex flex-wrap justify-end gap-1 border-t border-slate-100 pt-1">
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                disabled={reversingId === d.id}
                                onClick={() => onReverseDispatch(d.id, maxRev)}
                              >
                                {reversingId === d.id ? "…" : "Reverse Dispatch"}
                              </Button>
                            </div>
                          </details>
                        ) : null}
                        {isLockedForward &&
                        qty > 0 &&
                        !(billingTargetDispatchId != null && d.id === billingTargetDispatchId) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => void onCreateSalesBillFromDispatch(d.id)}
                          >
                            Create bill
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              }
              const primary = [...soLedgerDispatches].sort((a, b) => b.id - a.id);
              const other = [...soLedgerDispatchesOtherCycles].sort((a, b) => b.id - a.id);
              return (
                <>
                  <tbody>
                    {so.orderType === "NO_QTY" && primary.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-2 text-[12px] text-slate-500">
                          No prepared or finalized dispatches for this item yet.
                        </td>
                      </tr>
                    ) : (
                      primary.map(rowEl)
                    )}
                  </tbody>
                  {so.orderType === "NO_QTY" && other.length > 0 ? (
                    <tbody>
                      <tr>
                        <td colSpan={7} className="border-t border-slate-200 bg-slate-50 px-2 py-2">
                          <details>
                            <summary className="cursor-pointer text-[12px] font-semibold text-slate-700">
                              Older history (other cycles) ({other.length})
                            </summary>
                            <div className="mt-2 overflow-x-hidden">
                              <table className="w-full table-fixed text-[12px]">
                                <thead>
                                  <tr className="border-b border-slate-200 text-left text-[11px] font-medium text-slate-600">
                                    <th className="w-[6rem] py-1 pr-2">Date</th>
                                    <th className="w-[7.25rem] py-1 pr-2">Dispatch</th>
                                    <th className="w-[4.25rem] py-1 pr-2 text-right">Qty</th>
                                    <th className="w-[6.25rem] py-1 pr-2">Status</th>
                                    <th className="py-1 pr-2">Sales Bill</th>
                                    <th className="w-[5.25rem] py-1 pr-2">Reversal</th>
                                    <th className="w-[4.5rem] py-1">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>{other.map(rowEl)}</tbody>
                              </table>
                            </div>
                          </details>
                        </td>
                      </tr>
                    </tbody>
                  ) : null}
                </>
              );
            })()}
          </table>
        </div>
      </div>
    );
  }

  return (
    <PageContainer className="pb-6 sm:pb-8">
      <div className="mb-1">
        <DemoFlowBanner />
      </div>
      <div className="grid gap-1.5">
        <OperationalContextSticky>
          <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600">
            <Link to="/sales-orders" className="font-medium text-sky-900 hover:underline">
              Sales Orders
            </Link>
            <span className="text-slate-300" aria-hidden>
              /
            </span>
            <span className="font-mono font-semibold text-slate-900">
              {selectedSo ? displaySalesOrderNo(selectedSo.id, selectedSo.docNo) : focusSoIdValid ? `SO-${focusSoId}` : "—"}
            </span>
            <span className="text-slate-300" aria-hidden>
              /
            </span>
            <span className="font-semibold text-slate-800">Dispatch</span>
          </nav>
          {(() => {
            const eps = 1e-9;
            const so = selectedSo;
            const isNoQty = so?.orderType === "NO_QTY";
            const cycleLabel = isNoQty
              ? currentLine?.noQtyCycleNo != null
                ? `Cycle ${currentLine.noQtyCycleNo}`
                : so?.noQtyDispatchContext?.cycleNo != null
                  ? `Cycle ${so.noQtyDispatchContext.cycleNo}`
                  : "Cycle —"
              : null;
            const usable = so && currentLine ? lineAvailableStockTable(so, currentLine) : 0;
            const qcPending = safeNum(currentLine?.qcPendingQty ?? 0);
            const pending = Math.max(0, remainingSoLine);
            const dispatchable = headroomToPrepare;

            const suggest: "RS" | "PROD" | "QC" | "DISPATCH" | "BILL" = (() => {
              if (noQtyPreviousDispatchBillWarning || showDispatchCompletedBillingCard || showDispatchCompletedBillingFallback) return "BILL";
              if (dispatchable > eps || usable > eps) return "DISPATCH";
              if (qcPending > eps) return "QC";
              if (pending > eps) return "PROD";
              return "DISPATCH";
            })();

            const stepBtn = (
              key: "RS" | "PREPARE" | "PROD" | "QC" | "DISPATCH" | "BILL",
              label: string,
              href: string,
              enabled: boolean,
            ) => {
              const isCurrent = key === "DISPATCH";
              const isSuggested = key === suggest;
              return (
                <Link
                  key={key}
                  to={href}
                  aria-disabled={!enabled}
                  className={cn(
                    buttonVariants({ size: "sm", variant: isCurrent ? "default" : "outline" }),
                    "h-7 px-2 text-[11px] font-semibold",
                    isSuggested && !isCurrent && "border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-50",
                    !enabled && "pointer-events-none opacity-50",
                  )}
                >
                  {label}
                </Link>
              );
            };

            const soId = so?.id ?? focusSoId;
            const soIdValid = Number.isFinite(soId) && soId > 0;
            const rsHref = soIdValid ? `/sales-orders/${soId}/requirement-sheets` : "/sales-orders";
            const prodHref = soIdValid ? `/production?salesOrderId=${soId}&fromStep=dispatch` : "/production";
            const qcHref = soIdValid ? `/qc-entry?salesOrderId=${soId}&fromStep=dispatch` : "/qc-entry";
            const dispatchHref = soIdValid ? `/dispatch?salesOrderId=${soId}` : "/dispatch";
            const billHref = soIdValid ? `/sales-bills?salesOrderId=${soId}` : "/sales-bills";

            const prepareWoHref = soIdValid ? `/work-orders/prepare?salesOrderId=${encodeURIComponent(String(soId))}` : "/work-orders/prepare";

            const docSeg =
              primaryFinalizeDraftId != null && preparedDispatchDocLabel
                ? `${preparedDispatchDocLabel} · Draft`
                : billingTargetDispatchId != null && dispatchCompletedDocLabel && primaryFinalizeDraftId == null
                  ? `${dispatchCompletedDocLabel} · Finalized`
                  : "—";

            const statusSeg = dispatchReadOnly
              ? "View-only"
              : showPreparedDispatchActionCard
                ? "Finalize draft"
                : showDispatchCompletedBillingCard || showDispatchCompletedBillingFallback
                  ? "Bill next"
                  : dispatchBlockedStripVisible
                    ? "Blocked"
                    : "Operational";

            return (
              <>
                <OperationalContextBar className="mt-1">
                  <span className="font-mono font-semibold tabular-nums text-slate-900">
                    {so ? displaySalesOrderNo(so.id, so.docNo) : focusSoIdValid ? `SO-${focusSoId}` : "—"}
                  </span>
                  <OpCtxSep />
                  <span className="max-w-[11rem] truncate font-medium text-slate-900" title={so ? customerDisplayName(so) : ""}>
                    {so ? customerDisplayName(so) : "—"}
                  </span>
                  <OpCtxSep />
                  <span className="rounded border border-slate-200 bg-white px-1.5 py-0 text-[11px] font-semibold text-slate-700">
                    {so?.orderType ?? "—"}
                  </span>
                  {cycleLabel ? (
                    <>
                      <OpCtxSep />
                      <span className="text-[11px] font-medium text-slate-600">{cycleLabel}</span>
                    </>
                  ) : null}
                  <OpCtxSep />
                  <span className="max-w-[14rem] truncate font-medium text-slate-800" title={currentLine?.itemName ?? ""}>
                    {currentLine?.itemName ?? "—"}
                  </span>
                  <OpCtxSep />
                  <span className="font-mono text-[11px] font-semibold text-violet-900">{docSeg}</span>
                  <OpCtxSep />
                  <span className="text-[11px] font-semibold text-slate-700">{statusSeg}</span>
                </OperationalContextBar>
                <div className="erp-next-action-bar mt-1 border-slate-200/90 bg-white/80 py-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {isNoQty
                      ? canOpenRs
                        ? stepBtn("RS", "Req. sheet", rsHref, soIdValid)
                        : <PlanningStatusChip inline label="Req. sheet · Planning" />
                      : stepBtn("PREPARE", REGULAR_TERMS.TOOLBAR_PREPARE_WO, prepareWoHref, soIdValid)}
                    {stepBtn("PROD", "Production", prodHref, soIdValid)}
                    {stepBtn("QC", "QC", qcHref, soIdValid)}
                    {stepBtn("DISPATCH", "Dispatch", dispatchHref, true)}
                    {stepBtn("BILL", "Sales Bill", billHref, soIdValid)}
                    <Link to="/qc-report" className="text-[11px] font-semibold text-sky-800 hover:underline">
                      QC Report
                    </Link>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {isNoQty && dispatchable > eps ? (
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-950">
                        Optional dispatch <span className="tabular-nums">{fmtDispatchQty(dispatchable)}</span>
                      </span>
                    ) : null}
                    {noQtyPreviousDispatchBillWarning ? (
                      <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950">
                        Prev bill pending
                      </span>
                    ) : null}
                  </div>
                </div>
              </>
            );
          })()}
        </OperationalContextSticky>

        {sp.get("mode") === "partial" && !fromNoQtySo ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Partial dispatch mode. Remaining qty will stay pending.
          </div>
        ) : null}

        {/* NO_QTY optional dispatch guidance is now a compact chip in the toolbar above. */}

        {showPreparedDispatchActionCard && primaryFinalizeDraftId != null ? (
          <div className="min-w-0 overflow-hidden rounded-md border border-amber-200 bg-amber-50/90 px-2.5 py-2">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-amber-950">Prepared dispatch</div>
                {preparedDispatchDocLabel && preparedDispatchQtyLabel !== "—" ? (
                  <p className="mt-0.5 text-[12px] leading-snug text-slate-800">
                    <span className="font-mono font-semibold">{preparedDispatchDocLabel}</span> ·{" "}
                    <span className="tabular-nums font-semibold">{preparedDispatchQtyLabel}</span> qty
                  </p>
                ) : (
                  <p className="mt-0.5 text-[12px] text-slate-800">Prepared dispatch is ready.</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="font-semibold"
                  data-testid="prepared-dispatch-finalize-btn"
                  disabled={lockingId === primaryFinalizeDraftId}
                  onClick={() => primaryFinalizeDraftId != null && void onFinalizeDraftDispatch(primaryFinalizeDraftId)}
                >
                  {lockingId === primaryFinalizeDraftId ? "…" : "Finalize Dispatch"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="font-semibold"
                  data-testid="prepared-dispatch-delete-btn"
                  disabled={deletingId === primaryFinalizeDraftId}
                  onClick={() => primaryFinalizeDraftId != null && void onDeleteDraft(primaryFinalizeDraftId)}
                >
                  {deletingId === primaryFinalizeDraftId ? "…" : "Delete Draft"}
                </Button>
              </div>
            </div>
            <button
              type="button"
              className="mt-1.5 block w-fit text-left text-[11px] font-medium text-sky-800 underline decoration-sky-800/40 underline-offset-2 hover:text-sky-950"
              onClick={() => {
                setReopenedPreparedDraft(null);
                setReopenFallbackSoRow(null);
                const params = new URLSearchParams(sp);
                params.delete("draftDispatchId");
                navigate(`/dispatch?${params.toString()}`, { replace: true });
              }}
            >
              Back to open lines
            </button>
          </div>
        ) : null}

        {showPreparedDispatchActionCard ? renderSoDispatchLedger("belowPrepared") : null}

        {showDispatchCompletedBillingCard && billingTargetDispatchId != null ? (
          <div className="min-w-0 overflow-hidden rounded-md border border-emerald-200/90 bg-emerald-50/80 px-2.5 py-2">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 text-[12px] leading-snug text-slate-800">
                <div className="font-semibold text-emerald-950">Dispatch finalized · bill next</div>
                <div className="mt-0.5 text-[11px] text-slate-700">{dispatchCompletedSubtitle}</div>
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                {isRegularNormalSalesOrder(selectedSo) && billingTargetDispatchId != null ? (
                  <Link
                    to={`/sales-bills/new?dispatchId=${billingTargetDispatchId}&from=dispatch`}
                    data-testid="dispatch-next-create-sales-bill-card"
                    className={cn(
                      buttonVariants({ size: "sm", variant: "default" }),
                      "justify-center font-semibold no-underline",
                      dispatchReadOnly ? "pointer-events-none opacity-50" : "",
                    )}
                    aria-disabled={dispatchReadOnly}
                    onClick={(e) => {
                      if (dispatchReadOnly) e.preventDefault();
                    }}
                  >
                    Create Sales Bill
                  </Link>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    className="font-semibold"
                    data-testid="dispatch-next-create-sales-bill-card"
                    disabled={dispatchReadOnly}
                    onClick={() => void onCreateSalesBillFromDispatch(billingTargetDispatchId)}
                  >
                    Create Sales Bill
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-medium"
                  data-testid="dispatch-view-history-btn"
                  onClick={() => dispatchHistoryAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  History
                </Button>
              </div>
            </div>
            {/* Phase 1: "Create Next RS" CTA removed from Dispatch page (ownership = Dashboard / NO_QTY SO detail / RS page). */}
          </div>
        ) : null}

        {showDispatchCompletedBillingFallback ? (
          <div className="min-w-0 overflow-hidden rounded-md border border-emerald-200/90 bg-emerald-50/80 px-2.5 py-2">
            <div className="text-[12px] font-semibold text-emerald-950">Dispatch finalized</div>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-700">
              Select sales order or open dispatch history to create bill.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="font-medium"
                data-testid="dispatch-completed-fallback-history-btn"
                onClick={() => dispatchHistoryAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                History
              </Button>
              {/* Phase 1: "Create Next RS" CTA removed from Dispatch page. */}
            </div>
          </div>
        ) : null}
      </div>

      <OperatorPageBody className="pb-0">
        {/* Phase 1: "Create Next RS" CTA removed from Dispatch page. */}
        {fromNoQtySo && focusSoIdValid ? (
          <NoQtyCycleBanner className="mb-1" />
        ) : null}
        {error ? <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[13px] text-red-800">{error}</div> : null}
        {dispatchInfo ? (
          <div className="whitespace-pre-line rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[12px] leading-snug text-emerald-900">
            {dispatchInfo}
          </div>
        ) : null}

        <DemoSafeNoQtyContinue
          visible={showDemoNoQtyDispatchContinue}
          body="Demo mode: Dispatch is not saved in Safe Demo. Complete this step to finish the NO_QTY demo path."
          actionLabel="Continue Demo → Sales Bill"
        />
        {selectedSo?.dispatchReadOnly ||
        (selectedSo?.orderType === "NO_QTY" && !noQtyCyclesLoading && noQtyCycles.length === 0) ||
        (selectedSo?.orderType === "NO_QTY" && (selectedSo.lineStats?.length ?? 0) === 0 && selectedSo.noQtyDispatchBlockedReason) ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedSo?.dispatchReadOnly ? (
              <span className="inline-flex items-center rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-800">
                View-only (SO closed)
              </span>
            ) : null}
            {selectedSo?.orderType === "NO_QTY" && !noQtyCyclesLoading && noQtyCycles.length === 0 ? (
              <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
                No active cycle
              </span>
            ) : null}
            {selectedSo?.orderType === "NO_QTY" &&
            (selectedSo.lineStats?.length ?? 0) === 0 &&
            selectedSo.noQtyDispatchBlockedReason ? (
              <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
                {mapNoQtySoBlockedReasonApi(selectedSo.noQtyDispatchBlockedReason)}
              </span>
            ) : null}
          </div>
        ) : null}

      {!showMainDispatchUi ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-950">
          {hasPreparedDraftLedger ? (
            <>
              <div className="font-semibold text-amber-950">Prepared dispatch exists</div>
              <div className="mt-0.5 text-amber-900">
                A prepared (draft) dispatch is pending finalization. Use the dispatch list above to reopen it, or adjust filters/dates below to locate it in history.
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold">✔ Dispatch complete</div>
              {!fromNoQtySo && latestRegularUnbilledDispatchId != null ? (
                <div className="mt-1 space-y-2 text-emerald-900">
                  <p className="text-[13px] font-medium leading-snug text-emerald-950">
                    Dispatch completed. Create sales bill for this dispatch.
                  </p>
                  <Link
                    to={`/sales-bills/new?dispatchId=${latestRegularUnbilledDispatchId}&from=dispatch`}
                    className={cn(
                      buttonVariants({ size: "default", variant: "default" }),
                      "inline-flex no-underline",
                    )}
                    data-testid="dispatch-complete-global-create-bill"
                  >
                    Create Sales Bill
                  </Link>
                  <p className="text-[12px] text-emerald-900/90">You can review past dispatches below.</p>
                </div>
              ) : (
                <>
                  <div className="mt-0.5 text-emerald-900">All sales orders are fully dispatched or completed.</div>
                  {hasUnexportedSalesBillsInHistory ? (
                    <div className="mt-1 text-emerald-900/90">Some finalized dispatches still have Sales Bill export pending.</div>
                  ) : null}
                  <div className="mt-1 text-emerald-900/90">You can review past dispatches below.</div>
                </>
              )}
              <div className="mt-2 text-[12px] text-emerald-900/90">
                <span className="font-medium">Dispatch Status:</span> ✔ 0 pending dispatch
              </div>
            </>
          )}
        </div>
      ) : (
        <div ref={dispatchFormRef} className="flex flex-col gap-2">
          <OperatorTopBar className="flex-col items-stretch gap-1.5 rounded border border-slate-200 bg-white p-1.5 shadow-sm">
              <>
                {fromNoQtySo && focusSoIdValid && selectedSo?.orderType === "NO_QTY" && dispatchReadOnly ? (
                  <div className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[12px] text-sky-950">
                    This sales order is closed. Dispatch is view-only.
                  </div>
                ) : null}
                {guidedNoQtyLockUi ? (
                  <div ref={guidedTopRef} className="grid gap-2">
                      <div className="rounded border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-800">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold text-slate-900">
                            {selectedSo ? displaySalesOrderNo(selectedSo.id, selectedSo.docNo) : focusSoIdValid ? `SO-${focusSoId}` : "—"}
                          </span>
                          <span className="text-slate-400" aria-hidden>
                            |
                          </span>
                          <span className="text-slate-700">
                            {selectedSo?.orderType ? String(selectedSo.orderType) : "—"}
                          </span>
                          <span className="text-slate-400" aria-hidden>
                            |
                          </span>
                          <span className="text-slate-700">
                            {selectedSo?.orderType === "NO_QTY"
                              ? selectedNoQtyCycleStatusLabel ?? (noQtyCyclesLoading ? "…" : `Cycle #${focusCycleId}`)
                              : "—"}
                          </span>
                        </div>
                      </div>

                    {!guidedNoQtyResolved ? (
                      <div className="rounded border border-sky-200 bg-sky-50 px-2.5 py-2 text-[12px] text-sky-950">
                        Loading guided dispatch context…
                      </div>
                    ) : finalizePrepDraftMode ? (
                      <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950">
                        <div className="font-semibold">Prepared dispatch</div>
                        <div className="mt-0.5 text-[11px] text-amber-900/90">Draft saved — finalize or delete when ready.</div>
                      </div>
                    ) : (
                      <div
                        className={
                          guidedLedgerContext?.preparedDraft
                            ? "rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950"
                            : safeNum(currentDispatchableQty) <= 1e-9 && guidedLedgerContext?.latestFinalized
                              ? "rounded border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[12px] text-emerald-950"
                              : "rounded border border-slate-200 bg-white px-2.5 py-2 text-[12px] text-slate-900"
                        }
                      >
                        {guidedLedgerContext?.preparedDraft ? (
                          <>
                            <div className="font-semibold">Dispatch Ready</div>
                            <div className="mt-0.5 text-[11px] text-amber-900">Prepared draft — finalize or delete when ready.</div>
                          </>
                        ) : safeNum(currentDispatchableQty) <= 1e-9 && guidedLedgerContext?.latestFinalized ? (
                          <>
                            <div className="font-semibold">Dispatch Completed</div>
                            <div className="mt-0.5 text-[11px] text-emerald-900">
                              {guidedLedgerContext?.latestFinalized?.salesBillIsExported === true
                                ? "Dispatch finalized — stock posted."
                                : "Dispatch finalized — stock posted. Create a sales bill when you are ready."}
                            </div>
                          </>
                        ) : (
                          <>
                            {!noQtyPartialAfterFirstDispatchThisCycle ? (
                              <>
                                <div className="font-semibold text-slate-900">Dispatch when ready</div>
                                <p className="mt-1 text-[13px] text-slate-800">
                                  <span className="text-slate-600">Available to dispatch now:</span>{" "}
                                  <span className="font-bold tabular-nums text-emerald-900">
                                    {fmtDispatchQty(safeNum(currentDispatchableQty))}
                                  </span>
                                </p>
                              </>
                            ) : null}
                            {selectedSo && currentLine ? (
                              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-700">
                                <div className="rounded border border-slate-200 bg-white px-2 py-1">
                                  <div className="text-slate-500">Usable</div>
                                  <div className="font-semibold tabular-nums text-slate-900">
                                    {fmtDispatchQty(Math.max(0, safeNum(getUsableStock(currentLine))))}
                                  </div>
                                </div>
                                <div className="rounded border border-slate-200 bg-white px-2 py-1">
                                  <div className="text-slate-500">In Process</div>
                                  <div className="font-semibold tabular-nums text-slate-900">
                                    {fmtDispatchQty(
                                      Math.max(
                                        0,
                                        (() => {
                                          const explicit = currentLine.inProcessQty != null ? safeNum(currentLine.inProcessQty) : null;
                                          const computed =
                                            safeNum(currentLine.qcHoldQty) +
                                            safeNum(currentLine.qcPendingQty) +
                                            safeNum(currentLine.reworkQty);
                                          const base = explicit != null ? explicit : computed;
                                          return base > 1e-9 ? base : safeNum(currentLine.inQcReworkQty);
                                        })(),
                                      ),
                                    )}
                                  </div>
                                </div>
                                <div className="rounded border border-slate-200 bg-white px-2 py-1">
                                  <div className="text-slate-500">Scrap</div>
                                  <div className="font-semibold tabular-nums text-slate-900">
                                    {fmtDispatchQty(Math.max(0, safeNum(currentLine.scrapQty ?? 0)))}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                            {!noQtyPartialAfterFirstDispatchThisCycle ? (
                              <p className="mt-1.5 text-[11px] leading-snug text-slate-600">
                                Enter quantity on the right and tap <span className="font-semibold text-slate-800">Dispatch Now</span>. Allocation
                                across cycles is automatic (FIFO). Nothing posts until you finalize the prepared dispatch.
                              </p>
                            ) : null}
                            {selectedSo && currentLine && dispatchQtyValid && dispatchQtyParsed != null ? (
                              <p className="mt-1 text-[11px] text-slate-600">
                                After dispatch, remaining usable (preview):{" "}
                                <span className="font-semibold tabular-nums text-slate-900">
                                  {fmtDispatchQty(Math.max(0, safeNum(getUsableStock(currentLine)) - dispatchQtyParsed))}
                                </span>
                              </p>
                            ) : null}
                            {isAdmin && noQtyAdminAdvancedOpen ? (
                              <details className="mt-2 rounded border border-slate-200 bg-slate-50/80">
                                <summary className="cursor-pointer px-2 py-1 text-[11px] font-semibold text-slate-700">
                                  More cycle / QC detail
                                </summary>
                                <div className="border-t border-slate-200 px-2 py-2">
                                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-800 sm:grid-cols-4">
                                    <div>
                                      <div className="text-slate-600">QC passed (cycle)</div>
                                      <div className="font-semibold tabular-nums">
                                        {fmtDispatchQty(safeNum(currentLine?.cycleQcAcceptedQty ?? currentLine?.qcAccepted ?? 0))}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-slate-600">Dispatched (cycle · history only)</div>
                                      <div className="font-semibold tabular-nums">{fmtDispatchQty(safeNum(currentLine?.cycleDispatchedQty ?? 0))}</div>
                                    </div>
                                    <div>
                                      <div className="text-slate-600">Room left (this cycle)</div>
                                      <div className="font-semibold tabular-nums">{fmtDispatchQty(safeNum(currentLine?.cycleCapRemaining ?? 0))}</div>
                                    </div>
                                    <div>
                                      <div className="text-slate-600">Prepared draft</div>
                                      <div className="font-semibold tabular-nums">{fmtDispatchQty(existingDraftQty)}</div>
                                    </div>
                                  </div>
                                </div>
                              </details>
                            ) : null}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
              <FieldShortcutHint
                show={shortcutHints.activeFieldId === "dispatchSo"}
                hint={shortcutHints.activeFieldHintText ?? ""}
                placement="below"
                className="min-w-[10rem] max-w-[18rem] shrink-0"
              >
                <div className="erp-form-field min-w-0">
                  <span className="text-[12px] font-medium text-slate-600">Sales order</span>
                  <select
                    ref={soSelectRef}
                    {...dispatchSoBind}
                    className={cn("erp-select mt-0.5 w-full min-w-0 text-[13px]", operatorInputClass)}
                    value={soId === 0 ? "" : String(soId)}
                    disabled={dispatching || reopenedPreparedDraftMode}
                  >
                    <option value="">Select…</option>
                    {displayRows.map((r) => (
                      <option key={r.id} value={r.id}>
                        Sales Order No: {displaySalesOrderNo(r.id, r.docNo)} — {customerDisplayName(r)}
                      </option>
                    ))}
                  </select>
                </div>
              </FieldShortcutHint>
              <FieldShortcutHint
                show={shortcutHints.activeFieldId === "dispatchFg"}
                hint={shortcutHints.activeFieldHintText ?? ""}
                placement="below"
                className="min-w-[10rem] max-w-[20rem] flex-1"
              >
                <div className="erp-form-field min-w-0">
                  <span className="text-[12px] font-medium text-slate-600">Item (open line)</span>
                  <select
                    ref={fgLineSelectRef}
                    {...dispatchFgBind}
                    className={cn("erp-select mt-0.5 w-full min-w-0 text-[13px]", operatorInputClass)}
                    value={salesOrderLineId === 0 ? "" : String(salesOrderLineId)}
                    disabled={dispatching || reopenedPreparedDraftMode || !soId || (!selectableLines.length && !currentLine)}
                  >
                    <option value="">{soId ? "Select item…" : "Select SO first…"}</option>
                    {fgLineSelectOptions.map((l) => {
                      const dup = fgLineSelectOptions.filter(
                        (x) =>
                          x.itemId === l.itemId &&
                          normalizePositiveCycleId(x.noQtyCycleId) === normalizePositiveCycleId(l.noQtyCycleId),
                      ).length > 1;
                      const d = selectedSo ? draftQtyForSoItem(selectedSo, l.itemId, noQtySelectedCycleId, l.noQtyCycleId ?? null) : 0;
                      const partialOpt =
                        selectedSo &&
                        isRegularNormalSalesOrder(selectedSo) &&
                        effectiveRegularDispatchReadiness(selectedSo, l) === "PARTIAL_AVAILABLE"
                          ? " · partial stock"
                          : "";
                      return (
                        <option key={l.lineId} value={l.lineId}>
                          {l.itemName}
                          {selectedSo?.orderType === "NO_QTY" && l.noQtyCycleNo != null && noQtyStrictCycleGuidance
                            ? ` · Cycle ${l.noQtyCycleNo}`
                            : ""}
                          {dup ? ` (line ${l.lineId})` : ""}
                          {partialOpt}
                          {currentLine && l.lineId === currentLine.lineId && !selectableLines.some((x) => x.lineId === l.lineId) ? "" : ""}
                          {d > 0 ? ` · prepared ${fmtDispatchQty(d)}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </FieldShortcutHint>
              {selectedSo?.orderType === "NO_QTY" && isAdmin ? (
                <div className="erp-form-field min-w-[9rem] max-w-[12rem] shrink-0 self-end">
                  <span className="text-[12px] font-medium text-slate-600">Admin</span>
                  <button
                    type="button"
                    className={cn(
                      "mt-0.5 w-full rounded border border-slate-200 bg-white px-2 text-left text-[12px] font-medium leading-8 text-sky-900 shadow-sm hover:bg-slate-50",
                      operatorInputClass,
                    )}
                    onClick={() => setNoQtyAdminAdvancedOpen((v) => !v)}
                  >
                    {noQtyAdminAdvancedOpen ? "Hide advanced" : "Advanced / debug"}
                  </button>
                </div>
              ) : null}
              {selectedSo?.orderType === "NO_QTY" && isAdmin && noQtyAdminAdvancedOpen ? (
                <div className="erp-form-field min-w-[8rem] max-w-[14rem] shrink-0">
                  <span className="text-[12px] font-medium text-slate-600">Cycle</span>
                  {reopenedPreparedDraftMode ? (
                    <div className={cn("mt-0.5 h-8 rounded border border-slate-200 bg-slate-50 px-2 text-[13px] leading-8 text-slate-800", operatorInputClass)}>
                      {(() => {
                        const cid = noQtySelectedCycleId;
                        const opt = cid != null ? noQtyCycles.find((c) => Number(c.cycleId) === Number(cid)) : null;
                        return opt?.cycleLabel ?? (cid != null ? `Cycle #${cid}` : "—");
                      })()}
                    </div>
                  ) : (
                    <select
                      className={cn("erp-select mt-0.5 w-full min-w-0 text-[13px]", operatorInputClass)}
                      value={noQtySelectedCycleId != null ? String(noQtySelectedCycleId) : ""}
                      disabled={
                        dispatching ||
                        noQtyCyclesLoading ||
                        noQtyCycles.length === 0 ||
                        selectedSo.orderType !== "NO_QTY"
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setNoQtySelectedCycleId(v === "" ? null : Number(v));
                      }}
                    >
                      <option value="">
                        {noQtyCyclesLoading ? "Loading…" : noQtyCycles.length === 0 ? "No cycles" : "Select…"}
                      </option>
                      {noQtyCycles.map((c) => (
                        <option
                          key={c.cycleId}
                          value={c.cycleId}
                          disabled={c.eligible === false}
                          title={c.sequentialLockReason ?? undefined}
                        >
                          {c.cycleLabel}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : null}
                  </div>
                )}
            {currentLine && selectedSo && !finalizePrepDraftMode ? (
              selectedSo.orderType === "NO_QTY" ? (
                isAdmin && noQtyAdminAdvancedOpen ? (
                  <details className="border-t border-slate-100 pt-2">
                    <summary className="cursor-pointer text-[12px] font-semibold text-slate-800">
                      More cycle / dispatch detail
                    </summary>
                    <div className="mt-2 space-y-2">
                      <DispatchAvailabilityStrip
                        orderType={selectedSo.orderType}
                        line={currentLine}
                        readyToShip={readyToShip}
                        noQtyNextAction={noQtySelectedNextAction}
                      />
                    </div>
                  </details>
                ) : null
              ) : (
                <DispatchDecisionSummaryCard
                  so={selectedSo}
                  ls={currentLine}
                  readyToShip={readyToShip}
                  noQtyNextAction={noQtySelectedNextAction}
                  regularReadiness={currentRegularReadiness}
                />
              )
            ) : null}
              </>
          </OperatorTopBar>

          <OperatorMainSplit
            panelFirstOnLg={selectedSo?.orderType === "NO_QTY"}
            lgGridClassName={selectedSo?.orderType === "NO_QTY" ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : undefined}
            panelContainerClassName={
              selectedSo?.orderType === "NO_QTY" ? "order-1 min-w-0" : undefined
            }
            queue={
              <div className="flex flex-col gap-3">
                {finalizePrepDraftMode ? null : (showPreparedDispatchActionCard ||
                  showDispatchCompletedBillingCard ||
                  showDispatchCompletedBillingFallback) &&
                  !showOpenLinesQueue ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="text-[12px] font-medium text-sky-800 underline decoration-sky-800/40 underline-offset-2 hover:text-sky-950"
                      onClick={() => setShowOpenLinesQueue(true)}
                    >
                      {selectedSo?.orderType === "NO_QTY" ? "Show operational items" : "Show open lines"}
                    </button>
                  </div>
                ) : !finalizePrepDraftMode ? (
                <section className="space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[12px] font-bold uppercase tracking-wide text-slate-600">
                      {selectedSo?.orderType === "NO_QTY" ? "Operational Queue" : "Open lines"}
                    </h3>
                    <span className="text-[11px] text-slate-500">
                      {fromNoQtySo && focusSoIdValid && selectedSo?.orderType === "NO_QTY"
                        ? "Use the item selector in the panel to change the FG line."
                        : noQtyLineEntries
                          ? "All FG lines for this cycle are listed below."
                          : "Choose a sales order and line to prepare dispatch."}
                    </span>
                  </div>
                  {selectedSo?.orderType === "NO_QTY" ? null : (() => {
                    const entries: Array<{ so: SoRow; ls: LineStat }> = noQtyLineEntries
                      ? noQtyLineEntries
                      : [...prepareQueueSections.flatMap((s) => s.rows), ...blockedLines];
                    const summary = entries.reduce(
                      (acc, e) => {
                        const cyc =
                          e.so.orderType === "NO_QTY"
                            ? normalizePositiveCycleId(e.so.noQtyDispatchContext?.selectedCycleId ?? e.so.currentCycleId)
                            : null;
                        const pending = linePendingOnOrderDisplay(e.ls);
                        const maxNow = computeDispatchableNow({ so: e.so, ls: e.ls, cycleIdOverride: cyc });
                        const s = backlogStatus(pending, maxNow);
                        if (s === "READY_FULL") acc.ready += 1;
                        else if (s === "PARTIAL_AVAILABLE") acc.partial += 1;
                        else acc.waiting += 1;
                        return acc;
                      },
                      { ready: 0, partial: 0, waiting: 0 },
                    );

                    return (
                      <div className="grid gap-2 rounded border border-slate-200 bg-white p-2 sm:grid-cols-3">
                        <Card className="border-emerald-200 bg-emerald-50 shadow-none">
                          <CardHeader className="p-3 pb-1">
                            <CardTitle className="text-[12px] font-semibold text-emerald-950">Ready to Dispatch</CardTitle>
                          </CardHeader>
                          <CardContent className="p-3 pt-0 text-[22px] font-bold tabular-nums text-emerald-950">
                            {summary.ready}
                          </CardContent>
                        </Card>
                        <Card className="border-amber-200 bg-amber-50 shadow-none">
                          <CardHeader className="p-3 pb-1">
                            <CardTitle className="text-[12px] font-semibold text-amber-950">Partial Available</CardTitle>
                          </CardHeader>
                          <CardContent className="p-3 pt-0 text-[22px] font-bold tabular-nums text-amber-950">
                            {summary.partial}
                          </CardContent>
                        </Card>
                        <Card className="border-slate-200 bg-slate-50 shadow-none">
                          <CardHeader className="p-3 pb-1">
                            <CardTitle className="text-[12px] font-semibold text-slate-800">Waiting for Stock/QC</CardTitle>
                          </CardHeader>
                          <CardContent className="p-3 pt-0 text-[22px] font-bold tabular-nums text-slate-900">
                            {summary.waiting}
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })()}
                  {selectedSo?.orderType === "NO_QTY" ? (
                    (() => {
                      const entries: Array<{ so: SoRow; ls: LineStat }> = noQtyLineEntries
                        ? noQtyLineEntries
                        : [...prepareQueueSections.flatMap((s) => s.rows), ...blockedLines];
                      const eps = 1e-9;
                      type OpState = "OPTIONAL_DISPATCH" | "AWAITING_QC" | "AWAITING_PRODUCTION" | "COMPLETED";
                      const stateLabel = (s: OpState): string => {
                        if (s === "OPTIONAL_DISPATCH") return "Optional Dispatch";
                        if (s === "AWAITING_QC") return "Awaiting QC";
                        if (s === "AWAITING_PRODUCTION") return "Awaiting Production";
                        return "Completed";
                      };

                      type Grouped = {
                        so: SoRow;
                        itemId: number;
                        itemName: string;
                        bestLs: LineStat;
                        usableAny: number;
                        dispatchableAny: number;
                        qcPendingAny: number;
                        customerPendingAny: number;
                        state: OpState;
                      };

                      const byKey = new Map<string, Grouped>();
                      for (const { so, ls } of entries) {
                        const key = `${so.id}-${ls.itemId}`;
                        const usable = lineAvailableStockTable(so, ls);
                        const cyc = normalizePositiveCycleId(so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId);
                        const dispatchable = computeDispatchableNow({ so, ls, cycleIdOverride: cyc });
                        const qcPending = safeNum(ls.qcPendingQty ?? 0);
                        const customerPending = linePendingOnOrderDisplay(ls);

                        const existing = byKey.get(key);
                        if (!existing) {
                          byKey.set(key, {
                            so,
                            itemId: ls.itemId,
                            itemName: ls.itemName,
                            bestLs: ls,
                            usableAny: usable,
                            dispatchableAny: dispatchable,
                            qcPendingAny: qcPending,
                            customerPendingAny: customerPending,
                            state: "COMPLETED",
                          });
                          continue;
                        }

                        existing.usableAny = Math.max(existing.usableAny, usable);
                        existing.dispatchableAny = Math.max(existing.dispatchableAny, dispatchable);
                        existing.qcPendingAny = Math.max(existing.qcPendingAny, qcPending);
                        existing.customerPendingAny = Math.max(existing.customerPendingAny, customerPending);

                        // Pick a single representative row for actions (best available action first).
                        const existingBestCyc = normalizePositiveCycleId(existing.so.noQtyDispatchContext?.selectedCycleId ?? existing.so.currentCycleId);
                        const existingBestDispatchable = computeDispatchableNow({
                          so: existing.so,
                          ls: existing.bestLs,
                          cycleIdOverride: existingBestCyc,
                        });
                        const score = (d: number, q: number, p: number) =>
                          (d > eps ? 3_000_000 + d : 0) + (q > eps ? 2_000 + q : 0) + (p > eps ? 1 + p : 0);
                        const existingScore = score(existingBestDispatchable, safeNum(existing.bestLs.qcPendingQty ?? 0), linePendingOnOrderDisplay(existing.bestLs));
                        const candidateScore = score(dispatchable, qcPending, customerPending);
                        if (candidateScore > existingScore) existing.bestLs = ls;
                      }

                      const groups: Grouped[] = [];
                      for (const g of byKey.values()) {
                        // Final state rule (explicitly matches your requirement):
                        // - If customer pending = 0 AND usable/dispatchable > 0 => Optional Dispatch
                        // - If customer pending = 0 AND usable/dispatchable = 0 AND no QC/prod pending => Completed
                        // Otherwise QC/prod states.
                        const hasOptional = g.customerPendingAny <= eps && (g.usableAny > eps || g.dispatchableAny > eps);
                        if (hasOptional) g.state = "OPTIONAL_DISPATCH";
                        else if (g.qcPendingAny > eps) g.state = "AWAITING_QC";
                        else if (g.customerPendingAny > eps) g.state = "AWAITING_PRODUCTION";
                        else g.state = "COMPLETED";
                        groups.push(g);
                      }

                      // Keep the queue operational: Optional Dispatch first, then Awaiting QC, then Awaiting Production, then Completed.
                      const rank = (s: OpState) =>
                        s === "OPTIONAL_DISPATCH" ? 0 : s === "AWAITING_QC" ? 1 : s === "AWAITING_PRODUCTION" ? 2 : 3;
                      groups.sort((a, b) => {
                        const r = rank(a.state) - rank(b.state);
                        if (r !== 0) return r;
                        if (a.so.id !== b.so.id) return a.so.id - b.so.id;
                        return a.itemName.localeCompare(b.itemName);
                      });
                      return (
                        <div className="overflow-hidden rounded border border-slate-200 bg-white">
                          <div className="overflow-x-hidden">
                            <table className="w-full table-fixed text-[12px]">
                              <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                                <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                  <th className="w-[6.75rem] px-2 py-1.5 font-medium">SO</th>
                                  <th className="px-2 py-1.5 font-medium">Item</th>
                                  <th className="w-[7.5rem] px-2 py-1.5 font-medium">Current State</th>
                                  <th className="w-[5.5rem] px-2 py-1.5 text-right font-medium">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {groups.map((g) => {
                                  const { so } = g;
                                  const ls = g.bestLs;
                                  const state = g.state;
                                  const selected = soId === so.id && salesOrderLineId === ls.lineId;
                                  const action =
                                    state === "OPTIONAL_DISPATCH"
                                      ? { label: "Prepare", kind: "prepare" as const }
                                      : state === "AWAITING_QC"
                                        ? { label: "Open QC", kind: "qc" as const }
                                        : state === "AWAITING_PRODUCTION"
                                          ? { label: "Open Prod.", kind: "prod" as const }
                                          : { label: "View", kind: "view" as const };
                                  return (
                                    <tr
                                      key={`${so.id}-${g.itemId}`}
                                      className={cn(
                                        "border-t border-slate-100 hover:bg-slate-50/70",
                                        operatorTableRowClass,
                                        selected && "bg-emerald-50",
                                      )}
                                    >
                                      <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px] text-slate-800">
                                        {displaySalesOrderNo(so.id, so.docNo)}
                                      </td>
                                      <td className="min-w-0 truncate px-2 py-1" title={g.itemName}>
                                        {g.itemName}
                                      </td>
                                      <td className="px-2 py-1 text-[11px] font-medium">
                                        <span
                                          className={cn(
                                            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                            state === "OPTIONAL_DISPATCH"
                                              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                                              : state === "AWAITING_QC"
                                                ? "border-amber-200 bg-amber-50 text-amber-950"
                                                : state === "AWAITING_PRODUCTION"
                                                  ? "border-sky-200 bg-sky-50 text-sky-950"
                                                  : "border-slate-200 bg-slate-100 text-slate-700",
                                          )}
                                        >
                                          {stateLabel(state)}
                                        </span>
                                      </td>
                                      <td className="px-2 py-0.5 text-right">
                                        <Button
                                          type="button"
                                          variant={action.kind === "prepare" ? "default" : "ghost"}
                                          size="sm"
                                          className={cn(
                                            "h-7 px-2 text-[11px] font-semibold",
                                            action.kind === "prepare" &&
                                              "bg-slate-900 text-white shadow-sm hover:bg-slate-950 active:bg-black",
                                          )}
                                          onClick={() => {
                                            if (action.kind === "prepare" || action.kind === "view") {
                                              selectLineFromBacklog(so, ls);
                                              return;
                                            }
                                            if (action.kind === "qc") {
                                              navigate(`/qc-entry?salesOrderId=${so.id}&fromStep=dispatch`);
                                              return;
                                            }
                                            navigate(`/production?salesOrderId=${so.id}&fromStep=dispatch`);
                                          }}
                                        >
                                          {action.label}
                                        </Button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()
                  ) : null}
                  {fromNoQtySo && focusSoIdValid && selectedSo?.orderType === "NO_QTY" ? null : (
                    <div className="max-h-[min(38vh,280px)] overflow-auto rounded border border-slate-200 bg-white">
                      <table className="w-full text-[13px]">
                      <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                        <tr className="text-left text-[12px] text-slate-600">
                          <th className="px-2 py-1 font-medium">Customer</th>
                          <th className="px-2 py-1 font-medium">SO No</th>
                          <th className="px-2 py-1 font-medium">Item</th>
                          <th className="px-2 py-1 text-right font-medium">Customer Pending</th>
                          <th className="px-2 py-1 text-right font-medium">Usable Stock</th>
                          <th className="px-2 py-1 text-right font-medium">Optional dispatch</th>
                          <th className="px-2 py-1 font-medium">Status</th>
                          <th className="px-2 py-1 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {noQtyLineEntries
                          ? noQtyLineEntries.map(({ so, ls }) => {
                              const selected = soId === so.id && salesOrderLineId === ls.lineId;
                              const cyc = normalizePositiveCycleId(
                                so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId,
                              );
                              const disp = computeDispatchableNow({ so, ls, cycleIdOverride: cyc });
                              const pend = linePendingOnOrderDisplay(ls);
                              const avail = lineAvailableStockTable(so, ls);
                              const status = backlogStatus(pend, disp);
                              const cycleLabel =
                                so.noQtyDispatchContext?.cycleLabel?.trim() ||
                                (cyc != null ? `Cycle #${cyc}` : "Cycle");
                              return (
                                <tr
                                  key={`${so.id}-${ls.lineId}-${ls.noQtyCycleId ?? "x"}`}
                                  className={cn(
                                    "border-t border-slate-100",
                                    operatorTableRowClass,
                                    selected && "bg-emerald-50 ring-2 ring-inset ring-emerald-500/40",
                                    fromNoQtySo && soId > 0 && so.id !== soId && "opacity-60",
                                  )}
                                >
                                  <td className="max-w-[10rem] truncate px-2 py-1 text-slate-900" title={customerDisplayName(so)}>
                                    {customerDisplayName(so)}
                                  </td>
                                  <td className="px-2 py-1 tabular-nums text-slate-900">
                                    <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-sky-900">
                                      {displaySalesOrderNo(so.id, so.docNo)}
                                    </span>
                                  </td>
                                  <td className="max-w-[10rem] truncate px-2 py-1 font-medium text-slate-900" title={ls.itemName}>
                                    {ls.itemName}
                                  </td>
                                  <td className="px-2 py-1 text-right tabular-nums text-slate-800">{fmtDispatchQty(pend)}</td>
                                  <td className="px-2 py-1 text-right tabular-nums text-slate-800">{fmtDispatchQty(avail)}</td>
                                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">
                                    {fmtDispatchQty(disp)}
                                  </td>
                                  <td className="px-2 py-1 text-[12px] text-slate-900">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={cn(
                                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                          backlogStatusBadgeClass(status),
                                        )}
                                      >
                                        {backlogStatusLabel(status)}
                                      </span>
                                      {isAdmin && noQtyAdminAdvancedOpen ? (
                                        <Badge variant="info" className="text-[11px]">
                                          {cycleLabel}
                                        </Badge>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1 text-right">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 shrink-0 p-0 text-[13px]"
                                      onClick={() => selectLineFromBacklog(so, ls)}
                                      aria-label={`Select ${ls.itemName}`}
                                    >
                                      ▶
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })
                          : prepareQueueSections.flatMap((section) => {
                              const header = (
                                <tr key={`hdr-${section.key}`} className="border-t border-slate-200 bg-slate-100">
                                  <td colSpan={8} className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                                    {section.label}
                                  </td>
                                </tr>
                              );
                              const body = section.rows.map(({ so, ls }) => {
                                const selected = soId === so.id && salesOrderLineId === ls.lineId;
                                const ready = computeDispatchableNow({
                                  so,
                                  ls,
                                  cycleIdOverride:
                                    so.orderType === "NO_QTY"
                                      ? normalizePositiveCycleId(so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId)
                                      : null,
                                });
                                const pend = linePendingOnOrderDisplay(ls);
                                const avail = lineAvailableStockTable(so, ls);
                                const status = backlogStatus(pend, ready);
                                return (
                                  <tr
                                    key={`${so.id}-${ls.lineId}-${ls.noQtyCycleId ?? "x"}`}
                                    className={cn(
                                      "border-t border-slate-100",
                                      operatorTableRowClass,
                                      selected && "bg-emerald-50 ring-2 ring-inset ring-emerald-500/40",
                                    )}
                                  >
                                    <td className="max-w-[10rem] truncate px-2 py-1 text-slate-900" title={customerDisplayName(so)}>
                                      {customerDisplayName(so)}
                                    </td>
                                    <td className="px-2 py-1 tabular-nums text-slate-900">
                                      <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-sky-900">
                                        {displaySalesOrderNo(so.id, so.docNo)}
                                      </span>
                                    </td>
                                    <td className="max-w-[10rem] truncate px-2 py-1 font-medium text-slate-900" title={ls.itemName}>
                                      {ls.itemName}
                                    </td>
                                    <td className="px-2 py-1 text-right tabular-nums text-slate-800">{fmtDispatchQty(pend)}</td>
                                    <td className="px-2 py-1 text-right tabular-nums text-slate-800">{fmtDispatchQty(avail)}</td>
                                    <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">{fmtDispatchQty(ready)}</td>
                                    <td className="px-2 py-1 text-[12px] text-slate-900">
                                      <span
                                        className={cn(
                                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                          backlogStatusBadgeClass(status),
                                        )}
                                      >
                                        {backlogStatusLabel(status)}
                                      </span>
                                      {status === "PARTIAL_AVAILABLE" ? (
                                        <div className="mt-0.5 text-[11px] text-amber-900">
                                          Available {fmtDispatchQty(ready)} / Pending {fmtDispatchQty(pend)}. You can dispatch partial qty now or wait.
                                        </div>
                                      ) : null}
                                    </td>
                                    <td className="px-2 py-1 text-right">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 shrink-0 p-0 text-[13px]"
                                        onClick={() => selectLineFromBacklog(so, ls)}
                                        aria-label={`Select ${ls.itemName}`}
                                      >
                                        ▶
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              });
                              return [header, ...body];
                            })}
                      </tbody>
                    </table>
                  </div>
                  )}
                  {prepareQueueRowCount === 0 && !noQtyLineEntries ? (
                    <p className="text-[13px] text-slate-600">
                      No lines with prepare headroom in this list. Choose a sales order and line above, or expand &quot;Cannot prepare now&quot;
                      for blocked lines.
                    </p>
                  ) : null}
                </section>
                ) : null}

          {selectedSo?.orderType !== "NO_QTY" &&
          !noQtyLineEntries &&
          !finalizePrepDraftMode &&
          (!showPreparedDispatchActionCard || showOpenLinesQueue) &&
          ((!showDispatchCompletedBillingCard && !showDispatchCompletedBillingFallback) || showOpenLinesQueue) ? (
          <section>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[13px] font-semibold text-slate-800 hover:bg-slate-100"
              onClick={() => setBlockedOpen((o) => !o)}
            >
              <span>Cannot prepare now ({blockedLines.length})</span>
              <span className="text-slate-500">{blockedOpen ? "▼" : "▶"}</span>
            </button>
            {blockedOpen ? (
              <div className="mt-1 max-h-64 overflow-auto rounded border border-slate-200 bg-white">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50">
                    <tr className="text-left text-[12px] text-slate-600">
                      <th className="px-2 py-1 font-medium">Customer</th>
                      <th className="px-2 py-1 font-medium">SO No</th>
                      <th className="px-2 py-1 font-medium">Item</th>
                      <th className="px-2 py-1 text-right font-medium">Customer Pending</th>
                      <th className="px-2 py-1 text-right font-medium">Usable Stock</th>
                      <th className="px-2 py-1 text-right font-medium">Optional dispatch</th>
                      <th className="px-2 py-1 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blockedLines.map(({ so, ls }) => {
                      const ready = computeDispatchableNow({
                        so,
                        ls,
                        cycleIdOverride:
                          so.orderType === "NO_QTY"
                            ? normalizePositiveCycleId(so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId)
                            : null,
                      });
                      const pend = linePendingOnOrderDisplay(ls);
                      const avail = lineAvailableStockTable(so, ls);
                      const status = backlogStatus(pend, ready);
                      return (
                        <tr key={`${so.id}-${ls.lineId}-${ls.noQtyCycleId ?? "x"}`} className={cn("border-t border-slate-100", operatorTableRowClass)}>
                          <td className="max-w-[10rem] truncate px-2 py-1 text-slate-900" title={customerDisplayName(so)}>
                            {customerDisplayName(so)}
                          </td>
                          <td className="px-2 py-1 tabular-nums">
                            <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-sky-900">
                              {displaySalesOrderNo(so.id, so.docNo)}
                            </span>
                          </td>
                          <td className="max-w-[10rem] truncate px-2 py-1" title={ls.itemName}>
                            {ls.itemName}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtDispatchQty(pend)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtDispatchQty(avail)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtDispatchQty(ready)}</td>
                          <td className="px-2 py-1 text-[12px] text-slate-900">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                backlogStatusBadgeClass(status),
                              )}
                            >
                              {backlogStatusLabel(status)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
                </section>
                ) : null}
              </div>
            }
            panel={
              <div className="space-y-2">
            {isAdmin && selectedSo?.orderType === "NO_QTY" ? (
              noQtyAdminDebugOpen ? (
                <NoQtyAdminDispatchDebugPanel
                  expanded={noQtyAdminDebugOpen}
                  onToggle={() => setNoQtyAdminDebugOpen(false)}
                  loading={noQtyDebugLoading}
                  error={noQtyDebugError}
                  json={noQtyDebugJson}
                  uiSnapshot={noQtyUiDebugSnapshot}
                  onLoad={() => void loadNoQtyDispatchDebug()}
                />
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    onClick={() => setNoQtyAdminDebugOpen(true)}
                    title="Admin / debug"
                  >
                    ⚙ <span>Debug</span>
                  </button>
                </div>
              )
            ) : null}
            {!showPreparedDispatchActionCard &&
            !showDispatchCompletedBillingCard &&
            !showDispatchCompletedBillingFallback ? (
            <Card className="min-w-0 overflow-hidden border-slate-200/90 shadow-sm ring-1 ring-slate-100/80">
              <CardHeader className="border-b border-slate-100 bg-gradient-to-b from-slate-50/90 to-white px-3 py-2.5">
                <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">
                  {finalizePrepDraftMode
                    ? "Prepared for finalization"
                    : reopenedPreparedDraftMode
                      ? "Reopened prepared draft"
                      : selectedSo?.orderType === "NO_QTY"
                        ? "Dispatch"
                        : "Ready to Dispatch"}
                </CardTitle>
              </CardHeader>
              {finalizePrepDraftMode ? (
                <CardContent className="px-3 py-3">
                  <p className="text-[12px] leading-snug text-slate-600">
                    Prepared draft on this line — finalize or delete to continue.
                  </p>
                </CardContent>
              ) : reopenedPreparedDraftMode && reopenedPreparedDraft ? (
                <CardContent className="px-3 py-3">
                  <p className="text-[12px] leading-snug text-slate-600">
                    Reopened from ledger — finalize or delete to continue (or use ledger actions below).
                  </p>
                </CardContent>
              ) : (
                <CardContent className="space-y-4 px-3 py-3">
                  {selectedSo?.orderType === "NO_QTY" ? (
                    <div className="space-y-2">
                      {/* 1) Compact Header Strip */}
                      <div className="rounded border border-slate-200 bg-white px-2 py-1 shadow-sm">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-700">
                          <span className="font-mono font-semibold text-slate-900">
                            {selectedSo ? displaySalesOrderNo(selectedSo.id, selectedSo.docNo) : "—"}
                          </span>
                          <span className="text-slate-300" aria-hidden>
                            |
                          </span>
                          <span className="max-w-[14rem] truncate">{selectedSo ? customerDisplayName(selectedSo) : "—"}</span>
                          <span className="text-slate-300" aria-hidden>
                            |
                          </span>
                          <span className="max-w-[14rem] truncate font-semibold text-slate-900" title={currentLine?.itemName ?? ""}>
                            {currentLine?.itemName ?? "—"}
                          </span>
                          <span className="text-slate-300" aria-hidden>
                            |
                          </span>
                          <span className="text-slate-600">
                            Cycle{" "}
                            <span className="font-semibold tabular-nums text-slate-900">
                              {currentLine?.noQtyCycleNo ?? selectedSo?.noQtyDispatchContext?.cycleNo ?? "—"}
                            </span>
                          </span>

                          <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
                            <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Customer Pending</span>
                              <span className="font-bold tabular-nums text-slate-900">{fmtDispatchQty(Math.max(0, remainingSoLine))}</span>
                            </span>
                            <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Usable Stock</span>
                              <span className="font-bold tabular-nums text-emerald-950">
                                {fmtDispatchQty(lineAvailableStockTable(selectedSo, currentLine ?? ({} as any)))}
                              </span>
                            </span>
                            <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">QC Hold</span>
                              <span className="font-bold tabular-nums text-amber-950">{fmtDispatchQty(Math.max(0, safeNum(currentLine?.qcHoldQty ?? 0)))}</span>
                            </span>
                            <span className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-2 py-0.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-800">Rework</span>
                              <span className="font-bold tabular-nums text-sky-950">{fmtDispatchQty(Math.max(0, safeNum(currentLine?.reworkQty ?? 0)))}</span>
                            </span>
                          </span>
                        </div>
                      </div>

                      {/* 2) Dispatch Action Card */}
                      <div className="rounded border border-slate-200 bg-white px-3 py-2 shadow-sm">
                        <div className="flex flex-wrap items-end justify-between gap-2">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Available Usable Stock</div>
                            <div className="mt-0.5 text-[34px] font-bold tabular-nums leading-none text-slate-950">
                              {fmtDispatchQty(headroomToPrepare)}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-600">Optional dispatch available.</div>
                          </div>

                          <div className="w-full max-w-[30rem]">
                            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                              <FieldShortcutHint
                                show={shortcutHints.activeFieldId === "dispatchQty"}
                                hint={shortcutHints.activeFieldHintText ?? ""}
                                placement="below-end"
                                className="block w-full min-w-0"
                              >
                                <div className="erp-form-field min-w-0">
                                  <span className="text-[11px] font-medium text-slate-600">Dispatch Qty</span>
                                  <Input
                                    ref={dispatchQtyRef}
                                    {...dispatchQtyBind}
                                    type="text"
                                    data-testid="dispatch-qty-input"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    className={cn("mt-0.5 h-9 tabular-nums text-[14px]", operatorInputClass)}
                                    placeholder="Qty"
                                    value={dispatchQtyStr}
                                    disabled={qtyInputDisabled}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                        shortcutHints.markFieldShortcutUsed("dispatchPrepare");
                                        void onDispatch();
                                      }
                                      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                                        shortcutHints.markFieldShortcutUsed("dispatchQty");
                                      }
                                    }}
                                  />
                                </div>
                              </FieldShortcutHint>

                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                data-testid="prepare-dispatch-btn"
                                className="h-9 w-full bg-slate-900 px-3 text-[13px] font-semibold text-white shadow-sm hover:bg-slate-950 active:bg-black sm:w-auto"
                                disabled={!canNoQtyDispatchNow || dispatching}
                                onClick={() => {
                                  shortcutHints.markFieldShortcutUsed("dispatchPrepare");
                                  void onDispatch();
                                }}
                              >
                                {dispatching ? "Saving…" : "Dispatch Now"}
                              </Button>

                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-9 w-full px-3 text-[13px] font-semibold sm:w-auto"
                                disabled={dispatching}
                                onClick={() => {
                                  setError(null);
                                  resetDispatchQty();
                                }}
                              >
                                Keep for Later
                              </Button>
                            </div>

                            <div className="text-[11px] text-slate-600">
                              This dispatch uses stock from{" "}
                              <span className="font-semibold">Cycle {currentLine?.noQtyCycleNo ?? selectedSo?.noQtyDispatchContext?.cycleNo ?? "—"}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Recent Dispatch Ledger (latest 5) */}
                      <div className="overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Recent Dispatch Ledger</div>
                          <details>
                            <summary className="cursor-pointer select-none text-[11px] font-medium text-sky-800 underline decoration-sky-800/40 underline-offset-2 hover:text-sky-950">
                              View Full History
                            </summary>
                            <div className="mt-2">{renderSoDispatchLedger("panel")}</div>
                          </details>
                        </div>
                        <div className="overflow-x-hidden">
                          <table className="w-full table-fixed text-[12px]">
                            <thead>
                              <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                <th className="w-[7.25rem] px-2 py-1.5 font-medium">Dispatch No</th>
                                <th className="w-[4.25rem] px-2 py-1.5 text-right font-medium">Qty</th>
                                <th className="w-[6rem] px-2 py-1.5 font-medium">Date</th>
                                <th className="w-[6.25rem] px-2 py-1.5 font-medium">Status</th>
                                <th className="px-2 py-1.5 font-medium">Sales Bill</th>
                                <th className="w-[4.5rem] px-2 py-1.5 text-right font-medium">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(ledgerRows || [])
                                .filter((r) => r.soId === selectedSo.id && r.itemId === (currentLine?.itemId ?? r.itemId))
                                .slice(0, 5)
                                .map((r) => {
                                  const status =
                                    r.reversalOfId != null ? ("REVERSAL" as const) : r.workflowStatus === "UNLOCKED" ? ("PREPARED" as const) : ("DISPATCH" as const);
                                  return (
                                  <tr
                                    key={r.id}
                                    className={cn("border-t border-slate-100 hover:bg-slate-50/70", operatorTableRowClass)}
                                  >
                                    <td className="px-2 py-1 font-mono text-[11px]">
                                      <button
                                        type="button"
                                        className="text-left font-semibold text-sky-900 underline decoration-sky-900/30 underline-offset-2 hover:text-sky-950"
                                        onClick={() => {
                                          const el = document.getElementById(`so-dispatch-ledger-row-${r.id}`);
                                          if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                                        }}
                                        title="Jump to full history row"
                                      >
                                        {displayDispatchNo(r.id, r.docNo)}
                                      </button>
                                    </td>
                                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtDispatchQty(safeNum(r.dispatchedQty))}</td>
                                    <td className="px-2 py-1 tabular-nums text-slate-700">{String(r.date).slice(0, 10)}</td>
                                    <td className="px-2 py-1 text-[11px]">
                                      <span
                                        className={cn(
                                          "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                          status === "DISPATCH"
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                                            : status === "PREPARED"
                                              ? "border-amber-200 bg-amber-50 text-amber-950"
                                              : "border-slate-200 bg-slate-100 text-slate-700",
                                        )}
                                      >
                                        {status === "DISPATCH" ? "Dispatch" : status === "PREPARED" ? "Prepared" : "Reversal"}
                                      </span>
                                    </td>
                                    <td className="px-2 py-1 text-[11px] text-slate-700">
                                      {r.salesBillExists ? (r.salesBillIsExported ? "Created (exported)" : "Created") : "—"}
                                    </td>
                                    <td className="px-2 py-1 text-right text-[11px] text-slate-500">—</td>
                                  </tr>
                                )})}
                              {(ledgerRows || []).filter((r) => r.soId === selectedSo.id && r.itemId === (currentLine?.itemId ?? r.itemId)).length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="px-3 py-2 text-[12px] text-slate-600">
                                    No dispatch history for this line yet.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                  <div className="rounded-lg border border-slate-200/90 bg-slate-50/90 px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Quantity</div>
                    <p className="mt-1 text-[13px] font-medium leading-snug text-slate-900">
                      {headroomToPrepare > 1e-9 ? (
                          <>
                            Ready to dispatch{" "}
                            <span className="tabular-nums text-emerald-800">{fmtDispatchQty(headroomToPrepare)}</span> units
                            {existingDraftQty > 1e-9 ? (
                              <span className="block text-[12px] font-normal text-slate-600">
                                Prepared draft on this line: {fmtDispatchQty(existingDraftQty)} · additional headroom shown above
                              </span>
                            ) : null}
                          </>
                      ) : (
                        <span className="text-slate-600">Nothing dispatchable on this line right now.</span>
                      )}
                    </p>
                    {dispatchQtyHintPrimary ? (
                      <p className="mt-1.5 text-[11px] leading-snug text-slate-600">{dispatchQtyHintPrimary}</p>
                    ) : null}
                  </div>

                  {needsPartialDispatchAck && !reopenedPreparedDraftMode ? (
                    <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[12px] text-slate-800">
                      <p className="text-[12px] font-medium leading-snug text-slate-800">
                        Only {fmtDispatchQty(readyToShip)} available against pending {fmtDispatchQty(remainingSoLine)}.
                      </p>
                      <label className="mt-2 flex cursor-pointer items-start gap-2 text-[12px] font-medium text-slate-800">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                          checked={normalPartialDispatchAck}
                          onChange={(e) => setNormalPartialDispatchAck(e.target.checked)}
                        />
                        <span>I want to dispatch partial quantity now</span>
                      </label>
                    </div>
                  ) : null}

                  {needsPartialDispatchAck && selectedSo && currentLine ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-9 w-full text-[12px] sm:w-auto"
                      disabled={dispatching || dispatchReadOnly}
                      onClick={async () => {
                        setError(null);
                        recordDispatchPartialWaitChoice(selectedSo.id, currentLine.lineId, currentLine.itemId);

                        if (selectedSo.orderType === "NO_QTY") {
                          const cyc =
                            normalizePositiveCycleId(noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId) ??
                            null;
                          navigate(
                            buildNoQtyGuidedHref({
                              to: "/production?source=no_qty_so",
                              salesOrderId: selectedSo.id,
                              cycleId: cyc,
                              fromStep: "dispatch",
                            }),
                          );
                          return;
                        }

                        try {
                          const rows = await apiFetch<any>(
                            `/api/production/work-orders?salesOrderId=${selectedSo.id}&pendingOnly=1`,
                          );
                          const hasAny = Array.isArray(rows) && rows.length > 0;
                          if (hasAny) {
                            navigate(`/production?salesOrderId=${selectedSo.id}&fromStep=dispatch`);
                            return;
                          }
                        } catch {
                          // no-op
                        }
                        navigate(`/work-orders?so=${selectedSo.id}`);
                      }}
                    >
                      Plan / Continue Production
                    </Button>
                  ) : null}

                  {headroomToPrepare > 1e-9 ? (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        data-testid="prepare-dispatch-btn"
                        className="h-10 w-full text-[13px] font-semibold shadow-sm"
                        disabled={dispatching || !canDispatchFull}
                        onClick={() => {
                          shortcutHints.markFieldShortcutUsed("dispatchPrepare");
                          void onDispatchFullPrepare();
                        }}
                      >
                        {dispatching
                          ? "Saving…"
                          : existingDraftQty > 1e-9
                            ? "Update dispatch (full headroom)"
                            : "Dispatch Full"}
                      </Button>
                      {noQtyBlocked ? (
                        <p className="text-[11px] text-slate-600">{currentLine ? noQtyBlockedReasonPlain(currentLine) : "Cannot dispatch now"}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {headroomToPrepare > 1e-9 ? (
                    <div className="border-t border-slate-200 pt-3">
                      {!isPartialMode ? (
                        <button
                          type="button"
                          className="text-[12px] font-medium text-sky-800 underline decoration-sky-800/40 underline-offset-2 hover:text-sky-950"
                          onClick={() => {
                            setError(null);
                            resetDispatchQty();
                            setIsPartialMode(true);
                          }}
                        >
                          Need partial dispatch?
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[12px] font-medium text-slate-800">Partial dispatch</p>
                            <button
                              type="button"
                              className="text-[11px] font-medium text-slate-500 underline decoration-slate-400 underline-offset-2 hover:text-slate-700"
                              onClick={() => {
                                setError(null);
                                setIsPartialMode(false);
                                resetDispatchQty();
                              }}
                            >
                              Hide
                            </button>
                          </div>
                          <p className="text-[11px] leading-snug text-slate-500">
                            Max dispatchable now: <span className="font-semibold tabular-nums">{fmtDispatchQty(headroomToPrepare)}</span> units.
                          </p>
                          <FieldShortcutHint
                            show={shortcutHints.activeFieldId === "dispatchQty"}
                            hint={shortcutHints.activeFieldHintText ?? ""}
                            placement="below-end"
                            className="block w-full min-w-0"
                          >
                            <div className="erp-form-field min-w-0">
                              <span className="text-[12px] font-medium text-slate-600">Quantity</span>
                              <Input
                                ref={dispatchQtyRef}
                                {...dispatchQtyBind}
                                type="text"
                                data-testid="dispatch-qty-input"
                                inputMode="decimal"
                                autoComplete="off"
                                className="mt-0.5 h-9 tabular-nums text-[13px]"
                                placeholder="Enter qty"
                                value={dispatchQtyStr}
                                disabled={qtyInputDisabled}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                                    shortcutHints.markFieldShortcutUsed("dispatchQty");
                                  }
                                }}
                              />
                              {isPartialMode && qtyMatchesFullHeadroom ? (
                                <p className="mt-1 text-[11px] font-medium text-sky-900">Use Dispatch Full for full quantity.</p>
                              ) : null}
                              {salesOrderLineId > 0 &&
                              currentLine &&
                              selectedSo &&
                              dispatchQtyValid &&
                              dispatchQtyParsed != null &&
                              dispatchQtyParsed > readyToShip + 1e-9 ? (
                                <p className="mt-0.5 text-[11px] font-medium text-red-800">
                                  Cannot dispatch more than available/pending quantity.
                                </p>
                              ) : null}
                              {salesOrderLineId > 0 &&
                              currentLine &&
                              isPartialMode &&
                              !dispatchQtyValid &&
                              dispatchQtyStr.trim() !== "" ? (
                                <p className="mt-0.5 text-[11px] font-medium text-amber-800">Enter a valid quantity</p>
                              ) : null}
                            </div>
                          </FieldShortcutHint>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid="dispatch-qty-btn"
                            className="h-9 w-full font-semibold sm:w-auto"
                            disabled={!partialDispatchQtySubmit || dispatching}
                            onClick={() => {
                              shortcutHints.markFieldShortcutUsed("dispatchPrepare");
                              void onDispatch();
                            }}
                          >
                            {dispatching ? "Saving…" : existingDraftQty > 0 ? "Update Prepared Dispatch" : "Dispatch Qty"}
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : null}
                    </>
                  )}
                </CardContent>
              )}
            </Card>
            ) : null}

            {currentLine && selectedSo ? (
              <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                {existingDraftQty > 0 && !showPreparedDispatchActionCard ? (
                  <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] text-amber-900">
                    <span className="font-medium">
                      <Badge variant="warning" className="mr-1.5 align-middle text-[10px]">
                        Prepared
                      </Badge>
                      Prepared qty: <span className="tabular-nums font-bold">{fmtDispatchQty(existingDraftQty)}</span>
                      {!finalizePrepDraftMode ? (
                        <>
                          {" · "}
                          Additional headroom:{" "}
                          <span className="tabular-nums font-bold">{fmtDispatchQty(headroomToPrepare)}</span>
                        </>
                      ) : null}
                    </span>
                    {!finalizePrepDraftMode ? (
                      <span className="mt-0.5 block text-[11px] text-amber-900/90">
                        Updating dispatch replaces this prepared row (no duplicate drafts).
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {selectedSoReplacement ? (
                  <div className="text-[12px] text-slate-700">
                    <Badge variant="warning" className="mr-1.5 text-[10px]">
                      Replacement
                    </Badge>
                    <span className="font-mono text-[11px]">
                      {selectedSo?.customerReturnId ? `RET-${String(selectedSo.customerReturnId).padStart(6, "0")}` : "—"}
                    </span>
                    {" · "}
                    <span className="font-mono text-[11px]">
                      {selectedSo?.originalSalesOrderId ? `SO-${selectedSo.originalSalesOrderId}` : "—"}
                    </span>
                    {" · "}
                    <span className="font-mono text-[11px]">
                      {selectedSo?.originalDispatchId ? `DSP-${String(selectedSo.originalDispatchId).padStart(6, "0")}` : "—"}
                    </span>
                  </div>
                ) : null}
                {currentLine.isFree ? (
                  <div className="text-[12px] text-emerald-900">
                    <Badge variant="success" className="mr-1.5 text-[10px]">
                      Free line
                    </Badge>
                    Commercial only — qty rules unchanged.
                  </div>
                ) : null}
              </div>
            ) : null}

            {!showPreparedDispatchActionCard ? renderSoDispatchLedger("panel") : null}
              </div>
            }
          />
        </div>
      )}

      {!showPreparedDispatchActionCard ? (
      <div ref={dispatchHistoryAnchorRef} id="dispatch-page-history" className="scroll-mt-24">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="py-2 pb-1">
          <CardTitle className="text-sm font-semibold">Dispatch History</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0">
          {!isAdmin ? (
            <div className="mb-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[13px] text-slate-700">
              Only Admin can reverse dispatch.
            </div>
          ) : null}
          <div className="mb-2 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="flex flex-wrap items-end gap-2">
              <div className="erp-form-field min-w-[9rem]">
                <span className="text-[12px] font-medium text-slate-600">From</span>
                <Input
                  type="date"
                  className="mt-0.5 h-8 w-full tabular-nums text-[13px]"
                  value={ledgerDateFrom}
                  onChange={(e) => {
                    setLedgerDateFrom(e.target.value);
                    setLedgerPage(1);
                  }}
                />
              </div>
              <div className="erp-form-field min-w-[9rem]">
                <span className="text-[12px] font-medium text-slate-600">To</span>
                <Input
                  type="date"
                  className="mt-0.5 h-8 w-full tabular-nums text-[13px]"
                  value={ledgerDateTo}
                  onChange={(e) => {
                    setLedgerDateTo(e.target.value);
                    setLedgerPage(1);
                  }}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 text-[13px]"
                onClick={() => {
                  setLedgerDateFrom("");
                  setLedgerDateTo("");
                  setLedgerPage(1);
                }}
              >
                Clear dates
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 min-w-[5rem]"
                disabled={!canLedgerPrev}
                onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              {ledgerTotal > 0 ? (
                <span className="text-[12px] tabular-nums text-slate-600">
                  Page {ledgerPage} of {ledgerLastPage}
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 min-w-[5rem]"
                disabled={!canLedgerNext}
                onClick={() => setLedgerPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
          <p className="mb-1.5 text-[12px] text-slate-600">{ledgerInfoText}</p>
          {ledgerTotal > 0 && !ledgerRows.length ? (
            <p className="mb-2 text-[13px] text-slate-600">No rows on this page.</p>
          ) : null}
          {ledgerRows.length > 0 ? (
            <div className="max-h-[min(50vh,360px)] overflow-auto">
              {(() => {
                // History = forward finalized dispatch rows only (no "pending" concept here).
                const forwards = ledgerRows.filter(
                  (r) => r.reversalOfId == null && r.workflowStatus === "LOCKED" && Number(r.dispatchedQty) > 0,
                );
                const reversedSumByForwardId = new Map<number, number>();
                for (const r of ledgerRows) {
                  if (r.reversalOfId == null) continue;
                  const fwdId = Number(r.reversalOfId);
                  if (!Number.isFinite(fwdId) || fwdId <= 0) continue;
                  const qty = Math.abs(Number(r.dispatchedQty || 0));
                  reversedSumByForwardId.set(fwdId, (reversedSumByForwardId.get(fwdId) || 0) + qty);
                }

                const rows = forwards.map((d) => {
                  const fwdQty = Number(d.dispatchedQty);
                  const rev = reversedSumByForwardId.get(d.id) || 0;
                  const balanceQty = Math.max(0, fwdQty - rev);
                  const eps = 1e-9;
                  const status =
                    rev <= eps
                      ? ("DISPATCHED" as const)
                      : rev + eps < fwdQty
                        ? ("PARTIALLY_REVERSED" as const)
                        : ("FULLY_REVERSED" as const);
                  return {
                    ...d,
                    forwardQty: fwdQty,
                    reversedQty: rev,
                    balanceQty,
                    status,
                  };
                });

                const dispatchedCount = rows.filter((r) => r.status === "DISPATCHED").length;
                const partialCount = rows.filter((r) => r.status === "PARTIALLY_REVERSED").length;
                const fullCount = rows.filter((r) => r.status === "FULLY_REVERSED").length;

                return (
                  <>
                    <div className="mb-2 text-[12px] text-slate-700">
                      <span className="font-medium">Dispatch Status:</span>{" "}
                      <span className="tabular-nums font-semibold text-emerald-900">{dispatchedCount} Dispatched</span>{" "}
                      <span className="text-slate-400">|</span>{" "}
                      <span className="tabular-nums font-semibold text-amber-900">{partialCount} Partially Reversed</span>{" "}
                      <span className="text-slate-400">|</span>{" "}
                      <span className="tabular-nums font-semibold text-rose-900">{fullCount} Fully Reversed</span>
                    </div>

                    <table className="erp-table erp-table-dense w-full text-[13px]">
                      <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                        <tr className="text-left text-[12px] text-slate-600">
                          <th className="pr-3">Dispatch No</th>
                          <th className="py-1.5 pr-3">Date</th>
                          <th className="py-1.5 pr-3">Customer</th>
                          <th className="py-1.5 pr-3">Item</th>
                          <th className="py-1.5 pr-3 text-right">Qty</th>
                          <th className="py-1.5 pr-3 text-right">Reversed</th>
                          <th className="py-1.5 pr-3 text-right">Balance</th>
                          <th className="py-1.5 pr-3">Status</th>
                          <th className="py-1.5 pr-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((d) => {
                          const rowClass =
                            d.status === "DISPATCHED"
                              ? "bg-emerald-50/60 hover:bg-emerald-50"
                              : d.status === "PARTIALLY_REVERSED"
                                ? "bg-amber-50/70 hover:bg-amber-50"
                                : "bg-rose-50/60 hover:bg-rose-50";
                          const pillClass =
                            d.status === "DISPATCHED"
                              ? "border-emerald-300 bg-emerald-100 text-emerald-950"
                              : d.status === "PARTIALLY_REVERSED"
                                ? "border-amber-300 bg-amber-100 text-amber-950"
                                : "border-rose-300 bg-rose-100 text-rose-950";
                          const pillLabel =
                            d.status === "DISPATCHED"
                              ? "Dispatched"
                              : d.status === "PARTIALLY_REVERSED"
                                ? "Partially Reversed"
                                : "Fully Reversed";
                          return (
                            <tr key={d.id} className={cn("border-t border-slate-100 transition-colors", rowClass)}>
                              <td className="py-2 pr-3 tabular-nums">
                                <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-violet-900">
                                  {displayDispatchNo(d.id, d.docNo)}
                                </span>
                              </td>
                              <td className="py-2 pr-3">{new Date(d.date).toLocaleString()}</td>
                              <td className="py-2 pr-3">{d.customerName || "—"}</td>
                              <td className="py-2 pr-3">{d.itemName || `Item #${d.itemId}`}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{fmtDispatchQty(d.forwardQty)}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {d.reversedQty > 1e-9 ? fmtDispatchQty(d.reversedQty) : "—"}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {d.status === "PARTIALLY_REVERSED" ? fmtDispatchQty(d.balanceQty) : "—"}
                              </td>
                              <td className="py-2 pr-3">
                                <span className={cn("inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium", pillClass)}>
                                  {pillLabel}
                                </span>
                              </td>
                              <td className="py-2 pr-2 align-top">
                                {isRegularNormalLedgerSoOrderType(d.soOrderType) ? (
                                  d.status === "DISPATCHED" ? (
                                    d.salesBillExists === true && d.salesBillId != null && Number(d.salesBillId) > 0 ? (
                                      <Link
                                        to={`/sales-bills/${d.salesBillId}?from=dispatch`}
                                        className="text-[12px] font-semibold text-sky-800 underline decoration-sky-800/40 underline-offset-2 hover:text-sky-950"
                                      >
                                        View Sales Bill
                                      </Link>
                                    ) : (
                                      <Link
                                        to={`/sales-bills/new?dispatchId=${d.id}&from=dispatch`}
                                        className="text-[12px] font-semibold text-sky-800 underline decoration-sky-800/40 underline-offset-2 hover:text-sky-950"
                                      >
                                        Create Sales Bill
                                      </Link>
                                    )
                                  ) : (
                                    <span className="text-[11px] text-slate-500">—</span>
                                  )
                                ) : (
                                  <span className="text-[11px] text-slate-500">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                );
              })()}
            </div>
          ) : null}
        </CardContent>
      </Card>
      </div>
      ) : null}

      <OperationalWorkspaceFooter className="max-w-full" sections={dispatchUnifiedFooterSections} />

      </OperatorPageBody>
    </PageContainer>
  );
}
