import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { workOrdersFocusHref } from "../lib/drillDownRoutes";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { apiFetch, ApiRequestError } from "../services/api";
import { PageContainer } from "../components/PageHeader";
import { ArrowLeft, CheckCircle2, Info, AlertTriangle } from "lucide-react";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { ActivityHistoryCard } from "../components/ActivityHistoryCard";
import { PageNoQtyFlowBackLink } from "../components/PageHeader";
import { buildNoQtyGuidedHref, type NoQtyNextAction, useNoQtyFlowState } from "../lib/noQtyFlowState";
import { useToast } from "../contexts/ToastContext";
import { cn } from "../lib/utils";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { useIsAdmin } from "../hooks/useIsAdmin";

class RequirementSheetErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string | null }
> {
  state = { hasError: false, message: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { hasError: true, message: msg };
  }
  componentDidCatch(err: unknown) {
    // TEMP SAFETY: surface render crashes instead of blank screen.
    // eslint-disable-next-line no-console
    console.error("[RS_RENDER_CRASH]", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <div className="font-semibold">Render error</div>
          <div className="mt-0.5 text-xs text-red-800">{this.state.message ?? "Unknown error"}</div>
          <div className="mt-1 text-xs text-red-800">Open the browser console for the full stack trace.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

function fgItemOptionsFromSo(so: SoHeader | null): Array<{ itemId: number; itemName: string }> {
  const lines = Array.isArray(so?.lines) ? so?.lines : [];
  const out: Array<{ itemId: number; itemName: string }> = [];
  const seen = new Set<number>();
  for (const l of lines) {
    const itemId = Number(l.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    const type = String(l.item?.itemType ?? "");
    if (type !== "FG") continue;
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    out.push({ itemId, itemName: l.item?.itemName?.trim() || `Item #${itemId}` });
  }
  out.sort((a, b) => a.itemName.localeCompare(b.itemName));
  return out;
}

type SheetStatus = "DRAFT" | "LOCKED";

type SheetListRow = {
  id: number;
  periodKey?: string | null;
  version?: number | null;
  status: SheetStatus;
  /** NO_QTY: which SalesOrderCycle this sheet belongs to; versioning is per cycle. */
  cycleId?: number | null;
  createdAt?: string;
};

type SoHeader = {
  id: number;
  docNo?: string | null;
  internalStatus?: string | null;
  processStage?: { key?: string | null } | null;
  customer?: { name: string } | null;
  po?: { customer?: { name: string } | null } | null;
  orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY";
  currentCycleId?: number | null;
  currentCycle?: { id: number; cycleNo: number; status: string } | null;
  lines?: Array<{
    id: number;
    itemId: number;
    item?: { itemName?: string | null; itemType?: string | null } | null;
  }>;
};

type SheetLine = {
  id?: number;
  itemId: number;
  itemName: string;
  // Backend still returns requirementQty for compatibility (treated as New requirement Qty).
  requirementQty: string;
  // New fields for NO_QTY shortfall workflow.
  shortfallQty?: number | null;
  qcStockNote?: string | null;
  newWoQty?: string;
  totalWoQty?: number | null;
  availableStockQty?: number | null;
  /** NO_QTY draft clarity: total usable stock (USABLE bucket) */
  usableTotalQty?: number | null;
  /** NO_QTY draft clarity: pending-dispatch reserve demand for this SO+item */
  reservedPendingDispatchQty?: number | null;
  /** NO_QTY draft clarity: how much of the reserve is actually blocking this SO's usable stock (min(usableTotal, reserveDemand)) */
  reservedPendingDispatchAppliedQty?: number | null;
  gapPercent?: number | null;
  suggestedWoQty?: number | null;
  /** Cycle production need (gross fulfillment − usable stock); drives WO / dispatch cap. */
  productionRequiredQty?: number | null;
  fulfillmentQty?: number | null;
  coveredFromStockQty?: number | null;
  yellowThreshold?: number | null;
  greenThreshold?: number | null;
  colorZone?: "GREEN" | "YELLOW" | "RED" | "EXCESS" | null;
};

type SheetDetail = {
  id: number;
  salesOrderId: number;
  cycleId?: number | null;
  status: SheetStatus;
  periodKey?: string | null;
  version?: number | null;
  workOrderId?: number | null;
  sourceReference?: string | null;
  remarks?: string | null;
  customerName?: string | null;
  lines: SheetLine[];
};

type StockBucketsRow = {
  itemId: number;
  usableQty: number;
};

function sheetVersionNum(v: number | null | undefined): number {
  const n = Number(v ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function safeNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Operational USABLE for planning UI — matches Stock Summary (floor at 0, never show negative cover). */
function usableDisplayStock(v: unknown): number {
  return Math.max(0, safeNum(v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

const PLAN_EPS = 1e-6;

/** Draft: cycle production required = max(0, shortfall + new requirement − usable stock), matching backend. */
function computeDraftProductionRequired(line: SheetLine): number {
  const shortfall = safeNum(line.shortfallQty);
  const stock = usableDisplayStock(line.availableStockQty);
  const newWo = safeNum(line.newWoQty ?? line.requirementQty);
  const gross = shortfall + newWo;
  const r = gross > PLAN_EPS ? gross : 0;
  const gapPercent = r > 0 ? round2(((r - stock) / r) * 100) : null;
  let pr = Math.max(0, Math.round((gross - stock) * 1000) / 1000);
  if (gapPercent != null && gapPercent < 0) pr = 0;
  return pr;
}

/** System recommendation for new requirement only: max(0, new requirement − usable stock). */
function computeSystemSuggestedNet(newReq: number, stock: number): number {
  if (!(newReq > PLAN_EPS)) return 0;
  return Math.max(0, Math.round((newReq - stock) * 1000) / 1000);
}

type NoQtyRowPlanning =
  | { kind: "covered"; text: string }
  | { kind: "carryforward"; text: string }
  | { kind: "excess"; newReq: number; suggestedNet: number; diff: number }
  | { kind: "split"; fulfillFromStock: number; needProduction: number };

function getNoQtyRowPlanning(l: SheetLine, _locked: boolean, needsRecalc: boolean): NoQtyRowPlanning | null {
  const stock = usableDisplayStock(l.availableStockQty);
  const newReq = safeNum(l.newWoQty ?? l.requirementQty);
  const shortfall = safeNum(l.shortfallQty);
  const suggestedNet = computeSystemSuggestedNet(newReq, stock);
  const productionRequired = needsRecalc
    ? computeDraftProductionRequired(l)
    : safeNum(l.totalWoQty ?? l.productionRequiredQty ?? computeDraftProductionRequired(l));

  if (needsRecalc) return null;
  if (newReq <= PLAN_EPS && shortfall <= PLAN_EPS) return null;

  if (suggestedNet <= PLAN_EPS && newReq > PLAN_EPS) {
    if (productionRequired > PLAN_EPS) {
      const p = productionRequired.toFixed(3).replace(/\.000$/, "");
      return {
        kind: "carryforward",
        text: `Stock covers the new requirement quantity, but ${p} units still need production this cycle (including carry-forward).`,
      };
    }
    return { kind: "covered", text: "Stock fully covers requirement. No production needed." };
  }

  if (newReq > suggestedNet + PLAN_EPS && suggestedNet > PLAN_EPS) {
    return { kind: "excess", newReq, suggestedNet, diff: newReq - suggestedNet };
  }

  if (suggestedNet > PLAN_EPS) {
    return { kind: "split", fulfillFromStock: Math.min(newReq, stock), needProduction: suggestedNet };
  }

  if (suggestedNet <= PLAN_EPS && productionRequired > PLAN_EPS) {
    const p = productionRequired.toFixed(3).replace(/\.000$/, "");
    return {
      kind: "carryforward",
      text: `Stock covers the new requirement quantity, but ${p} units still need production this cycle (including carry-forward).`,
    };
  }

  return null;
}

export function RequirementSheetPage() {
  const { id: soIdParam } = useParams<{ id: string }>();
  const soId = Number(soIdParam);
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const fromNoQtySo = (searchParams.get("source") || searchParams.get("from") || "").toLowerCase() === "no_qty_so";
  const addRequirementIntent = searchParams.get("intent") === "add";
  const createNewSheetRef = React.useRef<HTMLDivElement | null>(null);
  const toast = useToast();
  const isAdmin = useIsAdmin();

  const [so, setSo] = React.useState<SoHeader | null>(null);
  const [sheets, setSheets] = React.useState<SheetListRow[]>([]);
  const [selectedSheetId, setSelectedSheetId] = React.useState<number | null>(null);
  const [sheet, setSheet] = React.useState<SheetDetail | null>(null);
  const [periodKey, setPeriodKey] = React.useState("");
  const [remarks, setRemarks] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [needsRecalc, setNeedsRecalc] = React.useState(false);
  const [justDeletedDraft, setJustDeletedDraft] = React.useState(false);
  const [showCreatePanel, setShowCreatePanel] = React.useState(false);
  const [justCreatedSheetId, setJustCreatedSheetId] = React.useState<number | null>(null);
  const [createSelectedItemIds, setCreateSelectedItemIds] = React.useState<number[]>([]);
  const [woPreviewOpen, setWoPreviewOpen] = React.useState(false);
  const [usableByItemId, setUsableByItemId] = React.useState<Record<number, number>>({});

  const customerName = so?.customer?.name ?? so?.po?.customer?.name ?? "—";
  const selectedPeriod = sheet?.periodKey ?? null;
  const selectedVersion = sheetVersionNum(sheet?.version);
  const activePlanningCycleId = so?.currentCycle?.id ?? so?.currentCycleId ?? null;
  const isNoQty = so?.orderType === "NO_QTY";
  const cycleNo = so?.currentCycle?.cycleNo != null ? Number(so.currentCycle.cycleNo) : null;
  const cycleStatus: "Active Cycle" | "Closed Cycle" | "Next Cycle" =
    addRequirementIntent && so?.currentCycle?.status !== "ACTIVE"
      ? "Next Cycle"
      : so?.currentCycle?.status === "ACTIVE" &&
          !["COMPLETED", "CLOSED"].includes(String(so?.internalStatus ?? "")) &&
          String(so?.processStage?.key ?? "") !== "COMPLETED"
        ? "Active Cycle"
        : "Closed Cycle";

  const latestVersionForPeriod = React.useMemo(() => {
    if (!selectedPeriod) return 1;
    const samePeriod = sheets.filter((s) => (s.periodKey ?? null) === selectedPeriod);
    const scoped =
      so?.orderType === "NO_QTY" && activePlanningCycleId != null
        ? samePeriod.filter((s) => Number(s.cycleId ?? 0) === Number(activePlanningCycleId))
        : samePeriod;
    const vs = scoped.map((s) => sheetVersionNum(s.version));
    return vs.length ? Math.max(...vs) : 1;
  }, [sheets, selectedPeriod, so?.orderType, activePlanningCycleId]);
  const isLatestForPeriod = !selectedPeriod || selectedVersion >= latestVersionForPeriod;

  async function loadSoAndSheets() {
    setError(null);
    setSuccess(null);
    const [soRow, sheetRows] = await Promise.all([
      apiFetch<SoHeader>(`/api/sales-orders/${soId}`),
      apiFetch<SheetListRow[]>(`/api/sales-orders/${soId}/requirement-sheets`),
    ]);
    setSo(soRow);
    const rows = Array.isArray(sheetRows) ? sheetRows : [];
    setSheets(rows);
    const activeId = soRow?.currentCycle?.id ?? soRow?.currentCycleId ?? null;
    const existsSelected = selectedSheetId != null && rows.some((r) => r.id === selectedSheetId);
    if (!existsSelected) {
      // Prefer: active cycle + latest DRAFT, else latest LOCKED, else latest by id (stable).
      // In "intent=add" mode, never auto-select a LOCKED sheet (history) as the working sheet.
      const scoped =
        soRow?.orderType === "NO_QTY" && activeId != null
          ? rows.filter((r) => Number(r.cycleId ?? 0) === Number(activeId))
          : rows;
      const sortKey = (r: SheetListRow) => (r.createdAt ? new Date(r.createdAt).getTime() : r.id);
      const drafts = scoped.filter((r) => r.status === "DRAFT").sort((a, b) => sortKey(b) - sortKey(a));
      const lockedRows = scoped.filter((r) => r.status === "LOCKED").sort((a, b) => sortKey(b) - sortKey(a));
      const pick = addRequirementIntent ? drafts[0] ?? null : drafts[0] ?? lockedRows[0] ?? scoped.sort((a, b) => sortKey(b) - sortKey(a))[0] ?? null;
      setSelectedSheetId(pick?.id ?? null);
    }
  }

  async function loadSelectedSheet(id: number) {
    setError(null);
    setSuccess(null);
    const s = await apiFetch<SheetDetail>(`/api/requirement-sheets/${id}`);
    setSheet(s);
    setRemarks(s.remarks?.trim() ?? "");
    setNeedsRecalc(false);
  }

  async function voidLockedSheet() {
    if (!sheet) return;
    const ok = window.confirm(
      "This will cancel planning for this cycle. Are you sure?",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/requirement-sheets/${sheet.id}/void`, { method: "POST", body: JSON.stringify({}) });
      setSuccess("Requirement Sheet voided. Create the corrected Requirement Sheet now.");
      setSelectedSheetId(null);
      await loadSoAndSheets();
      // Immediately offer a fresh sheet creation flow after void.
      openCreateNewRequirementSheet(false);
    } catch (e) {
      const msg =
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to void requirement sheet.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function openCreateNewRequirementSheet(prefillFromCurrent = true) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    setPeriodKey(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    setShowCreatePanel(true);
    if (prefillFromCurrent && sheet?.lines?.length) {
      const ids = sheet.lines.map((l) => Number(l.itemId)).filter((x) => Number.isFinite(x) && x > 0);
      setCreateSelectedItemIds([...new Set(ids)]);
    }
    window.requestAnimationFrame(() => {
      createNewSheetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  React.useEffect(() => {
    if (!Number.isFinite(soId) || soId <= 0) {
      setError("Invalid sales order.");
      return;
    }
    void loadSoAndSheets().catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soId]);

  React.useEffect(() => {
    if (!addRequirementIntent || !Number.isFinite(soId) || soId <= 0) return;
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    setPeriodKey(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }, [addRequirementIntent, soId]);

  // When opened via "Create Next RS" intent:
  // - If a DRAFT exists in the active cycle, open that draft (do not start a new sheet).
  // - Else show the create panel and do not auto-open locked history.
  React.useEffect(() => {
    if (!addRequirementIntent) return;
    if (!isNoQty) return;
    const activeId = so?.currentCycle?.id ?? so?.currentCycleId ?? null;
    const scoped =
      activeId != null ? sheets.filter((s) => Number(s.cycleId ?? 0) === Number(activeId)) : sheets;
    const drafts = scoped.filter((s) => s.status === "DRAFT");
    const draftId = drafts.length ? Number(drafts[0].id) : null;
    if (draftId != null && Number.isFinite(draftId) && draftId > 0) {
      setSelectedSheetId(draftId);
      setShowCreatePanel(false);
      return;
    }
    setSelectedSheetId(null);
    setShowCreatePanel(true);
  }, [addRequirementIntent, isNoQty, sheets, so?.currentCycle?.id, so?.currentCycleId]);

  React.useEffect(() => {
    if (!isNoQty) return;
    // Used only for UI breakdown (usable/reserved/free); does not affect planning math.
    apiFetch<StockBucketsRow[]>("/api/stock/summary-buckets")
      .then((rows) => {
        const out: Record<number, number> = {};
        for (const r of Array.isArray(rows) ? rows : []) {
          const id = Number(r.itemId);
          if (!Number.isFinite(id) || id <= 0) continue;
          out[id] = Number((r as any).usableQty ?? 0) || 0;
        }
        setUsableByItemId(out);
      })
      .catch(() => setUsableByItemId({}));
  }, [isNoQty]);

  React.useEffect(() => {
    setCreateSelectedItemIds([]);
  }, [soId]);

  React.useEffect(() => {
    // Create panel: keep selection when opening via "Create New Requirement Sheet" (prefill),
    // but clear when switching SO.
    if (!showCreatePanel) return;
  }, [showCreatePanel]);

  React.useEffect(() => {
    if (!addRequirementIntent) return;
    const t = window.setTimeout(() => {
      createNewSheetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => window.clearTimeout(t);
  }, [addRequirementIntent, soId]);

  // Default period (YYYY-MM) on first show of create panel, if empty.
  React.useEffect(() => {
    if (!showCreatePanel) return;
    if (periodKey.trim()) return;
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    setPeriodKey(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }, [showCreatePanel, periodKey]);

  React.useEffect(() => {
    if (selectedSheetId == null) {
      setSheet(null);
      return;
    }
    setJustDeletedDraft(false);
    // If user manually switches to a different sheet, stop treating the old one as "just created".
    if (justCreatedSheetId != null && Number(selectedSheetId) !== Number(justCreatedSheetId)) {
      setJustCreatedSheetId(null);
    }
    void loadSelectedSheet(selectedSheetId).catch((e) => setError(e instanceof Error ? e.message : "Failed to load sheet."));
  }, [selectedSheetId, justCreatedSheetId]);

  async function createNewSheet() {
    if (!periodKey.trim()) {
      setError("Period is required (e.g. 2026-04).");
      return;
    }
    if (createSelectedItemIds.length === 0) {
      setError("Select at least one FG item for this cycle.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: number }>(`/api/sales-orders/${soId}/requirement-sheets`, {
        method: "POST",
        body: JSON.stringify({ periodKey: periodKey.trim(), remarks: null, itemIds: createSelectedItemIds }),
      });
      await loadSoAndSheets();
      setSelectedSheetId(created.id);
      setPeriodKey("");
      setJustDeletedDraft(false);
      setShowCreatePanel(false);
      setJustCreatedSheetId(created.id);
      setSuccess("Requirement sheet created. Enter quantities and finalize when ready.");
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Failed to create.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!sheet) return;
    if (!isLatestForPeriod) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/requirement-sheets/${sheet.id}`, {
        method: "PUT",
        body: JSON.stringify({ remarks: remarks.trim() || null }),
      });
      // Save lines
      await apiFetch(`/api/requirement-sheets/${sheet.id}/lines`, {
        method: "PUT",
        body: JSON.stringify({
          lines: (Array.isArray(sheet?.lines) ? sheet!.lines : []).map((l) => ({
            itemId: l.itemId,
            requirementQty: Number(l.requirementQty || 0),
          })),
        }),
      });
      await loadSelectedSheet(sheet.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function recalc() {
    if (!sheet) return;
    if (!isLatestForPeriod) return;
    setBusy(true);
    setError(null);
    try {
      // Important: ensure server recalculation uses latest draft edits.
      // We send current line requirementQty values so backend can persist + recalc atomically.
      const next = await apiFetch<SheetDetail>(`/api/requirement-sheets/${sheet.id}/recalculate`, {
        method: "POST",
        body: JSON.stringify({
          lines: (Array.isArray(sheet?.lines) ? sheet!.lines : []).map((l) => ({
            itemId: l.itemId,
            requirementQty: Number(l.requirementQty || 0),
          })),
        }),
      });
      setSheet(next);
      setNeedsRecalc(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to recalculate.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraftSheet() {
    if (!sheet || sheet.status !== "DRAFT") return;
    if (!isLatestForPeriod) return;
    if (!window.confirm("Are you sure you want to delete this draft requirement?")) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/requirement-sheets/${sheet.id}`, { method: "DELETE" });
      setSuccess("Draft deleted. Create a new requirement sheet to continue planning.");
      setJustDeletedDraft(true);
      setShowCreatePanel(true);
      setSheet(null);
      setSelectedSheetId(null);
      setRemarks("");
      await loadSoAndSheets();
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Failed to delete.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const locked = sheet?.status === "LOCKED";
  // Editing is blocked for LOCKED sheets and for older versions.
  const editingDisabled = Boolean(sheet) && (!isLatestForPeriod || locked);
  const showOlderVersionBanner = Boolean(sheet) && !isLatestForPeriod;

  async function lockSheet() {
    if (!sheet) return;
    if (!isLatestForPeriod) return;
    if (needsRecalc) return;
    if (
      isNoQty &&
      sheet.status === "DRAFT" &&
      (Array.isArray(sheet?.lines) ? sheet!.lines : []).some((l) => {
        const newR = safeNum(l.newWoQty ?? l.requirementQty);
        const stock = usableDisplayStock(l.availableStockQty);
        const sug = computeSystemSuggestedNet(newR, stock);
        return newR > sug + PLAN_EPS && sug > PLAN_EPS;
      })
    ) {
      const ok = window.confirm("Some items have excess production planned. Do you want to continue?");
      if (!ok) return;
    }
    if (!window.confirm("Lock this requirement sheet? Locked sheets cannot be edited.")) return;
    setBusy(true);
    setError(null);
    try {
      const locked = await apiFetch<SheetDetail>(`/api/requirement-sheets/${sheet.id}/lock`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setSheet(locked);
      setRemarks(locked.remarks?.trim() ?? "");
      setNeedsRecalc(false);

      const cycleId = locked.cycleId ?? activePlanningCycleId ?? null;
      toast.showSuccess("Requirement finalized. Work order created/updated. Continue to Production.");
      if (isZeroPlanning) {
        nav(`/dispatch?source=no_qty_so&salesOrderId=${locked.salesOrderId}`);
        return;
      }
      nav(
        buildNoQtyGuidedHref({
          to: "/production",
          salesOrderId: locked.salesOrderId,
          cycleId,
          fromStep: "requirement",
        }),
        { replace: true },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to lock.";
      setError(msg);
      toast.showError(msg);
    } finally {
      setBusy(false);
    }
  }

  const positiveSuggestedCount = React.useMemo(() => {
    const lines = sheet?.lines ?? [];
    return lines.filter((l) => safeNum(l.totalWoQty ?? l.productionRequiredQty) > 0).length;
  }, [sheet]);

  const existingWorkOrderForSheet = Boolean(sheet?.workOrderId && Number(sheet.workOrderId) > 0);
  const hasPositiveSuggestedWoQty = positiveSuggestedCount > 0;

  const canCreateWorkOrderDirect =
    Boolean(sheet) &&
    sheet?.status === "LOCKED" &&
    isLatestForPeriod &&
    hasPositiveSuggestedWoQty &&
    !existingWorkOrderForSheet &&
    !busy;

  async function createWorkOrderDirect() {
    if (!sheet) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const out = await apiFetch<{ workOrderId: number }>(`/api/requirement-sheets/${sheet.id}/create-wo`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const woId = Number(out?.workOrderId);
      if (!Number.isFinite(woId) || woId <= 0) {
        setSuccess("Work Order created.");
        nav("/work-orders");
        return;
      }
      setSuccess(`Work Order #${woId} created.`);
      nav(workOrdersFocusHref(woId), {
        state: {
          source: "requirementSheet",
          fromRequirementSheet: true,
          salesOrderId: sheet.salesOrderId,
          requirementSheetId: sheet.id,
        },
      });
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Failed to create work order.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const summary = React.useMemo(() => {
    const lines = sheet?.lines ?? [];
    let shortfallSum = 0;
    let newWoSum = 0;
    let totalWoSum = 0;
    let stockSum = 0;
    for (const l of lines) {
      const shortfall = safeNum(l.shortfallQty);
      const newWo = safeNum(l.newWoQty ?? l.requirementQty);
      const stock = usableDisplayStock(l.availableStockQty);
      shortfallSum += shortfall;
      newWoSum += newWo;
      const totalToProduce = locked
        ? safeNum(l.totalWoQty ?? l.productionRequiredQty ?? l.suggestedWoQty)
        : safeNum(l.totalWoQty ?? l.productionRequiredQty ?? computeDraftProductionRequired(l));
      totalWoSum += isNoQty ? totalToProduce : (locked ? safeNum(l.suggestedWoQty) : computeSystemSuggestedNet(newWo, stock));
      stockSum += stock;
    }
    return {
      shortfallSum,
      newWoSum,
      totalWoSum,
      stockSum,
    };
  }, [sheet, locked, isNoQty]);

  const noQtyPlanningSummary = React.useMemo(() => {
    if (!isNoQty || !sheet || locked) return null;
    const lines = sheet?.lines ?? [];
    let covered = 0;
    let shortage = 0;
    let excess = 0;
    for (const l of lines) {
      const stock = usableDisplayStock(l.availableStockQty);
      const requirementQty = safeNum(l.newWoQty ?? l.requirementQty);
      const suggestedNet = computeSystemSuggestedNet(requirementQty, stock);
      const productionRequired = needsRecalc
        ? computeDraftProductionRequired(l)
        : safeNum(l.totalWoQty ?? l.productionRequiredQty ?? computeDraftProductionRequired(l));
      if (needsRecalc) continue;

      const newReqCovered = requirementQty > PLAN_EPS && stock + PLAN_EPS >= requirementQty;

      if (requirementQty > suggestedNet + PLAN_EPS && suggestedNet > PLAN_EPS) {
        excess++;
        continue;
      }
      if (
        productionRequired > PLAN_EPS &&
        suggestedNet <= PLAN_EPS &&
        (newReqCovered || requirementQty <= PLAN_EPS)
      ) {
        shortage++;
        continue;
      }
      if (newReqCovered && productionRequired <= PLAN_EPS) {
        covered++;
      }
    }
    return { total: lines.length, covered, shortage, excess, needsRecalc };
  }, [isNoQty, sheet, locked, needsRecalc]);

  // --- UI state rules (NO_QTY must be cycle-scoped) ---
  const cycleScopedSheets =
    isNoQty && activePlanningCycleId != null
      ? sheets.filter((s) => Number(s.cycleId ?? 0) === Number(activePlanningCycleId))
      : sheets;
  const hasAnySheets = cycleScopedSheets.length > 0;
  const noSheetsUi = !hasAnySheets;

  // Strict state-driven UI: base banners/actions on the SELECTED sheet only.
  // This prevents stale "draft" UI from showing after the selected sheet is locked.
  const draftUi = sheet?.status === "DRAFT";
  const lockedUi = sheet?.status === "LOCKED";

  const draftRowsInCycle = React.useMemo(
    () => cycleScopedSheets.filter((r) => r.status === "DRAFT"),
    [cycleScopedSheets],
  );
  /** Another DRAFT row exists in this cycle besides the sheet currently loaded. */
  const hasOtherUnfinishedDraft =
    draftUi && sheet?.id != null && draftRowsInCycle.some((r) => Number(r.id) !== Number(sheet.id));
  /** Version dropdown selection matches the loaded detail (same draft already open). */
  const selectionMatchesOpenDraft =
    sheet?.id != null && selectedSheetId != null && Number(selectedSheetId) === Number(sheet.id);
  /** Redundant "Continue draft" only when this same draft is selected+open and no other draft exists. */
  const continueDraftRedundant = draftUi && selectionMatchesOpenDraft && !hasOtherUnfinishedDraft;

  const primaryMode: "DRAFT" | "EMPTY" | "LOCKED" = draftUi ? "DRAFT" : lockedUi ? "LOCKED" : "EMPTY";
  const safeLines: SheetLine[] = Array.isArray(sheet?.lines) ? sheet!.lines : [];
  /** True when no suggested WO remains on any line (includes carry-forward covered by operational stock). */
  const isZeroPlanning =
    isNoQty &&
    (safeLines.length === 0 || safeLines.every((l) => Math.abs(computeDraftProductionRequired(l)) <= PLAN_EPS));

  // TEMP DEBUG (remove after fixing blank screen)
  // Helps identify runtime null/undefined states during render.
  // eslint-disable-next-line no-console
  console.debug("[RS_RENDER_DEBUG]", {
    soId,
    isNoQty,
    sheetId: sheet?.id ?? null,
    selectedSheetId,
    sheetsCount: Array.isArray(sheets) ? sheets.length : null,
    cycleScopedSheetsCount: Array.isArray(cycleScopedSheets) ? cycleScopedSheets.length : null,
    showCreatePanel,
  });

  const {
    state: noQtyFlowState,
    loading: noQtyFlowLoading,
    error: noQtyFlowError,
  } = useNoQtyFlowState(
    Number.isFinite(soId) && soId > 0 ? soId : null,
    Boolean(soId > 0 && (fromNoQtySo || isNoQty)),
  );

  const effectiveNextAction: NoQtyNextAction | null = React.useMemo(() => {
    if (noQtyFlowState?.nextAction) return noQtyFlowState.nextAction;
    // If API is still loading, avoid guessing for a moment.
    if (noQtyFlowLoading) return null;
    // Fallback only when API is unavailable/failed.
    if (!sheet || sheet.status !== "LOCKED") return null;
    if (sheet.workOrderId != null && Number(sheet.workOrderId) > 0) return "PRODUCTION";
    return "WORK_ORDER";
  }, [noQtyFlowState?.nextAction, noQtyFlowLoading, sheet]);

  const suppressDraftWarningBanner =
    justCreatedSheetId != null && sheet?.id != null && Number(sheet.id) === Number(justCreatedSheetId) && sheet.status === "DRAFT";

  // Reveal create panel automatically only when create is the primary mode.
  React.useEffect(() => {
    if (primaryMode === "EMPTY") {
      setShowCreatePanel(true);
      return;
    }
    // In DRAFT/LOCKED modes, keep create panel hidden unless user explicitly asks for "Create New Version".
    setShowCreatePanel(false);
  }, [primaryMode, activePlanningCycleId]);

  if (!Number.isFinite(soId) || soId <= 0) {
    return (
      <PageContainer>
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">Invalid sales order.</div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <RequirementSheetErrorBoundary>
      <div className="min-w-0 space-y-1">
        <DemoFlowBanner />
        <h1 className="text-lg font-semibold leading-snug text-slate-900">Requirement sheet</h1>
        {isNoQty ? (
          <p className="text-sm leading-relaxed text-slate-600">Enter requirement and finalize to create Work Order.</p>
        ) : null}
        {isNoQty && fromNoQtySo ? (
          <PageNoQtyFlowBackLink step="REQUIREMENT" className="mt-1" />
        ) : isNoQty ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 gap-1 px-0 text-slate-600"
            onClick={() => nav("/sales-orders?soType=NO_QTY")}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            Back to No Qty Sales Orders
          </Button>
        ) : null}

        {isNoQty ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-800">
            <span className="font-mono tabular-nums text-slate-900">{displaySalesOrderNo(soId, so?.docNo)}</span>
            <span className="text-slate-400" aria-hidden>
              |
            </span>
            <span className="truncate text-slate-900">{customerName}</span>
            <span className="text-slate-400" aria-hidden>
              |
            </span>
            <span className="text-slate-900">
              {cycleStatus === "Next Cycle" ? "Next cycle" : cycleNo != null ? `Cycle ${cycleNo}` : "Cycle —"}{" "}
              <span className={cn("font-medium", cycleStatus === "Active Cycle" ? "text-emerald-700" : "text-slate-600")}>
                (
                {cycleStatus === "Active Cycle"
                  ? "Active"
                  : cycleStatus === "Next Cycle"
                    ? "Will create"
                    : "Closed"}
                )
              </span>
            </span>
          </div>
        ) : null}
        <p className="text-sm leading-relaxed text-slate-600">
          {isNoQty ? null : (
            <>
              <span className="inline-flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">SO No</span>
                <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-sky-900">
                  {displaySalesOrderNo(soId, so?.docNo)}
                </span>
              </span>{" "}
              <span className="text-slate-400">·</span> {customerName}
            </>
          )}
        </p>
        {!isNoQty ? (
          <>
            <p className="text-xs leading-relaxed text-slate-600">
              <span className="font-medium text-slate-800">Last shortage qty</span>: Pending shortage from previous cycles. It will carry forward until produced or SO is
              closed.
            </p>
            <p className="text-xs leading-relaxed text-slate-600">
              <span className="font-medium text-slate-800">Total to Produce</span> = Last shortage + New requirement − Free usable stock
            </p>
            <p className="text-xs leading-relaxed text-slate-600 border-l-2 border-sky-200 bg-sky-50/50 pl-2 py-1">
              <span className="font-medium text-slate-800">Status column:</span> Thresholds are inclusive: when gap % reaches a threshold exactly, that zone applies.
            </p>
          </>
        ) : (
          <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-[12px] font-medium text-slate-700">More info</summary>
            <div className="mt-1 space-y-1 text-[12px] text-slate-700">
              <div>
                <span className="font-medium">Draft</span> = editable · <span className="font-medium">Locked</span> = used for production planning
              </div>
              <div>Last shortage Qty is computed automatically (carry-forward for this cycle).</div>
              <div>
                Total to Produce = max(0, Last shortage qty + New requirement qty − Free usable stock).
              </div>
            </div>
          </details>
        )}
        {addRequirementIntent ? (
          <p className="text-xs leading-relaxed text-slate-700 border-l-2 border-emerald-200 bg-emerald-50/60 pl-2 py-1">
            <span className="font-medium text-emerald-900">Create Requirement Sheet:</span> New sheets attach to this SO&apos;s{" "}
            <span className="font-medium">current active cycle</span> (same sales order — no need to create another No Qty SO). Use a new period or a new
            version for the same period if you are revising the requirement.
          </p>
        ) : null}
      </div>

      {!so && sheets.length === 0 && !error ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">Loading…</div>
      ) : null}

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
      {success ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{success}</div> : null}

      {isNoQty && justDeletedDraft && noSheetsUi ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <div className="font-semibold">Draft deleted. Create a new requirement sheet</div>
          <div className="mt-0.5 text-xs text-amber-900">You can now create a fresh requirement sheet for this cycle.</div>
        </div>
      ) : isNoQty && noSheetsUi ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          <div className="font-semibold">No requirement sheet created yet</div>
          <div className="mt-0.5 text-xs text-slate-600">Create a requirement sheet for this cycle to begin planning.</div>
        </div>
      ) : isNoQty && draftUi && !suppressDraftWarningBanner ? (
        <div
          className={
            isZeroPlanning
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
              : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          }
        >
          {isZeroPlanning ? (
            <>
              <div className="font-semibold">No production required — stock is sufficient. You can proceed to dispatch.</div>
              <div className="mt-0.5 text-xs text-emerald-900">Finalize to continue in the NO_QTY flow.</div>
            </>
          ) : (
            <>
              <div className="font-semibold">You have an unfinished draft requirement sheet</div>
              <div className="mt-0.5 text-xs text-amber-900">Continue the draft and finalize when ready.</div>
            </>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={continueDraftRedundant ? "outline" : "default"}
              disabled={!sheet || sheet.status !== "DRAFT" || continueDraftRedundant}
              title={
                continueDraftRedundant
                  ? "This draft is already open — use the version selector to open a different draft if needed."
                  : "Scroll to line items"
              }
              onClick={() => {
                if (continueDraftRedundant) return;
                window.requestAnimationFrame(() => {
                  document.getElementById("rs-items")?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
            >
              {continueDraftRedundant ? "Current draft open" : "Continue draft"}
            </Button>
            {!isNoQty ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const pad = (n: number) => String(n).padStart(2, "0");
                const d = new Date();
                setPeriodKey(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
                setShowCreatePanel(true);
                createNewSheetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              Create new version
            </Button>
            ) : null}
          </div>
        </div>
      ) : isNoQty && draftUi && suppressDraftWarningBanner ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          <div className="font-semibold">Requirement sheet created</div>
          <div className="mt-0.5 text-xs text-slate-600">Enter New requirement Qty, then finalize when ready.</div>
        </div>
      ) : isNoQty && lockedUi && sheet && !addRequirementIntent && !showCreatePanel ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          <div className="font-semibold">Requirement sheet is locked and used for planning</div>
          <div className="mt-0.5 text-xs text-slate-600">This sheet is the basis for production planning in this cycle.</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <details className="relative">
              <summary className="cursor-pointer select-none rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-700">
                ⋯
              </summary>
              <div className="absolute left-0 z-10 mt-1 grid w-64 gap-1 rounded-md border border-slate-200 bg-white p-2 text-[13px] shadow-lg">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => document.getElementById("rs-items")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  View requirement
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => openCreateNewRequirementSheet(true)}
                >
                  Create new requirement sheet
                </Button>
                {isAdmin ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => void voidLockedSheet()}
                  >
                    Void this RS
                  </Button>
                ) : null}
              </div>
            </details>
            {(() => {
              const next = effectiveNextAction;
              const cycleId = noQtyFlowState?.cycleId ?? null;
              if (!next) {
                return (
                  <div className="grid gap-1">
                    <div className="text-xs font-semibold text-slate-700">
                      {noQtyFlowError ? "Next step: unavailable" : "Next step: Loading…"}
                    </div>
                    <Button type="button" size="sm" disabled>
                      {noQtyFlowError ? "Try again" : "Loading…"}
                    </Button>
                  </div>
                );
              }

              const label =
                next === "WORK_ORDER"
                  ? "Next step: Work Order"
                  : next === "PRODUCTION"
                    ? "Next step: Production"
                    : next === "QC"
                      ? "Next step: QC"
                      : next === "DISPATCH"
                        ? "Next step: Dispatch"
                        : "Next step: Sales Bill";

              const btn =
                next === "WORK_ORDER"
                  ? "Go to Work Order"
                  : next === "PRODUCTION"
                    ? "Go to Production"
                    : next === "QC"
                      ? "Go to QC"
                      : next === "DISPATCH"
                        ? "Go to Dispatch"
                        : "Go to Sales Bill";

              const to =
                next === "WORK_ORDER"
                  ? buildNoQtyGuidedHref({
                      to: "/work-orders?soMode=NO_QTY",
                      salesOrderId: sheet.salesOrderId,
                      cycleId,
                      fromStep: "requirement",
                    })
                  : next === "PRODUCTION"
                    ? buildNoQtyGuidedHref({
                        to: "/production",
                        salesOrderId: sheet.salesOrderId,
                        cycleId,
                        fromStep: "requirement",
                      })
                    : next === "QC"
                      ? buildNoQtyGuidedHref({
                          to: "/qc-entry",
                          salesOrderId: sheet.salesOrderId,
                          cycleId,
                          fromStep: "production",
                        })
                      : next === "DISPATCH"
                        ? buildNoQtyGuidedHref({
                            to: "/dispatch",
                            salesOrderId: sheet.salesOrderId,
                            cycleId,
                            fromStep: "qc",
                          })
                        : buildNoQtyGuidedHref({
                            to: "/sales-bills",
                            salesOrderId: sheet.salesOrderId,
                            cycleId,
                            fromStep: "dispatch",
                          });

              return (
                <Link to={to} className="shrink-0">
                  <div className="grid gap-1">
                    <div className="text-xs font-semibold text-slate-700">{label}</div>
                    <Button type="button" size="sm">
                      {btn}
                    </Button>
                  </div>
                </Link>
              );
            })()}
            {!isNoQty ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const pad = (n: number) => String(n).padStart(2, "0");
                const d = new Date();
                setPeriodKey(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
                setShowCreatePanel(true);
                createNewSheetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              Create new version
            </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {sheet ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-800">
              <span className="text-[12px] font-medium text-slate-600">Version</span>
              <select
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[13px]"
                value={selectedSheetId ?? ""}
                disabled={!hasAnySheets}
                onChange={(e) => setSelectedSheetId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{hasAnySheets ? "Select…" : "No versions"}</option>
                {(Array.isArray(cycleScopedSheets) ? cycleScopedSheets : []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.periodKey ?? "—")} · v{String(s.version ?? 1)} · {s.status}
                  </option>
                ))}
              </select>
              <Badge variant={sheet.status === "LOCKED" ? "success" : "warning"}>
                {sheet.status === "LOCKED" ? "Locked" : "Draft"}
              </Badge>
              {showOlderVersionBanner ? <Badge variant="default">Older version</Badge> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!sheet || editingDisabled || busy || isZeroPlanning}
                onClick={() => void recalc()}
              >
                Recalculate
              </Button>
              <Button type="button" size="sm" disabled={!sheet || editingDisabled || busy || needsRecalc} onClick={() => void lockSheet()}>
                {isZeroPlanning ? "Proceed to Dispatch" : "Finalize Requirement"}
              </Button>
              <details className="relative">
                <summary className="cursor-pointer select-none rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-700">
                  ⋯
                </summary>
                <div className="absolute right-0 z-10 mt-1 grid w-52 gap-1 rounded-md border border-slate-200 bg-white p-2 text-[13px] shadow-lg">
                  {sheet.status === "DRAFT" && isLatestForPeriod ? (
                    <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void deleteDraftSheet()}>
                      Delete draft
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" disabled={!sheet || editingDisabled || busy} onClick={() => void saveDraft()}>
                    Save draft
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={!sheet || busy || needsRecalc} onClick={() => setWoPreviewOpen((o) => !o)}>
                    {woPreviewOpen ? "Hide WO plan" : "WO plan (preview)"}
                  </Button>
                  {!isNoQty ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        const pad = (n: number) => String(n).padStart(2, "0");
                        const d = new Date();
                        setPeriodKey(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
                        setShowCreatePanel(true);
                        createNewSheetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                    >
                      Create new version
                    </Button>
                  ) : null}
                </div>
              </details>
            </div>
          </div>
        </div>
      ) : null}

      {(!sheet || showCreatePanel) ? (
      <div className={noSheetsUi ? "grid gap-6 lg:grid-cols-1" : "grid gap-6 lg:grid-cols-2"}>
        <Card className="min-w-0 overflow-hidden">
          {!sheet ? (
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{primaryMode === "EMPTY" ? "Create requirement sheet" : "Versions"}</CardTitle>
            </CardHeader>
          ) : null}
          <CardContent className="grid gap-3">
            {hasAnySheets && !sheet ? (
              <div className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">Select version</span>
                <select
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={selectedSheetId ?? ""}
                  onChange={(e) => setSelectedSheetId(e.target.value ? Number(e.target.value) : null)}
                >
                  {(Array.isArray(cycleScopedSheets) ? cycleScopedSheets : []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.periodKey ?? "—")} · v{String(s.version ?? 1)} · {s.status}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {showCreatePanel ? (
              <div
                ref={createNewSheetRef}
                className={
                  addRequirementIntent
                    ? "grid gap-2 rounded-md border border-emerald-300 bg-emerald-50/40 p-3 ring-1 ring-emerald-200/70"
                    : "grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
                }
              >
                <div className="text-xs font-medium text-slate-700">
                  {isNoQty ? "Create requirement sheet" : primaryMode === "EMPTY" ? "Start requirement sheet" : "Create new version"}
                </div>
                <div className="text-xs text-slate-600">
                  <span className="font-medium text-slate-800">Only selected items will be planned in this cycle.</span>{" "}
                  Select the FG items you want to plan. Items are not auto-included.
                </div>
                {sheet?.status && (sheet.periodKey ?? "").trim() && periodKey.trim() === String(sheet.periodKey ?? "").trim() ? (
                  <div className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                    <div className="font-semibold text-slate-800">Previous version items (reference)</div>
                    <div className="mt-0.5 text-slate-600">
                          {(sheet?.lines || []).map((l) => l.itemName).join(", ") || "—"}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">These are not auto-selected. Choose items below.</div>
                  </div>
                ) : null}
                {(() => {
                  const opts = fgItemOptionsFromSo(so);
                  if (opts.length === 0) {
                    return (
                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        No FG items found on this sales order.
                      </div>
                    );
                  }
                  return (
                    <div className="grid gap-2">
                      <div className="grid gap-1">
                        <span className="text-xs font-medium text-slate-600">FG items in this sales order</span>
                        <div className="grid gap-1">
                          {opts.map((o) => {
                            const checked = createSelectedItemIds.includes(o.itemId);
                            return (
                              <label key={o.itemId} className="flex items-center gap-2 text-sm text-slate-800">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={busy}
                                  onChange={(e) => {
                                    const next = Boolean(e.target.checked);
                                    setCreateSelectedItemIds((prev) => {
                                      const set = new Set(prev);
                                      if (next) set.add(o.itemId);
                                      else set.delete(o.itemId);
                                      return [...set];
                                    });
                                  }}
                                />
                                <span className="text-sm">{o.itemName}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            busy ||
                            !sheet ||
                            String(sheet.periodKey ?? "").trim() === "" ||
                            periodKey.trim() !== String(sheet.periodKey ?? "").trim() ||
                            !Array.isArray(sheet?.lines) ||
                            (sheet?.lines?.length ?? 0) === 0
                          }
                          onClick={() => {
                            if (!sheet) return;
                            if (periodKey.trim() !== String(sheet.periodKey ?? "").trim()) return;
                            const prevIds = (sheet?.lines || [])
                              .map((l) => Number(l.itemId))
                              .filter((x) => Number.isFinite(x) && x > 0);
                            const allowed = new Set(opts.map((x) => x.itemId));
                            const next = [...new Set(prevIds.filter((id) => allowed.has(id)))];
                            setCreateSelectedItemIds(next);
                          }}
                        >
                          Copy previous selection
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setCreateSelectedItemIds(opts.map((x) => x.itemId))}
                        >
                          Select all
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setCreateSelectedItemIds([])}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  );
                })()}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <span className="text-xs font-medium text-slate-600">Period (YYYY-MM)</span>
                    <Input
                      autoFocus={Boolean(addRequirementIntent && primaryMode === "EMPTY")}
                      value={periodKey}
                      onChange={(e) => setPeriodKey(e.target.value)}
                      placeholder="2026-04"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="button" className="w-full" disabled={busy} onClick={() => void createNewSheet()}>
                      {busy ? "Working…" : "Create Requirement Sheet"}
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-slate-500">Multiple versions per period are supported (v1, v2, v3…).</div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {noSheetsUi ? null : (
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Sheet details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {sheet ? (
                <>
                  <Badge variant={sheet.status === "LOCKED" ? "success" : "warning"}>{sheet.status === "LOCKED" ? "Locked" : "Draft"}</Badge>
                  {sheet.status === "DRAFT" ? (
                    <span className="text-xs text-slate-500">Draft = not locked yet, editable</span>
                  ) : (
                    <span className="text-xs text-slate-500">Locked = used for production planning</span>
                  )}
                  <span className="text-xs text-slate-600">
                    {(sheet.periodKey ?? "—")} · v{String(sheet.version ?? 1)}
                  </span>
                  {showOlderVersionBanner ? <Badge variant="default">Older version (view only)</Badge> : null}
                </>
              ) : (
                <span className="text-sm text-slate-600">Select a version to view details.</span>
              )}
            </div>

            {showOlderVersionBanner ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                This is not the latest version for this period. Planning actions are disabled.
              </div>
            ) : null}

            <div className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Remarks</span>
              <Input
                value={remarks}
                disabled={editingDisabled || !sheet}
                onChange={(e) => {
                  setRemarks(e.target.value);
                  if (!locked) setNeedsRecalc(true);
                }}
                placeholder="Optional"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {sheet && sheet.status === "DRAFT" && isLatestForPeriod ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void deleteDraftSheet()}
                >
                  {busy ? "Working…" : "Delete draft"}
                </Button>
              ) : null}
              <Button type="button" variant="outline" disabled={!sheet || editingDisabled || busy} onClick={() => void saveDraft()}>
                Save draft
              </Button>
              <Button type="button" variant="outline" disabled={!sheet || editingDisabled || busy || isZeroPlanning} onClick={() => void recalc()}>
                Recalculate
              </Button>
              <Button type="button" disabled={!sheet || editingDisabled || busy || needsRecalc} onClick={() => void lockSheet()}>
                {isZeroPlanning ? "Proceed to Dispatch" : "Finalize Requirement"}
              </Button>
              {sheet ? (
                <>
                  {locked ? (
                    <div className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <div className="font-semibold text-slate-800">Work Order behavior (No Qty SO)</div>
                      <div className="mt-0.5">
                        When a Requirement Sheet is locked, the system <span className="font-semibold">auto-creates</span> a Work Order for positive Suggested WO qty.
                        Use “Create Work Order (if missing)” only if a legacy sheet did not create one.
                      </div>
                      {existingWorkOrderForSheet ? (
                        <div className="mt-1">
                          <Link
                            to={`${workOrdersFocusHref(Number(sheet.workOrderId))}&source=no_qty_so&salesOrderId=${sheet.salesOrderId}`}
                            className="font-medium text-primary underline underline-offset-4"
                          >
                            View Work Order #{sheet.workOrderId}
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {locked ? (
                    <Button type="button" disabled={!canCreateWorkOrderDirect} onClick={() => void createWorkOrderDirect()}>
                      {busy ? "Working…" : existingWorkOrderForSheet ? "Work Order ready" : "Create Work Order"}
                    </Button>
                  ) : null}
                  <Link to={`/requirement-sheets/${sheet.id}/wo-plan`} className="shrink-0">
                    <Button type="button" variant="outline" disabled={busy}>
                      WO plan (preview)
                    </Button>
                  </Link>
                </>
              ) : null}
            </div>

            {!locked && sheet ? (
              <div className="text-xs text-slate-600">
                {needsRecalc ? (
                  <span className="font-medium text-amber-800">Recalculate required before locking to use latest stock.</span>
                ) : (
                  <span>Tip: Recalculate before locking to snapshot the latest stock.</span>
                )}
              </div>
            ) : null}
            </CardContent>
          </Card>
        )}
      </div>
      ) : null}

      {sheet ? (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Items</CardTitle>
          </CardHeader>
          <CardContent id="rs-items" className="min-w-0 p-0 sm:p-6 sm:pt-0">
            {noQtyPlanningSummary ? (
              <div className="border-b border-slate-200 px-3 py-3 sm:px-6">
                <div className="text-xs font-semibold text-slate-800">Planning Summary</div>
                <div className="mt-1.5 space-y-0.5 text-xs leading-relaxed text-slate-700">
                  <div>Total items: {noQtyPlanningSummary.total}</div>
                  {noQtyPlanningSummary.covered > 0 ? (
                    <div className="text-emerald-800">
                      ✔ {noQtyPlanningSummary.covered} item{noQtyPlanningSummary.covered === 1 ? "" : "s"} fully covered by stock
                    </div>
                  ) : null}
                  {noQtyPlanningSummary.shortage > 0 ? (
                    <div className="text-amber-800">⚠ {noQtyPlanningSummary.shortage} item{noQtyPlanningSummary.shortage === 1 ? "" : "s"} need production</div>
                  ) : null}
                  {noQtyPlanningSummary.excess > 0 ? (
                    <div className="text-amber-800">
                      ⚠ {noQtyPlanningSummary.excess} item{noQtyPlanningSummary.excess === 1 ? "" : "s"} {noQtyPlanningSummary.excess === 1 ? "has" : "have"} excess planned
                    </div>
                  ) : null}
                  {noQtyPlanningSummary.needsRecalc ? (
                    <div className="text-amber-900/90">Recalculate to see the latest planning impact.</div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {safeLines.length > 0 ? (
              <div className="min-w-0 overflow-x-auto px-3 pb-4 sm:px-0 sm:pb-0">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                      <th className="px-4 py-2">Item</th>
                      <th className="px-4 py-2 text-right">Last shortage qty</th>
                      <th className="px-4 py-2 text-right">New requirement qty</th>
                      <th className="px-4 py-2 text-right bg-slate-50">{isNoQty ? "Total to Produce" : "Suggested WO qty"}</th>
                      <th className="px-4 py-2 text-right">{isNoQty ? "Available for this RS" : "Usable stock"}</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {safeLines.map((l) => {
                    const shortfall = safeNum(l.shortfallQty);
                    const rawNewWo = String(l.newWoQty ?? l.requirementQty ?? "");
                    const newWo =
                      !locked && (rawNewWo === "" || rawNewWo === "0" || Number(rawNewWo) === 0) ? "" : rawNewWo;
                    const stock = usableDisplayStock(l.availableStockQty);
                    const fmtPlan = (n: number) => n.toFixed(3).replace(/\.000$/, "");
                    const newReqNum = safeNum(rawNewWo);
                    const productionRequired = locked
                      ? safeNum(l.totalWoQty ?? l.productionRequiredQty)
                      : needsRecalc
                        ? computeDraftProductionRequired(l)
                        : safeNum(l.totalWoQty ?? computeDraftProductionRequired(l));
                    const suggestedNet = locked ? safeNum(l.suggestedWoQty) : computeSystemSuggestedNet(newReqNum, stock);
                    const effectiveDemand = shortfall + newReqNum;

                    const noProduction = Math.abs(productionRequired) <= 1e-6;
                    const reservedForDispatch = isNoQty && !locked && (l.qcStockNote ?? "").includes("reserved for dispatch");
                    const status =
                      effectiveDemand <= 1e-6
                        ? { kind: "neutral" as const, label: "Awaiting requirement", help: "Enter requirement qty" }
                        : reservedForDispatch
                          ? {
                              kind: "neutral" as const,
                              label: "Stock reserved for dispatch",
                              help: "Not available for planning",
                            }
                        : noProduction && stock + 1e-6 >= effectiveDemand
                        ? { kind: "covered" as const, label: "Covered by stock", help: "Stock available — no WO needed" }
                        : productionRequired > 0 && stock > 0
                          ? { kind: "partial" as const, label: "Partially covered by stock", help: null }
                          : productionRequired > 0 && stock <= 1e-6
                            ? { kind: "required" as const, label: "WO required", help: null }
                            : { kind: "neutral" as const, label: "—", help: null };

                    const rowTone =
                      status.kind === "covered"
                        ? "bg-emerald-50/40"
                        : status.kind === "partial"
                          ? "bg-amber-50/30"
                          : status.kind === "required"
                            ? "bg-sky-50/20"
                            : "";

                    const planMsg = isNoQty && !locked ? getNoQtyRowPlanning(l, false, needsRecalc) : null;

                    return (
                      <React.Fragment key={l.itemId}>
                        <tr className={`border-b border-slate-100 align-middle ${rowTone}`}>
                          <td className="px-4 py-2">
                            <div className="font-medium text-slate-900">{l.itemName}</div>
                            {l.qcStockNote ? <div className="mt-0.5 text-[11px] text-slate-600">{l.qcStockNote}</div> : null}
                            {isNoQty && !locked && (l.reservedPendingDispatchQty ?? 0) > 0 ? (
                              <div className="mt-0.5 text-[11px] text-slate-600">
                                Usable stock is reserved because earlier cycle has {Number(l.reservedPendingDispatchQty || 0).toFixed(3).replace(/\.000$/, "")} qty pending dispatch.
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="tabular-nums text-slate-800">{shortfall.toFixed(3).replace(/\.000$/, "")}</div>
                            {isNoQty && shortfall > PLAN_EPS ? (
                              <div className="mt-0.5 text-[11px] text-slate-600">
                                Pending shortage from previous cycles (carry-forward).
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <Input
                                className="h-9 w-32 text-right tabular-nums"
                                disabled={editingDisabled}
                                value={newWo}
                                onChange={(e) => {
                                  const nextVal = e.target.value;
                                  setSheet((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          lines: prev.lines.map((x) =>
                                            x.itemId === l.itemId ? { ...x, newWoQty: nextVal, requirementQty: nextVal } : x,
                                          ),
                                        }
                                      : prev,
                                  );
                                  if (!locked) setNeedsRecalc(true);
                                }}
                                placeholder=""
                                onBlur={() => {
                                  if (!locked) setNeedsRecalc(true);
                                }}
                              />
                              {!isNoQty && !locked && !editingDisabled && Number.isFinite(newReqNum) ? (
                                newReqNum <= 0 ? (
                                  <span className="text-[11px] text-slate-500">Enter demand for this cycle (optional)</span>
                                ) : stock + 1e-6 >= newReqNum ? (
                                  <span className="text-[11px] font-medium text-emerald-800">
                                    Covered by available stock — no WO needed
                                  </span>
                                ) : stock > 0 ? (
                                  <span className="text-[11px] text-amber-900">
                                    WO required for remaining qty ({Math.max(0, newReqNum - stock).toFixed(3).replace(/\.000$/, "")})
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-sky-900">WO required (no usable stock)</span>
                                )
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900 bg-slate-50">
                            {fmtPlan(isNoQty ? productionRequired : suggestedNet)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                            {l.availableStockQty == null || l.availableStockQty === "" ? (
                              "—"
                            ) : (
                              <div className="flex flex-col items-end gap-0.5">
                                <div>{fmtPlan(stock)}</div>
                                {isNoQty && !locked ? (
                                  (() => {
                                    const usableTotal = usableDisplayStock(l.usableTotalQty ?? usableByItemId[l.itemId] ?? null);
                                    const reservedDemand = usableDisplayStock(l.reservedPendingDispatchQty ?? 0);
                                    const reservedApplied = usableDisplayStock(l.reservedPendingDispatchAppliedQty ?? Math.min(usableTotal, reservedDemand));
                                    if (!(usableTotal > 0) && !(stock > 0)) return null;
                                    return (
                                      <div className="text-[11px] text-slate-500">
                                        Usable {fmtPlan(usableTotal)} · Reserved for pending dispatch {fmtPlan(reservedApplied)}/{fmtPlan(reservedDemand)} · Free {fmtPlan(stock)}
                                      </div>
                                    );
                                  })()
                                ) : null}
                                {isNoQty && !locked ? (
                                  <div className="mt-0.5 flex flex-wrap justify-end gap-2 text-[11px]">
                                    <Link
                                      className="text-primary underline underline-offset-2"
                                      to={buildNoQtyGuidedHref({
                                        to: "/dispatch",
                                        salesOrderId: soId,
                                        cycleId: activePlanningCycleId ?? null,
                                        fromStep: "qc",
                                      })}
                                    >
                                      Go to Dispatch
                                    </Link>
                                    <Link
                                      className="text-primary underline underline-offset-2"
                                      to={buildNoQtyGuidedHref({
                                        to: "/production",
                                        salesOrderId: soId,
                                        cycleId: activePlanningCycleId ?? null,
                                        fromStep: "requirement",
                                      })}
                                    >
                                      Continue with fresh production
                                    </Link>
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {status.kind === "covered" ? (
                              <div className="flex items-center gap-2">
                                <Badge variant="success" className="shrink-0">
                                  <span className="inline-flex items-center gap-1">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Covered by stock
                                  </span>
                                </Badge>
                                <span className="text-xs font-medium text-emerald-800">Stock available — no WO needed</span>
                              </div>
                            ) : status.kind === "partial" ? (
                              <div className="flex items-center gap-2 text-amber-900">
                                <Badge variant="warning" className="shrink-0">
                                  <span className="inline-flex items-center gap-1">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    Partially covered
                                  </span>
                                </Badge>
                                <span className="text-xs text-slate-600">
                                  {isNoQty ? "Free usable stock reduces WO qty" : "Usable stock reduces WO qty"}
                                </span>
                              </div>
                            ) : status.kind === "required" ? (
                              <div className="flex items-center gap-2 text-slate-800">
                                <Badge variant="info" className="shrink-0">
                                  <span className="inline-flex items-center gap-1">
                                    <Info className="h-3.5 w-3.5" />
                                    WO required
                                  </span>
                                </Badge>
                                <span className="text-xs text-slate-600">No usable stock available</span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">{status.label}</span>
                            )}
                          </td>
                        </tr>
                        {planMsg ? (
                          <tr className={`border-b border-slate-100 ${rowTone}`}>
                            <td colSpan={6} className="px-4 pb-2.5 pt-0">
                              {planMsg.kind === "covered" ? (
                                <span className="text-[11px] leading-snug text-emerald-800">{planMsg.text}</span>
                              ) : planMsg.kind === "carryforward" ? (
                                <span className="text-[11px] leading-snug text-amber-800">{planMsg.text}</span>
                              ) : planMsg.kind === "excess" ? (
                                <span className="text-[11px] leading-snug text-amber-800">
                                  ⚠ Recommended production is {fmtPlan(planMsg.suggestedNet)}. Producing{" "}
                                  {fmtPlan(planMsg.newReq)} will create excess stock of {fmtPlan(planMsg.diff)} units.
                                </span>
                              ) : (
                                <span className="text-[11px] leading-snug text-slate-800">
                                  {fmtPlan(planMsg.fulfillFromStock)} will be fulfilled from stock,{" "}
                                  {fmtPlan(planMsg.needProduction)} need production.
                                </span>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-3 py-4 text-sm text-slate-600 sm:px-6">
                Loading items…
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {sheet ? (
        <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-medium text-slate-700">Summary</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total last shortage</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                {summary.shortfallSum.toFixed(3).replace(/\.000$/, "")}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">New requirement qty</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                {summary.newWoSum.toFixed(3).replace(/\.000$/, "")}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Suggested WO qty</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                {summary.totalWoSum.toFixed(3).replace(/\.000$/, "")}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {isNoQty ? "Free usable stock" : "Usable stock"}
              </div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                {summary.stockSum.toFixed(3).replace(/\.000$/, "")}
              </div>
            </div>
          </div>
        </details>
      ) : null}

      {sheet ? (
        <div className="mt-4 max-w-3xl">
          <ActivityHistoryCard title="History" query={`entityType=REQUIREMENT_SHEET&entityId=${sheet.id}&limit=50`} />
        </div>
      ) : null}
      </RequirementSheetErrorBoundary>
    </PageContainer>
  );
}

