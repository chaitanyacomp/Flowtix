/**
 * Phase 3A — Store material issue (transfer RM to production location). Stock movement only.
 */
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Send, Trash2 } from "lucide-react";
import { apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { useToast } from "../contexts/ToastContext";
import { PageContainer, StickyWorkspaceHead, ERPBackNavigation } from "../components/PageHeader";
import { ErpWorkflowTrail, ErpPageLoader } from "../components/erp/foundation";
import { useStablePageLoad } from "../hooks/useStablePageLoad";
import { useStoreExecutionNavContext } from "../hooks/useStoreExecutionNavContext";
import {
  assessMaterialIssueQty,
  formatIssueToleranceExceededMessage,
  formatOverIssueToleranceWarning,
  formatSuggestedIssueQty,
  hasPartialStoreAutofill,
  isMaterialIssueLineStockBlocked,
} from "../lib/materialIssueUx";
import { buildRmControlCenterHref } from "../lib/woProcurementContinuity";
import { buildMaterialIssuePostActionSearchParams } from "../lib/manufacturingNavigationContinuity";
import { MaterialIssuePmrQueuePanel } from "../components/erp/MaterialIssuePmrQueuePanel";
import {
  buildActionableWorkOrderDropdownOptions,
  mapIssuedWaitingForProductionPanelRows,
  filterMaterialIssueEntryLines,
  filterPmrsWithPendingIssue,
  pickActionablePmrForWorkOrder,
  resolveMaterialIssueLineStatus,
  shouldShowNoRmAvailableWarning,
} from "../lib/materialIssueWorkspace";
import {
  filterPendingPmrsForSessionScope,
  formatMaterialIssueInlineStatus,
  formatMaterialIssueSuccessMessage,
  materialIssueSessionCompleteMessage,
  materialIssueSessionCompleteTitle,
  parseMaterialIssueSessionScope,
  resolvePostIssueAdvance,
  type MaterialIssueSessionComplete,
} from "../lib/materialIssueContinuousSession";
import {
  displayMaterialIssueNo,
  displayPmrNo,
  displayWorkOrderNo,
} from "../lib/docNoDisplay";

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
  /** PMR executable requirement after waived qty is removed. */
  effectiveRequiredQty?: number;
  waivedQty?: number;
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
  rmIssueToleranceQty?: number;
  maxAllowedIssueQty?: number;
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
  salesOrderId?: number | null;
  salesOrderNo?: string | null;
  requirementSheetId?: number | null;
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
  originalRequiredQty?: number;
  effectiveRequiredQty?: number;
  issuedQty: number;
  waivedQty?: number;
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
  rmIssueToleranceQty?: number;
  maxAllowedIssueQty?: number;
};

type PmrUnissuedRequiredLine = {
  pmrLineId?: number;
  itemId: number;
  itemName: string;
  unit: string;
  requiredQty: number;
  issuedQty: number;
};

type PmrIssueDecision = {
  totalRequired: number;
  totalOriginalRequired?: number;
  totalEffectiveRequired?: number;
  totalIssued: number;
  totalWaived: number;
  totalExcessIssue: number;
  totalRemaining: number;
  canIssueMore: boolean;
  canWaiveRemaining: boolean;
  canReleaseToProduction: boolean;
  unissuedRequiredLines?: PmrUnissuedRequiredLine[];
  releaseBlockedByUnissuedBom?: boolean;
  materialReleasedToProductionAt: string | null;
  showPartialDecisionPanel: boolean;
};

type PmrIssueContext = {
  pmr: PendingPmr & {
    productionItemName?: string | null;
    lines: PmrIssueLine[];
    totalWaived?: number;
    totalExcessIssue?: number;
  };
  lines: PmrIssueLine[];
  pendingLines: PmrIssueLine[];
  issueDecision?: PmrIssueDecision;
};

type ContextResponse = {
  fromLocations: LocationRow[];
  toLocations: LocationRow[];
  workOrders: WoOption[];
  rmItems: RmItem[];
};

