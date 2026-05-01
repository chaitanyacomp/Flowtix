import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useAuth } from "../hooks/useAuth";
import { isValidNumberDraft, type NumberDraft, toNumberDraft } from "../lib/numberDraft";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useDependentFieldFocus } from "../hooks/useDependentFieldFocus";
import { useMandatoryPositiveQtyDraft } from "../hooks/useMandatoryPositiveQtyDraft";
import {
  OperatorMetricBadge,
  OperatorPageBody,
  OperatorTopBar,
  operatorInputClass,
} from "../components/erp/OperatorWorkbench";
import { cn } from "../lib/utils";
import { useShortcutHints } from "../hooks/useShortcutHints";
import { FieldShortcutHint } from "../components/ui/FieldShortcutHint";
import { ShortcutHintBar } from "../components/ui/ShortcutHintBar";
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
  StickyWorkspaceHead,
} from "../components/PageHeader";
import { NextStepStrip } from "../components/erp/NextStepStrip";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { NoQtyCycleSummaryCard } from "../components/NoQtyCycleSummaryCard";
import { buildNoQtyGuidedHref, useNoQtyFlowState } from "../lib/noQtyFlowState";
import { useToast } from "../contexts/ToastContext";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { DemoSafeNoQtyContinue } from "../components/demo/DemoSafeNoQtyContinue";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";
import { NoQtyFlowStepsCard } from "../components/erp/NoQtyFlowStepsCard";

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
type WoRow = { id: number; salesOrderId: number; lines: WoLine[] };

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

function fmtProdQty(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1000) / 1000;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return String(r);
}

