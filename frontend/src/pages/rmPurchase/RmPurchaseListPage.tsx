import * as React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { deleteUrlParamKeys } from "../../lib/urlSearchParamsPatch";
import { DrillFocusBanner } from "../../components/DrillFocusBanner";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../../hooks/useUrlQueryState";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { ErpEmptyState, ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../../components/erp/foundation";
import { erpKpi, erpTable } from "../../lib/erpFoundationTokens";
import {
  DRILL_FOCUS_EMPTY_FILTERED_SUFFIX,
  DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS,
  DRILL_FOCUS_HINT_NOT_IN_LIST,
  DRILL_RECOVERY_LABEL,
  drillFocusTitleRmPo,
} from "../../lib/drillFocusCopy";
import { DRILL_DATA, DRILL_QUERY, withReportsReturnContextIfPresent } from "../../lib/drillDownRoutes";
import { useDrillFocus } from "../../hooks/useDrillFocus";
import { apiFetch } from "../../services/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useShortcutHints } from "../../hooks/useShortcutHints";
import { FieldShortcutHint } from "../../components/ui/FieldShortcutHint";
import { FIELD_HINT_GRID_NAV, FIELD_HINT_PO_SUPPLIER, FIELD_HINT_SAVE } from "../../lib/shortcutHintCopy";
import { ErpModal } from "../../components/erp/ErpModal";
import {
  buildInitialPoLine,
  computeLineAmount,
  deriveRmLineDisplayFromItem,
  formatRmPoNo,
  type Item,
  type PoLineDraft,
  type RmPoRow,
  poStatusLabel,
  type Supplier,
} from "./rmPurchaseShared";
import { PageBackLink, PageContainer, StickyWorkspaceHead } from "../../components/PageHeader";
import { resolveRmPurchaseBackNav } from "./rmPurchaseBackNav";
import { Package, Search, X } from "lucide-react";
import { suppressMouseFocusOnDrillRow } from "../../lib/drillDownRowProps";
import { cn } from "../../lib/utils";
import { useFastEntryForm } from "../../hooks/useFastEntryForm";
import { useModalFocusRestore } from "../../hooks/useModalFocusRestore";
import { ProcurementQueueContextBanner } from "../../components/erp/ProcurementQueueContextBanner";
import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";
import { PendingMaterialRequestsPanel } from "../../components/purchase/PendingMaterialRequestsPanel";
import { useAuth } from "../../hooks/useAuth";
import { hasErpRole, PURCHASE_EXECUTION_ROLES } from "../../config/erpRoles";

type PurchaseMeta = { testingModeRelaxedTaxFields: boolean };

const RM_PO_GRN_URL_OMIT: Record<string, string> = { poStatus: "ALL" };
const DIRECT_PO_DISABLED_MESSAGE =
  "Direct RM PO creation is blocked. Create POs only from approved Store RM Requisitions in the pending requests queue.";

function rmPoCreatedAt(r: RmPoRow): string | undefined {
  const v = (r as { createdAt?: string }).createdAt;
  return typeof v === "string" && v.trim() ? v : undefined;
}

function formatPoListDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function poStatusBadgeClass(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "border-emerald-200/90 bg-emerald-50 text-emerald-900";
    case "PARTIAL":
      return "border-amber-200/90 bg-amber-50 text-amber-950";
    case "PENDING":
      return "border-sky-200/90 bg-sky-50 text-sky-950";
    case "CANCELLED":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-800";
  }
}

