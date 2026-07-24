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
import { useAuth } from "../contexts/AuthContext";
import { PageContainer, StickyWorkspaceHead, ERPBackNavigation } from "../components/PageHeader";
import { ErpWorkflowTrail, ErpPageLoader } from "../components/erp/foundation";
import { useStablePageLoad } from "../hooks/useStablePageLoad";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { useStoreExecutionNavContext } from "../hooks/useStoreExecutionNavContext";
import { useErpRefreshTick } from "../hooks/useErpRefreshTick";
import {
  assessMaterialIssueQty,
  formatIssueToleranceExceededMessage,
  formatSuggestedIssueQty,
  hasPartialStoreAutofill,
  isMaterialIssueLineStockBlocked,
} from "../lib/materialIssueUx";
import { buildRmControlCenterHref } from "../lib/woProcurementContinuity";
import { buildMaterialIssuePostActionSearchParams } from "../lib/manufacturingNavigationContinuity";
import { MaterialIssuePmrQueuePanel } from "../components/erp/MaterialIssuePmrQueuePanel";
import { MaterialIssueRmTable } from "../components/erp/MaterialIssueRmTable";
import { buildMaterialIssueActionSummary } from "../lib/materialIssueRmTableUx";
import { DecimalInput } from "../components/ui/DecimalInput";
import {
  buildActionableWorkOrderDropdownOptions,
  mapIssuedWaitingForProductionPanelRows,
  filterMaterialIssueEntryLines,
  filterPmrsWithPendingIssue,
  pickActionablePmrForWorkOrder,
  resolveDefaultMaterialIssueToLocationId,
  shouldShowNoRmAvailableWarning,
} from "../lib/materialIssueWorkspace";
import {
  canSubmitFromBackendIssueDecision,
  waitingProcurementFromIssueDecision,
} from "../lib/materialIssueReadinessUx";
import {
  filterPendingPmrsForSessionScope,
  formatMaterialIssueInlineStatus,
  formatMaterialIssueSuccessMessage,
  formatPartialIssueSuccessMessage,
  materialIssueSessionCompleteMessage,
  materialIssueSessionCompleteTitle,
  parseMaterialIssueSessionScope,
  pickNextReadyToIssuePmrInScope,
  resolvePostIssueAdvance,
  type MaterialIssueSessionComplete,
} from "../lib/materialIssueContinuousSession";
import { type MaterialIssueQueueFilterKey } from "../lib/materialIssueQueueState";
import {
  buildMaterialIssueDeepLink,
  materialIssueFilterKeyToBucket,
  parseMaterialIssueDeepLink,
  resolveMaterialIssueDeepLinkTarget,
  type MaterialIssueBucket,
} from "../lib/materialIssueDeepLink";
import {
  displayMaterialIssueNo,
  displayPmrNo,
  displayWorkOrderNo,
} from "../lib/docNoDisplay";
import {
  calculatePlannedAllowance,
  deriveAllowanceFromIssueNow,
  formatAllowanceInput,
  type PlannedAllowanceInputSource,
} from "../lib/plannedProcessAllowance";
import {
  hydrateIssueLinesWithAllowanceApprovals,
  mergeAllowanceQueueInfoIntoPmrs,
  resolveLineAllowanceBand,
  resolveMaterialIssuePrimaryAction,
  type PmrAllowanceQueueStatus,
  type RmAllowanceApprovalRequest,
} from "../lib/rmAllowanceApprovalUx";

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
  shortIssueQty?: number;
  /** PMR qty already issued to production. */
  alreadyIssuedQty?: number;
  /** PMR balance still to issue (= original − issued). */
  stillRequiredQty?: number;
  /** WO-wise cap after prior issue, consumption, and return history. */
  issueCapQty?: number;
  fullWoRmNeed?: number;
  allowanceInputSource?: PlannedAllowanceInputSource;
  plannedAllowancePct?: string;
  plannedAllowanceQty?: string;
  allowanceReason?: string;
  /** RM allowance Admin approval workflow — hydrated from the latest matching request, if any. */
  allowanceApprovalId?: number | null;
  allowanceApprovalStatus?: PmrAllowanceQueueStatus;
  allowanceApprovalRejectionReason?: string | null;
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
  lineReadinessKey?: string | null;
  lineReadinessLabel?: string | null;
  lineReadinessExplanation?: string | null;
  waitingProcurement?: boolean | null;
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
  totalRequired?: number | null;
  totalIssued?: number | null;
  lineCount?: number;
  pendingLineCount?: number | null;
  issueQueueState?: "READY_TO_ISSUE" | "PARTIALLY_ISSUED" | "COMPLETE" | "SHORT_CLOSED" | null;
  storeIssueReady?: boolean | null;
  storeActionKey?: string | null;
  storeActionLabel?: string | null;
};

type IssueMode = "wo-pmr" | "manual";

type PmrIssueLine = {
  id: number;
  itemId: number;
  fullWoRmNeed?: number;
  itemName: string;
  requiredQty: number;
  originalRequiredQty?: number;
  effectiveRequiredQty?: number;
  issuedQty: number;
  waivedQty?: number;
  shortIssueQty?: number;
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
  lineReadinessKey?: string | null;
  lineReadinessLabel?: string | null;
  lineReadinessExplanation?: string | null;
  waitingProcurement?: boolean | null;
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
  totalShortIssueQty?: number;
  totalExcessIssue: number;
  totalRemaining: number;
  pmrStatus?: string;
  pmrStatusLabel?: string;
  canIssueMore: boolean;
  canIssueAnyPendingLine?: boolean;
  waitingProcurement?: boolean;
  waitingProcurementLineCount?: number;
  blockerReason?: string | null;
  storeActionKey?: string | null;
  storeActionLabel?: string | null;
  storeIssueReady?: boolean;
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
  const draft: IssueLineDraft = {
    key: `pmr-${pl.id}`,
    pmrLineId: pl.id,
    itemId: pl.itemId,
    itemName: pl.itemName,
    unit: pl.unit,
    originalRequestQty: pl.originalRequiredQty ?? pl.requiredQty,
    effectiveRequiredQty: pl.effectiveRequiredQty ?? Math.max(0, pl.requiredQty - (pl.waivedQty ?? 0)),
    waivedQty: pl.waivedQty,
    shortIssueQty: pl.shortIssueQty ?? pl.waivedQty,
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
    issueQty: "0",
    issueQtyTouched: false,
    fullWoRmNeed: pl.fullWoRmNeed ?? pl.originalRequiredQty ?? pl.requiredQty,
    allowanceInputSource: "QUANTITY",
    plannedAllowancePct: "0",
    plannedAllowanceQty: "0",
    allowanceReason: "",
    available: storeQty,
    loadingAvailable: false,
    lineReadinessKey: pl.lineReadinessKey,
    lineReadinessLabel: pl.lineReadinessLabel,
    lineReadinessExplanation: pl.lineReadinessExplanation,
    waitingProcurement: pl.waitingProcurement,
  };
  draft.issueQty = defaultIssueQtyForLine(draft, storeQty);
  return draft;
}

