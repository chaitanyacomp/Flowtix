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
import { useErpRoleUi } from "../hooks/useErpRoleUi";
import { useAuth } from "../hooks/useAuth";
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
import { isDispatchOpenListLineCandidate } from "../lib/dispatchOpenListEligibility";
import { useErpRefreshTick } from "../hooks/useErpRefreshTick";
import {
  OperatorMainSplit,
  OperatorPageBody,
  OperatorTopBar,
  operatorInputClass,
  operatorTableRowClass,
} from "../components/erp/OperatorWorkbench";
import { PageContainer } from "../components/PageHeader";
import { NoQtyCycleContextBar } from "../components/erp/foundation/NoQtyCycleContextBar";
import { Settings } from "lucide-react";
import {
  OperationalContextBar,
  OperationalContextSticky,
  OperationalWorkspaceFooter,
  OpCtxSep,
  type OperationalFooterSection,
} from "../components/erp/OperationalWorkspaceChrome";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { displayDispatchNo, displaySalesOrderNo } from "../lib/docNoDisplay";
import { ActivityHistoryCard } from "../components/ActivityHistoryCard";
import { buildNoQtyGuidedHref, useNoQtyFlowState } from "../lib/noQtyFlowState";
import { openCurrentRsButtonLabel } from "../lib/noQtyRsActionLabels";
import { useToast } from "../contexts/ToastContext";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { DemoSafeNoQtyContinue } from "../components/demo/DemoSafeNoQtyContinue";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";
import { NO_QTY_TERMS, REGULAR_TERMS } from "../lib/flowTerminology";
import { OperationalDispatchSnapshot } from "../components/erp/OperationalDispatchSnapshot";
import { buildNoQtyOperationalMetrics } from "../lib/noQtyOperationalMetrics";
import { DISPATCH_WRITE_ROLES } from "../config/erpRoles";

/** Soft flag for optional dashboard reminders — user chose “wait” on NORMAL partial dispatch (no API). */
const DISPATCH_PARTIAL_WAIT_STORAGE_PREFIX = "erp:dispatch:partial-wait:";

/** Operator-facing copy: UNLOCKED = draft only; LOCKED = stock posted. */
const DISPATCH_OP = {
  BADGE_DRAFT: "Dispatch Draft",
  BADGE_FINAL: "Finalized",
  GUIDANCE_DRAFT_ONLY: "DRAFT ONLY — inventory is not deducted until finalized.",
  BANNER_REOPENED: "Dispatch draft reopened — stock not yet dispatched.",
  FINALIZE: "Finalize Dispatch",
  DISCARD_DRAFT: "Discard draft",
  EDIT_DRAFT_QTY: "Edit draft qty",
  SAVE_DRAFT_FULL: "Save draft (full qty)",
  SAVE_DRAFT_AVAILABLE: "Save draft (available qty)",
  SAVE_DRAFT_QTY: "Save draft qty",
  CARD_TITLE_DRAFT_PENDING: "Finalize dispatch (draft open)",
  CARD_TITLE_REOPENED: "Reopened dispatch draft",
  DOC_SUFFIX_DRAFT: "Draft",
} as const;

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

