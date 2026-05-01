import * as React from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useUrlQueryState } from "../hooks/useUrlQueryState";
import { deleteUrlParamKeys } from "../lib/urlSearchParamsPatch";
import { DrillFocusBanner } from "../components/DrillFocusBanner";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { DRILL_FOCUS_HINT_QC, drillFocusTitleQcProduction, drillFocusTitleWorkOrder } from "../lib/drillFocusCopy";
import { DRILL_DATA, DRILL_QUERY, workOrdersFocusHref } from "../lib/drillDownRoutes";
import { useDrillFocus } from "../hooks/useDrillFocus";
import { apiFetch } from "../services/api";
import {
  getProductionBatchQcPendingQty,
  isActiveQcEntry,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} from "../lib/qcBatchRollups";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { isValidNumberDraft, type NumberDraft, toNumberDraft } from "../lib/numberDraft";
import { useAuth } from "../hooks/useAuth";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useDependentFieldFocus } from "../hooks/useDependentFieldFocus";
import { useMandatoryPositiveQtyDraft } from "../hooks/useMandatoryPositiveQtyDraft";
import {
  OperatorMainSplit,
  OperatorMetricBadge,
  OperatorPageBody,
  OperatorStatusBadge,
  OperatorTopBar,
  operatorInputClass,
  operatorTableRowClass,
} from "../components/erp/OperatorWorkbench";
import { cn } from "../lib/utils";
import {
  PageBackLink,
  PageContainer,
  PageNoQtyFlowBackLink,
  StickyWorkspaceHead,
} from "../components/PageHeader";
import { NoQtyCycleSummaryCard } from "../components/NoQtyCycleSummaryCard";
import { buildNoQtyGuidedHref, useNoQtyFlowState } from "../lib/noQtyFlowState";
import { useToast } from "../contexts/ToastContext";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { DemoSafeNoQtyContinue } from "../components/demo/DemoSafeNoQtyContinue";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";
import { NoQtyFlowStepsCard } from "../components/erp/NoQtyFlowStepsCard";

type ReworkQcQueueRow = {
  itemId: number;
  qcPendingQty: number;
  item: { itemName: string; itemType: string; unit: string };
};

type QcDispQueueRow = {
  id: number;
  qty: number;
  remainingQty: number;
  phase: string;
  status: string;
  remarks: string | null;
  createdAt: string;
  closedAt: string | null;
  supervisorApprovedAt: string | null;
  item: { id: number; itemName: string; unit: string; itemType: string };
  workOrder: { id: number; docNo: string | null; salesOrderId: number; cycleId: number | null; cycle?: { cycleNo?: number | null } | null };
  sourceQcEntry: { id: number; docNo: string | null; productionId: number };
  parentDispositionId: number | null;
};

type LegacyEligibleRow = {
  qcEntryId: number;
  docNo: string | null;
  productionId: number;
  date: string;
  rejectedQty: number;
  rejectedStockBucket: string | null;
  /** Backend: available qty in the ORIGINAL reject source bucket (computed at eligibility time). */
  availableSourceQty?: number;
  /** Backend: original bucket used for reject posting (legacy null treated as QC_HOLD). */
  fromBucket?: string;
  /** Backend: if non-actionable, why. */
  nonActionableReason?: string;
  itemId: number | null;
  itemName: string | null;
  workOrderId: number | null;
  workOrderDocNo: string | null;
};

type LegacyClassifiedRow = {
  id: number;
  sourceQcEntryId: number;
  qcDocNo: string | null;
  itemId: number;
  itemName: string;
  qty: number;
  action: "APPROVE_TO_USABLE" | "MOVE_TO_HOLD" | "SCRAP";
  fromStockBucket: string | null;
  toStockBucket: string | null;
  remarks: string | null;
  createdAt: string;
  createdBy: { id: number; name: string; email: string };
};

/** Backend may return `{ rows: T[] }` or a raw `T[]` depending on client/version. */
function extractApiRows<T>(payload: unknown): T[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload as T[];
  if (typeof payload === "object" && "rows" in payload) {
    const r = (payload as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as T[];
  }
  return [];
}

type ProdRow = {
  id: number;
  producedQty: string;
  /** Production batch date (ISO); shown read-only for alignment */
  date?: string;
  /** Active QC rollups (GET /production-entries); fallback computed from qcEntries if absent */
  qcAcceptedQty?: number;
  qcRejectedQty?: number;
  qcPendingQty?: number;
  workOrderLine: {
    id: number;
    fgItem: { id: number; itemName: string };
    workOrder: { id: number; salesOrderId?: number };
  };
  qcEntries: {
    id: number;
    acceptedQty?: string;
    rejectedQty?: string;
    rejectedStockBucket?: "USABLE" | "QC_HOLD" | "REWORK" | "SCRAP" | null;
    reversedAt?: string | null;
  }[];
};

function qcEntryChecked(q: { acceptedQty?: string; rejectedQty?: string }): number {
  return Number(q.acceptedQty ?? 0) + Number(q.rejectedQty ?? 0);
}

function fmtQcQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

function legacyClassifiedBadgeLabel(action: LegacyClassifiedRow["action"]): string {
  if (action === "APPROVE_TO_USABLE") return "Legacy approved";
  if (action === "MOVE_TO_HOLD") return "Legacy hold";
  return "Legacy scrap";
}

function HoldDispositionRow({
  row,
  disabled,
  onAction,
}: {
  row: QcDispQueueRow;
  disabled: boolean;
  onAction: (action: "TO_USABLE" | "TO_REWORK" | "SCRAP", qty: number, remarks?: string) => void;
}) {
  const [qtyStr, setQtyStr] = React.useState(() => String(row.remainingQty));
  const [rmk, setRmk] = React.useState("");
  React.useEffect(() => {
    setQtyStr(String(row.remainingQty));
  }, [row.id, row.remainingQty]);
  const q = Number(qtyStr);
  const valid = Number.isFinite(q) && q > 1e-6 && q <= row.remainingQty + 1e-6;
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold text-slate-900">{row.item.itemName}</div>
          <div className="mt-0.5 text-[12px] text-slate-600">
            Remaining: <span className="tabular-nums font-medium">{fmtQcQty(row.remainingQty)}</span> · WO{" "}
            {row.workOrder.docNo ?? row.workOrder.id}
          </div>
        </div>
        <OperatorStatusBadge kind="pending">Decision pending</OperatorStatusBadge>
      </div>
      <div className="mt-1 text-[12px] text-slate-600">
        Choose what to do with the hold quantity: approve to usable, send to rework, or scrap.
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="erp-form-field min-w-[6rem]">
          <span className="erp-form-label">Qty for action</span>
          <Input
            type="number"
            min={0}
            step="any"
            className="tabular-nums"
            value={qtyStr}
            onChange={(e) => setQtyStr(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="erp-form-field min-w-[8rem] flex-1">
          <span className="erp-form-label">Remarks</span>
          <Input value={rmk} onChange={(e) => setRmk(e.target.value)} placeholder="Optional" disabled={disabled} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={disabled || !valid} onClick={() => onAction("TO_USABLE", q, rmk.trim() || undefined)}>
          Approve to usable
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || !valid} onClick={() => onAction("TO_REWORK", q, rmk.trim() || undefined)}>
          Send to rework
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || !valid} onClick={() => onAction("SCRAP", q, rmk.trim() || undefined)}>
          Scrap
        </Button>
      </div>
    </div>
  );
}