function assessIssueLineDraft(ln: IssueLineDraft) {
  const pending = ln.pmrPendingQty ?? ln.pendingQty ?? 0;
  const allowance = allowanceForLine(ln);
  const defaultNow = allowance.valid ? allowance.defaultIssueNowQty : pending;
  const allowanceAdjustedPending = Math.max(pending, defaultNow);
  return assessMaterialIssueQty(ln.issueQty, allowanceAdjustedPending, {
    woStillRequiredQty: ln.issueCapQty ?? ln.stillRequiredQty,
    maxAllowedIssueQty: Math.max(Number(ln.maxAllowedIssueQty ?? 0), defaultNow),
  });
}

function allowanceForLine(ln: IssueLineDraft) {
  return calculatePlannedAllowance({
    theoreticalQty: Number(
      ln.fullWoRmNeed ?? ln.originalRequestQty ?? ln.effectiveRequiredQty ?? 0,
    ),
    quantityRaw: ln.plannedAllowanceQty ?? "0",
    alreadyIssuedQty: Number(ln.alreadyIssuedQty ?? 0),
  });
}

function defaultIssueQtyForLine(ln: IssueLineDraft, available: number | null | undefined): string {
  const allowance = allowanceForLine(ln);
  if (!allowance.valid) {
    return formatSuggestedIssueQty(ln.stillRequiredQty ?? ln.pmrPendingQty ?? 0, available);
  }
  const capped =
    available != null && Number.isFinite(available)
      ? Math.min(allowance.defaultIssueNowQty, available)
      : allowance.defaultIssueNowQty;
  return formatAllowanceInput(Math.max(0, capped));
}