export function RmPurchaseListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const canPrepareRmPo = hasErpRole(user?.role, PURCHASE_EXECUTION_ROLES);
  const [navSearchParams] = useSearchParams();

  const rmPurchaseBackNav = React.useMemo(
    () =>
      resolveRmPurchaseBackNav(new URLSearchParams(location.search), {
        defaultRoute: "/dashboard",
        defaultLabel: "Back to Dashboard",
      }),
    [location.search],
  );
  const { searchParams, setSearchParams, patch, read } = useUrlQueryState(RM_PO_GRN_URL_OMIT);
  const focusPoId = Number(searchParams.get(DRILL_QUERY.rmPoId)) || 0;
  const focusPendingRequests = searchParams.get("focus") === "pending-requests";
  const focusOpenPos = searchParams.get("focus") === "open-pos";
  const poStatusFilter = read.enum("poStatus", ["ALL", "OPEN", "COMPLETED", "CANCELLED"] as const, "ALL");
  const qFromUrl = read.string("q");
  const [qDraft, setQDraft] = useDebouncedUrlStringParam({ urlValue: qFromUrl, patch, paramKey: "q" });

  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [rows, setRows] = React.useState<RmPoRow[]>([]);
  const [listLoaded, setListLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [newPoOpen, setNewPoOpen] = React.useState(false);
  const [supplierId, setSupplierId] = React.useState(0);
  const [poRemarks, setPoRemarks] = React.useState("");
  const [poLines, setPoLines] = React.useState<PoLineDraft[]>([]);
  const [purchaseMeta, setPurchaseMeta] = React.useState<PurchaseMeta | null>(null);
  const [creatingPo, setCreatingPo] = React.useState(false);

  const relaxedTax = Boolean(purchaseMeta?.testingModeRelaxedTaxFields);

  const supplierSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const newPoModalFormRef = React.useRef<HTMLDivElement | null>(null);
  const poItemSelectRefs = React.useRef<(HTMLSelectElement | null)[]>([]);
  const poQtyInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const poRateInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const noQtyShortagePrefillDoneRef = React.useRef(false);
  const rmShortagePrefillDoneRef = React.useRef(false);

  const [lineTouched, setLineTouched] = React.useState<Record<number, { item?: boolean; qty?: boolean; rate?: boolean }>>({});
  const [lineAttemptedAdd, setLineAttemptedAdd] = React.useState<Record<number, boolean>>({});

  /** Legacy ?poId= deep-link → PO detail route */
  React.useEffect(() => {
    const legacy = Number(navSearchParams.get(DRILL_QUERY.rmPoId)) || 0;
    if (!legacy) return;
    navigate(withReportsReturnContextIfPresent(`/rm-po-grn/${legacy}`, location.search), { replace: true });
  }, [navigate, navSearchParams, location.search]);

  async function refresh(): Promise<void> {
    const fetchErr = (reason: unknown) => (reason instanceof Error ? reason.message : "Request failed");
    try {
      const [rS, rI, rP] = await Promise.allSettled([
        apiFetch<Supplier[]>("/api/suppliers"),
        apiFetch<Item[]>("/api/items?type=RM"),
        apiFetch<RmPoRow[]>("/api/purchase/rm-pos"),
      ]);
      const errors: string[] = [];
      if (rS.status === "fulfilled") {
        setSuppliers(rS.value);
        setSupplierId((cur) => {
          const s = rS.value;
          if (cur && s.some((x) => x.id === cur)) return cur;
          return s.length ? s[0].id : 0;
        });
      } else {
        errors.push(`Suppliers: ${fetchErr(rS.reason)}`);
      }
      if (rI.status === "fulfilled") {
        setItems(rI.value);
      } else {
        errors.push(`RM items: ${fetchErr(rI.reason)}`);
      }
      if (rP.status === "fulfilled") {
        setRows(rP.value);
      } else {
        errors.push(`RM POs: ${fetchErr(rP.reason)}`);
      }
      setError(errors.length ? errors.join(" · ") : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setListLoaded(true);
    }
  }

  React.useEffect(() => {
    void refresh();
  }, []);

  React.useEffect(() => {
    if (!focusPendingRequests || !listLoaded) return;
    const t = window.setTimeout(() => {
      document.getElementById("rm-po-pending-requests")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => window.clearTimeout(t);
  }, [focusPendingRequests, listLoaded]);

  React.useEffect(() => {
    if (!focusOpenPos || !listLoaded) return;
    if (poStatusFilter !== "OPEN") patch({ poStatus: "OPEN" });
    const t = window.setTimeout(() => {
      document.getElementById("rm-po-order-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => window.clearTimeout(t);
  }, [focusOpenPos, listLoaded, poStatusFilter, patch]);

  useModalFocusRestore(newPoOpen);
  useFastEntryForm({
    containerRef: newPoModalFormRef,
    initialFocusRef: supplierSelectRef,
    initialFocusEnabled: newPoOpen,
  });

  React.useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get("source") !== "no_qty_production_shortage") {
      noQtyShortagePrefillDoneRef.current = false;
    }
  }, [location.search]);

  React.useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get("source") !== "no_qty_production_shortage") return;
    if (!listLoaded || !items.length) return;
    if (noQtyShortagePrefillDoneRef.current) return;
    noQtyShortagePrefillDoneRef.current = true;

    const st = location.state as {
      shortages?: Array<{ rmItemId: number; shortageQty: number }>;
      context?: {
        salesOrderId?: number;
        cycleId?: number | null;
        workOrderId?: number;
        workOrderLineId?: number;
      };
    } | null;
    const shortages = st?.shortages ?? [];
    const ctx = st?.context;

    const salesOrderId = Number(sp.get("salesOrderId") ?? ctx?.salesOrderId ?? 0);
    const cycleRaw = sp.get("cycleId");
    const cycleId =
      cycleRaw != null && cycleRaw !== "" && Number.isFinite(Number(cycleRaw))
        ? Number(cycleRaw)
        : (ctx?.cycleId ?? null);
    const workOrderId = Number(sp.get("workOrderId") ?? ctx?.workOrderId ?? 0);
    const workOrderLineId = Number(sp.get("workOrderLineId") ?? ctx?.workOrderLineId ?? 0);

    try {
      localStorage.setItem(
        "noQtyReturnContext",
        JSON.stringify({
          salesOrderId,
          cycleId,
          workOrderId,
          workOrderLineId,
          returnTo: "production",
        }),
      );
    } catch {
      /* ignore */
    }

    const lines: PoLineDraft[] = [];
    for (const s of shortages) {
      const item = items.find((x) => x.id === s.rmItemId);
      lines.push(buildInitialPoLine(item, relaxedTax, s.shortageQty, Number.NaN));
    }
    if (lines.length === 0 && items.length) {
      lines.push(buildInitialPoLine(items[0], relaxedTax));
    }
    setPoLines(lines);
    setSupplierId(suppliers[0]?.id ?? 0);
    setPoRemarks("");
    setError(DIRECT_PO_DISABLED_MESSAGE);
  }, [listLoaded, items, relaxedTax, suppliers, location.search, location.state]);

  /**
   * RM Shortage Workspace → Create RM PO prefill.
   *
   * When the user clicks "Create RM PO" from `/reports/rm-shortage`, we land
   * here with `?source=rm-shortage&itemId=X[&shortageQty=Y&...]`. Auto-open
   * the new PO modal with that single RM line prefilled. Rate is intentionally
   * left empty for the operator to set against the supplier's quote.
   *
   * PRESENTATIONAL ONLY — no math is mutated; we just preselect the item and
   * carry the shortage qty into the line draft as a starting quantity.
   */
  React.useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get("source") !== "rm-shortage") {
      rmShortagePrefillDoneRef.current = false;
      return;
    }
    if (!listLoaded || !items.length) return;
    if (rmShortagePrefillDoneRef.current) return;
    rmShortagePrefillDoneRef.current = true;

    const itemIdRaw = Number(sp.get("itemId") ?? 0);
    const shortageRaw = Number(sp.get("shortageQty") ?? sp.get("requiredQty") ?? 0);
    const matched = Number.isFinite(itemIdRaw) && itemIdRaw > 0
      ? items.find((x) => x.id === itemIdRaw)
      : undefined;
    const baseQty = Number.isFinite(shortageRaw) && shortageRaw > 0 ? shortageRaw : Number.NaN;
    const line = buildInitialPoLine(matched ?? items[0], relaxedTax, baseQty, Number.NaN);

    setPoLines([line]);
    setSupplierId(suppliers[0]?.id ?? 0);
    setPoRemarks(matched ? `RM shortage cover: ${matched.itemName}` : "");
    setError(DIRECT_PO_DISABLED_MESSAGE);
  }, [listLoaded, items, relaxedTax, suppliers, location.search]);

  React.useEffect(() => {
    apiFetch<PurchaseMeta>("/api/purchase/meta")
      .then(setPurchaseMeta)
      .catch(() => setPurchaseMeta({ testingModeRelaxedTaxFields: false }));
  }, []);

  React.useEffect(() => {
    if (!items.length || !newPoOpen) return;
    setPoLines((pl) => {
      if (pl.length === 0) return [buildInitialPoLine(items[0], relaxedTax)];
      if (pl.length === 1 && pl[0].itemId === 0) return [buildInitialPoLine(items[0], relaxedTax)];
      return pl;
    });
  }, [items, newPoOpen, relaxedTax]);

  function openNewPoModal() {
    setError(DIRECT_PO_DISABLED_MESSAGE);
    setPoRemarks("");
    setPoLines(items.length ? [buildInitialPoLine(items[0], relaxedTax)] : []);
    setSupplierId(suppliers[0]?.id ?? 0);
  }

  const modalTaxWarnings = React.useMemo(() => {
    const w: string[] = [];
    for (const l of poLines) {
      const it = items.find((x) => x.id === l.itemId);
      w.push(...deriveRmLineDisplayFromItem(it, relaxedTax).warnings);
    }
    return [...new Set(w)];
  }, [poLines, items, relaxedTax]);

  const poKpi = React.useMemo(() => {
    return {
      total: rows.length,
      pending: rows.filter((r) => r.status === "PENDING").length,
      partial: rows.filter((r) => r.status === "PARTIAL").length,
      completed: rows.filter((r) => r.status === "COMPLETED").length,
    };
  }, [rows]);

  const visiblePoRows = React.useMemo(() => {
    const q = qDraft.trim().toLowerCase();
    return rows.filter((r) => {
      if (poStatusFilter === "OPEN" && (r.status === "COMPLETED" || r.status === "CANCELLED")) return false;
      if (poStatusFilter === "COMPLETED" && r.status !== "COMPLETED") return false;
      if (poStatusFilter === "CANCELLED" && r.status !== "CANCELLED") return false;
      if (q) {
        const inLines = r.lines.some((ln) => (ln.item?.itemName ?? "").toLowerCase().includes(q));
        const hit =
          String(r.id).includes(q) ||
          formatRmPoNo(r.id).toLowerCase().includes(q) ||
          r.supplier.name.toLowerCase().includes(q) ||
          inLines;
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, poStatusFilter, qDraft]);

  const poListFiltersActive = poStatusFilter !== "ALL" || qDraft.trim().length > 0;

  function clearPoListFilters() {
    setQDraft("");
    patch({ poStatus: null, q: null });
  }

  const clearPoDrillFocus = React.useCallback(() => {
    setSearchParams((prev) => deleteUrlParamKeys(prev, [DRILL_QUERY.rmPoId]), { replace: true });
  }, [setSearchParams]);

  const revealPoDrillTarget = React.useCallback(() => {
    setQDraft("");
    patch({ poStatus: null, q: null });
  }, [patch, setQDraft]);

  const poDrillInData = focusPoId > 0 && rows.some((r) => r.id === focusPoId);
  const poDrillVisible = focusPoId > 0 && visiblePoRows.some((r) => r.id === focusPoId);
  const poDrillHiddenByFilters = listLoaded && poDrillInData && !poDrillVisible;
  const focusedPoRow = rows.find((r) => r.id === focusPoId);

  useDrillFocus({
    attribute: DRILL_DATA.poId,
    id: focusPoId,
    ready: listLoaded,
    enabled: focusPoId > 0 && rows.some((r) => r.id === focusPoId),
    retryDeps: [rows.length, poDrillVisible],
  });

  const saveDisabled =
    creatingPo ||
    !supplierId ||
    poLines.length < 1 ||
    poLines.some(
      (l) =>
        !l.itemId ||
        !Number.isFinite(l.qty) ||
        l.qty <= 0 ||
        !Number.isFinite(l.rate) ||
        l.rate <= 0,
    );

  async function onCreatePo() {
    setError(null);
    setCreatingPo(true);
    try {
      const created = await apiFetch<RmPoRow & { taxWarnings?: string[] }>("/api/purchase/rm-pos", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          remarks: poRemarks.trim() || null,
          lines: poLines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate })),
        }),
      });
      setNewPoOpen(false);
      // Preserve shortage-workflow context (source, returnTo, item & qty for context strip)
      // into the detail URL so back-nav resolves to "Back to RM Shortage Workspace" and the
      // detail page can render the shortage-cover banner.
      const sp = new URLSearchParams(location.search);
      const sourceParam = sp.get("source") ?? "";
      let detailHref = withReportsReturnContextIfPresent(`/rm-po-grn/${created.id}`, location.search);
      if (sourceParam === "rm-shortage") {
        const carry = new URLSearchParams();
        carry.set("source", "rm-shortage");
        const returnTo = sp.get("returnTo");
        if (returnTo) carry.set("returnTo", returnTo);
        const itemId = sp.get("itemId");
        if (itemId) carry.set("itemId", itemId);
        const itemCode = sp.get("itemCode");
        if (itemCode) carry.set("itemCode", itemCode);
        const itemName = sp.get("itemName");
        if (itemName) carry.set("itemName", itemName);
        const shortageQty = sp.get("shortageQty");
        if (shortageQty) carry.set("shortageQty", shortageQty);
        detailHref = `/rm-po-grn/${created.id}?${carry.toString()}`;
      }
      navigate(detailHref, {
        state: { rmPoTaxWarnings: created.taxWarnings ?? [] },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreatingPo(false);
    }
  }

  const shortcutHints = useShortcutHints({
    pageKey: "rm-po-grn",
    fieldShortcuts: {
      poSupplier: FIELD_HINT_PO_SUPPLIER,
      poLineQty: FIELD_HINT_GRID_NAV,
      savePo: FIELD_HINT_SAVE,
    },
    firstUseTipText: "Tip: Use Enter to move faster and Ctrl+Enter to confirm.",
  });

  const poSupplierBind = shortcutHints.bindField("poSupplier", {
    onChange: (e) => {
      const v = Number((e.target as HTMLSelectElement).value);
      setSupplierId(v);
      patch({ supplier: v || null });
    },
  });

  const savePoFocusBind = shortcutHints.bindField("savePo");

  React.useEffect(() => {
    poQtyInputRefs.current = poQtyInputRefs.current.slice(0, poLines.length);
  }, [poLines.length]);

  React.useEffect(() => {
    poItemSelectRefs.current = poItemSelectRefs.current.slice(0, poLines.length);
    poRateInputRefs.current = poRateInputRefs.current.slice(0, poLines.length);
  }, [poLines.length]);

  React.useEffect(() => {
    if (!newPoOpen) return;
    const t = window.setTimeout(() => {
      poItemSelectRefs.current[0]?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [newPoOpen]);

  const shortcutFlagsRef = React.useRef({ saveDisabled: true });
  shortcutFlagsRef.current = { saveDisabled };

  const markShortcutRef = React.useRef(shortcutHints.markFieldShortcutUsed);
  markShortcutRef.current = shortcutHints.markFieldShortcutUsed;

  React.useEffect(() => {
    function onGlobalKey(ev: KeyboardEvent) {
      if (ev.defaultPrevented) return;
      if (!newPoOpen) {
        if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "KeyN") {
          ev.preventDefault();
          openNewPoModal();
        }
        return;
      }
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "Digit1") {
        ev.preventDefault();
        markShortcutRef.current("poSupplier");
        supplierSelectRef.current?.focus();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyS") {
        ev.preventDefault();
        if (!shortcutFlagsRef.current.saveDisabled) {
          markShortcutRef.current("savePo");
          void onCreatePo();
        }
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        if (!shortcutFlagsRef.current.saveDisabled) {
          markShortcutRef.current("savePo");
          void onCreatePo();
        }
        return;
      }
    }
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, [newPoOpen]);

  function isLineValid(l: PoLineDraft): { item: boolean; qty: boolean; rate: boolean } {
    return {
      item: Boolean(l.itemId),
      qty: Number.isFinite(l.qty) && l.qty > 0,
      rate: Number.isFinite(l.rate) && l.rate > 0,
    };
  }

  function setTouched(i: number, field: "item" | "qty" | "rate") {
    setLineTouched((prev) => ({ ...prev, [i]: { ...(prev[i] || {}), [field]: true } }));
  }

  function shouldShowErr(i: number, field: "item" | "qty" | "rate") {
    return Boolean(lineAttemptedAdd[i] || lineTouched[i]?.[field]);
  }

  function focusFirstInvalid(i: number) {
    const v = isLineValid(poLines[i]);
    if (!v.item) return poItemSelectRefs.current[i]?.focus();
    if (!v.qty) return poQtyInputRefs.current[i]?.focus();
    if (!v.rate) return poRateInputRefs.current[i]?.focus();
  }

  function addLineFrom(i: number) {
    if (!items.length) return;
    setLineAttemptedAdd((prev) => ({ ...prev, [i]: true }));
    const v = isLineValid(poLines[i]);
    if (!v.item || !v.qty || !v.rate) {
      focusFirstInvalid(i);
      return;
    }
    setPoLines((p) => [...p, buildInitialPoLine(items[0], relaxedTax)]);
    window.setTimeout(() => {
      poItemSelectRefs.current[i + 1]?.focus();
    }, 0);
  }

  const kpiSegments = [
    { key: "total", label: "Total POs", value: poKpi.total, tone: "muted" as const },
    { key: "pending", label: "Pending GRN", value: poKpi.pending, tone: poKpi.pending > 0 ? ("warn" as const) : ("muted" as const) },
    { key: "partial", label: "Partially Received", value: poKpi.partial, tone: poKpi.partial > 0 ? ("warn" as const) : ("muted" as const) },
    { key: "completed", label: "Completed", value: poKpi.completed, tone: "muted" as const },
  ] as const;

  return (
    <PageContainer className="space-y-2 pb-4">
      <DrillFocusBanner
        active={focusPoId > 0}
        title={drillFocusTitleRmPo(focusPoId, focusedPoRow?.supplier.name)}
        variant={
          listLoaded && focusPoId > 0 && !poDrillInData ? "soft" : poDrillHiddenByFilters ? "soft" : "default"
        }
        hint={
          listLoaded && focusPoId > 0 && !poDrillInData
            ? DRILL_FOCUS_HINT_NOT_IN_LIST.purchaseOrder
            : poDrillHiddenByFilters
              ? DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS.purchaseOrder
              : undefined
        }
        recoveryAction={
          poDrillHiddenByFilters ? { label: DRILL_RECOVERY_LABEL.purchaseOrder, onClick: revealPoDrillTarget } : undefined
        }
        onClearFocus={clearPoDrillFocus}
      />

      <StickyWorkspaceHead lead={<PageBackLink to={rmPurchaseBackNav.backRoute} label={rmPurchaseBackNav.backLabel} />}>
        <div className="erp-page-title-row flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <h1 className="erp-type-page-title">{PROCUREMENT_TERMS.PURCHASE_GRN_PAGE_TITLE}</h1>
            <p className="erp-type-helper text-slate-500">{PROCUREMENT_TERMS.PURCHASE_GRN_PAGE_SUBTITLE}</p>
          </div>
          <div className="erp-page-header-actions shrink-0 pt-0.5">
            <Button type="button" size="sm" className="h-8 font-semibold shadow-sm" disabled title={DIRECT_PO_DISABLED_MESSAGE}>
              New PO from approved requisition only
            </Button>
          </div>
        </div>
      </StickyWorkspaceHead>

      <ProcurementQueueContextBanner
        salesOrderId={Number(navSearchParams.get("salesOrderId")) || undefined}
        materialRequirementId={Number(navSearchParams.get("materialRequirementId")) || undefined}
      />

      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <p className="text-[13px] font-bold text-slate-950">{PROCUREMENT_TERMS.PROCUREMENT_QUEUE_SECTION}</p>
        <p className="mt-0.5 text-[11px] text-slate-600">{PROCUREMENT_TERMS.PROCUREMENT_QUEUE_POOL_HINT}</p>
        <PendingMaterialRequestsPanel embedded canPrepareRmPo={canPrepareRmPo} />
      </div>

      {navSearchParams.get("source") === "no_qty_production_shortage" ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] leading-snug text-sky-950">
          <p className="font-semibold">Source: NO_QTY Production Shortage</p>
          <p className="text-sky-900/90">SO linked — after GRN, continue with Work Order creation and RM issue before production.</p>
        </div>
      ) : null}

      {navSearchParams.get("source") === "rm-shortage" ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-950">
          <p className="font-semibold">
            Source: RM Shortage Workspace
            {navSearchParams.get("itemName")
              ? ` — ${navSearchParams.get("itemName")}`
              : navSearchParams.get("itemCode")
                ? ` — ${navSearchParams.get("itemCode")}`
                : ""}
          </p>
          <p className="text-amber-900/90">
            Direct PO creation is blocked until Store creates a Purchase Request from the approved MR
            {navSearchParams.get("shortageQty") ? ` (qty ${navSearchParams.get("shortageQty")})` : ""}
            . Use the approved requisitions queue below.
          </p>
        </div>
      ) : null}

      {!focusPendingRequests ? (
      <>
      <ErpKpiStrip className={erpKpi.stripCompact} role="toolbar" aria-label="Purchase order metrics">
        {kpiSegments.map(({ key, label, value, tone }) => (
          <ErpKpiSegment key={key} as="div">
            <ErpKpiLabel>{label}</ErpKpiLabel>
            <ErpKpiValue tone={tone} className="tabular-nums">
              {value}
            </ErpKpiValue>
          </ErpKpiSegment>
        ))}
      </ErpKpiStrip>

      {error && !newPoOpen ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-800">{error}</div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
        <select
          aria-label="PO status"
          className="erp-flow-filter-input h-8 min-w-[10rem] rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          value={poStatusFilter}
          onChange={(e) => patch({ poStatus: e.target.value as typeof poStatusFilter })}
        >
          <option value="ALL">All statuses</option>
          <option value="OPEN">Open (pending / partial)</option>
          <option value="COMPLETED">Fully received</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <div className="relative min-w-[10rem] flex-1 max-w-[18rem]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            type="search"
            aria-label="Search purchase orders"
            className="h-8 pl-7 text-[12px] shadow-sm"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            placeholder="PO #, supplier, item…"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8 shrink-0 p-0"
          disabled={!poListFiltersActive}
          onClick={clearPoListFilters}
          aria-label="Clear filters"
          title="Clear filters"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
        {poListFiltersActive && rows.length > 0 ? (
          <span className="ml-auto text-[11px] tabular-nums text-slate-500">
            {visiblePoRows.length} of {rows.length}
          </span>
        ) : null}
      </div>

      <div
        id="rm-po-order-list"
        className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
      >
        {rows.length > 0 ? (
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Purchase orders</span>
            <span className="text-[11px] tabular-nums text-slate-500">
              {visiblePoRows.length} of {rows.length}
            </span>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          {!rows.length && listLoaded ? (
            <ErpEmptyState
              variant="inline"
              title="No purchase orders created yet"
              body="Create a purchase order from the header to receive raw material stock and post GRNs against supplier deliveries."
              icon={<Package className="h-4 w-4" strokeWidth={2} />}
              className="border-0 bg-transparent py-8 shadow-none"
            />
          ) : rows.length > 0 && visiblePoRows.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-[13px] text-slate-600">
                No purchase orders match the current filters.
                {poDrillHiddenByFilters ? ` ${DRILL_FOCUS_EMPTY_FILTERED_SUFFIX.purchaseOrder}` : ""}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2 h-7 text-[12px]"
                onClick={clearPoListFilters}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <table
              className={cn(
                erpTable.standard,
                "erp-table-dense w-full min-w-[640px] text-[12px] [&_tbody_td]:!py-1 [&_thead_th]:!py-1",
              )}
            >
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="whitespace-nowrap">PO number</th>
                  <th className="min-w-[8rem]">Supplier</th>
                  <th className="min-w-[7rem]">Demand source</th>
                  <th className="min-w-[7rem]">Supply from</th>
                  <th className="whitespace-nowrap">Status</th>
                  <th className="whitespace-nowrap text-right">PO date</th>
                  <th className={cn(erpTable.actionCell, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visiblePoRows.map((r) => {
                  const detailUrl = withReportsReturnContextIfPresent(`/rm-po-grn/${r.id}`, location.search);
                  return (
                    <tr
                      key={r.id}
                      {...{ [DRILL_DATA.poId]: r.id }}
                      className="cursor-pointer select-none transition-colors hover:bg-slate-50/90"
                      onClick={() => navigate(detailUrl)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(detailUrl);
                        }
                      }}
                      onMouseDown={suppressMouseFocusOnDrillRow}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open purchase order ${formatRmPoNo(r.id)}`}
                    >
                      <td className="whitespace-nowrap font-semibold text-slate-900">{formatRmPoNo(r.id)}</td>
                      <td className="max-w-[14rem] truncate text-slate-800" title={r.supplier.name}>
                        {r.supplier.name}
                      </td>
                      <td
                        className="max-w-[12rem] truncate text-slate-700"
                        title={r.procurementSourceSummary ?? undefined}
                      >
                        {r.procurementSourceSummary?.trim() || "—"}
                      </td>
                      <td className="max-w-[10rem] truncate text-slate-600" title={r.resolvedSupplierCommercial?.supplyLocation?.label ?? ""}>
                        {r.resolvedSupplierCommercial?.supplyLocation?.label ?? "—"}
                        {r.resolvedSupplierCommercial?.gstMode === "INTERSTATE" ? (
                          <span className="ml-1 rounded bg-purple-100 px-1 py-0.5 text-[10px] font-semibold text-purple-900">
                            IGST
                          </span>
                        ) : r.resolvedSupplierCommercial?.gstMode === "LOCAL" ? (
                          <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-semibold text-emerald-900">
                            Local
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            poStatusBadgeClass(r.status),
                          )}
                        >
                          {poStatusLabel(r.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums text-slate-700">
                        {formatPoListDate(rmPoCreatedAt(r))}
                      </td>
                      <td className={erpTable.actionCell} onClick={(e) => e.stopPropagation()}>
                        <div className={erpTable.actions}>
                          <button
                            type="button"
                            className={cn(erpTable.actLink, "text-[11px]")}
                            onClick={() => navigate(detailUrl)}
                          >
                            Open
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </>
      ) : null}

      {newPoOpen ? (
        <ErpModal
          onClose={() => {
            setNewPoOpen(false);
            setError(null);
          }}
          aria-labelledby="rm-po-new-title"
        >
          <Card className="erp-modal-shell max-h-[90vh] overflow-y-auto rounded-xl border-slate-200/90 shadow-xl ring-1 ring-slate-200/50">
            <CardHeader className="border-b border-slate-100 bg-gradient-to-b from-slate-50/95 to-white pb-3">
              <CardTitle id="rm-po-new-title" className="text-base font-semibold text-slate-900">
                New purchase order
              </CardTitle>
            </CardHeader>
            <CardContent ref={newPoModalFormRef} className="space-y-3">
              {error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              ) : null}
              {relaxedTax ? (
                <p className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
                  Testing mode (TESTING_MODE_RELAXED_TAX_FIELDS): missing HSN / GST / unit on masters use temporary fallbacks so you can
                  continue. Complete masters for production.
                </p>
              ) : null}
              {modalTaxWarnings.length > 0 ? (
                <ul className="list-inside list-disc rounded-md border border-sky-200 bg-sky-50/90 px-3 py-2 text-xs text-sky-950">
                  {modalTaxWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2">
                <FieldShortcutHint
                  show={shortcutHints.activeFieldId === "poSupplier"}
                  hint={shortcutHints.activeFieldHintText ?? ""}
                  placement="below"
                  className="min-w-0"
                >
                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600">Supplier</span>
                    <select
                      ref={supplierSelectRef}
                      className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                      value={supplierId}
                      {...poSupplierBind}
                    >
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </FieldShortcutHint>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="text-slate-600">Remarks</span>
                <Input className="h-9" value={poRemarks} onChange={(e) => setPoRemarks(e.target.value)} placeholder="Optional" />
              </label>
              <div className="space-y-2">
                {poLines.map((l, i) => {
                  const it = items.find((x) => x.id === l.itemId);
                  const valid = isLineValid(l);
                  const showItemErr = shouldShowErr(i, "item") && !valid.item;
                  const showQtyErr = shouldShowErr(i, "qty") && !valid.qty;
                  const showRateErr = shouldShowErr(i, "rate") && !valid.rate;

                  const poQtyBind = shortcutHints.bindField("poLineQty", {
                    onChange: (e) => {
                      const raw = (e.target as HTMLInputElement).value;
                      const v = raw.trim() === "" ? Number.NaN : Number(raw);
                      setPoLines((prev) =>
                        prev.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                qty: v,
                                amount: Number.isFinite(v) && Number.isFinite(x.rate) ? computeLineAmount(v, x.rate) : 0,
                              }
                            : x,
                        ),
                      );
                    },
                    onBlur: () => setTouched(i, "qty"),
                    onFocus: (e) => (e.target as HTMLInputElement).select(),
                  });

                  return (
                    <div key={`new-${i}`} className="rounded-md border border-slate-200 bg-white p-2">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_130px] sm:items-start">
                        <label className="grid min-w-0 gap-1 text-xs font-medium text-slate-600">
                          Item
                          <select
                            ref={(el) => {
                              poItemSelectRefs.current[i] = el;
                            }}
                            className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm"
                            value={l.itemId}
                            onBlur={() => setTouched(i, "item")}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return;
                              e.preventDefault();
                              poQtyInputRefs.current[i]?.focus();
                            }}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              const it2 = items.find((x) => x.id === v);
                              const d = deriveRmLineDisplayFromItem(it2, relaxedTax);
                              setPoLines((prev) =>
                                prev.map((x, j) =>
                                  j === i
                                    ? {
                                        ...x,
                                        itemId: v,
                                        unit: d.unit,
                                        hsn: d.hsn,
                                        gstRate: d.gstRate,
                                        amount: Number.isFinite(x.qty) && Number.isFinite(x.rate) ? computeLineAmount(x.qty, x.rate) : 0,
                                      }
                                    : x,
                                ),
                              );
                            }}
                          >
                            {items.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.itemName}
                              </option>
                            ))}
                          </select>
                          {showItemErr ? <div className="text-[11px] font-normal text-red-700">Required</div> : null}
                        </label>

                        <label className="grid gap-1 text-xs font-medium text-slate-600">
                          Qty
                          <FieldShortcutHint
                            show={i === 0 && shortcutHints.activeFieldId === "poLineQty"}
                            hint={shortcutHints.activeFieldHintText ?? ""}
                            placement="below-end"
                          >
                            <Input
                              ref={(el) => {
                                poQtyInputRefs.current[i] = el;
                              }}
                              type="number"
                              className="h-9"
                              value={Number.isFinite(l.qty) ? String(l.qty) : ""}
                              min={0}
                              step="any"
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return;
                                e.preventDefault();
                                poRateInputRefs.current[i]?.focus();
                              }}
                              {...poQtyBind}
                            />
                          </FieldShortcutHint>
                          <div className="text-[11px] font-normal text-slate-500">Enter received / ordered quantity</div>
                          {showQtyErr ? <div className="text-[11px] font-normal text-red-700">Must be &gt; 0</div> : null}
                        </label>

                        <label className="grid gap-1 text-xs font-medium text-slate-600">
                          Rate
                          <Input
                            ref={(el) => {
                              poRateInputRefs.current[i] = el;
                            }}
                            type="number"
                            className="h-9"
                            value={Number.isFinite(l.rate) ? String(l.rate) : ""}
                            min={0}
                            step="any"
                            onBlur={() => setTouched(i, "rate")}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return;
                              e.preventDefault();
                              addLineFrom(i);
                            }}
                            onChange={(e) => {
                              const raw = (e.target as HTMLInputElement).value;
                              const v = raw.trim() === "" ? Number.NaN : Number(raw);
                              setPoLines((prev) =>
                                prev.map((x, j) =>
                                  j === i
                                    ? {
                                        ...x,
                                        rate: v,
                                        amount: Number.isFinite(x.qty) && Number.isFinite(v) ? computeLineAmount(x.qty, v) : 0,
                                      }
                                    : x,
                                ),
                              );
                            }}
                          />
                          <div className="text-[11px] font-normal text-slate-500">Rate per unit</div>
                          {showRateErr ? <div className="text-[11px] font-normal text-red-700">Must be &gt; 0</div> : null}
                        </label>
                      </div>

                      {l.itemId ? (
                        <div className="mt-1 text-xs text-slate-600">
                          <span className="font-medium text-slate-700">{it?.itemName ?? "—"}</span>{" "}
                          <span className="text-slate-400">|</span> Unit: <span className="tabular-nums">{l.unit || "—"}</span>{" "}
                          <span className="text-slate-400">|</span> HSN: <span className="font-mono">{l.hsn || "—"}</span>{" "}
                          <span className="text-slate-400">|</span> GST: <span className="tabular-nums">{l.gstRate == null ? "—" : `${l.gstRate}%`}</span>{" "}
                          <span className="text-slate-400">|</span> Amount:{" "}
                          <span className="tabular-nums">{Number.isFinite(l.amount) ? l.amount.toFixed(2) : "—"}</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const i = Math.max(0, poLines.length - 1);
                    addLineFrom(i);
                  }}
                >
                  Add line
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setNewPoOpen(false);
                    setError(null);
                  }}
                  disabled={creatingPo}
                >
                  Cancel
                </Button>
                <FieldShortcutHint
                  show={shortcutHints.activeFieldId === "savePo"}
                  hint={shortcutHints.activeFieldHintText ?? ""}
                  placement="above"
                  className="inline-block"
                >
                  <Button
                    type="button"
                    onClick={() => {
                      shortcutHints.markFieldShortcutUsed("savePo");
                      void onCreatePo();
                    }}
                    disabled={saveDisabled}
                    onFocus={savePoFocusBind.onFocus}
                    onBlur={savePoFocusBind.onBlur}
                  >
                    {creatingPo ? "Saving…" : "Save & open"}
                  </Button>
                </FieldShortcutHint>
              </div>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}
    </PageContainer>
  );
}
