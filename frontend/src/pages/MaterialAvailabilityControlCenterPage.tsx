import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDownToLine, Boxes, Filter, PackageCheck, RefreshCw } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { MATERIAL_REQUISITION_WRITE_ROLES, RM_ALLOCATION_WRITE_ROLES, hasErpRole } from "../config/erpRoles";
import { cn } from "../lib/utils";
import { resolveGuidedWorkflow, type GuidedWorkflowResolution } from "../lib/rmGuidedWorkflow";
import { resolveRmOperationalContext } from "../lib/rmOperationalActions";
import { RmControlCenterCasePanel } from "../components/erp/RmControlCenterCasePanel";
import { RmControlCenterProcurementPanel } from "../components/erp/RmControlCenterProcurementPanel";
import { ErpModal } from "../components/erp/ErpModal";
import { buildProcurementWorkspaceHref } from "../lib/woProcurementContinuity";
import { buildRmPoDetailHref } from "../lib/rmPurchaseWoContinuity";
import { buildProductionScopedHref } from "../lib/productionNavigation";
import { woPreparePrepareHref } from "../lib/woPrepareOperationalStage";
import { buttonVariants } from "../components/ui/button";
import { noQtyRsExecutionWorkspaceHref } from "../lib/noQtyRsActionLabels";
import {
  NO_QTY_PLANNING_HUB_HREF,
  noQtyPlanningHubOrAgreementsHref,
} from "../lib/noQtyStoreNavigation";
import { NO_QTY_TERMS } from "../lib/flowTerminology";
import { presentOperationalError } from "../lib/operationalErrorPresentation";
import {
  isPostIssueStoreHandoff,
  STORE_HANDOFF_ACTION_LABEL,
  STORE_HANDOFF_COMPLETE_LABEL,
  STORE_HANDOFF_NO_ACTION_LABEL,
  STORE_HANDOFF_STATUS_LABEL,
  STORE_PRODUCTION_HANDOFF_LABEL,
} from "../lib/rmControlCenterPostIssueHandoff";
import { formatRmQty } from "../lib/rmQtyDisplay";
import { buildPurchaseRequestPayloadFromWoMr } from "../lib/purchaseRequestFromMr";
import {
  prefersProcurementWorkspaceNavigation,
  resolveCaseProcurementMr,
} from "../lib/rmControlCenterProcurementHandoff";
import { PROCUREMENT_TERMS } from "../lib/procurementTerminology";
import {
  deriveProcurementChip,
  deriveProcurementWarnings,
  formatProcurementDemandSourceLabel,
  formatProcurementExecutionWoLabel,
  lineCoveragePercent,
  procurementSourceLabel,
  procurementTimelineStepIndex,
  storeMayCreatePurchaseRequest,
} from "../lib/rmControlCenterProcurementVisibility";
import {
  buildCaseRmMetricsFromDetails,
  caseHasPhysicalButNoFreeStock,
  caseHasZeroAllocatableStock,
  groupRmQueueByCase,
  operatorNextActionHint,
  operatorQueueStatus,
  operatorStageLabel,
  resolveQueueCaseDisplayMetrics,
  sanitizeStoreOperatorCopy,
} from "../lib/storeRmWorkspaceUx";

type WarningRow = { code: string; message: string };
type ReservationBreakdownRow = {
  sourceType: "PMR" | "ALLOCATION" | string;
  reservationType?: string | null;
  allocationNo?: string | null;
  pmrId?: number | null;
  pmrDocNo?: string | null;
  pmrStatus?: string | null;
  workOrderId?: number | null;
  workOrderNo?: string | null;
  requiredQty?: number;
  allocatedQty?: number;
  issuedQty?: number;
  reservedQty: number;
  allocationStatus?: string | null;
};

type QueueRow = {
  queueType: string;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  workOrderId: number | null;
  workOrderNo: string | null;
  materialRequirementId?: number | null;
  customerName: string | null;
  fgItemName: string | null;
  rmItemId: number;
  rmItemName: string;
  unit?: string;
  requiredQty: number;
  freeStockQty: number;
  physicalUsableStockQty: number;
  activeAllocatedQty?: number;
  legacyReservedQty: number;
  effectiveReservedQty?: number;
  incomingQty: number;
  shortageAfterReservationQty: number;
  netShortageAfterIncomingQty: number;
  allocationCoverageQty?: number;
  allocationShortageQty?: number;
  allocationStatus?: string;
  reservationBreakdown?: ReservationBreakdownRow[];
  blockerReason: string;
  recommendedAction: string;
  priorityRank: number;
  rmPendingCount?: number;
  requisitionStatus?: string | null;
  requisitionDocNo?: string | null;
  procurementStatus?: string | null;
  poStatus?: string | null;
  grnReceivedPercent?: number;
  nextOwner?: string | null;
  nextAction?: string | null;
};

type RmLine = {
  rmItemId: number;
  rmItemName: string;
  unit: string;
  requiredQty: number;
  physicalUsableStockQty: number;
  activeAllocatedQty?: number;
  legacyReservedQty: number;
  effectiveReservedQty?: number;
  freeStockQty: number;
  incomingQty: number;
  issuedToProductionQty: number;
  shortageNowQty: number;
  shortageAfterReservationQty: number;
  coveredByIncomingQty: number;
  netShortageAfterIncomingQty: number;
  allocationCoverageQty?: number;
  allocationShortageQty?: number;
  allocationStatus?: string;
  reservationBreakdown?: ReservationBreakdownRow[];
  warnings: WarningRow[];
  blockerReason: string;
  recommendedAction: string;
};

type Detail = {
  salesOrder: {
    id: number;
    docNo: string | null;
    orderType?: string | null;
    internalStatus?: string | null;
    currentCycleId?: number | null;
  } | null;
  workOrder: {
    id: number | null;
    docNo: string | null;
    status: string | null;
    holdReason?: string | null;
    cycleId?: number | null;
  } | null;
  fgItem: { itemName: string | null } | null;
  customer: { name: string | null } | null;
  requirementDate: string | null;
  pmrStatus: {
    latestStatus: string | null;
    openPmrs: Array<{
      id: number;
      docNo: string | null;
      status: string;
      totalRequiredQty: number;
      totalIssuedQty: number;
      lines?: Array<{
        rmItemId: number;
        pendingQty: number;
      }>;
    }>;
  } | null;
  rmLines: RmLine[];
  blockerExplanation: string;
  woShortageCase?: WoShortageCase | null;
  caseSupplyPanel?: CaseSupplyPanel | null;
};

type WoShortageCase = {
  workOrderId: number | null;
  workOrderNo: string | null;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  salesOrderOrderType?: string | null;
  customerName: string;
  fgItemName: string;
  allocationFirstStatus?: { key: string; label: string; owner: string; nextAction: string } | null;
  materialRequirement: {
    id: number;
    docNo: string | null;
    status: string;
    sourceType: string;
    workOrderId: number | null;
    procurementSourceLabel?: string | null;
    lineCount: number;
    totalShortageQty: number;
    lines: Array<{
      id: number;
      rmItemId: number;
      rmItemName: string;
      unit: string;
      requiredQty: number;
      shortageQty: number;
      procuredQty: number;
    }>;
  } | null;
  terminalMaterialRequirement?: {
    id: number;
    docNo: string | null;
    status: string;
    closedAt?: string | null;
  } | null;
  requiresReopenConfirm?: boolean;
  shortageSummary: {
    rmLineCount: number;
    blockedLineCount: number;
    shortLineCount: number;
    issueableLineCount: number;
    totalRequiredQty: number;
    totalNetShortQty: number;
    totalShortAfterReservationQty: number;
  };
  pmrSummary: { openCount: number; waitingIssueCount: number; latestDocNo: string | null };
  escalationLifecycle: WoEscalationLifecycle;
  procurementStatusLabel: string;
  issueStatusLabel: string;
  nextStoreAction: WoStoreAction;
  rmLines: Array<{
    rmItemId: number;
    rmItemName: string;
    unit: string;
    requiredQty: number;
    freeStockQty: number;
    shortageAfterReservationQty: number;
    netShortageAfterIncomingQty: number;
    blockerReason: string;
    recommendedAction: string;
  }>;
};

type WoEscalationLifecycle = {
  state:
    | "NOT_ESCALATED"
    | "ESCALATION_PENDING"
    | "PARTIALLY_ESCALATED"
    | "PROCUREMENT_IN_PROGRESS"
    | "WAITING_GRN"
    | "PROCUREMENT_COMPLETED";
  label: string;
  headline: string;
  description: string;
  procurementInitiated: boolean;
  additionalRmLineCount: number;
  mrLineCountOnCase: number;
  materialRequirementDocNo: string | null;
};

type WoStoreAction = {
  key: string;
  label: string;
  description: string;
  secondaryStoreAction?: { key: string; label: string; description: string } | null;
};

type CaseSupplyPanel = SupplyPanel & {
  workOrderId: number | null;
  materialRequirementId: number | null;
  boundMaterialRequirement?: {
    id: number;
    docNo: string | null;
    status: string | null;
    sourceType: string | null;
  } | null;
  procurementChain?: {
    mrDocNo: string | null;
    prDocNos: string[];
    poDocNos: string[];
    grnDocNos: string[];
  } | null;
};