function resolveNoQtyDispatchSourceCycleId(
  so: Pick<SoRow, "noQtyDispatchContext">,
  ls: Pick<LineStat, "noQtyCycleId">,
  selectedCycleId?: number | null,
): number | null {
  return normalizePositiveCycleId(ls.noQtyCycleId ?? selectedCycleId ?? so.noQtyDispatchContext?.selectedCycleId);
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
    return "Dispatch draft is ready — use Finalize Dispatch to post stock.";
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

function regularPartialDispatchPrefillQty(so: SoRow, ls: LineStat): number | null {
  if (effectiveRegularDispatchReadiness(so, ls) !== "PARTIAL_AVAILABLE") return null;
  const dispatchable = safeNum(ls.dispatchable ?? ls.dispatchableQty ?? 0);
  const pending = linePendingOnOrderDisplay(ls);
  const qty = Math.min(dispatchable, pending);
  return qty > 1e-9 ? qty : null;
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
      ? resolveNoQtyDispatchSourceCycleId(a.so, a.ls)
      : null;
  const cycleB =
    b.so.orderType === "NO_QTY"
      ? resolveNoQtyDispatchSourceCycleId(b.so, b.ls)
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
    return computeNoQtyPhysicalDispatchableNow({ so, ls });
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
function computeNoQtyCycleHeadroom(params: { ls: LineStat }): number {
  const { ls } = params;
  const net = safeNum(ls.operationalNetDispatchedQty ?? ls.cycleDispatchedQty ?? 0);
  const qc = safeNum(ls.cycleQcAcceptedQty ?? ls.qcAccepted ?? 0);
  const recheck = safeNum(ls.cycleRecheckAcceptedQty ?? 0);
  const post = safeNum(ls.postCycleApprovalQty ?? 0);
  return Math.max(0, qc + recheck + post - net);
}

function finiteQtyOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function noQtyFreeUsableStockForItem(so: SoRow, itemId: number, usableStock: number): number {
  return Math.max(0, safeNum(usableStock) - totalNoQtyDraftQtyForItem(so, itemId));
}

function computeNoQtyPhysicalDispatchableNow(params: { so: SoRow; ls: LineStat }): number {
  const { so, ls } = params;
  if (so.orderType !== "NO_QTY") return 0;
  const serverCapped = finiteQtyOrNull(ls.dispatchable ?? ls.dispatchableQty);
  if (serverCapped != null) return serverCapped;
  return Math.min(computeNoQtyCycleHeadroom({ ls }), noQtyFreeUsableStockForItem(so, ls.itemId, getUsableStock(ls)));
}

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
  if (so.orderType === "NO_QTY") return base;
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
          ? resolveNoQtyDispatchSourceCycleId(so, ls)
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
    const cyc = resolveNoQtyDispatchSourceCycleId(so, ls, noQtySelectedCycleId);
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
          ? resolveNoQtyDispatchSourceCycleId(so, ls)
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

function regularLineNetDispatched(ls: LineStat): number {
  return Math.max(0, safeNum(ls.operationalNetDispatchedQty ?? ls.dispatched));
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
      ? normalizePositiveCycleId(rowNoQtyCycleId ?? noQtySelectedCycleId ?? so.noQtyDispatchContext?.selectedCycleId)
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
  const usable = lines.reduce((max, ls) => Math.max(max, getUsableStock(ls)), 0);
  const freeUsable = noQtyFreeUsableStockForItem(so, itemId, usable);
  let sum = 0;
  for (const ls of lines) {
    const cyc = resolveNoQtyDispatchSourceCycleId(so, ls);
    sum += computeDispatchableNow({ so, ls, cycleIdOverride: cyc });
  }
  return Math.min(sum, freeUsable);
}

/** Per-cycle dispatchable split for the workbench (UI only; same inputs as computeDispatchableNow per row). */
type NoQtyHeadroomBreakdown = {
  selectedCycleId: number | null;
  selectedCycleNo: number | null;
  thisCycleHeadroom: number;
  carryForwardByCycle: Array<{ cycleId: number; cycleNo: number | null; qty: number }>;
  carryForwardTotal: number;
  cycleFifoHeadroom: number;
  usableStockNow: number;
  dispatchPossibleNow: number;
  stockLimitedQty: number;
};

function computeNoQtyHeadroomBreakdownForItem(
  so: SoRow,
  itemId: number,
  selectedCycleId: number | null,
): NoQtyHeadroomBreakdown | null {
  if (so.orderType !== "NO_QTY" || !itemId) return null;
  const sel = normalizePositiveCycleId(selectedCycleId);
  const eps = 1e-9;
  const rows = (so.lineStats || []).filter((l) => Number(l.itemId) === Number(itemId));
  let thisCycleHeadroom = 0;
  let totalCycleHeadroom = 0;
  let usableStockNow = 0;
  const otherMap = new Map<number, { qty: number; cycleNo: number | null }>();
  let selectedCycleNo: number | null = null;

  for (const ls of rows) {
    const cyc = resolveNoQtyDispatchSourceCycleId(so, ls);
    if (cyc == null) continue;
    const d = computeNoQtyCycleHeadroom({ ls });
    totalCycleHeadroom += d;
    usableStockNow = Math.max(usableStockNow, getUsableStock(ls));
    const cno = ls.noQtyCycleNo != null && Number.isFinite(Number(ls.noQtyCycleNo)) ? Number(ls.noQtyCycleNo) : null;
    if (sel != null && cyc === sel) {
      thisCycleHeadroom += d;
      selectedCycleNo = selectedCycleNo ?? cno;
    } else if (d > eps) {
      const prev = otherMap.get(cyc) ?? { qty: 0, cycleNo: cno };
      otherMap.set(cyc, { qty: prev.qty + d, cycleNo: prev.cycleNo ?? cno });
    }
  }

  const carryForwardByCycle = [...otherMap.entries()]
    .map(([cycleId, v]) => ({ cycleId, cycleNo: v.cycleNo, qty: v.qty }))
    .sort((a, b) => {
      const an = a.cycleNo ?? a.cycleId;
      const bn = b.cycleNo ?? b.cycleId;
      return an - bn;
    });
  const carryForwardTotal = carryForwardByCycle.reduce((s, x) => s + x.qty, 0);
  const freeUsable = noQtyFreeUsableStockForItem(so, itemId, usableStockNow);
  const dispatchPossibleNow = Math.min(totalCycleHeadroom, freeUsable);

  return {
    selectedCycleId: sel,
    selectedCycleNo,
    thisCycleHeadroom,
    carryForwardByCycle,
    carryForwardTotal,
    cycleFifoHeadroom: totalCycleHeadroom,
    usableStockNow,
    dispatchPossibleNow,
    stockLimitedQty: Math.max(0, totalCycleHeadroom - dispatchPossibleNow),
  };
}

const LEDGER_PAGE_SIZE = 10;

function rowStatusBadge(d: DispatchEvent): { label: string; className: string } {
  if (d.reversalOfId != null) {
    return { label: "Reversed", className: "bg-red-50 text-red-900 border-red-200" };
  }
  if (d.workflowStatus === "UNLOCKED") {
    return {
      label: DISPATCH_OP.BADGE_DRAFT,
      className: "bg-amber-100 text-amber-950 border-amber-300 ring-1 ring-amber-200/90",
    };
  }
  return {
    label: DISPATCH_OP.BADGE_FINAL,
    className: "bg-emerald-100 text-emerald-950 border-emerald-300 ring-1 ring-emerald-100/90",
  };
}

/** Compact QC vs dispatch context for the active line (matches GET /api/dispatch/sales-orders fields). */
function DispatchAvailabilityStrip({
  orderType,
  line,
  readyToShip,
  noQtyNextAction,
  compact = false,
}: {
  orderType?: string;
  line: LineStat;
  readyToShip: number;
  /** NO_QTY: plain-language next step when Dispatchable Now is 0 */
  noQtyNextAction?: string | null;
  /** Dense neutral breakdown for MES-style panels (NORMAL orders only). */
  compact?: boolean;
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

  if (compact) {
    return (
      <div className="rounded border border-slate-200/80 bg-white/80 px-2 py-1.5 text-[10px] leading-tight text-slate-800">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="tabular-nums">
            <span className="text-slate-500">QC passed</span>{" "}
            <span className="font-semibold text-slate-900">{fmtDispatchQty(qcPassed)}</span>
          </span>
          <span className="tabular-nums">
            <span className="text-slate-500">Net shipped</span>{" "}
            <span className="font-semibold text-slate-900">{fmtDispatchQty(netDispatched)}</span>
          </span>
          <span className="tabular-nums">
            <span className="text-slate-500">Pool left</span>{" "}
            <span className="font-semibold text-slate-900">{fmtDispatchQty(poolRemaining)}</span>
          </span>
          <span className="tabular-nums">
            <span className="text-slate-500">On hand</span>{" "}
            <span className="font-semibold text-slate-900">{fmtDispatchQty(stock)}</span>
          </span>
          <span className="tabular-nums">
            <span className="text-slate-500">Max prepare</span>{" "}
            <span className="font-semibold text-emerald-900">{fmtDispatchQty(readyToShip)}</span>
          </span>
        </div>
        {reworkHint > 1e-9 ? (
          <p className="mt-1 text-[9px] text-slate-500">
            Hold / rework (not dispatchable): <span className="tabular-nums font-medium">{fmtDispatchQty(reworkHint)}</span>
          </p>
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
  /** Dense MES-style KPI strip for Regular SO dispatch panel only */
  variant?: "default" | "exec";
}) {
  const { so, ls, readyToShip, noQtyNextAction, regularReadiness, variant = "default" } = props;
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

  if (variant === "exec" && regNormal) {
    return (
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-b border-slate-200/80 pb-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-none">
          <span className="text-slate-500">Pending</span>
          <span className="font-bold tabular-nums text-amber-950">{fmtDispatchQty(pending)}</span>
        </div>
        <span className="hidden text-slate-300 sm:inline" aria-hidden>
          ·
        </span>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-none">
          <span className="text-slate-500">Ready now</span>
          <span
            className={cn(
              "font-bold tabular-nums",
              partialRegularUx ? "text-slate-900" : "text-emerald-800",
            )}
          >
            {fmtDispatchQty(displayMaxPrepare)}
          </span>
        </div>
        <span className="hidden text-slate-300 sm:inline" aria-hidden>
          ·
        </span>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-none">
          <span className="text-slate-500">Usable</span>
          <span className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(usable)}</span>
        </div>
        {shortNote.trim() && !(regNormal && maxNow > NO_QTY_BLOCK_EPS) ? (
          <span className="w-full text-[10px] leading-snug text-slate-600 sm:w-auto sm:max-w-[20rem]">{shortNote}</span>
        ) : null}
        <details className="w-full sm:ml-auto sm:w-auto">
          <summary className="cursor-pointer list-none py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 [&::-webkit-details-marker]:hidden">
            QC / pool
          </summary>
          <div className="mt-1">
            <DispatchAvailabilityStrip
              orderType={so.orderType}
              line={ls}
              readyToShip={readyToShip}
              noQtyNextAction={noQtyNextAction}
              compact
            />
          </div>
        </details>
      </div>
    );
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
  const liveTick = useErpRefreshTick(["dispatch", "dashboard", "reports", "sales", "customer-tracking"], {
    pollIntervalMs: 0,
  });
  const [sp, setSearchParams] = useSearchParams();
  const location = useLocation();
  const source = sp.get("source") ?? "";
  const fromNoQtySo = source === "no_qty_so";
  const fromGlobalSearch = source === "global_search";
  const fromDashboard = source === "dashboard";
  const focusSalesOrderLineId = Number(sp.get("salesOrderLineId") ?? 0);
  const focusSalesOrderLineIdValid = Number.isFinite(focusSalesOrderLineId) && focusSalesOrderLineId > 0;
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
  const roleUi = useErpRoleUi();
  const { user } = useAuth();
  const canDispatchWrite = (DISPATCH_WRITE_ROLES as readonly string[]).includes(user?.role ?? "");
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
      setIsPartialMode(true);
      setReopenedPreparedDraft({
        id: draft.id,
        workflowStatus: "UNLOCKED",
        soId: Number(draft.soId),
        itemId: Number(draft.itemId),
        cycleId: draft.cycleId != null ? Number(draft.cycleId) : null,
        qty: String(draft.qty ?? ""),
        docNo: draft.docNo ?? null,
      });
      setDispatchInfo(`Reopened dispatch draft ${draft.docNo ?? `#${draft.id}`}. ${DISPATCH_OP.BANNER_REOPENED}`);
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
      (fromNoQtySo && focusSoIdValid) || (fromGlobalSearch && focusSoIdValid) || (fromDashboard && focusSoIdValid)
        ? focusSoId
        : soId;
    const pinCycle = noQtySelectedCycleId;
    const selectedRow = displayRowsRef.current.find((r) => r.id === pinSo);
    const allowNoQtyCycleQuery =
      pinSo > 0 &&
      pinCycle != null &&
      (((fromNoQtySo || fromDashboard) && focusSoIdValid && pinSo === focusSoId) || selectedRow?.orderType === "NO_QTY");
    if (allowNoQtyCycleQuery) {
      params.set("noQtySoId", String(pinSo));
      params.set("noQtyCycleId", String(pinCycle));
    }
    const qs = params.toString();
    const url = `/api/dispatch/sales-orders${qs ? `?${qs}` : ""}`;
    const list = await apiFetch<SoRow[]>(url);
    const finalRows =
      (fromNoQtySo || fromGlobalSearch || fromDashboard) && focusSoIdValid
        ? (list || []).filter((r) => r.id === focusSoId)
        : list || [];
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
  }, [fromNoQtySo, fromGlobalSearch, fromDashboard, focusSoId, focusSoIdValid, soId, noQtySelectedCycleId]);

  const displayRows = React.useMemo(() => {
    if ((fromNoQtySo || fromGlobalSearch || fromDashboard) && focusSoIdValid) {
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
  }, [rows, fallbackSoRow, reopenFallbackSoRow, soId, fromNoQtySo, fromGlobalSearch, fromDashboard, focusSoId, focusSoIdValid]);

  const displayRowsRef = React.useRef(displayRows);
  displayRowsRef.current = displayRows;

  React.useEffect(() => {
    if (!(fromNoQtySo || fromGlobalSearch || fromDashboard) || !focusSoIdValid) {
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
  }, [fromNoQtySo, fromGlobalSearch, fromDashboard, focusSoIdValid, focusSoId, rows]);

  const selectedSo = React.useMemo(() => displayRows.find((r) => r.id === soId), [displayRows, soId]);

  const noQtyFlowTargetId = React.useMemo(() => {
    if (selectedSo != null) {
      return selectedSo.orderType === "NO_QTY" && selectedSo.id > 0 ? selectedSo.id : null;
    }
    return (fromNoQtySo || fromDashboard) && focusSoIdValid ? focusSoId : null;
  }, [selectedSo, fromNoQtySo, fromDashboard, focusSoIdValid, focusSoId]);

  const noQtyFlowCycleOpt = React.useMemo(() => {
    if (!selectedSo || selectedSo.orderType !== "NO_QTY") return undefined;
    const c =
      noQtySelectedCycleId ??
      selectedSo.noQtyDispatchContext?.selectedCycleId ??
      selectedSo.currentCycleId ??
      null;
    const n = c != null ? Number(c) : null;
    return Number.isFinite(n) && n != null && n > 0 ? n : undefined;
  }, [selectedSo, noQtySelectedCycleId]);

  const { state: noQtyFlowState } = useNoQtyFlowState(
    noQtyFlowTargetId,
    noQtyFlowTargetId != null && noQtyFlowTargetId > 0,
    { cycleId: noQtyFlowCycleOpt },
  );

  // NO_QTY guided entry: when routed from QC/Production with itemId, preselect that item’s first eligible line.
  React.useEffect(() => {
    if (!(fromNoQtySo || fromDashboard) || !focusSoIdValid) return;
    if (!selectedSo || selectedSo.id !== focusSoId) return;
    if (!focusItemIdValid) return;
    if (salesOrderLineId > 0) return;
    const hits = (selectedSo.lineStats || []).filter((l) => Number(l.itemId) === Number(focusItemId));
    if (!hits.length) return;
    const scored = hits.map((l) => ({ l, pend: linePendingOnOrderDisplay(l), cyc: Number(l.noQtyCycleNo ?? 0) }));
    scored.sort((a, b) => b.pend - a.pend || a.cyc - b.cyc);
    const hit = scored[0]?.l ?? hits[0];
    setSalesOrderLineId(hit.lineId);
  }, [fromNoQtySo, fromDashboard, focusSoIdValid, focusSoId, selectedSo, focusItemId, focusItemIdValid, salesOrderLineId]);
  // Read-only when SO is completed/closed, or when the signed-in role cannot post dispatch (e.g. Accounts).
  const dispatchReadOnly = Boolean(selectedSo?.dispatchReadOnly) || !canDispatchWrite;

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
        (fromNoQtySo || fromDashboard) &&
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
    fromDashboard,
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
      } else if ((fromNoQtySo || fromGlobalSearch || fromDashboard) && focusSoIdValid) {
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
    if ((fromNoQtySo || fromGlobalSearch || fromDashboard) && focusSoIdValid && !params.has("cycleId")) {
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
  }, [ledgerPage, ledgerDateFrom, ledgerDateTo, fromNoQtySo, fromGlobalSearch, fromDashboard, focusSoId, focusSoIdValid, soId, noQtySelectedCycleId]);

  React.useEffect(() => {
    void loadLedger();
    const row = displayRowsRef.current.find((r) => r.id === soId);
    if (row?.orderType === "NO_QTY" && noQtySelectedCycleId != null) {
      void loadSalesOrders();
    }
  }, [noQtySelectedCycleId, soId, loadLedger, loadSalesOrders, liveTick]);

  React.useEffect(() => {
    if (!(fromNoQtySo || fromGlobalSearch || fromDashboard) || !focusSoIdValid) setFocusSo(null);
  }, [fromNoQtySo, fromGlobalSearch, fromDashboard, focusSoIdValid]);

  // When opened from NO_QTY Sales Orders, auto-select that SO and load context.
  React.useEffect(() => {
    if ((!fromNoQtySo && !fromGlobalSearch && !fromDashboard) || !focusSoIdValid) return;
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
  }, [fromNoQtySo, fromGlobalSearch, fromDashboard, focusSoId, focusSoIdValid]);

  const refresh = React.useCallback(async () => {
    await loadSalesOrders();
    await loadLedger();
  }, [loadSalesOrders, loadLedger]);

  /** Select SO line. REGULAR partial rows open ready to dispatch the currently available qty. */
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
      const regularPartialQty = r.orderType !== "NO_QTY" ? regularPartialDispatchPrefillQty(r, ls) : null;
      if (regularPartialQty != null) {
        setIsPartialMode(true);
        setDispatchQtyStr(String(regularPartialQty));
      } else {
        setIsPartialMode(false);
        resetDispatchQty();
      }
      window.requestAnimationFrame(() => {
        dispatchFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [resetDispatchQty],
  );

  React.useEffect(() => {
    if (!fromDashboard || !focusSoIdValid || !focusSalesOrderLineIdValid) return;
    if (!selectedSo || selectedSo.id !== focusSoId) return;
    if (selectedSo.orderType === "NO_QTY") return;
    const ls = (selectedSo.lineStats ?? []).find((l) => Number(l.lineId) === Number(focusSalesOrderLineId));
    if (ls) selectLineFromBacklog(selectedSo, ls);
  }, [
    fromDashboard,
    focusSoIdValid,
    focusSalesOrderLineIdValid,
    focusSalesOrderLineId,
    selectedSo,
    focusSoId,
    selectLineFromBacklog,
  ]);

  // NO_QTY usability: when a focused SO is pre-selected, also pre-select the best dispatchable line.
  React.useEffect(() => {
    if (!(fromNoQtySo || fromDashboard) || !focusSoIdValid) return;
    if (!selectedSo || selectedSo.id !== focusSoId) return;
    if (salesOrderLineId > 0) return;
    if (dispatchReadOnly) return;
    const best = (selectedSo.lineStats || []).find((l) => {
      const cyc = resolveNoQtyDispatchSourceCycleId(selectedSo, l, noQtySelectedCycleId);
      return computeDispatchableNow({ so: selectedSo, ls: l, cycleIdOverride: cyc }) > 1e-9;
    });
    const fallback = (selectedSo.lineStats || [])[0];
    const pick = best ?? fallback;
    if (pick) selectLineFromBacklog(selectedSo, pick);
  }, [fromNoQtySo, fromDashboard, focusSoId, focusSoIdValid, selectedSo, salesOrderLineId, dispatchReadOnly, selectLineFromBacklog, noQtySelectedCycleId]);

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
        const cycleId = resolveNoQtyDispatchSourceCycleId(so, ls);
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
  }, [loadSalesOrders, liveTick]);

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
  }, [loadLedger, liveTick]);

  const selectedSoReplacement = selectedSo?.orderType === "REPLACEMENT";

  /** Drop stale SO/line when open-list refresh removes them (e.g. after full dispatch or commercial close). */
  React.useEffect(() => {
    if (!soId) {
      setSalesOrderLineId(0);
      resetDispatchQty();
      return;
    }
    const soStillListed = displayRows.some((r) => r.id === soId);
    if (!soStillListed) {
      const reopeningThisSo =
        reopenedPreparedDraft &&
        Number(reopenedPreparedDraft.soId) === Number(soId) &&
        Number.isFinite(draftDispatchId) &&
        draftDispatchId > 0;
      if (!reopeningThisSo) {
        setSoId(0);
        setSalesOrderLineId(0);
        resetDispatchQty();
        return;
      }
    }
    const so = displayRows.find((r) => r.id === soId);
    if (!so) return;
    const isNoQty = so.orderType === "NO_QTY";
    const selectable = isNoQty
      ? (so.lineStats || []).filter((l) => {
          const cyc = resolveNoQtyDispatchSourceCycleId(so, l, noQtySelectedCycleId);
          return computeDispatchableNow({ so, ls: l, cycleIdOverride: cyc }) > 1e-9;
        })
      : (so.lineStats ?? []).filter((l) => isDispatchOpenListLineCandidate(l, so.orderType));
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
      setSoId(0);
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
        const cyc = resolveNoQtyDispatchSourceCycleId(selectedSo, l, noQtySelectedCycleId);
        const can = computeDispatchableNow({ so: selectedSo, ls: l, cycleIdOverride: cyc });
        return can > 1e-9 || linePendingOnOrderDisplay(l) > 1e-9;
      });
    }
    return allLines.filter((l) => isDispatchOpenListLineCandidate(l, selectedSo.orderType));
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
    const cyc = resolveNoQtyDispatchSourceCycleId(selectedSo, currentLine, noQtySelectedCycleId);
    const dispatchable = computeDispatchableNow({ so: selectedSo, ls: currentLine, cycleIdOverride: cyc });
    if (!(dispatchable > 1e-9)) return;
    const t = error.trim();
    if (t === "No dispatchable quantity remaining for this cycle." || t.toLowerCase().includes("cycle")) {
      setError(null);
    }
  }, [error, selectedSo, currentLine, noQtySelectedCycleId]);
  const noQtyCycleResolved =
    selectedSo && currentLine
      ? resolveNoQtyDispatchSourceCycleId(selectedSo, currentLine, noQtySelectedCycleId)
      : normalizePositiveCycleId(noQtySelectedCycleId ?? selectedSo?.noQtyDispatchContext?.selectedCycleId);
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
  const noQtyUsableStockForCurrentItem =
    selectedSo?.orderType === "NO_QTY" && currentLine ? getUsableStock(currentLine) : null;
  const noQtyDraftExceedsUsable =
    selectedSo?.orderType === "NO_QTY" &&
    noQtyUsableStockForCurrentItem != null &&
    existingDraftQty > noQtyUsableStockForCurrentItem + 1e-9;

  /** Max qty you can enter for prepare = Dispatchable Now (draft-aware). NO_QTY uses summed FIFO pools across cycles. */
  const headroomToPrepare =
    selectedSo?.orderType === "NO_QTY" && noQtyTotalHeadroomForCurrentItem != null
      ? noQtyTotalHeadroomForCurrentItem
      : Math.max(0, currentDispatchableBase - existingDraftQty);
  const readyToShip = headroomToPrepare;
  const currentDispatchableQty = headroomToPrepare;
  /** Upper bound for POST /dispatches qty when replacing an existing draft (draft qty + additional headroom). */
  const maxDispatchPrepareQty =
    selectedSo?.orderType === "NO_QTY" && noQtyUsableStockForCurrentItem != null
      ? Math.min(noQtyUsableStockForCurrentItem, existingDraftQty > 1e-9 ? existingDraftQty + headroomToPrepare : headroomToPrepare)
      : existingDraftQty > 1e-9
        ? existingDraftQty + headroomToPrepare
        : headroomToPrepare;

  const noQtySelectedCycleIdResolved = React.useMemo(
    () =>
      selectedSo && currentLine
        ? resolveNoQtyDispatchSourceCycleId(selectedSo, currentLine, noQtySelectedCycleId)
        : normalizePositiveCycleId(noQtySelectedCycleId ?? selectedSo?.noQtyDispatchContext?.selectedCycleId),
    [
      currentLine?.noQtyCycleId,
      noQtySelectedCycleId,
      selectedSo?.noQtyDispatchContext?.selectedCycleId,
      selectedSo,
    ],
  );

  const noQtyWorkbenchHeadroomBreakdown = React.useMemo(() => {
    if (!selectedSo || selectedSo.orderType !== "NO_QTY" || !currentLine) return null;
    return computeNoQtyHeadroomBreakdownForItem(selectedSo, currentLine.itemId, noQtySelectedCycleIdResolved);
  }, [selectedSo, currentLine, currentLine?.itemId, noQtySelectedCycleIdResolved]);

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

  const onContinuePartialDispatch = React.useCallback(() => {
    if (!selectedSo || !currentLine) return;
    setDispatchInfo(null);
    setError(null);
    const prefill = regularPartialDispatchPrefillQty(selectedSo, currentLine);
    if (prefill != null) {
      setIsPartialMode(true);
      setDispatchQtyStr(String(prefill));
      setNormalPartialDispatchAck(true);
    } else if (headroomToPrepare > 1e-9) {
      const qty = Math.min(headroomToPrepare, confirmedBacklogQty(currentLine));
      setIsPartialMode(true);
      setDispatchQtyStr(String(qty));
      setNormalPartialDispatchAck(true);
    } else {
      setIsPartialMode(false);
      resetDispatchQty();
    }
    window.requestAnimationFrame(() => {
      dispatchFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      dispatchQtyRef.current?.focus({ preventScroll: true });
    });
  }, [selectedSo, currentLine, headroomToPrepare, resetDispatchQty]);

  const dispatchQtyHintPrimary =
    noQtyBlocked && selectedSo?.orderType === "NO_QTY"
      ? "Cannot dispatch: wait for cycle data to load, or reopen the sales order if no active cycle."
      : currentLine && readyToShip > 1e-9
        ? isRegularNormalSalesOrder(selectedSo)
          ? needsPartialDispatchAck
            ? existingDraftQty > 1e-9
              ? `Open dispatch draft: ${fmtDispatchQty(existingDraftQty)}.`
              : null
            : `You can save a draft up to ${fmtDispatchQty(Math.min(readyToShip, remainingSoLine))} (ready now — ${fmtDispatchQty(
                remainingSoLine,
              )} pending on order).${existingDraftQty > 1e-9 ? ` Draft already saved: ${fmtDispatchQty(existingDraftQty)}.` : ""}`
          : selectedSo?.orderType === "NO_QTY"
            ? `You may save a draft up to ${fmtDispatchQty(readyToShip)} when ready (optional).${
                existingDraftQty > 1e-9 ? ` Open draft: ${fmtDispatchQty(existingDraftQty)}.` : ""
              }`
            : `Max draft qty now: ${fmtDispatchQty(readyToShip)}${
                existingDraftQty > 1e-9 ? ` · Open draft: ${fmtDispatchQty(existingDraftQty)}` : ""
              }`
        : currentLine && selectedSo?.orderType === "NO_QTY" && currentDispatchableBase <= 1e-9
          ? noQtySelectedNextAction
          : currentLine && remainingSoLine > 1e-9
            ? (currentLine.dispatchBlockedReason?.trim() ??
                (isRegularNormalSalesOrder(selectedSo)
                  ? "Nothing can be prepared on this line yet (see limits above)."
                  : "Nothing is ready to ship on this line yet."))
            : null;

  const dispatchQtyExceedsPrepareCap = Boolean(
    currentLine &&
      selectedSo &&
      dispatchQtyValid &&
      dispatchQtyParsed != null &&
      dispatchQtyParsed > maxDispatchPrepareQty + 1e-6,
  );

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
    if (!window.confirm("Discard this dispatch draft? Inventory has not been deducted yet.")) return;
    setError(null);
    setDeletingId(dispatchId);
    try {
      await apiFetch(`/api/dispatch/dispatches/${dispatchId}`, { method: "DELETE" });
      setDispatchInfo("Dispatch draft removed.");
      if (reopenedPreparedDraftMode && reopenedPreparedDraft?.id === dispatchId) {
        setReopenedPreparedDraft(null);
        setReopenFallbackSoRow(null);
        // Clear draftDispatchId from URL and return to normal dispatch state.
        const params = new URLSearchParams(sp);
        params.delete("draftDispatchId");
        navigate(`/dispatch?${params.toString()}`, { replace: true });
        toast.showSuccess("Dispatch draft removed.");
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
    const prepareQtyCap = existingDraftQty > 1e-9 ? maxDispatchPrepareQty : currentDispatchableQty;
    if (dispatchQtyParsed > prepareQtyCap + 1e-6) {
      setError(
        selectedSo?.orderType === "NO_QTY"
          ? `Cannot prepare more than current usable stock allows (${fmtDispatchQty(prepareQtyCap)}).`
          : "Exceeds dispatchable quantity",
      );
      dispatchSubmitLockRef.current = false;
      return;
    }
    const avail = safeNum(prepareQtyCap);
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
          alloc.length > 1 ? "Finalize each draft row to post stock." : "Finalize Dispatch to post stock.";
        setDispatchInfo([...lines, `Total → ${fmtDispatchQty(totalAlloc)}`, footer].join("\n"));
      } else {
        setDispatchInfo("Dispatch draft saved. Use Finalize Dispatch to post stock.");
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

  const allowFullHeadroomPartialSubmit =
    isRegularNormalSalesOrder(selectedSo) && currentRegularReadiness === "PARTIAL_AVAILABLE";

  /** Partial dispatch mode: REGULAR partial rows may submit the full available headroom. */
  const partialDispatchQtySubmit = Boolean(
    isPartialMode &&
      !dispatchReadOnly &&
      !dispatching &&
      !noQtyBlocked &&
      selectableLines.length > 0 &&
      currentLine &&
      (readyToShip > 1e-9 || existingDraftQty > 1e-9) &&
      dispatchQtyValid &&
      dispatchQtyParsed != null &&
      dispatchQtyParsed > 1e-9 &&
      (allowFullHeadroomPartialSubmit
        ? dispatchQtyParsed <= headroomToPrepare + 1e-6
        : dispatchQtyParsed < headroomToPrepare - 1e-6) &&
      dispatchQtyParsed <= maxDispatchPrepareQty + 1e-6 &&
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
      (!needsPartialDispatchAck || normalPartialDispatchAck),
  );

  const dispatchFullButtonLabel =
    isRegularNormalSalesOrder(selectedSo) && currentRegularReadiness === "PARTIAL_AVAILABLE"
      ? DISPATCH_OP.SAVE_DRAFT_AVAILABLE
      : DISPATCH_OP.SAVE_DRAFT_FULL;

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
      const cycleId = resolveNoQtyDispatchSourceCycleId(so, ls);
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
    const selectedCycle = resolveNoQtyDispatchSourceCycleId(selectedSo, currentLine, noQtySelectedCycleId);
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
    const sel =
      currentLine != null
        ? resolveNoQtyDispatchSourceCycleId(selectedSo, currentLine, noQtySelectedCycleId)
        : normalizePositiveCycleId(noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId);
    return ledgerRows.some((r) => {
      if (r.soId !== selectedSo.id || r.reversalOfId) return false;
      if (r.workflowStatus !== "LOCKED") return false;
      const c = normalizePositiveCycleId(r.cycleId);
      if (c == null || sel == null || c === sel) return false;
      if (r.salesBillExists === true && r.salesBillIsExported === true) return false;
      return true;
    });
  }, [selectedSo, currentLine, noQtySelectedCycleId, ledgerRows]);

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

  const inDraftOperatorPanel = Boolean(finalizePrepDraftMode || reopenedPreparedDraftMode);

  const qtyInputDisabled =
    dispatching || dispatchReadOnly || noQtyBlocked || !currentLine || (!inDraftOperatorPanel && readyToShip <= 1e-9);

  const canNoQtyDispatchNow = Boolean(
    selectedSo?.orderType === "NO_QTY" &&
      !qtyInputDisabled &&
      dispatchQtyValid &&
      dispatchQtyParsed != null &&
      dispatchQtyParsed > 1e-9 &&
      dispatchQtyParsed <= maxDispatchPrepareQty + 1e-6,
  );

  const canUpdateDispatchDraftQty = Boolean(
    inDraftOperatorPanel &&
      !dispatchReadOnly &&
      !dispatching &&
      !noQtyBlocked &&
      currentLine &&
      primaryFinalizeDraftId != null &&
      existingDraftQty > dqEps &&
      dispatchQtyValid &&
      dispatchQtyParsed != null &&
      dispatchQtyParsed > dqEps &&
      dispatchQtyParsed <= maxDispatchPrepareQty + 1e-6,
  );

  shortcutFlagsRef.current = {
    canPrepareSubmit: partialDispatchQtySubmit || canUpdateDispatchDraftQty,
    canPrepareFull: canDispatchFull,
  };

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

  /** Prepared / reopened draft action card already carries guidance — hide verbose guided panels. */
  const hideGuidedNoQtyVerbosePanel = showPreparedDispatchActionCard || reopenedPreparedDraftMode;

  /** Next billing step: in-session finalize sets salesBillStepDispatchId; refresh uses ledger + guided CREATE or SO/cycle match. */
  const billingTargetDispatchId = React.useMemo(() => {
    if (dispatchReadOnly || !selectedSo) return null;
    if (salesBillStepDispatchId != null) return salesBillStepDispatchId;
    if (guidedBillAction?.kind === "CREATE") return guidedBillAction.dispatchId;

    const cid =
      currentLine != null
        ? resolveNoQtyDispatchSourceCycleId(selectedSo, currentLine, noQtySelectedCycleId)
        : normalizePositiveCycleId(noQtySelectedCycleId ?? selectedSo.noQtyDispatchContext?.selectedCycleId);

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

  const showRegularDispatchEntryPanel =
    isRegularNormalSalesOrder(selectedSo) && safeNum(currentDispatchableQty) > 1e-9;

  const regularPartialContinuationMetrics = React.useMemo(() => {
    const eps = 1e-9;
    if (!isRegularNormalSalesOrder(selectedSo) || !currentLine) return null;
    const pending = confirmedBacklogQty(currentLine);
    const dispatched = regularLineNetDispatched(currentLine);
    const availableNow = safeNum(currentDispatchableQty);
    if (pending <= eps || dispatched <= eps) return null;
    return { pending, dispatched, availableNow };
  }, [selectedSo, currentLine, currentDispatchableQty]);

  const showRegularPartialDispatchContinuation = Boolean(
    showMainDispatchUi &&
      selectedSo &&
      !dispatchReadOnly &&
      currentLine &&
      primaryFinalizeDraftId == null &&
      !showPreparedDispatchActionCard &&
      regularPartialContinuationMetrics &&
      regularPartialContinuationMetrics.pending > 1e-9,
  );

  const canContinueRegularPartialDispatch = Boolean(
    showRegularPartialDispatchContinuation &&
      regularPartialContinuationMetrics &&
      regularPartialContinuationMetrics.availableNow > 1e-9,
  );

  const showDispatchCompletedBillingCardEffective = Boolean(
    showDispatchCompletedBillingCard && !showRegularPartialDispatchContinuation,
  );

  const isRegularDispatchWorkbench = isRegularNormalSalesOrder(selectedSo);

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
        !showDispatchCompletedBillingFallback &&
        !showRegularPartialDispatchContinuation,
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
            ? "Nothing can be saved on this line yet (usable stock may still be available for other needs)."
            : "Nothing is ready to ship on this line yet."))
    : "";

  /** Regular SO: one primary action zone in the dispatch card — suppress footer/top duplicates. */
  const regularOpsActionsInDispatchCard = Boolean(
    isRegularDispatchWorkbench &&
      (showRegularPartialDispatchContinuation ||
        showRegularDispatchEntryPanel ||
        showPreparedDispatchActionCard ||
        stripShowFinalize ||
        dispatchBlockedStripVisible),
  );

  const finalizeStripSubtitle =
    showCompactDispatchStrip && selectedSo && currentLine
      ? `${displaySalesOrderNo(selectedSo.id, selectedSo.docNo)} | ${currentLine.itemName} | Dispatching now: ${stripDispatchingNow}`
      : "";

  const finalizePreparedStripTitle =
    stripShowFinalize && existingDraftQty > dqEps
      ? "Prepared dispatch draft ready on this line"
      : "Prepared dispatch ready to finalize";
  const finalizePreparedStripSubtitle =
    stripShowFinalize && existingDraftQty > dqEps
      ? `Draft qty: ${fmtDispatchQty(existingDraftQty)}\n${
          isRegularNormalSalesOrder(selectedSo) ? "Additional qty you could add now" : "Ready now"
        }: ${fmtDispatchQty(currentDispatchableQty)}\n\n${DISPATCH_OP.GUIDANCE_DRAFT_ONLY} You can finalize even if no additional qty is available.`
      : `${finalizeStripSubtitle} · ${isRegularNormalSalesOrder(selectedSo) ? "Max draft qty" : "Ready"}: ${stripReady}`;

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
    const footerCycleId = noQtyFlowState?.canonicalCycleId ?? noQtyFlowState?.cycleId ?? noQtySelectedCycleId ?? null;
    const rsHref =
      noQtyFooter && soIdValidFooter
        ? buildNoQtyGuidedHref({ to: `/sales-orders/${soIdFooter}/requirement-sheets`, salesOrderId: soIdFooter, cycleId: footerCycleId, fromStep: "dispatch" })
        : soIdValidFooter ? `/sales-orders/${soIdFooter}/requirement-sheets` : "/sales-orders";
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
    const prodHref =
      noQtyFooter && soIdValidFooter
        ? buildNoQtyGuidedHref({ to: "/production", salesOrderId: soIdFooter, cycleId: footerCycleId, fromStep: "dispatch" })
        : soIdValidFooter ? `/production?salesOrderId=${soIdFooter}&fromStep=dispatch` : "/production";
    const qcHref =
      noQtyFooter && soIdValidFooter
        ? buildNoQtyGuidedHref({ to: "/qc-entry", salesOrderId: soIdFooter, cycleId: footerCycleId, fromStep: "dispatch" })
        : soIdValidFooter ? `/qc-entry?salesOrderId=${soIdFooter}&fromStep=dispatch` : "/qc-entry";
    const dispatchHref =
      noQtyFooter && soIdValidFooter
        ? buildNoQtyGuidedHref({ to: "/dispatch", salesOrderId: soIdFooter, cycleId: footerCycleId, fromStep: "dispatch" })
        : soIdValidFooter ? `/dispatch?salesOrderId=${soIdFooter}` : "/dispatch";
    const billHref =
      noQtyFooter && soIdValidFooter
        ? buildNoQtyGuidedHref({ to: "/sales-bills", salesOrderId: soIdFooter, cycleId: footerCycleId, fromStep: "dispatch" })
        : soIdValidFooter ? `/sales-bills?salesOrderId=${soIdFooter}` : "/sales-bills";

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
    const suppressFooterNextActions = regularOpsActionsInDispatchCard;

    const hid = focusSoIdValid ? focusSoId : soIdFooter > 0 ? soIdFooter : 0;
    const showInlineHistory = hid > 0;

    if (showInlineHistory) {
      const soRow =
        displayRows.find((r) => r.id === hid) ?? (fallbackSoRow && fallbackSoRow.id === hid ? fallbackSoRow : undefined);
      const docNoForLabel = soRow?.docNo ?? (focusSo?.id === hid ? focusSo.docNo : null);
      const soLabel = displaySalesOrderNo(hid, docNoForLabel ?? null);
      sections.push({
        key: "history",
        title: undefined,
        children: (
          <details className="rounded border border-slate-200 bg-slate-50/80">
            <summary className="cursor-pointer px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100">
              Activity history ({soLabel})
            </summary>
            <div className="max-h-44 overflow-auto border-t border-slate-200 bg-white px-1 py-1" aria-label={`Dispatch history ${soLabel}`}>
              <ActivityHistoryCard
                title=""
                density="compact"
                query={`module=DISPATCH&salesOrderId=${encodeURIComponent(String(hid))}&limit=50`}
              />
            </div>
          </details>
        ),
      });
    }

    if (dispatchBlockedStripVisible && !suppressFooterNextActions) {
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
    } else if (stripShowFinalize && primaryFinalizeDraftId != null && !showPreparedDispatchActionCard && !suppressFooterNextActions) {
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
              {lockingId === primaryFinalizeDraftId ? "…" : DISPATCH_OP.FINALIZE}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="font-semibold"
              disabled={deletingId === primaryFinalizeDraftId}
              onClick={() => primaryFinalizeDraftId != null && void onDeleteDraft(primaryFinalizeDraftId)}
            >
              {deletingId === primaryFinalizeDraftId ? "…" : DISPATCH_OP.DISCARD_DRAFT}
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
      !showDispatchCompletedBillingFallback &&
      !suppressFooterNextActions
    ) {
      sections.push({
        key: "next",
        title: "Next action",
        children: (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-slate-700">Sales billing pending</span>
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
      !showDispatchCompletedBillingFallback &&
      !suppressFooterNextActions
    ) {
      sections.push({
        key: "next",
        title: "Next action",
        children: (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-slate-700">Billing pending after dispatch</span>
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
      !suppressFooterNextActions &&
      guidedBillAction?.kind === "CREATE"
    ) {
      sections.push({
        key: "next",
        title: "Next action",
        children: (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-slate-700">Sales bill creation pending</span>
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
      sections.push({
        key: "related",
        title: undefined,
        children: (
          <details className="rounded border border-slate-200 bg-slate-50/80">
            <summary className="cursor-pointer px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100">
              Related links
            </summary>
            <div className="border-t border-slate-200 bg-white px-2 py-1.5">{relatedChildren}</div>
          </details>
        ),
      });
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
    noQtyFlowState?.canonicalCycleId,
    noQtyFlowState?.cycleId,
    noQtyShowCompletedSalesBillNext,
    noQtySelectedCycleId,
    onContinuePartialDispatch,
    onCreateSalesBillFromDispatch,
    onDeleteDraft,
    onFinalizeDraftDispatch,
    billingTargetDispatchId,
    canContinueRegularPartialDispatch,
    primaryFinalizeDraftId,
    regularPartialContinuationMetrics,
    salesBillFlowHref,
    salesBillStepDispatchId,
    selectedSo,
    showDispatchCompletedBillingCard,
    showDispatchCompletedBillingFallback,
    showPreparedDispatchActionCard,
    isRegularDispatchWorkbench,
    regularOpsActionsInDispatchCard,
    showRegularPartialDispatchContinuation,
    stripShowFinalize,
    topStripSalesBillNext,
  ]);

  React.useEffect(() => {
    if (
      showPreparedDispatchActionCard ||
      showDispatchCompletedBillingCardEffective ||
      showDispatchCompletedBillingFallback
    )
      setShowOpenLinesQueue(false);
  }, [
    showPreparedDispatchActionCard,
    showDispatchCompletedBillingCardEffective,
    showDispatchCompletedBillingFallback,
  ]);

  function renderSoDispatchLedger(
    layout: "panel" | "belowPrepared",
    opts?: { mesPanel?: boolean; startCollapsed?: boolean },
  ) {
    if (!showSoDispatchLedger || !selectedSo) return null;
    const so = selectedSo;
    const mes = Boolean(opts?.mesPanel) && layout === "panel";
    const collapse = Boolean(opts?.startCollapsed) && layout === "panel";
    const outer =
      layout === "belowPrepared"
        ? "rounded-lg border border-slate-200/80 bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100/70"
        : mes
          ? "mt-1.5 border-t border-slate-100 pt-1.5"
          : "mt-2 border-t border-slate-100 pt-2";
    const titleCls =
      layout === "belowPrepared"
        ? "mb-1 text-[11px] font-semibold text-slate-700"
        : mes
          ? "mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
          : "mb-1 text-[12px] font-semibold text-slate-700";
    const scrollMax = layout === "belowPrepared" ? "max-h-36" : mes ? "max-h-[min(24vh,150px)]" : "max-h-52";
    const tableText = mes ? "text-[11px]" : "text-[13px]";
    const thText = mes ? "text-[10px]" : "text-[12px]";
    const rowPad = mes ? "py-0 pr-2" : "py-0.5 pr-2";

    const ledgerRowsBlock = (
      <div className={cn(scrollMax, "overflow-auto")}>
        <table className={cn("erp-table erp-table-dense w-full", tableText)}>
          <thead>
            <tr className={cn("border-b border-slate-200 text-left text-slate-600", thText)}>
              <th className={cn(rowPad)}>#</th>
              <th className={cn(rowPad)}>Status</th>
              <th className={cn(rowPad)}>Type</th>
              <th className={cn(rowPad)}>Item</th>
              <th className={cn(rowPad, "text-right")}>Qty</th>
              <th className={cn(rowPad)}>Note</th>
              <th className={mes ? "py-0" : "py-0.5"} />
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
              const badgeCls = mes
                ? `inline-flex rounded border px-0.5 py-px text-[9px] font-medium ${badge.className}`
                : `inline-flex rounded border px-1 py-0.5 text-[10px] font-medium ${badge.className}`;
              const actionBtnCls = mes ? "h-6 px-1.5 text-[10px]" : "h-7 px-2 text-[11px]";
              return (
                <tr
                  key={d.id}
                  id={`so-dispatch-ledger-row-${d.id}`}
                  className={cn(
                    "border-t border-slate-100",
                    isRev && "bg-red-50/40",
                    isUnlockedForward && "bg-amber-50/75",
                    isLockedForward && "bg-emerald-50/40",
                  )}
                >
                  <td className={cn(rowPad, "tabular-nums")}>{d.id}</td>
                  <td className={rowPad}>
                    <span className={badgeCls}>{badge.label}</span>
                  </td>
                  <td className={rowPad}>{isRev ? "Reversal" : "Dispatch"}</td>
                  <td className={cn("max-w-[10rem] truncate", rowPad)} title={itemName}>
                    {itemName}
                  </td>
                  <td className={cn(rowPad, "text-right tabular-nums")}>{isRev ? qty : `+${qty}`}</td>
                  <td className={cn(rowPad, "text-slate-600")}>{isRev ? (d.reversalReason?.trim() || "—") : "—"}</td>
                  <td className={cn("erp-table-action-col", mes ? "py-0" : "py-0.5")}>
                    <div className="erp-table-actions">
                      {isUnlockedForward && !so.dispatchReadOnly ? (
                        primaryFinalizeDraftId != null && d.id === primaryFinalizeDraftId ? null : (
                          <>
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              data-testid="finalize-dispatch-btn"
                              className={cn(actionBtnCls, "leading-none")}
                              disabled={lockingId === d.id}
                              onClick={() => onLockDispatch(d.id)}
                            >
                              {lockingId === d.id ? "…" : "Finalize Dispatch"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={actionBtnCls}
                              disabled={deletingId === d.id}
                              onClick={() => onDeleteDraft(d.id)}
                            >
                              {deletingId === d.id ? "…" : "Discard"}
                            </Button>
                          </>
                        )
                      ) : null}
                      {isLockedForward && maxRev > 0 ? (
                        <details className="inline-block text-right">
                          <summary className="cursor-pointer list-none text-[10px] font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 [&::-webkit-details-marker]:hidden">
                            More actions
                          </summary>
                          <div className="erp-table-actions mt-1 border-t border-slate-100 pt-1">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className={cn(actionBtnCls, "leading-none")}
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
                          className={actionBtnCls}
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
                      <td colSpan={7} className={cn("text-slate-500", mes ? "py-1 text-[11px]" : "py-2 text-[12px]")}>
                          No dispatch drafts or finalized rows for this item yet.
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
                                  <th className="erp-table-action-col py-1">Actions</th>
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
    );

    const ledgerLineCount = soLedgerDispatches.length;
    if (collapse) {
      return (
        <details className={outer}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 outline-none hover:text-slate-700 [&::-webkit-details-marker]:hidden">
            <span>Line ledger</span>
            <span className="tabular-nums font-normal text-slate-400">{ledgerLineCount}</span>
          </summary>
          <div className="pt-1">{ledgerRowsBlock}</div>
        </details>
      );
    }

    return (
      <div className={outer}>
        <div className={titleCls}>Dispatch ledger</div>
        {ledgerRowsBlock}
      </div>
    );
  }

  const dispatchBreadcrumbRoot = React.useMemo(() => {
    const st = (location.state as { from?: string } | null)?.from;
    if (st === "dashboard" || fromDashboard) return { to: "/dashboard", label: "Dashboard" as const };
    if (st === "sales-orders") return { to: "/sales-orders", label: "Sales Orders" as const };
    return { to: "/sales-orders", label: "Sales Orders" as const };
  }, [location.state, fromDashboard]);

  return (
    <PageContainer className="erp-flow-page pb-3">
      <div className="mb-1">
        <DemoFlowBanner />
      </div>
      <div className="grid gap-1.5">
        <OperationalContextSticky>
          <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600">
            <Link to={dispatchBreadcrumbRoot.to} className="font-medium text-sky-900 hover:underline">
              {dispatchBreadcrumbRoot.label}
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
            const usable = so && currentLine ? lineAvailableStockTable(so, currentLine) : 0;
            const qcPending = safeNum(currentLine?.qcPendingQty ?? 0);
            const pending = Math.max(0, remainingSoLine);
            const dispatchable = headroomToPrepare;

            const suggest: "RS" | "PROD" | "QC" | "DISPATCH" | "BILL" = (() => {
              if (isNoQty && noQtyFlowState?.primaryActionForCurrentUser === "CREATE_NEXT_RS") return "RS";
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
            const flowCycleId = noQtyFlowState?.canonicalCycleId ?? noQtyFlowState?.cycleId ?? noQtySelectedCycleId ?? null;
            const rsHref =
              isNoQty && soIdValid
                ? buildNoQtyGuidedHref({ to: `/sales-orders/${soId}/requirement-sheets`, salesOrderId: soId, cycleId: flowCycleId, fromStep: "requirement" })
                : soIdValid ? `/sales-orders/${soId}/requirement-sheets` : "/sales-orders";
            const prodHref =
              isNoQty && soIdValid
                ? buildNoQtyGuidedHref({ to: "/production", salesOrderId: soId, cycleId: flowCycleId, fromStep: "dispatch" })
                : soIdValid ? `/production?salesOrderId=${soId}&fromStep=dispatch` : "/production";
            const qcHref =
              isNoQty && soIdValid
                ? buildNoQtyGuidedHref({ to: "/qc-entry", salesOrderId: soId, cycleId: flowCycleId, fromStep: "dispatch" })
                : soIdValid ? `/qc-entry?salesOrderId=${soId}&fromStep=dispatch` : "/qc-entry";
            const dispatchHref =
              isNoQty && soIdValid
                ? buildNoQtyGuidedHref({ to: "/dispatch", salesOrderId: soId, cycleId: flowCycleId, fromStep: "dispatch" })
                : soIdValid ? `/dispatch?salesOrderId=${soId}` : "/dispatch";
            const billHref =
              isNoQty && soIdValid
                ? buildNoQtyGuidedHref({ to: "/sales-bills", salesOrderId: soId, cycleId: flowCycleId, fromStep: "dispatch" })
                : soIdValid ? `/sales-bills?salesOrderId=${soId}` : "/sales-bills";

            const prepareWoHref = soIdValid ? `/work-orders/prepare?salesOrderId=${encodeURIComponent(String(soId))}` : "/work-orders/prepare";

            const statusSeg = dispatchReadOnly
              ? "View-only"
              : showPreparedDispatchActionCard
                ? "Draft open"
                : showDispatchCompletedBillingCard || showDispatchCompletedBillingFallback
                  ? "Bill next"
                  : dispatchBlockedStripVisible
                    ? "Blocked"
                    : "Operational";

            const noQtyCycleNo =
              currentLine?.noQtyCycleNo != null
                ? Number(currentLine.noQtyCycleNo)
                : so?.noQtyDispatchContext?.cycleNo != null
                  ? Number(so.noQtyDispatchContext.cycleNo)
                  : null;

            return (
              <>
                {isNoQty && soIdValid && so ? (
                  <NoQtyCycleContextBar
                    compact
                    className="mt-0.5"
                    soId={so.id}
                    soDocNo={so.docNo ?? null}
                    itemName={currentLine?.itemName ?? null}
                    cycleNo={noQtyCycleNo}
                  />
                ) : (
                  <OperationalContextBar className="mt-1">
                    <span className="font-mono font-semibold tabular-nums text-slate-900">
                      {so ? displaySalesOrderNo(so.id, so.docNo) : focusSoIdValid ? `SO-${focusSoId}` : "—"}
                    </span>
                    <OpCtxSep />
                    <span className="max-w-[14rem] truncate font-medium text-slate-800" title={currentLine?.itemName ?? ""}>
                      {currentLine?.itemName ?? "—"}
                    </span>
                    <OpCtxSep />
                    <span className="text-[11px] font-semibold text-slate-700">{statusSeg}</span>
                  </OperationalContextBar>
                )}
                <div className="erp-next-action-bar mt-1 border-slate-200/90 bg-white/80 py-0.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {isNoQty && canOpenRs ? stepBtn("RS", openCurrentRsButtonLabel(), rsHref, soIdValid) : null}
                    {stepBtn("DISPATCH", "Dispatch", dispatchHref, true)}
                    {roleUi.showDispatchBillingNav ? stepBtn("BILL", "Sales Bill", billHref, soIdValid) : null}
                    {roleUi.showDispatchCrossDeptNav ? (
                      <details className="inline-block text-[11px]">
                        <summary className="cursor-pointer list-none rounded border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                          Related workflow
                        </summary>
                        <div className="mt-1 flex flex-wrap gap-1 rounded border border-slate-200 bg-white p-1 shadow-sm">
                          {!isNoQty ? stepBtn("PREPARE", REGULAR_TERMS.TOOLBAR_PREPARE_WO, prepareWoHref, soIdValid) : null}
                          {stepBtn("PROD", "Production", prodHref, soIdValid)}
                          {stepBtn("QC", "QC", qcHref, soIdValid)}
                          <Link to="/qc-report" className="px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:text-slate-800">
                            QC Report
                          </Link>
                        </div>
                      </details>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {roleUi.showDispatchCrossDeptNav && isNoQty && noQtyFlowState?.overallWorkflowState === "NEXT_RS_READY" ? (
                      <span className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-950">
                        {noQtyFlowState.message ?? noQtyFlowState.workflowSummary ?? "Next RS Ready"}
                      </span>
                    ) : null}
                    {isNoQty && dispatchable > eps && !showPreparedDispatchActionCard ? (
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

        {showPreparedDispatchActionCard ? renderSoDispatchLedger("belowPrepared") : null}

        {showRegularPartialDispatchContinuation && regularPartialContinuationMetrics && !isRegularDispatchWorkbench ? (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-sky-200/80 bg-sky-50/80 px-2.5 py-1.5 text-[11px] leading-snug"
            data-testid="dispatch-partial-continuation-strip"
          >
            <span className="font-semibold text-sky-950">Partial dispatch in progress</span>
            <span className="text-slate-500" aria-hidden>·</span>
            <span>
              Dispatched{" "}
              <span className="font-bold tabular-nums text-slate-900">{fmtDispatchQty(regularPartialContinuationMetrics.dispatched)}</span>
            </span>
            <span className="text-slate-500" aria-hidden>·</span>
            <span>
              Pending{" "}
              <span className="font-bold tabular-nums text-amber-950">{fmtDispatchQty(regularPartialContinuationMetrics.pending)}</span>
            </span>
            <span className="text-slate-500" aria-hidden>·</span>
            <span>
              Available now{" "}
              <span className="font-bold tabular-nums text-emerald-900">{fmtDispatchQty(regularPartialContinuationMetrics.availableNow)}</span>
            </span>
          </div>
        ) : null}

                {showDispatchCompletedBillingCardEffective && billingTargetDispatchId != null ? (
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
              <div className="font-semibold text-amber-950">Dispatch draft pending</div>
              <div className="mt-0.5 text-amber-900">
                A dispatch draft is waiting for finalization. Reopen it from the line ledger above, or use dispatch history below.
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
                    ) : finalizePrepDraftMode && !hideGuidedNoQtyVerbosePanel ? (
                      <div className="flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950">
                        <span className="font-semibold">{DISPATCH_OP.BADGE_DRAFT}</span>
                        <span className="text-amber-900/90">{DISPATCH_OP.GUIDANCE_DRAFT_ONLY} Finalize when ready.</span>
                      </div>
                    ) : hideGuidedNoQtyVerbosePanel ? null : (
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
                            <div className="font-semibold">Draft saved — next step</div>
                            <div className="mt-0.5 text-[11px] text-amber-900">
                              {DISPATCH_OP.GUIDANCE_DRAFT_ONLY} Use Finalize in the card or ledger.
                            </div>
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
                            {!noQtyPartialAfterFirstDispatchThisCycle && !roleUi.quietNoQtyExplanations ? (
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
                                      <div className="text-slate-600">Open dispatch draft</div>
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
                          {d > 0 ? ` · draft saved ${fmtDispatchQty(d)}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </FieldShortcutHint>
              {selectedSo?.orderType === "NO_QTY" && isAdmin ? (
                <div className="erp-form-field min-w-[9rem] max-w-[12rem] shrink-0 self-end">
                  <button
                    type="button"
                    title="Admin tools"
                    className={cn(
                      "mt-0.5 inline-flex w-full items-center justify-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium leading-7 text-slate-700 shadow-sm hover:bg-slate-50",
                      operatorInputClass,
                    )}
                    onClick={() => setNoQtyAdminAdvancedOpen((v) => !v)}
                  >
                    <Settings className="h-3.5 w-3.5" aria-hidden />
                    Admin
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
              ) : !isRegularDispatchWorkbench ? (
                <DispatchDecisionSummaryCard
                  so={selectedSo}
                  ls={currentLine}
                  readyToShip={readyToShip}
                  noQtyNextAction={noQtySelectedNextAction}
                  regularReadiness={currentRegularReadiness}
                />
              ) : null
            ) : null}
              </>
          </OperatorTopBar>

          <OperatorMainSplit
            panelFirstOnLg={selectedSo?.orderType === "NO_QTY" || isRegularDispatchWorkbench}
            lgGridClassName={
              selectedSo?.orderType === "NO_QTY"
                ? "lg:grid-cols-[minmax(0,2.4fr)_minmax(180px,220px)]"
                : isRegularDispatchWorkbench
                  ? "lg:grid-cols-[minmax(0,1.45fr)_minmax(220px,280px)]"
                  : undefined
            }
            panelContainerClassName={
              selectedSo?.orderType === "NO_QTY" || isRegularDispatchWorkbench ? "order-1 min-w-0" : undefined
            }
            panelClassName={isRegularDispatchWorkbench ? "p-2.5" : undefined}
            queue={
              <div className={cn("flex flex-col", isRegularDispatchWorkbench ? "gap-1.5" : "gap-3")}>
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
                <section className={cn("space-y-1", selectedSo?.orderType === "NO_QTY" && "space-y-0.5")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-1">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {selectedSo?.orderType === "NO_QTY" ? "Queue" : "Open lines"}
                    </h3>
                    {selectedSo?.orderType === "NO_QTY" ? null : (
                    <span className="max-w-[min(100%,20rem)] text-[11px] leading-snug text-slate-400">
                      {fromNoQtySo && focusSoIdValid
                        ? "Change line from the item selector in the panel."
                        : noQtyLineEntries
                          ? "FG lines for this cycle."
                          : "Pick an order and line to dispatch."}
                    </span>
                    )}
                  {selectedSo?.orderType === "NO_QTY" ? (
                    <span className="max-w-[min(100%,22rem)] text-[10px] leading-snug text-slate-500">
                      FIFO by cycle — qty shows per source cycle; prepare still allocates oldest pool first.
                    </span>
                  ) : null}
                  </div>
                  {selectedSo?.orderType === "NO_QTY" ? null : (() => {
                    const entries: Array<{ so: SoRow; ls: LineStat }> = noQtyLineEntries
                      ? noQtyLineEntries
                      : [...prepareQueueSections.flatMap((s) => s.rows), ...blockedLines];
                    const summary = entries.reduce(
                      (acc, e) => {
                        const cyc =
                          e.so.orderType === "NO_QTY"
                            ? normalizePositiveCycleId(e.ls.noQtyCycleId ?? e.so.noQtyDispatchContext?.selectedCycleId)
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
                      <details className="rounded border border-slate-200 bg-white">
                        <summary className="cursor-pointer px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                          Open-line queue counts (optional)
                        </summary>
                        <div className="border-t border-slate-100 p-1.5">
                      <div className="grid gap-2 sm:grid-cols-3">
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
                        </div>
                      </details>
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
                        if (s === "OPTIONAL_DISPATCH") return "Optional usable stock";
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
                        /** Sum of per-cycle QC-backed dispatchable (matches prepare FIFO cap). */
                        dispatchableSum: number;
                        /** Source-cycle breakdown (non-zero pools), ascending by cycle no. */
                        dispatchableByCycle: Array<{ cycleId: number; cycleNo: number | null; qty: number }>;
                        qcPendingAny: number;
                        customerPendingAny: number;
                        state: OpState;
                      };

                      const betterFifoPrepareLineStat = (prev: LineStat, next: LineStat, prevDisp: number, nextDisp: number): LineStat => {
                        if (nextDisp > eps && prevDisp <= eps) return next;
                        if (prevDisp > eps && nextDisp <= eps) return prev;
                        if (prevDisp > eps && nextDisp > eps) {
                          const pn = prev.noQtyCycleNo != null && Number.isFinite(Number(prev.noQtyCycleNo)) ? Number(prev.noQtyCycleNo) : 999999;
                          const nn = next.noQtyCycleNo != null && Number.isFinite(Number(next.noQtyCycleNo)) ? Number(next.noQtyCycleNo) : 999999;
                          return nn < pn ? next : prev;
                        }
                        return prev;
                      };

                      const byKey = new Map<string, Grouped>();
                      for (const { so, ls } of entries) {
                        const key = `${so.id}-${ls.itemId}`;
                        const usable = lineAvailableStockTable(so, ls);
                        const cyc = resolveNoQtyDispatchSourceCycleId(so, ls);
                        const visibleCyc = normalizePositiveCycleId(ls.noQtyCycleId ?? so.noQtyDispatchContext?.selectedCycleId);
                        const dispatchable = cyc != null ? computeDispatchableNow({ so, ls, cycleIdOverride: cyc }) : 0;
                        const qcPending = safeNum(ls.qcPendingQty ?? 0);
                        const customerPending = linePendingOnOrderDisplay(ls);

                        const existing = byKey.get(key);
                        if (!existing) {
                          const byCycle: Array<{ cycleId: number; cycleNo: number | null; qty: number }> = [];
                          if (visibleCyc != null && dispatchable > eps) {
                            const cno = ls.noQtyCycleNo != null && Number.isFinite(Number(ls.noQtyCycleNo)) ? Number(ls.noQtyCycleNo) : null;
                            byCycle.push({ cycleId: visibleCyc, cycleNo: cno, qty: dispatchable });
                          }
                          byKey.set(key, {
                            so,
                            itemId: ls.itemId,
                            itemName: ls.itemName,
                            bestLs: ls,
                            usableAny: usable,
                            dispatchableSum: dispatchable,
                            dispatchableByCycle: byCycle,
                            qcPendingAny: qcPending,
                            customerPendingAny: customerPending,
                            state: "COMPLETED",
                          });
                          continue;
                        }

                        existing.usableAny = Math.max(existing.usableAny, usable);
                        existing.dispatchableSum += dispatchable;
                        if (cyc != null && dispatchable > eps) {
                          const cno = ls.noQtyCycleNo != null && Number.isFinite(Number(ls.noQtyCycleNo)) ? Number(ls.noQtyCycleNo) : null;
                          const idx = existing.dispatchableByCycle.findIndex((x) => x.cycleId === cyc);
                          if (idx >= 0) {
                            const prev = existing.dispatchableByCycle[idx];
                            existing.dispatchableByCycle[idx] = { ...prev, qty: prev.qty + dispatchable };
                          } else {
                            existing.dispatchableByCycle.push({ cycleId: cyc, cycleNo: cno, qty: dispatchable });
                          }
                          existing.dispatchableByCycle.sort(
                            (a, b) => (a.cycleNo ?? a.cycleId) - (b.cycleNo ?? b.cycleId),
                          );
                        }
                        existing.qcPendingAny = Math.max(existing.qcPendingAny, qcPending);
                        existing.customerPendingAny = Math.max(existing.customerPendingAny, customerPending);

                        const prevCyc = resolveNoQtyDispatchSourceCycleId(existing.so, existing.bestLs);
                        const prevDisp =
                          prevCyc != null
                            ? computeDispatchableNow({
                                so: existing.so,
                                ls: existing.bestLs,
                                cycleIdOverride: prevCyc,
                              })
                            : 0;
                        const candDisp = dispatchable;
                        if (prevDisp <= eps && candDisp <= eps) {
                          const score = (d: number, q: number, p: number) =>
                            (d > eps ? 3_000_000 + d : 0) + (q > eps ? 2_000 + q : 0) + (p > eps ? 1 + p : 0);
                          const existingScore = score(
                            prevDisp,
                            safeNum(existing.bestLs.qcPendingQty ?? 0),
                            linePendingOnOrderDisplay(existing.bestLs),
                          );
                          const candidateScore = score(candDisp, qcPending, customerPending);
                          if (candidateScore > existingScore) existing.bestLs = ls;
                        } else {
                          existing.bestLs = betterFifoPrepareLineStat(existing.bestLs, ls, prevDisp, candDisp);
                        }
                      }

                      const groups: Grouped[] = [];
                      for (const g of byKey.values()) {
                        const freeUsable = noQtyFreeUsableStockForItem(g.so, g.itemId, g.usableAny);
                        g.dispatchableSum = Math.min(g.dispatchableSum, freeUsable);
                        // Final state rule (explicitly matches your requirement):
                        // - If customer pending = 0 AND usable/dispatchable > 0 => Optional Dispatch
                        // - If customer pending = 0 AND usable/dispatchable = 0 AND no QC/prod pending => Completed
                        // Otherwise QC/prod states.
                        const hasOptional =
                          g.customerPendingAny <= eps && (g.usableAny > eps || g.dispatchableSum > eps);
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
                        <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm ring-1 ring-slate-100/50">
                          <div className="overflow-x-hidden">
                            <table className="w-full table-fixed text-[11px]">
                              <thead className="sticky top-0 z-[1] border-b border-slate-200/80 bg-slate-50/95">
                                <tr className="text-left text-[9px] font-medium uppercase tracking-wide text-slate-500">
                                  <th className="w-[4.75rem] px-1.5 py-1 font-medium">SO</th>
                                  <th className="min-w-0 px-1.5 py-1 font-medium">Item</th>
                                  <th className="w-[3.25rem] px-1.5 py-1 text-right font-medium">Qty</th>
                                  <th className="w-[4.25rem] px-1 py-1 text-right font-medium"> </th>
                                </tr>
                              </thead>
                              <tbody>
                                {groups.map((g) => {
                                  const { so } = g;
                                  const ls = g.bestLs;
                                  const state = g.state;
                                  const selected = soId === so.id && salesOrderLineId === ls.lineId;
                                  const rowQty =
                                    state === "OPTIONAL_DISPATCH"
                                      ? fmtDispatchQty(g.dispatchableSum)
                                      : state === "AWAITING_QC"
                                        ? fmtDispatchQty(g.qcPendingAny)
                                        : state === "AWAITING_PRODUCTION"
                                          ? fmtDispatchQty(g.customerPendingAny)
                                          : "—";
                                  const cycleFifoHint =
                                    state === "OPTIONAL_DISPATCH" && g.dispatchableByCycle.length > 0
                                      ? g.dispatchableByCycle
                                          .map((c) => {
                                            const lab =
                                              c.cycleNo != null && Number.isFinite(c.cycleNo)
                                                ? `Cycle ${c.cycleNo}`
                                                : `Cycle #${c.cycleId}`;
                                            return `Usable stock from ${lab}: ${fmtDispatchQty(c.qty)}`;
                                          })
                                          .join(" · ")
                                      : null;
                                  const action =
                                    state === "OPTIONAL_DISPATCH"
                                      ? { label: "Select", kind: "prepare" as const }
                                      : state === "AWAITING_QC"
                                        ? { label: "Open QC", kind: "qc" as const }
                                        : state === "AWAITING_PRODUCTION"
                                          ? { label: "Open Prod.", kind: "prod" as const }
                                          : { label: "View", kind: "view" as const };
                                  return (
                                    <tr
                                      key={`${so.id}-${g.itemId}`}
                                      className={cn(
                                        "border-t border-slate-100/90 hover:bg-slate-50/50",
                                        operatorTableRowClass,
                                        selected && "bg-sky-50/60",
                                      )}
                                      title={stateLabel(state)}
                                    >
                                      <td className="whitespace-nowrap px-1.5 py-1 font-mono text-[10px] text-slate-800">
                                        {displaySalesOrderNo(so.id, so.docNo)}
                                      </td>
                                      <td className="min-w-0 truncate px-1.5 py-1 text-slate-700" title={g.itemName}>
                                        <div className="truncate">{g.itemName}</div>
                                        {cycleFifoHint ? (
                                          <div className="mt-0.5 truncate text-[9px] font-normal text-slate-500" title={cycleFifoHint}>
                                            {cycleFifoHint}
                                          </div>
                                        ) : null}
                                      </td>
                                      <td className="whitespace-nowrap px-1.5 py-1 text-right font-semibold tabular-nums text-slate-800">
                                        {rowQty}
                                      </td>
                                      <td className="px-1 py-0.5 text-right">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className={cn(
                                            "h-7 min-w-0 px-1.5 text-[10px] font-semibold",
                                            action.kind === "prepare" &&
                                              "border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50",
                                            action.kind === "qc" && "border-amber-200/80 text-amber-950 hover:bg-amber-50/50",
                                            action.kind === "prod" && "border-sky-200/80 text-sky-950 hover:bg-sky-50/50",
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
                    <div
                      className={cn(
                        "overflow-auto rounded border border-slate-200 bg-white",
                        isRegularDispatchWorkbench ? "max-h-[min(28vh,200px)]" : "max-h-[min(30vh,220px)]",
                      )}
                    >
                      <table className="w-full table-fixed text-[12px]">
                        <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                          <tr className="text-left text-[11px] text-slate-600">
                            <th className="w-[38%] px-1.5 py-0.5 font-medium">Customer · SO</th>
                            <th className="w-[32%] px-1.5 py-0.5 font-medium">Item</th>
                            <th className="w-[18%] px-1.5 py-0.5 text-right font-medium">Dispatch</th>
                            <th className="w-[12%] px-1.5 py-0.5 text-right font-medium"> </th>
                          </tr>
                        </thead>
                        <tbody>
                          {noQtyLineEntries
                            ? noQtyLineEntries.map(({ so, ls }) => {
                                const selected = soId === so.id && salesOrderLineId === ls.lineId;
                                const cyc = resolveNoQtyDispatchSourceCycleId(so, ls);
                                const disp = computeDispatchableNow({ so, ls, cycleIdOverride: cyc });
                                const pend = linePendingOnOrderDisplay(ls);
                                const status = backlogStatus(pend, disp);
                                const optionalNoQty = so.orderType === "NO_QTY" && pend <= 1e-9 && disp > 1e-9;
                                const cycleLabel =
                                  ls.noQtyCycleNo != null && Number.isFinite(Number(ls.noQtyCycleNo))
                                    ? `${optionalNoQty ? "Usable stock from " : ""}Cycle ${Number(ls.noQtyCycleNo)}`
                                    : ls.noQtyCycleId != null
                                      ? `${optionalNoQty ? "Usable stock from " : ""}Cycle #${ls.noQtyCycleId}`
                                      : so.noQtyDispatchContext?.cycleLabel?.trim() ||
                                        (so.noQtyDispatchContext?.selectedCycleId != null
                                          ? `Cycle #${so.noQtyDispatchContext.selectedCycleId}`
                                          : "Cycle");
                                return (
                                  <tr
                                    key={`${so.id}-${ls.lineId}-${ls.noQtyCycleId ?? "x"}`}
                                    className={cn(
                                      "border-t border-slate-100",
                                      operatorTableRowClass,
                                      selected && "bg-emerald-50 ring-1 ring-inset ring-emerald-500/30",
                                      fromNoQtySo && soId > 0 && so.id !== soId && "opacity-60",
                                    )}
                                  >
                                    <td className="min-w-0 px-1.5 py-0.5 align-top">
                                      <div className="truncate text-slate-900" title={customerDisplayName(so)}>
                                        {customerDisplayName(so)}
                                      </div>
                                      <div className="font-mono text-[11px] font-semibold text-sky-900">
                                        {displaySalesOrderNo(so.id, so.docNo)}
                                      </div>
                                    </td>
                                    <td className="min-w-0 px-1.5 py-0.5 align-top" title={ls.itemName}>
                                      <div className="truncate font-medium text-slate-900">{ls.itemName}</div>
                                      <div className="truncate text-[10px] text-slate-500">{cycleLabel}</div>
                                    </td>
                                    <td className="px-1.5 py-0.5 text-right align-top tabular-nums">
                                      <div className="font-semibold text-slate-900">{fmtDispatchQty(disp)}</div>
                                      <div
                                        className={cn(
                                          "mt-0.5 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                                          backlogStatusBadgeClass(status),
                                        )}
                                      >
                                        {optionalNoQty ? "Optional usable stock" : backlogStatusLabel(status)}
                                      </div>
                                    </td>
                                    <td className="px-1.5 py-0.5 text-right align-top">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-1.5 text-[11px] font-semibold"
                                        onClick={() => selectLineFromBacklog(so, ls)}
                                        aria-label={`Select ${ls.itemName}`}
                                      >
                                        Select
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })
                            : prepareQueueSections.flatMap((section) => {
                                const header = (
                                  <tr key={`hdr-${section.key}`} className="border-t border-slate-200 bg-slate-100">
                                    <td colSpan={4} className="px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                                      {section.label}
                                    </td>
                                  </tr>
                                );
                                const body = section.rows.map(({ so, ls }) => {
                                  const selected = soId === so.id && salesOrderLineId === ls.lineId;
                                  const rowCyc = resolveNoQtyDispatchSourceCycleId(so, ls);
                                  const ready = computeDispatchableNow({
                                    so,
                                    ls,
                                    cycleIdOverride:
                                      so.orderType === "NO_QTY"
                                        ? rowCyc
                                        : null,
                                  });
                                  const pend = linePendingOnOrderDisplay(ls);
                                  const status = backlogStatus(pend, ready);
                                  const optionalNoQty = so.orderType === "NO_QTY" && pend <= 1e-9 && ready > 1e-9;
                                  const rowCycleLabel =
                                    so.orderType === "NO_QTY"
                                      ? ls.noQtyCycleNo != null && Number.isFinite(Number(ls.noQtyCycleNo))
                                        ? `${optionalNoQty ? "Usable stock from " : ""}Cycle ${Number(ls.noQtyCycleNo)}`
                                        : ls.noQtyCycleId != null
                                          ? `${optionalNoQty ? "Usable stock from " : ""}Cycle #${ls.noQtyCycleId}`
                                          : so.noQtyDispatchContext?.cycleLabel?.trim() || so.noQtyDispatchContext?.selectedCycleId != null
                                            ? so.noQtyDispatchContext?.cycleLabel?.trim() || `Cycle #${so.noQtyDispatchContext?.selectedCycleId}`
                                            : ""
                                      : "";
                                  return (
                                    <tr
                                      key={`${so.id}-${ls.lineId}-${ls.noQtyCycleId ?? "x"}`}
                                      className={cn(
                                        "border-t border-slate-100",
                                        operatorTableRowClass,
                                        selected && "bg-emerald-50 ring-1 ring-inset ring-emerald-500/30",
                                      )}
                                    >
                                      <td className="min-w-0 px-1.5 py-0.5 align-top">
                                        <div className="truncate text-slate-900" title={customerDisplayName(so)}>
                                          {customerDisplayName(so)}
                                        </div>
                                        <div className="font-mono text-[11px] font-semibold text-sky-900">
                                          {displaySalesOrderNo(so.id, so.docNo)}
                                        </div>
                                      </td>
                                      <td className="min-w-0 px-1.5 py-0.5 align-top" title={ls.itemName}>
                                        <div className="truncate font-medium text-slate-900">{ls.itemName}</div>
                                        {rowCycleLabel ? (
                                          <div className="truncate text-[10px] text-slate-500">{rowCycleLabel}</div>
                                        ) : null}
                                      </td>
                                      <td className="px-1.5 py-0.5 text-right align-top tabular-nums">
                                        <div className="font-semibold text-slate-900">{fmtDispatchQty(ready)}</div>
                                        <div
                                          className={cn(
                                            "mt-0.5 inline-flex max-w-full truncate rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                                            backlogStatusBadgeClass(status),
                                          )}
                                          title={
                                            status === "PARTIAL_AVAILABLE"
                                              ? `Available ${fmtDispatchQty(ready)} / Pending ${fmtDispatchQty(pend)}`
                                              : undefined
                                          }
                                        >
                                          {optionalNoQty ? "Optional usable stock" : backlogStatusLabel(status)}
                                        </div>
                                      </td>
                                      <td className="px-1.5 py-0.5 text-right align-top">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-1.5 text-[11px] font-semibold"
                                          onClick={() => selectLineFromBacklog(so, ls)}
                                          aria-label={`Select ${ls.itemName}`}
                                        >
                                          Select
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
                            ? resolveNoQtyDispatchSourceCycleId(so, ls)
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
              <div className={cn("min-w-0", selectedSo?.orderType === "NO_QTY" ? "space-y-2" : isRegularDispatchWorkbench ? "space-y-1.5" : "space-y-3")}>
            {isAdmin && selectedSo?.orderType === "NO_QTY" ? (
              <details className="rounded-md border border-dashed border-slate-200/80 bg-slate-50/30">
                <summary className="cursor-pointer list-none px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 outline-none hover:text-slate-600 [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    <span className="text-slate-400" aria-hidden>
                      ◇
                    </span>
                    Advanced
                  </span>
                </summary>
                <div className="border-t border-slate-200/70 px-2 pb-1.5 pt-1">
                  {noQtyAdminDebugOpen ? (
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
                    <button
                      type="button"
                      className="rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                      onClick={() => setNoQtyAdminDebugOpen(true)}
                    >
                      Open debug
                    </button>
                  )}
                </div>
              </details>
            ) : null}
            {(!showDispatchCompletedBillingCardEffective || showRegularDispatchEntryPanel || showRegularPartialDispatchContinuation) &&
            !showDispatchCompletedBillingFallback ? (
            <Card className="erp-op-workspace-primary min-w-0 overflow-hidden">
              <CardHeader
                className={cn(
                  "border-b border-slate-100 bg-white px-3",
                  selectedSo?.orderType === "NO_QTY" || isRegularDispatchWorkbench ? "py-1.5" : "py-2",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle
                    className={cn(
                      "font-semibold tracking-tight text-slate-900",
                      selectedSo?.orderType === "NO_QTY" || isRegularDispatchWorkbench ? "text-xs" : "text-sm",
                    )}
                  >
                    {finalizePrepDraftMode
                      ? DISPATCH_OP.CARD_TITLE_DRAFT_PENDING
                      : reopenedPreparedDraftMode
                        ? DISPATCH_OP.CARD_TITLE_REOPENED
                        : selectedSo?.orderType === "NO_QTY"
                          ? "Dispatch"
                          : "Ready to Dispatch"}
                  </CardTitle>
                  {!dispatchReadOnly ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {showPreparedDispatchActionCard && primaryFinalizeDraftId != null ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            className="font-semibold"
                            data-testid="prepared-dispatch-finalize-btn"
                            disabled={lockingId === primaryFinalizeDraftId}
                            onClick={() => primaryFinalizeDraftId != null && void onFinalizeDraftDispatch(primaryFinalizeDraftId)}
                          >
                            {lockingId === primaryFinalizeDraftId ? "…" : DISPATCH_OP.FINALIZE}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="font-semibold border-amber-300 bg-white text-amber-950 hover:bg-amber-50"
                            data-testid="prepared-dispatch-edit-draft-btn"
                            onClick={() => {
                              dispatchFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                              window.requestAnimationFrame(() => dispatchQtyRef.current?.focus({ preventScroll: true }));
                            }}
                          >
                            {DISPATCH_OP.EDIT_DRAFT_QTY}
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
                            {deletingId === primaryFinalizeDraftId ? "…" : DISPATCH_OP.DISCARD_DRAFT}
                          </Button>
                          {reopenedPreparedDraftMode ? (
                            <button
                              type="button"
                              className="text-[11px] font-medium text-sky-800 underline decoration-sky-800/40 underline-offset-2 hover:text-sky-950"
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
                          ) : null}
                        </>
                      ) : isRegularDispatchWorkbench ? (
                        <>
                          {showRegularPartialDispatchContinuation ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            className="font-semibold"
                            data-testid="dispatch-continue-partial-btn"
                            disabled={!canContinueRegularPartialDispatch}
                            onClick={() => onContinuePartialDispatch()}
                          >
                            Continue Dispatch
                          </Button>
                          {billingTargetDispatchId != null ? (
                            <Link
                              to={`/sales-bills/new?dispatchId=${billingTargetDispatchId}&from=dispatch`}
                              data-testid="dispatch-partial-create-sales-bill"
                              className={cn(
                                buttonVariants({ size: "sm", variant: "outline" }),
                                "font-medium no-underline",
                                dispatchReadOnly ? "pointer-events-none opacity-50" : "",
                              )}
                            >
                              Create Sales Bill
                            </Link>
                          ) : latestRegularUnbilledDispatchId != null ? (
                            <Link
                              to={`/sales-bills/new?dispatchId=${latestRegularUnbilledDispatchId}&from=dispatch`}
                              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "font-medium no-underline")}
                              data-testid="dispatch-partial-create-sales-bill"
                            >
                              Create Sales Bill
                            </Link>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="font-medium text-slate-700"
                            data-testid="dispatch-partial-view-history-btn"
                            onClick={() =>
                              dispatchHistoryAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                            }
                          >
                            View History
                          </Button>
                        </>
                      ) : showDispatchCompletedBillingCardEffective && billingTargetDispatchId != null ? (
                        <>
                          <Link
                            to={`/sales-bills/new?dispatchId=${billingTargetDispatchId}&from=dispatch`}
                            data-testid="dispatch-next-create-sales-bill-card"
                            className={cn(
                              buttonVariants({ size: "sm", variant: "outline" }),
                              "font-medium no-underline",
                            )}
                          >
                            Create Sales Bill
                          </Link>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="font-medium text-slate-700"
                            onClick={() =>
                              dispatchHistoryAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                            }
                          >
                            View History
                          </Button>
                        </>
                      ) : null}
                        </>
                    ) : null}
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              {finalizePrepDraftMode || (reopenedPreparedDraftMode && reopenedPreparedDraft) ? (
                <CardContent className="space-y-3 border-t border-amber-100/80 bg-amber-50/25 px-3 py-2.5">
                  <div className="rounded-md border-2 border-amber-300/80 bg-amber-50 px-2.5 py-2 shadow-sm">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900/95">{DISPATCH_OP.BADGE_DRAFT}</p>
                    <p className="mt-1 text-[11px] font-medium leading-snug text-amber-950">{DISPATCH_OP.GUIDANCE_DRAFT_ONLY}</p>
                    {reopenedPreparedDraftMode ? (
                      <p className="mt-1 text-[11px] font-semibold text-amber-950">{DISPATCH_OP.BANNER_REOPENED}</p>
                    ) : null}
                    {preparedDispatchDocLabel && preparedDispatchQtyLabel !== "—" ? (
                      <p className="mt-2 text-[12px] text-slate-900">
                        <span className="font-mono font-semibold">{preparedDispatchDocLabel}</span> ·{" "}
                        <span className="tabular-nums font-semibold">{preparedDispatchQtyLabel}</span>{" "}
                        <span className="text-slate-600">(draft, not posted)</span>
                      </p>
                    ) : null}
                  </div>
                  {currentLine ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <FieldShortcutHint
                        show={shortcutHints.activeFieldId === "dispatchQty"}
                        hint={shortcutHints.activeFieldHintText ?? ""}
                        placement="below-end"
                        className="min-w-0 flex-1 sm:max-w-[13rem]"
                      >
                        <div className="erp-form-field min-w-0">
                          <span className="text-[11px] font-medium text-slate-700">Qty for this dispatch draft</span>
                          <Input
                            ref={dispatchQtyRef}
                            {...dispatchQtyBind}
                            type="text"
                            data-testid="dispatch-qty-input"
                            inputMode="decimal"
                            autoComplete="off"
                            className={cn("mt-0.5 h-9 w-full tabular-nums text-sm", operatorInputClass)}
                            placeholder="Qty"
                            value={dispatchQtyStr}
                            disabled={qtyInputDisabled}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                                shortcutHints.markFieldShortcutUsed("dispatchQty");
                              }
                            }}
                          />
                        </div>
                      </FieldShortcutHint>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="dispatch-save-draft-qty-btn"
                        className="h-9 shrink-0 font-semibold"
                        disabled={!canUpdateDispatchDraftQty}
                        onClick={() => {
                          shortcutHints.markFieldShortcutUsed("dispatchPrepare");
                          void onDispatch();
                        }}
                      >
                        {dispatching ? "Saving…" : DISPATCH_OP.SAVE_DRAFT_QTY}
                      </Button>
                    </div>
                  ) : null}
                  <p className="text-[10px] leading-snug text-slate-600">
                    Maximum you can set on this draft now:{" "}
                    <span className="font-semibold tabular-nums text-slate-900">{fmtDispatchQty(maxDispatchPrepareQty)}</span>
                    . Then use <span className="font-semibold">{DISPATCH_OP.FINALIZE}</span> above to post stock.
                  </p>
                </CardContent>
              ) : (
                <CardContent
                  className={cn(
                    selectedSo?.orderType === "NO_QTY"
                      ? "space-y-2 px-3 py-2"
                      : isRegularDispatchWorkbench
                        ? "space-y-2 px-3 py-2"
                        : "space-y-3 px-3 py-2.5",
                  )}
                >
                  {selectedSo?.orderType === "NO_QTY" ? (
                    <div className="space-y-2">
                      <div className="overflow-hidden rounded-lg border border-slate-200/90 bg-white px-2.5 py-2 shadow-sm ring-1 ring-slate-100/70">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-tight text-slate-700">
                          <span className="shrink-0 font-mono font-semibold text-slate-900">
                            {selectedSo ? displaySalesOrderNo(selectedSo.id, selectedSo.docNo) : "—"}
                          </span>
                          <span className="text-slate-300" aria-hidden>
                            ·
                          </span>
                          <span className="min-w-0 max-w-[11rem] truncate sm:max-w-[14rem]">
                            {selectedSo ? customerDisplayName(selectedSo) : "—"}
                          </span>
                          <span className="text-slate-300" aria-hidden>
                            ·
                          </span>
                          <span
                            className="min-w-0 max-w-[9rem] truncate font-medium text-slate-900 sm:max-w-[13rem]"
                            title={currentLine?.itemName ?? ""}
                          >
                            {currentLine?.itemName ?? "—"}
                          </span>
                          <span className="text-slate-300" aria-hidden>
                            ·
                          </span>
                          <span className="shrink-0 text-slate-600">
                            Row cycle{" "}
                            <span className="font-semibold tabular-nums text-slate-900">
                              {currentLine?.noQtyCycleNo ?? selectedSo?.noQtyDispatchContext?.cycleNo ?? "—"}
                            </span>
                          </span>
                        </div>

                        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                          {noQtyWorkbenchHeadroomBreakdown && selectedSo && currentLine ? (
                            <>
                              {(() => {
                                const base = buildNoQtyOperationalMetrics(selectedSo, currentLine.itemId, {
                                  canDispatchNowOverride: noQtyWorkbenchHeadroomBreakdown.dispatchPossibleNow,
                                });
                                const metrics = base
                                  ? {
                                      ...base,
                                      customerPending: noQtyWorkbenchHeadroomBreakdown.cycleFifoHeadroom,
                                      usableStockNow: noQtyWorkbenchHeadroomBreakdown.usableStockNow,
                                      canDispatchNow: noQtyWorkbenchHeadroomBreakdown.dispatchPossibleNow,
                                    }
                                  : {
                                      customerPending: noQtyWorkbenchHeadroomBreakdown.cycleFifoHeadroom,
                                      producedApproved: 0,
                                      totalDispatched: 0,
                                      usableStockNow: noQtyWorkbenchHeadroomBreakdown.usableStockNow,
                                      canDispatchNow: noQtyWorkbenchHeadroomBreakdown.dispatchPossibleNow,
                                    };
                                return <OperationalDispatchSnapshot metrics={metrics} showFlowHint={false} />;
                              })()}
                              {noQtyDraftExceedsUsable ? (
                                <p className="text-[10px] font-medium leading-snug text-red-800">
                                  Draft exceeds current usable stock. Reduce draft qty or wait for more usable stock.
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                              <div className="shrink-0">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                  Can dispatch now
                                </div>
                                <div className="mt-0.5 text-2xl font-bold tabular-nums leading-none text-slate-900 sm:text-[1.65rem]">
                                  {fmtDispatchQty(headroomToPrepare)}
                                </div>
                              </div>
                            </div>
                          )}

                          <FieldShortcutHint
                            show={shortcutHints.activeFieldId === "dispatchQty"}
                            hint={shortcutHints.activeFieldHintText ?? ""}
                            placement="below-end"
                            className="min-w-0 flex-1 sm:max-w-[8rem]"
                          >
                            <div className="erp-form-field min-w-0">
                              <span className="text-[10px] font-medium text-slate-600">Dispatch qty</span>
                              <Input
                                ref={dispatchQtyRef}
                                {...dispatchQtyBind}
                                type="text"
                                data-testid="dispatch-qty-input"
                                inputMode="decimal"
                                autoComplete="off"
                                className={cn(
                                  "mt-0.5 h-9 w-full min-w-[4.5rem] rounded-md border-slate-200 px-2 text-sm tabular-nums",
                                  operatorInputClass,
                                )}
                                placeholder="0"
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
                              {dispatchQtyExceedsPrepareCap ? (
                                <p className="mt-0.5 text-[11px] font-medium text-red-800">
                                  Cannot dispatch more than can dispatch now ({fmtDispatchQty(maxDispatchPrepareQty)}).
                                </p>
                              ) : null}
                            </div>
                          </FieldShortcutHint>

                          <div className="flex shrink-0 items-end gap-1.5">
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              data-testid="prepare-dispatch-btn"
                              className="h-9 shrink-0 rounded-md border-transparent bg-slate-900 px-3 text-[13px] font-semibold text-white shadow-sm hover:bg-slate-950"
                              disabled={!canNoQtyDispatchNow || dispatching}
                              onClick={() => {
                                shortcutHints.markFieldShortcutUsed("dispatchPrepare");
                                void onDispatch();
                              }}
                            >
                              {dispatching ? "Saving…" : DISPATCH_OP.SAVE_DRAFT_QTY}
                            </Button>
                            <button
                              type="button"
                              className="mb-0.5 hidden whitespace-nowrap text-[11px] font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800 sm:inline disabled:pointer-events-none disabled:opacity-50"
                              disabled={dispatching}
                              onClick={() => {
                                setError(null);
                                resetDispatchQty();
                              }}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <div className="mt-1 flex justify-end sm:hidden">
                          <button
                            type="button"
                            className="text-[11px] font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800 disabled:pointer-events-none disabled:opacity-50"
                            disabled={dispatching}
                            onClick={() => {
                              setError(null);
                              resetDispatchQty();
                            }}
                          >
                            Clear
                          </button>
                        </div>

                        {selectedSo?.orderType === "NO_QTY" &&
                        currentLine &&
                        headroomToPrepare > dqEps &&
                        dispatchQtyValid &&
                        dispatchQtyParsed != null &&
                        dispatchQtyParsed > dqEps ? (
                          <div className="mt-2 rounded-md border border-sky-100 bg-sky-50/90 px-2 py-1.5 text-[11px] leading-snug text-sky-950">
                            {dispatchQtyParsed < headroomToPrepare - 1e-6 ? (
                              <span>
                                Remaining{" "}
                                <span className="font-semibold tabular-nums">
                                  {fmtDispatchQty(Math.max(0, headroomToPrepare - dispatchQtyParsed))}
                                </span>{" "}
                                will stay as store stock.
                              </span>
                            ) : (
                              <span>Full available qty will be dispatched.</span>
                            )}
                          </div>
                        ) : null}
                      </div>

                      <details className="rounded-md border border-slate-200/80 bg-slate-50/50">
                        <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100/70 [&::-webkit-details-marker]:hidden">
                          More — order & stock
                        </summary>
                        <div className="border-t border-slate-100 px-2 pb-2 pt-1.5">
                          <div className="grid grid-cols-2 gap-1.5">
                            <div className="rounded border border-slate-200/80 bg-white px-2 py-1.5">
                              <div className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Cust. pend.</div>
                              <div className="text-sm font-semibold tabular-nums text-slate-900">
                                {fmtDispatchQty(Math.max(0, remainingSoLine))}
                              </div>
                            </div>
                            <div className="rounded border border-slate-200/80 bg-white px-2 py-1.5">
                              <div className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Usable line</div>
                              <div className="text-sm font-semibold tabular-nums text-slate-900">
                                {fmtDispatchQty(lineAvailableStockTable(selectedSo, currentLine ?? ({} as any)))}
                              </div>
                            </div>
                            <div className="rounded border border-amber-200/40 bg-amber-50/50 px-2 py-1.5">
                              <div className="text-[9px] font-medium uppercase tracking-wide text-amber-800/90">QC hold</div>
                              <div className="text-sm font-semibold tabular-nums text-amber-950">
                                {fmtDispatchQty(Math.max(0, safeNum(currentLine?.qcHoldQty ?? 0)))}
                              </div>
                            </div>
                            <div className="rounded border border-sky-200/40 bg-sky-50/50 px-2 py-1.5">
                              <div className="text-[9px] font-medium uppercase tracking-wide text-sky-800/90">Rework</div>
                              <div className="text-sm font-semibold tabular-nums text-sky-950">
                                {fmtDispatchQty(Math.max(0, safeNum(currentLine?.reworkQty ?? 0)))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </details>

                      <details className="overflow-hidden rounded-md border border-slate-200/80 bg-white shadow-sm">
                        <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                          Recent dispatches
                        </summary>
                        <div className="border-t border-slate-100">
                          <div className="overflow-x-hidden">
                            <table className="w-full table-fixed text-[11px]">
                              <thead>
                                <tr className="border-b border-slate-100 bg-slate-50/90 text-left text-[9px] font-medium uppercase tracking-wide text-slate-500">
                                  <th className="w-[38%] px-1.5 py-1 font-medium">No.</th>
                                  <th className="w-[22%] px-1.5 py-1 text-right font-medium">Qty</th>
                                  <th className="px-1.5 py-1 font-medium">Date</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(ledgerRows || [])
                                  .filter((r) => r.soId === selectedSo.id && r.itemId === (currentLine?.itemId ?? r.itemId))
                                  .slice(0, 5)
                                  .map((r) => (
                                    <tr
                                      key={r.id}
                                      className={cn("border-t border-slate-100/90 hover:bg-slate-50/40", operatorTableRowClass)}
                                    >
                                      <td className="px-1.5 py-1 font-mono text-[10px]">
                                        <button
                                          type="button"
                                          className="text-left font-semibold text-slate-700 underline decoration-slate-300 underline-offset-1 hover:text-slate-900"
                                          onClick={() => {
                                            const el = document.getElementById(`so-dispatch-ledger-row-${r.id}`);
                                            if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                                          }}
                                        >
                                          {displayDispatchNo(r.id, r.docNo)}
                                        </button>
                                      </td>
                                      <td className="px-1.5 py-1 text-right font-semibold tabular-nums text-slate-800">
                                        {fmtDispatchQty(safeNum(r.dispatchedQty))}
                                      </td>
                                      <td className="px-1.5 py-1 tabular-nums text-slate-600">{String(r.date).slice(0, 10)}</td>
                                    </tr>
                                  ))}
                                {(ledgerRows || []).filter((r) => r.soId === selectedSo.id && r.itemId === (currentLine?.itemId ?? r.itemId))
                                  .length === 0 ? (
                                  <tr>
                                    <td colSpan={3} className="px-2 py-2 text-[11px] text-slate-500">
                                      No history yet.
                                    </td>
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                          <details className="border-t border-slate-100 bg-slate-50/40">
                            <summary className="cursor-pointer px-2 py-1 text-[10px] font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700">
                              Full ledger
                            </summary>
                            <div className="max-h-[40vh] overflow-auto border-t border-slate-100 p-1.5">
                              {renderSoDispatchLedger("panel")}
                            </div>
                          </details>
                        </div>
                      </details>
                    </div>
                  ) : (
                    <>
                  {isRegularDispatchWorkbench && showRegularPartialDispatchContinuation && regularPartialContinuationMetrics ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-amber-200/75 bg-amber-50/45 px-2 py-1 text-[10px] text-amber-950">
                      <span className="font-semibold uppercase tracking-wide text-[9px] text-amber-900/90">Partial</span>
                      <span className="text-slate-600">Shipped</span>
                      <span className="font-bold tabular-nums text-slate-900">
                        {fmtDispatchQty(regularPartialContinuationMetrics.dispatched)}
                      </span>
                      <span className="text-slate-300" aria-hidden>
                        ·
                      </span>
                      <span className="text-slate-600">Pending</span>
                      <span className="font-bold tabular-nums text-amber-950">
                        {fmtDispatchQty(regularPartialContinuationMetrics.pending)}
                      </span>
                      <span className="text-slate-300" aria-hidden>
                        ·
                      </span>
                      <span className="text-slate-600">Ready</span>
                      <span className="font-bold tabular-nums text-emerald-900">
                        {fmtDispatchQty(regularPartialContinuationMetrics.availableNow)}
                      </span>
                    </div>
                  ) : null}
                  {isRegularDispatchWorkbench && selectedSo && currentLine ? (
                    <DispatchDecisionSummaryCard
                      so={selectedSo}
                      ls={currentLine}
                      readyToShip={readyToShip}
                      noQtyNextAction={noQtySelectedNextAction}
                      regularReadiness={currentRegularReadiness}
                      variant="exec"
                    />
                  ) : null}
                  {isRegularDispatchWorkbench ? (
                    <div className="space-y-1">
                      {existingDraftQty > 1e-9 ? (
                        <p className="text-[10px] leading-snug text-amber-900">
                          Open dispatch draft on line:{" "}
                          <span className="font-semibold tabular-nums">{fmtDispatchQty(existingDraftQty)}</span>
                          {headroomToPrepare > 1e-9 ? (
                            <>
                              {" "}
                              · extra headroom{" "}
                              <span className="font-semibold tabular-nums">{fmtDispatchQty(headroomToPrepare)}</span>
                            </>
                          ) : null}
                        </p>
                      ) : headroomToPrepare <= 1e-9 && !needsPartialDispatchAck ? (
                        <p className="text-[10px] text-slate-600">Nothing dispatchable on this line right now.</p>
                      ) : null}
                      {dispatchQtyHintPrimary ? (
                        <p className="text-[10px] leading-snug text-slate-600">{dispatchQtyHintPrimary}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200/90 bg-slate-50/90 px-3 py-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Quantity</div>
                      <p className="mt-1 text-[13px] font-medium leading-snug text-slate-900">
                        {headroomToPrepare > 1e-9 ? (
                          <>
                            Ready to dispatch{" "}
                            <span className="tabular-nums text-emerald-800">{fmtDispatchQty(headroomToPrepare)}</span> units
                            {existingDraftQty > 1e-9 ? (
                              <span className="block text-[12px] font-normal text-slate-600">
                                Draft on this line: {fmtDispatchQty(existingDraftQty)} · extra qty you can add is shown above
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
                  )}

                  {needsPartialDispatchAck && !reopenedPreparedDraftMode ? (
                    <div
                      className={cn(
                        "rounded border border-slate-200 bg-slate-50 text-slate-800",
                        isRegularDispatchWorkbench ? "px-2 py-1.5 text-[11px]" : "px-2.5 py-2 text-[12px]",
                      )}
                    >
                      <p
                        className={cn(
                          "font-medium leading-snug text-slate-800",
                          isRegularDispatchWorkbench ? "text-[11px]" : "text-[12px]",
                        )}
                      >
                        Only {fmtDispatchQty(readyToShip)} available against pending {fmtDispatchQty(remainingSoLine)}.
                      </p>
                      <label
                        className={cn(
                          "mt-2 flex cursor-pointer items-start gap-2 font-medium text-slate-800",
                          isRegularDispatchWorkbench ? "mt-1.5 text-[11px]" : "text-[12px]",
                        )}
                      >
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
                      className={cn("w-full sm:w-auto", isRegularDispatchWorkbench ? "h-8 text-[11px]" : "h-9 text-[12px]")}
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
                    <div className={cn("space-y-2", isRegularDispatchWorkbench && "space-y-1.5")}>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        data-testid="prepare-dispatch-btn"
                        className={cn(
                          "font-semibold shadow-sm",
                          isRegularDispatchWorkbench
                            ? "h-8 w-full max-w-md text-[12px] sm:w-auto"
                            : "h-10 w-full text-[13px]",
                        )}
                        disabled={dispatching || !canDispatchFull}
                        onClick={() => {
                          shortcutHints.markFieldShortcutUsed("dispatchPrepare");
                          void onDispatchFullPrepare();
                        }}
                      >
                        {dispatching
                          ? "Saving…"
                          : existingDraftQty > 1e-9
                            ? "Update draft (full qty)"
                            : dispatchFullButtonLabel}
                      </Button>
                      {noQtyBlocked ? (
                        <p className="text-[11px] text-slate-600">{currentLine ? noQtyBlockedReasonPlain(currentLine) : "Cannot dispatch now"}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {headroomToPrepare > 1e-9 ? (
                    <div className={cn("border-t border-slate-200", isRegularDispatchWorkbench ? "pt-2" : "pt-3")}>
                      {!isPartialMode ? (
                        <button
                          type="button"
                          className={cn(
                            "font-medium text-sky-800 underline decoration-sky-800/40 underline-offset-2 hover:text-sky-950",
                            isRegularDispatchWorkbench ? "text-[11px]" : "text-[12px]",
                          )}
                          onClick={() => {
                            setError(null);
                            resetDispatchQty();
                            setIsPartialMode(true);
                          }}
                        >
                          Need partial dispatch?
                        </button>
                      ) : (
                        <div className={cn("space-y-2", isRegularDispatchWorkbench && "space-y-1.5")}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p
                              className={cn("font-medium text-slate-800", isRegularDispatchWorkbench ? "text-[11px]" : "text-[12px]")}
                            >
                              Partial dispatch
                            </p>
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
                          {!isRegularDispatchWorkbench ? (
                            <p className="text-[11px] leading-snug text-slate-500">
                              Max dispatchable now: <span className="font-semibold tabular-nums">{fmtDispatchQty(headroomToPrepare)}</span>{" "}
                              units.
                            </p>
                          ) : null}
                          <div
                            className={cn(
                              isRegularDispatchWorkbench &&
                                "flex flex-col gap-1.5 sm:flex-row sm:items-end sm:gap-2",
                            )}
                          >
                          <FieldShortcutHint
                            show={shortcutHints.activeFieldId === "dispatchQty"}
                            hint={shortcutHints.activeFieldHintText ?? ""}
                            placement="below-end"
                            className={cn(
                              "min-w-0",
                              isRegularDispatchWorkbench ? "block w-full flex-1 sm:max-w-[11rem]" : "block w-full",
                            )}
                          >
                            <div className={cn("erp-form-field min-w-0", isRegularDispatchWorkbench && "w-full")}>
                              <span
                                className={cn("font-medium text-slate-600", isRegularDispatchWorkbench ? "text-[10px]" : "text-[12px]")}
                              >
                                Qty (max {fmtDispatchQty(headroomToPrepare)})
                              </span>
                              <Input
                                ref={dispatchQtyRef}
                                {...dispatchQtyBind}
                                type="text"
                                data-testid="dispatch-qty-input"
                                inputMode="decimal"
                                autoComplete="off"
                                className={cn(
                                  "mt-0.5 tabular-nums",
                                  isRegularDispatchWorkbench ? "h-8 text-xs" : "h-9 text-[13px]",
                                )}
                                placeholder="Enter qty"
                                value={dispatchQtyStr}
                                disabled={qtyInputDisabled}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                                    shortcutHints.markFieldShortcutUsed("dispatchQty");
                                  }
                                }}
                              />
                              {isPartialMode && qtyMatchesFullHeadroom && !allowFullHeadroomPartialSubmit ? (
                                <p className="mt-1 text-[11px] font-medium text-sky-900">Use Dispatch Full for full quantity.</p>
                              ) : null}
                              {salesOrderLineId > 0 &&
                              currentLine &&
                              selectedSo &&
                              dispatchQtyValid &&
                              dispatchQtyParsed != null &&
                              dispatchQtyExceedsPrepareCap ? (
                                <p className="mt-0.5 text-[11px] font-medium text-red-800">
                                  Cannot dispatch more than can dispatch now ({fmtDispatchQty(maxDispatchPrepareQty)}).
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
                            className={cn(
                              "font-semibold",
                              isRegularDispatchWorkbench
                                ? "h-8 w-full shrink-0 px-3 text-[11px] sm:w-auto"
                                : "h-9 w-full sm:w-auto",
                            )}
                            disabled={!(partialDispatchQtySubmit || canUpdateDispatchDraftQty) || dispatching}
                            onClick={() => {
                              shortcutHints.markFieldShortcutUsed("dispatchPrepare");
                              void onDispatch();
                            }}
                          >
                            {dispatching ? "Saving…" : existingDraftQty > 0 ? "Update draft qty" : DISPATCH_OP.SAVE_DRAFT_QTY}
                          </Button>
                          </div>
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
              <div
                className={cn(
                  "mt-2 space-y-1.5 border-t border-slate-100 pt-2",
                  isRegularDispatchWorkbench && "mt-1 space-y-1 border-slate-100/80 pt-1.5",
                )}
              >
                {existingDraftQty > 0 && !showPreparedDispatchActionCard ? (
                  <div
                    className={cn(
                      "rounded border border-amber-200 bg-amber-50 text-amber-900",
                      isRegularDispatchWorkbench ? "px-2 py-1 text-[11px]" : "px-2 py-1 text-[12px]",
                    )}
                  >
                    <span className="font-medium">
                      <Badge variant="warning" className="mr-1.5 align-middle text-[10px]">
                        Draft
                      </Badge>
                      Draft qty: <span className="tabular-nums font-bold">{fmtDispatchQty(existingDraftQty)}</span>
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
                        Updating this dispatch replaces the draft row (no duplicate drafts).
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

            {!showPreparedDispatchActionCard
              ? renderSoDispatchLedger("panel", isRegularDispatchWorkbench ? { mesPanel: true, startCollapsed: true } : undefined)
              : null}
              </div>
            }
          />
        </div>
      )}

      {!showPreparedDispatchActionCard ? (
      <div ref={dispatchHistoryAnchorRef} id="dispatch-page-history" className="scroll-mt-24">
      <details
        className={cn(
          "erp-op-workspace-secondary rounded-lg border border-slate-200/70 bg-slate-50/30 shadow-none",
          isRegularDispatchWorkbench && "ring-0",
        )}
      >
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center justify-between gap-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden",
            isRegularDispatchWorkbench
              ? "px-2.5 py-1.5 text-xs font-semibold text-slate-800"
              : "px-3 py-2 text-sm font-semibold text-slate-900",
          )}
        >
          <span>Dispatch history</span>
          <span className="text-[11px] font-normal tabular-nums text-slate-500">
            {ledgerTotal === 0 ? "No rows yet" : `${ledgerTotal} ledger row(s)`}
          </span>
        </summary>
        <div
          className={cn(
            "border-t border-slate-100",
            isRegularDispatchWorkbench ? "px-2.5 pb-2 pt-1" : "px-3 pb-3 pt-1",
          )}
        >
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
            <div
              className={cn(
                "overflow-auto",
                isRegularDispatchWorkbench ? "max-h-[min(38vh,260px)]" : "max-h-[min(50vh,360px)]",
              )}
            >
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
                          <th className="erp-table-action-col py-1.5 pr-2">Actions</th>
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
                              <td className="erp-table-action-col py-2 pr-2 align-top">
                                {isRegularNormalLedgerSoOrderType(d.soOrderType) ? (
                                  d.status === "DISPATCHED" ? (
                                    d.salesBillExists === true && d.salesBillId != null && Number(d.salesBillId) > 0 ? (
                                      <Link
                                        to={`/sales-bills/${d.salesBillId}?from=dispatch`}
                                        className="erp-table-act erp-table-act--link"
                                      >
                                        View Sales Bill
                                      </Link>
                                    ) : (
                                      <Link
                                        to={`/sales-bills/new?dispatchId=${d.id}&from=dispatch`}
                                        className="erp-table-act erp-table-act--link"
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
          ) : ledgerTotal === 0 ? (
            <p className="py-2 text-[12px] text-slate-600">No finalized dispatch history for this filter.</p>
          ) : null}
        </div>
      </details>
      </div>
      ) : null}

      <OperationalWorkspaceFooter className="max-w-full" sections={dispatchUnifiedFooterSections} />

      </OperatorPageBody>
    </PageContainer>
  );
}
