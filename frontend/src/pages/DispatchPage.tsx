import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch, ApiRequestError } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useDependentFieldFocus } from "../hooks/useDependentFieldFocus";
import { useMandatoryPositiveQtyDraft } from "../hooks/useMandatoryPositiveQtyDraft";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useShortcutHints } from "../hooks/useShortcutHints";
import { FieldShortcutHint } from "../components/ui/FieldShortcutHint";
import { ShortcutHintBar } from "../components/ui/ShortcutHintBar";
import {
  DISPATCH_SHORTCUT_BAR,
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
import {
  NoQtyCycleBanner,
  PageContainer,
  PageHeader,
  PageNoQtyFlowBackLink,
  PageSmartBackLink,
  StickyWorkspaceHead,
} from "../components/PageHeader";
import { NextStepStrip } from "../components/erp/NextStepStrip";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { displayDispatchNo, displaySalesOrderNo } from "../lib/docNoDisplay";
import { ActivityHistoryCard } from "../components/ActivityHistoryCard";
import { buildNoQtyGuidedHref, useNoQtyFlowState } from "../lib/noQtyFlowState";
import { useToast } from "../contexts/ToastContext";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { DemoSafeNoQtyContinue } from "../components/demo/DemoSafeNoQtyContinue";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";
import { NoQtyFlowStepsCard } from "../components/erp/NoQtyFlowStepsCard";

/** Soft flag for optional dashboard reminders — user chose “wait” on NORMAL partial dispatch (no API). */
const DISPATCH_PARTIAL_WAIT_STORAGE_PREFIX = "erp:dispatch:partial-wait:";

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
  status: string;
  lockedRequirementSheetId: number | null;
};

const NO_QTY_BLOCK_EPS = 1e-9;

