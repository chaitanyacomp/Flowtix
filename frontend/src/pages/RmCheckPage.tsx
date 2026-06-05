/**
 * REGULAR FLOW ONLY
 *
 * Flow:
 * Enquiry
 * â†’ Quotation
 * â†’ Regular Sales Order
 * â†’ RM Check
 * â†’ Work Order
 * â†’ Production
 * â†’ QC
 * â†’ Dispatch
 * â†’ Sales Bill
 *
 * This flow is:
 * - fixed quantity
 * - customer PO driven
 * - WO driven
 * - dispatch against SO qty
 *
 * DO NOT IMPORT:
 * - Requirement Sheet logic
 * - NO_QTY planning services
 * - cycle planning helpers
 * - carry-forward shortage logic
 * - NO_QTY dashboard widgets
 *
 * Routes: `/rm-check` (legacy alias), `/work-orders/prepare` (canonical).
 * APIs: SO list/detail, `GET /api/sales-orders/:id/rm-check` (material planning engine), `/api/production/work-orders` â€” never `/api/planning-dashboard`.
 */
import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useToast } from "../contexts/ToastContext";
import { cn } from "../lib/utils";
import { REGULAR_TERMS, NO_QTY_TERMS } from "../lib/flowTerminology";
import type { WoPrepareDashboardQueues } from "../components/erp/WoPrepareOperationalQueuesCard";
import { WoPrepareGuidedStrip } from "../components/erp/WoPrepareGuidedStrip";
import { WoPrepareOperationalHeader } from "../components/erp/WoPrepareOperationalHeader";
import { WoPrepareReadinessChecklist } from "../components/erp/WoPrepareReadinessChecklist";
import { WoPrepareWorkOrderBlockedCard } from "../components/erp/WoPrepareWorkOrderBlockedCard";
import { WoPrepareWorkflowProgress } from "../components/erp/WoPrepareWorkflowProgress";
import { OperationalSystemErrorCard } from "../components/erp/OperationalSystemErrorCard";
import { WoPrepareProductionPlanningPanel } from "../components/erp/WoPrepareProductionPlanningPanel";
import { WoPrepareRmReadinessTable } from "../components/erp/WoPrepareRmReadinessTable";
import { NextStepStrip } from "../components/erp/NextStepStrip";
import { PageContainer } from "../components/PageHeader";
import type { ProductionRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import { isProductionBlockedByRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import {
  buildRmIssueNextStep,
  buildRmReadyProductionNextStep,
} from "../lib/regularSoOperationalGuidance";
import {
  clampRegularSoBufferPercent,
  computeProductionPlanningMetrics,
  parseRegularSoBufferPercentInput,
  REGULAR_SO_BUFFER_PERCENT_MAX,
} from "../lib/regularSoProductionPlanning";
import {
  presentOperationalError,
  presentPlanningInitFailure,
  type OperationalErrorPresentation,
} from "../lib/operationalErrorPresentation";
import {
  buildWoPrepareBlockedCardModel,
  buildWoPrepareGuidedStripModel,
  buildWoPrepareReadinessChecklist,
  deriveWoPrepareWorkflowState,
  deriveWoPrepareWorkflowStepLabel,
} from "../lib/woPrepareWorkflowGuidance";

type SoRow = {
  id: number;
  docNo?: string | null;
  poId: number | null;
  orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY";
  lines: { id: number; itemId: number; qty: string; item: { itemName: string; itemType: string } }[];
};

type SoDetailLine = {
  id: number;
  itemId: number;
  qty: string;
  isFree?: boolean;
  quotationLine?: { rate: string; isFree: boolean } | null;
  item: { itemName: string };
};

type SoDetail = {
  id: number;
  docNo?: string | null;
  poId?: number | null;
  orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY";
  customerPoReference?: string | null;
  quotation?: { id: number; quotationNo: string | null } | null;
  lines: SoDetailLine[];
};

type RmRow = {
  rmItemId: number;
  itemName: string;
  unit?: string;
  requiredQty: number;
  availableQty: number;
  shortage: number;
  shortageQty?: number;
  status?: "AVAILABLE" | "PARTIAL" | "SHORTAGE";
  readinessStatus?: "READY" | "PARTIAL" | "SHORTAGE";
  enough: boolean;
};

type MaterialReadiness = {
  planningSource: string;
  requiredRmCount: number;
  availableRmCount: number;
  shortageRmCount: number;
  allRmAvailable: boolean;
};

type FgRow = {
  lineId: number;
  fgItemId: number;
  fgName: string;
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
};

type RmCheckResponse = {
  fgLines: FgRow[];
  rmSummary: RmRow[];
  allRmEnough: boolean;
  allFgEnough: boolean;
  materialReadiness?: MaterialReadiness;
  canCreateWorkOrder?: boolean;
  woBlockReason?: string | null;
  pendingMaterialRequirements?: { id: number; docNo: string | null }[];
  suggestedFgPlanningBufferPercent?: number | null;
  strictInventoryControl?: boolean;
  proceedAllowed?: boolean;
  blockMessage?: string | null;
};

function buildPlanLineQtyQuery(planQtyByLineId: Record<number, string>): string {
  const parts: string[] = [];
  for (const [lineId, raw] of Object.entries(planQtyByLineId)) {
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty < 0) continue;
    parts.push(`${lineId}:${qty}`);
  }
  return parts.length ? `&planLineQty=${encodeURIComponent(parts.join(","))}` : "";
}

function isRegularSoRow(o: Pick<SoRow, "orderType">): boolean {
  const t = o.orderType ?? "NORMAL";
  return t === "NORMAL" || t === "REPLACEMENT";
}

function soDetailToSoRow(so: SoDetail): SoRow {
  return {
    id: so.id,
    docNo: so.docNo,
    poId: so.poId ?? null,
    orderType: so.orderType,
    lines: (so.lines ?? []).map((l) => ({
      id: l.id,
      itemId: l.itemId,
      qty: l.qty,
      item: {
        itemName: l.item.itemName,
        itemType: "itemType" in l.item && typeof l.item.itemType === "string" ? l.item.itemType : "FG",
      },
    })),
  };
}

function formatPendingMrRefs(refs: { id: number; docNo: string | null }[]): string {
  return refs.map((m) => m.docNo || `#${m.id}`).join(", ");
}

/** Greedy allocation of Customer Tracking `shortfallQty` across FG lines capped by each line's `toProduce`. */
function applyCustomerTrackingShortfallToPlanDefaults(
  fgLines: FgRow[],
  base: Record<number, string>,
  shortfall: number,
): Record<number, string> {
  if (!(shortfall > 0) || !fgLines?.length) return base;
  const out = { ...base };
  let rem = shortfall;
  for (const f of fgLines) {
    if (f.note || !(f.toProduce > 0)) continue;
    const cap = Math.max(0, Number(f.toProduce) || 0);
    const take = Math.min(rem, cap);
    out[f.lineId] = String(take);
    rem -= take;
    if (rem <= 1e-9) break;
  }
  return out;
}


export function RmCheckPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const isAdmin = useIsAdmin();
  const urlSoId = Number(searchParams.get("salesOrderId")) || Number(searchParams.get("soId")) || 0;
  const customerTrackingShortfallQty = Number(searchParams.get("shortfallQty") ?? 0);
  const fromCustomerTracking = (searchParams.get("from") ?? "") === "customer-tracking";
  const [orders, setOrders] = React.useState<SoRow[]>([]);
  const [soId, setSoId] = React.useState(0);
  const [data, setData] = React.useState<RmCheckResponse | null>(null);
  const [soDetail, setSoDetail] = React.useState<SoDetail | null>(null);
  const [errorPresentation, setErrorPresentation] = React.useState<OperationalErrorPresentation | null>(null);
  const [initializingPlanning, setInitializingPlanning] = React.useState(false);
  const [fgBufferPercentInput, setFgBufferPercentInput] = React.useState("0");
  const [suggestedFgPlanningBufferPercent, setSuggestedFgPlanningBufferPercent] = React.useState<number | null>(null);
  const [savingBuffer, setSavingBuffer] = React.useState(false);
  const bufferPersistSeqRef = React.useRef(0);
  const [loading, setLoading] = React.useState(false);
  const [strictInventory, setStrictInventory] = React.useState(false);
  const [planQtyByLineId, setPlanQtyByLineId] = React.useState<Record<number, string>>({});
  const didAutoRunRef = React.useRef(false);
  const [allowSoChange, setAllowSoChange] = React.useState(false);
  const [noQtyGate, setNoQtyGate] = React.useState<"loading" | "no_qty" | "ok">("ok");
  const [hasExistingWorkOrder, setHasExistingWorkOrder] = React.useState(false);
  const [existingWoContext, setExistingWoContext] = React.useState<{ woId: number; wolId: number } | null>(null);
  const [woRmReadiness, setWoRmReadiness] = React.useState<ProductionRmReadiness | null>(null);
  const [procurementQueueCtx, setProcurementQueueCtx] = React.useState<{
    pendingPoStatus?: string;
    pendingGrnStatus?: string;
  } | null>(null);

  React.useEffect(() => {
    if (!urlSoId) {
      setNoQtyGate("ok");
      return;
    }
    setNoQtyGate("loading");
    apiFetch<{ orderType?: string }>(`/api/sales-orders/${urlSoId}`)
      .then((so) => setNoQtyGate(so.orderType === "NO_QTY" ? "no_qty" : "ok"))
      .catch(() => setNoQtyGate("ok"));
  }, [urlSoId]);

  React.useEffect(() => {
    const fromUrl = urlSoId;
    if (fromUrl > 0) {
      // Deep-link prepare flow (dashboard → Create Work Order): single SO via SO_DETAIL_READ_ROLES.
      apiFetch<SoDetail>(`/api/sales-orders/${fromUrl}`)
        .then((so) => {
          if (!isRegularSoRow(so)) {
            setOrders([]);
            setSoId(0);
            return;
          }
          const row = soDetailToSoRow(so);
          setOrders([row]);
          setSoId(fromUrl);
        })
        .catch((e) => setErrorPresentation(presentOperationalError(e)));
      return;
    }
    if (isAdmin) {
      apiFetch<SoRow[]>("/api/sales-orders")
        .then((r) => {
          const regularOnly = (Array.isArray(r) ? r : []).filter((o) => isRegularSoRow(o));
          setOrders(regularOnly);
          setSoId((cur) => (cur === 0 && regularOnly.length ? regularOnly[0].id : cur));
        })
        .catch((e) => setErrorPresentation(presentOperationalError(e)));
      return;
    }
    void (async () => {
      try {
        const eligible = await apiFetch<{ ids: number[] }>("/api/production/eligible-sales-orders-for-wo");
        const eligibleIds = (eligible?.ids ?? []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
        const results = await Promise.allSettled(
          eligibleIds.map((id) => apiFetch<SoDetail>(`/api/sales-orders/${id}`)),
        );
        const regularOnly: SoRow[] = [];
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          const row = soDetailToSoRow(result.value);
          if (isRegularSoRow(row)) regularOnly.push(row);
        }
        setOrders(regularOnly);
        setSoId((cur) => (cur === 0 && regularOnly.length ? regularOnly[0].id : cur));
      } catch (e) {
        setErrorPresentation(presentOperationalError(e));
      }
    })();
  }, [searchParams, urlSoId, isAdmin]);

  async function loadSoContext() {
    if (!soId) return;
    try {
      const so = await apiFetch<SoDetail>(`/api/sales-orders/${soId}`);
      setSoDetail(so);
    } catch {
      // Keep any prior context if refresh fails.
    }
  }

  React.useEffect(() => {
    if (!soId) {
      setSoDetail(null);
      return;
    }
    void loadSoContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soId]);

  React.useEffect(() => {
    setAllowSoChange(false);
    setFgBufferPercentInput("0");
  }, [urlSoId]);

  React.useEffect(() => {
    apiFetch<{ strictInventoryControl: boolean }>("/api/settings/inventory-mode")
      .then((r) => setStrictInventory(!!r.strictInventoryControl))
      .catch(() => setStrictInventory(false));
  }, []);

  function bufferPercentForSnapshot(): number {
    const parsed = parseRegularSoBufferPercentInput(fgBufferPercentInput);
    return clampRegularSoBufferPercent(parsed == null ? 0 : parsed);
  }

  async function tryInitializePlanningSnapshot(): Promise<
    { ok: true } | { ok: false; error: unknown }
  > {
    if (!soId) return { ok: false, error: new Error("No sales order selected") };
    try {
      await apiFetch(`/api/sales-orders/${soId}/production-planning-snapshot`, {
        method: "PUT",
        body: JSON.stringify({ bufferPercent: bufferPercentForSnapshot() }),
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function persistProductionBuffer(bufferPercent: number): Promise<boolean> {
    if (!soId) return false;
    const normalized = clampRegularSoBufferPercent(bufferPercent);
    const seq = ++bufferPersistSeqRef.current;
    setSavingBuffer(true);
    try {
      await apiFetch(`/api/sales-orders/${soId}/production-planning-snapshot`, {
        method: "PUT",
        body: JSON.stringify({ bufferPercent: normalized }),
      });
      if (seq !== bufferPersistSeqRef.current) return false;
      return await runCheck(planQtyByLineId, { skipPlanInit: true });
    } catch (e) {
      if (seq !== bufferPersistSeqRef.current) return false;
      const presented = presentOperationalError(e);
      setErrorPresentation(presented);
      toast.showError(presented.userMessage);
      return false;
    } finally {
      if (seq === bufferPersistSeqRef.current) setSavingBuffer(false);
    }
    return false;
  }

  function syncBufferInputFromFgLines(
    fgLines: FgRow[] | undefined,
    suggested?: number | null,
  ) {
    const primary = (fgLines ?? []).find((f) => !f.note) ?? (fgLines ?? [])[0];
    if (!primary) return;
    const applied = Number(primary.productionBufferPercent ?? 0);
    const fallback =
      suggested != null && Number.isFinite(suggested)
        ? clampRegularSoBufferPercent(suggested)
        : 0;
    setFgBufferPercentInput(String(clampRegularSoBufferPercent(applied > 0 ? applied : fallback)));
  }

  async function handleInitializePlanning() {
    if (!soId || initializingPlanning) return;
    setInitializingPlanning(true);
    try {
      const result = await tryInitializePlanningSnapshot();
      if (!result.ok) {
        setErrorPresentation(presentPlanningInitFailure(result.error));
        return;
      }
      setErrorPresentation(null);
      didAutoRunRef.current = false;
      const ok = await runCheck(planQtyByLineId, { retriedInit: true });
      if (ok) {
        toast.showSuccess("Production planning initialized.");
      }
    } finally {
      setInitializingPlanning(false);
    }
  }

  async function runCheck(
    planOverride?: Record<number, string>,
    opts?: { skipPlanInit?: boolean; retriedInit?: boolean },
  ): Promise<boolean> {
    if (!soId) return false;
    setErrorPresentation(null);
    setLoading(true);
    const plan = planOverride ?? planQtyByLineId;
    try {
      const planQs = buildPlanLineQtyQuery(plan);
      const [res, so] = await Promise.all([
        apiFetch<RmCheckResponse>(`/api/sales-orders/${soId}/rm-check${planQs ? `?${planQs.slice(1)}` : ""}`),
        apiFetch<SoDetail>(`/api/sales-orders/${soId}`),
      ]);
      setData(res);
      setSoDetail(so);
      const suggested = res.suggestedFgPlanningBufferPercent ?? null;
      setSuggestedFgPlanningBufferPercent(suggested);
      syncBufferInputFromFgLines(res.fgLines, suggested);

      if (!opts?.skipPlanInit) {
        const defaults: Record<number, string> = {};
        for (const f of res.fgLines || []) {
          defaults[f.lineId] = String(Math.max(0, Number(f.plannedProductionQty ?? f.rmPlanningQty ?? f.toProduce) || 0));
        }
        const fromTr = (searchParams.get("from") ?? "") === "customer-tracking";
        const sf = Number(searchParams.get("shortfallQty") ?? 0);
        const merged =
          fromTr && sf > 0 ? applyCustomerTrackingShortfallToPlanDefaults(res.fgLines ?? [], defaults, sf) : defaults;
        setPlanQtyByLineId(merged);
      }
      return true;
    } catch (e) {
      const presented = presentOperationalError(e);
      await loadSoContext();
      if (presented.canRetryInitializePlanning && !opts?.retriedInit) {
        const initResult = await tryInitializePlanningSnapshot();
        if (initResult.ok) {
          setLoading(false);
          return runCheck(planOverride, { ...opts, retriedInit: true });
        }
      }
      setErrorPresentation(presented);
      setData(null);
      setPlanQtyByLineId({});
      return false;
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    const fromUrl = urlSoId;
    if (!fromUrl || !soId) return;
    if (Number(fromUrl) !== Number(soId)) return;
    if (didAutoRunRef.current) return;
    const sel = orders.find((o) => Number(o.id) === Number(soId));
    if (!sel || !isRegularSoRow(sel)) return;
    didAutoRunRef.current = true;
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, soId, searchParams]);


  /**
   * Operator-first rule (Phase E):
   * Work Order creation is a PRIMARY action and must not be blocked by RM shortage / procurement readiness.
   * Backend may still compute `canCreateWorkOrder` for legacy gatekeeping, but UI only blocks on:
   * - missing BOM / invalid FG plan lines (captured by `canStartWo`)
   * - planning snapshot initialization failure (handled via `errorPresentation`)
   */
  const canCreateWoMaterial = Boolean(data?.canCreateWorkOrder);
  const allRmAvailable = Boolean(data?.materialReadiness?.allRmAvailable ?? data?.allRmEnough);

  function createWorkOrder() {
    if (!data || !soId) return;
    const lines = data.fgLines
      .filter((f) => Number(f.plannedProductionQty ?? f.rmPlanningQty ?? f.toProduce) > 0 && !f.note)
      .map((f) => {
        const planned = planQtyByLineId[f.lineId];
        const qty = Math.max(0, Number(planned ?? f.plannedProductionQty ?? f.rmPlanningQty ?? f.toProduce));
        return { fgItemId: f.fgItemId, qty: Number.isFinite(qty) ? qty : 0 };
      })
      .filter((x) => x.qty > 0);
    if (!lines.length) {
      setErrorPresentation({
        userMessage: "Nothing to manufacture (FG stock covers order or missing BOM).",
        technicalDetail: null,
        isPlanningSetupIncomplete: false,
        canRetryInitializePlanning: false,
      });
      return;
    }
    nav("/work-orders", { state: { source: "rmCheck", salesOrderId: soId, woLines: lines } });
  }

  function adjustStock() {
    if (strictInventory) return;
    nav("/stock/adjustment");
  }

  const hasRmDemand = Boolean(data && data.rmSummary && data.rmSummary.length > 0);
  const hasRmShortage = Boolean(data && (data.rmSummary || []).some((rm) => Number(rm.shortage) > 0));
  const pendingWoPlanningMrs = data?.pendingMaterialRequirements ?? [];
  const hasPendingWoPlanningMr = pendingWoPlanningMrs.length > 0;
  const pendingMrLabel = hasPendingWoPlanningMr ? formatPendingMrRefs(pendingWoPlanningMrs) : "";
  /** DRAFT MR may remain on file after GRN; operators should still be able to create WO. */
  const showProcurementWaitStrip = false;

  React.useEffect(() => {
    if (!soId) {
      setHasExistingWorkOrder(false);
      setExistingWoContext(null);
      setWoRmReadiness(null);
      return;
    }
    let cancelled = false;
    apiFetch<{ id: number; status?: string; lines?: { id: number }[] }[]>(
      `/api/production/work-orders?salesOrderId=${encodeURIComponent(String(soId))}`,
    )
      .then((wos) => {
        if (cancelled) return;
        const active = (Array.isArray(wos) ? wos : []).filter((w) => String(w.status ?? "") !== "REJECTED");
        setHasExistingWorkOrder(active.length > 0);
        const primary = active[0];
        const wolId = primary?.lines?.[0]?.id ?? 0;
        const woId = primary?.id ?? 0;
        if (woId > 0 && wolId > 0) {
          setExistingWoContext({ woId, wolId });
        } else {
          setExistingWoContext(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasExistingWorkOrder(false);
          setExistingWoContext(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [soId, data?.canCreateWorkOrder, data?.pendingMaterialRequirements?.length]);

  React.useEffect(() => {
    const wolId = existingWoContext?.wolId ?? 0;
    if (!(wolId > 0)) {
      setWoRmReadiness(null);
      return;
    }
    let cancelled = false;
    void apiFetch<ProductionRmReadiness | { skipped: boolean }>(
      `/api/production/work-order-lines/${wolId}/rm-readiness`,
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
  }, [existingWoContext?.wolId]);

  React.useEffect(() => {
    if (!soId || !showProcurementWaitStrip) {
      setProcurementQueueCtx(null);
      return;
    }
    let cancelled = false;
    apiFetch<WoPrepareDashboardQueues>("/api/dashboard/wo-prepare-queues")
      .then((queues) => {
        if (cancelled) return;
        const row = (queues.purchaseGrnPending ?? []).find((r) => Number(r.salesOrderId) === Number(soId));
        setProcurementQueueCtx(
          row
            ? {
                pendingPoStatus: row.pendingPoStatus,
                pendingGrnStatus: row.pendingGrnStatus,
              }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setProcurementQueueCtx(null);
      });
    return () => {
      cancelled = true;
    };
  }, [soId, showProcurementWaitStrip]);

  function refreshStockCheck() {
    void runCheck(planQtyByLineId, { skipPlanInit: true });
  }

  function renderWorkflowContinuityNav() {
    if (!soId) return null;
    return (
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2">
        <Link
          to={`/work-orders?salesOrderId=${encodeURIComponent(String(soId))}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 text-[11px] text-slate-700 no-underline")}
        >
          {REGULAR_TERMS.BACK_TO_WORK_ORDERS}
        </Link>
        <Link
          to={`/sales-orders?salesOrderId=${encodeURIComponent(String(soId))}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 text-[11px] text-slate-700 no-underline")}
        >
          {REGULAR_TERMS.BACK_TO_SALES_ORDERS}
        </Link>
      </div>
    );
  }

  const nextStepHint = (searchParams.get("nextStep") ?? "").trim();
  const canStartWo =
    data &&
    data.fgLines.some((f) => {
      if (!(f.toProduce > 0 && !f.note)) return false;
      const planned = planQtyByLineId[f.lineId];
      const qty = Math.max(0, Number(planned ?? f.rmPlanningQty ?? f.toProduce));
      return Number.isFinite(qty) && qty > 0;
    });

  const autoLoadSelected = Boolean(urlSoId && soId && Number(urlSoId) === Number(soId));
  const selectionMissing = !soId;

  const rmPlanTotalQty = React.useMemo(() => {
    if (!data) return 0;
    let t = 0;
    for (const f of data.fgLines || []) {
      if (f.note) continue;
      t += Math.max(0, Number(planQtyByLineId[f.lineId]) || 0);
    }
    return t;
  }, [data, planQtyByLineId]);

  const customerTrackingPlanExceedsShortfall =
    fromCustomerTracking &&
    customerTrackingShortfallQty > 0 &&
    rmPlanTotalQty > customerTrackingShortfallQty + 1e-6;

  const fgLinesForDisplay = data?.fgLines ?? [];
  const primaryFgLine =
    fgLinesForDisplay.find((f) => !f.note && Number(f.rmPlanningQty ?? f.toProduce) > 0) ??
    fgLinesForDisplay.find((f) => !f.note) ??
    null;
  const extraFgLines =
    primaryFgLine != null
      ? fgLinesForDisplay.filter((f) => f.lineId !== primaryFgLine.lineId && !f.note)
      : fgLinesForDisplay.filter((f) => !f.note);

  const fgBufferParsed = parseRegularSoBufferPercentInput(fgBufferPercentInput);
  const fgBufferPercentForCalc =
    fgBufferParsed == null ? 0 : clampRegularSoBufferPercent(fgBufferParsed);
  const fgBufferInputInvalid =
    (fgBufferParsed != null && fgBufferParsed > REGULAR_SO_BUFFER_PERCENT_MAX + 1e-9) ||
    (fgBufferParsed != null && fgBufferParsed < -1e-9);

  const woCreateDisabled = !canStartWo || loading || initializingPlanning || savingBuffer || fgBufferInputInvalid;

  const productionPlanningMetrics = React.useMemo(() => {
    if (!primaryFgLine || primaryFgLine.note) return null;
    const customer = Number(primaryFgLine.customerCommittedQty ?? primaryFgLine.orderQty) || 0;
    const fgStock = Number(primaryFgLine.fgStockAdjustmentQty ?? primaryFgLine.fgStock) || 0;
    return computeProductionPlanningMetrics(customer, fgBufferPercentForCalc, fgStock);
  }, [primaryFgLine, fgBufferPercentForCalc]);

  const productionPlanningPrimaryLine = React.useMemo(() => {
    if (!primaryFgLine || primaryFgLine.note) return null;
    return {
      lineId: primaryFgLine.lineId,
      fgName: primaryFgLine.fgName,
      customerCommittedQty: Number(primaryFgLine.customerCommittedQty ?? primaryFgLine.orderQty) || 0,
      fgStockAdjustmentQty: Number(primaryFgLine.fgStockAdjustmentQty ?? primaryFgLine.fgStock) || 0,
    };
  }, [primaryFgLine]);

  const productionPlanningExtraLines = React.useMemo(
    () =>
      extraFgLines.map((f) => ({
        lineId: f.lineId,
        fgName: f.fgName,
        customerCommittedQty: Number(f.customerCommittedQty ?? f.orderQty) || 0,
        fgStockAdjustmentQty: Number(f.fgStockAdjustmentQty ?? f.fgStock) || 0,
      })),
    [extraFgLines],
  );

  React.useEffect(() => {
    if (!soId || !data || errorPresentation || fgBufferInputInvalid || savingBuffer || loading) return;
    const serverPct = clampRegularSoBufferPercent(Number(primaryFgLine?.productionBufferPercent ?? 0));
    if (Math.abs(fgBufferPercentForCalc - serverPct) < 1e-9) return;
    const t = window.setTimeout(() => {
      void persistProductionBuffer(fgBufferPercentForCalc);
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fgBufferPercentForCalc,
    soId,
    data,
    errorPresentation,
    fgBufferInputInvalid,
    primaryFgLine?.productionBufferPercent,
    savingBuffer,
    loading,
  ]);

  const soDisplayLabel = soDetail?.docNo?.trim() || (soId > 0 ? `SO-${soId}` : "Select sales order");
  const contextFgFromDetail = soDetail?.lines?.find((l) => l.item?.itemName);
  const contextFgFromList = orders.find((o) => o.id === soId)?.lines?.[0];
  const contextFgName = contextFgFromDetail?.item?.itemName ?? contextFgFromList?.item?.itemName ?? null;
  const contextCustomerQtyRaw = contextFgFromDetail?.qty ?? contextFgFromList?.qty;
  const contextCustomerQty =
    contextCustomerQtyRaw != null && Number.isFinite(Number(contextCustomerQtyRaw))
      ? Number(contextCustomerQtyRaw)
      : null;

  const firstPendingMrId = pendingWoPlanningMrs[0]?.id;

  const workflowState = React.useMemo(() => {
    if (!data) return null;
    return deriveWoPrepareWorkflowState({
      canCreateWorkOrder: canCreateWoMaterial,
      hasRmShortage,
      hasPendingMr: hasPendingWoPlanningMr,
      hasExistingWorkOrder,
      allFgEnough: Boolean(data.allFgEnough),
      pendingPoStatus: procurementQueueCtx?.pendingPoStatus,
      pendingGrnStatus: procurementQueueCtx?.pendingGrnStatus,
    });
  }, [
    data,
    canCreateWoMaterial,
    hasRmShortage,
    hasPendingWoPlanningMr,
    hasExistingWorkOrder,
    procurementQueueCtx,
  ]);

  const workflowStepLabel = React.useMemo(() => {
    if (!data || workflowState == null) return null;
    return deriveWoPrepareWorkflowStepLabel({
      workflowState,
      canCreateWorkOrder: canCreateWoMaterial,
      hasRmShortage,
      hasPendingMr: hasPendingWoPlanningMr,
      hasExistingWorkOrder,
      allRmAvailable,
    });
  }, [
    data,
    workflowState,
    canCreateWoMaterial,
    hasRmShortage,
    hasPendingWoPlanningMr,
    hasExistingWorkOrder,
    allRmAvailable,
  ]);

  const readinessItems = React.useMemo(() => {
    if (!data) return [];
    const productionReady = canCreateWoMaterial && allRmAvailable && !hasRmShortage;
    return buildWoPrepareReadinessChecklist({
      salesOrderApproved: true,
      rmAvailableInStore: allRmAvailable && !hasRmShortage,
      workOrderCreationAllowed: canCreateWoMaterial,
      productionReady,
    });
  }, [data, canCreateWoMaterial, allRmAvailable, hasRmShortage]);

  const blockedCardModel = React.useMemo(() => {
    if (!data || !soId || workflowState == null || workflowStepLabel == null) return null;
    if (canCreateWoMaterial || hasExistingWorkOrder || workflowState === "FG_STOCK_COVERS") return null;
    return buildWoPrepareBlockedCardModel({
      workflowState,
      stepLabel: workflowStepLabel,
      salesOrderId: soId,
      firstMrId: firstPendingMrId,
      onRefresh: refreshStockCheck,
    });
  }, [
    data,
    soId,
    workflowState,
    workflowStepLabel,
    canCreateWoMaterial,
    hasExistingWorkOrder,
    firstPendingMrId,
  ]);

  const woCreatedNextStep = React.useMemo(() => {
    if (workflowState !== "WO_CREATED" || !existingWoContext || !woRmReadiness) return null;
    if (isProductionBlockedByRmReadiness(woRmReadiness)) {
      return buildRmIssueNextStep(woRmReadiness, "prepare-wo");
    }
    return buildRmReadyProductionNextStep(existingWoContext.woId, existingWoContext.wolId);
  }, [workflowState, existingWoContext, woRmReadiness]);

  const guidedStripModel = React.useMemo(() => {
    if (!data || !soId || workflowState == null) return null;
    const resumeWorkOrder =
      nextStepHint === "resume-work-order" && workflowState === "READY_FOR_WO" && !data.allFgEnough;
    return buildWoPrepareGuidedStripModel({
      state: workflowState,
      salesOrderId: soId,
      pendingMrLabel,
      firstMrId: firstPendingMrId,
      canRaiseMr: false,
      raisingMr: false,
      canStartWo: Boolean(canStartWo),
      woCreateDisabled,
      loading,
      resumeWorkOrder,
      onRaiseMr: () => {},
      onCreateWo: createWorkOrder,
      onResumeWo: () => nav(`/work-orders?salesOrderId=${encodeURIComponent(String(soId))}`),
      onRefreshAvailability: refreshStockCheck,
    });
  }, [
    data,
    soId,
    workflowState,
    pendingMrLabel,
    firstPendingMrId,
    canStartWo,
    woCreateDisabled,
    loading,
    nextStepHint,
    planQtyByLineId,
  ]);

  if (noQtyGate === "loading" && urlSoId > 0) {
    return (
      <div className="mx-auto max-w-lg p-4 text-sm text-slate-600" aria-live="polite">
        Loading sales orderâ€¦
      </div>
    );
  }

  if (noQtyGate === "no_qty" && urlSoId > 0) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-4">
        <Card className="border-amber-200 bg-amber-50/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-950">{NO_QTY_TERMS.WRONG_FLOW_NO_QTY_TITLE}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-800">
            <p>{NO_QTY_TERMS.WRONG_FLOW_NO_QTY_BODY}</p>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/planning-dashboard"
                className={cn(buttonVariants({ variant: "default", size: "sm" }), "no-underline")}
              >
                {NO_QTY_TERMS.OPEN_REQUIREMENT_PLANNING}
              </Link>
              <Link
                to="/sales-orders"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}
              >
                {REGULAR_TERMS.SIDEBAR_BACK_TO_SALES_ORDERS}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const primaryCardHelp =
    urlSoId > 0 ? REGULAR_TERMS.WORK_ORDER_PREPARE_SUBTITLE : REGULAR_TERMS.SELECT_SO_HELPER;

  const soSelectorControl =
    !urlSoId || allowSoChange ? (
      <select
        className="h-8 min-w-[10rem] rounded border border-slate-300 bg-white px-2 text-xs font-medium"
        value={soId || ""}
        onChange={(e) => {
          didAutoRunRef.current = false;
          setSoId(Number(e.target.value));
          setData(null);
        }}
      >
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            {o.docNo?.trim() || `SO-${o.id}`}
          </option>
        ))}
      </select>
    ) : (
      <button
        type="button"
        className="text-xs font-semibold text-slate-700 underline underline-offset-2"
        onClick={() => setAllowSoChange(true)}
      >
        Change SO
      </button>
    );

  return (
    <PageContainer className="erp-txn-workspace max-w-5xl">
      {fromCustomerTracking && customerTrackingShortfallQty > 0 && soId > 0 ? (
        <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
          <span className="font-bold">Customer Tracking shortfall:</span>{" "}
          <span className="tabular-nums">{customerTrackingShortfallQty}</span> qty pending.
        </div>
      ) : null}

      {!data && !selectionMissing && !errorPresentation ? (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <div className="font-semibold text-slate-900">{REGULAR_TERMS.WORK_ORDER_PREPARE_TITLE}</div>
          <p className="mt-0.5 text-xs text-slate-600">{primaryCardHelp}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {soSelectorControl}
            {!autoLoadSelected ? (
              <Button type="button" size="sm" onClick={() => void runCheck()} disabled={loading || !soId}>
                {loading ? "Loading..." : REGULAR_TERMS.LOAD_RM_FG_BUTTON}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectionMissing ? (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          {REGULAR_TERMS.SELECT_SO_PROMPT}
        </div>
      ) : null}

      {errorPresentation ? (
        <div className="space-y-2">
          {soId > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-slate-800">
                  <span className="font-bold tracking-tight text-slate-950">{soDisplayLabel}</span>
                  {contextFgName ? (
                    <>
                      <span className="hidden text-slate-300 sm:inline" aria-hidden>
                        ·
                      </span>
                      <span className="whitespace-nowrap">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          FG:
                        </span>{" "}
                        <span className="font-semibold text-slate-950">{contextFgName}</span>
                      </span>
                    </>
                  ) : null}
                  {contextCustomerQty != null ? (
                    <>
                      <span className="hidden text-slate-300 sm:inline" aria-hidden>
                        ·
                      </span>
                      <span className="whitespace-nowrap">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Customer Qty:
                        </span>{" "}
                        <span className="tabular-nums font-semibold text-slate-950">{contextCustomerQty}</span>
                      </span>
                    </>
                  ) : null}
                  <span className="hidden text-slate-300 sm:inline" aria-hidden>
                    ·
                  </span>
                  <span className="whitespace-nowrap">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Planning Status:
                    </span>{" "}
                    <span className="font-semibold text-amber-800">
                      {errorPresentation.isPlanningSetupIncomplete ? "Setup Incomplete" : "Unavailable"}
                    </span>
                  </span>
                </div>
                <div className="shrink-0">{soSelectorControl}</div>
              </div>
            </div>
          ) : null}
          <OperationalSystemErrorCard
            message={errorPresentation.userMessage}
            technicalDetail={errorPresentation.technicalDetail}
            showAdminDebug={isAdmin}
            onRetry={
              errorPresentation.canRetryInitializePlanning
                ? () => void handleInitializePlanning()
                : () => void runCheck(planQtyByLineId)
            }
            retryLoading={initializingPlanning}
            retryLabel={errorPresentation.canRetryInitializePlanning ? "Initialize planning" : "Retry"}
            backHref="/sales-orders"
            backLabel={REGULAR_TERMS.SIDEBAR_BACK_TO_SALES_ORDERS}
          />
          {errorPresentation.canRetryInitializePlanning ? (
            <p className="mx-auto max-w-[620px] text-center text-xs leading-snug text-slate-500">
              Planning needs a quick initialization step. Once it completes, you can create the Work Order.
            </p>
          ) : null}
        </div>
      ) : null}

      {data && workflowState && workflowStepLabel ? (
        <>
          <WoPrepareOperationalHeader
            soLabel={soDisplayLabel}
            loading={loading}
            soSelector={soSelectorControl}
            primaryFg={
              primaryFgLine
                ? {
                    fgName: primaryFgLine.fgName,
                    customerCommittedQty: primaryFgLine.customerCommittedQty ?? primaryFgLine.orderQty,
                    orderQty: primaryFgLine.orderQty,
                    productionBufferPercent: primaryFgLine.productionBufferPercent ?? 0,
                    productionBufferQty: primaryFgLine.productionBufferQty ?? 0,
                    plannedProductionQty: primaryFgLine.plannedProductionQty ?? primaryFgLine.orderQty,
                    fgStockAdjustmentQty: primaryFgLine.fgStockAdjustmentQty ?? primaryFgLine.fgStock,
                    fgStock: primaryFgLine.fgStock,
                    rmPlanningQty: primaryFgLine.rmPlanningQty ?? primaryFgLine.toProduce,
                    toProduce: primaryFgLine.toProduce,
                    note: primaryFgLine.note,
                  }
                : null
            }
            extraFgCount={extraFgLines.length}
          />

          {productionPlanningPrimaryLine && productionPlanningMetrics ? (
            <WoPrepareProductionPlanningPanel
              primaryLine={productionPlanningPrimaryLine}
              extraLines={productionPlanningExtraLines}
              metrics={productionPlanningMetrics}
              suggestedBufferPercent={suggestedFgPlanningBufferPercent}
              bufferPercentInput={fgBufferPercentInput}
              onBufferPercentInputChange={setFgBufferPercentInput}
              bufferInputInvalid={fgBufferInputInvalid}
              saving={savingBuffer}
              disabled={loading || initializingPlanning}
            />
          ) : null}

          {hasRmDemand && data ? (
            <section className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
              <WoPrepareRmReadinessTable
                rows={data.rmSummary}
                hasPendingMr={hasPendingWoPlanningMr}
                canCreateWorkOrder={canCreateWoMaterial}
                extraFgLines={
                  extraFgLines.length > 0
                    ? extraFgLines.map((f) => {
                        const m = computeProductionPlanningMetrics(
                          Number(f.customerCommittedQty ?? f.orderQty) || 0,
                          fgBufferPercentForCalc,
                          Number(f.fgStockAdjustmentQty ?? f.fgStock) || 0,
                        );
                        return {
                          fgName: f.fgName,
                          customerCommittedQty: m.customerCommittedQty,
                          orderQty: f.orderQty,
                          productionBufferPercent: m.productionBufferPercent,
                          productionBufferQty: m.productionBufferQty,
                          plannedProductionQty: m.plannedProductionQty,
                          fgStockAdjustmentQty: m.fgStockAdjustmentQty,
                          fgStock: f.fgStock,
                          rmPlanningQty: m.rmPlanningQty,
                          toProduce: m.rmPlanningQty,
                        };
                      })
                    : undefined
                }
              />
            </section>
          ) : null}

          {customerTrackingPlanExceedsShortfall && workflowState === "READY_FOR_WO" ? (
            <div className="rounded-md border border-amber-400 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-950">
              Planned qty ({rmPlanTotalQty}) exceeds Customer Tracking pending qty ({customerTrackingShortfallQty}).
            </div>
          ) : null}

          {blockedCardModel ? (
            <WoPrepareWorkOrderBlockedCard
              model={blockedCardModel}
              onRefresh={refreshStockCheck}
              refreshing={loading}
            />
          ) : null}

          {woCreatedNextStep ? (
            <NextStepStrip
              visible
              density="compact"
              variant={isProductionBlockedByRmReadiness(woRmReadiness) ? "blocked" : "action"}
              title={woCreatedNextStep.statusTitle}
              subtitle={
                woCreatedNextStep.blockingReason
                  ? `${woCreatedNextStep.statusSubtitle ?? ""} · ${woCreatedNextStep.blockingReason}`
                  : woCreatedNextStep.statusSubtitle
              }
              className="gap-1.5 rounded-md px-2 py-1.5"
              primaryAction={{
                label: woCreatedNextStep.primaryAction.label,
                testId: woCreatedNextStep.primaryAction.testId,
                onClick: () => {
                  const href = woCreatedNextStep.primaryAction.href;
                  if (href) nav(href);
                },
              }}
            />
          ) : null}

          {guidedStripModel && !blockedCardModel && !woCreatedNextStep ? (
            <WoPrepareGuidedStrip model={guidedStripModel} />
          ) : null}

          <WoPrepareWorkflowProgress activeStep={workflowStepLabel} />

          {readinessItems.length > 0 ? <WoPrepareReadinessChecklist items={readinessItems} /> : null}

          {isAdmin && !strictInventory && hasRmShortage ? (
            <Button type="button" variant="ghost" size="sm" onClick={adjustStock} className="text-slate-700">
              Admin: Stock Adjustment
            </Button>
          ) : null}
          {renderWorkflowContinuityNav()}
        </>
      ) : null}
    </PageContainer>
  );
}
