/**
 * Phase 3A — Store material issue (transfer RM to production location). Stock movement only.
 */
import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRightLeft, Plus, Send, Trash2 } from "lucide-react";
import { apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { useToast } from "../contexts/ToastContext";
import { PageContainer, StickyWorkspaceHead } from "../components/PageHeader";
import { NextStepStrip } from "../components/erp/NextStepStrip";
import { buildRmReadyProductionNextStep } from "../lib/regularSoOperationalGuidance";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";
import {
  formatSuggestedIssueQty,
  hasPartialStoreAutofill,
  isMaterialIssueLineStockBlocked,
} from "../lib/materialIssueUx";
import {
  materialRequestsQueueHref,
  materialWorkflowBackHref,
} from "../lib/materialWorkflowLinks";
import { buildRmControlCenterHref } from "../lib/woProcurementContinuity";
import { MaterialIssuePmrQueuePanel } from "../components/erp/MaterialIssuePmrQueuePanel";
import {
  pickActionablePmrForWorkOrder,
  pmrNextActionLabel,
  resolveMaterialIssueLineStatus,
} from "../lib/materialIssueWorkspace";

type LocationRow = {
  id: number;
  locationCode: string;
  locationName: string;
  locationType: string;
};

type WoOption = {
  id: number;
  docNo: string | null;
  label: string;
};

type RmItem = { id: number; itemName: string; unit: string };
type ReservationBreakdownRow = {
  sourceType: "PMR" | "ALLOCATION" | string;
  allocationNo?: string | null;
  pmrId?: number | null;
  pmrDocNo?: string | null;
  workOrderNo?: string | null;
  reservedQty: number;
};

type IssueLineDraft = {
  key: string;
  pmrLineId?: number;
  itemId: number | "";
  itemName?: string;
  unit?: string;
  /** PMR original request (requiredQty). */
  originalRequestQty?: number;
  /** PMR qty already issued to production. */
  alreadyIssuedQty?: number;
  /** PMR balance still to issue (= original − issued). */
  stillRequiredQty?: number;
  /** WO-wise cap after prior issue, consumption, and return history. */
  issueCapQty?: number;
  fullWoRmNeed?: number;
  consumedQty?: number;
  returnedQty?: number;
  atProductionQty?: number;
  requiredForBalanceQty?: number;
  pmrPendingQty?: number;
  /** @deprecated alias — validation uses still required balance. */
  pendingQty?: number;
  issueQty: string;
  /** When false, availability refresh may update issueQty from store stock. */
  issueQtyTouched: boolean;
  totalStoreStock?: number | null;
  reservedForOtherOrdersQty?: number | null;
  totalReservedQty?: number | null;
  globalFreeStockQty?: number | null;
  issueAvailableStoreQty?: number | null;
  reservationForCurrentPmrQty?: number | null;
  reservationBreakdown?: ReservationBreakdownRow[];
  freeStoreStock?: number | null;
  available: number | null;
  loadingAvailable: boolean;
};

type PendingPmr = {
  id: number;
  docNo: string | null;
  status: string;
  workOrderId?: number;
  workOrderNo: string | null;
  salesOrderNo?: string | null;
  productionItemName?: string | null;
  totalPending: number;
  lineCount?: number;
};

type IssueMode = "wo-pmr" | "manual";

type PmrIssueLine = {
  id: number;
  itemId: number;
  itemName: string;
  requiredQty: number;
  issuedQty: number;
  pendingQty: number;
  unit: string;
  totalStoreStock?: number | null;
  reservedForOtherOrdersQty?: number | null;
  totalReservedQty?: number | null;
  globalFreeStockQty?: number | null;
  issueAvailableStoreQty?: number | null;
  reservationForCurrentPmrQty?: number | null;
  reservationBreakdown?: ReservationBreakdownRow[];
  freeStoreStock?: number | null;
  availableStoreQty?: number | null;
  available?: number | null;
  suggestedIssueQty?: number;
  issueCapQty?: number;
  stillRequiredQty?: number;
};

type PmrIssueContext = {
  pmr: PendingPmr & {
    productionItemName?: string | null;
    lines: PmrIssueLine[];
  };
  lines: PmrIssueLine[];
  pendingLines: PmrIssueLine[];
};

type ContextResponse = {
  fromLocations: LocationRow[];
  toLocations: LocationRow[];
  workOrders: WoOption[];
  rmItems: RmItem[];
};

type RecentIssue = {
  id: number;
  docNo: string | null;
  fromLocation: LocationRow;
  toLocation: LocationRow;
  workOrderNo: string | null;
  remarks: string | null;
  createdAt: string;
  lineCount: number;
  lines: Array<{ itemName: string; issueQty: number; unit: string }>;
};

function postIssueSearchParams(returnTo: string | null, workOrderId?: number): Record<string, string> {
  const next: Record<string, string> = {};
  if (returnTo) next.returnTo = returnTo;
  if (returnTo === "production-workspace" && workOrderId && workOrderId > 0) {
    next.workOrderId = String(workOrderId);
  }
  return next;
}

function fmtQty(n: number, unit?: string) {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

function newLineKey() {
  return `ln-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PMR_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Pending Issue",
  PARTIALLY_ISSUED: "Partial Issue",
  FULLY_ISSUED: "Fully Issued",
};

function pmrLineToDraft(pl: PmrIssueLine): IssueLineDraft {
  const issueCap = pl.issueCapQty ?? pl.stillRequiredQty ?? pl.pendingQty;
  const storeQty = pl.freeStoreStock ?? pl.availableStoreQty ?? pl.available ?? null;
  const suggested =
    pl.suggestedIssueQty != null
      ? pl.suggestedIssueQty
      : suggestedMaterialIssueQtyFromLib(issueCap, storeQty);
  return {
    key: `pmr-${pl.id}`,
    pmrLineId: pl.id,
    itemId: pl.itemId,
    itemName: pl.itemName,
    unit: pl.unit,
    originalRequestQty: pl.requiredQty,
    alreadyIssuedQty: pl.issuedQty,
    stillRequiredQty: issueCap,
    issueCapQty: issueCap,
    pmrPendingQty: pl.pendingQty,
    pendingQty: pl.pendingQty,
    totalStoreStock: pl.totalStoreStock ?? null,
    reservedForOtherOrdersQty: pl.reservedForOtherOrdersQty ?? null,
    totalReservedQty: pl.totalReservedQty ?? pl.reservedForOtherOrdersQty ?? null,
    globalFreeStockQty: pl.globalFreeStockQty ?? null,
    issueAvailableStoreQty: pl.issueAvailableStoreQty ?? storeQty,
    reservationForCurrentPmrQty: pl.reservationForCurrentPmrQty ?? null,
    reservationBreakdown: pl.reservationBreakdown ?? [],
    freeStoreStock: storeQty,
    issueQty: suggested > 0 ? String(suggested) : "0",
    issueQtyTouched: false,
    available: storeQty,
    loadingAvailable: false,
  };
}

function suggestedMaterialIssueQtyFromLib(
  pendingQty: number | null | undefined,
  availableInStore: number | null | undefined,
): number {
  return Number(formatSuggestedIssueQty(pendingQty, availableInStore)) || 0;
}

export function MaterialIssuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [ctx, setCtx] = React.useState<ContextResponse | null>(null);
  const [recent, setRecent] = React.useState<RecentIssue[]>([]);
  const [pendingPmrs, setPendingPmrs] = React.useState<PendingPmr[]>([]);
  const [activePmrId, setActivePmrId] = React.useState<number | null>(null);
  const [activePmr, setActivePmr] = React.useState<PmrIssueContext["pmr"] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [issueSuccess, setIssueSuccess] = React.useState<{
    workOrderId: number;
    workOrderNo: string | null;
    salesOrderNo: string | null;
    pmrDocNo: string | null;
    issuedLines: Array<{ itemName: string; issueQty: number; unit: string }>;
  } | null>(null);
  const [pmrLoading, setPmrLoading] = React.useState(false);
  const [pmrLoadError, setPmrLoadError] = React.useState<string | null>(null);
  const [procurementHint, setProcurementHint] = React.useState<{
    mrDocNo: string | null;
    escalationLabel: string;
    pendingGrnQty: number;
    coveredByIncomingQty: number;
    procurementInitiated: boolean;
  } | null>(null);

  const [fromLocationId, setFromLocationId] = React.useState<number | "">("");
  const [toLocationId, setToLocationId] = React.useState<number | "">("");
  const [workOrderId, setWorkOrderId] = React.useState<number | "">("");
  const [remarks, setRemarks] = React.useState("");
  const emptyLine = (): IssueLineDraft => ({
    key: newLineKey(),
    itemId: "",
    issueQty: "",
    issueQtyTouched: false,
    available: null,
    loadingAvailable: false,
  });

  const [lines, setLines] = React.useState<IssueLineDraft[]>([]);
  const [issueMode, setIssueMode] = React.useState<IssueMode>("wo-pmr");

  async function loadPendingPmrs() {
    try {
      const data = await apiFetch<PendingPmr[]>("/api/production-material-requests?pendingForStore=1");
      setPendingPmrs(Array.isArray(data) ? data : []);
    } catch {
      setPendingPmrs([]);
    }
  }

  async function loadPmrIntoForm(pmrId: number, fromId?: number) {
    setPmrLoading(true);
    setPmrLoadError(null);
    try {
      const qs = typeof fromId === "number" ? `?fromLocationId=${fromId}` : "";
      const data = await apiFetch<PmrIssueContext>(`/api/production-material-requests/${pmrId}/issue-context${qs}`);
      setActivePmrId(pmrId);
      setActivePmr(data.pmr);
      if (data.pmr.workOrderId) setWorkOrderId(data.pmr.workOrderId);
      setRemarks(`Issue against ${data.pmr.docNo || `PMR-${pmrId}`}`);
      const sourceLines = data.lines?.length ? data.lines : data.pendingLines;
      setLines(sourceLines.length ? sourceLines.map(pmrLineToDraft) : []);
    } catch (e) {
      setPmrLoadError(e instanceof Error ? e.message : "Could not load PMR");
      setActivePmrId(null);
      setActivePmr(null);
      setLines([]);
      showError(e instanceof Error ? e.message : "Could not load PMR");
    } finally {
      setPmrLoading(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [context, list] = await Promise.all([
        apiFetch<ContextResponse>("/api/material-issues/context"),
        apiFetch<RecentIssue[]>("/api/material-issues/"),
        loadPendingPmrs(),
      ]);
      setCtx(context);
      setRecent(Array.isArray(list) ? list : []);
      if (context.fromLocations.length === 1 && fromLocationId === "") {
        setFromLocationId(context.fromLocations[0].id);
      }
      if (context.toLocations.length === 1 && toLocationId === "") {
        setToLocationId(context.toLocations[0].id);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to load material issue screen");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadAll();
  }, []);

  const urlPmrId = Number(searchParams.get("pmrId")) || 0;
  const urlWorkOrderId = Number(searchParams.get("workOrderId")) || 0;
  const returnTo = searchParams.get("returnTo");

  const selectPmr = React.useCallback(
    (pmrId: number, woId?: number) => {
      const next = new URLSearchParams(searchParams);
      next.set("pmrId", String(pmrId));
      if (returnTo) next.set("returnTo", returnTo);
      const resolvedWo =
        woId ?? pendingPmrs.find((p) => p.id === pmrId)?.workOrderId ?? (typeof workOrderId === "number" ? workOrderId : 0);
      if (resolvedWo && resolvedWo > 0) next.set("workOrderId", String(resolvedWo));
      setSearchParams(next, { replace: true });
      void loadPmrIntoForm(pmrId, typeof fromLocationId === "number" ? fromLocationId : undefined);
    },
    [fromLocationId, pendingPmrs, returnTo, searchParams, setSearchParams, workOrderId],
  );

  const clearExecution = React.useCallback(() => {
    setActivePmrId(null);
    setActivePmr(null);
    setWorkOrderId("");
    setLines([]);
    setPmrLoadError(null);
    const next = new URLSearchParams(searchParams);
    next.delete("pmrId");
    next.delete("workOrderId");
    if (returnTo) next.set("returnTo", returnTo);
    setSearchParams(next, { replace: true });
  }, [returnTo, searchParams, setSearchParams]);

  // Tracks WOs we've already auto-ensured a PMR for, so the URL handoff effect cannot
  // loop when loadPendingPmrs() updates state before activePmrId is set.
  const ensuredWoRef = React.useRef<Set<number>>(new Set());

  const ensurePmrAndSelect = React.useCallback(
    async (woId: number) => {
      ensuredWoRef.current.add(woId);
      setPmrLoading(true);
      try {
        const ensured = await apiFetch<{ id: number }>(
          "/api/production-material-requests/ensure-for-work-order",
          { method: "POST", body: JSON.stringify({ workOrderId: woId }) },
        );
        await loadPendingPmrs();
        if (ensured?.id) {
          selectPmr(ensured.id, woId);
          return;
        }
        showError("No open material request for this work order.");
      } catch (e) {
        showError(e instanceof Error ? e.message : "Could not prepare material request for this work order.");
      } finally {
        setPmrLoading(false);
      }
      setActivePmrId(null);
      setActivePmr(null);
      setLines([]);
    },
    [selectPmr],
  );

  function onWorkOrderSelect(woId: number | "") {
    if (issueMode === "manual") {
      setWorkOrderId(woId);
      return;
    }
    if (!woId) {
      clearExecution();
      return;
    }
    setWorkOrderId(woId);
    const pmr = pickActionablePmrForWorkOrder(woId, pendingPmrs);
    if (pmr) {
      selectPmr(pmr.id, woId);
      return;
    }
    // No open PMR yet — ensure one from the WO's BOM demand (same source RM Control
    // Center uses), then load its RM lines.
    void ensurePmrAndSelect(woId);
  }

  React.useEffect(() => {
    if (!Number.isFinite(urlPmrId) || urlPmrId <= 0 || !ctx) return;
    void loadPmrIntoForm(urlPmrId, typeof fromLocationId === "number" ? fromLocationId : undefined);
  }, [urlPmrId, ctx]);

  React.useEffect(() => {
    if (urlPmrId > 0 || activePmrId || !ctx || issueMode === "manual") return;
    if (!Number.isFinite(urlWorkOrderId) || urlWorkOrderId <= 0) return;
    const pmr = pickActionablePmrForWorkOrder(urlWorkOrderId, pendingPmrs);
    if (pmr) {
      selectPmr(pmr.id, urlWorkOrderId);
      return;
    }
    // Arrived from RM Control Center "Issue RM to Production" for a WO with no PMR yet —
    // ensure one once, then load it.
    if (workOrderId === "") setWorkOrderId(urlWorkOrderId);
    if (!ensuredWoRef.current.has(urlWorkOrderId)) {
      void ensurePmrAndSelect(urlWorkOrderId);
    }
  }, [activePmrId, ctx, issueMode, pendingPmrs, urlPmrId, urlWorkOrderId, workOrderId, selectPmr, ensurePmrAndSelect]);

  const prevFromLocationRef = React.useRef<number | "">("");
  React.useEffect(() => {
    if (!activePmrId || typeof fromLocationId !== "number") return;
    if (prevFromLocationRef.current === fromLocationId) return;
    prevFromLocationRef.current = fromLocationId;
    void loadPmrIntoForm(activePmrId, fromLocationId);
  }, [activePmrId, fromLocationId]);

  async function refreshAvailable(lineKey: string, itemId: number, fromId: number) {
    setLines((prev) =>
      prev.map((ln) =>
        ln.key === lineKey ? { ...ln, loadingAvailable: true, available: null } : ln,
      ),
    );
    try {
      const res = await apiFetch<{
        available: number;
        physicalUsableStockQty?: number;
        totalReservedQty?: number;
        freeStockQty?: number;
        reservationBreakdown?: ReservationBreakdownRow[];
      }>(
        `/api/material-issues/available?fromLocationId=${fromId}&itemId=${itemId}`,
      );
      setLines((prev) =>
        prev.map((ln) => {
          if (ln.key !== lineKey) return ln;
          const available = res.available;
          const next: IssueLineDraft = {
            ...ln,
            available,
            freeStoreStock: available,
            issueAvailableStoreQty: available,
            totalStoreStock: res.physicalUsableStockQty ?? ln.totalStoreStock ?? null,
            totalReservedQty: res.totalReservedQty ?? ln.totalReservedQty ?? null,
            globalFreeStockQty: res.freeStockQty ?? available,
            reservationBreakdown: res.reservationBreakdown ?? [],
            loadingAvailable: false,
          };
          if (!ln.issueQtyTouched && ln.stillRequiredQty != null) {
            next.issueQty = formatSuggestedIssueQty(ln.stillRequiredQty, available);
          }
          return next;
        }),
      );
    } catch (e) {
      setLines((prev) =>
        prev.map((ln) =>
          ln.key === lineKey ? { ...ln, loadingAvailable: false, available: 0 } : ln,
        ),
      );
      showError(e instanceof Error ? e.message : "Could not load available stock");
    }
  }

  function onLineItemChange(lineKey: string, itemId: number | "") {
    setLines((prev) =>
      prev.map((ln) =>
        ln.key === lineKey
          ? { ...ln, itemId, available: null, issueQty: ln.issueQty }
          : ln,
      ),
    );
    if (typeof fromLocationId === "number" && typeof itemId === "number") {
      void refreshAvailable(lineKey, itemId, fromLocationId);
    }
  }

  React.useEffect(() => {
    if (issueMode !== "manual") return;
    if (urlPmrId > 0 || activePmrId) return;
    if (typeof fromLocationId !== "number") return;
    for (const ln of lines) {
      if (typeof ln.itemId === "number" && !ln.pmrLineId) {
        void refreshAvailable(ln.key, ln.itemId, fromLocationId);
      }
    }
  }, [fromLocationId, urlPmrId, activePmrId, issueMode]);

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((ln) => ln.key !== key)));
  }

  async function submitIssue() {
    if (typeof fromLocationId !== "number" || typeof toLocationId !== "number") {
      showError("Select from and to locations.");
      return;
    }
    if (issueMode === "wo-pmr" && !activePmrId) {
      showError("Select a work order or material request first.");
      return;
    }
    const payloadLines = lines
      .filter((ln) => typeof ln.itemId === "number" && Number(ln.issueQty) > 0)
      .map((ln) => ({ itemId: ln.itemId as number, issueQty: Number(ln.issueQty) }));
    if (!payloadLines.length) {
      showError("Add at least one RM line with issue quantity.");
      return;
    }
    for (const ln of lines) {
      if (typeof ln.itemId !== "number" || !ln.issueQty) continue;
      const qty = Number(ln.issueQty);
      const capRequired = ln.issueCapQty ?? ln.stillRequiredQty ?? ln.pendingQty;
      if (capRequired != null && qty > capRequired + 1e-6) {
        showError("Issue quantity cannot exceed still required qty.");
        return;
      }
      if (ln.available != null && qty > ln.available + 1e-6) {
        showError("Issue quantity cannot exceed free store stock.");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (activePmrId) {
        const pmrLines = lines
          .filter((ln) => ln.pmrLineId && Number(ln.issueQty) > 0)
          .map((ln) => ({ pmrLineId: ln.pmrLineId as number, issueQty: Number(ln.issueQty) }));
        if (!pmrLines.length) {
          showError("Add issue quantities for PMR lines.");
          setSubmitting(false);
          return;
        }
        const res = await apiFetch<{ materialIssue: { docNo: string } }>(
          `/api/production-material-requests/${activePmrId}/issue`,
          {
            method: "POST",
            body: JSON.stringify({
              fromLocationId,
              toLocationId,
              remarks: remarks.trim() || null,
              lines: pmrLines,
            }),
          },
        );
        const issuedSnapshot = lines
          .filter((ln) => ln.pmrLineId && Number(ln.issueQty) > 0)
          .map((ln) => ({
            itemName: ln.itemName ?? "RM",
            issueQty: Number(ln.issueQty),
            unit: ln.unit ?? "",
          }));
        showSuccess(`Issued against PMR — ${res.materialIssue?.docNo || "MIN"}`);
        setIssueSuccess({
          workOrderId: activePmr?.workOrderId ?? 0,
          workOrderNo: activePmr?.workOrderNo ?? null,
          salesOrderNo: activePmr?.salesOrderNo ?? null,
          pmrDocNo: activePmr?.docNo ?? null,
          issuedLines: issuedSnapshot,
        });
        setRemarks("");
        setActivePmrId(null);
        setActivePmr(null);
        setSearchParams(
          postIssueSearchParams(returnTo, activePmr?.workOrderId ?? (typeof workOrderId === "number" ? workOrderId : undefined)),
        );
        setLines([emptyLine()]);
        await loadAll();
        await loadPendingPmrs();
        setSubmitting(false);
        return;
      } else {
        const res = await apiFetch<{ docNo: string }>("/api/material-issues/", {
          method: "POST",
          body: JSON.stringify({
            fromLocationId,
            toLocationId,
            workOrderId: typeof workOrderId === "number" ? workOrderId : null,
            remarks: remarks.trim() || null,
            lines: payloadLines,
          }),
        });
        showSuccess(`Material issued — ${res.docNo || "saved"}`);
      }
      setRemarks("");
      setWorkOrderId("");
      setActivePmrId(null);
      setActivePmr(null);
      setSearchParams(
        postIssueSearchParams(returnTo, typeof workOrderId === "number" ? workOrderId : undefined),
      );
      setLines([emptyLine()]);
      await loadAll();
      await loadPendingPmrs();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Issue failed");
    } finally {
      setSubmitting(false);
    }
  }

  const fromLoc = ctx?.fromLocations.find((l) => l.id === fromLocationId);
  const toLoc = ctx?.toLocations.find((l) => l.id === toLocationId);
  const woPmrMode = issueMode === "wo-pmr";
  const executionReady = woPmrMode && Boolean(activePmr && activePmrId);
  const pmrContextReady = Boolean(activePmr && lines.some((ln) => ln.pmrLineId));
  const showPartialAutofillHint = Boolean(activePmrId) && hasPartialStoreAutofill(lines);
  const backHref = materialWorkflowBackHref(returnTo, urlWorkOrderId || issueSuccess?.workOrderId);
  const backLabel =
    returnTo === "production-workspace"
      ? "Production"
      : returnTo === "dashboard"
        ? "Dashboard"
        : "Material Requests";
  const pmrShortageCount = lines.filter((ln) => {
    const pending = ln.pmrPendingQty ?? ln.pendingQty ?? 0;
    return ln.pmrLineId && isMaterialIssueLineStockBlocked(pending, ln.available);
  }).length;

  const resolvedWorkOrderIdForHint =
    (typeof workOrderId === "number" && workOrderId > 0 ? workOrderId : null) ??
    (urlWorkOrderId > 0 ? urlWorkOrderId : null) ??
    (activePmr?.workOrderId && activePmr.workOrderId > 0 ? activePmr.workOrderId : null);

  React.useEffect(() => {
    if (!resolvedWorkOrderIdForHint || pmrShortageCount <= 0) {
      setProcurementHint(null);
      return;
    }
    let cancelled = false;
    void apiFetch<{
      selectedWoShortageCase?: {
        materialRequirement?: { docNo?: string | null };
        escalationLifecycle?: { label?: string; procurementInitiated?: boolean };
      } | null;
      caseSupplyPanel?: { summary?: { pendingGrnQty?: number } } | null;
      selectedDetail?: { rmLines?: Array<{ coveredByIncomingQty?: number }> } | null;
    }>(`/api/material-availability/workspace?workOrderId=${resolvedWorkOrderIdForHint}`)
      .then((payload) => {
        if (cancelled) return;
        const wo = payload.selectedWoShortageCase;
        const covered = (payload.selectedDetail?.rmLines ?? []).reduce(
          (s, l) => s + Number(l.coveredByIncomingQty ?? 0),
          0,
        );
        setProcurementHint({
          mrDocNo: wo?.materialRequirement?.docNo ?? null,
          escalationLabel: wo?.escalationLifecycle?.label ?? "Material incoming",
          pendingGrnQty: Number(payload.caseSupplyPanel?.summary?.pendingGrnQty ?? 0),
          coveredByIncomingQty: covered,
          procurementInitiated: Boolean(wo?.escalationLifecycle?.procurementInitiated),
        });
      })
      .catch(() => {
        if (!cancelled) setProcurementHint(null);
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedWorkOrderIdForHint, pmrShortageCount]);

  const canIssueAnyLine = lines.some((ln) => {
    const pending = ln.pmrPendingQty ?? ln.pendingQty ?? 0;
    if (!ln.pmrLineId || pending <= 0) return false;
    const avail = ln.available ?? ln.freeStoreStock ?? ln.issueAvailableStoreQty;
    return !isMaterialIssueLineStockBlocked(pending, avail);
  });

  const hasPositiveIssueQty = lines.some((ln) => ln.pmrLineId && Number(ln.issueQty) > 0);

  const waitingProcurement = Boolean(
    procurementHint &&
      (procurementHint.pendingGrnQty > 0 ||
        procurementHint.procurementInitiated ||
        procurementHint.coveredByIncomingQty > 0),
  );

  const canSubmitIssue =
    (woPmrMode
      ? executionReady && pmrContextReady
      : typeof fromLocationId === "number" && typeof toLocationId === "number" && lines.some((l) => l.itemId)) &&
    typeof fromLocationId === "number" &&
    typeof toLocationId === "number" &&
    canIssueAnyLine &&
    hasPositiveIssueQty &&
    !submitting &&
    !loading &&
    !pmrLoading;

  const materialIssuePrimaryStrip = React.useMemo(() => {
    if (issueSuccess) return null;
    if (!executionReady && !activePmr) return null;

    const pendingCount =
      activePmr && activePmrId
        ? lines.filter((ln) => {
            const pending = ln.pmrPendingQty ?? ln.pendingQty ?? ln.stillRequiredQty ?? 0;
            return Number(pending) > 0;
          }).length
        : 0;

    const title =
      pendingCount > 0
        ? "Current Status: Waiting for RM Issue"
        : activePmr
          ? [activePmr.docNo ?? `PMR-${activePmrId}`, activePmr.workOrderNo].filter(Boolean).join(" · ")
          : "Issue material to production";
    const subtitle =
      pendingCount > 0 && activePmr
        ? `${activePmr.docNo || `PMR-${activePmrId}`} · ${pendingCount} line(s) pending issue to production`
        : undefined;

    if (canSubmitIssue) {
      return {
        variant: "action" as const,
        title,
        subtitle,
        primaryAction: {
          label: "Issue Material",
          testId: "material-issue-primary-submit",
          submit: true as const,
        },
      };
    }

    if (pendingCount > 0) {
      return {
        variant: "action" as const,
        title,
        subtitle,
        primaryAction: {
          label: "Issue RM to Production",
          testId: "material-issue-primary-scroll",
          scrollToForm: true as const,
        },
      };
    }

    return {
      variant: "action" as const,
      title,
      subtitle,
      primaryAction: {
        label: "Issue Material",
        testId: "material-issue-primary-submit",
        submit: true as const,
        disabled: true,
      },
    };
  }, [issueSuccess, executionReady, activePmr, activePmrId, lines, canSubmitIssue]);

  const productionNextAfterIssue = React.useMemo(() => {
    if (!issueSuccess || !(issueSuccess.workOrderId > 0)) return null;
    return buildRmReadyProductionNextStep(issueSuccess.workOrderId);
  }, [issueSuccess]);

  return (
    <PageContainer className="erp-txn-workspace erp-mat-plan-workspace">
      <StickyWorkspaceHead
        lead={
          <Link
            to={backHref}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </Link>
        }
      >
        <div>
          <h1 className="erp-type-page-title text-[15px] leading-tight">Material Issue Workspace</h1>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
            Issue RM to production for the selected work order or material request.
          </p>
        </div>
      </StickyWorkspaceHead>

      {materialIssuePrimaryStrip ? (
        <NextStepStrip
          visible
          density="compact"
          variant={materialIssuePrimaryStrip.variant}
          title={materialIssuePrimaryStrip.title}
          subtitle={materialIssuePrimaryStrip.subtitle}
          primaryAction={{
            label: materialIssuePrimaryStrip.primaryAction.label,
            testId: materialIssuePrimaryStrip.primaryAction.testId,
            disabled: "disabled" in materialIssuePrimaryStrip.primaryAction ? materialIssuePrimaryStrip.primaryAction.disabled : false,
            onClick: () => {
              const action = materialIssuePrimaryStrip.primaryAction;
              const href = "href" in action ? action.href : undefined;
              if (href) {
                navigate(href);
                return;
              }
              if ("submit" in action && action.submit) {
                void submitIssue();
                return;
              }
              if ("scrollToForm" in action && action.scrollToForm) {
                document.getElementById("material-issue-execution")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            },
          }}
        />
      ) : null}

      {!issueSuccess ? (
      <p className="rounded border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-[11px] leading-snug text-slate-700">
        <span className="font-semibold text-slate-900">RM issue only</span>
        {" · "}
        Blockers live in{" "}
        <Link to="/reports/rm-shortage" className="font-semibold text-violet-900 underline">
          RM Control Center
        </Link>
        .
      </p>
      ) : null}

      {issueSuccess ? (
        <section
          className="rounded-lg border border-emerald-300/90 bg-emerald-50/80 px-3 py-3 shadow-sm ring-1 ring-emerald-200/70"
          data-testid="material-issue-success-card"
        >
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-emerald-950">
            <span className="text-emerald-700" aria-hidden>
              ✓
            </span>
            Material Issued Successfully
          </h2>

          <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-[auto_1fr]">
            {(issueSuccess.workOrderNo || issueSuccess.workOrderId > 0) ? (
              <>
                <dt className="font-semibold text-slate-600">WO Number</dt>
                <dd className="font-mono font-semibold text-slate-900">
                  {issueSuccess.workOrderNo ?? `WO-${issueSuccess.workOrderId}`}
                </dd>
              </>
            ) : null}
            {issueSuccess.salesOrderNo ? (
              <>
                <dt className="font-semibold text-slate-600">SO Number</dt>
                <dd className="font-mono font-semibold text-slate-900">{issueSuccess.salesOrderNo}</dd>
              </>
            ) : null}
          </dl>

          {issueSuccess.issuedLines.length > 0 ? (
            <div className="mt-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">Issued Materials</p>
              <ul className="mt-1 space-y-0.5 text-[12px] text-emerald-950">
                {issueSuccess.issuedLines.map((ln, i) => (
                  <li key={i} className="flex flex-wrap gap-x-1.5">
                    <span className="font-medium">{ln.itemName}</span>
                    <span className="text-slate-500">·</span>
                    <span className="tabular-nums font-semibold">{fmtQty(ln.issueQty, ln.unit)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 border-t border-emerald-200/80 pt-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-900">Next Step</p>
            <p className="mt-0.5 text-[13px] font-semibold text-slate-800">Start Production Entry</p>
            {productionNextAfterIssue?.primaryAction.href ? (
              <Link
                to={productionNextAfterIssue.primaryAction.href}
                className={cn(
                  buttonVariants({ size: "default" }),
                  "mt-2 inline-flex h-9 bg-slate-900 px-4 text-[12px] font-semibold text-white hover:bg-slate-800 no-underline",
                )}
                data-testid={productionNextAfterIssue.primaryAction.testId ?? "next-enter-production"}
              >
                {productionNextAfterIssue.primaryAction.label}
              </Link>
            ) : null}
          </div>

          {returnTo === "dashboard" || returnTo === "material-requests" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {returnTo === "dashboard" ? (
                <Link
                  to="/dashboard"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-[11px] no-underline")}
                >
                  Back to Dashboard
                </Link>
              ) : null}
              {returnTo === "material-requests" ? (
                <Link
                  to={materialRequestsQueueHref({})}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-[11px] no-underline")}
                >
                  Back to Material Requests
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : (
        <>
      <ErpKpiStrip className="mb-1.5 py-1">
        <ErpKpiSegment>
          <ErpKpiLabel>From (store)</ErpKpiLabel>
          <ErpKpiValue>{fromLoc?.locationName ?? "—"}</ErpKpiValue>
        </ErpKpiSegment>
        <ErpKpiSegment>
          <ErpKpiLabel>To (production)</ErpKpiLabel>
          <ErpKpiValue>{toLoc?.locationName ?? "—"}</ErpKpiValue>
        </ErpKpiSegment>
        <ErpKpiSegment>
          <ErpKpiLabel>Pending PMRs</ErpKpiLabel>
          <ErpKpiValue>{pendingPmrs.length}</ErpKpiValue>
        </ErpKpiSegment>
        <ErpKpiSegment>
          <ErpKpiLabel>Recent issues</ErpKpiLabel>
          <ErpKpiValue>{recent.length}</ErpKpiValue>
        </ErpKpiSegment>
      </ErpKpiStrip>

      <div className={cn("grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]")}>
        <div id="material-issue-execution" className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-slate-800">
              <ArrowRightLeft className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Issue material to production</h2>
            </div>
            <div className="flex rounded-md border border-slate-200 p-0.5 text-xs">
              <button
                type="button"
                className={cn(
                  "rounded px-2.5 py-1 font-bold",
                  woPmrMode ? "bg-slate-900 text-white" : "text-slate-600",
                )}
                onClick={() => {
                  setIssueMode("wo-pmr");
                  if (!activePmrId) setLines([]);
                }}
              >
                WO / PMR issue
              </button>
              <button
                type="button"
                className={cn(
                  "rounded px-2.5 py-1 font-bold",
                  !woPmrMode ? "bg-slate-900 text-white" : "text-slate-600",
                )}
                onClick={() => {
                  setIssueMode("manual");
                  clearExecution();
                  setLines([emptyLine()]);
                }}
              >
                Manual issue
              </button>
            </div>
          </div>

          {woPmrMode && activePmr ? (
            <section className="mb-2 rounded-md border border-violet-200 bg-violet-50/60 px-2.5 py-1.5">
              <p className="text-[12px] font-bold text-slate-950">
                {activePmr.docNo ?? `PMR-${activePmrId}`}
                {activePmr.workOrderNo ? ` · ${activePmr.workOrderNo}` : ""}
                {activePmr.salesOrderNo ? ` · ${activePmr.salesOrderNo}` : ""}
              </p>
              <p className="mt-1 text-xs text-slate-700">
                Status: {PMR_STATUS_LABEL[activePmr.status] ?? activePmr.status}
                {" · "}
                Next action:{" "}
                <span className="font-bold">
                  {pmrNextActionLabel({ canIssueAny: canIssueAnyLine, waitingProcurement })}
                </span>
              </p>
              {resolvedWorkOrderIdForHint && !canIssueAnyLine ? (
                <Link
                  to={buildRmControlCenterHref({ workOrderId: resolvedWorkOrderIdForHint })}
                  className="mt-1 inline-block text-[11px] font-bold text-violet-900 underline"
                >
                  View allocation in RM Control Center
                </Link>
              ) : null}
            </section>
          ) : null}

          {pmrLoading ? (
            <p className="mb-3 text-sm text-slate-600">Loading material request lines…</p>
          ) : pmrLoadError ? (
            <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{pmrLoadError}</p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="erp-form-field block">
              <span className="text-xs font-medium text-slate-600">From location (store)</span>
              <select
                className="erp-select mt-1 w-full"
                value={fromLocationId === "" ? "" : String(fromLocationId)}
                onChange={(e) => setFromLocationId(e.target.value ? Number(e.target.value) : "")}
                disabled={loading}
              >
                <option value="">Select store…</option>
                {ctx?.fromLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.locationName}
                  </option>
                ))}
              </select>
            </label>
            <label className="erp-form-field block">
              <span className="text-xs font-medium text-slate-600">To location (production)</span>
              <select
                className="erp-select mt-1 w-full"
                value={toLocationId === "" ? "" : String(toLocationId)}
                onChange={(e) => setToLocationId(e.target.value ? Number(e.target.value) : "")}
                disabled={loading}
              >
                <option value="">Select production area…</option>
                {ctx?.toLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.locationName}
                  </option>
                ))}
              </select>
            </label>
            {woPmrMode ? (
              <label className="erp-form-field block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Work order</span>
                <select
                  className="erp-select mt-1 w-full"
                  value={workOrderId === "" ? "" : String(workOrderId)}
                  onChange={(e) => onWorkOrderSelect(e.target.value ? Number(e.target.value) : "")}
                  disabled={loading || pmrLoading}
                >
                  <option value="">Select work order…</option>
                  {ctx?.workOrders.map((wo) => (
                    <option key={wo.id} value={wo.id}>
                      {wo.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="erp-form-field block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Work order (manual)</span>
                <select
                  className="erp-select mt-1 w-full"
                  value={workOrderId === "" ? "" : String(workOrderId)}
                  onChange={(e) => onWorkOrderSelect(e.target.value ? Number(e.target.value) : "")}
                  disabled={loading}
                >
                  <option value="">Optional</option>
                  {ctx?.workOrders.map((wo) => (
                    <option key={wo.id} value={wo.id}>
                      {wo.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="erp-form-field block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Remarks</span>
              <Input
                className="mt-1"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional note for store records"
              />
            </label>
          </div>

          {woPmrMode && !executionReady && !pmrLoading ? (
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
              <p className="text-sm font-semibold text-slate-800">
                Select a work order or material request to load required RM lines.
              </p>
              <p className="mt-1 text-xs text-slate-600">Use the queue on the right, or pick a work order above.</p>
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto rounded border border-slate-200">
              <table className="erp-mat-issue-table min-w-[720px] w-full text-sm">
                <thead className="border-b bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th>RM item</th>
                    {woPmrMode ? (
                      <>
                        <th className="text-right">Required</th>
                        <th className="text-right">Issued</th>
                        <th className="text-right">Pending</th>
                      </>
                    ) : null}
                    <th className="text-right">Available</th>
                    <th className="text-right">Issue now</th>
                    {woPmrMode ? <th>Status</th> : <th className="w-10" />}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln) => {
                    const item = ctx?.rmItems.find((i) => i.id === ln.itemId);
                    const unit = ln.unit ?? item?.unit;
                    const required = ln.originalRequestQty ?? 0;
                    const issued = ln.alreadyIssuedQty ?? 0;
                    const pending = ln.pmrPendingQty ?? ln.pendingQty ?? 0;
                    const avail = ln.available ?? ln.freeStoreStock ?? ln.issueAvailableStoreQty ?? null;
                    const lineStatus = resolveMaterialIssueLineStatus({
                      pendingQty: pending,
                      available: avail,
                      physicalStock: ln.totalStoreStock ?? null,
                      issueQty: ln.issueQty,
                      woWaitingProcurement: waitingProcurement,
                    });
                    const noIssue = isMaterialIssueLineStockBlocked(pending, avail);
                    return (
                      <tr key={ln.key} className={cn("border-b border-slate-100", noIssue && "bg-amber-50/50")}>
                        <td className="font-medium text-slate-900">
                          {woPmrMode && ln.pmrLineId ? (
                            ln.itemName
                          ) : (
                            <select
                              className="erp-select w-full min-w-0"
                              value={ln.itemId === "" ? "" : String(ln.itemId)}
                              onChange={(e) =>
                                onLineItemChange(ln.key, e.target.value ? Number(e.target.value) : "")
                              }
                              disabled={!fromLocationId || loading}
                            >
                              <option value="">Select RM…</option>
                              {ctx?.rmItems.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.itemName}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        {woPmrMode ? (
                          <>
                            <td className="text-right tabular-nums">{fmtQty(required, unit)}</td>
                            <td className="text-right tabular-nums">{fmtQty(issued, unit)}</td>
                            <td className="text-right tabular-nums font-bold text-amber-900">
                              {fmtQty(pending, unit)}
                            </td>
                          </>
                        ) : null}
                        <td className="text-right tabular-nums">
                          {ln.loadingAvailable ? "…" : avail != null ? fmtQty(avail, unit) : "—"}
                        </td>
                        <td>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            className="h-8 text-right tabular-nums font-bold"
                            value={ln.issueQty}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((row) =>
                                  row.key === ln.key
                                    ? { ...row, issueQty: e.target.value, issueQtyTouched: true }
                                    : row,
                                ),
                              )
                            }
                            disabled={woPmrMode ? noIssue || pmrLoading : !ln.itemId || noIssue}
                            placeholder="0"
                          />
                        </td>
                        <td className="align-top">
                          {woPmrMode ? (
                            <div>
                              <span className="text-[11px] font-bold text-slate-800">{lineStatus.label}</span>
                              {lineStatus.explanation ? (
                                <p className="mt-0.5 text-[10px] leading-snug text-amber-900">{lineStatus.explanation}</p>
                              ) : null}
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => removeLine(ln.key)}
                              disabled={lines.length <= 1}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {showPartialAutofillHint && woPmrMode ? (
            <p className="mt-2 text-[11px] text-slate-600">
              Issue now is pre-filled as the minimum of pending and available stock. Adjust before submitting.
            </p>
          ) : null}

          {woPmrMode && executionReady && !canIssueAnyLine ? (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <p className="font-bold">No RM available for issue</p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-900">
                {waitingProcurement
                  ? "Waiting for Store / Purchase stock. RM requirement is raised — issue can start once stock is received (GRN)."
                  : "Stock is not free for this work order (committed elsewhere or not yet received). Raise / track the RM requirement in the Store RM Workspace."}
              </p>
              {resolvedWorkOrderIdForHint ? (
                <Link
                  to={buildRmControlCenterHref({ workOrderId: resolvedWorkOrderIdForHint, returnTo: "material-issue" })}
                  className="mt-1 inline-block text-[11px] font-bold text-violet-900 underline"
                >
                  Open Store RM Workspace
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {!woPmrMode ? (
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-1 h-4 w-4" />
                Add line
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="h-10 px-5 font-bold"
              disabled={!canSubmitIssue}
              onClick={() => void submitIssue()}
            >
              <Send className="mr-1 h-4 w-4" />
              Issue Material
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadAll()}>
              Refresh
            </Button>
            {woPmrMode && executionReady ? (
              <button type="button" className="text-xs font-semibold text-slate-600 underline" onClick={clearExecution}>
                Clear selection
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-2.5">
          {woPmrMode ? (
            <MaterialIssuePmrQueuePanel
              pendingPmrs={pendingPmrs}
              activePmrId={activePmrId}
              activeWorkOrderId={typeof workOrderId === "number" ? workOrderId : undefined}
              onSelectPmr={(id, woId) => selectPmr(id, woId)}
              onSelectWorkOrder={(woId) => onWorkOrderSelect(woId)}
            />
          ) : null}
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-2.5">
          <h3 className="text-[12px] font-semibold text-slate-800">Recent transfers</h3>
          <p className="mt-0.5 text-[10px] text-slate-600">Stock is available in production locations after issue.</p>
          <ul className="mt-2 max-h-[360px] space-y-1.5 overflow-y-auto">
            {recent.length === 0 ? (
              <li className="text-sm text-slate-500">No material issues yet.</li>
            ) : (
              recent.slice(0, 20).map((r) => (
                <li key={r.id} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm">
                  <div className="font-semibold text-slate-900">{r.docNo ?? `MIN #${r.id}`}</div>
                  <div className="text-xs text-slate-600">
                    {r.fromLocation.locationName} → {r.toLocation.locationName}
                  </div>
                  {r.workOrderNo ? (
                    <div className="text-xs text-slate-500">WO {r.workOrderNo}</div>
                  ) : null}
                  <ul className="mt-1 text-xs text-slate-700">
                    {r.lines.map((ln, i) => (
                      <li key={i}>
                        {ln.itemName}: {fmtQty(ln.issueQty, ln.unit)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))
            )}
          </ul>
          <Link
            to="/stock"
            className="mt-3 inline-block text-xs font-medium text-primary underline underline-offset-2"
          >
            View stock by location
          </Link>
          </div>
        </div>
      </div>
        </>
      )}
    </PageContainer>
  );
}