/** Operator-facing one-liner for queue / Cannot Dispatch Now (NO_QTY). */
function noQtyBlockedReasonPlain(ls: LineStat): string {
  const stock = safeNum(ls.usableQcPassedStock ?? ls.onHand ?? ls.totalStock);
  // If base headroom exists (before draft), treat as dispatchable for blocked-reason purposes.
  if (stock > NO_QTY_BLOCK_EPS) return "—";
  if (stock <= NO_QTY_BLOCK_EPS) return "No QC-passed stock";
  return "Cannot dispatch now";
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
  const stock = safeNum(ls.usableQcPassedStock ?? ls.onHand ?? ls.totalStock);
  const lastShort = safeNum(ls.lastShortageQty);

  if (existingDraftQty > NO_QTY_BLOCK_EPS && headroomToPrepare <= NO_QTY_BLOCK_EPS) {
    return "Draft ready — click Finalize to confirm dispatch.";
  }
  if (stock <= NO_QTY_BLOCK_EPS) {
    return "Cannot dispatch: no usable QC-passed stock is available. Release QC-passed FG into usable stock, then try again.";
  }
  if (lastShort > NO_QTY_BLOCK_EPS) {
    return "Nothing is dispatchable from usable stock. If you still have shortage, continue production and QC.";
  }
  return "Cannot dispatch right now. Check usable stock and any prepared draft.";
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
      ? normalizePositiveCycleId(a.so.noQtyDispatchContext?.selectedCycleId ?? a.so.currentCycleId)
      : null;
  const cycleB =
    b.so.orderType === "NO_QTY"
      ? normalizePositiveCycleId(b.so.noQtyDispatchContext?.selectedCycleId ?? b.so.currentCycleId)
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
  const usable = getUsableStock(ls);
  if (so.orderType === "NO_QTY") {
    // NO_QTY rule: dispatch for the current cycle is limited by the current RS qty and usable stock.
    // Previous dispatch quantities are history only (not used to reduce the current cap).
    const rsQty = safeNum(ls.cycleCap);
    return Math.max(0, Math.min(rsQty, usable));
  }
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

/**
 * NO_QTY only: "auto-ready" dispatch is QC-backed dispatch headroom.
 *
 * Business intent: stock that becomes usable later via rework approvals should remain usable,
 * but should not be auto-surfaced as the next compulsory dispatch just because cycle cap has room.
 * We therefore treat only cycle QC-accepted qty (excluding recheck/rework approvals) as auto-ready.
 *
 * This does NOT change backend validation or the ability to dispatch intentionally when usable stock exists.
 */
function computeNoQtyAutoReadyQty(params: { so: SoRow; ls: LineStat }): number {
  const { so, ls } = params;
  if (so.orderType !== "NO_QTY") return 0;
  const qcAccepted = safeNum(ls.cycleQcAcceptedQty ?? ls.qcAccepted);
  const alreadyOpNet = safeNum(ls.operationalNetDispatchedQty ?? ls.cycleDispatchedQty ?? 0);
  const qcBackedRemaining = Math.max(0, qcAccepted - alreadyOpNet);
  // Auto-ready is still QC-backed, but not cycle-capped.
  return Math.max(0, qcBackedRemaining);
}

function computeDispatchableNow(params: {
  so: SoRow;
  ls: LineStat;
  /** NO_QTY only: override selected cycle id */
  cycleIdOverride?: number | null;
}): number {
  const { so, ls, cycleIdOverride } = params;
  const base = computeDispatchableBaseNoDraft({ so, ls });
  const existingDraftQty = draftQtyForSoItem(so, ls.itemId, cycleIdOverride);
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
    const cycleId =
      so.orderType === "NO_QTY"
        ? normalizePositiveCycleId(so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId)
        : null;
    for (const ls of so.lineStats || []) {
      const qty =
        so.orderType === "NO_QTY"
          ? computeNoQtyAutoReadyQty({ so, ls })
          : computeDispatchableNow({ so, ls, cycleIdOverride: cycleId });
      if (!(qty > 1e-9)) continue;
      const tier = so.orderType === "NO_QTY" ? 0 : normalPartialPrepareTier(so, ls);
      if (
        !best ||
        tier < best.tier ||
        (Math.abs(tier - best.tier) < 1e-9 && qty > best.qty + 1e-9)
      ) {
        best = { soId: so.id, lineId: ls.lineId, cycleId, qty, tier };
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
    const cyc = normalizePositiveCycleId(noQtySelectedCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId);
    if (cyc == null) return false;
    // Still actionable if either draft exists for this context or dispatchable now > 0.
    const draftQty = draftQtyForSoItem(so, ls.itemId, cyc);
    if (draftQty > 1e-9) return true;
    const can = computeDispatchableNow({ so, ls, cycleIdOverride: cyc });
    return can > 1e-9;
  }
  const draftQty = draftQtyForSoItem(so, ls.itemId, null);
  if (draftQty > 1e-9) return true;
  return computeDispatchableNow({ so, ls }) > 1e-9;
}

function buildReadySorted(rows: SoRow[]): { so: SoRow; ls: LineStat }[] {
  const flat = rows.flatMap((so) => so.lineStats.map((ls) => ({ so, ls })));
  return flat
    .filter(({ so, ls }) => {
      const cycleId =
        so.orderType === "NO_QTY"
          ? normalizePositiveCycleId(so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId)
          : null;
      if (so.orderType === "NO_QTY") {
        return computeNoQtyAutoReadyQty({ so, ls }) > 1e-9;
      }
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
  return rows.flatMap((so) => so.lineStats.map((ls) => ({ so, ls })));
}

function confirmedBacklogQty(ls: LineStat): number {
  return Math.max(0, Number(ls.pendingDispatchQty ?? 0));
}

function draftQtyForSoItem(so: SoRow | undefined, itemId: number, noQtySelectedCycleId?: number | null): number {
  if (!so || !itemId) return 0;
  const want =
    so.orderType === "NO_QTY"
      ? normalizePositiveCycleId(noQtySelectedCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId)
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

/** Business-friendly line status; does not change dispatch math. */
function lineDispatchStatusFriendly(so: SoRow, ls: LineStat, noQtySelectedCycleId?: number | null): string {
  if (so.orderType === "NO_QTY") {
    const cyc = normalizePositiveCycleId(noQtySelectedCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId);
    const ready = computeDispatchableNow({ so, ls, cycleIdOverride: cyc });
    const autoReady = computeNoQtyAutoReadyQty({ so, ls });
    const draft = draftQtyForSoItem(so, ls.itemId, noQtySelectedCycleId);
    if (autoReady > 1e-9) return "🟢 Ready";
    if (ready > 1e-9) return "Stock available (optional)";
    if (draft > 1e-9) return "Prepared dispatch";
    return noQtyBlockedReasonPlain(ls);
  }
  if (confirmedBacklogQty(ls) <= 1e-9) return "Done";
  const draft = draftQtyForSoItem(so, ls.itemId, noQtySelectedCycleId);
  const stock = Number(ls.totalStock ?? ls.onHand ?? 0);
  if (isRegularNormalSalesOrder(so)) {
    if (draft > 1e-9) return "Draft prepared";
    if (stock <= 1e-9) return "No stock";
    const dispNow = computeDispatchableNow({ so, ls });
    if (dispNow > 1e-9) {
      return effectiveRegularDispatchReadiness(so, ls) === "PARTIAL_AVAILABLE" ? "Partial" : "Ready to dispatch";
    }
    return "Cannot prepare now";
  }
  const ready = computeDispatchableNow({ so, ls });
  if (ready > 1e-9) return "🟢 Ready";
  if (draft > 1e-9) return "Draft prepared";
  if (stock <= 1e-9) return "No stock";
  if (so.orderType === "REPLACEMENT") return "Not ready to ship";
  return "Pending QC";
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
            <p className="mt-0.5 text-[9px] text-slate-500">Traceability only — dispatch uses usable stock within Planned Qty.</p>
          </div>
          <div className="rounded border border-sky-100 bg-white/80 px-2 py-1.5">
            <dt className="text-[10px] font-medium text-slate-600">Usable QC-Passed Stock</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(usable)}</dd>
          </div>
          <div className="rounded border border-emerald-200 bg-emerald-50/90 px-2 py-1.5 sm:col-span-2 lg:col-span-1">
            <dt className="text-[10px] font-medium text-emerald-900/90">Dispatchable Now</dt>
            <dd className="text-[15px] font-bold tabular-nums text-emerald-950">{fmtDispatchQty(readyToShip)}</dd>
            <p className="mt-0.5 text-[9px] text-emerald-900/80">min(remaining cycle capacity, usable stock), after prepared draft.</p>
          </div>
        </dl>
        {readyToShip <= NO_QTY_BLOCK_EPS && noQtyNextAction ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50/90 px-2 py-1.5 text-[11px] font-medium text-amber-950">{noQtyNextAction}</p>
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
        <span>Admin · Show dispatch debug</span>
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
  const { state: noQtyFlowState } = useNoQtyFlowState(focusSoIdValid ? focusSoId : null, fromNoQtySo && focusSoIdValid);

  const isAdmin = useIsAdmin();
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
  const [noQtyLastFinalizedDispatchId, setNoQtyLastFinalizedDispatchId] = React.useState<number | null>(null);
  const [reopenedPreparedDraft, setReopenedPreparedDraft] = React.useState<{
    id: number;
    workflowStatus: "UNLOCKED";
    soId: number;
    itemId: number;
    cycleId: number | null;
    qty: string;
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
  /** Admin-only: raw JSON from GET /api/dispatch/no-qty-debug (same inputs as computeNoQtyDispatchHeadroom). */
  const [noQtyDebugJson, setNoQtyDebugJson] = React.useState<string | null>(null);
  const [noQtyDebugData, setNoQtyDebugData] = React.useState<any | null>(null);
  const [noQtyDebugLoading, setNoQtyDebugLoading] = React.useState(false);
  const [noQtyDebugError, setNoQtyDebugError] = React.useState<string | null>(null);
  const [noQtyAdminDebugOpen, setNoQtyAdminDebugOpen] = React.useState(false);

  const [noQtyCycles, setNoQtyCycles] = React.useState<NoQtyCycleOption[]>([]);
  const [noQtyCyclesLoading, setNoQtyCyclesLoading] = React.useState(false);
  /** Selected ACTIVE cycle (SalesOrderCycle.id) driving NO_QTY dispatch math. */
  const [noQtySelectedCycleId, setNoQtySelectedCycleId] = React.useState<number | null>(null);
  /** NORMAL + PARTIAL_AVAILABLE: operator must tick before Prepare Dispatch is enabled. */
  const [normalPartialDispatchAck, setNormalPartialDispatchAck] = React.useState(false);

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
    // eslint-disable-next-line no-console
    console.log("🚀 FETCH START");
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
    // eslint-disable-next-line no-console
    console.log("📥 RESPONSE:", finalRows);
    // TEMP DEBUG: trace live eligibility for SO-26
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
          // NO_QTY: completed should not hard-block dispatch; only CLOSED is view-only.
          dispatchReadOnly: so.internalStatus === "CLOSED",
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

  // NO_QTY guided entry: when routed from QC/Production with itemId, preselect that item’s first eligible line.
  React.useEffect(() => {
    if (!fromNoQtySo || !focusSoIdValid) return;
    if (!selectedSo || selectedSo.id !== focusSoId) return;
    if (!focusItemIdValid) return;
    if (salesOrderLineId > 0) return;
    const hit = (selectedSo.lineStats || []).find((l) => Number(l.itemId) === Number(focusItemId));
    if (!hit) return;
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
    apiFetch<{ cycles: NoQtyCycleOption[] }>(`/api/dispatch/no-qty-cycles?soId=${selectedSo.id}`)
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
      if (
        fromNoQtySo &&
        focusSoIdValid &&
        selectedSo?.id === focusSoId &&
        focusCycleIdValid &&
        noQtyCycles.some((c) => c.cycleId === focusCycleId)
      ) {
        return focusCycleId;
      }
      if (prev != null && noQtyCycles.some((c) => c.cycleId === prev)) return prev;
      if (noQtyCycles.length === 1) return noQtyCycles[0].cycleId;
      const cur = normalizePositiveCycleId(selectedSo.currentCycleId);
      const match = cur != null ? noQtyCycles.find((c) => c.cycleId === cur) : null;
      return match ? match.cycleId : noQtyCycles[noQtyCycles.length - 1].cycleId;
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
  useFastEntryForm({ containerRef: dispatchFormRef, initialFocusRef: soSelectRef });

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

  const didInitialSoFocusRef = React.useRef(false);
  React.useEffect(() => {
    if (displayRows.length === 0) {
      didInitialSoFocusRef.current = false;
      return;
    }
    if (didInitialSoFocusRef.current) return;
    didInitialSoFocusRef.current = true;
    const id = window.setTimeout(() => soSelectRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [displayRows.length]);

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
      if (pin?.orderType === "NO_QTY" && noQtySelectedCycleId != null && soId > 0) {
        params.set("soId", String(soId));
        params.set("cycleId", String(noQtySelectedCycleId));
      } else if ((fromNoQtySo || fromGlobalSearch) && focusSoIdValid) {
        params.set("soId", String(focusSoId));
        if (noQtySelectedCycleId != null) params.set("cycleId", String(noQtySelectedCycleId));
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

  /** Select SO line and default dispatch qty to full headroom (dispatchable minus existing draft). */
  const selectLineFromBacklog = React.useCallback(
    (r: SoRow, ls: LineStat) => {
      setError(null);
      setDispatchInfo(null);
      setSoId(r.id);
      setSalesOrderLineId(ls.lineId);
      const cyc =
        r.orderType === "NO_QTY"
          ? normalizePositiveCycleId(noQtySelectedCycleId ?? r.noQtyDispatchContext?.selectedCycleId ?? r.currentCycleId)
          : null;
      const dq = draftQtyForSoItem(r, ls.itemId, cyc);
      const base = computeDispatchableBaseNoDraft({ so: r, ls });
      const headroom = Math.max(0, base - dq);
      if (headroom > 0) {
        setDispatchQtyStr(String(headroom));
      } else if (dq > 0) {
        setDispatchQtyStr(String(dq));
      } else {
        resetDispatchQty();
      }
      window.requestAnimationFrame(() => {
        dispatchFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [resetDispatchQty, noQtySelectedCycleId],
  );

  // NO_QTY usability: when a focused SO is pre-selected, also pre-select the best dispatchable line.
  React.useEffect(() => {
    if (!fromNoQtySo || !focusSoIdValid) return;
    if (!selectedSo || selectedSo.id !== focusSoId) return;
    if (salesOrderLineId > 0) return;
    if (dispatchReadOnly) return;
    const cyc = normalizePositiveCycleId(
      noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId,
    );
    const best = (selectedSo.lineStats || []).find((l) => computeDispatchableNow({ so: selectedSo, ls: l, cycleIdOverride: cyc }) > 1e-9);
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
        const cycleId =
          so.orderType === "NO_QTY"
            ? normalizePositiveCycleId(so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId)
            : null;
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
      ? (() => {
          const cyc = normalizePositiveCycleId(
            noQtySelectedCycleId ?? so.noQtyDispatchContext?.selectedCycleId ?? so.currentCycleId,
          );
          return (so.lineStats || []).filter((l) => computeDispatchableNow({ so, ls: l, cycleIdOverride: cyc }) > 1e-9);
        })()
      : so.lineStats.filter((l) => (l.pendingDispatchQty ?? 0) > 0);
    if (!selectable.length) {
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
  }, [soId, displayRows, salesOrderLineId, resetDispatchQty]);

  const allLines = selectedSo?.lineStats ?? [];
  /** Regular SO: confirmed backlog (`pendingDispatchQty` > 0). NO_QTY: all cycle / FG lines so reasons stay visible at 0 dispatchable. */
  const selectableLines = React.useMemo(() => {
    if (!selectedSo) return [];
    if (selectedSo.flowMode === "NO_QTY_SO") {
      // NO_QTY: show only truly dispatchable lines for the selected cycle.
      const cyc = normalizePositiveCycleId(noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId);
      return allLines.filter((l) => computeDispatchableNow({ so: selectedSo, ls: l, cycleIdOverride: cyc }) > 1e-9);
    }
    return allLines.filter((l) => (l.pendingDispatchQty ?? 0) > 0);
  }, [selectedSo, allLines, noQtySelectedCycleId]);

  /** Single source of truth for selection: salesOrderLineId, looked up on full lineStats (not the filtered dropdown). */
  const currentLine = allLines.find((l) => l.lineId === salesOrderLineId);

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
      const cyc =
        noQtySelectedCycleId != null ? `&cycleId=${encodeURIComponent(String(noQtySelectedCycleId))}` : "";
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
  }, [isAdmin, selectedSo, noQtyDebugItemId, noQtySelectedCycleId]);

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
      noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId,
    );
    const dispatchable = computeDispatchableNow({ so: selectedSo, ls: currentLine, cycleIdOverride: cyc });
    if (!(dispatchable > 1e-9)) return;
    const t = error.trim();
    if (t === "No dispatchable quantity remaining for this cycle." || t.toLowerCase().includes("cycle")) {
      setError(null);
    }
  }, [error, selectedSo, currentLine, noQtySelectedCycleId]);
  const noQtyBlocked =
    selectedSo?.orderType === "NO_QTY" &&
    (noQtyCyclesLoading || noQtyCycles.length === 0 || noQtySelectedCycleId == null);
  const selectedNoQtyCycleLabel = React.useMemo(() => {
    if (noQtySelectedCycleId == null) return null;
    const fromList = noQtyCycles.find((c) => c.cycleId === noQtySelectedCycleId);
    if (fromList?.cycleLabel) return fromList.cycleLabel;
    return selectedSo?.noQtyDispatchContext?.cycleLabel ?? `Cycle #${noQtySelectedCycleId}`;
  }, [noQtySelectedCycleId, noQtyCycles, selectedSo?.noQtyDispatchContext?.cycleLabel]);

  const soLedgerDispatches = React.useMemo(() => {
    if (!selectedSo?.dispatch?.length) return [];
    if (selectedSo.orderType !== "NO_QTY" || noQtySelectedCycleId == null) return selectedSo.dispatch;
    const w = normalizePositiveCycleId(noQtySelectedCycleId);
    return selectedSo.dispatch.filter((d) => normalizePositiveCycleId(d.cycleId) === w);
  }, [selectedSo, noQtySelectedCycleId]);

  const soLedgerDispatchesOtherCycles = React.useMemo(() => {
    if (!selectedSo?.dispatch?.length || selectedSo.orderType !== "NO_QTY" || noQtySelectedCycleId == null) return [];
    const w = normalizePositiveCycleId(noQtySelectedCycleId);
    return selectedSo.dispatch.filter((d) => normalizePositiveCycleId(d.cycleId) !== w);
  }, [selectedSo, noQtySelectedCycleId]);

  const showSoDispatchLedger = React.useMemo(() => {
    if (!selectedSo) return false;
    if (selectedSo.orderType !== "NO_QTY") return (selectedSo.dispatch?.length ?? 0) > 0;
    return soLedgerDispatches.length > 0 || soLedgerDispatchesOtherCycles.length > 0;
  }, [selectedSo, soLedgerDispatches, soLedgerDispatchesOtherCycles]);

  const noQtyUiDebugSnapshot = React.useMemo(() => {
    if (selectedSo?.orderType !== "NO_QTY" || !currentLine || noQtySelectedCycleId == null) return null;
    const w = normalizePositiveCycleId(noQtySelectedCycleId);
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
      cycleIdOverride: normalizePositiveCycleId(noQtySelectedCycleId),
    });
    return {
      salesOrderId: selectedSo.id,
      itemId: currentLine.itemId,
      selectedCycleId: noQtySelectedCycleId,
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
  }, [selectedSo, currentLine, noQtySelectedCycleId, noQtyServerCap]);

  const effectiveCycleId =
    selectedSo?.orderType === "NO_QTY"
      ? normalizePositiveCycleId(noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId)
      : null;

  const existingDraftQty = currentLine && selectedSo ? draftQtyForSoItem(selectedSo, currentLine.itemId, effectiveCycleId) : 0;

  const currentDispatchableBase =
    currentLine && selectedSo
      ? computeDispatchableBaseNoDraft({ so: selectedSo, ls: currentLine })
      : 0;

  /** Max qty you can enter for prepare = Dispatchable Now (draft-aware, stock-capped). */
  const headroomToPrepare = Math.max(0, currentDispatchableBase - existingDraftQty);
  const readyToShip = headroomToPrepare;
  const currentDispatchableQty = headroomToPrepare;

  const remainingSoLine = currentLine ? confirmedBacklogQty(currentLine) : 0;

  const currentRegularReadiness =
    selectedSo && currentLine ? effectiveRegularDispatchReadiness(selectedSo, currentLine) : null;
  const needsPartialDispatchAck = currentRegularReadiness === "PARTIAL_AVAILABLE";

  const noQtySelectedNextAction =
    selectedSo?.orderType === "NO_QTY" && currentLine
      ? noQtyDispatchNextActionMessage({
          ls: currentLine,
          dispatchable: currentDispatchableBase,
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
  const dispatchQtyHintPrimary =
    noQtyBlocked && selectedSo?.orderType === "NO_QTY"
      ? "Cannot dispatch: pick an active cycle above, or reopen the sales order if no cycles appear."
      : currentLine && readyToShip > 1e-9
        ? isRegularNormalSalesOrder(selectedSo)
          ? needsPartialDispatchAck
            ? existingDraftQty > 1e-9
              ? `Prepared draft: ${fmtDispatchQty(existingDraftQty)}.`
              : null
            : `You can prepare up to ${fmtDispatchQty(Math.min(readyToShip, remainingSoLine))} (ready to dispatch — ${fmtDispatchQty(
                remainingSoLine,
              )} pending on order).${existingDraftQty > 1e-9 ? ` Draft already prepared: ${fmtDispatchQty(existingDraftQty)}.` : ""}`
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

  async function onReverseDispatch(dispatchId: number, maxQty: number, opts?: { exported?: boolean }) {
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
      setError("Enter dispatch quantity");
      dispatchSubmitLockRef.current = false;
      return;
    }
    if (dispatchQtyParsed > currentDispatchableQty + 1e-6) {
      setError("Exceeds dispatchable quantity");
      dispatchSubmitLockRef.current = false;
      return;
    }
    setDispatching(true);
    const idempotencyKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `dispatch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await apiFetch("/api/dispatch/dispatches", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          soId,
          itemId: currentLine.itemId,
          dispatchedQty: dispatchQtyParsed,
          ...(selectedSo?.orderType === "NO_QTY" && noQtySelectedCycleId != null ? { cycleId: noQtySelectedCycleId } : {}),
        }),
      });
      setDispatchInfo("Prepared dispatch saved. Finalize from the ledger below to post stock.");
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

  const dispatchFormCanSubmit = Boolean(
    !dispatchReadOnly &&
      !dispatching &&
      !noQtyBlocked &&
      selectableLines.length > 0 &&
      currentLine &&
      readyToShip > 1e-9 &&
      dispatchQtyValid &&
      dispatchQtyParsed != null &&
      dispatchQtyParsed <= currentDispatchableQty + 1e-6 &&
      (!needsPartialDispatchAck || normalPartialDispatchAck),
  );

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
      const ls = so?.lineStats.find((x) => x.lineId === lid);
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

  const shortcutFlagsRef = React.useRef({ canPrepare: false });
  shortcutFlagsRef.current = { canPrepare: dispatchFormCanSubmit };
  const dispatchActionRef = React.useRef(onDispatch);
  dispatchActionRef.current = onDispatch;
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
        if (shortcutFlagsRef.current.canPrepare) {
          markShortcutRef.current("dispatchPrepare");
          void dispatchActionRef.current();
        }
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        if (shortcutFlagsRef.current.canPrepare) {
          markShortcutRef.current("dispatchPrepare");
          void dispatchActionRef.current();
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
      .flatMap((so) => so.lineStats.map((ls) => ({ so, ls })));
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
    (noQtyCyclesLoading ? true : noQtyCycles.some((c) => c.cycleId === focusCycleId));
  const guidedNoQtyResolved =
    guidedNoQtyCanResolve &&
    currentLine?.itemId != null &&
    Number(currentLine.itemId) === Number(focusItemId) &&
    normalizePositiveCycleId(noQtySelectedCycleId) === Number(focusCycleId);
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
    const rows = ledgerRows.filter(
      (r) =>
        r.soId === selectedSo.id &&
        r.itemId === currentLine.itemId &&
        !r.reversalOfId &&
        Number(r.cycleId ?? 0) === cycleId,
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
  }, [guidedNoQtyResolved, selectedSo, currentLine, focusCycleId, ledgerRows]);

  const primaryFinalizeDraftId = React.useMemo(() => {
    if (reopenedPreparedDraft?.id) return reopenedPreparedDraft.id;
    if (guidedLedgerContext?.preparedDraft?.id) return guidedLedgerContext.preparedDraft.id;
    if (!selectedSo?.dispatch?.length || !currentLine) return null;
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
    !guidedNoQtyLockUi && fromNoQtySo && focusSoIdValid && noQtyFlowState?.nextAction === "SALES_BILL";
  const noQtyShowCompletedSalesBillNext =
    selectedSo?.orderType === "NO_QTY" && noQtyLastFinalizedDispatchId != null && !stripShowFinalize;

  const dqEps = 1e-9;
  const showCompactDispatchStrip =
    showMainDispatchUi && selectedSo != null && currentLine != null && !topStripSalesBillNext;
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

  /** Prepared draft exists for current context: prioritize finalize UX over open-lines / cycle messaging. */
  const finalizePrepDraftMode = Boolean(
    showMainDispatchUi &&
      selectedSo &&
      currentLine &&
      primaryFinalizeDraftId != null &&
      existingDraftQty > dqEps,
  );

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
        (guidedBillAction.kind === "CREATE" || guidedBillAction.kind === "OPEN"),
    );

  // Keep dispatch screen operational-only: do not surface billing/export steps here.
  const dispatchGuidedExported = false;

  const dispatchBlockedStripVisible =
    Boolean(
      showCompactDispatchStrip &&
        selectedSo &&
        currentLine &&
        !finalizePrepDraftMode &&
        !stripShowFinalize &&
        !topStripSalesBillNext &&
        !dispatchGuidedBillActions &&
        !dispatchGuidedExported &&
        headroomToPrepare <= 1e-9 &&
        primaryFinalizeDraftId == null,
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
    topStripSalesBillNext && focusSoIdValid
      ? buildNoQtyGuidedHref({
          to: "/sales-bills",
          salesOrderId: focusSoId,
          cycleId: noQtyFlowState?.cycleId,
          fromStep: "dispatch",
        })
      : "";

  return (
    <PageContainer className="pb-[5.5rem] sm:pb-20">
      <div className="mb-2">
        <DemoFlowBanner />
      </div>
      <div className="grid gap-2">
        <StickyWorkspaceHead
          lead={
            fromNoQtySo ? (
              <PageNoQtyFlowBackLink step="DISPATCH" />
            ) : (
              <PageSmartBackLink defaultTo="/sales-orders" defaultLabel="Back to Sales Orders" />
            )
          }
        >
          <PageHeader
            title="Dispatch"
            actions={
              <Link to="/qc-report" className="text-xs font-medium text-sky-700 underline-offset-4 hover:underline">
                View QC Report
              </Link>
            }
          />
        </StickyWorkspaceHead>

        <NextStepStrip
          visible={Boolean(topStripSalesBillNext && focusSoIdValid && salesBillFlowHref)}
          variant="action"
          title="Next Step: Create Sales Bill"
          subtitle={
            selectedSo && Number(selectedSo.id) === Number(focusSoId)
              ? displaySalesOrderNo(selectedSo.id, selectedSo.docNo)
              : `SO #${focusSoId}`
          }
          primaryAction={{
            label: "Go to Sales Bill",
            onClick: () => navigate(salesBillFlowHref),
            testId: "next-create-sales-bill",
          }}
        />

        <NextStepStrip
          visible={Boolean(noQtyShowCompletedSalesBillNext && selectedSo)}
          variant="success"
          title="Dispatch completed"
          subtitle={selectedSo ? displaySalesOrderNo(selectedSo.id, selectedSo.docNo) : ""}
          primaryAction={{
            label: "Create Sales Bill",
            onClick: () => {
              if (!selectedSo) return;
              navigate(`/sales-bills?source=no_qty_so&salesOrderId=${selectedSo.id}`);
            },
            testId: "noqty-create-sales-bill-after-dispatch",
          }}
        />

        <NextStepStrip
          visible={Boolean(stripShowFinalize && primaryFinalizeDraftId != null)}
          variant="action"
          title={finalizePreparedStripTitle}
          subtitle={finalizePreparedStripSubtitle}
          primaryAction={{
            label: lockingId === primaryFinalizeDraftId ? "…" : "Finalize Dispatch",
            onClick: () => primaryFinalizeDraftId != null && onFinalizeDraftDispatch(primaryFinalizeDraftId),
            disabled: lockingId === primaryFinalizeDraftId,
            testId: "next-finalize-dispatch",
            ...(finalizeDemoHl ? { demoHighlightKey: finalizeDemoHl } : {}),
          }}
          secondaryAction={{
            label: deletingId === primaryFinalizeDraftId ? "…" : "Delete Draft",
            onClick: () => primaryFinalizeDraftId != null && onDeleteDraft(primaryFinalizeDraftId),
            disabled: deletingId === primaryFinalizeDraftId,
          }}
        />

        <NextStepStrip
          visible={dispatchGuidedBillActions}
          variant="action"
          title="Next Step: Create Sales Bill"
          subtitle={finalizeStripSubtitle}
          primaryAction={
            guidedBillAction?.kind === "CREATE"
              ? {
                  label: "Create Sales Bill",
                  onClick: () => void onCreateSalesBillFromDispatch(guidedBillAction.dispatchId),
                  disabled: dispatchReadOnly,
                  testId: "next-create-sales-bill",
                }
              : undefined
          }
        />

        <NextStepStrip
          visible={false}
          variant="success"
          title=""
        />

        <NextStepStrip
          visible={dispatchBlockedStripVisible}
          variant="blocked"
          title="Blocked: Dispatch cannot be finalized yet"
          subtitle={dispatchBlockedSubtitle}
        />
      </div>

      <OperatorPageBody className="pb-0">
        {selectedSo?.orderType === "NO_QTY" &&
        !finalizePrepDraftMode &&
        !guidedNoQtyLockUi &&
        (fromNoQtySo && focusSoIdValid ? true : soId > 0) ? (
          <div className="mb-2 grid items-start gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
            <NoQtyFlowStepsCard
              currentStage="DISPATCH"
              cycleStatus={(() => {
                const cid = normalizePositiveCycleId(
                  noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId,
                );
                const opt = cid ? noQtyCycles.find((c) => Number(c.cycleId) === Number(cid)) : null;
                return opt?.status === "ACTIVE" ? "Active Cycle" : "Closed Cycle";
              })()}
            />
            <div className="flex min-w-0 justify-center">
              {(() => {
                const stats = selectedSo.lineStats ?? [];
                const cycleId = normalizePositiveCycleId(
                  noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId ?? selectedSo.currentCycleId,
                );
                const usable = stats.reduce((s, ls) => s + getUsableStock(ls), 0);
                const dispatchableNow = stats.reduce((s, ls) => s + computeDispatchableNow({ so: selectedSo, ls, cycleIdOverride: cycleId }), 0);

                const rsQty = stats.reduce((s, ls) => s + safeNum(ls.cycleCap), 0);
                const qcAccepted = stats.reduce((s, ls) => s + safeNum(ls.cycleQcAcceptedQty ?? ls.qcAccepted), 0);
                const maxDispatchNow = Math.max(0, Math.min(rsQty, usable));

                return (
                  <div className="w-full max-w-[520px] rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <div className="text-center">
                      <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Ready to Dispatch</div>
                      <div className="mt-1 text-[34px] font-bold tabular-nums leading-none text-slate-900">
                        {fmtDispatchQty(dispatchableNow)} units
                      </div>
                      <div className="mt-2 flex flex-col items-center gap-1 text-[12px] text-slate-600">
                        <div>
                          Current RS Qty:{" "}
                          <span className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(rsQty)}</span>
                        </div>
                        <div>
                          Usable Stock Available:{" "}
                          <span className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(usable)}</span>
                        </div>
                        <div>
                          Max Dispatch Now:{" "}
                          <span className="font-semibold tabular-nums text-emerald-900">{fmtDispatchQty(maxDispatchNow)}</span>
                        </div>
                      </div>
                      <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left">
                        <summary className="cursor-pointer text-[12px] font-medium text-slate-700">Show details</summary>
                        <div className="mt-2 rounded border border-slate-200 bg-white/70 px-2 py-1 text-[11px] text-slate-600">
                          History only — not used for current dispatch limit.
                        </div>
                        <div className="mt-2 grid gap-1 text-[12px] text-slate-700">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-slate-600">Total QC passed (all)</span>
                            <span className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(qcAccepted)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-slate-600">Planned Qty (trace)</span>
                            <span className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(rsQty)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-slate-600">Cycle (reference)</span>
                            <span className="font-semibold tabular-nums text-slate-900">
                              {selectedNoQtyCycleLabel ?? (cycleId != null ? `Cycle #${cycleId}` : "—")}
                            </span>
                          </div>
                        </div>
                      </details>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : fromNoQtySo && focusSoIdValid ? (
          <NoQtyCycleBanner className="mb-1" />
        ) : null}
        {error ? <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[13px] text-red-800">{error}</div> : null}
        {dispatchInfo ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[13px] text-emerald-900">{dispatchInfo}</div>
        ) : null}
        <DemoSafeNoQtyContinue
          visible={showDemoNoQtyDispatchContinue}
          body="Demo mode: Dispatch is not saved in Safe Demo. Complete this step to finish the NO_QTY demo path."
          actionLabel="Continue Demo → Sales Bill"
        />
        {selectedSo?.dispatchReadOnly ? (
          <div className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[13px] text-slate-800">
            This sales order is closed. Dispatch is view-only.
          </div>
        ) : null}
        {/* NO_QTY guidance is shown in the summary card above (keep the rest of dispatch UI unchanged). */}
        {selectedSo?.orderType === "NO_QTY" && !noQtyCyclesLoading && noQtyCycles.length === 0 ? (
          <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[13px] text-amber-950">
            Cannot dispatch: no active cycle. Reopen the sales order to start a cycle.
          </div>
        ) : null}
        {selectedSo?.orderType === "NO_QTY" &&
        (selectedSo.lineStats?.length ?? 0) === 0 &&
        selectedSo.noQtyDispatchBlockedReason ? (
          <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[13px] text-amber-950">
            {mapNoQtySoBlockedReasonApi(selectedSo.noQtyDispatchBlockedReason)}
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
              <div className="mt-0.5 text-emerald-900">
                All sales orders are fully dispatched or completed.
              </div>
              {hasUnexportedSalesBillsInHistory ? (
                <div className="mt-1 text-emerald-900/90">Some finalized dispatches still have Sales Bill export pending.</div>
              ) : null}
              <div className="mt-1 text-emerald-900/90">You can review past dispatches below.</div>
              <div className="mt-2 text-[12px] text-emerald-900/90">
                <span className="font-medium">Dispatch Status:</span> ✔ 0 pending dispatch
              </div>
            </>
          )}
        </div>
      ) : (
        <div ref={dispatchFormRef} className="flex flex-col gap-2">
          <OperatorTopBar className="flex-col items-stretch gap-2 rounded border border-slate-200 bg-white p-2 shadow-sm">
            {reopenedPreparedDraftMode && reopenedPreparedDraft ? (
              <>
                <div className="text-[12px] text-slate-800">
                  <span className="font-semibold text-slate-900">Prepared draft loaded.</span>{" "}
                  <span className="text-slate-600">Finalize or delete using the strip above.</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setReopenedPreparedDraft(null);
                      setReopenFallbackSoRow(null);
                      const params = new URLSearchParams(sp);
                      params.delete("draftDispatchId");
                      navigate(`/dispatch?${params.toString()}`, { replace: true });
                    }}
                  >
                    Back
                  </Button>
                </div>
              </>
            ) : (
              <>
                {fromNoQtySo && focusSoIdValid && selectedSo?.orderType === "NO_QTY" && dispatchReadOnly ? (
                  <div className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[12px] text-sky-950">
                    This sales order is closed. Dispatch is view-only.
                  </div>
                ) : null}
                {guidedNoQtyLockUi ? (
                  <div ref={guidedTopRef} className="grid gap-2">
                    <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-800">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Dispatch context</div>
                      {selectedSo && currentLine ? (
                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[12px]">
                          <span>
                            <span className="font-medium text-slate-600">Customer</span>{" "}
                            <span className="text-slate-900">{customerDisplayName(selectedSo)}</span>
                          </span>
                          <span className="text-slate-400" aria-hidden>
                            ·
                          </span>
                          <span>
                            <span className="font-medium text-slate-600">Cycle</span>{" "}
                            <span className="font-medium text-slate-900">
                              {selectedNoQtyCycleLabel ?? (noQtyCyclesLoading ? "…" : `Cycle #${focusCycleId}`)}
                            </span>
                          </span>
                        </div>
                      ) : (
                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[12px]">
                          <span>
                            <span className="font-medium text-slate-600">Sales Order</span>{" "}
                            <span className="font-mono tabular-nums text-slate-900">
                              {selectedSo ? displaySalesOrderNo(selectedSo.id, selectedSo.docNo) : focusSoIdValid ? `SO-${focusSoId}` : "—"}
                            </span>
                          </span>
                          <span className="text-slate-400" aria-hidden>
                            ·
                          </span>
                          <span>
                            <span className="font-medium text-slate-600">Customer</span>{" "}
                            <span className="text-slate-900">{selectedSo ? customerDisplayName(selectedSo) : focusSo?.customerName ?? "—"}</span>
                          </span>
                          <span className="text-slate-400" aria-hidden>
                            ·
                          </span>
                          <span>
                            <span className="font-medium text-slate-600">Item</span>{" "}
                            <span className="font-medium text-slate-900">
                              {guidedNoQtyResolved ? currentLine?.itemName ?? `Item #${focusItemId}` : `Item #${focusItemId}`}
                            </span>
                          </span>
                          <span className="text-slate-400" aria-hidden>
                            ·
                          </span>
                          <span>
                            <span className="font-medium text-slate-600">Cycle</span>{" "}
                            <span className="font-medium text-slate-900">{selectedNoQtyCycleLabel ?? (noQtyCyclesLoading ? "…" : `Cycle #${focusCycleId}`)}</span>
                          </span>
                        </div>
                      )}
                    </div>

                    {!guidedNoQtyResolved ? (
                      <div className="rounded border border-sky-200 bg-sky-50 px-2.5 py-2 text-[12px] text-sky-950">
                        Loading guided dispatch context…
                      </div>
                    ) : finalizePrepDraftMode ? (
                      <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950">
                        <div className="font-semibold">Prepared dispatch</div>
                        <div className="mt-0.5 text-[11px] text-amber-900/90">
                          Finalize or delete the draft using the strip above.
                        </div>
                      </div>
                    ) : (
                      <div
                        className={
                          guidedLedgerContext?.preparedDraft
                            ? "rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950"
                            : guidedLedgerContext?.latestFinalized
                              ? "rounded border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[12px] text-emerald-950"
                              : "rounded border border-slate-200 bg-white px-2.5 py-2 text-[12px] text-slate-900"
                        }
                      >
                        {guidedLedgerContext?.preparedDraft ? (
                          <>
                            <div className="font-semibold">Dispatch Ready</div>
                            <div className="mt-0.5 text-[11px] text-amber-900">
                              Prepared draft — use <span className="font-semibold">Finalize Dispatch</span> in the strip above.
                            </div>
                          </>
                        ) : guidedLedgerContext?.latestFinalized ? (
                          <>
                            <div className="font-semibold">Dispatch Completed</div>
                            <div className="mt-0.5 text-[11px] text-emerald-900">
                              {guidedBillAction?.kind === "EXPORTED"
                                ? "Dispatch finalized — stock posted."
                                : "Dispatch finalized — stock posted. Use the strip above for the sales bill."}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-semibold text-slate-900">Ready to prepare</div>
                            <p className="mt-1 text-[13px] text-slate-800">
                              <span className="text-slate-600">Max prepare now:</span>{" "}
                              <span className="font-bold tabular-nums text-emerald-900">{fmtDispatchQty(safeNum(currentDispatchableQty))}</span>
                            </p>
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
                                    <div className="text-slate-600">Room left (cycle cap · history only)</div>
                                    <div className="font-semibold tabular-nums">{fmtDispatchQty(safeNum(currentLine?.cycleCapRemaining ?? 0))}</div>
                                  </div>
                                  <div>
                                    <div className="text-slate-600">Prepared draft</div>
                                    <div className="font-semibold tabular-nums">{fmtDispatchQty(existingDraftQty)}</div>
                                  </div>
                                </div>
                              </div>
                            </details>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={!dispatchFormCanSubmit}
                                onClick={() => {
                                  shortcutHints.markFieldShortcutUsed("dispatchPrepare");
                                  void onDispatch();
                                }}
                              >
                                {existingDraftQty > 0 ? "Update Prepared Dispatch" : "Prepare Dispatch"}
                              </Button>
                              {noQtyBlocked ? (
                                <span className="text-[11px] text-slate-600">{currentLine ? noQtyBlockedReasonPlain(currentLine) : "Cannot dispatch now"}</span>
                              ) : null}
                            </div>
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
                    {(currentLine && !selectableLines.some((x) => x.lineId === currentLine.lineId)
                      ? [currentLine, ...selectableLines]
                      : selectableLines
                    ).map((l) => {
                      const dup = (currentLine && !selectableLines.some((x) => x.lineId === currentLine.lineId)
                        ? [currentLine, ...selectableLines]
                        : selectableLines
                      ).filter((x) => x.itemId === l.itemId).length > 1;
                      const d = selectedSo ? draftQtyForSoItem(selectedSo, l.itemId, noQtySelectedCycleId) : 0;
                      const partialOpt =
                        selectedSo &&
                        isRegularNormalSalesOrder(selectedSo) &&
                        effectiveRegularDispatchReadiness(selectedSo, l) === "PARTIAL_AVAILABLE"
                          ? " · partial stock"
                          : "";
                      return (
                        <option key={l.lineId} value={l.lineId}>
                          {l.itemName}
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
              {selectedSo?.orderType === "NO_QTY" ? (
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
                        <option key={c.cycleId} value={c.cycleId}>
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
            )}
          </OperatorTopBar>

          <OperatorMainSplit
            queue={
              <div className="flex flex-col gap-3">
                {!finalizePrepDraftMode ? (
                <section className="space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[12px] font-bold uppercase tracking-wide text-slate-600">
                      {fromNoQtySo && focusSoIdValid && selectedSo?.orderType === "NO_QTY" ? "Current cycle work" : "Open lines"}
                    </h3>
                    <span className="text-[11px] text-slate-500">
                      {fromNoQtySo && focusSoIdValid && selectedSo?.orderType === "NO_QTY"
                        ? "Focused view · use Item dropdown to switch lines"
                        : noQtyLineEntries
                          ? "No Qty · selected cycle · all FG lines · ▶ selects line"
                          : "Full dispatch first, then partial · ▶ selects line"}
                    </span>
                  </div>
                  {(() => {
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
                  {fromNoQtySo && focusSoIdValid && selectedSo?.orderType === "NO_QTY" ? (
                    <details className="rounded border border-slate-200 bg-white px-2.5 py-2">
                      <summary className="cursor-pointer text-[12px] font-medium text-slate-700">
                        Other open lines (same SO, this cycle) ({Math.max(0, allLines.length - (currentLine ? 1 : 0))})
                      </summary>
                      <div className="mt-2 max-h-[min(38vh,280px)] overflow-auto rounded border border-slate-200 bg-white">
                        <table className="w-full text-[13px]">
                          <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                            <tr className="text-left text-[12px] text-slate-600">
                              <th className="px-2 py-1 font-medium">Item</th>
                              <th className="px-2 py-1 text-right font-medium">Max prepare</th>
                              <th className="px-2 py-1 font-medium">Status</th>
                              <th className="w-10 px-1 py-1 text-right font-medium"> </th>
                            </tr>
                          </thead>
                          <tbody>
                            {(currentLine ? allLines.filter((l) => l.lineId !== currentLine.lineId) : allLines).map((ls) => {
                              const cyc = normalizePositiveCycleId(
                                noQtySelectedCycleId ?? selectedSo?.noQtyDispatchContext?.selectedCycleId ?? selectedSo?.currentCycleId,
                              );
                              const disp = selectedSo ? computeDispatchableNow({ so: selectedSo, ls, cycleIdOverride: cyc }) : 0;
                              const blocked = disp <= NO_QTY_BLOCK_EPS ? noQtyBlockedReasonPlain(ls) : "—";
                              const selected = salesOrderLineId === ls.lineId;
                              return (
                                <tr
                                  key={ls.lineId}
                                  className={cn(
                                    "border-t border-slate-100",
                                    operatorTableRowClass,
                                    selected && "bg-emerald-50 ring-2 ring-inset ring-emerald-500/40",
                                  )}
                                >
                                  <td className="max-w-[12rem] truncate px-2 py-1 font-medium text-slate-900" title={ls.itemName}>
                                    {ls.itemName}
                                  </td>
                                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">{fmtDispatchQty(disp)}</td>
                                  <td className="px-2 py-1 text-[12px] font-medium text-slate-800">
                                    {selectedSo ? lineDispatchStatusFriendly(selectedSo, ls, noQtySelectedCycleId) : "—"}
                                  </td>
                                  <td className="px-1 py-0.5 text-right">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 shrink-0 p-0 text-[13px]"
                                      onClick={() => selectedSo && selectLineFromBacklog(selectedSo, ls)}
                                      aria-label={`Select ${ls.itemName}`}
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
                    </details>
                  ) : (
                    <div className="max-h-[min(38vh,280px)] overflow-auto rounded border border-slate-200 bg-white">
                      <table className="w-full text-[13px]">
                      <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                        <tr className="text-left text-[12px] text-slate-600">
                          <th className="px-2 py-1 font-medium">Customer</th>
                          <th className="px-2 py-1 font-medium">SO No</th>
                          <th className="px-2 py-1 font-medium">Item</th>
                          <th className="px-2 py-1 text-right font-medium">Order Pending Qty</th>
                          <th className="px-2 py-1 text-right font-medium">Available Now</th>
                          <th className="px-2 py-1 text-right font-medium">Max Dispatchable Now</th>
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
                              const dq = draftQtyForSoItem(so, ls.itemId, cyc);
                              const base = computeDispatchableBaseNoDraft({ so, ls });
                              const headroom = Math.max(0, base - dq);
                              const cycleLabel =
                                so.noQtyDispatchContext?.cycleLabel?.trim() ||
                                (cyc != null ? `Cycle #${cyc}` : "Cycle");
                              return (
                                <tr
                                  key={`${so.id}-${ls.lineId}`}
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
                                      <Badge variant="secondary" className="border-sky-200 bg-sky-50 text-[11px] text-sky-900">
                                        {cycleLabel}
                                      </Badge>
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-slate-600">NO_QTY dispatch follows current cycle output only.</div>
                                    {status === "PARTIAL_AVAILABLE" ? (
                                      <div className="mt-0.5 text-[11px] text-amber-900">
                                        Available {fmtDispatchQty(disp)} / Pending {fmtDispatchQty(pend)}. You can dispatch partial qty now or wait.
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-2 py-1">
                                    {status === "READY_FULL" ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="h-7 px-2 text-[12px]"
                                        onClick={() => {
                                          selectLineFromBacklog(so, ls);
                                          const qty = Math.min(pend, headroom);
                                          if (qty > 0) setDispatchQtyStr(String(qty));
                                        }}
                                      >
                                        Dispatch Full
                                      </Button>
                                    ) : status === "PARTIAL_AVAILABLE" ? (
                                      <div className="flex flex-wrap gap-1">
                                        <Button
                                          type="button"
                                          size="sm"
                                          className="h-7 px-2 text-[12px]"
                                          onClick={() => {
                                            selectLineFromBacklog(so, ls);
                                            if (headroom > 0) setDispatchQtyStr(String(headroom));
                                          }}
                                        >
                                          Dispatch Partial
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="h-7 px-2 text-[12px]"
                                          onClick={() => {
                                            recordDispatchPartialWaitChoice(so.id, ls.lineId, ls.itemId);
                                            toast.showInfo("Marked as wait (no dispatch created).");
                                          }}
                                        >
                                          Wait
                                        </Button>
                                      </div>
                                    ) : (
                                      <div className="text-[12px] text-slate-500">Waiting for stock/QC</div>
                                    )}
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
                                const dq = draftQtyForSoItem(so, ls.itemId, null);
                                const base = computeDispatchableBaseNoDraft({ so, ls });
                                const headroom = Math.max(0, base - dq);
                                return (
                                  <tr
                                    key={`${so.id}-${ls.lineId}`}
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
                                    <td className="px-2 py-1">
                                      {status === "READY_FULL" ? (
                                        <Button
                                          type="button"
                                          size="sm"
                                          className="h-7 px-2 text-[12px]"
                                          onClick={() => {
                                            selectLineFromBacklog(so, ls);
                                            const qty = Math.min(pend, headroom);
                                            if (qty > 0) setDispatchQtyStr(String(qty));
                                          }}
                                        >
                                          Dispatch Full
                                        </Button>
                                      ) : status === "PARTIAL_AVAILABLE" ? (
                                        <div className="flex flex-wrap gap-1">
                                          <Button
                                            type="button"
                                            size="sm"
                                            className="h-7 px-2 text-[12px]"
                                            onClick={() => {
                                              selectLineFromBacklog(so, ls);
                                              if (headroom > 0) setDispatchQtyStr(String(headroom));
                                            }}
                                          >
                                            Dispatch Partial
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 px-2 text-[12px]"
                                            onClick={() => {
                                              recordDispatchPartialWaitChoice(so.id, ls.lineId, ls.itemId);
                                              toast.showInfo("Marked as wait (no dispatch created).");
                                            }}
                                          >
                                            Wait
                                          </Button>
                                        </div>
                                      ) : (
                                        <div className="text-[12px] text-slate-500">Waiting for stock/QC</div>
                                      )}
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

          {!noQtyLineEntries && !finalizePrepDraftMode ? (
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
                      <th className="px-2 py-1 text-right font-medium">Order Pending Qty</th>
                      <th className="px-2 py-1 text-right font-medium">Available Now</th>
                      <th className="px-2 py-1 text-right font-medium">Max Dispatchable Now</th>
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
                        <tr key={`${so.id}-${ls.lineId}`} className={cn("border-t border-slate-100", operatorTableRowClass)}>
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
                            {so.orderType === "NO_QTY" ? (
                              <div className="mt-0.5 text-[11px] text-slate-600">NO_QTY dispatch follows current cycle output only.</div>
                            ) : null}
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
              <NoQtyAdminDispatchDebugPanel
                expanded={noQtyAdminDebugOpen}
                onToggle={() => setNoQtyAdminDebugOpen((o) => !o)}
                loading={noQtyDebugLoading}
                error={noQtyDebugError}
                json={noQtyDebugJson}
                uiSnapshot={noQtyUiDebugSnapshot}
                onLoad={() => void loadNoQtyDispatchDebug()}
              />
            ) : null}
            <div className="text-[13px] font-semibold text-slate-900">
              {finalizePrepDraftMode
                ? "Prepared for finalization"
                : reopenedPreparedDraftMode
                  ? "Reopened prepared draft"
                  : "Prepare dispatch"}
            </div>
            {!finalizePrepDraftMode ? (
              <div className="flex flex-wrap items-end gap-3">
                <FieldShortcutHint
                  show={shortcutHints.activeFieldId === "dispatchQty"}
                  hint={shortcutHints.activeFieldHintText ?? ""}
                  placement="below-end"
                  className="min-w-[7.5rem] shrink-0"
                >
                  <div className="erp-form-field min-w-0">
                    <span className="text-[12px] font-medium text-slate-600">Enter quantity to prepare</span>
                    <Input
                      ref={dispatchQtyRef}
                      {...dispatchQtyBind}
                      type="text"
                      data-testid="dispatch-qty-input"
                      inputMode="decimal"
                      autoComplete="off"
                      className="mt-0.5 h-8 tabular-nums text-[13px]"
                      placeholder="Qty"
                      value={dispatchQtyStr}
                      disabled={qtyInputDisabled}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                          shortcutHints.markFieldShortcutUsed("dispatchQty");
                        }
                      }}
                    />
                    {dispatchQtyHintPrimary ? (
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{dispatchQtyHintPrimary}</p>
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
                    {salesOrderLineId > 0 && currentLine && !dispatchQtyValid && !qtyInputDisabled ? (
                      <p className="mt-0.5 text-[11px] font-medium text-amber-800">Enter quantity</p>
                    ) : null}
                  </div>
                </FieldShortcutHint>
                {needsPartialDispatchAck && !reopenedPreparedDraftMode ? (
                  <div className="basis-full rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[12px] text-slate-800">
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
                {reopenedPreparedDraftMode && reopenedPreparedDraft ? null : (
                  <>
                    {selectedSo?.orderType === "NO_QTY" && currentLine ? (
                      <div className="basis-full rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[12px] text-slate-800">
                        {(() => {
                          const eps = 1e-6;
                          // NO_QTY: keep the prepare panel simple.
                          // "Use from Stock" fills the qty input to Max prepare now / Dispatchable Now (draft-aware).
                          const fillQty = Math.max(0, headroomToPrepare);
                          const canUse = fillQty > eps && !qtyInputDisabled;

                          return (
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900">Use Usable Stock</div>
                                <div className="mt-0.5 text-[11px] text-slate-600">
                                  Uses only <span className="font-semibold">USABLE</span> stock. QC hold/pending/scrap excluded.
                                </div>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 shrink-0 text-[12px] font-semibold"
                                disabled={!canUse}
                                onClick={() => setDispatchQtyStr(String(fillQty))}
                              >
                                Use from Stock
                              </Button>
                            </div>
                          );
                        })()}
                      </div>
                    ) : null}
                    {needsPartialDispatchAck && selectedSo && currentLine ? (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 shrink-0 text-[13px]"
                        disabled={dispatching || dispatchReadOnly}
                        onClick={async () => {
                          setError(null);
                          recordDispatchPartialWaitChoice(selectedSo.id, currentLine.lineId, currentLine.itemId);

                          // Navigate to the right production planning path instead of only showing a toast.
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

                          // REGULAR SO: try to detect open WO (if user has PRODUCTION access). Fallback: WO list.
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
                            // no-op: lack of role or network; fall back to WO list
                          }
                          navigate(`/work-orders?so=${selectedSo.id}`);
                        }}
                      >
                        Plan / Continue Production
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 text-[13px]"
                      disabled={dispatching || dispatchReadOnly || !currentLine || headroomToPrepare <= 0 || noQtyBlocked}
                      onClick={() => setDispatchQtyStr(String(headroomToPrepare))}
                    >
                      {isRegularNormalSalesOrder(selectedSo) ? "Fill max prepare" : "Use max headroom"}
                    </Button>
                    <Button
                      type="button"
                      variant={needsPartialDispatchAck ? "outline" : "default"}
                      size="sm"
                      data-testid="prepare-dispatch-btn"
                      className="h-8 shrink-0 text-[13px]"
                      onClick={() => {
                        shortcutHints.markFieldShortcutUsed("dispatchPrepare");
                        void onDispatch();
                      }}
                      disabled={!dispatchFormCanSubmit}
                    >
                      {dispatching ? "Saving…" : existingDraftQty > 0 ? "Update Prepared Dispatch" : "Prepare Dispatch"}
                    </Button>
                  </>
                )}
              </div>
            ) : null}

            {currentLine && selectedSo ? (
              <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                {existingDraftQty > 0 ? (
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
                        Prepare Dispatch updates this row (no duplicate drafts).
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

            {showSoDispatchLedger && selectedSo ? (
              <div className="mt-2 border-t border-slate-100 pt-2">
                <div className="mb-1 text-[12px] font-semibold text-slate-700">
                  {selectedSo.orderType === "NO_QTY"
                    ? "SO dispatch ledger (selected cycle · prepare / finalize)"
                    : "SO dispatch ledger (prepare / finalize)"}
                </div>
                <div className="max-h-52 overflow-auto">
                  <table className="w-full text-[13px]">
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
                      const so = selectedSo;
                      function rowEl(d: DispatchEvent) {
                        const isRev = d.reversalOfId != null;
                        const qty = Number(d.dispatchedQty);
                        const itemName =
                          so.lineStats.find((ls) => ls.itemId === d.itemId)?.itemName ?? `Item #${d.itemId}`;
                        const maxRev = typeof d.maxReversibleQty === "number" ? d.maxReversibleQty : 0;
                        const badge = rowStatusBadge(d);
                        const isUnlockedForward = !isRev && d.workflowStatus === "UNLOCKED";
                        const isLockedForward =
                          !isRev && (d.workflowStatus === "LOCKED" || d.workflowStatus == null);
                        return (
                          <tr
                            key={d.id}
                            id={`so-dispatch-ledger-row-${d.id}`}
                            className={cn(
                              "border-t border-slate-100",
                              isRev && "bg-red-50/40",
                            )}
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
                            <td className="py-0.5 pr-2 text-slate-600">
                              {isRev ? (d.reversalReason?.trim() || "—") : "—"}
                            </td>
                            <td className="py-0.5 text-right">
                              <div className="flex flex-wrap justify-end gap-1">
                                {isUnlockedForward && !so.dispatchReadOnly ? (
                                  <>
                                    {primaryFinalizeDraftId != null && d.id === primaryFinalizeDraftId ? (
                                      <span className="text-[10px] font-medium text-slate-500">Use top bar</span>
                                    ) : (
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
                                    )}
                                    {primaryFinalizeDraftId != null && d.id === primaryFinalizeDraftId ? null : (
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
                                    )}
                                  </>
                                ) : null}
                                {isLockedForward && maxRev > 0 ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-[11px]"
                                    disabled={reversingId === d.id}
                                    onClick={() => onReverseDispatch(d.id, maxRev)}
                                  >
                                    {reversingId === d.id ? "…" : "Reverse"}
                                  </Button>
                                ) : null}
                                {isLockedForward && qty > 0 ? (
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
                                  No prepared or finalized dispatches for this cycle.
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
                                    <div className="mt-2 overflow-x-auto">
                                      <table className="w-full text-[12px]">
                                        <thead>
                                          <tr className="border-b border-slate-200 text-left text-[11px] font-medium text-slate-600">
                                            <th className="py-1 pr-2">Date</th>
                                            <th className="py-1 pr-2">Dispatch</th>
                                            <th className="py-1 pr-2">Qty</th>
                                            <th className="py-1 pr-2">Status</th>
                                            <th className="py-1 pr-2">Sales Bill</th>
                                            <th className="py-1 pr-2">Reversal</th>
                                            <th className="py-1">Actions</th>
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
            ) : null}
              </div>
            }
          />
        </div>
      )}

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

                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                        <tr className="text-left text-[12px] text-slate-600">
                          <th className="py-1.5 pr-3">Dispatch No</th>
                          <th className="py-1.5 pr-3">Date</th>
                          <th className="py-1.5 pr-3">Customer</th>
                          <th className="py-1.5 pr-3">Item</th>
                          <th className="py-1.5 pr-3 text-right">Qty</th>
                          <th className="py-1.5 pr-3 text-right">Reversed</th>
                          <th className="py-1.5 pr-3 text-right">Balance</th>
                          <th className="py-1.5 pr-3">Status</th>
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

      {(() => {
        const hid = focusSoIdValid ? focusSoId : soId > 0 ? soId : 0;
        if (hid <= 0) return null;
        const soRow =
          displayRows.find((r) => r.id === hid) ?? (fallbackSoRow && fallbackSoRow.id === hid ? fallbackSoRow : undefined);
        const docNoForLabel = soRow?.docNo ?? (focusSo?.id === hid ? focusSo.docNo : null);
        const soLabel = displaySalesOrderNo(hid, docNoForLabel ?? null);
        return (
          <div className="mt-3 max-w-3xl px-1">
            <ActivityHistoryCard
              title={`Dispatch history — ${soLabel}`}
              query={`module=DISPATCH&salesOrderId=${encodeURIComponent(String(hid))}&limit=50`}
            />
          </div>
        );
      })()}

      <ShortcutHintBar items={DISPATCH_SHORTCUT_BAR} />
      </OperatorPageBody>
    </PageContainer>
  );
}