function toYmdFromIso(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type RejectedStockBucket = "USABLE" | "QC_HOLD" | "REWORK" | "SCRAP";

/** Produced / active accepted / active rejected / pending; matches backend batch QC math */
function qcRollupsForRow(r: ProdRow): { produced: number; accepted: number; rejected: number; pending: number } {
  const producedRaw = Number((r as any)?.producedQty ?? 0);
  const produced = Number.isFinite(producedRaw) ? producedRaw : 0;
  if (
    r.qcAcceptedQty != null &&
    r.qcRejectedQty != null &&
    r.qcPendingQty != null &&
    Number.isFinite(r.qcAcceptedQty) &&
    Number.isFinite(r.qcRejectedQty) &&
    Number.isFinite(r.qcPendingQty)
  ) {
    // Sanitize numeric fields defensively (API rows may have string-ish values in older payloads).
    const a = Number((r as any).qcAcceptedQty);
    const j = Number((r as any).qcRejectedQty);
    const p = Number((r as any).qcPendingQty);
    return {
      produced,
      accepted: Number.isFinite(a) ? a : 0,
      rejected: Number.isFinite(j) ? j : 0,
      pending: Number.isFinite(p) ? p : Math.max(0, produced - (Number.isFinite(a) ? a : 0) - (Number.isFinite(j) ? j : 0)),
    };
  }
  const qcEntries = Array.isArray((r as any)?.qcEntries) ? (r as any).qcEntries : [];
  const accepted = sumActiveQcAcceptedQty(qcEntries);
  const rejected = sumActiveQcRejectedQty(qcEntries);
  const pending = getProductionBatchQcPendingQty(produced, accepted, rejected);
  return { produced, accepted, rejected, pending };
}

function safeQcRollupsForRow(r: ProdRow): { produced: number; accepted: number; rejected: number; pending: number } {
  try {
    const roll = qcRollupsForRow(r);
    return {
      produced: Number.isFinite(roll.produced) ? roll.produced : 0,
      accepted: Number.isFinite(roll.accepted) ? roll.accepted : 0,
      rejected: Number.isFinite(roll.rejected) ? roll.rejected : 0,
      pending: Number.isFinite(roll.pending) ? roll.pending : 0,
    };
  } catch {
    return { produced: 0, accepted: 0, rejected: 0, pending: 0 };
  }
}

function safeWorkOrderIdForRow(r: ProdRow): number {
  const id = Number((r as any)?.workOrderLine?.workOrder?.id ?? 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function safeCycleIdForRow(r: ProdRow): number | null {
  const raw = Number((r as any)?.workOrderLine?.workOrder?.cycleId ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function safeItemNameForRow(r: ProdRow): string {
  return String((r as any)?.workOrderLine?.fgItem?.itemName ?? "");
}

function safeProductionRowId(r: ProdRow): number {
  const id = Number((r as any)?.id ?? 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function safeIsoDate(r: ProdRow): string {
  return String((r as any)?.date ?? "");
}

type QcStatus = "AWAITING_QC" | "PARTIAL_QC" | "COMPLETED_QC";

function qcStatusForRollups(roll: { accepted: number; rejected: number; pending: number }): QcStatus {
  const done = (roll.accepted ?? 0) + (roll.rejected ?? 0);
  const eps = 1e-6;
  if ((roll.pending ?? 0) <= eps) return "COMPLETED_QC";
  if (done <= eps) return "AWAITING_QC";
  return "PARTIAL_QC";
}

function qcStatusLabel(s: QcStatus): string {
  if (s === "AWAITING_QC") return "Awaiting QC";
  if (s === "PARTIAL_QC") return "Partial QC";
  return "Completed QC";
}

export function QcEntryPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const toast = useToast();
  const demo = useDemoMode();
  const qcDemoHl =
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "regular", 4) ??
    demoHighlightKey(demo.enabled, demo.flow, demo.step, "no_qty", 5);
  const showDemoNoQtyQcContinue = demo.enabled && demo.flow === "no_qty" && demo.step === 5;

  const source = sp.get("source") ?? "";
  const fromNoQtySo = source === "no_qty_so";
  const focusSoId = Number(sp.get("salesOrderId") ?? 0);
  const focusSoIdValid = Number.isFinite(focusSoId) && focusSoId > 0;
  const {
    state: noQtyFlowState,
    loading: noQtyFlowLoading,
    error: noQtyFlowError,
    refresh: refreshNoQtyFlow,
  } = useNoQtyFlowState(focusSoIdValid ? focusSoId : null, fromNoQtySo && focusSoIdValid);
  const [focusSo, setFocusSo] = React.useState<{
    id: number;
    customerName: string;
    docNo?: string | null;
    cycleNo?: number | null;
    cycleStatus?: "Active Cycle" | "Closed Cycle";
  } | null>(null);

  const { searchParams, setSearchParams, patch, read } = useUrlQueryState();
  const focusWorkOrderId = Number(searchParams.get(DRILL_QUERY.workOrderId)) || 0;
  const productionIdFromUrl = read.int(DRILL_QUERY.productionId);

  const [rows, setRows] = React.useState<ProdRow[]>([]);
  const [withQcRows, setWithQcRows] = React.useState<ProdRow[]>([]);
  const [olderCycleHistoryRows, setOlderCycleHistoryRows] = React.useState<ProdRow[]>([]);
  const [adjRows, setAdjRows] = React.useState<
    { stockTransactionId: number; date: string; itemId: number; itemName: string; qtyIn: number; qcUsedQty: number; qcPendingQty: number; reason: string | null }[]
  >([]);
  const [custReturnQcRows, setCustReturnQcRows] = React.useState<
    {
      id: number;
      returnNo: string;
      date: string;
      customer: { id: number; name: string };
      item: { id: number; name: string; unit: string };
      qty: number;
      disposition: "QC_HOLD" | "REWORK" | "TO_STOCK";
      currentBucket: "QC_HOLD" | "REWORK";
      status?: string;
      dispatchId: number;
      dispatchNo: string;
    }[]
  >([]);
  const [reworkQcRows, setReworkQcRows] = React.useState<ReworkQcQueueRow[]>([]);
  const [reworkQcItemId, setReworkQcItemId] = React.useState(0);
  const [reworkCheckedQty, setReworkCheckedQty] = React.useState<NumberDraft>("");
  const [reworkRejectedQty, setReworkRejectedQty] = React.useState<NumberDraft>("");
  const [reworkRejectedBucket, setReworkRejectedBucket] = React.useState<RejectedStockBucket | null>(null);
  const [reworkReason, setReworkReason] = React.useState("");
  const [reworkSaving, setReworkSaving] = React.useState(false);
  const [dispQueues, setDispQueues] = React.useState<{
    reworkPendingSupervisor: QcDispQueueRow[];
    reworkApprovedPendingExecution: QcDispQueueRow[];
    readyForQcRecheck: QcDispQueueRow[];
    holdStock: QcDispQueueRow[];
    scrapRegister: QcDispQueueRow[];
  } | null>(null);
  const [supervisorSavingId, setSupervisorSavingId] = React.useState<number | null>(null);
  const [holdActionSavingId, setHoldActionSavingId] = React.useState<number | null>(null);
  const [recheckDispId, setRecheckDispId] = React.useState(0);
  const [recheckCheckedQty, setRecheckCheckedQty] = React.useState<NumberDraft>("");
  const [recheckRejectedQty, setRecheckRejectedQty] = React.useState<NumberDraft>("");
  // Final QC for rework does not allow routing rejects back to rework/hold/usable.
  // Rejected qty is always scrapped.
  const [recheckRejectedBucket, setRecheckRejectedBucket] = React.useState<RejectedStockBucket | null>(null);
  const [recheckReason, setRecheckReason] = React.useState("");
  const [recheckSaving, setRecheckSaving] = React.useState(false);
  const [legacyEligibleRows, setLegacyEligibleRows] = React.useState<LegacyEligibleRow[]>([]);
  const [legacyIneligibleRows, setLegacyIneligibleRows] = React.useState<LegacyEligibleRow[]>([]);
  const [legacyClassifiedRows, setLegacyClassifiedRows] = React.useState<LegacyClassifiedRow[]>([]);
  const [legacyClassifyOpen, setLegacyClassifyOpen] = React.useState<LegacyEligibleRow | null>(null);
  const [legacyClassifyAction, setLegacyClassifyAction] = React.useState<"APPROVE_TO_USABLE" | "MOVE_TO_HOLD" | "SCRAP" | null>(
    null,
  );
  const [legacyClassifyQtyDraft, setLegacyClassifyQtyDraft] = React.useState("");
  const [legacyClassifyRemarks, setLegacyClassifyRemarks] = React.useState("");
  const [legacyClassifySaving, setLegacyClassifySaving] = React.useState(false);
  const [legacyClassifyModalError, setLegacyClassifyModalError] = React.useState<string | null>(null);
  const [legacyEligibleFetchError, setLegacyEligibleFetchError] = React.useState<string | null>(null);
  const [legacyHistoryFetchError, setLegacyHistoryFetchError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [listReady, setListReady] = React.useState(false);

  const [productionId, setProductionId] = React.useState(0);
  /** Maps to API checkedQty (inspected quantity) for this posting. */
  const {
    raw: checkedQtyStr,
    setRaw: setCheckedQtyStr,
    parsed: checkedParsed,
    isValid: checkedQtyValid,
    reset: resetCheckedQty,
  } = useMandatoryPositiveQtyDraft();
  const [rejectedQty, setRejectedQty] = React.useState<NumberDraft>("");
  const demoQcPrefilledRef = React.useRef(false);
  React.useEffect(() => {
    if (!qcDemoHl) demoQcPrefilledRef.current = false;
  }, [qcDemoHl]);
  React.useEffect(() => {
    if (!demo.enabled || !qcDemoHl) return;
    if (productionId <= 0 || demoQcPrefilledRef.current) return;
    demoQcPrefilledRef.current = true;
    setCheckedQtyStr("10");
    setRejectedQty(0);
  }, [demo.enabled, qcDemoHl, productionId, setCheckedQtyStr]);
  const [reason, setReason] = React.useState("");
  const [scrapReusable, setScrapReusable] = React.useState(false);
  const [rejectedStockBucket, setRejectedStockBucket] = React.useState<RejectedStockBucket | null>(null);
  const [rejSplitRework, setRejSplitRework] = React.useState<NumberDraft>("");
  const [rejSplitHold, setRejSplitHold] = React.useState<NumberDraft>("");
  const [rejSplitScrap, setRejSplitScrap] = React.useState<NumberDraft>("");
  const [saving, setSaving] = React.useState(false);
  const [reversingId, setReversingId] = React.useState<number | null>(null);
  const [reverseQcModal, setReverseQcModal] = React.useState<{
    qcEntryId: number;
    acceptedQty: number;
    rejectedQty: number;
    allowedReverseQty: number;
  } | null>(null);
  const [reverseQcQtyDraft, setReverseQcQtyDraft] = React.useState("");
  const [reverseQcReasonDraft, setReverseQcReasonDraft] = React.useState("");
  const [reverseQcPasswordDraft, setReverseQcPasswordDraft] = React.useState("");
  const [reverseQcModalError, setReverseQcModalError] = React.useState<string | null>(null);
  const [custReturnApprovingId, setCustReturnApprovingId] = React.useState<number | null>(null);
  const [custReturnScrappingId, setCustReturnScrappingId] = React.useState<number | null>(null);
  const [custReturnApproveReworkId, setCustReturnApproveReworkId] = React.useState<number | null>(null);
  const [adjTxnId, setAdjTxnId] = React.useState(0);
  const [adjEligibleSos, setAdjEligibleSos] = React.useState<
    { salesOrderId: number; salesOrderNo: string; customerName: string | null; pendingDispatchQty: number }[]
  >([]);
  const [adjSoLoading, setAdjSoLoading] = React.useState(false);
  const [adjSelectedSoId, setAdjSelectedSoId] = React.useState(0);
  const [adjCheckedQty, setAdjCheckedQty] = React.useState<NumberDraft>("");
  const [adjRejectedQty, setAdjRejectedQty] = React.useState<NumberDraft>("");
  const [adjReason, setAdjReason] = React.useState("");
  const [adjSaving, setAdjSaving] = React.useState(false);

  const [prodShowFilter, setProdShowFilter] = React.useState<"ALL" | "AWAITING" | "COMPLETED">("AWAITING");

  const qcFormRef = React.useRef<HTMLDivElement | null>(null);
  const productionSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const checkedQtyRef = React.useRef<HTMLInputElement | null>(null);
  useFastEntryForm({ containerRef: qcFormRef, initialFocusRef: productionSelectRef });

  useDependentFieldFocus({
    targetRef: checkedQtyRef,
    enabled: Boolean(listReady && rows.length > 0 && productionId > 0),
    deps: [productionId],
  });

  /** Batch selector mounts when queue loads; focus once (mirrors Production fast entry). */
  const didInitialBatchFocusRef = React.useRef(false);
  React.useEffect(() => {
    if (!listReady || rows.length === 0) {
      didInitialBatchFocusRef.current = false;
      return;
    }
    if (didInitialBatchFocusRef.current) return;
    didInitialBatchFocusRef.current = true;
    const id = window.setTimeout(() => productionSelectRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [listReady, rows.length]);

  async function refresh(): Promise<ProdRow[]> {
    setError(null);
    const cycleScope =
      fromNoQtySo && focusSoIdValid && noQtyFlowState?.cycleId != null
        ? `&cycleId=${encodeURIComponent(String(noQtyFlowState.cycleId))}`
        : "";
    const soScope = fromNoQtySo && focusSoIdValid ? `&salesOrderId=${focusSoId}${cycleScope}` : "";
    const [withoutRes, withActiveRes, adjRes, custRetRes, reworkQcRes, dispRes, legacyEligRes, legacyHistRes] =
      await Promise.allSettled([
        apiFetch<ProdRow[]>(`/api/production/production-entries?withoutQc=1${soScope}`),
        apiFetch<ProdRow[]>(`/api/production/production-entries?withActiveQc=1${soScope}`),
        apiFetch<{ rows: typeof adjRows }>("/api/production/qc-stock-adjustments"),
        apiFetch<typeof custReturnQcRows>("/api/customer-returns/qc-queue?limit=200"),
        apiFetch<ReworkQcQueueRow[]>("/api/stock/rework-qc-queue"),
        apiFetch<{
          reworkPendingSupervisor: QcDispQueueRow[];
          reworkApprovedPendingExecution: QcDispQueueRow[];
          readyForQcRecheck: QcDispQueueRow[];
          holdStock: QcDispQueueRow[];
          scrapRegister: QcDispQueueRow[];
        }>("/api/production/qc-rejected-dispositions/queues"),
        apiFetch<{ rows: LegacyEligibleRow[]; historicalRows?: LegacyEligibleRow[] }>(
          "/api/production/qc-legacy-classifications/eligible",
        ),
        apiFetch<{ rows: LegacyClassifiedRow[] }>("/api/production/qc-legacy-classifications"),
      ]);

    let withoutRows: ProdRow[] = [];
    if (withoutRes.status === "fulfilled") {
      withoutRows = withoutRes.value;
      setRows(withoutRes.value);
    } else {
      const msg =
        withoutRes.reason instanceof Error ? withoutRes.reason.message : "Failed to load QC queue.";
      setError(msg);
    }

    if (withActiveRes.status === "fulfilled") {
      setWithQcRows(withActiveRes.value);
    } else {
      setWithQcRows([]);
    }

    // NO_QTY: keep current-cycle queue focused; show older cycles only in a collapsed history block.
    if (fromNoQtySo && focusSoIdValid && noQtyFlowState?.cycleId != null) {
      try {
        const all = await apiFetch<ProdRow[]>(`/api/production/production-entries?salesOrderId=${focusSoId}`);
        const curCycleId = Number(noQtyFlowState.cycleId);
        const older = (Array.isArray(all) ? all : []).filter((r) => {
          const cy = safeCycleIdForRow(r);
          return cy != null && Number(cy) !== Number(curCycleId);
        });
        setOlderCycleHistoryRows(older);
      } catch {
        setOlderCycleHistoryRows([]);
      }
    } else {
      setOlderCycleHistoryRows([]);
    }

    if (adjRes.status === "fulfilled") {
      setAdjRows(adjRes.value.rows ?? []);
    } else {
      setAdjRows([]);
    }

    if (custRetRes.status === "fulfilled") {
      setCustReturnQcRows(Array.isArray(custRetRes.value) ? custRetRes.value : []);
    } else {
      setCustReturnQcRows([]);
    }

    if (reworkQcRes.status === "fulfilled") {
      setReworkQcRows(Array.isArray(reworkQcRes.value) ? reworkQcRes.value : []);
    } else {
      setReworkQcRows([]);
    }

    const dispQueuesValue =
      dispRes.status === "fulfilled" && dispRes.value
        ? dispRes.value
        : { reworkPendingSupervisor: [], reworkApprovedPendingExecution: [], readyForQcRecheck: [], holdStock: [], scrapRegister: [] };
    setDispQueues(dispQueuesValue);

    if (legacyEligRes.status === "fulfilled") {
      const legacyRows = extractApiRows<LegacyEligibleRow>(legacyEligRes.value);
      const legacyHistorical = Array.isArray((legacyEligRes.value as any)?.historicalRows)
        ? ((legacyEligRes.value as any).historicalRows as LegacyEligibleRow[])
        : [];
      // Hide legacy classification UI for QC entries already handled by the new disposition flow.
      const dispQcEntryIds = new Set<number>();
      const collect = (list: any[]) => {
        for (const r of Array.isArray(list) ? list : []) {
          const qid = Number(r?.sourceQcEntry?.id ?? 0);
          if (Number.isFinite(qid) && qid > 0) dispQcEntryIds.add(qid);
        }
      };
      collect(dispQueuesValue.reworkPendingSupervisor);
      collect((dispQueuesValue as any).reworkApprovedPendingExecution);
      collect(dispQueuesValue.readyForQcRecheck);
      collect(dispQueuesValue.holdStock);
      collect(dispQueuesValue.scrapRegister);

      setLegacyEligibleRows(legacyRows.filter((r) => !dispQcEntryIds.has(Number(r.qcEntryId))));
      setLegacyIneligibleRows(legacyHistorical.filter((r) => !dispQcEntryIds.has(Number(r.qcEntryId))));
      setLegacyEligibleFetchError(null);
    } else {
      setLegacyEligibleRows([]);
      setLegacyIneligibleRows([]);
      setLegacyEligibleFetchError(
        legacyEligRes.reason instanceof Error
          ? legacyEligRes.reason.message
          : "Failed to load eligible legacy QC rows.",
      );
    }

    if (legacyHistRes.status === "fulfilled") {
      setLegacyClassifiedRows(extractApiRows<LegacyClassifiedRow>(legacyHistRes.value));
      setLegacyHistoryFetchError(null);
    } else {
      setLegacyClassifiedRows([]);
      setLegacyHistoryFetchError(
        legacyHistRes.reason instanceof Error ? legacyHistRes.reason.message : "Failed to load classification history.",
      );
    }

    setListReady(true);
    if (fromNoQtySo && focusSoIdValid) {
      try {
        await refreshNoQtyFlow();
      } catch {
        // ignore; hook surfaces error separately
      }
    }
    return withoutRows;
  }

  React.useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only load
  }, []);

  // Load SO context only when opened from NO_QTY Sales Orders.
  React.useEffect(() => {
    if (!fromNoQtySo || !focusSoIdValid) {
      setFocusSo(null);
      return;
    }
    apiFetch<any>(`/api/sales-orders/${focusSoId}`)
      .then((so) => {
        const customerName = so?.customer?.name ?? so?.po?.customer?.name ?? "—";
        const cycleNo = so?.currentCycle?.cycleNo != null ? Number(so.currentCycle.cycleNo) : null;
        const closed =
          String(so?.internalStatus ?? "") === "COMPLETED" ||
          String(so?.internalStatus ?? "") === "CLOSED" ||
          String(so?.processStage?.key ?? "") === "COMPLETED";
        setFocusSo({
          id: focusSoId,
          customerName,
          docNo: so?.docNo ?? null,
          cycleNo,
          cycleStatus: closed ? "Closed Cycle" : "Active Cycle",
        });
      })
      .catch(() => setFocusSo({ id: focusSoId, customerName: "—", docNo: null, cycleNo: null, cycleStatus: "Active Cycle" }));
  }, [fromNoQtySo, focusSoId, focusSoIdValid]);

  /**
   * Deep-link: ?workOrderId= selects matching production batch. If none (QC already done / not logged),
   * fall back to work order list — approximate until QC queue exposes productionEntryId.
   */
  const qcDrillFallbackDone = React.useRef(false);
  React.useEffect(() => {
    qcDrillFallbackDone.current = false;
  }, [focusWorkOrderId]);

  React.useEffect(() => {
    if (!listReady) return;
    if (!rows.length) {
      setProductionId(0);
      return;
    }

    if (focusWorkOrderId) {
      const match = rows.find((r) => safeWorkOrderIdForRow(r) === focusWorkOrderId);
      if (match) {
        setProductionId(match.id);
        if (searchParams.get(DRILL_QUERY.productionId) !== String(match.id)) {
          patch({ [DRILL_QUERY.productionId]: String(match.id) });
        }
        return;
      }
      if (!qcDrillFallbackDone.current) {
        qcDrillFallbackDone.current = true;
        navigate(workOrdersFocusHref(focusWorkOrderId), { replace: true });
      }
      return;
    }

    if (productionIdFromUrl > 0 && rows.some((r) => r.id === productionIdFromUrl)) {
      setProductionId(productionIdFromUrl);
      return;
    }

    setProductionId((cur) => {
      if (rows.some((r) => r.id === cur)) return cur;
      const sorted = [...rows].sort((a, b) => safeQcRollupsForRow(b).pending - safeQcRollupsForRow(a).pending);
      return sorted[0]?.id ?? 0;
    });
  }, [listReady, rows, focusWorkOrderId, productionIdFromUrl, navigate, patch, searchParams]);

  const drillProductionId = React.useMemo(() => {
    if (!focusWorkOrderId) return 0;
    return rows.find((r) => safeWorkOrderIdForRow(r) === focusWorkOrderId)?.id ?? 0;
  }, [focusWorkOrderId, rows]);

  React.useEffect(() => {
    if (!listReady) return;
    if (adjRows.length && !adjRows.some((r) => r.stockTransactionId === adjTxnId)) {
      setAdjTxnId(adjRows[0].stockTransactionId);
    }
  }, [listReady, adjRows, adjTxnId]);

  const selectedAdj = React.useMemo(() => adjRows.find((r) => r.stockTransactionId === adjTxnId) ?? null, [adjRows, adjTxnId]);

  React.useEffect(() => {
    if (!selectedAdj) {
      setAdjEligibleSos([]);
      setAdjSelectedSoId(0);
      return;
    }
    let cancelled = false;
    setAdjSoLoading(true);
    void (async () => {
      try {
        const res = await apiFetch<{
          rows: {
            salesOrderId: number;
            salesOrderNo: string;
            customerName: string | null;
            pendingDispatchQty: number;
          }[];
        }>(`/api/dispatch/eligible-sales-orders-for-item?itemId=${selectedAdj.itemId}`);
        if (cancelled) return;
        const list = res.rows ?? [];
        setAdjEligibleSos(list);
        setAdjSelectedSoId((cur) => {
          if (list.length === 1) return list[0].salesOrderId;
          if (list.some((r) => r.salesOrderId === cur)) return cur;
          return 0;
        });
      } catch (e) {
        if (!cancelled) {
          setAdjEligibleSos([]);
          setAdjSelectedSoId(0);
          setError(e instanceof Error ? e.message : "Could not load eligible sales orders.");
        }
      } finally {
        if (!cancelled) setAdjSoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAdj]);

  async function submitAdjQc() {
    if (!selectedAdj) return;
    setError(null);
    const soId = adjSelectedSoId;
    if (!Number.isFinite(soId) || soId <= 0) {
      setError("Select a sales order for QC allocation.");
      return;
    }
    const checked = Number(adjCheckedQty);
    const rejected = Number(adjRejectedQty);
    if (!Number.isFinite(checked) || checked <= 0) {
      setError("Checked qty is required.");
      return;
    }
    if (!Number.isFinite(rejected) || rejected < 0) {
      setError("Rejected qty must be 0 or more.");
      return;
    }
    if (rejected > checked + 1e-6) {
      setError("Rejected qty cannot exceed checked qty.");
      return;
    }
    if (checked > (selectedAdj.qcPendingQty ?? 0) + 1e-6) {
      setError(`Checked qty cannot exceed pending qty (${fmtQcQty(selectedAdj.qcPendingQty)}).`);
      return;
    }
    setAdjSaving(true);
    try {
      await apiFetch("/api/production/qc-stock-adjustments", {
        method: "POST",
        body: JSON.stringify({
          stockTransactionId: selectedAdj.stockTransactionId,
          salesOrderId: soId,
          checkedQty: checked,
          rejectedQty: rejected,
          reason: adjReason.trim() || undefined,
        }),
      });
      setAdjCheckedQty("");
      setAdjRejectedQty("");
      setAdjReason("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save QC");
    } finally {
      setAdjSaving(false);
    }
  }

  const selectedReworkQc = React.useMemo(
    () => reworkQcRows.find((r) => r.itemId === reworkQcItemId) ?? null,
    [reworkQcRows, reworkQcItemId],
  );

  const reworkQcCanSave = React.useMemo(() => {
    if (!selectedReworkQc || selectedReworkQc.qcPendingQty <= 1e-6) return false;
    const chk = Number(reworkCheckedQty);
    const rej = Number(reworkRejectedQty);
    if (!Number.isFinite(chk) || chk <= 0) return false;
    if (chk > selectedReworkQc.qcPendingQty + 1e-6) return false;
    if (!Number.isFinite(rej) || rej < 0 || rej > chk + 1e-6) return false;
    if (rej > 1e-6 && reworkRejectedBucket == null) return false;
    return true;
  }, [selectedReworkQc, reworkCheckedQty, reworkRejectedQty, reworkRejectedBucket]);

  React.useEffect(() => {
    if (reworkQcItemId > 0 && !reworkQcRows.some((r) => r.itemId === reworkQcItemId)) {
      setReworkQcItemId(0);
    }
  }, [reworkQcRows, reworkQcItemId]);

  React.useEffect(() => {
    const rej = Number(reworkRejectedQty);
    if (!Number.isFinite(rej) || rej <= 1e-6) setReworkRejectedBucket(null);
  }, [reworkRejectedQty]);

  React.useEffect(() => {
    const rej = Number(recheckRejectedQty);
    if (!Number.isFinite(rej) || rej <= 1e-6) setRecheckRejectedBucket(null);
  }, [recheckRejectedQty]);

  const role = auth.user?.role ?? "";
  const isAdminUser = role === "ADMIN";
  const canSupervisorDecide = role === "ADMIN" || role === "SUPERVISOR";
  const canQcRecheck = role === "ADMIN" || role === "QC";
  const canHoldAct = role === "ADMIN" || role === "QC" || role === "SUPERVISOR";
  /** Matches backend LEGACY_CLASSIFY_ROLES for POST classify. */
  const canLegacyClassify = role === "ADMIN" || role === "QC" || role === "SUPERVISOR";

  const selectedRecheckDisp = React.useMemo(
    () => dispQueues?.readyForQcRecheck.find((r) => r.id === recheckDispId) ?? null,
    [dispQueues, recheckDispId],
  );

  React.useEffect(() => {
    const list = dispQueues?.readyForQcRecheck ?? [];
    if (list.length && !list.some((r) => r.id === recheckDispId)) {
      setRecheckDispId(list[0].id);
    }
    if (!list.length) setRecheckDispId(0);
  }, [dispQueues, recheckDispId]);

  async function submitSupervisorDecision(
    id: number,
    decision: "APPROVE" | "DENY",
    denyTo?: "HOLD" | "SCRAP",
    remarks?: string,
  ) {
    setError(null);
    setSupervisorSavingId(id);
    try {
      await apiFetch(`/api/production/qc-rejected-dispositions/${id}/supervisor-decision`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          ...(decision === "DENY" && denyTo ? { denyTo } : {}),
          ...(remarks?.trim() ? { remarks: remarks.trim() } : {}),
        }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Supervisor action failed.");
    } finally {
      setSupervisorSavingId(null);
    }
  }

  async function markReworkExecuted(dispositionId: number) {
    setError(null);
    try {
      const remarks = window.prompt("Rework execution note (optional)", "") ?? "";
      await apiFetch(`/api/production/qc-rejected-dispositions/${dispositionId}/mark-rework-executed`, {
        method: "POST",
        body: JSON.stringify({ ...(remarks.trim() ? { remarks: remarks.trim() } : {}) }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark rework executed.");
    }
  }

  async function submitHoldDispositionAction(
    id: number,
    action: "TO_USABLE" | "TO_REWORK" | "SCRAP",
    qty: number,
    remarks?: string,
  ) {
    setError(null);
    setHoldActionSavingId(id);
    try {
      await apiFetch(`/api/production/qc-rejected-dispositions/${id}/hold-action`, {
        method: "POST",
        body: JSON.stringify({
          action,
          qty,
          ...(remarks?.trim() ? { remarks: remarks.trim() } : {}),
        }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hold action failed.");
    } finally {
      setHoldActionSavingId(null);
    }
  }

  async function submitDispositionRecheck() {
    if (recheckSaving) return;
    if (!selectedRecheckDisp) return;
    setError(null);
    const remaining = Number(selectedRecheckDisp.remainingQty);
    const checked = remaining;
    const rejected = Number(recheckRejectedQty);
    if (!Number.isFinite(remaining) || remaining <= 0) {
      setError("Nothing is remaining for this rework line.");
      return;
    }
    if (!Number.isFinite(rejected) || rejected < 0) {
      setError("Rejected qty must be 0 or more.");
      return;
    }
    if (rejected > remaining + 1e-6) {
      setError(`Rejected qty cannot exceed remaining qty (${fmtQcQty(remaining)}).`);
      return;
    }
    setRecheckSaving(true);
    try {
      await apiFetch(`/api/production/qc-rejected-dispositions/${selectedRecheckDisp.id}/recheck`, {
        method: "POST",
        body: JSON.stringify({
          rejectedQty: rejected,
          reason: recheckReason.trim() || undefined,
        }),
      });
      setRecheckCheckedQty("");
      setRecheckRejectedQty("");
      setRecheckRejectedBucket(null);
      setRecheckReason("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "QC recheck failed.");
    } finally {
      setRecheckSaving(false);
    }
  }

  const closeLegacyClassifyModal = React.useCallback(() => {
    setLegacyClassifyOpen(null);
    setLegacyClassifyAction(null);
    setLegacyClassifyQtyDraft("");
    setLegacyClassifyRemarks("");
    setLegacyClassifyModalError(null);
  }, []);

  const openLegacyClassify = React.useCallback(
    (row: LegacyEligibleRow) => {
      if (!canLegacyClassify) {
        toast.showError("You do not have permission to classify legacy rejects.");
        return;
      }
      setLegacyClassifyOpen(row);
      setLegacyClassifyAction(null);
      setLegacyClassifyQtyDraft(fmtQcQty(row.rejectedQty));
      setLegacyClassifyRemarks("");
      setLegacyClassifyModalError(null);
    },
    [canLegacyClassify, toast],
  );

  React.useEffect(() => {
    if (!legacyClassifyOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeLegacyClassifyModal();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [legacyClassifyOpen, closeLegacyClassifyModal]);

  async function submitLegacyClassify() {
    if (!legacyClassifyOpen) return;
    setLegacyClassifyModalError(null);
    if (legacyClassifyAction == null) {
      setLegacyClassifyModalError("Select a classification action.");
      return;
    }
    const remarksTrim = legacyClassifyRemarks.trim();
    if (!remarksTrim) {
      setLegacyClassifyModalError("Reason / remarks are required.");
      return;
    }
    const maxQty = Number(legacyClassifyOpen.rejectedQty);
    const raw = legacyClassifyQtyDraft.trim().replace(/,/g, "");
    const qty = Number(raw);
    const EPS = 1e-6;
    if (!Number.isFinite(qty) || qty <= EPS) {
      setLegacyClassifyModalError("Qty to classify must be greater than zero.");
      return;
    }
    if (qty > maxQty + EPS) {
      setLegacyClassifyModalError(`Qty cannot exceed rejected qty (${fmtQcQty(maxQty)}).`);
      return;
    }
    if (qty < maxQty - EPS) {
      setLegacyClassifyModalError(
        `The API classifies the full rejected qty on this QC entry (${fmtQcQty(maxQty)}). Enter that amount or adjust before saving.`,
      );
      return;
    }
    setError(null);
    setLegacyClassifySaving(true);
    try {
      await apiFetch(`/api/production/qc-legacy-classifications/${legacyClassifyOpen.qcEntryId}/classify`, {
        method: "POST",
        body: JSON.stringify({
          action: legacyClassifyAction,
          remarks: remarksTrim,
        }),
      });
      toast.showSuccess("Classification saved.");
      closeLegacyClassifyModal();
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Legacy classification failed.";
      setLegacyClassifyModalError(msg);
      setError(msg);
    } finally {
      setLegacyClassifySaving(false);
    }
  }

  async function submitReworkQc() {
    const sel = selectedReworkQc;
    if (!sel) return;
    setError(null);
    const checked = Number(reworkCheckedQty);
    const rejected = Number(reworkRejectedQty);
    if (!Number.isFinite(checked) || checked <= 0) {
      setError("Checked qty is required.");
      return;
    }
    if (!Number.isFinite(rejected) || rejected < 0) {
      setError("Rejected qty must be 0 or more.");
      return;
    }
    if (rejected > checked + 1e-6) {
      setError("Rejected qty cannot exceed checked qty.");
      return;
    }
    if (checked > sel.qcPendingQty + 1e-6) {
      setError(`Checked qty cannot exceed awaiting-QC qty (${fmtQcQty(sel.qcPendingQty)}).`);
      return;
    }
    if (rejected > 1e-6 && reworkRejectedBucket == null) {
      setError("Select a rejected stock action.");
      return;
    }
    setReworkSaving(true);
    try {
      await apiFetch("/api/stock/complete-rework-qc", {
        method: "POST",
        body: JSON.stringify({
          itemId: sel.itemId,
          checkedQty: checked,
          rejectedQty: rejected,
          ...(rejected > 1e-6 && reworkRejectedBucket ? { rejectedStockBucket: reworkRejectedBucket } : {}),
          reason: reworkReason.trim() || undefined,
        }),
      });
      setReworkCheckedQty("");
      setReworkRejectedQty("");
      setReworkRejectedBucket(null);
      setReworkReason("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save rework QC.");
    } finally {
      setReworkSaving(false);
    }
  }

  async function approveCustomerReturn(id: number) {
    setError(null);
    setCustReturnApprovingId(id);
    try {
      await apiFetch(`/api/customer-returns/${id}/approve`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve customer return.");
    } finally {
      setCustReturnApprovingId(null);
    }
  }

  async function scrapCustomerReturn(id: number) {
    setError(null);
    setCustReturnScrappingId(id);
    try {
      await apiFetch(`/api/customer-returns/${id}/scrap`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not scrap customer return.");
    } finally {
      setCustReturnScrappingId(null);
    }
  }

  async function customerReturnApproveRework(id: number) {
    setError(null);
    setCustReturnApproveReworkId(id);
    try {
      await apiFetch(`/api/customer-returns/${id}/approve-rework`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve rework to stock.");
    } finally {
      setCustReturnApproveReworkId(null);
    }
  }

  useDrillFocus({
    attribute: DRILL_DATA.productionId,
    id: drillProductionId,
    ready: listReady,
    enabled: drillProductionId > 0,
    retryDeps: [rows.length, productionId],
  });

  React.useEffect(() => {
    const sel = rows.find((r) => r.id === productionId);
    if (!sel) {
      resetCheckedQty();
      setRejectedQty("");
      setRejectedStockBucket(null);
      return;
    }
    setRejectedQty("");
    setRejectedStockBucket(null);
    const roll = safeQcRollupsForRow(sel);
    if (roll.pending > 1e-6) setCheckedQtyStr(fmtQcQty(roll.pending));
    else resetCheckedQty();
  }, [productionId, rows, resetCheckedQty, setCheckedQtyStr]);

  const selected = rows.find((r) => r.id === productionId);
  const selectedRollups = selected ? safeQcRollupsForRow(selected) : null;

  const rejectedNumForForm = React.useMemo(() => {
    if (rejectedQty === "") return 0;
    if (!isValidNumberDraft(rejectedQty)) return null;
    return rejectedQty < 0 ? null : rejectedQty;
  }, [rejectedQty]);

  React.useEffect(() => {
    if (rejectedNumForForm === null || rejectedNumForForm <= 1e-6) {
      setRejectedStockBucket(null);
    }
  }, [rejectedNumForForm]);

  const draftAcceptedQty =
    checkedQtyValid && checkedParsed != null && rejectedNumForForm !== null ? checkedParsed - rejectedNumForForm : null;

  /** Draft "inspected" qty for validation messages (inspected == checkedParsed). */
  const draftCheckedTotal = checkedQtyValid && checkedParsed != null ? checkedParsed : null;

  const qcInlineValidationMsg = React.useMemo(() => {
    if (!productionId || !selectedRollups) return null;
    const awaitingQcBefore = selectedRollups.pending;
    if (awaitingQcBefore <= 1e-6) return "This batch has no awaiting QC qty.";
    if (!checkedQtyValid || checkedParsed == null) return "Enter Inspecting now qty.";
    const inspectingNow = checkedParsed;
    if (!(inspectingNow > 0)) return "Inspecting now must be greater than 0.";
    if (inspectingNow > awaitingQcBefore + 1e-6) return `Inspecting now cannot exceed awaiting QC (${fmtQcQty(awaitingQcBefore)}).`;
    if (rejectedNumForForm === null) return "Rejected qty must be a valid number.";
    const rejectedNow = rejectedNumForForm;
    if (rejectedNow < -1e-6) return "Rejected qty cannot be negative.";
    if (rejectedNow > inspectingNow + 1e-6) return "Rejected qty cannot exceed Inspecting now.";
    const acceptedNow = inspectingNow - rejectedNow;
    if (acceptedNow < -1e-6) return "Accepted qty cannot be negative.";
    // Derived invariant (defensive): accepted+rejected must equal inspectingNow.
    if (Math.abs((acceptedNow + rejectedNow) - inspectingNow) > 1e-6) return "Accepted + Rejected must equal Inspecting now.";
    if (rejectedNow > 1e-6) {
      const rw = Number(rejSplitRework);
      const hd = Number(rejSplitHold);
      const sc = Number(rejSplitScrap);
      const valid = (n: number) => Number.isFinite(n) && n >= -1e-9;
      if ((!valid(rw) && String(rejSplitRework).trim() !== "") || (!valid(hd) && String(rejSplitHold).trim() !== "") || (!valid(sc) && String(rejSplitScrap).trim() !== "")) {
        return "Split quantities must be valid numbers (0 or more).";
      }
      const total = (Number.isFinite(rw) ? Math.max(0, rw) : 0) + (Number.isFinite(hd) ? Math.max(0, hd) : 0) + (Number.isFinite(sc) ? Math.max(0, sc) : 0);
      if (total <= 1e-6) return "Enter how rejected qty is split (Rework / Hold / Scrap).";
      if (Math.abs(total - rejectedNow) > 1e-6) return "Rework + Hold + Scrap must equal rejected qty.";
    }
    return null;
  }, [
    productionId,
    selectedRollups,
    checkedQtyValid,
    checkedParsed,
    rejectedNumForForm,
    rejSplitRework,
    rejSplitHold,
    rejSplitScrap,
  ]);

  const qcFormCanSubmit = Boolean(
    productionId > 0 &&
      selectedRollups &&
      selectedRollups.pending > 1e-6 &&
      checkedQtyValid &&
      checkedParsed != null &&
      rejectedNumForForm !== null &&
      draftAcceptedQty != null &&
      rejectedNumForForm <= checkedParsed + 1e-6 &&
      draftAcceptedQty >= -1e-6 &&
      checkedParsed <= selectedRollups.pending + 1e-6 &&
      (rejectedNumForForm <= 1e-6 || qcInlineValidationMsg == null),
  );

  function openReverseQcModal(args: {
    qcEntryId: number;
    acceptedQty: number;
    rejectedQty: number;
    allowedReverseQty: number;
  }) {
    if (!isAdminUser) return;
    setReverseQcModal(args);
    setReverseQcQtyDraft("");
    setReverseQcReasonDraft("");
    setReverseQcPasswordDraft("");
    setReverseQcModalError(null);
  }

  function closeReverseQcModal() {
    setReverseQcModal(null);
    setReverseQcQtyDraft("");
    setReverseQcReasonDraft("");
    setReverseQcPasswordDraft("");
    setReverseQcModalError(null);
  }

  async function confirmReverseQcModal() {
    if (!reverseQcModal || !isAdminUser) return;
    const pw = reverseQcPasswordDraft.trim();
    if (!pw) {
      setReverseQcModalError("Admin password is required.");
      return;
    }
    const reason = reverseQcReasonDraft.trim();
    if (!reason) {
      setReverseQcModalError("Reason is required.");
      return;
    }
    const EPS = 1e-6;
    const raw = reverseQcQtyDraft.trim().replace(/,/g, "");
    const rq = Number(raw);
    if (!Number.isFinite(rq) || rq <= EPS) {
      setReverseQcModalError("Reverse qty must be greater than zero.");
      return;
    }
    const allowed = reverseQcModal.allowedReverseQty;
    if (rq > allowed + EPS) {
      setReverseQcModalError(`Reverse qty cannot exceed allowed qty (${fmtQcQty(allowed)}).`);
      return;
    }
    if (rq < allowed - EPS) {
      setReverseQcModalError(`Full reversal only: enter the full checked quantity (${fmtQcQty(allowed)}).`);
      return;
    }
    setReverseQcModalError(null);
    setError(null);
    const qcEntryId = reverseQcModal.qcEntryId;
    setReversingId(qcEntryId);
    try {
      await apiFetch("/api/production/qc-reverse", {
        method: "POST",
        body: JSON.stringify({ qcEntryId, reason }),
      });
      closeReverseQcModal();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reverse failed");
    } finally {
      setReversingId(null);
    }
  }

  async function onSubmit() {
    setError(null);
    if (!selected || !selectedRollups) return;
    const pending = selectedRollups.pending;
    if (!checkedQtyValid || checkedParsed == null) {
      setError("Enter inspected quantity");
      return;
    }
    let rejectedNum = 0;
    if (rejectedQty !== "") {
      if (!isValidNumberDraft(rejectedQty)) {
        setError("Rejected quantity must be a valid number.");
        return;
      }
      if (rejectedQty < 0) {
        setError("Rejected quantity cannot be negative.");
        return;
      }
      rejectedNum = rejectedQty;
    }
    const checkedQty = checkedParsed;
    const acceptedQty = checkedQty - rejectedNum;
    if (checkedQty <= 1e-9) {
      setError("Enter inspected quantity");
      return;
    }
    if (rejectedNum > checkedQty + 1e-6) {
      setError("Rejected quantity cannot exceed inspected quantity.");
      return;
    }
    if (checkedQty > pending + 1e-6) {
      setError("Total exceeds pending QC quantity");
      return;
    }
    if (acceptedQty < -1e-6) {
      setError("Accepted quantity cannot be negative.");
      return;
    }
    if (rejectedNum > 1e-6) {
      const rw = rejSplitRework === "" ? 0 : Number(rejSplitRework);
      const hd = rejSplitHold === "" ? 0 : Number(rejSplitHold);
      const sc = rejSplitScrap === "" ? 0 : Number(rejSplitScrap);
      const valid = (n: number) => Number.isFinite(n) && n >= -1e-9;
      if (!valid(rw) || !valid(hd) || !valid(sc)) {
        setError("Split quantities must be valid numbers (0 or more).");
        return;
      }
      const total = Math.max(0, rw) + Math.max(0, hd) + Math.max(0, sc);
      if (total <= 1e-6) {
        setError("Enter how rejected qty is split (Rework / Hold / Scrap).");
        return;
      }
      if (Math.abs(total - rejectedNum) > 1e-6) {
        setError("Rework + Hold + Scrap must equal rejected qty.");
        return;
      }
    }
    const prevProdId = productionId;
    setSaving(true);
    try {
      await apiFetch("/api/production/qc-entries", {
        method: "POST",
        body: JSON.stringify({
          productionId,
          checkedQty,
          rejectedQty: rejectedNum,
          ...(rejectedNum > 1e-6
            ? {
                rejectedSplit: {
                  reworkQty: Number(rejSplitRework || 0),
                  holdQty: Number(rejSplitHold || 0),
                  scrapQty: Number(rejSplitScrap || 0),
                },
              }
            : {}),
          reason: reason.trim() || undefined,
          scrapReusable,
        }),
      });
      setReason("");
      setRejectedStockBucket(null);
      setRejSplitRework("");
      setRejSplitHold("");
      setRejSplitScrap("");
      const list = await refresh();
      if (!fromNoQtySo && rejectedNum > 1e-6) {
        const rw = Number(rejSplitRework || 0);
        const hd = Number(rejSplitHold || 0);
        const sc = Number(rejSplitScrap || 0);
        const parts: string[] = [];
        if (rw > 1e-6) parts.push(`${fmtQcQty(rw)} sent to rework`);
        if (hd > 1e-6) parts.push(`${fmtQcQty(hd)} put on hold`);
        if (sc > 1e-6) parts.push(`${fmtQcQty(sc)} scrapped`);
        if (parts.length) toast.showSuccess(`QC saved: ${parts.join(", ")}.`);
      }
      if (fromNoQtySo && focusSoIdValid) {
        toast.showSuccess("QC saved. Continue to Dispatch.");
        const cycleId = noQtyFlowState?.cycleId ?? null;
        const itemId = Number((selected as any)?.workOrderLine?.fgItemId ?? 0);
        const base = buildNoQtyGuidedHref({
          to: "/dispatch",
          salesOrderId: focusSoId,
          cycleId,
          fromStep: "qc",
        });
        const withItem = itemId > 0 ? `${base}&itemId=${encodeURIComponent(String(itemId))}` : base;
        navigate(withItem);
        return;
      }
      const sorted = [...list].sort((a, b) => safeQcRollupsForRow(b).pending - safeQcRollupsForRow(a).pending);
      if (sorted.length === 0) {
        setProductionId(0);
        patch({ [DRILL_QUERY.productionId]: null });
      } else if (sorted.length === 1) {
        setProductionId(sorted[0].id);
        patch({ [DRILL_QUERY.productionId]: String(sorted[0].id) });
      } else {
        const i = sorted.findIndex((r) => r.id === prevProdId);
        let next = sorted[0];
        if (i >= 0 && i < sorted.length - 1) next = sorted[i + 1];
        else if (i === sorted.length - 1) next = sorted[0];
        setProductionId(next.id);
        patch({ [DRILL_QUERY.productionId]: String(next.id) });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  const qcDrillBannerActive = focusWorkOrderId > 0 || productionIdFromUrl > 0;

  const clearQcDrillFocus = React.useCallback(() => {
    setSearchParams(
      (prev) => deleteUrlParamKeys(prev, [DRILL_QUERY.workOrderId, DRILL_QUERY.productionId]),
      { replace: true },
    );
  }, [setSearchParams]);

  const qcBannerTitle =
    focusWorkOrderId > 0
      ? drillFocusTitleWorkOrder(focusWorkOrderId)
      : drillFocusTitleQcProduction(productionIdFromUrl);

  const prodInQueue =
    productionIdFromUrl > 0 && listReady && rows.length > 0 && rows.some((r) => r.id === productionIdFromUrl);
  const woHasBatch =
    focusWorkOrderId > 0 && listReady && rows.length > 0 && rows.some((r) => safeWorkOrderIdForRow(r) === focusWorkOrderId);

  const qcBannerHint =
    listReady && rows.length === 0 && qcDrillBannerActive
      ? DRILL_FOCUS_HINT_QC.emptyQueue
      : listReady && focusWorkOrderId > 0 && rows.length > 0 && !woHasBatch
        ? DRILL_FOCUS_HINT_QC.woNoBatch
        : listReady && focusWorkOrderId === 0 && productionIdFromUrl > 0 && rows.length > 0 && !prodInQueue
          ? DRILL_FOCUS_HINT_QC.productionMissing
          : undefined;

  const qcBannerSoft =
    listReady &&
    ((rows.length === 0 && qcDrillBannerActive) ||
      (focusWorkOrderId > 0 && rows.length > 0 && !woHasBatch) ||
      (focusWorkOrderId === 0 && productionIdFromUrl > 0 && rows.length > 0 && !prodInQueue));

  const productionBatchesAll = React.useMemo(() => {
    try {
      const byId = new Map<number, ProdRow>();
      for (const r of Array.isArray(rows) ? rows : []) {
        const id = Number((r as any)?.id ?? 0);
        if (Number.isFinite(id) && id > 0) byId.set(id, r);
      }
      for (const r of Array.isArray(withQcRows) ? withQcRows : []) {
        const id = Number((r as any)?.id ?? 0);
        if (!Number.isFinite(id) || id <= 0) continue;
        if (!byId.has(id)) byId.set(id, r);
      }
      return Array.from(byId.values());
    } catch {
      return [];
    }
  }, [rows, withQcRows]);

  const productionBatchesFiltered = React.useMemo(() => {
    const list = Array.isArray(productionBatchesAll) ? productionBatchesAll : [];
    const eps = 1e-6;
    if (prodShowFilter === "ALL") return list;
    if (prodShowFilter === "COMPLETED") {
      return list.filter((r) => safeQcRollupsForRow(r).pending <= eps);
    }
    // AWAITING
    // Strict rule: show rows when produced > 0 and (accepted + rejected) < produced.
    return list.filter((r) => {
      const q = safeQcRollupsForRow(r);
      if (!(q.produced > eps)) return false;
      return q.pending > eps;
    });
  }, [productionBatchesAll, prodShowFilter]);

  const productionBatchesForDropdown = React.useMemo(() => {
    // Keep dropdown stable + readable: show filtered list, sorted by "Awaiting QC" high→low, then id desc.
    try {
      const list = [...(Array.isArray(productionBatchesFiltered) ? productionBatchesFiltered : [])];
      list.sort((a, b) => {
        const qa = safeQcRollupsForRow(a);
        const qb = safeQcRollupsForRow(b);
        const da = qa.pending > 1e-6 ? 0 : 1;
        const db = qb.pending > 1e-6 ? 0 : 1;
        if (da !== db) return da - db;
        if (Math.abs(qb.pending - qa.pending) > 1e-9) return qb.pending - qa.pending;
        return Number((b as any)?.id ?? 0) - Number((a as any)?.id ?? 0);
      });
      return list;
    } catch {
      return [];
    }
  }, [productionBatchesFiltered]);

  const qcQueueRows = React.useMemo(() => {
    // Queue panel focuses on batches that still have something to inspect (pending > 0).
    const eps = 1e-6;
    try {
      return (Array.isArray(productionBatchesAll) ? productionBatchesAll : [])
        .map((r) => {
          const q = safeQcRollupsForRow(r);
          return { r, q, status: qcStatusForRollups(q) };
        })
        .filter(({ q }) => q.pending > eps)
        .sort((a, b) => b.q.pending - a.q.pending);
    } catch {
      return [];
    }
  }, [productionBatchesAll]);

  const noQtyCycleId = fromNoQtySo && focusSoIdValid ? (noQtyFlowState?.cycleId ?? null) : null;
  const dispQueuesScoped = React.useMemo(() => {
    const empty = {
      reworkPendingSupervisor: [] as QcDispQueueRow[],
      reworkApprovedPendingExecution: [] as QcDispQueueRow[],
      readyForQcRecheck: [] as QcDispQueueRow[],
      holdStock: [] as QcDispQueueRow[],
      scrapRegister: [] as QcDispQueueRow[],
    };
    if (!fromNoQtySo || !focusSoIdValid) return empty;
    // If we cannot identify the active cycle, do NOT allow rework queues to influence NO_QTY guidance.
    // This prevents old-cycle leakage when flow-state is temporarily unavailable.
    if (noQtyCycleId == null) return empty;
    const q = dispQueues ?? empty;
    const inScope = (r: QcDispQueueRow) => {
      if (!r?.workOrder) return false;
      if (Number(r.workOrder.salesOrderId) !== Number(focusSoId)) return false;
      if (Number(r.workOrder.cycleId ?? 0) !== Number(noQtyCycleId)) return false;
      return true;
    };
    return {
      reworkPendingSupervisor: (Array.isArray(q.reworkPendingSupervisor) ? q.reworkPendingSupervisor : []).filter(inScope),
      reworkApprovedPendingExecution: (Array.isArray((q as any).reworkApprovedPendingExecution) ? (q as any).reworkApprovedPendingExecution : []).filter(inScope),
      readyForQcRecheck: (Array.isArray(q.readyForQcRecheck) ? q.readyForQcRecheck : []).filter(inScope),
      holdStock: (Array.isArray(q.holdStock) ? q.holdStock : []).filter(inScope),
      scrapRegister: (Array.isArray(q.scrapRegister) ? q.scrapRegister : []).filter(inScope),
    };
  }, [dispQueues, fromNoQtySo, focusSoId, focusSoIdValid, noQtyCycleId]);

  type QcGuidance =
    | { kind: "CONTINUE_QC"; nextStepLabel: string }
    | { kind: "REWORK_SUPERVISOR"; nextStepLabel: string }
    | { kind: "REWORK_FINAL_QC"; nextStepLabel: string }
    | { kind: "DISPATCH"; nextStepLabel: string; href: string; buttonLabel: string }
    | { kind: "PRODUCTION"; nextStepLabel: string; href: string; buttonLabel: string }
    | { kind: "NONE"; nextStepLabel: string };

  const qcGuidance: QcGuidance = React.useMemo(() => {
    if (!fromNoQtySo || !focusSoIdValid) return { kind: "NONE", nextStepLabel: "—" };
    if (focusSo?.cycleStatus === "Closed Cycle") return { kind: "NONE", nextStepLabel: "Cycle Closed" };

    // Priority (cycle-scoped):
    // 1) Pending direct QC batches
    // 2) Pending supervisor approval for rework
    // 3) Approved rework ready for QC recheck
    // 4) Move forward to Dispatch if QC is complete for this cycle
    // 5) Only then: Production (true previous step)
    if (qcQueueRows.length > 0) return { kind: "CONTINUE_QC", nextStepLabel: "Continue QC" };
    if (dispQueuesScoped.reworkPendingSupervisor.length > 0) {
      return { kind: "REWORK_SUPERVISOR", nextStepLabel: "Rework awaiting supervisor approval" };
    }
    if (dispQueuesScoped.readyForQcRecheck.length > 0) {
      return { kind: "REWORK_FINAL_QC", nextStepLabel: "Rework Final QC" };
    }
    if (noQtyFlowState?.nextAction === "DISPATCH" || noQtyFlowState?.activeStep === 5) {
      return {
        kind: "DISPATCH",
        nextStepLabel: "Dispatch",
        href: buildNoQtyGuidedHref({
          to: "/dispatch",
          salesOrderId: focusSoId,
          cycleId: noQtyFlowState?.cycleId ?? null,
          fromStep: "qc",
        }),
        buttonLabel: "Go to Dispatch",
      };
    }
    if (noQtyFlowState?.nextAction === "PRODUCTION" || noQtyFlowState?.activeStep === 3) {
      return {
        kind: "PRODUCTION",
        nextStepLabel: "Production",
        href: buildNoQtyGuidedHref({
          to: "/production",
          salesOrderId: focusSoId,
          cycleId: noQtyFlowState?.cycleId ?? null,
          fromStep: "work_order",
        }),
        buttonLabel: "Go to Production",
      };
    }
    return { kind: "NONE", nextStepLabel: "—" };
  }, [
    dispQueuesScoped.readyForQcRecheck.length,
    dispQueuesScoped.reworkPendingSupervisor.length,
    focusSo?.cycleStatus,
    focusSoId,
    focusSoIdValid,
    fromNoQtySo,
    noQtyFlowState?.activeStep,
    noQtyFlowState?.cycleId,
    noQtyFlowState?.nextAction,
    qcQueueRows.length,
  ]);

  const fatalFallback = (message: string, err?: unknown) => {
    // eslint-disable-next-line no-console
    console.log("QC PAGE FATAL FALLBACK", { message, err });
    return (
      <PageContainer className="erp-flow-page -mt-2 space-y-2.5 pb-6">
        <OperatorPageBody className="gap-2.5">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-3">
              <div className="font-semibold text-slate-900">QC page could not be loaded</div>
              <div className="mt-1 text-[12px] text-slate-600">{message}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/sales-orders?soType=NO_QTY" className="inline-flex">
                  <Button type="button" variant="outline" size="sm">
                    Back to Sales Orders
                  </Button>
                </Link>
                <Button type="button" size="sm" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        </OperatorPageBody>
      </PageContainer>
    );
  };

  try {
    return (
      <PageContainer className="erp-flow-page -mt-2 space-y-2.5 pb-6">
        <div className="mb-2">
          <DemoFlowBanner />
        </div>
        {fromNoQtySo && focusSoIdValid ? (
          <div className="grid items-start gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
            <NoQtyFlowStepsCard currentStage="QC" cycleStatus={focusSo?.cycleStatus ?? "Active Cycle"} />
            <NoQtyCycleSummaryCard
              soId={focusSoId}
              soDocNo={focusSo?.docNo ?? null}
              customerName={focusSo?.customerName ?? "—"}
              cycleNo={focusSo?.cycleNo ?? null}
              cycleStatus={focusSo?.cycleStatus ?? "Active Cycle"}
              currentStage="QC"
              nextStep={qcGuidance.nextStepLabel}
              metrics={[]}
              showSteps={false}
            />
          </div>
        ) : null}
        <StickyWorkspaceHead lead={fromNoQtySo ? <PageNoQtyFlowBackLink step="QC" /> : <PageBackLink to="/production" label="Back to Production" />}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <h1 className="text-base font-semibold leading-tight tracking-tight text-slate-900">QC</h1>
              <p className="text-xs leading-snug text-slate-600">
                Inspect production output, classify rejects, and manage return QC.
              </p>
            </div>
            <Link to="/qc-report" className="shrink-0">
              <Button type="button" variant="outline" size="sm" className="h-8">
                Open QC Report
              </Button>
            </Link>
          </div>
        </StickyWorkspaceHead>
        <DrillFocusBanner
          active={qcDrillBannerActive}
          title={qcBannerTitle}
          variant={qcBannerSoft ? "soft" : "default"}
          hint={qcBannerHint}
          onClearFocus={clearQcDrillFocus}
        />
        <OperatorPageBody className="gap-2.5">
      <Card
        className="min-w-0 overflow-hidden border-slate-200 shadow-sm"
        {...(productionId > 0 ? { [DRILL_DATA.productionId]: productionId } : {})}
      >
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-3 py-2">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Pending Production QC</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-3 py-2">
          {fromNoQtySo && noQtyFlowError ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <div className="font-semibold">Could not load NO_QTY flow state</div>
              <div className="mt-0.5 text-xs text-amber-900">{noQtyFlowError}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link to="/sales-orders?soType=NO_QTY" className="inline-flex">
                  <Button type="button" size="sm" variant="outline">
                    Back to Sales Orders
                  </Button>
                </Link>
                <Button type="button" size="sm" onClick={() => void refresh()} disabled={!listReady}>
                  Retry QC queue
                </Button>
              </div>
            </div>
          ) : null}
          {fromNoQtySo && focusSoIdValid && listReady && productionBatchesFiltered.length === 0 ? (
            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950">
              <div className="font-semibold">QC Completed</div>
              <div className="mt-0.5 text-xs text-emerald-900">All items are inspected and moved to usable stock.</div>
              <div className="mt-3">
                <Link
                  to={`/dispatch?source=no_qty_so&salesOrderId=${focusSoId}&cycleId=${noQtyFlowState?.cycleId ?? ""}`}
                  className="inline-flex"
                >
                  <Button type="button" size="sm">
                    Go to Dispatch
                  </Button>
                </Link>
              </div>
            </div>
          ) : null}
          {error ? <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[13px] text-red-800">{error}</div> : null}
          <DemoSafeNoQtyContinue
            visible={showDemoNoQtyQcContinue}
            body="Demo mode: QC saves are blocked in Safe Demo. Continue without recording inspection data."
            actionLabel="Continue Demo → Dispatch"
          />
          {!listReady ? (
            <p className="mt-2 text-[13px] text-slate-600">Loading production entries…</p>
          ) : productionBatchesFiltered.length === 0 ? (
            fromNoQtySo && focusSoIdValid ? null : (
              <p className="text-[12px] leading-snug text-slate-600">
                No production batches awaiting QC.
                {qcDrillBannerActive ? " See the banner above if you arrived via a drill-down link." : ""}
              </p>
            )
          ) : (
            <div ref={qcFormRef} className="mt-1 flex flex-col gap-2">
              <OperatorTopBar className="gap-2 rounded border border-slate-200 bg-white p-1.5 shadow-sm">
                <label className="erp-form-field w-fit shrink-0">
                  <span className="text-[12px] font-medium text-slate-600">Show</span>
                  <select
                    className={cn("erp-select mt-0.5 w-[12.5rem] min-w-0 text-[13px]", operatorInputClass)}
                    value={prodShowFilter}
                    onChange={(e) => setProdShowFilter(e.target.value as typeof prodShowFilter)}
                  >
                    <option value="ALL">All</option>
                    <option value="AWAITING">Awaiting QC</option>
                    <option value="COMPLETED">Completed QC</option>
                  </select>
                </label>
                <div className="erp-form-field min-w-[12rem] max-w-[22rem] shrink-0">
                  <span className="text-[12px] font-medium text-slate-600">Batch</span>
                  <select
                    ref={productionSelectRef}
                    className={cn("erp-select mt-0.5 w-full min-w-0 text-[13px]", operatorInputClass)}
                    value={productionId === 0 ? "" : String(productionId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      const id = v === "" ? 0 : Number(v);
                      setProductionId(id);
                      patch({ [DRILL_QUERY.productionId]: id > 0 ? String(id) : null });
                    }}
                  >
                    <option value="">Select batch…</option>
                    {productionBatchesForDropdown.map((r) => {
                      const q = safeQcRollupsForRow(r);
                      const status = qcStatusForRollups(q);
                      return (
                        <option key={r.id} value={r.id}>
                          #{safeProductionRowId(r)} · {safeItemNameForRow(r) || "—"} · {qcStatusLabel(status)} · awaiting {fmtQcQty(q.pending)}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="erp-form-field min-w-[9rem] shrink-0">
                  <span className="text-[12px] font-medium text-slate-600">Item</span>
                  <Input
                    readOnly
                    className={cn("mt-0.5 cursor-default bg-slate-50 text-[13px]", operatorInputClass)}
                    value={selected ? safeItemNameForRow(selected) : ""}
                    placeholder="—"
                    aria-label="Item"
                  />
                </div>
                <div className="erp-form-field w-fit shrink-0">
                  <span className="text-[12px] font-medium text-slate-600">Batch date</span>
                  <Input
                    type="date"
                    readOnly
                    className={cn("mt-0.5 w-[11rem] cursor-default bg-slate-50 tabular-nums text-[13px]", operatorInputClass)}
                    value={selected ? toYmdFromIso(safeIsoDate(selected)) : ""}
                    aria-label="Production batch date"
                  />
                </div>
                {selectedRollups ? (
                  <div className="flex flex-wrap items-stretch gap-1">
                    <OperatorMetricBadge label="Produced qty" value={fmtQcQty(selectedRollups.produced)} />
                    <OperatorMetricBadge label="Accepted qty" value={fmtQcQty(selectedRollups.accepted)} />
                    <OperatorMetricBadge label="Rejected qty" value={fmtQcQty(selectedRollups.rejected)} />
                    <OperatorMetricBadge label="Awaiting QC" value={fmtQcQty(selectedRollups.pending)} />
                  </div>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  className={cn("ml-auto shrink-0 text-[13px]", operatorInputClass)}
                  onClick={onSubmit}
                  disabled={saving || !qcFormCanSubmit}
                  {...(qcDemoHl ? { "data-demo-highlight": qcDemoHl } : {})}
                >
                  {saving ? "Saving…" : "Save QC"}
                </Button>
              </OperatorTopBar>

              <OperatorMainSplit
                queue={
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-[12px] font-bold uppercase tracking-wide text-slate-600">
                        {fromNoQtySo && focusSoIdValid ? "Current cycle work" : "Production QC queue"}
                      </h3>
                      <span className="text-[11px] text-slate-500">
                        Awaiting QC high → low · ▶ selects batch
                        {fromNoQtySo && focusSoIdValid ? " · Only this SO/cycle is shown" : ""}
                      </span>
                    </div>
                    <div className="max-h-[min(38vh,280px)] overflow-auto rounded border border-slate-200 bg-white">
                      <table className="w-full text-[13px]">
                        <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                          <tr className="text-left text-[12px] text-slate-600">
                            <th className="px-2 py-1 font-medium">Batch</th>
                            <th className="px-2 py-1 font-medium">Item</th>
                            <th className="px-2 py-1 font-medium">QC status</th>
                            <th className="px-2 py-1 text-right font-medium">Produced qty</th>
                            <th className="px-2 py-1 text-right font-medium">Accepted qty</th>
                            <th className="px-2 py-1 text-right font-medium">Rejected qty</th>
                            <th className="px-2 py-1 text-right font-medium">Awaiting QC</th>
                            <th className="w-10 px-1 py-1 text-right font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {qcQueueRows.map(({ r, q, status }) => {
                            const sel = productionId === r.id;
                            const itemName = safeItemNameForRow(r) || "—";
                            return (
                              <tr
                                key={r.id}
                                className={cn(
                                  "border-t border-slate-100",
                                  operatorTableRowClass,
                                  !sel && "bg-amber-50/30",
                                  sel && "bg-emerald-50",
                                )}
                              >
                                <td className="px-2 py-1 font-medium tabular-nums">#{r.id}</td>
                                <td className="max-w-[11rem] truncate px-2 py-1" title={itemName}>
                                  {itemName}
                                </td>
                                <td className="px-2 py-1">
                                  <span
                                    className={cn(
                                      "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                                      status === "AWAITING_QC"
                                        ? "bg-amber-50 text-amber-800"
                                        : status === "PARTIAL_QC"
                                          ? "bg-sky-50 text-sky-800"
                                          : "bg-emerald-50 text-emerald-800",
                                    )}
                                  >
                                    {qcStatusLabel(status)}
                                  </span>
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmtQcQty(q.produced)}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-emerald-700">{fmtQcQty(q.accepted)}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-red-700">{fmtQcQty(q.rejected)}</td>
                                <td className="px-2 py-1 text-right font-semibold tabular-nums text-amber-800">{fmtQcQty(q.pending)}</td>
                                <td className="px-1 py-0.5 text-right">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 shrink-0 p-0 text-[13px]"
                                    onClick={() => {
                                      setProductionId(r.id);
                                      patch({ [DRILL_QUERY.productionId]: String(r.id) });
                                    }}
                                    aria-label={`Select batch ${r.id}`}
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
                    {fromNoQtySo && focusSoIdValid && olderCycleHistoryRows.length > 0 ? (
                      <details className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2">
                        <summary className="cursor-pointer text-[12px] font-medium text-slate-700">
                          Older history (other cycles) ({olderCycleHistoryRows.length})
                        </summary>
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full min-w-[720px] text-[12px]">
                            <thead>
                              <tr className="border-b border-slate-200 text-left text-[11px] font-medium text-slate-600">
                                <th className="py-1 pr-2">Batch</th>
                                <th className="py-1 pr-2">Cycle</th>
                                <th className="py-1 pr-2">Item</th>
                                <th className="py-1 pr-2 text-right">Produced qty</th>
                                <th className="py-1 pr-2 text-right">Accepted qty</th>
                                <th className="py-1 pr-2 text-right">Rejected qty</th>
                                <th className="py-1 text-right">Awaiting QC</th>
                              </tr>
                            </thead>
                            <tbody>
                              {olderCycleHistoryRows.slice(0, 40).map((r) => {
                                const q = safeQcRollupsForRow(r);
                                const cy = safeCycleIdForRow(r);
                                return (
                                  <tr key={r.id} className={cn("border-t border-slate-100", operatorTableRowClass)}>
                                    <td className="py-1 pr-2 tabular-nums">#{r.id}</td>
                                    <td className="py-1 pr-2 tabular-nums">{cy ?? "—"}</td>
                                    <td className="py-1 pr-2">{safeItemNameForRow(r) || "—"}</td>
                                    <td className="py-1 pr-2 text-right tabular-nums">{fmtQcQty(q.produced)}</td>
                                    <td className="py-1 pr-2 text-right tabular-nums text-emerald-700">{fmtQcQty(q.accepted)}</td>
                                    <td className="py-1 pr-2 text-right tabular-nums text-red-700">{fmtQcQty(q.rejected)}</td>
                                    <td className="py-1 text-right tabular-nums">{fmtQcQty(q.pending)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {olderCycleHistoryRows.length > 40 ? (
                          <div className="mt-2 text-[11px] text-slate-600">Showing 40 of {olderCycleHistoryRows.length}.</div>
                        ) : null}
                      </details>
                    ) : null}
                  </div>
                }
                panel={
                  <div className="space-y-2">
                    <div className="text-[12px] font-semibold text-slate-700">Inspecting now</div>
                    {selectedRollups ? (
                      <div className="text-[12px] text-slate-700">
                        Awaiting QC qty:{" "}
                        <span className="font-semibold tabular-nums text-amber-800">
                          {fmtQcQty(selectedRollups.pending)}
                        </span>
                      </div>
                    ) : null}
                    {selected && selectedRollups ? (
                      <div className="text-[11px] text-slate-600">
                        <span className="font-medium text-slate-800">{safeItemNameForRow(selected)}</span>
                        <span className="text-slate-400"> · </span>
                        Produced {fmtQcQty(selectedRollups.produced)}
                        <span className="text-slate-400"> · </span>
                        Awaiting {fmtQcQty(selectedRollups.pending)}
                      </div>
                    ) : null}
                    {productionId > 0 &&
                    draftCheckedTotal != null &&
                    selectedRollups &&
                    draftCheckedTotal > selectedRollups.pending + 1e-6 ? (
                      <p className="text-[11px] font-medium text-amber-800">Total exceeds remaining QC quantity</p>
                    ) : null}
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="erp-form-field w-full min-w-[6rem] max-w-[10rem]">
                        <span className="text-[12px] font-medium text-slate-600">Inspecting now</span>
                        <Input
                          ref={checkedQtyRef}
                          type="text"
                          data-testid="qc-inspecting-input"
                          inputMode="decimal"
                          autoComplete="off"
                          className={cn("mt-0.5 tabular-nums text-[13px]", operatorInputClass)}
                          placeholder="Required"
                          value={checkedQtyStr}
                          onChange={(e) => setCheckedQtyStr(e.target.value)}
                          disabled={!productionId}
                        />
                        {productionId > 0 && !checkedQtyValid ? (
                          <p className="mt-0.5 text-[11px] font-medium text-amber-800">Enter inspected quantity</p>
                        ) : null}
                      </div>
                      <div className="erp-form-field w-full min-w-[6rem] max-w-[10rem]">
                        <span className="text-[12px] font-medium text-slate-600">Rejected qty</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          className={cn("mt-0.5 tabular-nums text-[13px]", operatorInputClass)}
                          placeholder=""
                          value={rejectedQty}
                          onChange={(e) => setRejectedQty(toNumberDraft(e.target.value))}
                          disabled={!productionId}
                        />
                        {productionId > 0 && rejectedQty !== "" && rejectedNumForForm === null ? (
                          <p className="mt-0.5 text-[11px] font-medium text-amber-800">Enter a valid rejected quantity.</p>
                        ) : null}
                        <p className="mt-0.5 text-[11px] text-slate-500">Accepted qty becomes usable stock for dispatch.</p>
                      </div>
                      <div className="erp-form-field w-full min-w-[6rem] max-w-[10rem]">
                        <span className="text-[12px] font-medium text-slate-600">Accepted qty</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          className={cn("mt-0.5 tabular-nums text-[13px] bg-slate-50", operatorInputClass)}
                          value={
                            checkedQtyValid && checkedParsed != null && rejectedNumForForm != null
                              ? fmtQcQty(Math.max(0, checkedParsed - rejectedNumForForm))
                              : ""
                          }
                          placeholder="Auto"
                          readOnly
                          disabled={!productionId}
                        />
                        {productionId > 0 &&
                        checkedQtyValid &&
                        checkedParsed != null &&
                        rejectedNumForForm != null &&
                        rejectedNumForForm > checkedParsed + 1e-6 ? (
                          <p className="mt-0.5 text-[11px] font-medium text-amber-800">Rejected qty cannot exceed inspected qty.</p>
                        ) : null}
                      </div>
                      {productionId > 0 && selectedRollups ? (
                        <div className="w-full text-[11px] text-slate-600">
                          <div>
                            Awaiting before: <span className="font-medium tabular-nums">{fmtQcQty(selectedRollups.pending)}</span>
                            <span className="text-slate-400"> · </span>
                            Inspecting now:{" "}
                            <span className="font-medium tabular-nums">
                              {checkedQtyValid && checkedParsed != null ? fmtQcQty(checkedParsed) : "—"}
                            </span>
                            <span className="text-slate-400"> · </span>
                            Accepted:{" "}
                            <span className="font-medium tabular-nums">
                              {draftAcceptedQty != null && Number.isFinite(draftAcceptedQty) ? fmtQcQty(Math.max(0, draftAcceptedQty)) : "—"}
                            </span>
                            <span className="text-slate-400"> · </span>
                            Rejected:{" "}
                            <span className="font-medium tabular-nums">
                              {rejectedNumForForm != null && Number.isFinite(rejectedNumForForm) ? fmtQcQty(Math.max(0, rejectedNumForForm)) : "—"}
                            </span>
                          </div>
                          <div>
                            Awaiting after save:{" "}
                            <span className="font-medium tabular-nums">
                              {checkedQtyValid && checkedParsed != null ? fmtQcQty(Math.max(0, selectedRollups.pending - checkedParsed)) : "—"}
                            </span>
                          </div>
                        </div>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn("shrink-0 text-[13px]", operatorInputClass)}
                        disabled={saving || !selectedRollups || selectedRollups.pending <= 1e-6}
                        onClick={() => setCheckedQtyStr(fmtQcQty(selectedRollups?.pending ?? 0))}
                      >
                        Inspect Full Remaining
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="qc-accept-full-btn"
                        className={cn("shrink-0 text-[13px]", operatorInputClass)}
                        disabled={saving || !selectedRollups || selectedRollups.pending <= 1e-6}
                        onClick={() => {
                          if (!selectedRollups) return;
                          setCheckedQtyStr(fmtQcQty(selectedRollups.pending));
                          setRejectedQty(0);
                          setRejectedStockBucket(null);
                        }}
                      >
                        Accept Full
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        data-testid="qc-save-btn"
                        className={cn("shrink-0 text-[13px]", operatorInputClass)}
                        onClick={onSubmit}
                        disabled={saving || !qcFormCanSubmit}
                        {...(qcDemoHl ? { "data-demo-highlight": qcDemoHl } : {})}
                      >
                        {saving ? "Saving…" : "Save QC"}
                      </Button>
                    </div>

                    {productionId > 0 && qcInlineValidationMsg ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900">
                        {qcInlineValidationMsg}
                      </div>
                    ) : null}

                    {productionId > 0 && rejectedNumForForm != null && rejectedNumForForm > 1e-6 ? (
                      <div className="space-y-2 border-t border-slate-100 pt-2" aria-label="Rejected qty split">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[12px] font-medium text-slate-600">Rejected qty split</span>
                          <span className="text-[11px] text-slate-500">
                            Total must equal <span className="font-semibold tabular-nums text-slate-700">{fmtQcQty(rejectedNumForForm)}</span>
                          </span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="erp-form-field">
                            <span className="erp-form-label">Rework Qty</span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              className={cn("tabular-nums text-[13px]", operatorInputClass)}
                              value={rejSplitRework}
                              onChange={(e) => {
                                setRejSplitRework(toNumberDraft(e.target.value));
                                setRejectedStockBucket(null);
                              }}
                              disabled={!productionId}
                            />
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              Uses REWORK workflow (owned QC_HOLD + supervisor approval).
                            </p>
                          </div>
                          <div className="erp-form-field">
                            <span className="erp-form-label">Hold Qty</span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              className={cn("tabular-nums text-[13px]", operatorInputClass)}
                              value={rejSplitHold}
                              onChange={(e) => {
                                setRejSplitHold(toNumberDraft(e.target.value));
                                setRejectedStockBucket(null);
                              }}
                              disabled={!productionId}
                            />
                          </div>
                          <div className="erp-form-field">
                            <span className="erp-form-label">Scrap Qty</span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              className={cn("tabular-nums text-[13px]", operatorInputClass)}
                              value={rejSplitScrap}
                              onChange={(e) => {
                                setRejSplitScrap(toNumberDraft(e.target.value));
                                setRejectedStockBucket(null);
                              }}
                              disabled={!productionId}
                            />
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-600">
                          Split total:{" "}
                          <span className="font-semibold tabular-nums">
                            {fmtQcQty(
                              Math.max(0, Number(rejSplitRework || 0)) +
                                Math.max(0, Number(rejSplitHold || 0)) +
                                Math.max(0, Number(rejSplitScrap || 0)),
                            )}
                          </span>
                        </div>
                      </div>
                    ) : null}

                    <div className="erp-form-field">
                      <span className="text-[12px] font-medium text-slate-600">Reason</span>
                      <Input
                        className={cn("mt-0.5 text-[13px]", operatorInputClass)}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Optional"
                        disabled={!productionId}
                      />
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={scrapReusable}
                        onChange={(e) => setScrapReusable(e.target.checked)}
                        disabled={!productionId}
                      />
                      Scrap reusable
                    </label>
                  </div>
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2.5">
        <h2 className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rework / Scrap Summary</h2>

      {!listReady || adjRows.length > 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/40 px-3 py-2 pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Adjustment QC</CardTitle>
          </CardHeader>
          <CardContent className="px-3 py-2">
            {!listReady ? (
              <p className="text-[12px] text-slate-600">Loading…</p>
            ) : (
              <div className="erp-form max-w-md">
                <div className="erp-form-field">
                  <span className="erp-form-label">Stock adjustment (FG stock-in)</span>
                  <select className="erp-select" value={adjTxnId} onChange={(e) => setAdjTxnId(Number(e.target.value))}>
                    {adjRows.map((r) => (
                      <option key={r.stockTransactionId} value={r.stockTransactionId}>
                        ST #{r.stockTransactionId} · {r.itemName} · awaiting QC: {fmtQcQty(r.qcPendingQty)}
                      </option>
                    ))}
                  </select>
                  {selectedAdj ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Qty in: <span className="tabular-nums font-medium">{fmtQcQty(selectedAdj.qtyIn)}</span> · QC used:{" "}
                      <span className="tabular-nums font-medium">{fmtQcQty(selectedAdj.qcUsedQty)}</span> · Awaiting QC:{" "}
                      <span className="tabular-nums font-medium">{fmtQcQty(selectedAdj.qcPendingQty)}</span>
                    </p>
                  ) : null}
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Select sales order</span>
                  {adjSoLoading ? (
                    <p className="text-sm text-slate-600">Loading sales orders…</p>
                  ) : adjEligibleSos.length === 0 ? (
                    <p className="text-sm text-amber-800">No eligible sales orders for this item.</p>
                  ) : (
                    <select
                      className="erp-select"
                      value={adjSelectedSoId || ""}
                      onChange={(e) => setAdjSelectedSoId(Number(e.target.value))}
                    >
                      <option value="">— Select —</option>
                      {adjEligibleSos.map((r) => (
                        <option key={r.salesOrderId} value={r.salesOrderId}>
                          {r.salesOrderNo}
                          {r.customerName ? ` · ${r.customerName}` : ""}
                          {r.pendingDispatchQty > 1e-6 ? ` · backlog ${fmtQcQty(r.pendingDispatchQty)}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="mt-0.5 text-xs text-slate-500">
                    Approved or in-process sales orders that include this FG. Orders with dispatch backlog are listed first.
                  </p>
                </div>
                <div className="erp-form-row-2">
                  <div className="erp-form-field">
                    <span className="erp-form-label">Checked qty</span>
                    <Input type="number" min={0} step="any" value={adjCheckedQty} onChange={(e) => setAdjCheckedQty(toNumberDraft(e.target.value))} />
                  </div>
                  <div className="erp-form-field">
                    <span className="erp-form-label">Rejected qty</span>
                    <Input type="number" min={0} step="any" value={adjRejectedQty} onChange={(e) => setAdjRejectedQty(toNumberDraft(e.target.value))} />
                  </div>
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Reason</span>
                  <Input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="Optional" />
                </div>
                <Button
                  type="button"
                  onClick={submitAdjQc}
                  disabled={
                    adjSaving ||
                    !selectedAdj ||
                    (selectedAdj.qcPendingQty ?? 0) <= 1e-6 ||
                    adjSoLoading ||
                    adjEligibleSos.length === 0 ||
                    adjSelectedSoId <= 0
                  }
                >
                  {adjSaving ? "Saving..." : "Save QC (adjusted stock)"}
                </Button>
                <p className="text-xs text-slate-500">
                  This QC does not link to a production batch. It is meant for stock-adjusted / legacy FG stock so dispatch can remain QC-controlled.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!listReady || (dispQueues && dispQueues.reworkPendingSupervisor.length > 0) ? (
        <Card id="qc-rework-supervisor" className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/40 px-3 py-2 pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Rework Approval</CardTitle>
          </CardHeader>
          <CardContent className="px-0 py-0 sm:px-0">
            {!listReady || !dispQueues ? (
              <p className="px-3 py-2 text-[12px] text-slate-600">Loading…</p>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1.5 font-medium">Item</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                    <th className="px-2 py-1.5 font-medium">Work order</th>
                    <th className="px-2 py-1.5 font-medium">Source QC</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                    <th className="px-2 py-1.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dispQueues.reworkPendingSupervisor.map((r) => (
                    <tr key={r.id} className={cn("border-t border-slate-100", operatorTableRowClass)}>
                      <td className="max-w-[12rem] truncate px-2 py-1 font-medium text-slate-900" title={r.item.itemName}>
                        {r.item.itemName}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtQcQty(r.remainingQty)}</td>
                      <td className="px-2 py-1">{r.workOrder.docNo ?? `WO #${r.workOrder.id}`}</td>
                      <td className="px-2 py-1 font-mono text-[11px]">{r.sourceQcEntry.docNo ?? `QC #${r.sourceQcEntry.id}`}</td>
                      <td className="px-2 py-1">
                        <OperatorStatusBadge kind="blocked">Not usable</OperatorStatusBadge>
                      </td>
                      <td className="px-2 py-1 text-right">
                        {canSupervisorDecide ? (
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              className="text-[12px]"
                              disabled={supervisorSavingId === r.id}
                              onClick={() => {
                                const remarks = window.prompt("Optional remarks for approval", "") ?? "";
                                void submitSupervisorDecision(r.id, "APPROVE", undefined, remarks || undefined);
                              }}
                            >
                              {supervisorSavingId === r.id ? "…" : "Approve rework"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="text-[12px]"
                              disabled={supervisorSavingId === r.id}
                              onClick={() => {
                                const remarks = window.prompt("Optional remarks (deny → hold)", "") ?? "";
                                void submitSupervisorDecision(r.id, "DENY", "HOLD", remarks || undefined);
                              }}
                            >
                              Deny → Hold
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="text-[12px]"
                              disabled={supervisorSavingId === r.id}
                              onClick={() => {
                                if (!window.confirm("Send this quantity to scrap?")) return;
                                const remarks = window.prompt("Optional remarks (scrap)", "") ?? "";
                                void submitSupervisorDecision(r.id, "DENY", "SCRAP", remarks || undefined);
                              }}
                            >
                              Deny → Scrap
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[12px] text-slate-500">Supervisor only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!listReady || (dispQueues && dispQueues.readyForQcRecheck.length > 0) ? (
        <Card id="qc-rework-ready" className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/40 px-3 py-2 pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Final Rework QC</CardTitle>
          </CardHeader>
          <CardContent className="px-3 py-2">
            {!listReady || !dispQueues ? (
              <p className="text-[12px] text-slate-600">Loading…</p>
            ) : !canQcRecheck ? (
              <p className="text-[12px] text-slate-600">QC recheck is performed by QC (or Admin).</p>
            ) : (
            <div className="max-w-2xl space-y-3">
              <div className="erp-form-field">
                <span className="erp-form-label">Select line</span>
                <select
                  className="erp-select"
                  value={recheckDispId || ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRecheckDispId(v === "" ? 0 : Number(v));
                    setRecheckCheckedQty("");
                    setRecheckRejectedQty("");
                    setRecheckRejectedBucket(null);
                    setRecheckReason("");
                  }}
                >
                  {dispQueues.readyForQcRecheck.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.item.itemName} · remaining {fmtQcQty(r.remainingQty)} · WO {r.workOrder.docNo ?? r.workOrder.id}
                    </option>
                  ))}
                </select>
                {selectedRecheckDisp ? (
                  <p className="mt-1 text-[12px] text-slate-600">
                    This is the final quality decision for the full remaining rework quantity ({fmtQcQty(selectedRecheckDisp.remainingQty)}).
                    Enter only the rejected qty; accepted qty is calculated automatically.
                  </p>
                ) : null}
              </div>
              {selectedRecheckDisp ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="erp-form-field">
                      <span className="erp-form-label">Remaining qty</span>
                      <Input type="text" readOnly value={fmtQcQty(selectedRecheckDisp.remainingQty)} className="bg-slate-50 tabular-nums" />
                    </div>
                    <div className="erp-form-field">
                      <span className="erp-form-label">Rejected qty</span>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={recheckRejectedQty}
                        onChange={(e) => setRecheckRejectedQty(toNumberDraft(e.target.value))}
                      />
                      {Number(recheckRejectedQty) > Number(selectedRecheckDisp.remainingQty) + 1e-6 ? (
                        <p className="mt-0.5 text-[11px] font-medium text-amber-800">Rejected qty cannot exceed remaining qty.</p>
                      ) : null}
                    </div>
                    <div className="erp-form-field">
                      <span className="erp-form-label">Accepted qty</span>
                      <Input
                        type="text"
                        readOnly
                        value={(() => {
                          const rem = Number(selectedRecheckDisp.remainingQty);
                          const rej = Number(recheckRejectedQty);
                          if (!Number.isFinite(rem) || rem <= 0) return "";
                          if (!Number.isFinite(rej) || rej < 0) return "";
                          return fmtQcQty(Math.max(0, rem - Math.min(rem, rej)));
                        })()}
                        className="bg-slate-50 tabular-nums"
                      />
                    </div>
                  </div>
                  {Number(recheckRejectedQty) > 1e-6 ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
                      Rejected quantity will be scrapped in Final QC.
                    </div>
                  ) : null}
                  <div className="erp-form-field">
                    <span className="erp-form-label">Reason</span>
                    <Input value={recheckReason} onChange={(e) => setRecheckReason(e.target.value)} placeholder="Optional" />
                  </div>
                  <Button type="button" onClick={() => void submitDispositionRecheck()} disabled={recheckSaving}>
                    {recheckSaving ? "Saving…" : "Save QC recheck"}
                  </Button>
                </>
              ) : null}
            </div>
            )}

          {role === "ADMIN" && Array.isArray((dispQueues as any).readyForQcRecheckMismatches) && (dispQueues as any).readyForQcRecheckMismatches.length > 0 ? (
            <details className="mt-4 rounded border border-amber-200 bg-amber-50/40 px-3 py-2">
              <summary className="cursor-pointer text-[12px] font-semibold text-amber-950">
                Admin · Historical mismatches (non-actionable) ({(dispQueues as any).readyForQcRecheckMismatches.length})
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-[12px]">
                  <thead>
                    <tr className="border-b border-amber-200 text-left text-[11px] font-medium text-amber-950/80">
                      <th className="py-1 pr-2">Item</th>
                      <th className="py-1 pr-2">WO</th>
                      <th className="py-1 pr-2">QC</th>
                      <th className="py-1 pr-2 text-right">Disposition remaining</th>
                      <th className="py-1 text-right">Owned awaiting-QC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dispQueues as any).readyForQcRecheckMismatches.map((r: any) => (
                      <tr key={r.id} className="border-t border-amber-100">
                        <td className="py-1 pr-2 font-medium text-slate-900">{r.item?.itemName ?? "—"}</td>
                        <td className="py-1 pr-2">{r.workOrder?.docNo ?? `WO #${r.workOrder?.id ?? "—"}`}</td>
                        <td className="py-1 pr-2">{r.sourceQcEntry?.docNo ?? `QC #${r.sourceQcEntry?.id ?? "—"}`}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{fmtQcQty(Number(r.dispositionRemainingQty ?? 0))}</td>
                        <td className="py-1 text-right tabular-nums">{fmtQcQty(Number(r.qcPendingQty ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-amber-950/80">
                These rows were created under the older pooled QC_PENDING design. They have remaining quantity on the disposition record,
                but no owned awaiting-QC stock exists, so they are intentionally not actionable.
              </p>
            </details>
          ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!listReady || (dispQueues && dispQueues.holdStock.length > 0) ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/40 px-3 py-2 pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Hold Decision</CardTitle>
          </CardHeader>
          <CardContent className="px-3 py-2">
            {!listReady || !dispQueues ? (
              <p className="text-[12px] text-slate-600">Loading…</p>
            ) : !canHoldAct ? (
              <p className="text-[12px] text-slate-600">Blocked: you do not have permission to action hold stock.</p>
            ) : (
            <div className="space-y-4">
              {dispQueues.holdStock.map((h) => (
                <HoldDispositionRow
                  key={h.id}
                  row={h}
                  disabled={holdActionSavingId === h.id}
                  onAction={(action, qty, remarks) => void submitHoldDispositionAction(h.id, action, qty, remarks)}
                />
              ))}
            </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!listReady || (dispQueues && dispQueues.scrapRegister.length > 0) ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/40 px-3 py-2 pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Recent Scrap</CardTitle>
          </CardHeader>
          <CardContent className="px-0 py-0">
            {!listReady || !dispQueues ? (
              <p className="px-3 py-2 text-[12px] text-slate-600">Loading…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1.5 text-left font-medium">Item</th>
                      <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                      <th className="px-2 py-1.5 text-left font-medium">Ref</th>
                      <th className="px-2 py-1.5 text-right font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispQueues.scrapRegister.map((s) => (
                      <tr key={s.id} className={cn("border-t border-slate-100", operatorTableRowClass)}>
                        <td className="max-w-[14rem] truncate px-2 py-1 font-medium text-slate-900" title={s.item.itemName}>
                          {s.item.itemName}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-800">{fmtQcQty(s.qty)}</td>
                        <td className="px-2 py-1 font-mono text-[11px] text-slate-700">{s.workOrder.docNo ?? `WO #${s.workOrder.id}`}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                          {s.closedAt ? s.closedAt.slice(0, 10) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!listReady || reworkQcRows.length > 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/40 px-3 py-2 pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Internal Rework QC (from stock)</CardTitle>
          </CardHeader>
          <CardContent className="px-3 py-2">
            {!listReady ? (
              <p className="text-[12px] text-slate-600">Loading…</p>
            ) : (
            <div className="erp-form max-w-2xl space-y-3">
              <div className="erp-form-field">
                <span className="erp-form-label">Item (awaiting QC)</span>
                <select
                  className="erp-select"
                  value={reworkQcItemId || ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setReworkQcItemId(v === "" ? 0 : Number(v));
                    setReworkCheckedQty("");
                    setReworkRejectedQty("");
                    setReworkRejectedBucket(null);
                    setReworkReason("");
                  }}
                >
                  <option value="">Select item…</option>
                  {reworkQcRows.map((r) => (
                    <option key={r.itemId} value={r.itemId}>
                      {r.item.itemName} · awaiting QC: {fmtQcQty(r.qcPendingQty)} {r.item.unit}
                    </option>
                  ))}
                </select>
                {selectedReworkQc ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Internal rework completed; inspect and post accepted qty to usable, or route rejects to Hold / Rework / Usable /
                    Scrap.
                  </p>
                ) : null}
              </div>
              {selectedReworkQc ? (
                <>
                  <div className="erp-form-row-2">
                    <div className="erp-form-field">
                      <span className="erp-form-label">Checked qty</span>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={reworkCheckedQty}
                        onChange={(e) => setReworkCheckedQty(toNumberDraft(e.target.value))}
                      />
                    </div>
                    <div className="erp-form-field">
                      <span className="erp-form-label">Rejected qty</span>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={reworkRejectedQty}
                        onChange={(e) => setReworkRejectedQty(toNumberDraft(e.target.value))}
                      />
                    </div>
                  </div>
                  {Number(reworkRejectedQty) > 1e-6 ? (
                    <div className="space-y-2 border-t border-slate-100 pt-3" role="radiogroup" aria-label="Rejected stock action">
                      <span className="erp-form-label">Rejected stock action</span>
                      <div className="grid max-w-xl gap-2">
                        {(
                          [
                            { bucket: "REWORK" as const, title: "Rework", hint: "Back to rework bucket." },
                            { bucket: "QC_HOLD" as const, title: "Hold", hint: "Hold for checking — decision pending." },
                            { bucket: "USABLE" as const, title: "Usable", hint: "Treat as usable finished goods." },
                            { bucket: "SCRAP" as const, title: "Scrap", hint: "Scrap bucket — loss from usable flow." },
                          ] as const
                        ).map((opt) => (
                          <label
                            key={opt.bucket}
                            className={`flex cursor-pointer gap-2 rounded-md border px-3 py-2 text-sm ${
                              reworkRejectedBucket === opt.bucket
                                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                : "border-slate-200 bg-white hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="radio"
                              className="mt-0.5 h-4 w-4 shrink-0"
                              name="reworkQcRejectedAction"
                              checked={reworkRejectedBucket === opt.bucket}
                              onChange={() => setReworkRejectedBucket(opt.bucket)}
                            />
                            <span>
                              <span className="font-medium text-slate-900">{opt.title}</span>
                              <span className="mt-0.5 block text-xs font-normal text-slate-600">{opt.hint}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="erp-form-field">
                    <span className="erp-form-label">Reason</span>
                    <Input value={reworkReason} onChange={(e) => setReworkReason(e.target.value)} placeholder="Optional" />
                  </div>
                  <Button
                    type="button"
                    onClick={() => void submitReworkQc()}
                    disabled={reworkSaving || !reworkQcCanSave}
                  >
                    {reworkSaving ? "Saving…" : "Save rework QC"}
                  </Button>
                </>
              ) : null}
            </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      </div>

      <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-3 py-2">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Customer Return QC</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-3 py-2">
          {!listReady ? (
            <p className="text-[12px] text-slate-600">Loading…</p>
          ) : custReturnQcRows.length === 0 ? (
            <p className="text-[12px] leading-snug text-slate-600">No customer returns waiting for QC.</p>
          ) : (
            <div className="overflow-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[980px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1.5 font-medium">Return No</th>
                    <th className="px-2 py-1.5 font-medium">Date</th>
                    <th className="px-2 py-1.5 font-medium">Customer</th>
                    <th className="px-2 py-1.5 font-medium">Item</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty in QC</th>
                    <th className="px-2 py-1.5 font-medium">Source</th>
                    <th className="px-2 py-1.5 font-medium">Linked Dispatch</th>
                    <th className="px-2 py-1.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {custReturnQcRows.map((r) => {
                    const inReworkBucket = r.currentBucket === "REWORK";
                    const source = inReworkBucket
                      ? "External rework — pending verification"
                      : r.disposition === "REWORK"
                        ? "Hold for checking (after rework)"
                        : "Hold for checking";
                    const approveDisabled = inReworkBucket || custReturnApprovingId === r.id || custReturnScrappingId === r.id;
                    const actionBusy =
                      custReturnApprovingId === r.id ||
                      custReturnScrappingId === r.id ||
                      custReturnApproveReworkId === r.id;
                    return (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-mono text-[11px]">{r.returnNo}</td>
                        <td className="px-2 py-1 tabular-nums text-slate-700">{r.date ? new Date(r.date).toLocaleDateString() : "—"}</td>
                        <td className="max-w-[8rem] truncate px-2 py-1" title={r.customer?.name ?? ""}>
                          {r.customer?.name ?? "—"}
                        </td>
                        <td className="max-w-[12rem] truncate px-2 py-1 font-medium" title={r.item?.name ?? ""}>
                          {r.item?.name ?? "—"}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {fmtQcQty(Number(r.qty || 0))} {r.item?.unit ?? ""}
                        </td>
                        <td className="px-2 py-1">
                          <span className="inline-flex max-w-[14rem] rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium leading-snug text-slate-700">
                            {source}
                          </span>
                        </td>
                        <td className="px-2 py-1 font-mono text-[11px]">{r.dispatchNo}</td>
                        <td className="px-2 py-1 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {inReworkBucket ? (
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                disabled={actionBusy}
                                onClick={() => void customerReturnApproveRework(r.id)}
                              >
                                {custReturnApproveReworkId === r.id ? "…" : "Approve Rework (Move to Stock)"}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={approveDisabled}
                              title={
                                inReworkBucket
                                  ? "Move stock to hold for checking first (after external rework is done)."
                                  : undefined
                              }
                              onClick={() => approveCustomerReturn(r.id)}
                            >
                              {custReturnApprovingId === r.id ? "…" : "Approve to stock"}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={actionBusy}
                              onClick={() => scrapCustomerReturn(r.id)}
                            >
                              {custReturnScrappingId === r.id ? "…" : "Scrap"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <details className="rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-1.5">
            <summary className="cursor-pointer text-[11px] font-medium text-slate-600">How customer return actions work</summary>
            <p className="mt-2 text-[11px] leading-snug text-slate-600">
              Rework returns: one &quot;Approve Rework (Move to Stock)&quot; moves qty from rework through hold to usable and closes the
              return for dispatch. Hold-only returns: use &quot;Approve to stock&quot; as before. Scrap is allowed from rework or hold.
              No production or work orders.
            </p>
          </details>
        </CardContent>
      </Card>

      <Card className="border border-dashed border-slate-200/90 bg-slate-50/40 shadow-sm">
        <CardHeader className="border-b border-slate-100/80 px-3 py-2 pb-2">
          <CardTitle className="text-[13px] font-semibold text-slate-700">Old rejected qty pending classification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-3 py-2">
          <details className="text-[12px] text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">What this classification does</summary>
            <p className="mt-2 leading-snug">
              For production QC rejects not yet classified, record once how reject qty should be treated for stock. Original QC
              accepted/rejected totals are unchanged—this step only moves stock between buckets.
            </p>
          </details>
          {!listReady ? (
            <p className="text-sm text-slate-600">Loading…</p>
          ) : (
            <>
              {legacyEligibleFetchError ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
                  <div className="font-medium">Could not load eligible QC rows.</div>
                  <div className="mt-1 text-red-800">{legacyEligibleFetchError}</div>
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void refresh()}>
                    Retry
                  </Button>
                </div>
              ) : null}

              {!legacyEligibleFetchError && legacyEligibleRows.length > 0 ? (
                <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                  <table className="w-full min-w-[520px] border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-1.5">QC Entry #</th>
                        <th className="px-2 py-1.5">Production #</th>
                        <th className="px-2 py-1.5">Item</th>
                        <th className="px-2 py-1.5 text-right">Rejected qty</th>
                        <th className="px-2 py-1.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legacyEligibleRows.map((row) => (
                        <tr key={row.qcEntryId} className={cn("border-t border-slate-100", operatorTableRowClass)}>
                          <td className="px-2 py-1 font-mono text-[11px]">{row.docNo ?? `#${row.qcEntryId}`}</td>
                          <td className="px-2 py-1 font-mono text-[11px]">#{row.productionId}</td>
                          <td className="max-w-[12rem] truncate px-2 py-1 font-medium text-slate-900" title={row.itemName ?? ""}>
                            {row.itemName ?? "—"}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtQcQty(row.rejectedQty)}</td>
                          <td className="px-2 py-1 text-right">
                            {canLegacyClassify ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openLegacyClassify(row)}
                              >
                                Classify rejected qty
                              </Button>
                            ) : (
                              <span className="text-[11px] text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {!legacyEligibleFetchError && legacyEligibleRows.length === 0 ? (
                <p className="text-sm text-slate-600">No legacy QC rejects need classification.</p>
              ) : null}

              {!legacyEligibleFetchError && legacyIneligibleRows.length > 0 ? (
                <details className="mt-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <summary className="cursor-pointer text-[12px] font-medium text-slate-700">
                    Historical / already unavailable ({legacyIneligibleRows.length})
                  </summary>
                  <p className="mt-1 text-[11px] leading-snug text-slate-600">
                    Stock already moved or unavailable for classification.
                  </p>
                  <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white">
                    <table className="w-full min-w-[560px] border-collapse text-[12px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-2 py-1.5">QC Entry #</th>
                          <th className="px-2 py-1.5">Production #</th>
                          <th className="px-2 py-1.5">Item</th>
                          <th className="px-2 py-1.5 text-right">Rejected qty</th>
                          <th className="px-2 py-1.5 text-right">Available</th>
                          <th className="px-2 py-1.5">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {legacyIneligibleRows.slice(0, 60).map((row) => (
                          <tr key={row.qcEntryId} className={cn("border-t border-slate-100", operatorTableRowClass)}>
                            <td className="px-2 py-1 font-mono text-[11px]">{row.docNo ?? `#${row.qcEntryId}`}</td>
                            <td className="px-2 py-1 font-mono text-[11px]">#{row.productionId}</td>
                            <td className="max-w-[12rem] truncate px-2 py-1 font-medium text-slate-900" title={row.itemName ?? ""}>
                              {row.itemName ?? "—"}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmtQcQty(row.rejectedQty)}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                              {fmtQcQty(Number(row.availableSourceQty ?? 0))}
                            </td>
                            <td className="px-2 py-1 text-[11px] text-slate-600">
                              {row.nonActionableReason ?? "Stock already moved or unavailable for classification."}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {legacyIneligibleRows.length > 60 ? (
                    <div className="mt-2 text-[11px] text-slate-600">Showing 60 of {legacyIneligibleRows.length}.</div>
                  ) : null}
                </details>
              ) : null}

              <div>
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                  Already classified (recent)
                </div>
                {legacyHistoryFetchError ? (
                  <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[12px] text-red-800">
                    {legacyHistoryFetchError}
                  </div>
                ) : null}
                {legacyClassifiedRows.length === 0 ? (
                  <p className="text-sm text-slate-600">No classifications recorded yet.</p>
                ) : (
                  <ul className="space-y-2 text-[13px]">
                    {legacyClassifiedRows.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-100 bg-slate-50/80 px-3 py-2"
                      >
                        <span className="font-mono text-xs text-slate-700">{r.qcDocNo ?? `QC #${r.sourceQcEntryId}`}</span>
                        <span className="font-medium text-slate-900">{r.itemName}</span>
                        <span className="tabular-nums text-slate-700">{fmtQcQty(r.qty)}</span>
                        <OperatorStatusBadge
                          kind={
                            r.action === "APPROVE_TO_USABLE" ? "ready" : r.action === "MOVE_TO_HOLD" ? "blocked" : "pending"
                          }
                        >
                          {legacyClassifiedBadgeLabel(r.action)}
                        </OperatorStatusBadge>
                        <span className="text-[12px] text-slate-500">
                          {r.fromStockBucket ?? "—"} → {r.toStockBucket ?? "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <details className="rounded-md border border-slate-200 bg-slate-50/60 shadow-sm">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="text-slate-400">
              ▸
            </span>
            Admin tools
          </span>
        </summary>
        <div className="border-t border-slate-200 bg-white px-3 py-2">
          <p className="mb-2 text-[11px] leading-snug text-slate-500">
            Full QC reversal affects stock and dispatch eligibility. Use only when you understand the impact.
          </p>
          {!listReady ? (
            <p className="text-[12px] text-slate-600">Loading…</p>
          ) : !withQcRows.length ? (
            <p className="text-[12px] text-slate-600">No active QC entries to reverse.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[720px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1.5 font-medium">Production</th>
                    <th className="px-2 py-1.5 font-medium">FG</th>
                    <th className="px-2 py-1.5 text-right font-medium">Awaiting QC qty</th>
                    <th className="px-2 py-1.5 text-right font-medium">Checked qty</th>
                    <th className="px-2 py-1.5 text-right font-medium">Accepted qty</th>
                    <th className="px-2 py-1.5 text-right font-medium">Rejected qty</th>
                    <th className="px-2 py-1.5 text-right font-medium">QC entry #</th>
                    <th className="px-2 py-1.5 text-right font-medium"> </th>
                  </tr>
                </thead>
                <tbody>
                  {withQcRows.flatMap((r) => {
                    const q = safeQcRollupsForRow(r);
                    const active = (Array.isArray((r as any)?.qcEntries) ? (r as any).qcEntries : []).filter((e: any) => isActiveQcEntry(e));
                    if (active.length === 0) return [];
                    return active.map((qe: any) => (
                      <tr key={`${r.id}-${qe.id}`} className="border-t border-slate-100">
                        <td className="px-2 py-1 tabular-nums">#{r.id}</td>
                        <td className="max-w-[10rem] truncate px-2 py-1" title={safeItemNameForRow(r) || ""}>
                          {safeItemNameForRow(r) || "—"}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtQcQty(q.pending)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtQcQty(qcEntryChecked(qe))}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-emerald-700">{fmtQcQty(Number(qe.acceptedQty ?? 0))}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-red-700">{fmtQcQty(Number(qe.rejectedQty ?? 0))}</td>
                        <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums">#{qe.id}</td>
                        <td className="px-2 py-1 text-right">
                          {isAdminUser ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7"
                              disabled={reversingId === qe.id}
                              onClick={() =>
                                openReverseQcModal({
                                  qcEntryId: qe.id,
                                  acceptedQty: Number(qe.acceptedQty ?? 0),
                                  rejectedQty: Number(qe.rejectedQty ?? 0),
                                  allowedReverseQty: qcEntryChecked(qe),
                                })
                              }
                            >
                              {reversingId === qe.id ? "…" : "Admin Reverse"}
                            </Button>
                          ) : (
                            <span className="text-[11px] text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      {reverseQcModal && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) closeReverseQcModal();
              }}
            >
              <div
                className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="qc-reverse-modal-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="qc-reverse-modal-title" className="text-base font-semibold text-slate-900">
                  Admin reverse QC
                </h2>
                <p className="mt-1 text-[12px] leading-snug text-slate-600">
                  Reversing a QC entry updates stock. Confirm details before continuing.
                </p>
                <dl className="mt-3 grid gap-2 text-[12px]">
                  <div className="flex justify-between gap-2 border-b border-slate-100 py-1">
                    <dt className="text-slate-500">QC entry #</dt>
                    <dd className="font-mono font-medium tabular-nums text-slate-900">#{reverseQcModal.qcEntryId}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 py-1">
                    <dt className="text-slate-500">Accepted qty</dt>
                    <dd className="text-right tabular-nums text-emerald-800">{fmtQcQty(reverseQcModal.acceptedQty)}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 py-1">
                    <dt className="text-slate-500">Rejected qty</dt>
                    <dd className="text-right tabular-nums text-red-800">{fmtQcQty(reverseQcModal.rejectedQty)}</dd>
                  </div>
                  <div className="flex justify-between gap-2 py-1">
                    <dt className="text-slate-500">Allowed reverse qty (checked total)</dt>
                    <dd className="text-right font-semibold tabular-nums text-slate-900">
                      {fmtQcQty(reverseQcModal.allowedReverseQty)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 grid gap-2">
                  <div className="erp-form-field">
                    <span className="erp-form-label">Reverse qty</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      className="tabular-nums"
                      value={reverseQcQtyDraft}
                      onChange={(e) => {
                        setReverseQcQtyDraft(e.target.value);
                        setReverseQcModalError(null);
                      }}
                      placeholder={fmtQcQty(reverseQcModal.allowedReverseQty)}
                    />
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => {
                          setReverseQcQtyDraft(fmtQcQty(reverseQcModal.allowedReverseQty));
                          setReverseQcModalError(null);
                        }}
                      >
                        Use full checked qty
                      </Button>
                    </div>
                  </div>
                  <div className="erp-form-field">
                    <span className="erp-form-label">
                      Reason <span className="font-normal text-slate-500">(required)</span>
                    </span>
                    <Input
                      value={reverseQcReasonDraft}
                      onChange={(e) => {
                        setReverseQcReasonDraft(e.target.value);
                        setReverseQcModalError(null);
                      }}
                      placeholder="Why this reversal"
                    />
                  </div>
                  <div className="erp-form-field">
                    <span className="erp-form-label">
                      Admin password <span className="font-normal text-slate-500">(required)</span>
                    </span>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={reverseQcPasswordDraft}
                      onChange={(e) => {
                        setReverseQcPasswordDraft(e.target.value);
                        setReverseQcModalError(null);
                      }}
                    />
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Confirms intent; not sent to the server (API unchanged).
                    </p>
                  </div>
                </div>
                {reverseQcModalError ? (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-950">
                    {reverseQcModalError}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                  <Button type="button" variant="outline" onClick={closeReverseQcModal} disabled={reversingId != null}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={reversingId != null}
                    onClick={() => void confirmReverseQcModal()}
                  >
                    {reversingId != null ? "Working…" : "Confirm Admin Reverse"}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {legacyClassifyOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[280] flex items-center justify-center bg-black/50 p-4"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) closeLegacyClassifyModal();
              }}
            >
              <div
                className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="legacy-classify-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="legacy-classify-title" className="text-base font-semibold text-slate-900">
                  Classify Rejected Qty
                </h2>
                <dl className="mt-3 grid gap-1.5 rounded-md border border-slate-100 bg-slate-50/80 px-3 py-2 text-[12px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">QC Entry #</dt>
                    <dd className="font-mono font-medium tabular-nums text-slate-900">
                      {legacyClassifyOpen.docNo ?? `#${legacyClassifyOpen.qcEntryId}`}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Production #</dt>
                    <dd className="font-mono font-medium tabular-nums text-slate-900">#{legacyClassifyOpen.productionId}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Item</dt>
                    <dd className="max-w-[14rem] truncate text-right font-medium text-slate-900" title={legacyClassifyOpen.itemName ?? ""}>
                      {legacyClassifyOpen.itemName ?? "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Rejected Qty</dt>
                    <dd className="text-right font-semibold tabular-nums text-slate-900">
                      {fmtQcQty(legacyClassifyOpen.rejectedQty)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                  Original reject bucket: {legacyClassifyOpen.rejectedStockBucket ?? "QC_HOLD"}. Server applies the full rejected qty for
                  this QC entry.
                </p>
                <div className="mt-3 space-y-2" role="radiogroup" aria-label="Classification action">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Action</span>
                  {(
                    [
                      {
                        id: "APPROVE_TO_USABLE" as const,
                        title: "Approve to Usable Stock",
                        hint: "Moves reject stock to usable FG when rules allow.",
                      },
                      {
                        id: "MOVE_TO_HOLD" as const,
                        title: "Put on Hold / Rework routing",
                        hint: "Creates Hold Decision intake (rework flows attach here). Matches backend MOVE_TO_HOLD.",
                      },
                      { id: "SCRAP" as const, title: "Scrap", hint: "Route to scrap bucket." },
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer gap-2 rounded-md border px-2.5 py-2 text-[12px] ${
                        legacyClassifyAction === opt.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="legacyClassifyAction"
                        className="mt-0.5 h-4 w-4 shrink-0"
                        checked={legacyClassifyAction === opt.id}
                        onChange={() => {
                          setLegacyClassifyAction(opt.id);
                          setLegacyClassifyModalError(null);
                        }}
                      />
                      <span>
                        <span className="font-medium text-slate-900">{opt.title}</span>
                        <span className="mt-0.5 block text-[11px] font-normal text-slate-600">{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 grid gap-2">
                  <div className="erp-form-field">
                    <span className="erp-form-label">Qty to classify</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      className="tabular-nums"
                      value={legacyClassifyQtyDraft}
                      onChange={(e) => {
                        setLegacyClassifyQtyDraft(e.target.value);
                        setLegacyClassifyModalError(null);
                      }}
                    />
                    <div className="mt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => {
                          if (!legacyClassifyOpen) return;
                          setLegacyClassifyQtyDraft(fmtQcQty(legacyClassifyOpen.rejectedQty));
                          setLegacyClassifyModalError(null);
                        }}
                      >
                        Use full rejected qty
                      </Button>
                    </div>
                  </div>
                  <div className="erp-form-field">
                    <span className="erp-form-label">
                      Reason / remarks <span className="font-normal text-slate-500">(required)</span>
                    </span>
                    <Input
                      value={legacyClassifyRemarks}
                      onChange={(e) => {
                        setLegacyClassifyRemarks(e.target.value);
                        setLegacyClassifyModalError(null);
                      }}
                      placeholder="Audit note"
                    />
                  </div>
                </div>
                {legacyClassifyModalError ? (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-950">
                    {legacyClassifyModalError}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                  <Button type="button" variant="outline" disabled={legacyClassifySaving} onClick={closeLegacyClassifyModal}>
                    Cancel
                  </Button>
                  <Button type="button" disabled={legacyClassifySaving} onClick={() => void submitLegacyClassify()}>
                    {legacyClassifySaving ? "Saving…" : "Save Classification"}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      </OperatorPageBody>
      </PageContainer>
    );
  } catch (e) {
    return fatalFallback("An unexpected error occurred while rendering the QC page.", e);
  }
}
