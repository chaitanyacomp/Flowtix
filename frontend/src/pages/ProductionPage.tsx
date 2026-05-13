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
import {
  OperatorMetricBadge,
  OperatorPageBody,
  OperatorTopBar,
  operatorInputClass,
} from "../components/erp/OperatorWorkbench";
import { cn } from "../lib/utils";
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
import { OperationalContextBar, OperationalContextSticky, OpCtxSep } from "../components/erp/OperationalWorkspaceChrome";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { buildNoQtyGuidedHref, buildQcEntryHref, useNoQtyFlowState } from "../lib/noQtyFlowState";
import { useToast } from "../contexts/ToastContext";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { DemoSafeNoQtyContinue } from "../components/demo/DemoSafeNoQtyContinue";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";
import { displaySalesOrderNo } from "../lib/docNoDisplay";

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
  cycleId?: number | null;
  cycle?: { cycleNo?: number | null } | null;
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

  const [workOrders, setWorkOrders] = React.useState<WoRow[]>([]);
  const [entries, setEntries] = React.useState<ProdEntryRow[]>([]);
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
   * Enables NO_QTY flow API + cycle-aware links + NO_QTY render branch.
   *
   * Sources, in priority:
   *   1. URL signal `source=no_qty_so` (explicit; existing primary path).
   *   2. SO master orderType resolved to NO_QTY via `?salesOrderId=` (existing recovery).
   *   3. NEW: linked WO from `?workOrderId=` resolves to a NO_QTY SO.
   *   4. NEW: any loaded entry's API-provided orderType is "NO_QTY".
   *
   * Fail-closed: only flips to true when an actual orderType === "NO_QTY" is observed; never
   * inferred from labels or partial UI state. REGULAR flow is never hijacked because a REGULAR
   * SO's master/entry rows will never carry orderType "NO_QTY".
   */
  const navigateNoQtyContext =
    (focusSoIdValid &&
      (fromNoQtySo || String(soOrderTypeById[focusSoId] ?? "") === "NO_QTY")) ||
    noQtyRecoveryFromSelectedWo ||
    noQtyRecoveryFromEntries;

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
    if (navigateNoQtyContext) return false;

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
    navigateNoQtyContext,
    focusSoIdValid,
    focusSoId,
    soOrderTypeById,
    woIdFromUrlValid,
    woIdFromUrlPick,
    workOrders,
    initialRefreshDone,
  ]);

  const { state: noQtyFlowState } = useNoQtyFlowState(
    focusSoIdValid ? focusSoId : null,
    navigateNoQtyContext,
  );
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

  const effectiveNoQtyCycleId = React.useMemo(() => {
    if (!navigateNoQtyContext || !focusSoIdValid) return null;
    return cycleIdFromUrl ?? noQtyFlowState?.cycleId ?? focusSo?.currentCycleId ?? null;
  }, [navigateNoQtyContext, focusSoIdValid, cycleIdFromUrl, noQtyFlowState?.cycleId, focusSo?.currentCycleId]);
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
  const [reverseModalError, setReverseModalError] = React.useState<string | null>(null);
  const [entryFilter, setEntryFilter] = React.useState<"ALL" | "DRAFT" | "APPROVED">("ALL");
  const [noQtyRmShortage, setNoQtyRmShortage] = React.useState<NoQtyRmShortagePayload | null>(null);
  const [noQtyManualContinue, setNoQtyManualContinue] = React.useState(false);

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
      if (ev.key === "Escape" && kbHelpOpen) setKbHelpOpen(false);
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

  /** NO_QTY scoped production UI (includes orders detected via API when URL omits `source=no_qty_so`). */
  const showNoQtyScopedProductionCard = navigateNoQtyContext && focusSoIdValid;

  /** WO lines: planned remainder is Last shortage Qty (next RS), not work queue “balance” pending production. */
  const noQtyCarryForwardLines = React.useMemo(() => {
    if (!showNoQtyScopedProductionCard) return [];
    return sortedFlatLines
      .filter((l) => l.salesOrderId === focusSoId)
      .filter((l) => isCarryForwardLine(l, "NO_QTY"));
  }, [showNoQtyScopedProductionCard, sortedFlatLines, focusSoId, isCarryForwardLine]);

  const noQtyAutoPickLines = React.useMemo(() => {
    if (!showNoQtyScopedProductionCard) return [];
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
  }, [
    flatLines,
    focusSoId,
    showNoQtyScopedProductionCard,
    noQtyHasApprovedByWolId,
    noQtyQcPendingByWolId,
  ]);

  /**
   * NO_QTY: hide Add Production Entry (WO/item/qty/save) when approved batches exist and no line is in the
   * “ready to produce” bucket — next step is QC, dispatch, or carry-forward remainder only.
   */
  const hideNoQtyAddProductionEntry = React.useMemo(() => {
    if (!navigateNoQtyContext || noQtyManualContinue || !showNoQtyScopedProductionCard) return false;
    const approvedForSo = entries.some(
      (e) =>
        isApproved(e) && Number(e.workOrderLine?.workOrder?.salesOrderId ?? 0) === focusSoId,
    );
    if (!approvedForSo) return false;
    return noQtyAutoPickLines.length === 0;
  }, [
    navigateNoQtyContext,
    noQtyManualContinue,
    showNoQtyScopedProductionCard,
    entries,
    focusSoId,
    noQtyAutoPickLines.length,
  ]);

  const linesForWo = React.useMemo(() => workOrders.find((w) => w.id === woId)?.lines ?? [], [workOrders, woId]);

  /** Hide carry-forward WO lines from the production entry dropdown unless operator opts in. */
  const linesForNoQtyEntryForm = React.useMemo(() => {
    if (!navigateNoQtyContext || noQtyManualContinue) return linesForWo;
    const soId = workOrders.find((w) => w.id === woId)?.salesOrderId ?? 0;
    return linesForWo.filter((l) => {
      const fl: FlatLine = { ...l, workOrderId: woId, salesOrderId: soId };
      return !isCarryForwardLine(fl, "NO_QTY");
    });
  }, [navigateNoQtyContext, noQtyManualContinue, linesForWo, workOrders, woId, isCarryForwardLine]);

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
    return w;
  }, [fromNoQtySo, selectedMetrics, producedQtyParsed, producedQtyValid]);

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
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setInitialRefreshDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NO_QTY: once cycleId is known (flow API or URL), refetch entries scoped to that cycle.
  React.useEffect(() => {
    if (!navigateNoQtyContext || !focusSoIdValid) return;
    if (effectiveNoQtyCycleId == null) return;
    refresh().catch(() => {
      /* refresh sets its own error */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateNoQtyContext, focusSoIdValid, focusSoId, effectiveNoQtyCycleId, focusSo?.currentCycleId]);

  // When scoped to a NO_QTY SO, show a context-aware empty state if nothing is eligible.
  React.useEffect(() => {
    if (!navigateNoQtyContext || !focusSoIdValid) {
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
  }, [navigateNoQtyContext, focusSoId, focusSoIdValid, canProd, flatLines.length]);

  // Load SO header for NO_QTY guided production (URL may omit `source=no_qty_so` until order type is resolved).
  React.useEffect(() => {
    if (!navigateNoQtyContext || !focusSoIdValid) {
      setFocusSo(null);
      return;
    }
    apiFetch<any>(`/api/sales-orders/${focusSoId}`)
      .then((so) => {
        const customerName = so?.customer?.name ?? so?.po?.customer?.name ?? "—";
        const cycleNo = so?.currentCycle?.cycleNo != null ? Number(so.currentCycle.cycleNo) : null;
        const currentCycleId = so?.currentCycle?.id != null ? Number(so.currentCycle.id) : null;
        const closed =
          String(so?.internalStatus ?? "") === "COMPLETED" ||
          String(so?.internalStatus ?? "") === "CLOSED" ||
          String(so?.processStage?.key ?? "") === "COMPLETED";
        setFocusSo({
          id: focusSoId,
          customerName,
          docNo: so?.docNo ?? null,
          cycleNo,
          currentCycleId,
          cycleStatus: closed ? "Closed Cycle" : "Active Cycle",
        });
      })
      .catch(() =>
        setFocusSo({
          id: focusSoId,
          customerName: "—",
          docNo: null,
          cycleNo: null,
          currentCycleId: null,
          cycleStatus: "Active Cycle",
        }),
      );
  }, [navigateNoQtyContext, focusSoId, focusSoIdValid]);

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
    if (showNoQtyScopedProductionCard) {
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
      // NO_QTY: if nothing is genuinely ready to produce now, keep unselected (carry-forward is handled in next RC).
      setWoId(0);
      setWolId(0);
      resetProducedQty();
      return;
    }
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
    showNoQtyScopedProductionCard,
    focusSoIdValid,
    focusSoId,
    workOrders,
    woIdFromUrlValid,
    woIdFromUrlPick,
    resetProducedQty,
    noQtyAutoPickLines,
    ensureSoOrderType,
    isCarryForwardLine,
    workOrderLineIdFromUrl,
  ]);

  React.useEffect(() => {
    if (!showNoQtyScopedProductionCard) return;
    setNoQtyManualContinue(false);
  }, [showNoQtyScopedProductionCard, wolId]);

  React.useEffect(() => {
    const l = flatLines.find((x) => x.id === wolId);
    if (l) setWoId(l.workOrderId);
  }, [wolId, flatLines]);

  /** After QC completes on produced qty, WO remainder is carry-forward — drop selection so the entry form is not the default view. */
  React.useEffect(() => {
    if (!showNoQtyScopedProductionCard || noQtyManualContinue) return;
    const sel = flatLines.find((x) => x.id === wolId);
    if (!sel) return;
    if (!isCarryForwardLine(sel, "NO_QTY")) return;
    setWoId(0);
    setWolId(0);
    resetProducedQty();
  }, [
    entries,
    flatLines,
    wolId,
    showNoQtyScopedProductionCard,
    noQtyManualContinue,
    isCarryForwardLine,
    resetProducedQty,
  ]);

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
      const selWo = workOrders.find((w) => w.id === woId);
      if (
        navigateNoQtyContext &&
        effectiveNoQtyCycleId != null &&
        selWo &&
        Number(selWo.cycleId ?? 0) !== Number(effectiveNoQtyCycleId)
      ) {
        setError("Production must be done on latest cycle Work Order.");
        setPosting(false);
        return;
      }
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

  async function approveDraft(id: number) {
    if (!window.confirm("Approve this batch? Raw material stock will be issued and the batch will move to QC.")) return;
    setError(null);
    setNoQtyRmShortage(null);
    setRowBusy(id);
    const approvedRow = entries.find((e) => e.id === id);
    const woIdNav = approvedRow ? Number(approvedRow.workOrderLine?.workOrder?.id ?? 0) : 0;
    try {
      await apiFetch(`/api/production/production-entries/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setEditing(null);
      setNoQtyRmShortage(null);
      await refresh();
      if (navigateNoQtyContext && Number.isFinite(woIdNav) && woIdNav > 0) {
        /**
         * Self-replace must preserve NO_QTY identity. Previously this rewrote URL to
         * `/production?workOrderId=…` only, stripping `source=no_qty_so` / `salesOrderId` /
         * `cycleId`, which caused ProductionPage to flicker into the REGULAR render branch
         * on the next render before identity could re-recover. Carry NO_QTY context forward.
         */
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
        navigate(`/production?${replaceParams.toString()}`, { replace: true });
      }
      if (navigateNoQtyContext && focusSoIdValid) toast.showSuccess("Production approved.");
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "INSUFFICIENT_RM_FOR_NO_QTY_PRODUCTION" && err.body) {
        setNoQtyRmShortage(err.body as NoQtyRmShortagePayload);
        setError(null);
      } else {
        setNoQtyRmShortage(null);
        setError(err instanceof Error ? err.message : "Approve failed");
      }
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
      if (
        navigateNoQtyContext &&
        effectiveNoQtyCycleId != null &&
        wo &&
        Number(wo.cycleId ?? 0) !== Number(effectiveNoQtyCycleId)
      ) {
        setWoId(0);
        setWolId(0);
        resetProducedQty();
        setError("Production must be done on latest cycle Work Order.");
        return;
      }
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
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="default"
          className={compact ? "h-8 px-3 text-[11px] font-semibold shadow-sm" : "h-9 px-3 text-xs font-semibold shadow-sm"}
          disabled={rowBusy === latest.id}
          onClick={() => approveDraft(latest.id)}
        >
          {rowBusy === latest.id ? "…" : "Approve"}
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
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-950">Draft Production Ready</div>
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
            <div className="text-[14px] font-semibold tracking-tight text-amber-950">Draft Production Ready</div>
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

  /** Top compact strip is shown; hide duplicate Approve/Edit/Cancel on the same row in Production Entries. */
  const showCompactDraftApprovalStrip = React.useMemo(() => {
    if (!latestDraftForSelectedWo || !selected || !(flatLines.length > 0) || !canProd) return false;
    return (
      placeDraftInNoQtyPrimaryCard ||
      placeDraftAfterRegularProductionCard ||
      (Boolean(fromNoQtySo) && !showNoQtyScopedProductionCard)
    );
  }, [
    latestDraftForSelectedWo,
    selected,
    flatLines.length,
    canProd,
    placeDraftInNoQtyPrimaryCard,
    placeDraftAfterRegularProductionCard,
    fromNoQtySo,
    showNoQtyScopedProductionCard,
  ]);

  const productionRegularBackNav = React.useMemo(() => {
    if (navigateNoQtyContext) return null;
    const sid =
      selected && Number(selected.salesOrderId) > 0
        ? Number(selected.salesOrderId)
        : focusSoIdValid
          ? focusSoId
          : 0;
    return resolveProductionRegularBack({ fromParam, sourceParam: source, salesOrderId: sid });
  }, [navigateNoQtyContext, selected?.salesOrderId, focusSoIdValid, focusSoId, fromParam, source]);

  const regularWorkflowStageLabel = React.useMemo(() => {
    if (navigateNoQtyContext) return "";
    if (latestDraftForSelectedWo) return "Draft";
    if (showQcNextBanner && qcBannerHref) return "QC pending";
    if (selectedMetrics && selectedMetrics.remainingQty > 1e-6) return "In progress";
    if (showQcCompletedStrip) return "Complete";
    if (selectedMetrics && selectedMetrics.remainingQty <= 1e-6) return "Line complete";
    return "Production";
  }, [
    navigateNoQtyContext,
    latestDraftForSelectedWo,
    showQcNextBanner,
    qcBannerHref,
    selectedMetrics,
    showQcCompletedStrip,
  ]);

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

      {error ? <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[13px] text-red-800">{error}</div> : null}
      {noQtyRmShortage?.shortages?.length ? (
        <div className="rm-shortage-panel rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
          <h3 className="text-sm font-semibold text-amber-950">RM shortage detected</h3>
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
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={() => {
                const ctx = noQtyRmShortage.context;
                if (!ctx) return;
                const cyc =
                  ctx.cycleId != null && Number.isFinite(Number(ctx.cycleId)) && Number(ctx.cycleId) > 0
                    ? `&cycleId=${encodeURIComponent(String(ctx.cycleId))}`
                    : "";
                navigate(
                  `/rm-po-grn/create?source=no_qty_production_shortage&salesOrderId=${encodeURIComponent(String(ctx.salesOrderId))}${cyc}&workOrderId=${encodeURIComponent(String(ctx.workOrderId))}&workOrderLineId=${encodeURIComponent(String(ctx.workOrderLineId))}&returnTo=production`,
                  {
                    state: {
                      shortages: noQtyRmShortage.shortages,
                      context: noQtyRmShortage.context,
                    },
                  },
                );
              }}
            >
              Raise Material Planning
            </Button>
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
      <NextStepStrip
        visible={Boolean(showQcNextBanner && qcBannerHref && !hideTopQcNextStrip)}
        variant="action"
        title={navigateNoQtyContext ? "Next Step: Send items to Quality Check" : "Next Step: Send batch to QC"}
        subtitle={
          navigateNoQtyContext ? "Production is approved. QC is pending." : "Production is approved — complete QC for eligible batches."
        }
        className="gap-1.5 rounded-md px-2 py-1.5"
        primaryAction={{
          label: navigateNoQtyContext ? "Go to QC" : "Open QC",
          onClick: () => navigate(qcBannerHref),
        }}
      />
      <NextStepStrip
        visible={!showQcNextBanner && showQcCompletedStrip}
        variant="success"
        title={navigateNoQtyContext ? "QC already completed for current production" : "Next Step: Review or continue downstream"}
        subtitle={
          navigateNoQtyContext
            ? undefined
            : "All batches on this line have cleared QC. Open QC to review entries or return to the sales order."
        }
        className="gap-1.5 rounded-md px-2 py-1.5"
        primaryAction={
          !navigateNoQtyContext && selected
            ? {
                label: "View QC entries",
                onClick: () =>
                  navigate(
                    buildQcEntryHref({
                      salesOrderId: selected.salesOrderId,
                      productionId: null,
                      orderType: String(soOrderTypeById[selected.salesOrderId] ?? "").trim() || "NORMAL",
                      fromStep: "production",
                    }),
                  ),
              }
            : undefined
        }
      />
      <NextStepStrip
        visible={Boolean(
          showNoQtyScopedProductionCard &&
            noQtyFlowState?.nextAction === "DISPATCH" &&
            !entries.some((e) => qcPendingEntry(e)),
        )}
        variant="action"
        title="Next Step: Go to Dispatch"
        subtitle="Ship QC-passed quantity when usable stock is available. Unmade WO balance can carry forward — not required before dispatch."
        className="gap-1.5 rounded-md px-2 py-1.5"
        primaryAction={{
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
        }}
      />
      <NextStepStrip
        visible={
          !navigateNoQtyContext &&
          Boolean(
            selectedMetrics &&
              selectedMetrics.remainingQty > 1e-6 &&
              canProd &&
              flatLines.length > 0 &&
              !latestDraftForSelectedWo,
          )
        }
        variant="info"
        title="Next Step: Record production"
        subtitle={`Remaining production pending: ${fmtProdQty(selectedMetrics?.remainingQty ?? 0)}`}
        primaryAction={{
          label: "Continue production",
          onClick: () => {
            document.getElementById("regular-production-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
            window.setTimeout(() => producedQtyRef.current?.focus(), 120);
          },
        }}
        className="gap-1.5 rounded-md px-2 py-1.5"
      />
      {showNoQtyScopedProductionCard ? (
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
                <Card className="min-w-0 overflow-hidden border-slate-200/90 shadow-sm ring-1 ring-slate-100/80">
                  <CardHeader className="space-y-2 border-b border-slate-100 bg-gradient-to-b from-slate-50/95 to-white px-3 py-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Production</CardTitle>
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                          Record output for the selected work order line.
                          {fromNoQtySo ? (
                            <>
                              {" "}
                              Partial production is allowed. Remaining planned qty carries forward as{" "}
                              <span className="font-medium text-slate-700">Last shortage Qty</span> on the next Requirement Sheet when this cycle
                              closes.
                            </>
                          ) : null}
                        </p>
                        {navigateNoQtyContext && woId > 0 && selected ? (
                          <p className="mt-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                            <span className="truncate font-semibold text-slate-900">{selected.fgItem.itemName}</span>
                            <span className="text-slate-400"> · </span>
                            <span className="font-medium text-slate-700">{displaySalesOrderNo(focusSoId, focusSo?.docNo)}</span>
                            <span className="text-slate-400"> · </span>
                            <span className="font-medium text-slate-700">
                              Cycle {focusSo?.cycleNo != null ? `#${focusSo.cycleNo}` : "—"}
                            </span>
                          </p>
                        ) : null}
                      </div>
                      {selected && selectedMetrics ? (
                        <div className="flex flex-wrap items-stretch justify-end gap-1">
                          <OperatorMetricBadge label="Planned qty" value={fmtProdQty(selectedMetrics.woLineQty)} />
                          <OperatorMetricBadge label="Produced qty" value={fmtProdQty(selectedMetrics.usedQty)} />
                          <OperatorMetricBadge
                            label={navigateNoQtyContext ? "Last shortage Qty" : "Remaining qty"}
                            value={fmtProdQty(selectedMetrics.remainingQty)}
                          />
                        </div>
                      ) : null}
                    </div>
                    {(() => {
                      const eps = 1e-6;
                      if (!selectedMetrics || !selected) return null;
                      const planned = selectedMetrics.woLineQty;
                      const produced = selectedMetrics.usedQty;
                      const remaining = selectedMetrics.remainingQty;
                      const qcPending = noQtyQcPendingByWolId.get(selected.id) ?? 0;
                      const cycleId = effectiveNoQtyCycleId ?? null;
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
                        cycleId,
                        fromStep: "production",
                      })}${prodQs}`;

                      if (qcPending > eps) {
                        const showContinue = remaining > eps;
                        return (
                          <div className="space-y-2 border-t border-slate-100 pt-2">
                            <p className="text-[11px] leading-snug text-slate-700">
                              You have{" "}
                              <span className="font-semibold tabular-nums text-slate-900">{fmtProdQty(qcPending)}</span>{" "}
                              qty ready for QC.
                              {fromNoQtySo ? (
                                <>
                                  {" "}
                                  <span className="text-slate-600">
                                    Last shortage Qty <span className="font-semibold tabular-nums">{fmtProdQty(remaining)}</span> is informational
                                    only — you may dispatch after QC without finishing this balance.
                                  </span>
                                </>
                              ) : (
                                <>
                                  {" "}
                                  Remaining{" "}
                                  <span className="font-semibold tabular-nums text-slate-900">{fmtProdQty(remaining)}</span> qty can be produced.
                                </>
                              )}
                            </p>
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="default"
                                className="h-8 px-2.5 text-[11px] font-semibold shadow-sm"
                                onClick={() => navigate(qcHref)}
                              >
                                Move to QC
                              </Button>
                              {showContinue ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2.5 text-[11px] font-semibold"
                                  onClick={() => {
                                    window.setTimeout(() => producedQtyRef.current?.focus(), 0);
                                  }}
                                >
                                  Continue Production
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      }

                      if (
                        navigateNoQtyContext &&
                        isCarryForwardLine(selected, "NO_QTY") &&
                        !noQtyManualContinue
                      ) {
                        return (
                          <div className="space-y-2 border-t border-slate-100 pt-2">
                            <p className="text-[11px] leading-snug text-slate-700">
                              Remaining{" "}
                              <span className="font-semibold tabular-nums text-slate-900">{fmtProdQty(remaining)}</span> will
                              carry forward as <span className="font-medium text-slate-800">Last shortage Qty</span> in the next
                              Requirement Sheet. Use dispatch when QC-passed stock is ready — more production this cycle is optional.
                            </p>
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 px-2.5 text-[11px] font-semibold"
                                onClick={() => {
                                  setNoQtyManualContinue(true);
                                  window.setTimeout(() => producedQtyRef.current?.focus(), 0);
                                }}
                              >
                                Continue producing more for this cycle (optional)
                              </Button>
                            </div>
                          </div>
                        );
                      }

                      const statusText = produced <= eps ? "Production not started" : "Production in progress";
                      const showStartOrContinue =
                        planned > 0 && produced < planned - eps && !(navigateNoQtyContext && isCarryForwardLine(selected, "NO_QTY"));

                      return (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                          <div className="min-w-0 text-[11px] leading-snug text-slate-600">
                            <span className="font-semibold text-slate-800">{statusText}</span>
                            <span className="text-slate-400"> · </span>
                            <span className="tabular-nums">
                              {fmtProdQty(produced)} / {fmtProdQty(planned)} produced
                              {navigateNoQtyContext ? (
                                <>
                                  {" "}
                                  · Last shortage Qty <span className="font-semibold">{fmtProdQty(remaining)}</span>
                                  {remaining > eps ? (
                                    <span className="text-slate-500">
                                      {" "}
                                      (informational — carries forward as Last shortage Qty on the next RS when the cycle closes)
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  {" "}
                                  · {fmtProdQty(remaining)} remaining
                                </>
                              )}
                            </span>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                            {showStartOrContinue && !navigateNoQtyContext ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 px-2.5 text-[11px] font-semibold"
                                onClick={() => {
                                  window.setTimeout(() => producedQtyRef.current?.focus(), 0);
                                }}
                              >
                                Continue Production
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })()}
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 py-2.5">
                    <form ref={createFormRef} onSubmit={onPost} className="flex flex-col gap-2">
                {!hideNoQtyAddProductionEntry ? (
                  <div className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 shadow-sm">
                    {navigateNoQtyContext ? (
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-slate-700">
                        <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5">
                          <span className="text-slate-500">SO</span>
                          <span className="font-semibold tabular-nums text-slate-900">
                            {displaySalesOrderNo(focusSoId, focusSo?.docNo)}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5">
                          <span className="text-slate-500">Cycle</span>
                          <span className="font-bold tabular-nums text-slate-950">
                            {focusSo?.cycleNo != null ? `#${focusSo.cycleNo}` : "—"}
                          </span>
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5">
                          <span className="text-slate-500">Item</span>
                          <span className="min-w-0 truncate font-semibold text-slate-950">
                            {selected ? selected.fgItem.itemName : "—"}
                          </span>
                        </span>
                        {selectedMetrics ? (
                          <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5">
                            <span className="text-emerald-800">Remaining</span>
                            <span className="font-bold tabular-nums text-emerald-950">
                              {fmtProdQty(selectedMetrics.remainingQty)}
                            </span>
                          </span>
                        ) : null}

                        {/* Keep underlying selection state wired for posting, but do not expose editable selectors in NO_QTY UI. */}
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
                      </div>
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
                  </div>
                ) : null}

                <div className="grid gap-2 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,35%)_minmax(0,1fr)] lg:items-start lg:overflow-hidden">
                  <div className="min-w-0 space-y-2 lg:min-h-0 lg:overflow-auto lg:overflow-x-hidden">
                    <div className="flex flex-col gap-2">
                      {(() => {
                        const eps = 1e-6;
                        const forSo = sortFlatByPriority(sortedFlatLines.filter((l) => l.salesOrderId === focusSoId));
                        const qcPending = forSo.filter((l) => (noQtyQcPendingByWolId.get(l.id) ?? 0) > eps);
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
                              <div className="max-h-[min(24vh,168px)] overflow-auto rounded-md border border-slate-200/90 bg-white shadow-sm">
                                <table className="w-full text-[12px]">
                                  <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50">
                                    <tr className="text-left text-[11px] text-slate-600">
                                      {navigateNoQtyContext ? null : <th className="px-2 py-0.5 font-medium">WO</th>}
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
                          );

                        return (
                          <div className="space-y-2">
                            <Section
                              title="Ready to produce"
                              subtitle="▶ selects row · Optional"
                              rows={ready}
                              balanceLabel={navigateNoQtyContext ? "Last shortage Qty" : "Balance"}
                            />
                            <Section
                              title="Produced / QC pending"
                              subtitle="Finish QC before dispatch"
                              rows={qcPending}
                              balanceLabel={navigateNoQtyContext ? "Last shortage Qty" : "Balance"}
                            />
                            {noQtyCarryForwardLines.length > 0 ? (
                              <div className="space-y-1.5">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                                    Carry forward shortage
                                  </h3>
                                  <span className="text-[11px] text-slate-400">Not active production — next RS</span>
                                </div>
                                <div className="max-h-[min(20vh,140px)] overflow-auto rounded-md border border-slate-200/90 bg-slate-50/80 shadow-sm">
                                  <table className="w-full text-[12px]">
                                    <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-100/90">
                                      <tr className="text-left text-[11px] text-slate-600">
                                        {navigateNoQtyContext ? null : <th className="px-2 py-0.5 font-medium">WO</th>}
                                        <th className="px-2 py-0.5 font-medium">Item</th>
                                        <th className="px-2 py-0.5 text-right font-medium">Planned</th>
                                        <th className="px-2 py-0.5 text-right font-medium">Produced</th>
                                        <th className="px-2 py-0.5 text-right font-medium">Last shortage Qty</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {noQtyCarryForwardLines.map((l) => {
                                        const approved = l.approvedProducedQty ?? 0;
                                        const rem = lineRemaining(l);
                                        return (
                                          <tr key={`cf-${l.id}`} className="border-t border-slate-100">
                                            {navigateNoQtyContext ? null : (
                                              <td className="px-2 py-0.5 tabular-nums">#{l.workOrderId}</td>
                                            )}
                                            <td className="max-w-[11rem] truncate px-2 py-0.5 font-medium" title={l.fgItem.itemName}>
                                              {l.fgItem.itemName}
                                            </td>
                                            <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(Number(l.qty))}</td>
                                            <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(approved)}</td>
                                            <td className="px-2 py-0.5 text-right font-semibold tabular-nums text-slate-800">
                                              {fmtProdQty(rem)}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : null}
                            {ready.length === 0 && qcPending.length === 0 && noQtyCarryForwardLines.length === 0 ? (
                              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 text-[12px] text-slate-700">
                                No production required right now for this cycle.
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="min-w-0 rounded-lg border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-100/70 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
                    <div className="space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-auto lg:overflow-x-hidden lg:pb-16">
                      {hideNoQtyAddProductionEntry ? (
                        <div className="flex min-h-[10rem] flex-col justify-center rounded-md border border-indigo-200 bg-indigo-50/90 px-3 py-3 text-sm text-indigo-950">
                          <div className="text-[14px] font-semibold tracking-tight text-slate-900">
                            Production entry completed for this cycle
                          </div>
                          <p className="mt-2 text-[13px] leading-snug text-slate-700">
                            Remaining qty will carry forward as Last shortage Qty in the next RS.
                          </p>
                          <p className="mt-1 text-[11px] leading-snug text-slate-600">
                            Use the Next Step strip for Quality Check or Dispatch. More production in this cycle is optional.
                          </p>
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
                        if (!selected) return <div className="text-[12px] font-semibold tracking-tight text-slate-700">Log production</div>;
                        const eps = 1e-6;
                        const rem = lineRemaining(selected);
                        const produced = selected.approvedProducedQty ?? 0;
                        const qcPendingLine = noQtyQcPendingByWolId.get(selected.id) ?? 0;
                        if (qcPendingLine > eps) {
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
                          })}${prodQs}`;
                          return (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-[12px] text-emerald-950">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900/90">
                                    Approved · Ready for QC
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
                                  Go to QC
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
                            <div className="text-[12px] font-semibold tracking-tight text-slate-700">
                              {navigateNoQtyContext ? "Continue Production" : "Log production"}
                            </div>
                          );
                        }

                        const cycleIdNav = effectiveNoQtyCycleId ?? null;
                        const qcHref = buildNoQtyGuidedHref({
                          to: "/qc-entry",
                          salesOrderId: focusSoId,
                          cycleId: cycleIdNav,
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
                      {selected ? (
                        <p className="text-[11px] text-slate-600">
                          <span className="font-medium text-slate-800">{selected.fgItem.itemName}</span>
                          <span className="text-slate-400"> · </span>
                          <span className="font-medium text-slate-700">
                            {displaySalesOrderNo(
                              navigateNoQtyContext && focusSoIdValid ? focusSoId : selected.salesOrderId,
                              focusSo?.docNo,
                            )}
                          </span>
                          {navigateNoQtyContext ? (
                            <>
                              <span className="text-slate-400"> · </span>
                              <span className="font-medium text-slate-700">
                                Cycle {focusSo?.cycleNo != null ? `#${focusSo.cycleNo}` : "—"}
                              </span>
                            </>
                          ) : null}
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
                        if (approvedOnLine && noRemaining && !editing) {
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
                          })}${prodQs}`;
                          return (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] text-emerald-950">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900/90">
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
                                        {qcPendingLine > eps ? "Pending QC" : "QC done / ready"}
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
                                  Go to QC
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
                            <div className="sticky bottom-0 z-[2] mt-1 border-t border-slate-200 bg-white/95 pb-2 pt-2 backdrop-blur-sm">
                              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                                <FieldShortcutHint
                                  show={shortcutHints.activeFieldId === "prodQty"}
                                  hint={shortcutHints.activeFieldHintText ?? ""}
                                  placement="below-end"
                                  className="min-w-0"
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
                                      className="mt-0.5 h-10 w-full min-w-0 tabular-nums text-[16px] font-semibold"
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
                                          Remaining allowed:{" "}
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
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-10 shrink-0 text-[13px]"
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
                                    className="h-10 shrink-0 px-4 text-[14px] font-semibold"
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
              No work orders available. Create a work order to start production.
            </p>
          ) : null}
        </>
      ) : (
        <form ref={createFormRef} onSubmit={onPost} className={cn("flex flex-col", !fromNoQtySo ? "gap-2" : "gap-3")}>
          {!fromNoQtySo ? (
            <>
              {placeDraftAfterRegularProductionCard ? (
                <div className="pb-0.5">{renderDraftProductionBanner({ compact: true })}</div>
              ) : null}
              <Card
                id="regular-production-entry"
                className="min-w-0 scroll-mt-24 overflow-hidden border-slate-200/90 shadow-sm ring-1 ring-slate-100/80"
              >
                <CardHeader className="border-b border-slate-100 bg-gradient-to-b from-slate-50/90 to-white px-2.5 py-1.5">
                  <CardTitle className="text-[13px] font-semibold tracking-tight text-slate-900">Production entry</CardTitle>
                  <p className="mt-0.5 text-[10px] font-normal leading-snug text-slate-500">
                    WO · Item · Date · Qty · Save
                  </p>
                </CardHeader>
                <CardContent className="space-y-1.5 px-2.5 py-1.5">
                  <div className="flex flex-col gap-1.5 lg:flex-row lg:flex-wrap lg:items-end lg:gap-x-2 lg:gap-y-1">
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
                          className="erp-flow-filter-input h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[13px]"
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
                          className="erp-flow-filter-input h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[13px]"
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
                      className="h-8 shrink-0 px-2.5 text-[12px]"
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
                      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">
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
                          Cycle {focusSo?.cycleNo != null ? `#${focusSo.cycleNo}` : "—"}
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

      {!placeDraftInNoQtyPrimaryCard &&
      !placeDraftAfterRegularProductionCard &&
      !(fromNoQtySo && !showNoQtyScopedProductionCard && flatLines.length > 0 && canProd) ? (
        <div className="mb-1.5">{renderDraftProductionBanner({ compact: true })}</div>
      ) : null}

      <Card
        className={cn(
          "min-w-0 overflow-hidden border-slate-200/90 shadow-sm ring-1 ring-slate-100/80",
          !fromNoQtySo && flatLines.length > 0 && "mt-1",
        )}
      >
        <CardHeader
          className={cn(
            "border-b border-slate-100 bg-gradient-to-b from-slate-50/90 to-white px-3",
            navigateNoQtyContext ? "py-2" : "py-1.5",
          )}
        >
          <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Production Entries</CardTitle>
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
                              )
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
            };

            return (
              <div className={cn("space-y-2", !navigateNoQtyContext && "px-3")}>
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
        </div>
      ) : null}
    </OperatorPageBody>
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

  if (!navigateNoQtyContext) {
    return (
      <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-2 pb-2">
        {kbHelpOpen && canProd ? (
          <div className="erp-modal-backdrop" role="dialog" aria-label="Keyboard shortcuts">
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
          </div>
        ) : null}
        <OperationalContextSticky className="sticky top-0 z-20 space-y-1 border-b border-slate-200/90 bg-white/95 pb-2 pt-1 shadow-sm backdrop-blur-sm">
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
              <span className="font-mono font-semibold tabular-nums text-slate-900">WO #{woId > 0 ? woId : "—"}</span>
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            <span className="rounded bg-slate-900 px-1.5 py-0.5 text-white">Regular flow</span>
            <span className="font-normal normal-case tracking-normal text-slate-500">
              Sales Order → Work Order → <span className="font-semibold text-slate-800">Production</span>
            </span>
            <span className="hidden sm:inline text-slate-300" aria-hidden>
              ·
            </span>
            <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-semibold normal-case tracking-normal text-violet-950">
              Current stage: {regularWorkflowStageLabel}
            </span>
          </div>
          {selected && Number(selected.salesOrderId) > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold">
              <Link
                className="text-sky-900 underline-offset-2 hover:underline"
                to={`/work-orders?salesOrderId=${encodeURIComponent(String(selected.salesOrderId))}&from=production`}
              >
                View WO list
              </Link>
              <Link
                className="text-sky-900 underline-offset-2 hover:underline"
                to={`/sales-orders?salesOrderId=${encodeURIComponent(String(selected.salesOrderId))}`}
              >
                Sales Order
              </Link>
              {qcBannerHref ? (
                <Link className="text-sky-900 underline-offset-2 hover:underline" to={qcBannerHref}>
                  Open QC
                </Link>
              ) : null}
              {selectedMetrics &&
              selectedMetrics.remainingQty > 1e-6 &&
              !latestDraftForSelectedWo &&
              canProd ? (
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
          <OperationalContextBar className="rounded-md border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-2 py-1 shadow-sm">
            <span className="font-semibold text-slate-600">SO</span>
            <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-sky-900">
              {selected
                ? displaySalesOrderNo(selected.salesOrderId, selected.salesOrderId === focusSoId ? focusSo?.docNo : null)
                : "—"}
            </span>
            <OpCtxSep />
            <span className="font-semibold text-slate-600">WO</span>
            <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-900">#{woId > 0 ? woId : "—"}</span>
            <OpCtxSep />
            <span className="text-slate-500">Item</span>
            <span className="max-w-[12rem] truncate font-semibold text-slate-900">{selected ? selected.fgItem.itemName : "—"}</span>
            <OpCtxSep />
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Status
            </span>
            <span className="font-semibold text-slate-900">{regularWorkflowStageLabel}</span>
            {selectedMetrics && selected ? (
              <>
                <OpCtxSep />
                <span className="text-slate-500">Planned</span>
                <span className="font-bold tabular-nums text-slate-900">{fmtProdQty(selectedMetrics.woLineQty)}</span>
                <OpCtxSep />
                <span className="text-slate-500">Produced</span>
                <span className="font-bold tabular-nums text-slate-900">{fmtProdQty(selectedMetrics.usedQty)}</span>
                <OpCtxSep />
                <span className="text-emerald-800">Remaining</span>
                <span className="font-bold tabular-nums text-emerald-950">{fmtProdQty(selectedMetrics.remainingQty)}</span>
              </>
            ) : null}
          </OperationalContextBar>
        </OperationalContextSticky>
        {main}
      </PageContainer>
    );
  }
  return (
    <PageContainer className="erp-flow-page -mt-1 max-w-none space-y-2 pb-[5.25rem] sm:pb-[5.25rem]">
      {kbHelpOpen && canProd ? (
        <div className="erp-modal-backdrop" role="dialog" aria-label="Keyboard shortcuts">
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
        </div>
      ) : null}
      <OperationalContextSticky className="space-y-1.5">
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
          <Badge variant="warning" className="h-5 shrink-0 px-1.5 text-[10px] leading-none">
            NO QTY
          </Badge>
          <OpCtxSep />
          <span className="text-slate-500">Cycle</span>
          <span className="font-semibold tabular-nums text-slate-900">{focusSo?.cycleNo != null ? focusSo.cycleNo : "—"}</span>
          <OpCtxSep />
          <span className="text-slate-500">Item</span>
          <span className="max-w-[12rem] truncate font-medium text-slate-900">{selected ? selected.fgItem.itemName : "—"}</span>
          <OpCtxSep />
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-800 ring-1 ring-slate-200">PRODUCTION</span>
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
          <OpCtxSep />
          <span className="text-[11px] text-slate-600">
            Pointer:{" "}
            <span className="font-medium text-slate-900">
              {focusSo?.cycleStatus === "Closed Cycle"
                ? "Cycle closed"
                : !entries.length
                  ? "Record production"
                  : entries.some((e) => isDraft(e))
                    ? "Continue production"
                    : "Complete QC"}
            </span>
          </span>
        </OperationalContextBar>
      </OperationalContextSticky>
      {/*
       * Phase 1: "Create Next RS" CTA removed from the Production page.
       * NO_QTY Next RS ownership now lives only on Dashboard, NO_QTY SO detail and Requirement Sheet pages.
       */}
      {main}
    </PageContainer>
  );
}