type IssuedWaitingForProductionRow = {
  workOrderId: number;
  workOrderNo: string;
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

function postIssueSearchParams(
  returnTo: string | null,
  opts: {
    workOrderId?: number;
    salesOrderId?: number | null;
    requirementSheetId?: number | null;
    productionBucket?: string | null;
  },
): Record<string, string> {
  return buildMaterialIssuePostActionSearchParams({
    returnTo,
    workOrderId: opts.workOrderId,
    salesOrderId: opts.salesOrderId,
    requirementSheetId: opts.requirementSheetId,
    productionBucket: opts.productionBucket,
  });
}

function fmtQty(n: number, unit?: string) {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

function newLineKey() {
  return `ln-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
    originalRequestQty: pl.originalRequiredQty ?? pl.requiredQty,
    effectiveRequiredQty: pl.effectiveRequiredQty ?? Math.max(0, pl.requiredQty - (pl.waivedQty ?? 0)),
    waivedQty: pl.waivedQty,
    alreadyIssuedQty: pl.issuedQty,
    stillRequiredQty: issueCap,
    issueCapQty: issueCap,
    pmrPendingQty: pl.pendingQty,
    pendingQty: pl.pendingQty,
    rmIssueToleranceQty: pl.rmIssueToleranceQty,
    maxAllowedIssueQty: pl.maxAllowedIssueQty,
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

function assessIssueLineDraft(ln: IssueLineDraft) {
  const pending = ln.pmrPendingQty ?? ln.pendingQty ?? 0;
  return assessMaterialIssueQty(ln.issueQty, pending, {
    woStillRequiredQty: ln.issueCapQty ?? ln.stillRequiredQty,
    maxAllowedIssueQty: ln.maxAllowedIssueQty,
  });
}

export function MaterialIssuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { showSuccess, showError } = useToast();
  const [ctx, setCtx] = React.useState<ContextResponse | null>(null);
  const [recent, setRecent] = React.useState<RecentIssue[]>([]);
  const [issuedWaitingForProduction, setIssuedWaitingForProduction] = React.useState<IssuedWaitingForProductionRow[]>([]);
  const [pendingPmrs, setPendingPmrs] = React.useState<PendingPmr[]>([]);
  const [activePmrId, setActivePmrId] = React.useState<number | null>(null);
  const [activePmr, setActivePmr] = React.useState<PmrIssueContext["pmr"] | null>(null);
  const [issueDecision, setIssueDecision] = React.useState<PmrIssueDecision | null>(null);
  const [waiveReason, setWaiveReason] = React.useState("");
  const [waiveRemarks, setWaiveRemarks] = React.useState("");
  const [showWaiveForm, setShowWaiveForm] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const { firstLoadDone, initialLoading, refreshing, startLoad, finishLoad } = useStablePageLoad();
  const [submitting, setSubmitting] = React.useState(false);
  const [sessionComplete, setSessionComplete] = React.useState<MaterialIssueSessionComplete | null>(null);
  const [sessionBanner, setSessionBanner] = React.useState<string | null>(null);
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

  async function refreshPendingPmrsList(): Promise<PendingPmr[]> {
    try {
      const data = await apiFetch<PendingPmr[]>("/api/production-material-requests?pendingForStore=1");
      const list = Array.isArray(data) ? data : [];
      setPendingPmrs(list);
      return list;
    } catch {
      setPendingPmrs([]);
      return [];
    }
  }

  async function loadPendingPmrs() {
    await refreshPendingPmrsList();
  }

  async function loadPmrIntoForm(pmrId: number, fromId?: number) {
    setPmrLoading(true);
    setPmrLoadError(null);
    try {
      const qs = typeof fromId === "number" ? `?fromLocationId=${fromId}` : "";
      const data = await apiFetch<PmrIssueContext>(`/api/production-material-requests/${pmrId}/issue-context${qs}`);
      setActivePmrId(pmrId);
      setActivePmr(data.pmr);
      setIssueDecision(data.issueDecision ?? null);
      if (data.pmr.workOrderId) setWorkOrderId(data.pmr.workOrderId);
      setRemarks(`Issue against ${displayPmrNo(pmrId, data.pmr.docNo)}`);
      const sourceLines = filterMaterialIssueEntryLines(data.pendingLines?.length ? data.pendingLines : data.lines ?? []);
      setLines(sourceLines.length ? sourceLines.map(pmrLineToDraft) : []);
    } catch (e) {
      setPmrLoadError(e instanceof Error ? e.message : "Could not load PMR");
      setActivePmrId(null);
      setActivePmr(null);
      setIssueDecision(null);
      setLines([]);
      showError(e instanceof Error ? e.message : "Could not load PMR");
    } finally {
      setPmrLoading(false);
    }
  }

  async function loadAll() {
    startLoad();
    setLoading(true);
    try {
      const [context, list, waitingForProduction] = await Promise.all([
        apiFetch<ContextResponse>("/api/material-issues/context"),
        apiFetch<RecentIssue[]>("/api/material-issues/"),
        apiFetch<IssuedWaitingForProductionRow[]>("/api/material-issues/issued-waiting-for-production").catch(
          () => [] as IssuedWaitingForProductionRow[],
        ),
        loadPendingPmrs(),
      ]);
      setCtx(context);
      setRecent(Array.isArray(list) ? list : []);
      setIssuedWaitingForProduction(Array.isArray(waitingForProduction) ? waitingForProduction : []);
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
      finishLoad();
    }
  }

  React.useEffect(() => {
    void loadAll();
  }, []);

  const urlPmrId = Number(searchParams.get("pmrId")) || 0;
  const urlWorkOrderId = Number(searchParams.get("workOrderId")) || 0;
  const returnTo = searchParams.get("returnTo");
  const sessionScope = React.useMemo(
    () =>
      parseMaterialIssueSessionScope({
        requirementSheetId: searchParams.get("requirementSheetId"),
        salesOrderId: searchParams.get("salesOrderId"),
      }),
    [searchParams],
  );
  const scopedPendingPmrs = React.useMemo(
    () => filterPendingPmrsForSessionScope(pendingPmrs, sessionScope),
    [pendingPmrs, sessionScope],
  );
  const actionablePendingPmrs = React.useMemo(
    () => filterPmrsWithPendingIssue(scopedPendingPmrs),
    [scopedPendingPmrs],
  );
  const actionableWorkOrderOptions = React.useMemo(
    () => buildActionableWorkOrderDropdownOptions(scopedPendingPmrs),
    [scopedPendingPmrs],
  );
  const actionableWorkOrderIds = React.useMemo(
    () => new Set(actionableWorkOrderOptions.map((wo) => wo.id)),
    [actionableWorkOrderOptions],
  );
  const issuedWorkOrderInfoRows = React.useMemo(
    () => mapIssuedWaitingForProductionPanelRows(issuedWaitingForProduction, actionableWorkOrderIds),
    [issuedWaitingForProduction, actionableWorkOrderIds],
  );
  const materialIssueNavContext = useStoreExecutionNavContext("material-issue");

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
    setIssueDecision(null);
    setShowWaiveForm(false);
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
      setIssueDecision(null);
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
    const pmr = pickActionablePmrForWorkOrder(woId, scopedPendingPmrs);
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
    const pmr = pickActionablePmrForWorkOrder(urlWorkOrderId, scopedPendingPmrs);
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
  }, [activePmrId, ctx, issueMode, scopedPendingPmrs, urlPmrId, urlWorkOrderId, workOrderId, selectPmr, ensurePmrAndSelect]);

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

  async function finalizeAfterSuccessfulIssue(issued: {
    workOrderId: number;
    workOrderNo: string | null;
    salesOrderId?: number | null;
    pmrId: number;
  }) {
    setSessionBanner(null);
    setRemarks("");
    setShowWaiveForm(false);

    const [freshPending] = await Promise.all([
      refreshPendingPmrsList(),
      apiFetch<RecentIssue[]>("/api/material-issues/")
        .then((list) => setRecent(Array.isArray(list) ? list : []))
        .catch(() => undefined),
      apiFetch<IssuedWaitingForProductionRow[]>("/api/material-issues/issued-waiting-for-production")
        .then((rows) => setIssuedWaitingForProduction(Array.isArray(rows) ? rows : []))
        .catch(() => undefined),
    ]);

    const woLabel =
      issued.workOrderId > 0
        ? displayWorkOrderNo(issued.workOrderId, issued.workOrderNo)
        : "work order";
    showSuccess(formatMaterialIssueSuccessMessage(woLabel));

    const advance = resolvePostIssueAdvance({
      issuedWorkOrderId: issued.workOrderId,
      freshPending,
      scope: sessionScope,
    });

    if (advance.kind === "stay") {
      setSessionComplete(null);
      selectPmr(advance.pmr.id, issued.workOrderId);
      return;
    }

    setActivePmrId(null);
    setActivePmr(null);
    setIssueDecision(null);
    setWorkOrderId("");
    setLines([]);
    setPmrLoadError(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("pmrId");
    nextParams.delete("workOrderId");
    if (returnTo) nextParams.set("returnTo", returnTo);
    setSearchParams(nextParams, { replace: true });

    if (advance.pmr) {
      setSessionComplete(null);
      selectPmr(advance.pmr.id, advance.pmr.workOrderId);
      return;
    }

    const scopedRemaining = filterPmrsWithPendingIssue(
      filterPendingPmrsForSessionScope(freshPending, sessionScope),
    );
    if (
      scopedRemaining.length === 0 &&
      (sessionScope.requirementSheetId || sessionScope.salesOrderId)
    ) {
      setSessionComplete({
        requirementSheetId: sessionScope.requirementSheetId,
        salesOrderId: sessionScope.salesOrderId ?? issued.salesOrderId ?? null,
        lastWorkOrderId: issued.workOrderId,
        lastWorkOrderNo: issued.workOrderNo,
      });
    } else {
      setSessionComplete(null);
    }
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
      const assessment = assessIssueLineDraft(ln);
      if (!assessment.allowed) {
        showError(
          assessment.overIssueQty > 1e-6
            ? formatIssueToleranceExceededMessage()
            : "Issue quantity cannot exceed still required qty.",
        );
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
        await apiFetch<{ materialIssue: { docNo: string } }>(
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
        const issuedWoId = Number(activePmr?.workOrderId ?? workOrderId ?? 0);
        await finalizeAfterSuccessfulIssue({
          workOrderId: issuedWoId,
          workOrderNo: activePmr?.workOrderNo ?? null,
          salesOrderId: activePmr?.salesOrderId ?? null,
          pmrId: activePmrId,
        });
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
      setIssueDecision(null);
      setSearchParams(
        postIssueSearchParams(returnTo, {
          workOrderId: typeof workOrderId === "number" ? workOrderId : undefined,
          salesOrderId: sessionScope.salesOrderId ?? (Number(searchParams.get("salesOrderId")) || null),
          requirementSheetId: sessionScope.requirementSheetId ?? (Number(searchParams.get("requirementSheetId")) || null),
          productionBucket: searchParams.get("productionBucket"),
        }),
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

  async function handleIssueLater() {
    if (!activePmrId) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/production-material-requests/${activePmrId}/issue-later`, { method: "POST" });
      setShowWaiveForm(false);
      showSuccess("Remaining material stays pending. You can issue more or release to production when ready.");
      await loadPmrIntoForm(activePmrId, typeof fromLocationId === "number" ? fromLocationId : undefined);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save decision");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWaiveRemaining() {
    if (!activePmrId || !waiveReason) {
      showError("Select a waive reason.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/production-material-requests/${activePmrId}/waive-remaining`, {
        method: "POST",
        body: JSON.stringify({ reason: waiveReason, remarks: waiveRemarks.trim() || null }),
      });
      setShowWaiveForm(false);
      setWaiveReason("");
      setWaiveRemarks("");
      showSuccess("Remaining quantity waived — short issue accepted.");
      await refreshPendingPmrsList();
      await loadPmrIntoForm(activePmrId, typeof fromLocationId === "number" ? fromLocationId : undefined);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Waive failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReleaseToProduction() {
    if (!activePmrId) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/production-material-requests/${activePmrId}/release-to-production`, {
        method: "POST",
        body: JSON.stringify({ remarks: remarks.trim() || null }),
      });
      showSuccess("Work order released to production.");
      await refreshPendingPmrsList();
      await loadPmrIntoForm(activePmrId, typeof fromLocationId === "number" ? fromLocationId : undefined);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e && "message" in e
            ? String((e as { message?: string }).message)
            : "Release failed";
      showError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const fromLoc = ctx?.fromLocations.find((l) => l.id === fromLocationId);
  const toLoc = ctx?.toLocations.find((l) => l.id === toLocationId);
  const woPmrMode = issueMode === "wo-pmr";
  const executionReady = woPmrMode && Boolean(activePmr && activePmrId);
  const pmrContextReady = Boolean(activePmr && lines.some((ln) => ln.pmrLineId));
  const selectedPmrFullyIssued =
    executionReady &&
    !pmrLoading &&
    lines.length === 0 &&
    Number(issueDecision?.totalRemaining ?? activePmr?.totalPending ?? 0) <= 1e-6 &&
    Number(issueDecision?.totalIssued ?? 0) > 1e-6;
  const showPartialAutofillHint = Boolean(activePmrId) && hasPartialStoreAutofill(lines);
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

  const hasToleranceBlockedLine = lines.some((ln) => {
    if (!ln.pmrLineId || !ln.issueQty) return false;
    return !assessIssueLineDraft(ln).allowed;
  });

  const showNoRmAvailableWarning = shouldShowNoRmAvailableWarning({
    executionReady,
    canIssueAnyLine,
    lines,
  });

  const canSubmitIssue =
    (woPmrMode
      ? executionReady && pmrContextReady && !selectedPmrFullyIssued
      : typeof fromLocationId === "number" && typeof toLocationId === "number" && lines.some((l) => l.itemId)) &&
    typeof fromLocationId === "number" &&
    typeof toLocationId === "number" &&
    canIssueAnyLine &&
    hasPositiveIssueQty &&
    !hasToleranceBlockedLine &&
    !submitting &&
    !loading &&
    !pmrLoading;

  const materialIssuePrimaryStrip = React.useMemo(() => {
    if (sessionComplete || !executionReady || !activePmr || !activePmrId) return null;
    const pendingCount = lines.filter((ln) => {
      const pending = ln.pmrPendingQty ?? ln.pendingQty ?? ln.stillRequiredQty ?? 0;
      return Number(pending) > 0;
    }).length;
    if (pendingCount <= 0) return null;
    return formatMaterialIssueInlineStatus({
      pmrDocNo: activePmr.docNo,
      pmrId: activePmrId,
      pendingLineCount: pendingCount,
    });
  }, [sessionComplete, executionReady, activePmr, activePmrId, lines]);

  const hideWorkflowTrail =
    returnTo === "pending-actions" || materialIssueNavContext.origin === "pending-actions";

  const sessionCompleteRmccHref = React.useMemo(() => {
    if (!sessionComplete) return "/reports/rm-shortage";
    const woId = Number(sessionComplete.lastWorkOrderId ?? 0);
    return buildRmControlCenterHref({
      workOrderId: woId > 0 ? woId : undefined,
      salesOrderId: sessionComplete.salesOrderId,
      returnTo: "material-issue",
    });
  }, [sessionComplete]);

  return (
    <PageContainer className="erp-txn-workspace erp-mat-plan-workspace space-y-2">
      <StickyWorkspaceHead
        lead={
          hideWorkflowTrail ? (
            <ERPBackNavigation defaultTo="/pending-actions" defaultLabel="Back to Pending Actions" />
          ) : (
            <ErpWorkflowTrail navContext={materialIssueNavContext} />
          )
        }
      >
        <h1 className="text-[13px] font-semibold leading-tight text-slate-900">Material Issue</h1>
      </StickyWorkspaceHead>

      {sessionBanner && !sessionComplete ? (
        <div
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-950"
          data-testid="material-issue-session-banner"
        >
          <span className="text-emerald-700" aria-hidden>
            ✔{" "}
          </span>
          {sessionBanner}
        </div>
      ) : null}

      {sessionComplete ? (
        <section
          className="rounded-md border border-emerald-300/90 bg-emerald-50/90 px-3 py-2.5 shadow-sm"
          data-testid="material-issue-session-complete"
        >
          <h2 className="text-[13px] font-bold text-emerald-950">{materialIssueSessionCompleteTitle()}</h2>
          <p className="mt-1 text-[11px] leading-snug text-emerald-900">{materialIssueSessionCompleteMessage()}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ERPBackNavigation
              to="/dashboard"
              label="Back to Dashboard"
              data-testid="material-issue-back-dashboard"
            />
            <Link
              to={sessionCompleteRmccHref}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-8 px-3 text-[11px] no-underline",
              )}
              data-testid="material-issue-open-rmcc"
            >
              Open RM Control Center
            </Link>
            <ERPBackNavigation
              to="/pending-actions"
              label="Back to Pending Actions"
              data-testid="material-issue-back-pending-actions"
            />
          </div>
        </section>
      ) : initialLoading ? (
        <ErpPageLoader variant="workspace" hint="Loading material issue workspace…" />
      ) : (
        <>
      <div className={cn("grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]")}>
        <div id="material-issue-execution" className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600">
            <span>
              <span className="font-semibold text-slate-700">From:</span> {fromLoc?.locationName ?? "—"}
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="font-semibold text-slate-700">To:</span> {toLoc?.locationName ?? "—"}
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="font-semibold text-slate-700">Pending PMRs:</span>{" "}
              {sessionScope.requirementSheetId || sessionScope.salesOrderId
                ? `${scopedPendingPmrs.length}${scopedPendingPmrs.length !== pendingPmrs.length ? ` / ${pendingPmrs.length}` : ""}`
                : pendingPmrs.length}
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="font-semibold text-slate-700">Recent:</span> {recent.length}
            </span>
          </div>

          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {materialIssuePrimaryStrip ? (
                <span
                  className="inline-flex max-w-full items-center rounded-full border border-amber-300/80 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-950"
                  data-testid="material-issue-inline-status"
                >
                  {materialIssuePrimaryStrip}
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-slate-800">Issue material to production</span>
              )}
            </div>
            <div className="flex shrink-0 rounded border border-slate-200 p-0.5 text-[10px]">
              <button
                type="button"
                className={cn(
                  "rounded px-2 py-0.5 font-bold",
                  woPmrMode ? "bg-slate-900 text-white" : "text-slate-600",
                )}
                onClick={() => {
                  setIssueMode("wo-pmr");
                  if (!activePmrId) setLines([]);
                }}
              >
                WO / PMR
              </button>
              <button
                type="button"
                className={cn(
                  "rounded px-2 py-0.5 font-bold",
                  !woPmrMode ? "bg-slate-900 text-white" : "text-slate-600",
                )}
                onClick={() => {
                  setIssueMode("manual");
                  clearExecution();
                  setLines([emptyLine()]);
                }}
              >
                Manual
              </button>
            </div>
          </div>

          {woPmrMode && activePmr && executionReady && !canIssueAnyLine && resolvedWorkOrderIdForHint ? (
            <Link
              to={buildRmControlCenterHref({ workOrderId: resolvedWorkOrderIdForHint })}
              className="mb-1.5 inline-block text-[10px] font-semibold text-violet-900 underline"
            >
              View allocation in RM Control Center
            </Link>
          ) : null}

          {pmrLoading ? (
            <p className="mb-1 text-[11px] text-slate-600">Loading material request lines…</p>
          ) : pmrLoadError ? (
            <p className="mb-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">{pmrLoadError}</p>
          ) : null}

          <div className="grid gap-1.5 sm:grid-cols-2">
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
                  {actionableWorkOrderOptions.map((wo) => (
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

          {selectedPmrFullyIssued ? (
            <div
              className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-4 text-center"
              data-testid="material-issue-fully-issued-message"
            >
              <p className="text-[12px] font-semibold text-emerald-950">
                Material already fully issued for this work order.
              </p>
            </div>
          ) : woPmrMode && !executionReady && !pmrLoading ? (
            <div className="mt-2 rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center">
              <p className="text-[12px] font-semibold text-slate-800">
                {actionablePendingPmrs.length === 0
                  ? "No pending material requests."
                  : "Select a work order from the queue to load RM lines."}
              </p>
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
                    const required = ln.effectiveRequiredQty ?? ln.originalRequestQty ?? 0;
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
                    const issueAssessment = assessIssueLineDraft(ln);
                    const noIssue = isMaterialIssueLineStockBlocked(pending, avail);
                    const zeroIssuedRequired = woPmrMode && required > 1e-6 && issued <= 1e-6;
                    return (
                      <tr
                        key={ln.key}
                        className={cn(
                          "border-b border-slate-100",
                          zeroIssuedRequired && "bg-red-50/90",
                          !zeroIssuedRequired && noIssue && "bg-amber-50/50",
                        )}
                        data-testid={zeroIssuedRequired ? "material-issue-zero-issued-row" : undefined}
                      >
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
                            className={cn(
                              "h-8 text-right tabular-nums font-bold",
                              issueAssessment.withinTolerance && "border-amber-400",
                              !issueAssessment.allowed && issueAssessment.overIssueQty > 1e-6 && "border-red-500",
                            )}
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
                          {issueAssessment.withinTolerance ? (
                            <p className="mt-0.5 text-right text-[10px] font-medium leading-snug text-amber-900">
                              {formatOverIssueToleranceWarning(issueAssessment.overIssueQty, unit)}
                            </p>
                          ) : null}
                          {!issueAssessment.allowed && issueAssessment.overIssueQty > 1e-6 ? (
                            <p className="mt-0.5 text-right text-[10px] font-medium leading-snug text-red-700">
                              {formatIssueToleranceExceededMessage()}
                            </p>
                          ) : null}
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

          {showNoRmAvailableWarning ? (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <p className="font-bold">No RM available for issue</p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-900">
                {waitingProcurement
                  ? "Waiting for Store / Purchase stock. RM requirement is raised — issue can start once stock is received (GRN)."
                  : "Stock is not free for this work order (committed elsewhere or not yet received). Raise or track the RM requirement in RM Control Center."}
              </p>
              {resolvedWorkOrderIdForHint ? (
                <Link
                  to={buildRmControlCenterHref({ workOrderId: resolvedWorkOrderIdForHint, returnTo: "material-issue" })}
                  className="mt-1 inline-block text-[11px] font-bold text-violet-900 underline"
                >
                  Open RM Control Center
                </Link>
              ) : null}
            </div>
          ) : null}

          {woPmrMode && issueDecision && (issueDecision.totalIssued > 0 || issueDecision.showPartialDecisionPanel) ? (
            <section
              className="mt-2 rounded border border-violet-200 bg-violet-50/80 px-3 py-2.5"
              data-testid="material-issue-decision-panel"
            >
              <h3 className="text-[12px] font-bold text-violet-950">Material issue status</h3>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] tabular-nums text-violet-950">
                <span>
                  <span className="font-semibold">Required:</span> {fmtQty(issueDecision.totalRequired)}
                </span>
                <span>
                  <span className="font-semibold">Issued:</span> {fmtQty(issueDecision.totalIssued)}
                </span>
                {issueDecision.totalExcessIssue > 1e-6 ? (
                  <span>
                    <span className="font-semibold">Excess:</span> {fmtQty(issueDecision.totalExcessIssue)}
                  </span>
                ) : null}
                <span>
                  <span className="font-semibold">Remaining:</span> {fmtQty(issueDecision.totalRemaining)}
                </span>
                {issueDecision.totalWaived > 1e-6 ? (
                  <span>
                    <span className="font-semibold">Waived:</span> {fmtQty(issueDecision.totalWaived)}
                  </span>
                ) : null}
              </div>
              {issueDecision.materialReleasedToProductionAt ? (
                <p className="mt-1 text-[11px] font-medium text-emerald-900">Released to production.</p>
              ) : null}
              {issueDecision.releaseBlockedByUnissuedBom ? (
                <div
                  className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-950"
                  data-testid="material-issue-release-blocked-warning"
                >
                  <p className="font-bold">Production cannot be released.</p>
                  <p className="mt-0.5">Some required BOM materials have not been issued yet.</p>
                  {issueDecision.unissuedRequiredLines?.length ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {issueDecision.unissuedRequiredLines.map((ln) => (
                        <li key={`${ln.itemId}-${ln.pmrLineId ?? 0}`}>
                          {ln.itemName} ({fmtQty(ln.issuedQty, ln.unit)} / {fmtQty(ln.requiredQty, ln.unit)})
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {issueDecision.showPartialDecisionPanel ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-[11px]"
                    disabled={submitting}
                    onClick={() => void handleIssueLater()}
                  >
                    Issue Later
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-[11px]"
                    disabled={submitting}
                    onClick={() => setShowWaiveForm((v) => !v)}
                  >
                    Waive Remaining
                  </Button>
                  {issueDecision.canReleaseToProduction ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 bg-violet-900 text-[11px] hover:bg-violet-800"
                      disabled={submitting}
                      onClick={() => void handleReleaseToProduction()}
                    >
                      Release to Production
                    </Button>
                  ) : null}
                </div>
              ) : issueDecision.canReleaseToProduction ? (
                <div className="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 bg-violet-900 text-[11px] hover:bg-violet-800"
                    disabled={submitting}
                    onClick={() => void handleReleaseToProduction()}
                  >
                    Release to Production
                  </Button>
                </div>
              ) : null}
              {showWaiveForm && issueDecision.canWaiveRemaining ? (
                <div className="mt-2 space-y-1.5 rounded border border-violet-200 bg-white p-2">
                  <label className="erp-form-field block">
                    <span className="text-xs font-medium text-slate-600">Waive reason</span>
                    <select
                      className="erp-select mt-1 w-full"
                      value={waiveReason}
                      onChange={(e) => setWaiveReason(e.target.value)}
                    >
                      <option value="">Select reason…</option>
                      <option value="SCALE_LIMITATION">Scale limitation</option>
                      <option value="PACKING_LIMITATION">Packing limitation</option>
                      <option value="MANAGEMENT_DECISION">Management decision</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <label className="erp-form-field block">
                    <span className="text-xs font-medium text-slate-600">Remarks</span>
                    <Input className="mt-1" value={waiveRemarks} onChange={(e) => setWaiveRemarks(e.target.value)} />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-8 text-[11px]"
                    disabled={submitting || !waiveReason}
                    onClick={() => void handleWaiveRemaining()}
                  >
                    Confirm waive remaining
                  </Button>
                </div>
              ) : null}
            </section>
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
              pendingPmrs={actionablePendingPmrs}
              activePmrId={activePmrId}
              activeWorkOrderId={typeof workOrderId === "number" ? workOrderId : undefined}
              onSelectPmr={(id, woId) => {
                setSessionBanner(null);
                selectPmr(id, woId);
              }}
              onSelectWorkOrder={(woId) => {
                setSessionBanner(null);
                onWorkOrderSelect(woId);
              }}
            />
          ) : null}
          {woPmrMode && issuedWorkOrderInfoRows.length > 0 ? (
            <div
              className="rounded-md border border-slate-200 bg-white px-2.5 py-2"
              data-testid="material-issue-issued-queue-panel"
            >
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                RM issued — waiting for Production
              </h3>
              <ul className="mt-1 space-y-1">
                {issuedWorkOrderInfoRows.map((row) => (
                  <li
                    key={row.workOrderId}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
                  >
                    {row.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2 py-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-700">Recent transfers</h3>
          <ul className="mt-1 max-h-[200px] space-y-1 overflow-y-auto">
            {recent.length === 0 ? (
              <li className="text-[10px] text-slate-500">None yet.</li>
            ) : (
              recent.slice(0, 8).map((r) => (
                <li key={r.id} className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px]">
                  <div className="font-semibold text-slate-900">{displayMaterialIssueNo(r.id, r.docNo)}</div>
                  <div className="text-slate-600">
                    {r.fromLocation.locationName} → {r.toLocation.locationName}
                    {r.workOrderNo ? ` · ${r.workOrderNo}` : ""}
                  </div>
                </li>
              ))
            )}
          </ul>
          </div>
        </div>
      </div>
        </>
      )}
    </PageContainer>
  );
}