type SupplyPanel = {
  rmItemId: number | null;
  openMrLines: Array<{
    materialRequirementLineId: number;
    materialRequirementDocNo: string | null;
    sourceType: string | null;
    salesOrderNo: string | null;
    workOrderId?: number | null;
    workOrderNo?: string | null;
    requiredQty: number;
    shortageQty: number;
    procuredQty: number;
    procurementStatusLabel: string;
  }>;
  prLines: Array<{
    purchaseRequestLineId: number;
    purchaseRequestId?: number;
    purchaseRequestDocNo: string | null;
    status: string;
    netRequiredQty: number;
    orderedQty: number;
    pendingPoQty: number;
  }>;
  poLines: Array<{
    rmPoLineId: number;
    purchaseOrderId?: number;
    purchaseOrderNo: string | null;
    supplierName: string | null;
    orderedQty: number;
    receivedGrnQty: number;
    pendingGrnQty: number;
    expectedDate: string | null;
    status: string | null;
    procurementStatusLabel: string;
  }>;
  summary: {
    openMrCount: number;
    prLineCount: number;
    poLineCount: number;
    pendingGrnQty: number;
    receivedGrnQty: number;
    procurementCompletedForCase?: boolean;
    completedMrDocNo?: string | null;
  };
};

type WorkspacePayload = {
  actionQueue: QueueRow[];
  selectedDetail: Detail | null;
  selectedRmItemId?: number | null;
  selectedWoShortageCase?: WoShortageCase | null;
  caseSupplyPanel?: CaseSupplyPanel | null;
  details: Detail[];
  supplyPanel: SupplyPanel;
  summary: {
    queueCount: number;
    blockedCount: number;
    partialCount: number;
    pmrWaitingCount: number;
    incomingCoveredCount: number;
    approvalPendingCount?: number;
    purchaseWaitingCount?: number;
    waitingGrnCount?: number;
    partialReceivedCount?: number;
    readyIssueCount?: number;
    readyReleaseCount?: number;
  };
};

type QueueSelection = { workOrderId?: number | null; materialRequirementId?: number | null; rmItemId: number };

type ApiFilters = {
  salesOrderId: string;
  workOrderId: string;
  materialRequirementId: string;
  rmItemId: string;
  status: string;
  onlyBlocked: boolean;
};

type FilterDraft = {
  salesOrderQuery: string;
  workOrderQuery: string;
  rmItemQuery: string;
  status: string;
  onlyBlocked: boolean;
};

const EMPTY_API_FILTERS: ApiFilters = {
  salesOrderId: "",
  workOrderId: "",
  materialRequirementId: "",
  rmItemId: "",
  status: "",
  onlyBlocked: false,
};

const EMPTY_FILTER_DRAFT: FilterDraft = {
  salesOrderQuery: "",
  workOrderQuery: "",
  rmItemQuery: "",
  status: "",
  onlyBlocked: false,
};

const PURCHASE_VISIBLE_MR_STATUSES = new Set([
  "APPROVED",
  "SENT_TO_PURCHASE",
  "PROCUREMENT_IN_PROGRESS",
  "PARTIALLY_PROCURED",
]);

function apiFiltersFromSearchParams(params: URLSearchParams): ApiFilters {
  return {
    salesOrderId: params.get("salesOrderId") ?? "",
    workOrderId: params.get("workOrderId") ?? "",
    materialRequirementId: params.get("materialRequirementId") ?? "",
    rmItemId: params.get("rmItemId") ?? "",
    status: params.get("status") ?? "",
    onlyBlocked: params.get("onlyBlocked") === "true",
  };
}

function normQuery(s: string): string {
  return s.trim().toLowerCase();
}

function draftLabelsFromQueue(api: ApiFilters, queue: QueueRow[]): FilterDraft {
  const soRow = api.salesOrderId
    ? queue.find((r) => r.salesOrderId != null && String(r.salesOrderId) === api.salesOrderId)
    : null;
  const woRow = api.workOrderId
    ? queue.find((r) => r.workOrderId != null && String(r.workOrderId) === api.workOrderId)
    : null;
  const rmRow = api.rmItemId ? queue.find((r) => String(r.rmItemId) === api.rmItemId) : null;
  return {
    salesOrderQuery: soRow?.salesOrderNo?.trim() || "",
    workOrderQuery: woRow?.workOrderNo?.trim() || "",
    rmItemQuery: rmRow?.rmItemName?.trim() || "",
    status: api.status,
    onlyBlocked: api.onlyBlocked,
  };
}

function resolveApiFiltersFromDraft(draft: FilterDraft, queue: QueueRow[]): ApiFilters {
  const matchRow = (predicate: (r: QueueRow) => boolean) => queue.find(predicate) ?? null;
  let salesOrderId = "";
  let workOrderId = "";
  let rmItemId = "";
  if (draft.salesOrderQuery.trim()) {
    const q = normQuery(draft.salesOrderQuery);
    const row = matchRow(
      (r) =>
        normQuery(r.salesOrderNo ?? "") === q ||
        normQuery(r.salesOrderNo ?? "").includes(q) ||
        normQuery(r.customerName ?? "").includes(q),
    );
    salesOrderId = row?.salesOrderId ? String(row.salesOrderId) : "";
  }
  if (draft.workOrderQuery.trim()) {
    const q = normQuery(draft.workOrderQuery);
    const row = matchRow(
      (r) => normQuery(r.workOrderNo ?? "") === q || normQuery(r.workOrderNo ?? "").includes(q),
    );
    workOrderId = row?.workOrderId ? String(row.workOrderId) : "";
  }
  if (draft.rmItemQuery.trim()) {
    const q = normQuery(draft.rmItemQuery);
    const row = matchRow(
      (r) => normQuery(r.rmItemName ?? "") === q || normQuery(r.rmItemName ?? "").includes(q),
    );
    rmItemId = row ? String(row.rmItemId) : "";
  }
  return {
    salesOrderId,
    workOrderId,
    materialRequirementId: "",
    rmItemId,
    status: draft.status,
    onlyBlocked: draft.onlyBlocked,
  };
}

function fmtQty(value: number | null | undefined, unit?: string | null): string {
  return formatRmQty(value, unit);
}

// Phase E: keep queue types internal; operator UI uses simple Ready/Partial/Shortage labels.

function readinessFromDetail(detail: Detail | null): { label: string; variant: "default" | "success" | "warning" | "info" | "rejected" } {
  if (!detail) return { label: "SELECT WO", variant: "default" };
  const lines = detail.rmLines || [];
  if (lines.some((l) => l.blockerReason === "PMR waiting for store issue")) return { label: "WAITING_ISSUE", variant: "warning" };
  if (lines.some((l) => l.netShortageAfterIncomingQty > 0)) return { label: "BLOCKED", variant: "rejected" };
  if (lines.some((l) => l.shortageAfterReservationQty > 0 && l.coveredByIncomingQty > 0)) return { label: "WAITING_GRN", variant: "info" };
  if (lines.some((l) => l.shortageAfterReservationQty > 0)) return { label: "PARTIAL", variant: "warning" };
  return { label: "READY", variant: "success" };
}

function buildQuery(filters: ApiFilters): string {
  const q = new URLSearchParams();
  if (filters.salesOrderId.trim()) q.set("salesOrderId", filters.salesOrderId.trim());
  if (filters.workOrderId.trim()) q.set("workOrderId", filters.workOrderId.trim());
  if (filters.materialRequirementId.trim()) q.set("materialRequirementId", filters.materialRequirementId.trim());
  if (filters.rmItemId.trim()) q.set("rmItemId", filters.rmItemId.trim());
  if (filters.status) q.set("status", filters.status);
  if (filters.onlyBlocked) q.set("onlyBlocked", "true");
  const s = q.toString();
  return s ? `?${s}` : "";
}

type BlockerRowLike = Pick<
  QueueRow,
  | "rmItemName"
  | "physicalUsableStockQty"
  | "legacyReservedQty"
  | "effectiveReservedQty"
  | "freeStockQty"
  | "shortageAfterReservationQty"
  | "blockerReason"
>;

function plainBlockerSummary(row: BlockerRowLike): string {
  const physical = Number(row.physicalUsableStockQty ?? 0);
  const free = Number(row.freeStockQty ?? 0);
  const name = row.rmItemName || "This RM";

  if (physical > 0 && free <= 0) {
    return `${name}: available stock is already committed to other work orders.`;
  }
  if (row.blockerReason === "PMR waiting for store issue" && free > 0) {
    return `${name}: waiting for store to issue available stock to production.`;
  }
  return row.blockerReason;
}

function detailedBlockerExplanation(line: RmLine): string {
  const physical = Number(line.physicalUsableStockQty ?? 0);
  const free = Number(line.freeStockQty ?? 0);
  const name = line.rmItemName || "This RM";

  if (physical > 0 && free <= 0) {
    return `${name}: ${fmtQty(physical, line.unit)} physical in store, but ${fmtQty(free, line.unit)} available for this work order. Stock is committed elsewhere — see the commitment list above.`;
  }
  if (line.blockerReason === "PMR waiting for store issue" && free > 0) {
    return `${name} has available stock (${fmtQty(free, line.unit)}). Store can issue to production when ready.`;
  }
  if (line.blockerReason === "PMR waiting for store issue") {
    return `${name} is waiting for store issue. ${plainBlockerSummary(line)}`;
  }
  return plainBlockerSummary(line);
}