function lineRemaining(l: FlatLine): number {
  const approved = l.approvedProducedQty ?? 0;
  return l.remainingQty != null && Number.isFinite(l.remainingQty)
    ? l.remainingQty
    : Math.max(0, Number(l.qty) - approved);
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

  const source = searchParams.get("source") ?? "";
  const fromNoQtySo = source === "no_qty_so";
  const focusSoId = Number(searchParams.get("salesOrderId") ?? 0);
  const focusSoIdValid = Number.isFinite(focusSoId) && focusSoId > 0;
  const { state: noQtyFlowState } = useNoQtyFlowState(focusSoIdValid ? focusSoId : null, fromNoQtySo && focusSoIdValid);
  const noQtyCycleId = fromNoQtySo && focusSoIdValid ? (noQtyFlowState?.cycleId ?? null) : null;
  const woIdFromUrl = Number(searchParams.get("woId") ?? 0);
  const woIdFromUrlValid = Number.isFinite(woIdFromUrl) && woIdFromUrl > 0;

  const [workOrders, setWorkOrders] = React.useState<WoRow[]>([]);
  const [entries, setEntries] = React.useState<ProdEntryRow[]>([]);
  const [soOrderTypeById, setSoOrderTypeById] = React.useState<Record<number, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [focusSo, setFocusSo] = React.useState<{ id: number; customerName: string; docNo?: string | null; cycleNo?: number | null; cycleStatus?: "Active Cycle" | "Closed Cycle" } | null>(null);
  const [noQtyEmptyMsg, setNoQtyEmptyMsg] = React.useState<string>("");

  const [prodDate, setProdDate] = React.useState(todayYmd);
  const [woId, setWoId] = React.useState(0);
  const [wolId, setWolId] = React.useState(0);
  const {
    raw: producedQtyStr,
    setRaw: setProducedQtyStr,
    parsed: producedQtyParsed,
    isValid: producedQtyValid,
    reset: resetProducedQty,
  } = useMandatoryPositiveQtyDraft();
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
  const [reverseQtyDraft, setReverseQtyDraft] = React.useState("");
  const [reverseReasonDraft, setReverseReasonDraft] = React.useState("");
  const [reversePasswordDraft, setReversePasswordDraft] = React.useState("");
  const [reverseModalError, setReverseModalError] = React.useState<string | null>(null);
  const [entryFilter, setEntryFilter] = React.useState<"ALL" | "DRAFT" | "APPROVED">("ALL");

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

  const createFormRef = React.useRef<HTMLFormElement | null>(null);
  const woSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const lineSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const producedQtyRef = React.useRef<HTMLInputElement | null>(null);
  useFastEntryForm({ containerRef: createFormRef, initialFocusRef: woSelectRef });

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
        return "";
      }
    },
    [soOrderTypeById],
  );

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

  const noQtyAutoPickLines = React.useMemo(() => {
    if (!(fromNoQtySo && focusSoIdValid)) return [];
    const eps = 1e-6;
    const forSo = flatLines.filter((l) => l.salesOrderId === focusSoId);
    const ready = forSo.filter((l) => {
      const rem = lineRemaining(l);
      if (!(rem > eps)) return false;
      const produced = l.approvedProducedQty ?? 0;
      const qcPending = noQtyQcPendingByWolId.get(l.id) ?? 0;
      const carryForward = produced > eps && qcPending <= eps && noQtyHasApprovedByWolId.has(l.id);
      return !carryForward && qcPending <= eps;
    });
    return sortFlatByPriority(ready);
  }, [flatLines, focusSoId, focusSoIdValid, fromNoQtySo, noQtyHasApprovedByWolId, noQtyQcPendingByWolId]);

  const [noQtyManualContinue, setNoQtyManualContinue] = React.useState(false);

  const linesForWo = React.useMemo(() => workOrders.find((w) => w.id === woId)?.lines ?? [], [workOrders, woId]);

  const applyLine = React.useCallback(
    (l: FlatLine) => {
      setWoId(l.workOrderId);
      setWolId(l.id);
      const rem = lineRemaining(l);
      // We will decide prefill vs carry-forward AFTER we know the SO type.
      // Default to empty to avoid forcing old balance.
      resetProducedQty();
      void (async () => {
        const t = await ensureSoOrderType(l.salesOrderId);
        if (isCarryForwardLine(l, t) && !noQtyManualContinue) return;
        if (rem > 1e-9) setProducedQtyStr(fmtProdQty(rem));
      })();
    },
    [ensureSoOrderType, isCarryForwardLine, noQtyManualContinue, resetProducedQty, setProducedQtyStr],
  );

  useDependentFieldFocus({
    targetRef: producedQtyRef,
    enabled: Boolean(canProd && flatLines.length > 0 && wolId > 0),
    deps: [wolId],
  });

  const didInitialWoFocusRef = React.useRef(false);
  React.useEffect(() => {
    if (!canProd || flatLines.length === 0) {
      didInitialWoFocusRef.current = false;
      return;
    }
    if (didInitialWoFocusRef.current) return;
    didInitialWoFocusRef.current = true;
    const id = window.setTimeout(() => {
      woSelectRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [canProd, flatLines.length]);

  const selected = flatLines.find((l) => l.id === wolId);

  const createFormCanSubmit = Boolean(wolId > 0 && flatLines.some((l) => l.id === wolId) && producedQtyValid);

  const selectedMetrics = React.useMemo(() => {
    if (!selected) return null;
    const approved = selected.approvedProducedQty ?? 0;
    const remaining = lineRemaining(selected);
    return {
      woLineQty: Number(selected.qty),
      usedQty: approved,
      remainingQty: remaining,
    };
  }, [selected]);

  const visibleEntries = React.useMemo(() => {
    if (entryFilter === "ALL") return entries;
    if (entryFilter === "DRAFT") return entries.filter((e) => isDraft(e));
    return entries.filter((e) => isApproved(e));
  }, [entries, entryFilter]);

  const noQtyProductionStatusMsg = React.useMemo(() => {
    if (!fromNoQtySo || !focusSoIdValid) return "";
    // When opened from a No Qty SO, entries are already scoped by salesOrderId.
    // Never show "completed" when there are zero entries.
    if (!entries.length) return "No production started for this cycle";
    if (entries.some((e) => isDraft(e))) return "Production in progress";
    return "All production completed for this cycle";
  }, [fromNoQtySo, focusSoIdValid, entries]);

  const qcBannerSoId = React.useMemo(() => {
    const pending = entries.find((e) => qcPendingEntry(e));
    if (focusSoIdValid) return focusSoId;
    return pending?.workOrderLine.workOrder.salesOrderId ?? 0;
  }, [entries, focusSoId, focusSoIdValid]);

  const showQcNextBanner = React.useMemo(
    () => entries.some((e) => qcPendingEntry(e)) && qcBannerSoId > 0,
    [entries, qcBannerSoId],
  );

  const showQcCompletedStrip = React.useMemo(() => {
    if (!canProd) return false;
    if (!selected) return false;
    // Show "QC completed" only for the currently selected WO line (never previous cycles / other lines).
    const rows = entries.filter((e) => Number(e?.workOrderLine?.id ?? 0) === Number(selected.id));
    if (rows.length === 0) return false;
    if (!rows.some((e) => isApproved(e))) return false;
    return !rows.some((e) => qcPendingEntry(e));
  }, [canProd, selected, entries]);

  const qcBannerHref = React.useMemo(() => {
    if (qcBannerSoId <= 0) return "";
    if (fromNoQtySo && focusSoIdValid && noQtyFlowState?.cycleId != null) {
      return buildNoQtyGuidedHref({
        to: "/qc-entry",
        salesOrderId: qcBannerSoId,
        cycleId: noQtyFlowState.cycleId,
        fromStep: "production",
      });
    }
    return `/qc-entry?salesOrderId=${qcBannerSoId}`;
  }, [fromNoQtySo, focusSoIdValid, qcBannerSoId, noQtyFlowState?.cycleId]);

  const qcEntryHrefForEntry = React.useCallback(
    (r: ProdEntryRow) => {
      const soId = r.workOrderLine.workOrder.salesOrderId;
      if (fromNoQtySo && focusSoIdValid && noQtyFlowState?.cycleId != null) {
        return buildNoQtyGuidedHref({
          to: "/qc-entry",
          salesOrderId: soId,
          cycleId: noQtyFlowState.cycleId,
          fromStep: "production",
        });
      }
      return `/qc-entry?salesOrderId=${soId}`;
    },
    [fromNoQtySo, focusSoIdValid, noQtyFlowState?.cycleId],
  );

  const productionWarnings = React.useMemo(() => {
    if (!selectedMetrics) return [];
    const w: string[] = [];
    if (selectedMetrics.remainingQty <= 0) w.push("No remaining quantity on this line.");
    if (
      producedQtyValid &&
      producedQtyParsed != null &&
      selectedMetrics.remainingQty > 0 &&
      producedQtyParsed > selectedMetrics.remainingQty
    ) {
      w.push("Entered quantity exceeds remaining capacity.");
    }
    return w;
  }, [selectedMetrics, producedQtyParsed, producedQtyValid]);

  async function refresh(): Promise<FlatLine[]> {
    const includeWorkOrderLineId = editing?.workOrderLine?.id ?? 0;
    const includeQs = includeWorkOrderLineId > 0 ? `&includeWorkOrderLineId=${includeWorkOrderLineId}` : "";
    /** When `salesOrderId` is in the URL, scope pending WOs to that SO (regular + NO_QTY). */
    const soScopeQs = focusSoIdValid ? `&salesOrderId=${focusSoId}` : "";
    const [w, e] = await Promise.all([
      apiFetch<WoRow[]>(`/api/production/work-orders?pendingOnly=1${includeQs}${soScopeQs}`),
      apiFetch<ProdEntryRow[]>(
        `/api/production/production-entries${
          fromNoQtySo && focusSoIdValid
            ? `?salesOrderId=${focusSoId}${noQtyCycleId != null ? `&cycleId=${encodeURIComponent(String(noQtyCycleId))}` : ""}`
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
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NO_QTY: once cycleId is known, refetch entries scoped to that cycle.
  React.useEffect(() => {
    if (!fromNoQtySo || !focusSoIdValid) return;
    if (noQtyCycleId == null) return;
    refresh().catch(() => {
      /* refresh sets its own error */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromNoQtySo, focusSoIdValid, focusSoId, noQtyCycleId]);

  // When opened from NO_QTY SO, show a context-aware empty state if nothing is eligible.
  React.useEffect(() => {
    if (!fromNoQtySo || !focusSoIdValid) {
      setNoQtyEmptyMsg("");
      return;
    }
    if (!canProd) return;
    if (flatLines.length > 0) {
      setNoQtyEmptyMsg("");
      return;
    }
    apiFetch<{ reason: string; message: string }>(`/api/production/no-qty-so/${focusSoId}/production-context`)
      .then((ctx) => setNoQtyEmptyMsg(ctx?.message ?? ""))
      .catch(() => setNoQtyEmptyMsg(""));
  }, [fromNoQtySo, focusSoId, focusSoIdValid, canProd, flatLines.length]);

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

  // Keep UI consistent with backend eligibility filtering (especially NO_QTY cycle rules).
  // If previously selected WO is no longer present, clear selection and hide the entry form.
  React.useEffect(() => {
    if (woId !== 0 && !workOrders.some((w) => w.id === woId)) {
      setWoId(0);
      setWolId(0);
      resetProducedQty();
      setError(null);
    }
  }, [workOrders, woId, resetProducedQty]);

  React.useEffect(() => {
    if (wolId === 0) return;
    if (!flatLines.some((l) => l.id === wolId)) {
      setWolId(0);
      setWoId(0);
    }
  }, [flatLines, wolId]);

  React.useEffect(() => {
    if (!canProd || flatLines.length === 0 || wolId !== 0) return;
    if (fromNoQtySo && focusSoIdValid) {
      if (noQtyAutoPickLines.length > 0) {
        applyLine(noQtyAutoPickLines[0]);
        return;
      }
      // NO_QTY: if nothing is genuinely ready to produce now, keep unselected (carry-forward is handled in next RC).
      setWoId(0);
      setWolId(0);
      resetProducedQty();
      return;
    }
    // Regular flow: default WO/line — URL woId, else latest WO (highest id), else best line globally.
    if (woIdFromUrlValid && workOrders.some((w) => w.id === woIdFromUrl)) {
      const forWo = sortFlatByPriority(flatLines.filter((l) => l.workOrderId === woIdFromUrl));
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
    fromNoQtySo,
    focusSoIdValid,
    focusSoId,
    workOrders,
    woIdFromUrlValid,
    woIdFromUrl,
    resetProducedQty,
    noQtyAutoPickLines,
    ensureSoOrderType,
    isCarryForwardLine,
  ]);

  React.useEffect(() => {
    if (!(fromNoQtySo && focusSoIdValid)) return;
    setNoQtyManualContinue(false);
  }, [fromNoQtySo, focusSoIdValid, wolId]);

  React.useEffect(() => {
    const l = flatLines.find((x) => x.id === wolId);
    if (l) setWoId(l.workOrderId);
  }, [wolId, flatLines]);

  function advanceAfterSave(flat: FlatLine[], prevWolId: number) {
    const sorted = sortFlatByPriority(flat);
    if (sorted.length === 0) {
      setWoId(0);
      setWolId(0);
      resetProducedQty();
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
    if (!wolId || !flatLines.some((l) => l.id === wolId)) {
      setError("Select a work order line.");
      return;
    }
    if (!producedQtyValid || producedQtyParsed == null) {
      setError("Enter produced quantity.");
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
      resetProducedQty();
      const nextFlat = await refresh();
      // NO_QTY: do not auto-advance / push operators to complete production.
      // Keep the current selection stable; partial production is a valid state.
      if (!(fromNoQtySo && focusSoIdValid)) {
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

  async function approveDraft(id: number) {
    if (!window.confirm("Approve this batch? Raw material stock will be issued and the batch will move to QC.")) return;
    setError(null);
    setRowBusy(id);
    try {
      await apiFetch(`/api/production/production-entries/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setEditing(null);
      await refresh();
      if (fromNoQtySo && focusSoIdValid) toast.showSuccess("Production approved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setRowBusy(null);
    }
  }

  function openReverseModal(entry: ProdEntryRow) {
    if (!canOfferProductionReverse(entry, isAdmin)) return;
    const safe = reversibleProductionQty(entry);
    setReverseModalEntry(entry);
    setReverseQtyDraft(fmtProdQty(safe));
    setReverseReasonDraft("");
    setReversePasswordDraft("");
    setReverseModalError(null);
  }

  function closeReverseModal() {
    setReverseModalEntry(null);
    setReverseQtyDraft("");
    setReverseReasonDraft("");
    setReversePasswordDraft("");
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
    const pw = reversePasswordDraft.trim();
    if (!pw) {
      setReverseModalError("Admin password is required.");
      return;
    }
    const produced = Number(reverseModalEntry.producedQty);
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
      // TODO: Backend must validate admin password and reverse qty before allowing partial reversal.
      // Not sent (server schema is `{ reason }` only). `password` and `reverseQty` are client-side gates until API extends.
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
        resetProducedQty();
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
        resetProducedQty();
      }
    },
  });

  const prodQtyBind = shortcutHints.bindField("prodQty", {
    onChange: (e) => setProducedQtyStr((e.target as HTMLInputElement).value),
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

  const main = (
    <OperatorPageBody
      className={cn(
        canProd && flatLines.length > 0 && "pb-[5.5rem] sm:pb-20",
        "gap-2",
      )}
    >
      {fromNoQtySo ? (
        <div className="mb-1">
          <DemoFlowBanner />
        </div>
      ) : null}

      {error ? <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[13px] text-red-800">{error}</div> : null}
      <DemoSafeNoQtyContinue
        visible={showDemoNoQtyProdContinue}
        body="Demo mode: No production is saved in Safe Demo. Continue the tour without posting real batches."
        actionLabel="Continue Demo → QC"
      />
      <NextStepStrip
        visible={Boolean(showQcNextBanner && qcBannerHref)}
        variant="action"
        title="Next Step: Send items to Quality Check"
        subtitle="Production is approved. QC is pending."
        primaryAction={{
          label: "Go to QC",
          onClick: () => navigate(qcBannerHref),
        }}
      />
      <NextStepStrip
        visible={!showQcNextBanner && showQcCompletedStrip}
        variant="success"
        title="QC already completed for current production"
      />
      {fromNoQtySo && focusSoIdValid ? (
        <div className="grid items-start gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
          <NoQtyFlowStepsCard
            currentStage="PRODUCTION"
            cycleStatus={focusSo?.cycleStatus ?? "Active Cycle"}
          />
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
                {(() => {
                  const eps = 1e-6;
                  if (!selectedMetrics) return null;
                  const planned = selectedMetrics.woLineQty;
                  const produced = selectedMetrics.usedQty;
                  const remaining = selectedMetrics.remainingQty;
                  const statusText = produced <= eps ? "Production not started" : "Production in progress";

                  // Button visibility rules (NO_QTY primary CTAs)
                  const showStartOrContinue = planned > 0 && produced < planned - eps;
                  const showMoveToQc = produced > eps;
                  // Hide plan-next-cycle from main screen (requested).

                  const cycleId = noQtyFlowState?.cycleId ?? null;
                  const qcHref = buildNoQtyGuidedHref({
                    to: "/qc-entry",
                    salesOrderId: focusSoId,
                    cycleId,
                    fromStep: "production",
                  });

                  return (
                    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-slate-900">{statusText}</div>
                          <div className="mt-0.5 text-[12px] text-slate-600">
                            Produced {fmtProdQty(produced)} of {fmtProdQty(planned)} · Remaining {fmtProdQty(remaining)}
                          </div>
                          <div className="mt-1 text-[12px] text-slate-600">
                            {produced <= eps ? "Start production for this item." : "Continue production or move the produced qty to QC."}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {showStartOrContinue ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 text-[12px] font-semibold"
                              onClick={() => {
                                window.setTimeout(() => producedQtyRef.current?.focus(), 0);
                              }}
                            >
                              {produced <= eps ? "Start Production" : "Continue Production"}
                            </Button>
                          ) : null}
                          {showMoveToQc ? (
                            <Button
                              type="button"
                              size="sm"
                              variant={showStartOrContinue ? "outline" : "default"}
                              className="h-8 text-[12px] font-semibold"
                              onClick={() => navigate(qcHref)}
                            >
                              Move to QC
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <form ref={createFormRef} onSubmit={onPost} className="flex flex-col gap-3">
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
                            WO #{w.id} · SO #{w.salesOrderId}
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
                              {l.fgItem.itemName} · balance {fmtProdQty(rem)}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </FieldShortcutHint>
                  {selected && selectedMetrics ? (
                    <div className="flex flex-wrap items-stretch gap-1">
                      <OperatorMetricBadge label="Planned qty" value={fmtProdQty(selectedMetrics.woLineQty)} />
                      <OperatorMetricBadge label="Produced qty" value={fmtProdQty(selectedMetrics.usedQty)} />
                      <OperatorMetricBadge label="Remaining qty" value={fmtProdQty(selectedMetrics.remainingQty)} />
                    </div>
                  ) : null}
                </OperatorTopBar>

                <div className="grid gap-3 lg:grid-cols-[45%_55%]">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-col gap-2">
                      {(() => {
                        const eps = 1e-6;
                        const forSo = sortFlatByPriority(sortedFlatLines.filter((l) => l.salesOrderId === focusSoId));
                        const qcPending = forSo.filter((l) => (noQtyQcPendingByWolId.get(l.id) ?? 0) > eps);
                        const carry = forSo.filter((l) => {
                          const produced = l.approvedProducedQty ?? 0;
                          const pending = noQtyQcPendingByWolId.get(l.id) ?? 0;
                          const rem = lineRemaining(l);
                          return produced > eps && pending <= eps && rem > eps && noQtyHasApprovedByWolId.has(l.id);
                        });
                        const ready = forSo.filter((l) => {
                          const rem = lineRemaining(l);
                          if (!(rem > eps)) return false;
                          const produced = l.approvedProducedQty ?? 0;
                          const pending = noQtyQcPendingByWolId.get(l.id) ?? 0;
                          const carryForward = produced > eps && pending <= eps && noQtyHasApprovedByWolId.has(l.id);
                          return !carryForward && pending <= eps;
                        });

                        const Section = ({
                          title,
                          subtitle,
                          rows,
                          balanceLabel,
                        }: {
                          title: string;
                          subtitle: string;
                          rows: FlatLine[];
                          balanceLabel: string;
                        }) =>
                          rows.length === 0 ? null : (
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
                                <span className="text-[11px] text-slate-400">{subtitle}</span>
                              </div>
                              <div className="max-h-[min(30vh,220px)] overflow-auto rounded border border-slate-200 bg-white">
                                <table className="w-full text-[12px]">
                                  <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                                    <tr className="text-left text-[11px] text-slate-600">
                                      <th className="px-2 py-0.5 font-medium">WO</th>
                                      <th className="px-2 py-0.5 font-medium">Item</th>
                                      <th className="px-2 py-0.5 text-right font-medium">Planned</th>
                                      <th className="px-2 py-0.5 text-right font-medium">Produced</th>
                                      <th className="px-2 py-0.5 text-right font-medium">{balanceLabel}</th>
                                      <th className="w-10 px-1 py-0.5 text-right font-medium">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((l) => {
                                      const approved = l.approvedProducedQty ?? 0;
                                      const rem = lineRemaining(l);
                                      const sel = wolId === l.id;
                                      return (
                                        <tr key={l.id} className={cn("border-t border-slate-100 py-0.5", sel && "bg-emerald-50")}>
                                          <td className="px-2 py-0.5 tabular-nums">#{l.workOrderId}</td>
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
                          );

                        return (
                          <div className="space-y-2">
                            <Section
                              title="Ready to produce"
                              subtitle="▶ selects row · Optional"
                              rows={ready}
                              balanceLabel="Balance"
                            />
                            <Section
                              title="Produced / QC pending"
                              subtitle="Finish QC before dispatch"
                              rows={qcPending}
                              balanceLabel="Balance"
                            />
                            {ready.length === 0 && qcPending.length === 0 ? (
                              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 text-[12px] text-slate-700">
                                No production required right now for this cycle.
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="space-y-3">
                      {(() => {
                        if (!selected) return <div className="text-[12px] font-semibold tracking-tight text-slate-700">Log production</div>;
                        const eps = 1e-6;
                        const rem = lineRemaining(selected);
                        const produced = selected.approvedProducedQty ?? 0;
                        const pending = noQtyQcPendingByWolId.get(selected.id) ?? 0;
                        const needsDecision = produced > eps && rem > eps && noQtyHasApprovedByWolId.has(selected.id);
                        if (!needsDecision || noQtyManualContinue) {
                          return <div className="text-[12px] font-semibold tracking-tight text-slate-700">Log production</div>;
                        }

                        const cycleId = noQtyFlowState?.cycleId ?? null;
                        const nextRsHref = buildNoQtyGuidedHref({
                          to: `/sales-orders/${focusSoId}/requirement-sheets?intent=add&source=no_qty_so`,
                          salesOrderId: focusSoId,
                          cycleId,
                          fromStep: "production",
                        });
                        const qcHref = buildNoQtyGuidedHref({
                          to: "/qc-entry",
                          salesOrderId: focusSoId,
                          cycleId,
                          fromStep: "production",
                        });
                        const dispatchHref = buildNoQtyGuidedHref({
                          to: "/dispatch",
                          salesOrderId: focusSoId,
                          cycleId,
                          fromStep: "production",
                        });

                        return (
                          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-800">
                            <div className="font-semibold text-slate-900">Next action</div>
                            <div className="mt-1 grid gap-1 text-slate-700">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Produced qty</span>
                                <span className="font-semibold tabular-nums text-slate-900">{fmtProdQty(produced)}</span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Remaining qty</span>
                                <span className="font-semibold tabular-nums text-slate-900">{fmtProdQty(rem)}</span>
                              </div>
                              {pending > eps ? (
                                <div className="text-[11px] text-amber-900">
                                  QC is pending for some produced qty. You can move to QC now.
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  setNoQtyManualContinue(true);
                                  window.setTimeout(() => producedQtyRef.current?.focus(), 0);
                                }}
                              >
                                {produced <= eps ? "Start Production" : "Continue Production"}
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => navigate(qcHref)}>
                                Move to QC
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                      {selected ? (
                        <p className="text-[12px] text-slate-600">
                          <span className="font-medium text-slate-800">{selected.fgItem.itemName}</span>
                          <span className="text-slate-400"> · </span>
                          SO #{selected.salesOrderId}
                          <span className="text-slate-400"> · </span>
                          WO #{selected.workOrderId}
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
                            <div className="text-[11px] font-medium text-slate-600">Remaining</div>
                            <div className="font-semibold tabular-nums text-slate-900">{fmtProdQty(selectedMetrics.remainingQty)}</div>
                          </div>
                        </div>
                      ) : null}
                      {(() => {
                        if (!selected) return null;
                        const eps = 1e-6;
                        const rem = lineRemaining(selected);
                        const produced = selected.approvedProducedQty ?? 0;
                        const pending = noQtyQcPendingByWolId.get(selected.id) ?? 0;
                        const needsDecision = produced > eps && rem > eps && noQtyHasApprovedByWolId.has(selected.id);
                        if (needsDecision && !noQtyManualContinue) return null;

                        return (
                          <>
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
                                      Remaining allowed:{" "}
                                      <span className="font-medium tabular-nums text-slate-700">
                                        {fmtProdQty(selectedMetrics.remainingQty)}
                                      </span>
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
                                onClick={() => setProducedQtyStr(fmtProdQty(selectedMetrics?.remainingQty ?? 0))}
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
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                </form>
              </>
            )}

            <NoQtyCycleSummaryCard
              className="mt-3"
              soId={focusSoId}
              soDocNo={focusSo?.docNo ?? null}
              customerName={focusSo?.customerName ?? "—"}
              cycleNo={focusSo?.cycleNo ?? null}
              cycleStatus={focusSo?.cycleStatus ?? "Active Cycle"}
              currentStage="PRODUCTION"
              nextStep={(() => {
                if (focusSo?.cycleStatus === "Closed Cycle") return "Cycle Closed";
                if (!entries.length) return "Start Production";
                if (entries.some((e) => isDraft(e))) return "Continue Production";
                return "Complete QC";
              })()}
              metrics={[]}
              showSteps={false}
            />
          </div>
        </div>
      ) : !canProd ? (
        <p className="text-[13px] text-slate-600">Production / Admin only.</p>
      ) : !flatLines.length ? (
        <>
          {fromNoQtySo && focusSoIdValid ? (
            <p className="text-xs leading-snug text-slate-600">
              {noQtyProductionStatusMsg ||
                noQtyEmptyMsg ||
                (focusSo ? `No eligible work orders · ${focusSo.customerName}` : "No eligible work orders")}
            </p>
          ) : workOrders.length === 0 ? (
            <p className="text-xs leading-snug text-slate-600">
              No work orders available. Create a work order to start production.
            </p>
          ) : null}
        </>
      ) : (
        <form ref={createFormRef} onSubmit={onPost} className={cn("flex flex-col", !fromNoQtySo ? "gap-2" : "gap-3")}>
          {!fromNoQtySo ? (
            <>
              <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-3 py-2">
                  <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Add Production Entry</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 px-3 py-2">
                  <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2">
                    <FieldShortcutHint
                      show={shortcutHints.activeFieldId === "prodWo"}
                      hint={shortcutHints.activeFieldHintText ?? ""}
                      placement="below"
                      className="min-w-[10rem] max-w-[22rem] flex-[1_1_14rem]"
                    >
                      <div className="grid w-full gap-1">
                        <span className="text-[11px] font-medium text-slate-600">Work order</span>
                        <select
                          ref={woSelectRef}
                          {...prodWoBind}
                          className="erp-flow-filter-input h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2.5 text-sm"
                          value={woId === 0 ? "" : String(woId)}
                        >
                          <option value="">Select…</option>
                          {workOrders.map((w) => (
                            <option key={w.id} value={w.id}>
                              WO #{w.id} · SO #{w.salesOrderId}
                            </option>
                          ))}
                        </select>
                      </div>
                    </FieldShortcutHint>
                    <FieldShortcutHint
                      show={shortcutHints.activeFieldId === "prodLine"}
                      hint={shortcutHints.activeFieldHintText ?? ""}
                      placement="below"
                      className="min-w-[12rem] flex-[1_1_18rem]"
                    >
                      <div className="grid w-full gap-1">
                        <span className="text-[11px] font-medium text-slate-600">Item</span>
                        <select
                          ref={lineSelectRef}
                          {...prodLineBind}
                          className="erp-flow-filter-input h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2.5 text-sm"
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
                                {l.fgItem.itemName} · balance {fmtProdQty(rem)}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </FieldShortcutHint>
                    <div className="grid w-full min-w-[9.5rem] shrink-0 gap-1 sm:w-[10.5rem]">
                      <span className="text-[11px] font-medium text-slate-600">Date</span>
                      <Input
                        type="date"
                        className="erp-flow-filter-input h-9 w-full tabular-nums text-sm"
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
                      <div className="grid gap-1">
                        <span className="text-[11px] font-medium text-slate-600">Qty</span>
                        <Input
                          ref={producedQtyRef}
                          {...prodQtyBind}
                          type="text"
                          data-testid="production-qty-input"
                          inputMode="decimal"
                          autoComplete="off"
                          className="erp-flow-filter-input h-9 tabular-nums text-sm font-semibold"
                          placeholder="0"
                          value={producedQtyStr}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                              shortcutHints.markFieldShortcutUsed("prodQty");
                            }
                          }}
                        />
                        {wolId > 0 && !producedQtyValid ? (
                          <p className="text-[11px] font-medium text-amber-800">Enter quantity.</p>
                        ) : null}
                      </div>
                    </FieldShortcutHint>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 shrink-0 px-3 text-xs"
                      disabled={posting || !selectedMetrics || selectedMetrics.remainingQty <= 0}
                      onClick={() => setProducedQtyStr(fmtProdQty(selectedMetrics?.remainingQty ?? 0))}
                    >
                      Use full
                    </Button>
                    <FieldShortcutHint
                      show={shortcutHints.activeFieldId === "prodSave"}
                      hint={shortcutHints.activeFieldHintText ?? ""}
                      placement="above"
                      className="inline-block shrink-0"
                    >
                      <div className="grid gap-1">
                        <span className="text-[11px] font-medium text-transparent select-none" aria-hidden>
                          ·
                        </span>
                        <Button
                          type="submit"
                          data-testid="save-production-btn"
                          className="h-9 px-4 text-sm font-semibold"
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
                    <ul className="space-y-0.5 text-[11px] font-medium text-amber-900">
                      {productionWarnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>

              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Work queue</h3>
                  <span className="text-[10px] text-slate-400">▶ selects row</span>
                </div>
                <div className="max-h-[min(32vh,220px)] overflow-auto rounded-md border border-slate-200 bg-white">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                      <tr className="text-left text-[11px] text-slate-600">
                        <th className="px-2 py-1 font-medium">WO</th>
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
                              "border-t border-slate-100 transition-colors hover:bg-slate-50/90",
                              sel && "bg-emerald-50/90 ring-1 ring-inset ring-emerald-200/80",
                            )}
                          >
                            <td className="px-2 py-1 tabular-nums">#{l.workOrderId}</td>
                            <td className="max-w-[11rem] truncate px-2 py-1 font-medium" title={l.fgItem.itemName}>
                              {l.fgItem.itemName}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmtProdQty(Number(l.qty))}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmtProdQty(approved)}</td>
                            <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtProdQty(rem)}</td>
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
                          WO #{w.id} · SO #{w.salesOrderId}
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
                            {l.fgItem.itemName} · balance {fmtProdQty(rem)}
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
                    <OperatorMetricBadge label="Remaining qty" value={fmtProdQty(selectedMetrics.remainingQty)} />
                  </div>
                ) : null}
              </OperatorTopBar>

              <div className="grid gap-3 lg:grid-cols-[45%_55%]">
                <div className="min-w-0">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                        {focusSoIdValid ? "Current cycle work" : "Work queue"}
                      </h3>
                      <span className="text-[11px] text-slate-400">▶ selects row{focusSoIdValid ? " · This SO/cycle" : ""}</span>
                    </div>
                    <div className="max-h-[min(38vh,280px)] overflow-auto rounded border border-slate-200 bg-white">
                      <table className="w-full text-[12px]">
                        <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                          <tr className="text-left text-[11px] text-slate-600">
                            <th className="px-2 py-0.5 font-medium">WO</th>
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
                                <td className="px-2 py-0.5 tabular-nums">#{l.workOrderId}</td>
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
                    <div className="text-[12px] font-semibold tracking-tight text-slate-700">Log production</div>
                    {fromNoQtySo && selected ? (
                      <p className="text-[12px] text-slate-600">
                        <span className="font-medium text-slate-800">{selected.fgItem.itemName}</span>
                        <span className="text-slate-400"> · </span>
                        SO #{selected.salesOrderId}
                        <span className="text-slate-400"> · </span>
                        WO #{selected.workOrderId}
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
                          <div className="text-[11px] font-medium text-slate-600">Remaining</div>
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
                              Remaining allowed:{" "}
                              <span className="font-medium tabular-nums text-slate-700">
                                {fmtProdQty(selectedMetrics.remainingQty)}
                              </span>
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
                        onClick={() => setProducedQtyStr(fmtProdQty(selectedMetrics?.remainingQty ?? 0))}
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

      {(() => {
        if (!selected) return null;
        if (!canProd) return null;
        const woId = Number(selected.workOrderId);
        if (!Number.isFinite(woId) || woId <= 0) return null;
        const draftsForWo = (visibleEntries || []).filter(
          (e) => isDraft(e) && Number(e?.workOrderLine?.workOrder?.id ?? 0) === woId,
        );
        if (!draftsForWo.length) return null;
        // Prefer latest draft entry for quick actions.
        const latest = draftsForWo
          .slice()
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        const qty = Number(latest?.producedQty ?? 0);
        const producedQty = Number.isFinite(qty) ? qty : 0;

        return (
          <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">Draft Production Ready</div>
                <div className="mt-0.5 text-[11px] text-amber-900/90">
                  Produced qty: <span className="font-semibold tabular-nums">{fmtProdQty(producedQty)}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={rowBusy === latest.id}
                  onClick={() => approveDraft(latest.id)}
                >
                  {rowBusy === latest.id ? "…" : "Approve"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={rowBusy === latest.id}
                  onClick={() => openEdit(latest)}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={rowBusy === latest.id}
                  onClick={() => deleteDraft(latest.id)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      <Card className={cn("min-w-0 overflow-hidden border-slate-200 shadow-sm", !fromNoQtySo && flatLines.length > 0 && "mt-1.5")}>
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-3 py-2">
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Production Entries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-3 py-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Show
              <select
                className="erp-flow-filter-input h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm"
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
              fromNoQtySo && focusSoIdValid && noQtyCycleId != null
                ? visibleEntries.filter((r) => Number((r as any)?.workOrderLine?.workOrder?.cycleId ?? 0) === Number(noQtyCycleId))
                : visibleEntries;
            const older =
              fromNoQtySo && focusSoIdValid && noQtyCycleId != null
                ? visibleEntries.filter((r) => Number((r as any)?.workOrderLine?.workOrder?.cycleId ?? 0) !== Number(noQtyCycleId))
                : [];

            const table = (rowsToShow: ProdEntryRow[]) =>
              !rowsToShow.length ? (
                <p className="text-xs leading-snug text-slate-600">
                  {workOrders.length === 0 ? "Create a work order to begin production." : "No production entries yet."}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="table-fixed w-full min-w-[800px] border-collapse text-[12px]">
                    <colgroup>
                      <col className="w-[110px]" />
                      <col className="w-[70px]" />
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
                        <th className="px-1 py-1 text-center font-medium">WO</th>
                        <th className="px-1 py-1 text-center font-medium">SO</th>
                        <th className="min-w-0 px-2 py-1 text-left font-medium">Item</th>
                        <th className="px-1 py-1 text-center font-medium">SO Type</th>
                        <th className="px-2 py-1 text-right font-medium">Produced</th>
                        <th className="px-1 py-1 text-center font-medium">Status</th>
                        <th className="px-1 py-1 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowsToShow.map((r, idx) => (
                        <tr
                          key={r.id}
                          className={cn(
                            "border-b border-slate-100 transition-colors hover:bg-slate-50/90",
                            idx === 0 && isDraft(r) && "bg-amber-50/60",
                          )}
                        >
                          <td className="whitespace-nowrap px-2 py-1 align-middle tabular-nums text-slate-700">
                            {new Date(r.date).toLocaleDateString()}
                          </td>
                          <td className="px-1 py-1 text-center align-middle tabular-nums text-[12px] text-slate-800">
                            #{r.workOrderLine.workOrder.id}
                          </td>
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
                              <div className="flex flex-wrap justify-end gap-1">
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
                                  {rowBusy === r.id ? "…" : "Approve"}
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
                            ) : isApproved(r) && qcPendingEntry(r) ? (
                              <div className="flex flex-col items-end gap-1">
                                <Link
                                  to={qcEntryHrefForEntry(r)}
                                  className={cn(
                                    buttonVariants({ variant: "secondary", size: "sm" }),
                                    "inline-flex h-7 max-w-[70px] items-center justify-center px-1.5 text-[10px]",
                                  )}
                                >
                                  Go to QC
                                </Link>
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

            return (
              <div className="space-y-2">
                {fromNoQtySo && focusSoIdValid ? (
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Current cycle work</div>
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

          {editing && canProd ? (
            <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2">
              <div className="mb-2 text-[13px] font-medium text-slate-800">Edit draft #{editing.id}</div>
              <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
                <label className="grid gap-1 text-[12px]">
                  <span className="text-slate-600">Date</span>
                  <Input className={operatorInputClass} type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
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
                  <Button type="button" size="sm" className="h-8 text-[13px]" onClick={saveEditDraft} disabled={editSaving}>
                    {editSaving ? "Saving…" : "Save changes"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="h-8 text-[13px]" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {reverseModalEntry && isAdmin ? (
        <div
          className="erp-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prod-admin-reverse-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeReverseModal();
          }}
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200/90 bg-white p-4 shadow-xl sm:p-5">
            <h2 id="prod-admin-reverse-title" className="text-base font-semibold leading-snug text-slate-900">
              Admin Approval Required
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
                      <div className="min-w-0">
                        <span className="text-[11px] font-medium text-slate-500">WO #</span>
                        <div className="font-mono text-[13px] font-semibold text-slate-900">
                          #{reverseModalEntry.workOrderLine.workOrder.id}
                        </div>
                      </div>
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
                    <label className="text-[11px] font-medium text-slate-600" htmlFor="prod-admin-reverse-pw">
                      Admin password <span className="font-normal text-slate-500">(required)</span>
                    </label>
                    <Input
                      id="prod-admin-reverse-pw"
                      type="password"
                      autoComplete="current-password"
                      className="h-9 text-sm"
                      value={reversePasswordDraft}
                      onChange={(e) => {
                        setReversePasswordDraft(e.target.value);
                        setReverseModalError(null);
                      }}
                    />
                    <p className="text-[10px] leading-snug text-slate-500">
                      Password is not verified by the server until backend support is added (see API TODO).
                    </p>
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
        </div>
      ) : null}

      {canProd ? <ShortcutHintBar items={PRODUCTION_SHORTCUT_BAR} /> : null}
    </OperatorPageBody>
  );

  if (!fromNoQtySo) {
    return (
      <PageContainer className="erp-flow-page -mt-2 space-y-2.5 pb-6">
        <StickyWorkspaceHead
          lead={
            <>
              <DemoFlowBanner />
              <PageSmartBackLink defaultTo="/work-orders" defaultLabel="Back to Work Order" />
            </>
          }
        >
          <div className="min-w-0 space-y-0.5">
            <h1 className="text-base font-semibold leading-tight tracking-tight text-slate-900">Production</h1>
            <p className="text-xs leading-snug text-slate-600">Record production output and track progress.</p>
          </div>
        </StickyWorkspaceHead>
        {main}
      </PageContainer>
    );
  }
  return (
    <PageContainer className="erp-flow-page -mt-2 space-y-2.5 pb-[5.5rem] sm:pb-20">
      <StickyWorkspaceHead lead={<PageNoQtyFlowBackLink step="PRODUCTION" />}>
        <div className="min-w-0 space-y-0.5">
          <h1 className="text-base font-semibold leading-tight tracking-tight text-slate-900">Production</h1>
          <p className="text-xs leading-snug text-slate-600">Record production output and track progress.</p>
        </div>
        {focusSoIdValid ? (
          <p className="mt-1 text-[12px] leading-tight text-slate-600">
            SO <span className="font-semibold tabular-nums text-slate-800">#{focusSoId}</span>
            {focusSo?.docNo ? (
              <>
                <span className="text-slate-400"> · </span>
                <span className="font-medium text-slate-800">{focusSo.docNo}</span>
              </>
            ) : null}
            {focusSo?.customerName ? (
              <>
                <span className="text-slate-400"> · </span>
                {focusSo.customerName}
              </>
            ) : null}
            <span className="text-slate-400"> · </span>
            {workOrders.length} WO · {flatLines.length} line{flatLines.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </StickyWorkspaceHead>
      {main}
    </PageContainer>
  );
}