export function MaterialIssuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { showSuccess, showError } = useToast();
  const { user } = useAuth();
  const [ctx, setCtx] = React.useState<ContextResponse | null>(null);
  const [recent, setRecent] = React.useState<RecentIssue[]>([]);
  const [issuedWaitingForProduction, setIssuedWaitingForProduction] = React.useState<IssuedWaitingForProductionRow[]>([]);
  const [pendingPmrs, setPendingPmrs] = React.useState<PendingPmr[]>([]);
  const [allowanceApprovals, setAllowanceApprovals] = React.useState<RmAllowanceApprovalRequest[]>([]);
  const [activePmrId, setActivePmrId] = React.useState<number | null>(null);
  const [activePmr, setActivePmr] = React.useState<PmrIssueContext["pmr"] | null>(null);
  const [issueDecision, setIssueDecision] = React.useState<PmrIssueDecision | null>(null);
  const [waiveReason, setWaiveReason] = React.useState("");
  const [waiveRemarks, setWaiveRemarks] = React.useState("");
  const [showWaiveForm, setShowWaiveForm] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const { initialLoading, startLoad, finishLoad } = useStablePageLoad();
  const [submitting, setSubmitting] = React.useState(false);
  const [sessionComplete, setSessionComplete] = React.useState<MaterialIssueSessionComplete | null>(null);
  const [sessionBanner, setSessionBanner] = React.useState<string | null>(null);
  const [pmrLoading, setPmrLoading] = React.useState(false);
  const [pmrLoadError, setPmrLoadError] = React.useState<string | null>(null);

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

  function updateExtraAllowanceQty(lineKey: string, rawValue: string) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== lineKey) return line;
        const nextLine: IssueLineDraft = {
          ...line,
          allowanceInputSource: "QUANTITY",
          plannedAllowanceQty: rawValue,
        };
        const calc = allowanceForLine(nextLine);
        nextLine.plannedAllowancePct = calc.valid
          ? formatAllowanceInput(calc.calculatedPct, 4)
          : line.plannedAllowancePct ?? "0";
        if (calc.valid) nextLine.issueQty = formatAllowanceInput(calc.defaultIssueNowQty);
        nextLine.issueQtyTouched = false;
        return nextLine;
      }),
    );
  }
  function updateIssueNowQty(lineKey: string, rawValue: string) {
    setLines((prev) => prev.map((line) => {
      if (line.key !== lineKey) return line;
      const derived = deriveAllowanceFromIssueNow({
        issueQtyRaw: rawValue,
        theoreticalQty: Number(line.fullWoRmNeed ?? line.originalRequestQty ?? 0),
        alreadyIssuedQty: Number(line.alreadyIssuedQty ?? 0),
      });
      if (!derived.valid) return { ...line, issueQty: rawValue, issueQtyTouched: true };
      const nextLine: IssueLineDraft = {
        ...line,
        issueQty: rawValue,
        issueQtyTouched: true,
        allowanceInputSource: "QUANTITY",
        plannedAllowanceQty: formatAllowanceInput(derived.allowanceQty),
        allowanceApprovalStatus: line.allowanceApprovalStatus === "APPROVED" ? "NONE" : line.allowanceApprovalStatus,
        allowanceApprovalId: line.allowanceApprovalStatus === "APPROVED" ? null : line.allowanceApprovalId,
      };
      const calc = allowanceForLine(nextLine);
      nextLine.plannedAllowancePct = calc.valid
        ? formatAllowanceInput(calc.calculatedPct, 4)
        : line.plannedAllowancePct ?? "0";
      return nextLine;
    }));
  }
  useUnsavedChangesGuard({
    isDirty:
      lines.some((ln) => ln.issueQtyTouched || (String(ln.issueQty).trim() !== "" && Number(ln.issueQty) > 0)) ||
      showWaiveForm ||
      Boolean(waiveReason.trim() || waiveRemarks.trim()),
    message: "Material issue has unsaved quantities. Leave and discard them?",
  });
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

  async function loadAllowanceApprovals(): Promise<RmAllowanceApprovalRequest[]> {
    try {
      const rows = await apiFetch<RmAllowanceApprovalRequest[]>(
        "/api/rm-allowance-approvals?status=PENDING_APPROVAL,APPROVED,REJECTED",
      );
      const list = Array.isArray(rows) ? rows : [];
      setAllowanceApprovals(list);
      return list;
    } catch {
      setAllowanceApprovals([]);
      return [];
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
      setIssueDecision(data.issueDecision ?? null);
      if (data.pmr.workOrderId) setWorkOrderId(data.pmr.workOrderId);
      setRemarks(`Issue against ${displayPmrNo(pmrId, data.pmr.docNo)}`);
      const sourceLines = filterMaterialIssueEntryLines(data.pendingLines?.length ? data.pendingLines : data.lines ?? []);
      const draftLines = sourceLines.length ? sourceLines.map(pmrLineToDraft) : [];
      setLines(hydrateIssueLinesWithAllowanceApprovals(draftLines, allowanceApprovals));
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
        loadAllowanceApprovals(),
      ]);
      setCtx(context);
      setRecent(Array.isArray(list) ? list : []);
      setIssuedWaitingForProduction(Array.isArray(waitingForProduction) ? waitingForProduction : []);
      if (context.fromLocations.length === 1 && fromLocationId === "") {
        setFromLocationId(context.fromLocations[0].id);
      }
      if (toLocationId === "") {
        const defaultTo = resolveDefaultMaterialIssueToLocationId(context.toLocations);
        if (defaultTo != null) setToLocationId(defaultTo);
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

  // Admin approve/reject bumps pending-actions; refresh side-queue without blocking Store work.
  const allowanceQueueRefreshTick = useErpRefreshTick(["pending-actions", "production"], {
    pollIntervalMs: 45_000,
    refreshOnVisible: true,
  });
  React.useEffect(() => {
    if (allowanceQueueRefreshTick === 0) return;
    void refreshPendingPmrsList();
    void loadAllowanceApprovals();
  }, [allowanceQueueRefreshTick]);

  const deepLink = React.useMemo(() => parseMaterialIssueDeepLink(searchParams), [searchParams]);
  const urlPmrId = deepLink.pmrId ?? 0;
  const urlWorkOrderId = deepLink.workOrderId ?? 0;
  const returnTo = deepLink.returnTo ?? searchParams.get("returnTo");
  const queueFilterFromUrl: MaterialIssueQueueFilterKey = deepLink.filterKey;
  const requestedBucket: MaterialIssueBucket | null = deepLink.bucket;
  const sessionScope = React.useMemo(
    () =>
      parseMaterialIssueSessionScope({
        requirementSheetId: searchParams.get("requirementSheetId"),
        salesOrderId: searchParams.get("salesOrderId"),
      }),
    [searchParams],
  );
  const scopedPendingPmrs = React.useMemo(
    () => mergeAllowanceQueueInfoIntoPmrs(filterPendingPmrsForSessionScope(pendingPmrs, sessionScope), allowanceApprovals),
    [pendingPmrs, sessionScope, allowanceApprovals],
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
      if (deepLink.fromPendingActions) next.set("from", "pending-actions");
      const bucket = requestedBucket ?? (deepLink.bucketExplicit ? deepLink.bucket : null);
      if (bucket) {
        next.set("bucket", bucket);
        next.delete("queue");
      }
      const resolvedWo =
        woId ?? pendingPmrs.find((p) => p.id === pmrId)?.workOrderId ?? (typeof workOrderId === "number" ? workOrderId : 0);
      if (resolvedWo && resolvedWo > 0) next.set("workOrderId", String(resolvedWo));
      setSearchParams(next, { replace: true });
      if (resolvedWo && resolvedWo > 0) setWorkOrderId(resolvedWo);
      void loadPmrIntoForm(pmrId, typeof fromLocationId === "number" ? fromLocationId : undefined);
    },
    [
      deepLink.bucket,
      deepLink.bucketExplicit,
      deepLink.fromPendingActions,
      fromLocationId,
      pendingPmrs,
      requestedBucket,
      returnTo,
      searchParams,
      setSearchParams,
      workOrderId,
    ],
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
    if (deepLink.fromPendingActions) next.set("from", "pending-actions");
    if (requestedBucket) {
      next.set("bucket", requestedBucket);
      next.delete("queue");
    }
    setSearchParams(next, { replace: true });
  }, [deepLink.fromPendingActions, requestedBucket, returnTo, searchParams, setSearchParams]);

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

  // Invalid bucket token — stay on default Ready, do not invent a wrong queue.
  React.useEffect(() => {
    if (!deepLink.invalidBucketRequested) return;
    showError("Unknown Material Issue queue in the link. Showing Ready to Issue.");
  }, [deepLink.invalidBucketRequested]);

  /**
   * Deep-link resolver (Pending Actions → Material Issue):
   * 1) Activate requested bucket (never overwrite with Ready when bucket is present).
   * 2) If WO/PMR provided, verify membership and load; else leave list-only (no arbitrary WO).
   */
  const deepLinkResolvedKeyRef = React.useRef<string>("");
  React.useEffect(() => {
    if (!ctx || issueMode === "manual") return;
    if (loading || pmrLoading) return;

    const key = `${deepLink.bucket ?? ""}:${urlPmrId}:${urlWorkOrderId}:${scopedPendingPmrs.length}:${allowanceApprovals.length}`;
    if (deepLinkResolvedKeyRef.current === key) return;

    // List-only Open List: activate bucket, clear any stale selection not in URL.
    if (!urlPmrId && !urlWorkOrderId) {
      deepLinkResolvedKeyRef.current = key;
      if (activePmrId && deepLink.bucketExplicit) {
        // Keep form empty for grouped list — Store picks a card.
        setActivePmrId(null);
        setActivePmr(null);
        setIssueDecision(null);
        setLines([]);
        setWorkOrderId("");
      }
      return;
    }

    if (!deepLink.bucketExplicit || !requestedBucket) {
      // Legacy/non-bucket deep link: select by PMR/WO without bucket membership check.
      if (urlPmrId > 0) {
        deepLinkResolvedKeyRef.current = key;
        if (urlWorkOrderId > 0) setWorkOrderId(urlWorkOrderId);
        void loadPmrIntoForm(urlPmrId, typeof fromLocationId === "number" ? fromLocationId : undefined);
        return;
      }
      if (urlWorkOrderId > 0) {
        const pmr = pickActionablePmrForWorkOrder(urlWorkOrderId, scopedPendingPmrs);
        if (pmr) {
          deepLinkResolvedKeyRef.current = key;
          selectPmr(pmr.id, urlWorkOrderId);
          return;
        }
        if (workOrderId === "") setWorkOrderId(urlWorkOrderId);
        if (!ensuredWoRef.current.has(urlWorkOrderId)) {
          deepLinkResolvedKeyRef.current = key;
          void ensurePmrAndSelect(urlWorkOrderId);
        }
      }
      return;
    }

    const resolved = resolveMaterialIssueDeepLinkTarget({
      requestedBucket,
      workOrderId: urlWorkOrderId || null,
      pmrId: urlPmrId || null,
      pmrs: scopedPendingPmrs,
      fromAllowanceAction: deepLink.fromPendingActions,
    });

    if (resolved.ok) {
      deepLinkResolvedKeyRef.current = key;
      selectPmr(resolved.pmr.id, Number(resolved.pmr.workOrderId) || urlWorkOrderId || undefined);
      return;
    }

    deepLinkResolvedKeyRef.current = key;
    if (resolved.reason === "WRONG_BUCKET" && resolved.actualBucket && resolved.pmr) {
      showError(resolved.message);
      const nextHref = buildMaterialIssueDeepLink({
        bucket: resolved.actualBucket,
        workOrderId: Number(resolved.pmr.workOrderId) || null,
        pmrId: resolved.pmr.id,
        returnTo: returnTo ?? "pending-actions",
        from: "pending-actions",
      });
      const qs = nextHref.split("?")[1] ?? "";
      setSearchParams(new URLSearchParams(qs), { replace: true });
      selectPmr(resolved.pmr.id, Number(resolved.pmr.workOrderId) || undefined);
      return;
    }

    showError(resolved.message);
    // Stale allowance / missing PMR — clear pinned WO/PMR and leave list-only on a usable bucket.
    setActivePmrId(null);
    setActivePmr(null);
    setIssueDecision(null);
    setLines([]);
    setWorkOrderId("");
    if (resolved.reason === "STALE_ALLOWANCE" || resolved.reason === "NOT_FOUND") {
      const next = new URLSearchParams(searchParams);
      next.delete("pmrId");
      next.delete("workOrderId");
      next.delete("allowanceApprovalId");
      next.set("bucket", "readyToIssue");
      next.delete("queue");
      if (returnTo) next.set("returnTo", returnTo);
      if (deepLink.fromPendingActions) next.set("from", "pending-actions");
      setSearchParams(next, { replace: true });
    }
  }, [
    activePmrId,
    allowanceApprovals.length,
    ctx,
    deepLink.bucket,
    deepLink.bucketExplicit,
    deepLink.invalidBucketRequested,
    ensurePmrAndSelect,
    fromLocationId,
    issueMode,
    loading,
    pmrLoading,
    requestedBucket,
    returnTo,
    scopedPendingPmrs,
    selectPmr,
    setSearchParams,
    showError,
    urlPmrId,
    urlWorkOrderId,
    workOrderId,
  ]);

  const prevFromLocationRef = React.useRef<number | "">("");
  React.useEffect(() => {
    if (!activePmrId || typeof fromLocationId !== "number") return;
    if (prevFromLocationRef.current === fromLocationId) return;
    prevFromLocationRef.current = fromLocationId;
    void loadPmrIntoForm(activePmrId, fromLocationId);
  }, [activePmrId, fromLocationId]);

  // Re-sync line-level allowance approval status whenever the approvals list refreshes
  // (e.g. Refresh button, or after Send for Admin Approval) without disturbing untouched edits.
  React.useEffect(() => {
    if (!activePmrId) return;
    setLines((prev) => {
      const next = hydrateIssueLinesWithAllowanceApprovals(prev, allowanceApprovals);
      return next.some((ln, i) => ln !== prev[i]) ? next : prev;
    });
  }, [allowanceApprovals, activePmrId]);

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
          if (!ln.issueQtyTouched) {
            next.issueQty = defaultIssueQtyForLine(next, available);
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
    issuedQty: number;
    remainingQty: number;
    unit?: string | null;
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
      loadAllowanceApprovals(),
    ]);

    const woLabel =
      issued.workOrderId > 0
        ? displayWorkOrderNo(issued.workOrderId, issued.workOrderNo)
        : "work order";
    if (issued.remainingQty > 1e-6) {
      showSuccess(formatPartialIssueSuccessMessage({
        issuedQty: issued.issuedQty,
        remainingQty: issued.remainingQty,
        unit: issued.unit,
      }));
      const affected = freshPending.find((row) => Number(row.id) === Number(issued.pmrId));
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("bucket", "partiallyIssued");
      nextParams.delete("queue");
      nextParams.set("pmrId", String(issued.pmrId));
      nextParams.set("workOrderId", String(issued.workOrderId));
      if (returnTo) nextParams.set("returnTo", returnTo);
      setSearchParams(nextParams, { replace: true });
      if (affected) {
        setSessionComplete(null);
        selectPmr(affected.id, affected.workOrderId);
      } else {
        setActivePmrId(issued.pmrId);
        setWorkOrderId(issued.workOrderId);
        await loadPmrIntoForm(
          issued.pmrId,
          typeof fromLocationId === "number" ? fromLocationId : undefined,
        );
      }
      return;
    } else {
      showSuccess(formatMaterialIssueSuccessMessage(woLabel));
    }

    // Never stay on a partially issued WO — clear form and advance to next Ready WO.
    const advance = resolvePostIssueAdvance({
      issuedWorkOrderId: issued.workOrderId,
      freshPending,
      scope: sessionScope,
    });

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
      const allowance = allowanceForLine(ln);
      if (!allowance.valid) {
        showError(allowance.error ?? "Enter a valid Planned Process Allowance.");
        return;
      }
      if (allowance.blocked) {
        showError("Allowance above 10%; use Additional RM Issue.");
        return;
      }
      if (allowance.requiresReason && !String(ln.allowanceReason ?? "").trim()) {
        showError("Reason required for Planned Allowance above 5%.");
        return;
      }
      const lineBand = resolveLineAllowanceBand({
        blocked: allowance.blocked,
        requiresAdminApproval: allowance.requiresAdminApproval,
        hasReason: Boolean(String(ln.allowanceReason ?? "").trim()),
        approvalStatus: ln.allowanceApprovalStatus ?? "NONE",
        isAdmin: String(user?.role ?? "").toUpperCase() === "ADMIN",
      });
      if (lineBand !== "NORMAL" && lineBand !== "APPROVED") {
        showError(
          lineBand === "PENDING_APPROVAL"
            ? "This line is awaiting Admin approval."
            : "Admin approval is required before issuing this line above 5% allowance.",
        );
        return;
      }
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
          .map((ln) => ({
            pmrLineId: ln.pmrLineId as number,
            issueQty: Number(ln.issueQty),
            theoreticalBomQty: Number(ln.fullWoRmNeed ?? ln.originalRequestQty ?? 0),
            includedRunnerQty: 0,
            allowanceInputSource: "QUANTITY" as const,
            enteredAllowanceQty: Number(ln.plannedAllowanceQty || 0),
            plannedAllowanceQty: allowanceForLine(ln).calculatedQty,
            recommendedIssueQty: allowanceForLine(ln).recommendedIssueQty,
            allowanceReason: ln.allowanceReason?.trim() || null,
            allowanceApprovalRequestId:
              ln.allowanceApprovalStatus === "APPROVED" ? ln.allowanceApprovalId ?? null : null,
          }));
        if (!pmrLines.length) {
          showError("Add issue quantities for PMR lines.");
          setSubmitting(false);
          return;
        }
        const thisIssueQty = pmrLines.reduce((s, l) => s + Number(l.issueQty || 0), 0);
        const remainingBefore = lines
          .filter((ln) => ln.pmrLineId)
          .reduce((s, ln) => s + Math.max(0, Number(ln.pmrPendingQty ?? ln.pendingQty ?? 0)), 0);
        const remainingAfter = Math.max(0, remainingBefore - thisIssueQty);
        const unitHint = lines.find((ln) => ln.pmrLineId && Number(ln.issueQty) > 0)?.unit ?? null;
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
          issuedQty: thisIssueQty,
          remainingQty: remainingAfter,
          unit: unitHint,
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
      showError("Select a Short Issue close reason.");
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
      showSuccess(
        "Short Issue closed — unissued qty stays in RM Store (no stock movement). Production uses issued qty only.",
      );
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

  /**
   * Picks the next FIFO Ready-to-Issue WO (skips Partially Issued + Approval Pending),
   * so Store is never blocked after send-for-approval or partial issue.
   */
  async function autoSelectNextActionableWorkOrder(excludeWorkOrderId: number | null) {
    const [fresh, approvals] = await Promise.all([refreshPendingPmrsList(), loadAllowanceApprovals()]);
    const scoped = mergeAllowanceQueueInfoIntoPmrs(
      filterPendingPmrsForSessionScope(fresh, sessionScope),
      approvals,
    );
    const next = pickNextReadyToIssuePmrInScope(scoped, sessionScope, excludeWorkOrderId ?? undefined);
    if (next && typeof next.workOrderId === "number") {
      selectPmr(next.id, next.workOrderId);
    }
  }

  /** Send / resend RM lines above 5% allowance for Admin approval. No stock movement happens here. */
  async function handleSendForApproval() {
    if (!activePmrId || typeof fromLocationId !== "number") {
      showError("Select a from-location and work order first.");
      return;
    }
    const targets = lines.filter((ln) => {
      if (!ln.pmrLineId || Number(ln.issueQty) <= 0) return false;
      const allowance = allowanceForLine(ln);
      return allowance.valid && !allowance.blocked && allowance.requiresAdminApproval;
    });
    if (!targets.length) {
      showError("No RM lines need Admin approval.");
      return;
    }
    for (const ln of targets) {
      if (!String(ln.allowanceReason ?? "").trim()) {
        showError("Enter a reason for every line above 5% allowance before sending for approval.");
        return;
      }
    }
    setSubmitting(true);
    const submittedWorkOrderId = Number(activePmr?.workOrderId ?? workOrderId ?? 0) || null;
    try {
      for (const ln of targets) {
        await apiFetch("/api/rm-allowance-approvals", {
          method: "POST",
          body: JSON.stringify({
            productionMaterialRequestId: activePmrId,
            pmrLineId: ln.pmrLineId,
            enteredAllowanceQty: Number(ln.plannedAllowanceQty || 0),
            issueQty: Number(ln.issueQty),
            allowanceReason: String(ln.allowanceReason).trim(),
            fromLocationId,
          }),
        });
      }
      showSuccess("Sent for Admin approval. You can select another work order while this is reviewed.");
      await loadAllowanceApprovals();
      clearExecution();
      await autoSelectNextActionableWorkOrder(submittedWorkOrderId);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not send for Admin approval");
    } finally {
      setSubmitting(false);
    }
  }

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

  const resolvedWorkOrderIdForHint =
    (typeof workOrderId === "number" && workOrderId > 0 ? workOrderId : null) ??
    (urlWorkOrderId > 0 ? urlWorkOrderId : null) ??
    (activePmr?.workOrderId && activePmr.workOrderId > 0 ? activePmr.workOrderId : null);

  const canIssueAnyLine =
    issueDecision?.canIssueAnyPendingLine ??
    lines.some((ln) => {
      const pending = ln.pmrPendingQty ?? ln.pendingQty ?? 0;
      if (!ln.pmrLineId || pending <= 0) return false;
      const readinessKey = String(ln.lineReadinessKey ?? "").toUpperCase();
      if (readinessKey === "READY" || readinessKey === "PARTIAL") return true;
      if (readinessKey) return false;
      const avail = ln.available ?? ln.freeStoreStock ?? ln.issueAvailableStoreQty;
      return !isMaterialIssueLineStockBlocked(pending, avail);
    });

  const hasPositiveIssueQty = lines.some((ln) => ln.pmrLineId && Number(ln.issueQty) > 0);

  const waitingProcurement = waitingProcurementFromIssueDecision(issueDecision);

  const hasToleranceBlockedLine = lines.some((ln) => {
    if (!ln.pmrLineId || !ln.issueQty) return false;
    return !assessIssueLineDraft(ln).allowed;
  });
  const hasAllowanceBlockedLine = lines.some((ln) => {
    if (!ln.pmrLineId || Number(ln.issueQty) <= 0) return false;
    const allowance = allowanceForLine(ln);
    if (!allowance.valid || allowance.blocked) return true;
    if (allowance.requiresReason && !String(ln.allowanceReason ?? "").trim()) return true;
    return allowance.requiresAdminApproval && String(user?.role ?? "").toUpperCase() !== "ADMIN";
  });

  const isAdminActor = String(user?.role ?? "").toUpperCase() === "ADMIN";
  const activeLineAllowanceBands = React.useMemo(() => {
    if (!woPmrMode) return [];
    return lines
      .filter((ln) => ln.pmrLineId && Number(ln.issueQty) > 0)
      .map((ln) => {
        const allowance = allowanceForLine(ln);
        return resolveLineAllowanceBand({
          blocked: allowance.valid ? allowance.blocked : false,
          requiresAdminApproval: allowance.valid ? allowance.requiresAdminApproval : false,
          hasReason: Boolean(String(ln.allowanceReason ?? "").trim()),
          approvalStatus: ln.allowanceApprovalStatus ?? "NONE",
          isAdmin: isAdminActor,
        });
      });
  }, [lines, woPmrMode, isAdminActor]);
  const primaryAction = React.useMemo(
    () => resolveMaterialIssuePrimaryAction(activeLineAllowanceBands, { isAdmin: isAdminActor }),
    [activeLineAllowanceBands, isAdminActor],
  );
  const rejectionReasons = React.useMemo(() => {
    const set = new Set<string>();
    for (const ln of lines) {
      if (ln.allowanceApprovalStatus === "REJECTED" && ln.allowanceApprovalRejectionReason) {
        set.add(ln.allowanceApprovalRejectionReason);
      }
    }
    return [...set];
  }, [lines]);
  const bandAllowsIssue = primaryAction.key === "ISSUE";

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
    (woPmrMode
      ? bandAllowsIssue &&
        canSubmitFromBackendIssueDecision(issueDecision, {
          hasPositiveIssueQty,
          hasToleranceBlockedLine,
          submitting,
          loading: loading || pmrLoading,
        })
      : hasPositiveIssueQty && !hasToleranceBlockedLine && !hasAllowanceBlockedLine && !submitting && !loading);

  const sendForApprovalDisabled =
    !executionReady ||
    !pmrContextReady ||
    submitting ||
    loading ||
    pmrLoading ||
    !lines.some((ln) => {
      if (!ln.pmrLineId || Number(ln.issueQty) <= 0) return false;
      const allowance = allowanceForLine(ln);
      return (
        allowance.valid &&
        !allowance.blocked &&
        allowance.requiresAdminApproval &&
        !isAdminActor &&
        String(ln.allowanceReason ?? "").trim().length > 0
      );
    });

  const primaryButtonDisabled = woPmrMode
    ? primaryAction.key === "ISSUE"
      ? !canSubmitIssue
      : primaryAction.key === "SEND_FOR_APPROVAL" || primaryAction.key === "REVISE_RESUBMIT"
        ? sendForApprovalDisabled
        : true
    : !canSubmitIssue;

  function onPrimaryActionClick() {
    if (!woPmrMode || primaryAction.key === "ISSUE") return submitIssue();
    if (primaryAction.key === "SEND_FOR_APPROVAL" || primaryAction.key === "REVISE_RESUBMIT") {
      return handleSendForApproval();
    }
    return Promise.resolve();
  }

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

  const materialIssueActionSummary = React.useMemo(() => {
    if (!woPmrMode || !executionReady || lines.length === 0) return null;
    return buildMaterialIssueActionSummary(
      lines
        .filter((ln) => ln.pmrLineId)
        .map((ln) => ({
          pmrLineId: ln.pmrLineId,
          unit: ln.unit,
          issueQty: ln.issueQty,
          theoreticalQty: Number(ln.fullWoRmNeed ?? ln.originalRequestQty ?? 0),
          issuedQty: Number(ln.alreadyIssuedQty ?? 0),
          pendingQty: Number(ln.pmrPendingQty ?? ln.pendingQty ?? 0),
          stillRequiredQty: ln.stillRequiredQty,
          issueCapQty: ln.issueCapQty,
          maxAllowedIssueQty: ln.maxAllowedIssueQty,
          plannedAllowanceQty: ln.plannedAllowanceQty,
          allowanceReason: ln.allowanceReason,
          availableQty: ln.available ?? ln.freeStoreStock ?? ln.issueAvailableStoreQty ?? null,
          approvalStatus: ln.allowanceApprovalStatus,
          approvalRejectionReason: ln.allowanceApprovalRejectionReason,
        })),
      user?.role,
    );
  }, [woPmrMode, executionReady, lines, user?.role]);

  const rmTableRows = React.useMemo(() => {
    return lines.map((ln) => {
      const item = ctx?.rmItems.find((i) => i.id === ln.itemId);
      const unit = ln.unit ?? item?.unit;
      const required = ln.originalRequestQty ?? ln.effectiveRequiredQty ?? 0;
      const theoretical = Number(ln.fullWoRmNeed ?? required);
      const issued = Number(ln.alreadyIssuedQty ?? 0);
      const shortIssue = Number(ln.waivedQty ?? ln.shortIssueQty ?? 0);
      const pending = Number(ln.pmrPendingQty ?? ln.pendingQty ?? 0);
      const avail = ln.available ?? ln.freeStoreStock ?? ln.issueAvailableStoreQty ?? null;
      const noIssue = isMaterialIssueLineStockBlocked(pending, avail);
      return {
        key: ln.key,
        itemName: ln.itemName ?? item?.itemName ?? "RM item",
        unit,
        theoreticalQty: theoretical,
        issuedQty: issued,
        trueShortIssueQty: shortIssue,
        pendingQty: pending,
        stillRequiredQty: ln.stillRequiredQty,
        issueCapQty: ln.issueCapQty,
        maxAllowedIssueQty: ln.maxAllowedIssueQty,
        availableQty: ln.loadingAvailable ? null : avail,
        allowanceQty: ln.plannedAllowanceQty ?? "0",
        allowanceReason: ln.allowanceReason ?? "",
        issueQty: ln.issueQty,
        disabled: noIssue || pmrLoading || primaryAction.readOnly,
        approvalStatus: ln.allowanceApprovalStatus ?? "NONE",
        approvalRejectionReason: ln.allowanceApprovalRejectionReason,
      };
    });
  }, [ctx?.rmItems, lines, pmrLoading, primaryAction.readOnly]);

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
    <PageContainer className="erp-txn-workspace erp-mat-plan-workspace space-y-1">
      <StickyWorkspaceHead
        lead={
          hideWorkflowTrail ? (
            <ERPBackNavigation defaultTo="/pending-actions" defaultLabel="Back to Pending Actions" />
          ) : (
            <ErpWorkflowTrail navContext={materialIssueNavContext} />
          )
        }
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h1 className="text-sm font-semibold leading-tight text-slate-900">Material Issue</h1>
          {materialIssuePrimaryStrip ? (
            <span
              className="inline-flex max-w-full items-center rounded-full border border-amber-300/80 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-950"
              data-testid="material-issue-inline-status"
            >
              {materialIssuePrimaryStrip}
            </span>
          ) : null}
        </div>
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
      <div className="grid min-h-0 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)] lg:items-start">
        <div
          id="material-issue-execution"
          className="flex max-h-[calc(100dvh-5rem)] min-h-[24rem] min-w-0 flex-col rounded-md border border-slate-200 bg-white shadow-sm"
        >
          <div className="shrink-0 space-y-1 border-b border-slate-100 px-2 py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-600">
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
              <div className="flex shrink-0 rounded border border-slate-200 p-0.5 text-[11px]">
                <button
                  type="button"
                  className={cn(
                    "rounded px-2.5 py-0.5 font-semibold",
                    woPmrMode ? "bg-slate-900 text-white" : "text-slate-600",
                  )}
                  onClick={() => {
                    setIssueMode("wo-pmr");
                    if (!activePmrId) setLines([]);
                  }}
                >
                  Issue RM
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded px-2.5 py-0.5 font-semibold",
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
                className="inline-block text-[10px] font-semibold text-violet-900 underline"
              >
                View allocation in RM Control Center
              </Link>
            ) : null}

            {pmrLoading ? (
              <p className="text-[11px] text-slate-600">Loading material request lines…</p>
            ) : pmrLoadError ? (
              <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">{pmrLoadError}</p>
            ) : null}

            {woPmrMode && executionReady && primaryAction.key === "AWAITING_APPROVAL" ? (
              <div
                className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-950"
                data-testid="material-issue-awaiting-approval-banner"
              >
                <p className="font-bold">Awaiting Admin Approval</p>
                <p className="mt-0.5 leading-snug">
                  Pick another work order from the queue while this allowance is reviewed.
                </p>
                <Button type="button" size="sm" variant="outline" className="mt-1 h-7 text-[11px]" onClick={clearExecution}>
                  Select another work order
                </Button>
              </div>
            ) : null}

            {woPmrMode && executionReady && primaryAction.key === "REVISE_RESUBMIT" ? (
              <div
                className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-950"
                data-testid="material-issue-rejected-banner"
              >
                <p className="font-bold">Rejected by Admin</p>
                <p className="mt-0.5 leading-snug">
                  {rejectionReasons.length
                    ? rejectionReasons.join(" · ")
                    : "Revise Add Qty or reason below, then resubmit."}
                </p>
              </div>
            ) : null}

            <div className="grid gap-1 sm:grid-cols-2">
              <label className="erp-form-field block">
                <span className="text-xs font-medium text-slate-600">From location (store)</span>
                <select
                  className="erp-select mt-0.5 w-full"
                  value={fromLocationId === "" ? "" : String(fromLocationId)}
                  onChange={(e) => setFromLocationId(e.target.value ? Number(e.target.value) : "")}
                  disabled={loading || primaryAction.readOnly}
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
                  className="erp-select mt-0.5 w-full"
                  value={toLocationId === "" ? "" : String(toLocationId)}
                  onChange={(e) => setToLocationId(e.target.value ? Number(e.target.value) : "")}
                  disabled={loading || primaryAction.readOnly}
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
                <label className="erp-form-field block sm:col-span-1">
                  <span className="text-xs font-medium text-slate-600">Work order</span>
                  <select
                    className="erp-select mt-0.5 w-full"
                    value={workOrderId === "" ? "" : String(workOrderId)}
                    onChange={(e) => onWorkOrderSelect(e.target.value ? Number(e.target.value) : "")}
                    disabled={loading || pmrLoading || primaryAction.readOnly}
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
                <label className="erp-form-field block sm:col-span-1">
                  <span className="text-xs font-medium text-slate-600">Work order (manual)</span>
                  <select
                    className="erp-select mt-0.5 w-full"
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
              <label className="erp-form-field block sm:col-span-1">
                <span className="text-xs font-medium text-slate-600">Remarks</span>
                <Input
                  className="mt-0.5 h-9"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional note"
                />
              </label>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1.5">
            {selectedPmrFullyIssued ? (
              <div
                className="rounded border border-emerald-200 bg-emerald-50 px-3 py-3 text-center"
                data-testid="material-issue-fully-issued-message"
              >
                <p className="text-sm font-semibold text-emerald-950">
                  Material already fully issued for this work order.
                </p>
              </div>
            ) : woPmrMode && !executionReady && !pmrLoading ? (
              <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-center">
                <p className="text-sm font-semibold text-slate-800">
                  {actionablePendingPmrs.length === 0
                    ? "No pending material requests."
                    : "Select a work order from the queue to load RM lines."}
                </p>
              </div>
            ) : woPmrMode ? (
              <MaterialIssueRmTable
                className="min-h-0 flex-1"
                rows={rmTableRows}
                actorRole={user?.role}
                onExtraQtyChange={(lineKey, value) => updateExtraAllowanceQty(lineKey, value)}
                onIssueQtyChange={(lineKey, value) => updateIssueNowQty(lineKey, value)}
                onReasonChange={(lineKey, value) =>
                  setLines((prev) =>
                    prev.map((row) => (row.key === lineKey ? { ...row, allowanceReason: value } : row)),
                  )
                }
              />
            ) : (
              <div className="grid min-w-0 gap-2 rounded border border-slate-200 p-2">
                {lines.map((ln) => {
                  const item = ctx?.rmItems.find((i) => i.id === ln.itemId);
                  const unit = ln.unit ?? item?.unit;
                  const avail = ln.available ?? null;
                  const noIssue = isMaterialIssueLineStockBlocked(1, avail);
                  return (
                    <div
                      key={ln.key}
                      className="grid min-w-0 gap-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(6rem,.5fr)_minmax(8rem,.6fr)_auto] sm:items-end"
                    >
                      <label className="min-w-0 text-xs font-medium text-slate-600">
                        RM Item
                        <select
                          className="erp-select mt-1 w-full min-w-0"
                          value={ln.itemId === "" ? "" : String(ln.itemId)}
                          onChange={(event) =>
                            onLineItemChange(ln.key, event.target.value ? Number(event.target.value) : "")
                          }
                          disabled={!fromLocationId || loading}
                        >
                          <option value="">Select RM…</option>
                          {ctx?.rmItems.map((rm) => (
                            <option key={rm.id} value={rm.id}>
                              {rm.itemName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="text-right text-sm tabular-nums">
                        <span className="block text-xs font-medium text-slate-600">Available</span>
                        {ln.loadingAvailable ? "…" : avail != null ? fmtQty(avail, unit) : "—"}
                      </div>
                      <label className="min-w-0 text-xs font-medium text-slate-600">
                        Issue Now
                        <DecimalInput
                          className="mt-1 h-9 min-w-0 text-right tabular-nums"
                          value={ln.issueQty}
                          unit={unit}
                          onValueChange={(next) =>
                            setLines((prev) =>
                              prev.map((row) =>
                                row.key === ln.key ? { ...row, issueQty: next, issueQtyTouched: true } : row,
                              ),
                            )
                          }
                          disabled={!ln.itemId || noIssue}
                          aria-label={`Issue Now for ${item?.itemName ?? "RM item"}`}
                        />
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => removeLine(ln.key)}
                        disabled={lines.length <= 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {showPartialAutofillHint && woPmrMode ? (
              <p className="mt-1 shrink-0 text-[11px] text-slate-600">
                Issue now is pre-filled as the minimum of pending and available stock.
              </p>
            ) : null}

            {showNoRmAvailableWarning ? (
              <div className="mt-1 shrink-0 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-sm text-amber-950">
                <p className="font-bold">No RM available for issue</p>
                <p className="mt-0.5 text-xs leading-relaxed text-amber-900">
                  {issueDecision?.blockerReason ??
                    (waitingProcurement
                      ? "Waiting for stock — issue can start once GRN is received."
                      : "Stock is committed elsewhere or not yet received.")}
                </p>
                {resolvedWorkOrderIdForHint ? (
                  <Link
                    to={buildRmControlCenterHref({
                      workOrderId: resolvedWorkOrderIdForHint,
                      returnTo: "material-issue",
                    })}
                    className="mt-1 inline-block text-[11px] font-bold text-violet-900 underline"
                  >
                    Open RM Control Center
                  </Link>
                ) : null}
              </div>
            ) : null}

            {woPmrMode &&
            issueDecision &&
            (issueDecision.totalIssued > 0 ||
              issueDecision.showPartialDecisionPanel ||
              (issueDecision.totalShortIssueQty ?? issueDecision.totalWaived) > 1e-6) ? (
              <section
                className="mt-1.5 shrink-0 rounded border border-violet-200 bg-violet-50/80 px-2.5 py-2"
                data-testid="material-issue-decision-panel"
              >
                <h3 className="text-[11px] font-bold text-violet-950">Material issue status</h3>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-violet-950">
                  <span>
                    <span className="font-semibold">Required:</span>{" "}
                    {fmtQty(issueDecision.totalOriginalRequired ?? issueDecision.totalRequired)}
                  </span>
                  <span>
                    <span className="font-semibold">Issued:</span> {fmtQty(issueDecision.totalIssued)}
                  </span>
                  {(issueDecision.totalShortIssueQty ?? issueDecision.totalWaived) > 1e-6 ? (
                    <span data-testid="material-issue-short-issue-qty">
                      <span className="font-semibold">Short Issue:</span>{" "}
                      {fmtQty(issueDecision.totalShortIssueQty ?? issueDecision.totalWaived)}
                    </span>
                  ) : (
                    <span>
                      <span className="font-semibold">Remaining:</span> {fmtQty(issueDecision.totalRemaining)}
                    </span>
                  )}
                </div>
                {issueDecision.releaseBlockedByUnissuedBom ? (
                  <div
                    className="mt-1 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-950"
                    data-testid="material-issue-release-blocked-warning"
                  >
                    <p className="font-bold">Production cannot be released — unissued BOM materials remain.</p>
                  </div>
                ) : null}
                {issueDecision.showPartialDecisionPanel ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-[11px]"
                      disabled={submitting}
                      onClick={() => void handleIssueLater()}
                    >
                      Issue Remaining Later
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-[11px]"
                      disabled={submitting}
                      onClick={() => setShowWaiveForm((v) => !v)}
                    >
                      Close Remaining as Short Issue
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
                  <div className="mt-1.5">
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
                  <div className="mt-1.5 space-y-1.5 rounded border border-violet-200 bg-white p-2">
                    <label className="erp-form-field block">
                      <span className="text-xs font-medium text-slate-600">Short Issue reason</span>
                      <select
                        className="erp-select mt-1 w-full"
                        value={waiveReason}
                        onChange={(e) => setWaiveReason(e.target.value)}
                      >
                        <option value="">Select reason…</option>
                        <option value="ROUNDING_TOLERANCE">Within rounding tolerance</option>
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
                      {waiveReason === "ROUNDING_TOLERANCE"
                        ? "Acknowledge rounding tolerance"
                        : "Confirm Short Issue close"}
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>

          <div
            className="mt-auto shrink-0 border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur-sm"
            data-testid="material-issue-action-bar"
          >
            {materialIssueActionSummary ? (
              <p
                className="mb-1.5 text-[11px] font-medium tabular-nums text-slate-700"
                data-testid="material-issue-action-summary"
              >
                {materialIssueActionSummary}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {!woPmrMode ? (
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add line
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                className="h-9 px-5 font-bold"
                disabled={primaryButtonDisabled}
                onClick={() => void onPrimaryActionClick()}
                data-testid="material-issue-primary-action"
              >
                <Send className="mr-1 h-4 w-4" />
                {woPmrMode ? primaryAction.label : "Issue Material"}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadAll()}>
                Refresh
              </Button>
              {woPmrMode && executionReady ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-600 underline"
                  onClick={clearExecution}
                >
                  Clear Selection
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex max-h-[calc(100dvh-5rem)] min-h-0 flex-col gap-2 overflow-y-auto lg:sticky lg:top-2">
          {woPmrMode ? (
            <MaterialIssuePmrQueuePanel
              pendingPmrs={actionablePendingPmrs}
              activePmrId={activePmrId}
              activeWorkOrderId={typeof workOrderId === "number" ? workOrderId : undefined}
              activeFilter={queueFilterFromUrl}
              onFilterChange={(key) => {
                const next = new URLSearchParams(searchParams);
                const bucket = materialIssueFilterKeyToBucket(key);
                next.set("bucket", bucket);
                next.delete("queue");
                // Changing queue manually clears pinned WO/PMR so list shows for that bucket.
                next.delete("pmrId");
                next.delete("workOrderId");
                if (returnTo) next.set("returnTo", returnTo);
                if (deepLink.fromPendingActions) next.set("from", "pending-actions");
                setSearchParams(next, { replace: true });
                setActivePmrId(null);
                setActivePmr(null);
                setIssueDecision(null);
                setLines([]);
                setWorkOrderId("");
              }}
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