export function MaterialAvailabilityControlCenterPage() {
  const { showSuccess, showError } = useToast();
  const { flags } = useFeatureFlags();
  const planningDrivenProcurement = flags.planningDrivenProcurement;
  const { user } = useAuth();
  const role = user?.role ?? "";
  const canAllocateAsStore = (RM_ALLOCATION_WRITE_ROLES as readonly string[]).includes(role);
  const canCreatePurchaseRequest = hasErpRole(role, MATERIAL_REQUISITION_WRITE_ROLES);
  const canRaiseProcurementShortageMr = canCreatePurchaseRequest;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialApiFilters = React.useMemo(() => apiFiltersFromSearchParams(searchParams), [searchParams]);
  const returnTo = searchParams.get("returnTo");
  const [filters, setFilters] = React.useState<ApiFilters>(initialApiFilters);
  const [draftFilters, setDraftFilters] = React.useState<FilterDraft>(EMPTY_FILTER_DRAFT);
  const rmUnitByItemIdRef = React.useRef(new Map<number, string>());
  const [data, setData] = React.useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedRmItemId, setSelectedRmItemId] = React.useState<number | null>(null);
  const [selectedQueueKey, setSelectedQueueKey] = React.useState<QueueSelection | null>(null);
  const [creatingShortageMr, setCreatingShortageMr] = React.useState(false);
  const [creatingPurchaseRequest, setCreatingPurchaseRequest] = React.useState(false);
  const [allocating, setAllocating] = React.useState(false);
  const [releasing, setReleasing] = React.useState(false);
  const [allocationQtyDraft, setAllocationQtyDraft] = React.useState("");
  const [allocationNoteDraft, setAllocationNoteDraft] = React.useState("");
  const [releaseQtyDraft, setReleaseQtyDraft] = React.useState("");
  const [releaseReasonDraft, setReleaseReasonDraft] = React.useState("");
  const [reopenModalOpen, setReopenModalOpen] = React.useState(false);
  const reopenConfirmPendingRef = React.useRef(false);
  const autoSelectPending = React.useRef(
    !initialApiFilters.workOrderId && !initialApiFilters.materialRequirementId && !initialApiFilters.rmItemId,
  );

  const load = React.useCallback(async (nextFilters: ApiFilters) => {
    setLoading(true);
    setError(null);
    try {
      let effectiveFilters = nextFilters;
      let payload = await apiFetch<WorkspacePayload>(
        `/api/material-availability/workspace${buildQuery(effectiveFilters)}`,
      );

      const woFromFilter = effectiveFilters.workOrderId ? Number(effectiveFilters.workOrderId) : null;
      const woId = woFromFilter != null && Number.isFinite(woFromFilter) && woFromFilter > 0 ? woFromFilter : null;
      if (woId && !payload.selectedDetail && effectiveFilters.onlyBlocked) {
        effectiveFilters = { ...effectiveFilters, onlyBlocked: false };
        payload = await apiFetch<WorkspacePayload>(
          `/api/material-availability/workspace${buildQuery(effectiveFilters)}`,
        );
        if (effectiveFilters.onlyBlocked !== nextFilters.onlyBlocked) {
          setFilters(effectiveFilters);
        }
      }

      setData(payload);
      const rmFromFilter = effectiveFilters.rmItemId ? Number(effectiveFilters.rmItemId) : null;
      const validFilterRm = rmFromFilter != null && Number.isFinite(rmFromFilter) && rmFromFilter > 0 ? rmFromFilter : null;
      const mrFromFilter = effectiveFilters.materialRequirementId ? Number(effectiveFilters.materialRequirementId) : null;
      const mrId = mrFromFilter != null && Number.isFinite(mrFromFilter) && mrFromFilter > 0 ? mrFromFilter : null;
      const queueForWo = woId
        ? payload.actionQueue.find((r) => r.workOrderId === woId) ?? payload.actionQueue[0]
        : mrId
          ? payload.actionQueue.find((r) => r.materialRequirementId === mrId) ?? payload.actionQueue[0]
          : payload.actionQueue[0];
      const resolvedRm =
        validFilterRm ??
        queueForWo?.rmItemId ??
        payload.selectedRmItemId ??
        payload.selectedDetail?.rmLines?.find((l) => l.shortageAfterReservationQty > 0)?.rmItemId ??
        payload.selectedDetail?.rmLines?.[0]?.rmItemId ??
        null;
      setSelectedRmItemId(resolvedRm);
      const queueWoId = woId ?? queueForWo?.workOrderId ?? payload.selectedDetail?.workOrder?.id ?? null;
      if (queueWoId && resolvedRm) {
        setSelectedQueueKey({ workOrderId: queueWoId, rmItemId: resolvedRm });
      } else if ((mrId || queueForWo?.materialRequirementId) && resolvedRm) {
        setSelectedQueueKey({ materialRequirementId: mrId ?? queueForWo?.materialRequirementId, rmItemId: resolvedRm });
      } else if (queueForWo?.workOrderId && queueForWo.rmItemId) {
        setSelectedQueueKey({
          workOrderId: queueForWo.workOrderId,
          rmItemId: queueForWo.rmItemId,
        });
      }

      const hasCaseFilter =
        Boolean(effectiveFilters.workOrderId && Number(effectiveFilters.workOrderId) > 0) ||
        Boolean(
          effectiveFilters.materialRequirementId && Number(effectiveFilters.materialRequirementId) > 0,
        );
      if (
        autoSelectPending.current &&
        !hasCaseFilter &&
        payload.actionQueue.length > 0 &&
        !payload.selectedDetail
      ) {
        autoSelectPending.current = false;
        const first = payload.actionQueue[0];
        const autoFilters: ApiFilters = {
          ...effectiveFilters,
          salesOrderId: first.salesOrderId ? String(first.salesOrderId) : "",
          workOrderId: first.workOrderId ? String(first.workOrderId) : "",
          materialRequirementId: first.materialRequirementId ? String(first.materialRequirementId) : "",
          rmItemId: String(first.rmItemId),
          status: "",
        };
        setDraftFilters(draftLabelsFromQueue(autoFilters, payload.actionQueue));
        setFilters(autoFilters);
        setLoading(false);
        return;
      }
    } catch (e) {
      setData(null);
      setError(presentOperationalError(e).userMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load(filters);
  }, [filters, load]);

  React.useEffect(() => {
    if (!data?.actionQueue.length) return;
    setDraftFilters((prev) => {
      const fromQueue = draftLabelsFromQueue(filters, data.actionQueue);
      return {
        salesOrderQuery: prev.salesOrderQuery || fromQueue.salesOrderQuery,
        workOrderQuery: prev.workOrderQuery || fromQueue.workOrderQuery,
        rmItemQuery: prev.rmItemQuery || fromQueue.rmItemQuery,
        status: filters.status || prev.status,
        onlyBlocked: filters.onlyBlocked,
      };
    });
  }, [data?.actionQueue, filters]);

  const detail = data?.selectedDetail ?? null;
  const woCase = data?.selectedWoShortageCase ?? detail?.woShortageCase ?? null;
  const caseSupply = data?.caseSupplyPanel ?? detail?.caseSupplyPanel ?? null;
  const escalation = woCase?.escalationLifecycle;
  const readiness = readinessFromDetail(detail);
  const selectedLine =
    detail?.rmLines.find((line) => line.rmItemId === selectedRmItemId) ?? detail?.rmLines[0] ?? null;
  const storeAction = woCase?.nextStoreAction;
  const hasWaitingPmr = Boolean(
    detail?.pmrStatus?.openPmrs?.some((p) => ["REQUESTED", "PARTIALLY_ISSUED"].includes(p.status)),
  );
  const anyIssueable = React.useMemo(() => {
    if (!detail || !hasWaitingPmr) return false;
    return detail.rmLines.some((line) => {
      const pending =
        detail.pmrStatus?.openPmrs
          ?.flatMap((p) => p.lines ?? [])
          .find((ln) => ln.rmItemId === line.rmItemId)?.pendingQty ?? 0;
      return pending > 0 && line.freeStockQty > 0;
    });
  }, [detail, hasWaitingPmr]);
  const requiresReopenConfirm = Boolean(woCase?.requiresReopenConfirm);
  const procurementCompletedForCase =
    escalation?.state === "PROCUREMENT_COMPLETED" ||
    Boolean(caseSupply?.summary?.procurementCompletedForCase) ||
    woCase?.materialRequirement?.status === "FULLY_PROCURED";
  const guided = React.useMemo(() => {
    if (!detail?.workOrder?.id) {
      return null;
    }
    return resolveGuidedWorkflow({
      storeActionKey: storeAction?.key ?? "REVIEW",
      escalation: escalation ?? null,
      caseSupply,
      rmLines: detail.rmLines ?? [],
      anyIssueable,
      hasWaitingPmr,
      workOrderId: detail.workOrder.id,
      salesOrderId: detail.salesOrder?.id ?? null,
      orderType: detail.salesOrder?.orderType ?? null,
      cycleId: detail.workOrder?.cycleId ?? detail.salesOrder?.currentCycleId ?? null,
      materialRequirementId: woCase?.materialRequirement?.id ?? null,
      rmItemId: selectedRmItemId,
      mrStatus: woCase?.materialRequirement?.status ?? null,
      requiresReopenConfirm,
      blockerExplanation: selectedLine ? detailedBlockerExplanation(selectedLine) : detail.blockerExplanation,
      primaryPoId: caseSupply?.poLines?.[0]?.purchaseOrderId ?? null,
    });
  }, [
    detail,
    escalation,
    caseSupply,
    anyIssueable,
    hasWaitingPmr,
    storeAction?.key,
    woCase?.materialRequirement?.id,
    woCase?.materialRequirement?.status,
    requiresReopenConfirm,
    selectedRmItemId,
    selectedLine,
  ]);

  const selectedQueueRow = React.useMemo(() => {
    const woId = detail?.workOrder?.id ?? null;
    const mrId =
      woCase?.materialRequirement?.id ??
      (caseSupply?.openMrLines?.find((ln) => ln.sourceType === "MONTHLY_PLAN")?.materialRequirementId ?? null) ??
      null;
    const soId = detail?.salesOrder?.id ?? woCase?.salesOrderId ?? null;
    if (!woId && !mrId && !soId) return null;
    const rmId = selectedRmItemId ?? detail?.rmLines[0]?.rmItemId;
    return (
      data?.actionQueue.find(
        (r) =>
          (woId ? r.workOrderId === woId : mrId ? r.materialRequirementId === mrId : r.salesOrderId === soId) &&
          r.rmItemId === rmId,
      ) ??
      data?.actionQueue.find((r) =>
        woId ? r.workOrderId === woId : mrId ? r.materialRequirementId === mrId : r.salesOrderId === soId,
      ) ??
      null
    );
  }, [data?.actionQueue, detail, selectedRmItemId, woCase?.materialRequirement?.id, woCase?.salesOrderId, caseSupply?.openMrLines]);

  const resolvedProcurementMr = React.useMemo(
    () =>
      resolveCaseProcurementMr({
        woCaseMr: woCase?.materialRequirement ?? null,
        boundMaterialRequirement: caseSupply?.boundMaterialRequirement ?? null,
        queueRowMrId: selectedQueueRow?.materialRequirementId ?? null,
        openMrLines: caseSupply?.openMrLines ?? [],
        workOrderId: detail?.workOrder?.id ?? null,
        planningDrivenProcurement,
      }),
    [
      woCase?.materialRequirement,
      caseSupply?.boundMaterialRequirement,
      selectedQueueRow?.materialRequirementId,
      caseSupply?.openMrLines,
      detail?.workOrder?.id,
      planningDrivenProcurement,
    ],
  );

  const readyToRelease = selectedQueueRow?.queueType === "READY_TO_RELEASE_WO";
  const postIssueHandoff = isPostIssueStoreHandoff({
    queueType: selectedQueueRow?.queueType,
    storeActionKey: storeAction?.key,
    allocationFirstKey: woCase?.allocationFirstStatus?.key,
  });
  const stockReadyForIssue = React.useMemo(() => {
    if (!detail?.workOrder?.id || !detail?.rmLines?.length || readyToRelease) return false;
    const waitingPmr = detail.pmrStatus?.openPmrs?.some((p) =>
      ["REQUESTED", "PARTIALLY_ISSUED"].includes(p.status),
    );
    if (waitingPmr) return false;
    return detail.rmLines.some(
      (line) =>
        line.blockerReason === "Ready for material issue" ||
        (line.freeStockQty + 1e-6 >= line.requiredQty && line.requiredQty > 0),
    );
  }, [detail, readyToRelease]);
  const notEscalated =
    (escalation?.state === "NOT_ESCALATED" || !woCase?.materialRequirement?.id) && !procurementCompletedForCase;

  const operational = React.useMemo(() => {
    if (!detail) return null;
    const mr = woCase?.materialRequirement;
    const primaryPoId = caseSupply?.poLines?.[0]?.purchaseOrderId ?? null;
    const workOrderId = detail.workOrder?.id ?? null;
    const salesOrderId = detail.salesOrder?.id ?? woCase?.salesOrderId ?? null;
    const grnHref =
      primaryPoId && primaryPoId > 0
        ? buildRmPoDetailHref(primaryPoId, { salesOrderId, from: "rm-purchase" })
        : "/rm-po-grn?focus=pending-requests";
    const issueHref = workOrderId ? `/material-issue?workOrderId=${workOrderId}&returnTo=rm-control-center` : "";
    const productionHref = workOrderId
      ? buildProductionScopedHref({
          workOrderId,
          salesOrderId: salesOrderId ?? undefined,
          orderType: detail.salesOrder?.orderType ?? null,
          cycleId: detail.workOrder?.cycleId ?? detail.salesOrder?.currentCycleId ?? undefined,
          from: "rm-control-center",
        })
      : "";
    const procurementWorkspaceHref = buildProcurementWorkspaceHref({
      workOrderId,
      salesOrderId,
      rmItemId: selectedRmItemId,
      materialRequirementId: resolvedProcurementMr?.materialRequirementId ?? mr?.id ?? null,
      sourceType: resolvedProcurementMr?.sourceType ?? mr?.sourceType ?? null,
      returnTo: "rm-control-center",
    });

    return resolveRmOperationalContext({
      workOrderLabel: detail.workOrder?.docNo ?? woCase?.workOrderNo ?? "WO not created",
      mrStatus: mr?.status ?? null,
      mrDocNo: mr?.docNo ?? escalation?.materialRequirementDocNo ?? null,
      mrId: mr?.id ?? null,
      prLineCount: caseSupply?.summary.prLineCount ?? 0,
      poLineCount: caseSupply?.summary.poLineCount ?? 0,
      pendingGrnQty: caseSupply?.summary.pendingGrnQty ?? 0,
      receivedGrnQty: caseSupply?.summary.receivedGrnQty ?? 0,
      anyIssueable,
      readyToRelease,
      hasWaitingPmr,
      notEscalated,
      requiresReopenConfirm,
      workOrderId,
      salesOrderId,
      rmItemId: selectedRmItemId,
      issueHref,
      productionHref,
      prepareWoHref: salesOrderId ? woPreparePrepareHref(salesOrderId) : null,
      grnHref,
      procurementWorkspaceHref,
      stockReadyForIssue,
      procurementCompletedForCase,
      queueType: selectedQueueRow?.queueType ?? null,
      requisitionStatus: selectedQueueRow?.requisitionStatus ?? null,
      procurementStatus: selectedQueueRow?.procurementStatus ?? woCase?.procurementStatusLabel ?? null,
      nextOwner: selectedQueueRow?.nextOwner ?? null,
      nextAction: selectedQueueRow?.nextAction ?? woCase?.nextStoreAction?.label ?? null,
    });
  }, [
    detail,
    woCase,
    caseSupply,
    anyIssueable,
    readyToRelease,
    hasWaitingPmr,
    notEscalated,
    requiresReopenConfirm,
    selectedQueueRow,
    escalation,
    selectedRmItemId,
    stockReadyForIssue,
    procurementCompletedForCase,
    resolvedProcurementMr,
  ]);

  const displayGuided = React.useMemo((): GuidedWorkflowResolution | null => {
    if (guided) {
      return {
        ...guided,
        phaseTitle: sanitizeStoreOperatorCopy(guided.phaseTitle),
        phaseDetail: sanitizeStoreOperatorCopy(guided.phaseDetail),
        statusHeadline: sanitizeStoreOperatorCopy(guided.statusHeadline),
      };
    }
    if (!detail || !operational) return null;
    const phaseDetail = sanitizeStoreOperatorCopy(
      selectedLine ? detailedBlockerExplanation(selectedLine) : detail.blockerExplanation ?? operational.nextAction,
    );
    const activeIdx = operational.traceSteps.findIndex((s) => s.state === "active");
    const title = operatorStageLabel({
      allocationFirstLabel: woCase?.allocationFirstStatus?.label,
      nextAction: operational.nextAction,
      hasWorkOrder: Boolean(detail.workOrder?.id),
      postIssueHandoff,
    });
    return {
      phase: "A_BLOCKED",
      phaseTitle: title,
      phaseDetail,
      ownerLabel: operational.owner,
      statusHeadline: title,
      primaryAction: { kind: "NONE", label: operational.nextAction },
      showMaterialIssueSection: Boolean(detail.workOrder?.id) && !postIssueHandoff,
      showProductionLink: false,
      timelineStepIndex: activeIdx >= 0 ? activeIdx : 0,
      hideProcurementExecutionNav: false,
    };
  }, [guided, detail, operational, selectedLine, woCase?.allocationFirstStatus?.label, postIssueHandoff]);

  const rmCaseLines = React.useMemo(() => {
    if (!detail) return [];
    const woId = detail.workOrder?.id;
    return detail.rmLines.map((line) => {
      if (line.unit) rmUnitByItemIdRef.current.set(line.rmItemId, line.unit);
      const q = data?.actionQueue.find(
        (r) => r.rmItemId === line.rmItemId && (woId == null || r.workOrderId === woId),
      );
      return {
        ...line,
        procurementStatus: postIssueHandoff ? null : q?.procurementStatus ?? woCase?.procurementStatusLabel ?? null,
        poStatus: postIssueHandoff ? null : q?.poStatus ?? null,
        grnReceivedPercent: postIssueHandoff ? null : q?.grnReceivedPercent ?? null,
        coveragePercent: postIssueHandoff
          ? null
          : lineCoveragePercent({
              requiredQty: line.requiredQty,
              shortageAfterReservationQty: line.shortageAfterReservationQty,
              coveredByIncomingQty: line.coveredByIncomingQty,
              grnReceivedPercent: q?.grnReceivedPercent ?? null,
            }),
      };
    });
  }, [detail, data?.actionQueue, woCase?.procurementStatusLabel, postIssueHandoff]);

  // Phase E: keep action queue operator-simple; RM units are shown in the center table.

  // Phase E: legacy requisition actions are hidden from operator workflow.

  const hasWorkOrder = Boolean(detail?.workOrder?.id);
  const zeroAllocatableStock = React.useMemo(
    () => caseHasZeroAllocatableStock(rmCaseLines),
    [rmCaseLines],
  );
  const physicalButNoFree = React.useMemo(
    () => caseHasPhysicalButNoFreeStock(rmCaseLines),
    [rmCaseLines],
  );

  const selectedLineAllocationContext = React.useMemo(() => {
    const line = selectedLine;
    if (!detail?.workOrder?.id || !line) return null;
    const required = Math.max(0, Number(line.requiredQty ?? 0));
    const issued = Math.max(0, Number(line.issuedToProductionQty ?? 0));
    const activeAllocated = Math.max(0, Number(line.activeAllocatedQty ?? 0));
    const free = Math.max(0, Number(line.freeStockQty ?? 0));
    const pendingNeed = Math.max(0, required - issued - activeAllocated);
    const suggested = Math.min(free, pendingNeed);
    return {
      workOrderId: detail.workOrder.id,
      rmItemId: line.rmItemId,
      rmItemName: line.rmItemName,
      unit: line.unit,
      free,
      required,
      issued,
      activeAllocated,
      pendingNeed,
      suggested,
    };
  }, [detail?.workOrder?.id, selectedLine]);

  const storeOperationalGuidance = React.useMemo(() => {
    if (!detail || postIssueHandoff) return null;
    if (zeroAllocatableStock) {
      return {
        headline: "No RM stock available",
        owner: "Store / Purchase",
        nextAction:
          "Arrange RM procurement or GRN before allocation and issue can continue.",
        variant: "zero_stock" as const,
      };
    }
    const anyShortage = rmCaseLines.some((l) => Number(l.shortageAfterReservationQty ?? 0) > 0);
    if (anyShortage) {
      return {
        headline: "RM shortage blocking production",
        owner: selectedQueueRow?.nextOwner ?? "Store Department",
        nextAction: physicalButNoFree
          ? "Stock exists but is committed elsewhere — release other allocations or arrange incoming RM."
          : sanitizeStoreOperatorCopy(
              selectedQueueRow?.nextAction ??
                woCase?.nextStoreAction?.description ??
                woCase?.nextStoreAction?.label,
            ) || "Track incoming RM and allocate when stock is received.",
        variant: "shortage" as const,
      };
    }
    return null;
  }, [detail, postIssueHandoff, zeroAllocatableStock, physicalButNoFree, rmCaseLines, selectedQueueRow, woCase?.nextStoreAction]);

  const canShowAllocationControls =
    hasWorkOrder && !postIssueHandoff && !zeroAllocatableStock && Boolean(selectedLineAllocationContext);

  // Continuity: shortage exists → Store raises one RM requirement → waiting for stock/purchase.
  const anyShortageOnCase = React.useMemo(
    () =>
      rmCaseLines.some(
        (l) =>
          Number(l.shortageAfterReservationQty ?? 0) > 0 ||
          Number((l as RmLine).netShortageAfterIncomingQty ?? 0) > 0,
      ),
    [rmCaseLines],
  );

  const procurementVisibility = React.useMemo(() => {
    if (postIssueHandoff || !detail || !operational) return null;
    const mr = woCase?.materialRequirement;
    const procMr = resolvedProcurementMr;
    const summary = caseSupply?.summary;
    const chip = deriveProcurementChip({
      anyShortage: anyShortageOnCase,
      hasMr: Boolean(procMr?.materialRequirementId ?? mr?.id),
      mrStatus: mr?.status ?? procMr?.status ?? null,
      prLineCount: summary?.prLineCount ?? 0,
      poLineCount: summary?.poLineCount ?? 0,
      pendingGrnQty: summary?.pendingGrnQty ?? 0,
      receivedGrnQty: summary?.receivedGrnQty ?? 0,
      procurementCompleted: procurementCompletedForCase,
      notEscalated,
    });
    const sourceType = procMr?.sourceType ?? mr?.sourceType ?? caseSupply?.openMrLines?.[0]?.sourceType ?? null;
    const demandSourceFallback =
      mr?.procurementSourceLabel?.trim() ||
      (sourceType === "SALES_ORDER"
        ? detail.salesOrder?.docNo ?? woCase?.salesOrderNo ?? null
        : null);
    const demandSourceLabel =
      formatProcurementDemandSourceLabel({
        sourceType,
        salesOrderDocNo: sourceType === "SALES_ORDER" ? demandSourceFallback : null,
        salesOrderId: sourceType === "SALES_ORDER" ? detail.salesOrder?.id ?? woCase?.salesOrderId ?? null : null,
        monthlyPlanLabel: sourceType === "MONTHLY_PLAN" ? demandSourceFallback : null,
        materialRequirementDocNo: procMr?.docNo ?? mr?.docNo ?? null,
      }) ?? procurementSourceLabel(sourceType, demandSourceFallback);
    const executionWoLabel = formatProcurementExecutionWoLabel({
      workOrderDocNo: detail.workOrder?.docNo ?? woCase?.workOrderNo ?? null,
      workOrderId: detail.workOrder?.id ?? null,
    });
    const lineWarnings = rmCaseLines.flatMap((l) => (l as RmLine).warnings ?? []);
    const incomingLineCount = rmCaseLines.filter((l) => Number(l.incomingQty ?? 0) > 0).length;
    const warnings = deriveProcurementWarnings({
      chip,
      sourceType,
      pendingGrnQty: summary?.pendingGrnQty ?? 0,
      incomingLineCount,
      lineWarnings,
    });
    const timelineStepIndex = procurementTimelineStepIndex({
      prLineCount: summary?.prLineCount ?? 0,
      poLineCount: summary?.poLineCount ?? 0,
      pendingGrnQty: summary?.pendingGrnQty ?? 0,
      receivedGrnQty: summary?.receivedGrnQty ?? 0,
      procurementCompleted: procurementCompletedForCase,
      hasMr: Boolean(mr?.id),
    });
    const primaryPoId = caseSupply?.poLines?.[0]?.purchaseOrderId ?? null;
    const grnHref =
      primaryPoId && primaryPoId > 0
        ? buildRmPoDetailHref(primaryPoId, {
            salesOrderId: detail.salesOrder?.id ?? woCase?.salesOrderId ?? undefined,
            from: "rm-purchase",
          })
        : "/rm-po-grn?focus=pending-requests";
    const procurementWorkspaceHref = buildProcurementWorkspaceHref({
      workOrderId: detail.workOrder?.id ?? null,
      salesOrderId: detail.salesOrder?.id ?? woCase?.salesOrderId ?? null,
      rmItemId: selectedRmItemId,
      materialRequirementId: procMr?.materialRequirementId ?? mr?.id ?? null,
      sourceType: procMr?.sourceType ?? mr?.sourceType ?? null,
      returnTo: "rm-control-center",
    });
    return {
      chip,
      anchorLabel: demandSourceLabel,
      demandSourceLabel,
      executionWoLabel,
      warnings,
      timelineStepIndex,
      grnHref,
      procurementWorkspaceHref,
      mrDocNo: procMr?.docNo ?? mr?.docNo ?? escalation?.materialRequirementDocNo ?? null,
      prLineCount: summary?.prLineCount ?? 0,
      poLineCount: summary?.poLineCount ?? 0,
      pendingGrnQty: summary?.pendingGrnQty ?? 0,
      receivedGrnQty: summary?.receivedGrnQty ?? 0,
    };
  }, [
    postIssueHandoff,
    detail,
    operational,
    woCase,
    caseSupply,
    anyShortageOnCase,
    procurementCompletedForCase,
    notEscalated,
    rmCaseLines,
    escalation?.materialRequirementDocNo,
    selectedRmItemId,
    resolvedProcurementMr,
  ]);

  const activeMaterialRequirement = woCase?.materialRequirement ?? null;
  const requirementStatus =
    resolvedProcurementMr?.status ??
    activeMaterialRequirement?.status ??
    selectedQueueRow?.requisitionStatus ??
    "";
  const requirementRaised =
    Boolean(resolvedProcurementMr?.materialRequirementId ?? activeMaterialRequirement?.id) &&
    (PURCHASE_VISIBLE_MR_STATUSES.has(String(requirementStatus)) ||
      (planningDrivenProcurement &&
        resolvedProcurementMr?.sourceType === "MONTHLY_PLAN" &&
        Boolean(resolvedProcurementMr?.materialRequirementId)));
  const requirementDocNo =
    requirementRaised ? resolvedProcurementMr?.docNo ?? activeMaterialRequirement?.docNo ?? null : null;
  const requirementProcurementHref = buildProcurementWorkspaceHref({
    workOrderId: detail?.workOrder?.id ?? null,
    salesOrderId: detail?.salesOrder?.id ?? woCase?.salesOrderId ?? null,
    materialRequirementId:
      requirementRaised ? resolvedProcurementMr?.materialRequirementId ?? activeMaterialRequirement?.id ?? null : null,
    sourceType: resolvedProcurementMr?.sourceType ?? activeMaterialRequirement?.sourceType ?? null,
    returnTo: "rm-control-center",
  });
  const requirementActionBlock =
    postIssueHandoff || !anyShortageOnCase ? null : requirementRaised ? (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-2">
        <p className="text-[12px] font-bold text-emerald-900">RM requirement raised</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-800">
          {requirementDocNo ? `${requirementDocNo} · ` : ""}Track PR → PO → GRN in Procurement Workspace.
        </p>
        <Link
          to={requirementProcurementHref}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "mt-2 h-8 w-full justify-center text-[12px] font-semibold no-underline",
          )}
        >
          Open Procurement Workspace
        </Link>
      </div>
    ) : (
      <div className="rounded-md border border-red-300 bg-red-50 px-2.5 py-2">
        <p className="text-[12px] font-bold text-red-900">RM shortage — requirement not raised</p>
        {planningDrivenProcurement ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-red-800">
            Procurement demand must be raised through Monthly Planning. This screen stays operational
            for allocation and material issue only.
          </p>
        ) : (
          <>
            <p className="mt-0.5 text-[11px] leading-relaxed text-red-800">
              Send this shortage to planning / purchase so procurement can begin. Material issue stays
              blocked until stock is received.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-2 h-9 w-full text-[13px] font-semibold"
              disabled={!canRaiseProcurementShortageMr || creatingShortageMr}
              onClick={() => void bulkAddWoShortageCaseLines()}
            >
              {creatingShortageMr ? "Raising…" : "Raise RM Requirement"}
            </Button>
          </>
        )}
      </div>
    );

  const operatorStageLabelText = operatorStageLabel({
    allocationFirstLabel: postIssueHandoff ? STORE_HANDOFF_STATUS_LABEL : anyIssueable ? woCase?.allocationFirstStatus?.label : null,
    guidedPhaseTitle: displayGuided?.phaseTitle ?? displayGuided?.statusHeadline,
    nextAction: postIssueHandoff ? STORE_HANDOFF_ACTION_LABEL : woCase?.nextStoreAction?.label,
    hasWorkOrder,
    postIssueHandoff,
  });

  async function allocateQty(qty: number, note?: string) {
    const ctx = selectedLineAllocationContext;
    if (!ctx || allocating) return;
    setAllocating(true);
    setError(null);
    try {
      await apiFetch("/api/material-availability/allocations/allocate", {
        method: "POST",
        body: JSON.stringify({
          workOrderId: ctx.workOrderId,
          rmItemId: ctx.rmItemId,
          qty,
          note: note?.trim() || undefined,
        }),
      });
      showSuccess("Allocation updated.");
      setAllocationQtyDraft("");
      setAllocationNoteDraft("");
      await load(filters);
    } catch (e) {
      const presented = presentOperationalError(e);
      setError(presented.userMessage);
      showError(presented.userMessage);
    } finally {
      setAllocating(false);
    }
  }

  async function releaseQty(qty: number, reason?: string) {
    const ctx = selectedLineAllocationContext;
    if (!ctx || releasing) return;
    setReleasing(true);
    setError(null);
    try {
      await apiFetch("/api/material-availability/allocations/release", {
        method: "POST",
        body: JSON.stringify({
          workOrderId: ctx.workOrderId,
          rmItemId: ctx.rmItemId,
          qty,
          reason: reason?.trim() || undefined,
        }),
      });
      showSuccess("Allocation released.");
      setReleaseQtyDraft("");
      setReleaseReasonDraft("");
      await load(filters);
    } catch (e) {
      const presented = presentOperationalError(e);
      setError(presented.userMessage);
      showError(presented.userMessage);
    } finally {
      setReleasing(false);
    }
  }

  async function confirmReopenAndRaise() {
    setReopenModalOpen(false);
    reopenConfirmPendingRef.current = true;
    await bulkAddWoShortageCaseLines(true);
    reopenConfirmPendingRef.current = false;
  }

  async function handleCreatePurchaseRequestFromCase() {
    if (creatingPurchaseRequest || !canCreatePurchaseRequest) return;

    const procMr = resolvedProcurementMr;
    if (
      prefersProcurementWorkspaceNavigation(procMr, {
        planningDrivenProcurement,
        woCaseMrId: woCase?.materialRequirement?.id ?? null,
      })
    ) {
      if (!procMr?.materialRequirementId) {
        showError(
          "Cannot open Procurement Workspace — monthly planning material requirement was not found for this work order.",
        );
        return;
      }
      navigate(
        buildProcurementWorkspaceHref({
          materialRequirementId: procMr.materialRequirementId,
          sourceType: procMr.sourceType,
          workOrderId: detail?.workOrder?.id ?? null,
          salesOrderId: detail?.salesOrder?.id ?? woCase?.salesOrderId ?? null,
          rmItemId: selectedRmItemId,
          returnTo: "rm-control-center",
        }),
      );
      return;
    }

    const mr = woCase?.materialRequirement;
    if (!mr?.id) {
      showError("Cannot create purchase request — material requirement was not found for this case.");
      return;
    }
    const payload = buildPurchaseRequestPayloadFromWoMr(mr);
    if (!payload) {
      showError("No RM lines are eligible for a purchase request on this case.");
      return;
    }
    setCreatingPurchaseRequest(true);
    setError(null);
    try {
      await apiFetch("/api/procurement-planning/send-requirement", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showSuccess(PROCUREMENT_TERMS.PR_CREATE_SUCCESS);
      await load(filters);
    } catch (e) {
      const presented = presentOperationalError(e);
      setError(presented.userMessage);
      showError(presented.userMessage);
    } finally {
      setCreatingPurchaseRequest(false);
    }
  }

  function selectQueueRow(row: QueueRow) {
    const next: ApiFilters = {
      ...filters,
      salesOrderId: row.salesOrderId ? String(row.salesOrderId) : "",
      workOrderId: row.workOrderId ? String(row.workOrderId) : "",
      materialRequirementId: row.materialRequirementId ? String(row.materialRequirementId) : "",
      rmItemId: row.rmItemId ? String(row.rmItemId) : "",
      status: "",
    };
    setDraftFilters({
      salesOrderQuery: row.salesOrderNo?.trim() || "",
      workOrderQuery: row.workOrderNo?.trim() || "",
      rmItemQuery: row.rmItemName?.trim() || "",
      status: "",
      onlyBlocked: filters.onlyBlocked,
    });
    setFilters(next);
    setSelectedRmItemId(row.rmItemId);
    if (row.workOrderId) {
      setSelectedQueueKey({ workOrderId: row.workOrderId, rmItemId: row.rmItemId });
    } else if (row.materialRequirementId) {
      setSelectedQueueKey({ materialRequirementId: row.materialRequirementId, rmItemId: row.rmItemId });
    }
  }

  function selectRmLine(line: RmLine) {
    setSelectedRmItemId(line.rmItemId);
    if (detail?.workOrder?.id) {
      setSelectedQueueKey({ workOrderId: detail.workOrder.id, rmItemId: line.rmItemId });
    } else if (woCase?.materialRequirement?.id) {
      setSelectedQueueKey({ materialRequirementId: woCase.materialRequirement.id, rmItemId: line.rmItemId });
    }
  }

  // One card per work order (else material requirement), with its RM lines rolled up —
  // the RM line detail and WO-level next action live in the panels on the right.
  const queueCases = React.useMemo(
    () => groupRmQueueByCase<QueueRow>(data?.actionQueue ?? []),
    [data?.actionQueue],
  );

  const caseRmMetricsByKey = React.useMemo(
    () => buildCaseRmMetricsFromDetails(data?.details ?? []),
    [data?.details],
  );

  const activeRmItemFilterLabel = React.useMemo(() => {
    if (!filters.rmItemId.trim() || !detail) return null;
    return (
      draftFilters.rmItemQuery.trim() ||
      data?.actionQueue.find((row) => String(row.rmItemId) === filters.rmItemId.trim())?.rmItemName?.trim() ||
      selectedLine?.rmItemName?.trim() ||
      null
    );
  }, [filters.rmItemId, detail, draftFilters.rmItemQuery, data?.actionQueue, selectedLine?.rmItemName]);

  function isQueueCaseSelected(group: { workOrderId: number | null; materialRequirementId: number | null }): boolean {
    if (group.workOrderId != null) return selectedQueueKey?.workOrderId === group.workOrderId;
    if (group.materialRequirementId != null) {
      return selectedQueueKey?.materialRequirementId === group.materialRequirementId;
    }
    return false;
  }

  // const summary = data?.summary; // hidden KPIs (Phase E)

  function applyFilters() {
    const queue = data?.actionQueue ?? [];
    setFilters(resolveApiFiltersFromDraft(draftFilters, queue));
  }

  function clearFilters() {
    autoSelectPending.current = true;
    setDraftFilters(EMPTY_FILTER_DRAFT);
    setFilters(EMPTY_API_FILTERS);
  }

  async function bulkAddWoShortageCaseLines(forceReopenConfirm = false) {
    const workOrderId = detail?.workOrder?.id;
    const salesOrderId = detail?.salesOrder?.id ?? woCase?.salesOrderId ?? null;
    if (!workOrderId && !salesOrderId) {
      showError("Select a sales order or work order before updating the shortage case.");
      return;
    }
    const confirmReopenClosed = forceReopenConfirm || reopenConfirmPendingRef.current || requiresReopenConfirm;
    setCreatingShortageMr(true);
    try {
      if (!workOrderId && salesOrderId) {
        const doRaise = async (confirm: boolean) =>
          apiFetch<{
          materialRequirement?: { id: number; docNo?: string | null };
          message?: string;
          }>(`/api/sales-orders/${salesOrderId}/raise-material-requirement`, {
            method: "POST",
            body: JSON.stringify({ confirmReopenClosed: confirm }),
          });
        let out;
        try {
          out = await doRaise(confirmReopenClosed);
        } catch (e) {
          const presented = presentOperationalError(e);
          const code = (e as any)?.code ?? (e as any)?.responseJson?.code;
          if (code === "REOPEN_CONFIRM_REQUIRED") {
            setReopenModalOpen(true);
            return;
          }
          throw new Error(presented.userMessage);
        }
        showSuccess(`SO RM Requisition ${out.materialRequirement?.docNo || out.materialRequirement?.id || ""} raised.`);
        await load(filters);
        return;
      }
      const doBulk = async (confirm: boolean) =>
        apiFetch<{
        status?: string;
        message?: string;
        materialRequirement?: { id: number; docNo?: string | null };
        created?: boolean;
        linesAdded?: number;
        caseSummary?: {
          detectedShortLineCount?: number;
          linesAdded?: number;
          linesOnCaseAfter?: number;
        };
        escalation?: { woCaseAlreadyActive?: boolean; additionalLineAdded?: boolean };
        }>("/api/material-availability/production-shortage-mr/bulk", {
          method: "POST",
          body: JSON.stringify({
            workOrderId,
            confirmReopenClosed: confirm,
            remarks: `SO-linked case bulk add for ${detail?.workOrder?.docNo || `WO-${workOrderId}`} (execution WO).`,
          }),
        });
      let out;
      try {
        out = await doBulk(confirmReopenClosed);
      } catch (e) {
        const presented = presentOperationalError(e);
        const code = (e as any)?.code ?? (e as any)?.responseJson?.code;
        if (code === "REOPEN_CONFIRM_REQUIRED") {
          setReopenModalOpen(true);
          return;
        }
        throw new Error(presented.userMessage);
      }
      const mr = out.materialRequirement;
      const added = out.linesAdded ?? 0;
      if (out.status === "ALREADY_UP_TO_DATE") {
        showSuccess("SO-linked case already up to date");
      } else if (added > 0) {
        if (out.created) {
          showSuccess(`All detected shortage lines added to this WO RM Requisition — ${mr?.docNo || "requisition"} created.`);
        } else {
          showSuccess(`All detected shortage lines added to this case (${added} line${added === 1 ? "" : "s"}).`);
        }
      } else {
        showSuccess(out.message || "SO-linked case updated.");
      }
      await load(filters);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to update SO-linked case");
    } finally {
      setCreatingShortageMr(false);
    }
  }

  return (
    <div className="rm-cc-page">
      <header className="rm-cc-head">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="text-[20px] font-bold tracking-tight text-slate-900">RM Control Center</h1>
              {!detail || !operational ? (
                <Badge variant={readiness.variant} density="compact">
                  {readiness.label}
                </Badge>
              ) : null}
              {!canAllocateAsStore ? (
                <Badge variant="default" density="compact">
                  Read-only
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
              Operational RM availability, shortages, and procurement progress.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {returnTo === "dashboard" ? (
              <Link
                to="/dashboard"
                className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 no-underline hover:bg-slate-50"
              >
                Dashboard
              </Link>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void load(filters)} disabled={loading}>
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Phase E: hide KPI strip (procurement/requisition noise) */}

        <div className="mt-1.5 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          <label className="grid min-w-[7rem] gap-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Sales order
            <Input
              className="h-7 bg-white text-[12px]"
              value={draftFilters.salesOrderQuery}
              onChange={(e) => setDraftFilters((f) => ({ ...f, salesOrderQuery: e.target.value }))}
              placeholder="SO-26-0001"
            />
          </label>
          <label className="grid min-w-[7rem] gap-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Work order
            <Input
              className="h-7 bg-white text-[12px]"
              value={draftFilters.workOrderQuery}
              onChange={(e) => setDraftFilters((f) => ({ ...f, workOrderQuery: e.target.value }))}
              placeholder="WO number"
            />
          </label>
          <label className="grid min-w-[7rem] gap-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            RM item
            <Input
              className="h-7 bg-white text-[12px]"
              value={draftFilters.rmItemQuery}
              onChange={(e) => setDraftFilters((f) => ({ ...f, rmItemQuery: e.target.value }))}
              placeholder="Item name"
            />
          </label>
          <label className="grid min-w-[8.5rem] gap-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
            Status
            <select
              className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[12px] text-slate-900"
              value={draftFilters.status}
              onChange={(e) => setDraftFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="">All</option>
              <option value="APPROVAL_PENDING">Awaiting Store Approval</option>
              <option value="WAITING_PURCHASE">Awaiting PR</option>
              <option value="WAITING_GRN">GRN Pending</option>
              <option value="PARTIAL_RECEIVED">Partially Received</option>
              <option value="READY_ISSUE">RM Ready</option>
              <option value="READY_RELEASE">Ready to Release WO</option>
              <option value="BLOCKED">Blocked</option>
              <option value="PARTIAL">Partial</option>
              <option value="INCOMING">Incoming Covered</option>
              <option value="PMR_WAITING">PMR Waiting</option>
            </select>
          </label>
          <label className="mb-0.5 flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-slate-300"
              checked={draftFilters.onlyBlocked}
              onChange={(e) => setDraftFilters((f) => ({ ...f, onlyBlocked: e.target.checked }))}
            />
            Only blocked
          </label>
          <Button type="button" size="sm" className="mb-0.5 h-7 gap-1 px-2 text-[11px]" onClick={applyFilters}>
            <Filter className="h-3 w-3" />
            Apply
          </Button>
          <Button type="button" variant="outline" size="sm" className="mb-0.5 h-7 px-2 text-[11px]" onClick={clearFilters}>
            Clear
          </Button>
        </div>
      </header>

      {error ? (
        <div className="shrink-0 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-800">{error}</div>
      ) : null}

      <div className="rm-cc-grid">
        <section className="rm-cc-col flex min-w-0 flex-col overflow-hidden rounded-lg bg-slate-50/80 ring-1 ring-slate-200/90">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-white/90 px-2.5 py-1.5">
            <h2 className="text-[12px] font-bold uppercase tracking-wide text-slate-500">Work orders</h2>
            <Badge variant="default" density="compact">
              {queueCases.length}
            </Badge>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
            {loading ? (
              <div className="px-2 py-8 text-sm text-slate-500">Loading material queue...</div>
            ) : queueCases.length ? (
              queueCases.map((group) => {
                const row = group.representative;
                const displayMetrics = resolveQueueCaseDisplayMetrics(group, caseRmMetricsByKey);
                const groupPostIssue = isPostIssueStoreHandoff({ queueType: row.queueType });
                const qStatus = operatorQueueStatus(row);
                const nextHint = operatorNextActionHint(row);
                const selected = isQueueCaseSelected(group);
                return (
                <button
                  key={group.caseKey}
                  type="button"
                  className={cn(
                    "w-full rounded-lg p-2.5 text-left shadow-sm ring-1 transition hover:brightness-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                    qStatus.cardBgClass,
                    selected ? "ring-2 ring-blue-500" : qStatus.cardRingClass,
                  )}
                  onClick={() => selectQueueRow(row)}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <p className="min-w-0 flex-1 truncate text-[14px] font-bold text-slate-900">
                      {row.salesOrderNo ?? (row.salesOrderId ? `SO-${row.salesOrderId}` : "SO")}
                    </p>
                    <Badge variant={qStatus.badgeVariant} density="compact" className="shrink-0 text-[10px]">
                      {qStatus.label}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-[12px] font-semibold text-slate-800">
                    FG: {row.fgItemName ?? "—"}
                  </p>
                  {row.workOrderNo || row.workOrderId ? (
                    <p className="mt-0.5 truncate text-[11px] text-slate-600">
                      {row.workOrderNo ?? `WO-${row.workOrderId}`}
                    </p>
                  ) : null}
                  <p className="mt-1 truncate text-[12px] font-medium text-slate-800">
                    RM lines: {displayMetrics.rmLineCount}
                  </p>
                  {groupPostIssue ? (
                    <>
                      <p className="mt-1 text-[11px] font-semibold text-emerald-800">{STORE_HANDOFF_COMPLETE_LABEL}</p>
                      <p className="mt-0.5 text-[11px] font-medium text-emerald-900">{STORE_PRODUCTION_HANDOFF_LABEL}</p>
                      <p className="mt-0.5 text-[10px] text-slate-600">{STORE_HANDOFF_NO_ACTION_LABEL}</p>
                    </>
                  ) : (
                    <>
                      {displayMetrics.shortageLineCount > 0 ? (
                        <p className="mt-1 text-[11px] font-semibold tabular-nums text-red-800">
                          Shortage on {displayMetrics.shortageLineCount} of {displayMetrics.rmLineCount}{" "}
                          {displayMetrics.rmLineCount === 1 ? "line" : "lines"}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[10px] font-medium text-slate-600">Next: {nextHint}</p>
                    </>
                  )}
                </button>
              );
              })
            ) : (
              <div className="flex h-full min-h-[13rem] flex-col items-center justify-center px-4 text-center">
                <PackageCheck className="h-8 w-8 text-emerald-600" />
                <p className="mt-2 text-sm font-bold text-slate-900">No active RM issue case found</p>
                <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-600">
                  For NO_QTY monthly-plan demand, create WO from Requirement Sheet Execution Workspace first. RM Control
                  Center will show cases after WO / PMR is created.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    to={noQtyPlanningHubOrAgreementsHref(role)}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-xs")}
                  >
                    Open NO_QTY Execution
                  </Link>
                  <Link
                    to={NO_QTY_PLANNING_HUB_HREF}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-xs")}
                  >
                    {NO_QTY_TERMS.OPEN_REQUIREMENT_AND_CYCLE_PLANNING}
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rm-cc-col flex min-w-0 flex-col overflow-hidden rounded-lg bg-white ring-1 ring-slate-200/90">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
            {!detail || !operational ? (
              <div className="grid flex-1 place-items-center text-center">
                <div>
                  <Boxes className="mx-auto h-10 w-10 text-slate-400" />
                  <p className="mt-3 text-[15px] font-semibold text-slate-900">Select an RM queue row</p>
                  <p className="mt-1 text-[13px] text-slate-600">
                    Inspect requisition details, RM lines, and workflow stage here.
                  </p>
                </div>
              </div>
            ) : (
              <RmControlCenterCasePanel
                salesOrderLabel={detail.salesOrder?.docNo ?? woCase?.salesOrderNo}
                fgLabel={detail.fgItem?.itemName ?? woCase?.fgItemName}
                stageLabel={operatorStageLabelText}
                allocationFirstLabel={
                  postIssueHandoff ? STORE_HANDOFF_STATUS_LABEL : woCase?.allocationFirstStatus?.label ?? null
                }
                postIssueHandoff={postIssueHandoff}
                rmItemFilterLabel={activeRmItemFilterLabel}
                mrDocNo={woCase?.materialRequirement?.docNo ?? escalation?.materialRequirementDocNo}
                procurementChipLabel={postIssueHandoff ? null : procurementVisibility?.chip.label ?? null}
                procurementAnchorLabel={postIssueHandoff ? null : procurementVisibility?.anchorLabel ?? null}
                procurementExecutionWoLabel={postIssueHandoff ? null : procurementVisibility?.executionWoLabel ?? null}
                operationalGuidance={storeOperationalGuidance}
                rmLines={rmCaseLines}
                selectedRmItemId={selectedRmItemId}
                onSelectLine={(line) => selectRmLine(line as RmLine)}
                formatQty={fmtQty}
              />
            )}
          </div>
        </section>

        <section className="rm-cc-col rm-cc-actions flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-slate-50/80 ring-1 ring-slate-200/90">
          <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-2.5 py-1.5">
            <h2 className="text-[12px] font-bold uppercase tracking-wide text-slate-500">Next action</h2>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-2 pb-3">
            {!detail || !operational ? (
              <div className="grid flex-1 place-items-center text-center">
                <ArrowDownToLine className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-2 text-[13px] font-semibold text-slate-900">Select a case</p>
              </div>
            ) : postIssueHandoff ? (
              <div className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Store handoff complete</p>
                <p className="mt-2 text-[14px] font-semibold leading-snug text-emerald-900">
                  {STORE_PRODUCTION_HANDOFF_LABEL}
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-emerald-800">
                  {STORE_HANDOFF_NO_ACTION_LABEL}
                </p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-col gap-2">
                {procurementVisibility ? (
                  <RmControlCenterProcurementPanel
                    chip={procurementVisibility.chip}
                    anchorLabel={procurementVisibility.anchorLabel}
                    executionWoLabel={procurementVisibility.executionWoLabel}
                    mrDocNo={procurementVisibility.mrDocNo}
                    procurementChain={caseSupply?.procurementChain ?? null}
                    timelineStepIndex={procurementVisibility.timelineStepIndex}
                    prLineCount={procurementVisibility.prLineCount}
                    poLineCount={procurementVisibility.poLineCount}
                    pendingGrnQty={procurementVisibility.pendingGrnQty}
                    receivedGrnQty={procurementVisibility.receivedGrnQty}
                    warnings={procurementVisibility.warnings}
                    procurementWorkspaceHref={procurementVisibility.procurementWorkspaceHref}
                    grnHref={procurementVisibility.grnHref}
                    canCreatePurchaseRequest={storeMayCreatePurchaseRequest(
                      procurementVisibility.chip,
                      canCreatePurchaseRequest,
                      {
                        procurementCompleted: procurementCompletedForCase,
                        mrStatus:
                          resolvedProcurementMr?.status ??
                          woCase?.materialRequirement?.status ??
                          null,
                        receivedGrnQty: caseSupply?.summary?.receivedGrnQty ?? 0,
                      },
                    )}
                    creatingPr={creatingPurchaseRequest}
                    onCreatePurchaseRequest={() => void handleCreatePurchaseRequestFromCase()}
                  />
                ) : null}

                <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Primary operational action</p>
                  <p className="mt-0.5 text-[12px] font-semibold text-slate-900">
                    {postIssueHandoff ? STORE_HANDOFF_ACTION_LABEL : operatorStageLabelText}
                  </p>
                  <div className="mt-2 flex flex-col gap-2">
                    {woCase?.allocationFirstStatus?.key === "RM_RECEIVED" ? (
                      <Link
                        to={
                          detail.salesOrder?.orderType === "NO_QTY" || woCase?.salesOrderOrderType === "NO_QTY"
                            ? noQtyRsExecutionWorkspaceHref({
                                salesOrderId: detail.salesOrder?.id ?? woCase?.salesOrderId ?? 0,
                                cycleId: detail.salesOrder?.currentCycleId ?? null,
                                source: "rm_control_center",
                                from: "rm-control-center",
                              })
                            : detail.salesOrder?.id
                              ? woPreparePrepareHref(detail.salesOrder.id)
                              : woCase?.salesOrderId
                                ? woPreparePrepareHref(woCase.salesOrderId)
                                : "/production/prepare-wo"
                        }
                        className={cn(
                          buttonVariants({ size: "sm" }),
                          "h-9 w-full justify-center text-[13px] font-semibold no-underline",
                        )}
                      >
                        {detail.salesOrder?.orderType === "NO_QTY" || woCase?.salesOrderOrderType === "NO_QTY"
                          ? "Place WO"
                          : "Create Work Order"}
                      </Link>
                    ) : woCase?.allocationFirstStatus?.key === "READY_FOR_ISSUE" && anyIssueable ? (
                      <Link
                        to={detail.workOrder?.id ? `/material-issue?workOrderId=${detail.workOrder.id}&returnTo=rm-control-center` : "/material-issue"}
                        className={cn(
                          buttonVariants({ size: "sm" }),
                          "h-9 w-full justify-center text-[13px] font-semibold no-underline",
                        )}
                      >
                        Issue RM to Production
                      </Link>
                    ) : storeAction?.key === "WAIT_PO" ||
                      (Number(caseSupply?.summary?.prLineCount ?? 0) > 0 &&
                        Number(caseSupply?.summary?.poLineCount ?? 0) === 0 &&
                        !anyIssueable) ? (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] font-medium text-amber-950">
                        {PROCUREMENT_TERMS.WAITING_FOR_PURCHASE_RM_PO}
                      </p>
                    ) : storeAction?.key === "WAIT_GRN" ||
                      Number(caseSupply?.summary?.pendingGrnQty ?? 0) > 0 ||
                      Number(caseSupply?.summary?.poLineCount ?? 0) > 0 ? (
                      <Link
                        to={
                          caseSupply?.poLines?.[0]?.purchaseOrderId
                            ? buildRmPoDetailHref(caseSupply.poLines[0].purchaseOrderId, {
                                salesOrderId: detail.salesOrder?.id ?? woCase?.salesOrderId ?? undefined,
                                from: "rm-control-center",
                              })
                            : "/rm-po-grn?focus=pending-requests"
                        }
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "h-9 w-full justify-center text-[13px] font-semibold no-underline",
                        )}
                      >
                        {anyIssueable ? "Record GRN" : "Waiting for GRN"}
                      </Link>
                    ) : canShowAllocationControls ? (
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-9 w-full text-[13px] font-semibold"
                          disabled={
                            !canAllocateAsStore ||
                            allocating ||
                            !selectedLineAllocationContext ||
                            selectedLineAllocationContext.suggested <= 0
                          }
                          onClick={() => {
                            const ctx = selectedLineAllocationContext;
                            if (!ctx) return;
                            void allocateQty(ctx.suggested, allocationNoteDraft);
                          }}
                        >
                          Allocate suggested{" "}
                          {selectedLineAllocationContext
                            ? `(${fmtQty(selectedLineAllocationContext.suggested, selectedLineAllocationContext.unit)})`
                            : ""}
                        </Button>

                        <div className="flex gap-2">
                          <Input
                            value={allocationQtyDraft}
                            onChange={(e) => setAllocationQtyDraft(e.target.value)}
                            placeholder="Custom qty"
                            className="h-9"
                            inputMode="decimal"
                            disabled={!canAllocateAsStore || allocating || !selectedLineAllocationContext}
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-9 shrink-0 text-[13px] font-semibold"
                            disabled={!canAllocateAsStore || allocating || !selectedLineAllocationContext}
                            onClick={() => {
                              const q = Number(allocationQtyDraft);
                              if (!Number.isFinite(q) || q <= 0) {
                                showError("Enter a valid allocation qty.");
                                return;
                              }
                              void allocateQty(q, allocationNoteDraft);
                            }}
                          >
                            Allocate
                          </Button>
                        </div>

                        <Input
                          value={allocationNoteDraft}
                          onChange={(e) => setAllocationNoteDraft(e.target.value)}
                          placeholder="Note (optional)"
                          className="h-9"
                          disabled={!canAllocateAsStore || allocating || !selectedLineAllocationContext}
                        />

                        <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                          {selectedLineAllocationContext ? (
                            <>
                              <span className="font-semibold">{selectedLineAllocationContext.rmItemName}</span>
                              {` · Pending need: ${fmtQty(selectedLineAllocationContext.pendingNeed, selectedLineAllocationContext.unit)} · Free: ${fmtQty(selectedLineAllocationContext.free, selectedLineAllocationContext.unit)} · Allocated: ${fmtQty(selectedLineAllocationContext.activeAllocated, selectedLineAllocationContext.unit)}`}
                            </>
                          ) : (
                            "Select an RM line to allocate."
                          )}
                        </div>

                        {selectedLineAllocationContext && selectedLineAllocationContext.activeAllocated > 0 ? (
                          <div className="mt-1 flex flex-col gap-2">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Release allocation</p>
                            <div className="flex gap-2">
                              <Input
                                value={releaseQtyDraft}
                                onChange={(e) => setReleaseQtyDraft(e.target.value)}
                                placeholder="Release qty"
                                className="h-9"
                                inputMode="decimal"
                                disabled={!canAllocateAsStore || releasing}
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-9 shrink-0 text-[13px] font-semibold"
                                disabled={!canAllocateAsStore || releasing}
                                onClick={() => {
                                  const q = Number(releaseQtyDraft);
                                  if (!Number.isFinite(q) || q <= 0) {
                                    showError("Enter a valid release qty.");
                                    return;
                                  }
                                  void releaseQty(q, releaseReasonDraft);
                                }}
                              >
                                Release
                              </Button>
                            </div>
                            <Input
                              value={releaseReasonDraft}
                              onChange={(e) => setReleaseReasonDraft(e.target.value)}
                              placeholder="Reason (optional)"
                              className="h-9"
                              disabled={!canAllocateAsStore || releasing}
                            />
                          </div>
                        ) : null}
                        {requirementActionBlock}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {requirementActionBlock}
                        {!requirementActionBlock ? (
                          <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[12px] text-slate-700">
                            {!hasWorkOrder ? (
                              <p>Work order not linked to this case yet. Production is blocked until RM is issued after WO exists.</p>
                            ) : zeroAllocatableStock ? (
                              <p>Allocation will become available after RM stock is received.</p>
                            ) : (
                              <p>Select an RM line with available stock to allocate.</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                {/* Phase E: hide legacy requisition/procurement actions from operator workflow */}
              </div>
            )}
          </div>
        </section>
      </div>

      <ErpModal open={reopenModalOpen} onClose={() => setReopenModalOpen(false)} aria-labelledby="rm-reopen-modal-title">
        <div className="mx-auto w-full max-w-md rounded-lg bg-white p-5 shadow-xl ring-1 ring-slate-200">
          <h2 id="rm-reopen-modal-title" className="text-[16px] font-bold text-slate-900">
            Reopen / Raise New Requisition
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
            Previous requisition was closed. Creating a new requisition will restart procurement for the same shortage.
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setReopenModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={creatingShortageMr}
              onClick={() => void confirmReopenAndRaise()}
            >
              {creatingShortageMr ? "Raising…" : "Raise New Requisition"}
            </Button>
          </div>
        </div>
      </ErpModal>
    </div>
  );
}
