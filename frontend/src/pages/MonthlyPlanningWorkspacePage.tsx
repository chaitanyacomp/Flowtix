import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch, ApiRequestError } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { useAuth } from "../hooks/useAuth";
import {
  MONTHLY_PLANNING_PURCHASE_REVIEW_ROLES,
  MONTHLY_PLANNING_WRITE_ROLES,
} from "../config/erpRoles";
import {
  approvedPlanGuidanceMessage,
  canLoadRmPurchaseTabs,
  canShowAdditionalPlanEntry,
  formatPlanKindLabel,
  formatPlanStatusLabel,
  formatPurchasePlanningContextLabel,
  formatReleaseSuccessSummary,
  formatRmSnapshotContextLabel,
  historicalApprovedPlanBannerMessage,
  isHistoricalPlanDocument,
  isLegacyPlanDocument,
  isPlanEditable,
  LEGACY_PLAN_BADGE_LABEL,
  LEGACY_PLAN_INFO_TOOLTIP,
  LEGACY_REOPEN_DRAFT_PRODUCTION_GUIDANCE,
  LEGACY_REVISION_WORKFLOW_LABEL,
  PURCHASE_FROZEN_SNAPSHOT_SECTION,
  PURCHASE_LIVE_PROCUREMENT_SECTION,
  PURCHASE_LINE_TABLE_NOTE,
  RM_REQUIREMENT_SNAPSHOT_TAB_LABEL,
  RM_SNAPSHOT_BANNER,
  planStatusBadgeVariant,
  purchasePlanningOperationalStatus,
  purchasePlanningReductionMessage,
  productionPlanReadOnlyMessage,
  resolvePlanDisplayLabel,
  resolveWorkflowActionVisibility,
  rmPlanningEmptyTableMessage,
  rmPurchaseEmptyMessage,
  shouldShowPlanSelector,
  usesPlanDocumentProcurementUx,
  type MonthlyPlanKind,
  type MonthlyPlanStatus,
} from "../lib/monthlyPlanningWorkflowUx";
import { buildReportHref } from "../lib/rmPlanningVsReceivedReportUx";
import {
  formatPhysicalCoveragePct,
  formatPendingReceiptQtyDisplay,
  formatReceiptStatusLabel,
  lookupReceiptCoverageForLine,
  physicalReceiptCoverageBannerLine,
  physicalReceiptCoverageDetailMessage,
  RECEIPT_COVERAGE_STATUS_META,
} from "../lib/monthlyPlanningReceiptCoverageUx";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Badge } from "../components/ui/badge";
import { buildNoQtyGuidedHref } from "../lib/noQtyFlowState";
import { noQtySoListHref } from "../lib/noQtyRsActionLabels";
import { formatOperationalWarningMessage } from "../lib/operationalWarningPresentation";
import { cn } from "../lib/utils";
import {
  getReleaseDeltaDisabledStatusMessage,
  getReleaseDeltaProcurementBadge,
  isReleaseDeltaButtonEnabled,
  resolveAdditionalRequirementTotal,
  resolvePreviouslyReleasedTotal,
} from "../lib/monthlyPlanningReleaseDeltaUx";
import {
  captureProductionPlanBaseline,
  formatLockSnapshotSuccessMessage,
  formatPlannedSuggestedLockWarning,
  hasPlannedSuggestedMismatch,
  hasUnsavedProductionChanges as detectUnsavedProductionChanges,
  UNSAVED_PRODUCTION_PLAN_LOCK_MESSAGE,
  type ProductionPlanSavedBaseline,
} from "../lib/monthlyPlanningProductionPlanDirty";
import {
  APPLY_SUGGESTED_ADDED_SUCCESS_TOAST,
  APPLY_SUGGESTED_CANCEL_INFO_TOAST,
  APPLY_SUGGESTED_PLANNED_SUCCESS_TOAST,
  buildApplySuggestedExistingRowPatch,
  formatApplySuggestedOverrideConfirmMessage,
  shouldConfirmOverrideReplace,
} from "../lib/monthlyPlanningApplySuggestedProduction";
import {
  MP_PROCUREMENT,
  MP_RELEASE_STATUS_META,
  procurementProgressModelLine,
} from "../lib/monthlyPlanningProcurementLabels";
import {
  CalendarRange,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Lock,
  Unlock,
  X,
  Send,
  CheckCircle,
  XCircle,
  PackagePlus,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  Layers,
  Calculator,
  Boxes,
  History,
  CircleHelp,
} from "lucide-react";

type PlanStatus = MonthlyPlanStatus;
type LineSource = "SALES_ORDER" | "REQUIREMENT_SHEET" | "MANUAL" | "CUSTOMER_SCHEDULE";

type PlanSummary = {
  id: number;
  docNo: string | null;
  periodKey: string;
  planSequenceNo?: number;
  planKind?: MonthlyPlanKind;
  displayLabel?: string | null;
  status: PlanStatus;
  currentRevision: number;
  remarks: string | null;
  lockedAt: string | null;
  reopenedAt: string | null;
  purchaseRejectReason?: string | null;
  releasedAt: string | null;
  releasedRevision: number | null;
  createdByUserId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type PlanResponse = {
  exists: boolean;
  plan: PlanSummary | null;
  plans?: PlanSummary[];
  lines: unknown[];
  revisions: { revision: number; recalculatedAt: string }[];
};

type AdditionalPlanPreview = {
  periodKey: string;
  nextPlanSequenceNo: number;
  nextPlanLabel: string;
  nextPlanKind: MonthlyPlanKind;
  canCreate: boolean;
  blockingCode: string | null;
  blockingReason: string | null;
  approvedPlanCount: number;
  totals: {
    totalAdditionalRequirementQty: number;
    additionalItemCount: number;
  };
};

type ProductionLine = {
  id: number;
  fgItemId: number;
  fgItemName: string | null;
  unit: string | null;
  suggestedFgQty: string | number;
  plannedFgQty: string | number;
  plannedQtyOverridden: boolean;
  source: LineSource;
  remarks: string | null;
  varianceQty?: number;
  variancePct?: number;
  greenTarget?: number;
  freeFgStock?: number;
  projectedStockAfterPlan?: number;
  remainingGreenGap?: number;
};

type LockSummary = {
  fgItemsWithVariance: number;
  totalSuggestedQty: number;
  totalPlannedQty: number;
  totalVarianceQty: number;
};

type ProductionLinesResponse = {
  planId: number;
  periodKey?: string;
  status: PlanStatus;
  editable: boolean;
  lines: ProductionLine[];
  lockSummary?: LockSummary;
};

type RmPlanLine = {
  id: number;
  rmItemId: number;
  rmItemName: string | null;
  unit: string | null;
  grossDemandQty: string | number;
  freeStockSnapshot: string | number;
  reservedSnapshot: string | number;
  incomingPoSnapshot: string | number;
  minStockTopUpQty: string | number;
  netRequirementQty: string | number;
  belowMinStockFlag: boolean;
  leadTimeRiskFlag: boolean;
  warnings: { code?: string; message?: string }[];
};

type RmPlanningResponse = {
  locked: boolean;
  exists: boolean;
  planId: number;
  status: PlanStatus;
  currentRevision: number;
  revision: number | null;
  rmPlan: { id: number; revision: number; totalFgPlannedQty: string | number; recalculatedAt: string } | null;
  availableRevisions: number[];
  lines: RmPlanLine[];
};

type PurchaseStatus = "NOT_RELEASED" | "PARTIALLY_RELEASED" | "FULLY_RELEASED" | "OVER_RELEASED";

type PurchasePlanLine = {
  rmItemId: number;
  rmItemName: string | null;
  unit: string | null;
  grossDemandQty: number;
  freeStockSnapshot: number;
  reservedSnapshot: number;
  incomingPoSnapshot: number;
  netRequirementQty: number;
  alreadyRequisitionedQty: number;
  alreadyProcuredQty: number;
  varianceQty: number;
  suggestedPurchaseQty: number;
  currentRequirementQty: number;
  previouslyReleasedQty: number;
  additionalRequirementQty: number;
  reductionQty: number;
  deltaQty: number;
  procurementStatus: PurchaseStatus;
  vendorSuggestion: string | null;
  belowMinStockFlag: boolean;
  leadTimeRiskFlag: boolean;
  warnings: { code?: string; message?: string }[];
  poQty?: number;
  receivedQty?: number;
  pendingReceiptQty?: number;
  physicalCoveragePct?: number | null;
  receiptCoverageStatus?: ReceiptCoverageStatus;
  receiptCoverageStatusLabel?: string;
};

type PurchasePlanningTotals = {
  rmItemCount: number;
  currentRequirementTotal: number;
  previouslyReleasedTotal: number;
  additionalRequirementTotal: number;
  reductionTotal: number;
  coveragePct: number | null;
};

type ReceiptCoverageTotals = {
  requirementQty: number;
  releasedQty: number;
  poQty: number;
  receivedQty: number;
  pendingReceiptQty: number;
  physicalCoveragePct: number | null;
};

type ReceiptCoverageStatus = "FULLY_COVERED" | "PARTIALLY_COVERED" | "NOT_RECEIVED" | "OVER_COVERED";

type ReleaseSummary = {
  planId: number;
  revision: number;
  materialRequirementId: number | null;
  materialRequirementDocNo: string | null;
  releasedLineCount: number;
  skippedLineCount: number;
  surplusLineCount: number;
  totalDeltaQty: number;
  released: { rmItemId: number; deltaQty: number; netRequirementQty: number }[];
  skipped: { rmItemId: number; netRequirementQty: number }[];
  surplus: { rmItemId: number; reducedQty: number; surplusQty: number; netRequirementQty: number }[];
};

type PurchasePlanningResponse = {
  locked: boolean;
  exists: boolean;
  planId: number;
  status: PlanStatus;
  currentRevision: number;
  revision: number | null;
  usesCurrentRevisionOnly?: boolean;
  availableRevisions: number[];
  rmPlan: { id: number; revision: number; totalFgPlannedQty: string | number; recalculatedAt: string } | null;
  lines: PurchasePlanLine[];
  totals?: PurchasePlanningTotals;
  receiptCoverage?: { totals: ReceiptCoverageTotals };
};

type FgItem = { id: number; itemName: string; unit?: string | null; unitName?: string | null };

type RsSuggestionSource = {
  requirementSheetId: number;
  requirementSheetDocNo: string | null;
  salesOrderId: number;
  salesOrderDocNo: string | null;
  cycleId: number | null;
  cycleNo?: number | null;
  requirementQty: number;
  shortfallQtySnapshot: number;
  suggestedWoQtySnapshot: number;
};

type RsSuggestionItem = {
  itemId: number;
  itemName: string | null;
  unit: string | null;
  scheduleQty: number;
  carryForwardQty: number;
  productionRequirementQty: number;
  sources: RsSuggestionSource[];
};

type RsSuggestionsResponse = {
  periodKey: string;
  sheetCount: number;
  items: RsSuggestionItem[];
};

type GreenLevelStatus = "GREEN" | "YELLOW" | "RED" | "CRITICAL";

type GreenLevelItem = {
  itemId: number;
  itemName: string | null;
  unit: string | null;
  baseQty: number;
  greenPercent: number;
  yellowPercent: number;
  redPercent: number;
  greenQty: number;
  yellowQty: number;
  redQty: number;
  monthlyScheduleTotals: Record<string, number>;
  freeFgStock: number;
  shortageForGreenTarget: number;
  status: GreenLevelStatus | null;
  totalUsableFgStock?: number;
  reservedNormalDispatchQty?: number;
  reservedNoQtyDispatchQty?: number;
};

type GreenLevelsResponse = {
  anchorPeriodKey: string;
  historyPeriodKeys: string[];
  stockScope?: string;
  itemCount: number;
  itemsWithHistory: number;
  itemsWithStatus?: number;
  items: GreenLevelItem[];
};

type RequirementCompositionItem = {
  itemId: number;
  itemName: string | null;
  unit: string | null;
  rsRequirement: number;
  carryForward: number;
  greenShortage: number;
  suggestedProduction: number;
  productionRequirementQty?: number;
  greenTarget?: number;
  freeFgStock?: number;
  status?: GreenLevelStatus | null;
};

type RequirementCompositionResponse = {
  periodKey: string;
  anchorPeriodKey?: string;
  sheetCount?: number;
  itemCount: number;
  items: RequirementCompositionItem[];
};

type RmCompositionFgSource = {
  fgItemId: number;
  fgItemName: string | null;
  suggestedProduction: number;
  rmDemandQty: number;
  bomRevision?: string | null;
  bomDocNo?: string | null;
  bomMissing?: boolean;
  planningStatus?: string | null;
};

type RmRequirementCompositionItem = {
  rmItemId: number;
  itemName: string | null;
  unit: string | null;
  itemType?: string | null;
  totalRmDemand: number;
  physicalStock?: number;
  freeStock: number;
  reserved: number;
  incomingPo: number;
  netAvailable: number;
  netGap: number;
  minimumStock: number;
  belowMinimumFlag: boolean;
  fgSources: RmCompositionFgSource[];
};

type RmRequirementCompositionResponse = {
  periodKey: string;
  anchorPeriodKey?: string;
  summary: {
    fgItemsPlanned: number;
    rmItemsRequired: number;
    rmLinesWithGap: number;
    missingBomCount: number;
    missingChildBomCount?: number;
  };
  items: RmRequirementCompositionItem[];
};

type EditRow = {
  key: string;
  id?: number;
  fgItemId: number;
  fgItemName: string | null;
  unit: string | null;
  suggestedFgQty: number;
  plannedFgQty: string;
  plannedQtyOverridden: boolean;
  source: LineSource;
  remarks: string;
};

type LinePlanningMetrics = {
  suggested: number;
  planned: number;
  varianceQty: number;
  variancePct: number;
  greenTarget: number;
  freeFgStock: number;
  remainingGreenGap: number;
};

function round3(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function buildSuggestedProductionMap(data: RequirementCompositionResponse | null): Map<number, number> {
  const map = new Map<number, number>();
  for (const item of data?.items ?? []) {
    map.set(item.itemId, round3(num(item.suggestedProduction)));
  }
  return map;
}

function buildGreenContextMap(
  data: GreenLevelsResponse | null,
): Map<number, { greenTarget: number; freeFgStock: number }> {
  const map = new Map<number, { greenTarget: number; freeFgStock: number }>();
  for (const item of data?.items ?? []) {
    map.set(item.itemId, {
      greenTarget: round3(num(item.greenQty)),
      freeFgStock: round3(num(item.freeFgStock)),
    });
  }
  return map;
}

function computeLinePlanningMetrics(
  fgItemId: number,
  plannedQty: number,
  fallbackSuggested: number,
  suggestedMap: Map<number, number>,
  greenMap: Map<number, { greenTarget: number; freeFgStock: number }>,
): LinePlanningMetrics {
  const suggested = suggestedMap.has(fgItemId) ? suggestedMap.get(fgItemId)! : round3(fallbackSuggested);
  const planned = round3(plannedQty);
  const varianceQty = round3(planned - suggested);
  const variancePct = suggested > 0 ? round3((varianceQty / suggested) * 100) : 0;
  const green = greenMap.get(fgItemId) ?? { greenTarget: 0, freeFgStock: 0 };
  const remainingGreenGap = round3(Math.max(0, green.greenTarget - (green.freeFgStock + planned)));
  return {
    suggested,
    planned,
    varianceQty,
    variancePct,
    greenTarget: green.greenTarget,
    freeFgStock: green.freeFgStock,
    remainingGreenGap,
  };
}

function computeLockSummaryFromRows(
  rows: EditRow[],
  suggestedMap: Map<number, number>,
): LockSummary {
  let totalSuggestedQty = 0;
  let totalPlannedQty = 0;
  let fgItemsWithVariance = 0;
  for (const row of rows) {
    const metrics = computeLinePlanningMetrics(
      row.fgItemId,
      num(row.plannedFgQty),
      row.suggestedFgQty,
      suggestedMap,
      new Map(),
    );
    totalSuggestedQty = round3(totalSuggestedQty + metrics.suggested);
    totalPlannedQty = round3(totalPlannedQty + metrics.planned);
    if (Math.abs(metrics.varianceQty) > 1e-9) fgItemsWithVariance += 1;
  }
  return {
    fgItemsWithVariance,
    totalSuggestedQty,
    totalPlannedQty,
    totalVarianceQty: round3(totalPlannedQty - totalSuggestedQty),
  };
}

function varianceRowClass(varianceQty: number): string {
  if (Math.abs(varianceQty) < 1e-9) return "text-slate-600";
  if (varianceQty < 0) return "text-amber-800";
  return "text-sky-800";
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isPastPeriod(periodKey: string): boolean {
  const key = normalizePeriodKey(periodKey);
  if (!key) return false;
  return key < currentMonthKey();
}

/** Normalize period to YYYY-MM (matches backend normalizePeriodKey). */
function normalizePeriodKey(period: string): string | null {
  const key = String(period ?? "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? key : null;
}

function num(v: string | number | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sourceBadgeVariant(source: LineSource): "default" | "info" | "success" | "warning" {
  switch (source) {
    case "SALES_ORDER":
      return "info";
    case "REQUIREMENT_SHEET":
      return "success";
    default:
      return "default";
  }
}

function sourceLabel(source: LineSource): string {
  switch (source) {
    case "SALES_ORDER":
      return "Sales Order";
    case "REQUIREMENT_SHEET":
      return "Requirement Sheet";
    case "CUSTOMER_SCHEDULE":
      return "Customer Schedule";
    default:
      return "Manual";
  }
}

type RevisionFgLine = {
  fgItemId: number;
  itemName: string | null;
  unit: string | null;
  suggestedFgQty: number;
  plannedFgQty: number;
  plannedQtyOverridden: boolean;
  source: LineSource;
  remarks: string | null;
};

type PlanRevisionRow = {
  revision: number;
  lockedAt: string;
  lockedByUserId: number | null;
  lockedByName: string | null;
  totalFgPlannedQty: number;
  released: boolean;
  status: "CURRENT" | "LOCKED";
  isCurrent: boolean;
  hasRmSnapshot: boolean;
  fgLines: RevisionFgLine[];
};

type PlanRevisionsResponse = {
  planId: number;
  periodKey: string;
  status: PlanStatus;
  currentRevision: number;
  releasedRevision: number | null;
  draftForRevision: number | null;
  lastLockedRevision: number | null;
  revisions: PlanRevisionRow[];
};

type TabKey = "production" | "rm" | "purchase";

export function MonthlyPlanningWorkspacePage() {
  const { flags, loading: flagsLoading } = useFeatureFlags();
  const { showSuccess, showError, showInfo } = useToast();
  const auth = useAuth();
  const userRole = auth.user?.role ?? "";
  const canWriteMonthlyPlan = MONTHLY_PLANNING_WRITE_ROLES.includes(
    userRole as (typeof MONTHLY_PLANNING_WRITE_ROLES)[number],
  );
  const canPurchaseReview = MONTHLY_PLANNING_PURCHASE_REVIEW_ROLES.includes(
    userRole as (typeof MONTHLY_PLANNING_PURCHASE_REVIEW_ROLES)[number],
  );
  const isAdmin = userRole === "ADMIN";
  const [searchParams, setSearchParams] = useSearchParams();

  const periodFromUrl = searchParams.get("period");
  const [period, setPeriod] = React.useState<string>(
    normalizePeriodKey(periodFromUrl ?? "") ?? currentMonthKey(),
  );
  const periodIsPast = isPastPeriod(period);
  const canMutatePeriod = canWriteMonthlyPlan && (!periodIsPast || isAdmin);
  const [activeTab, setActiveTab] = React.useState<TabKey>("production");

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [plan, setPlan] = React.useState<PlanSummary | null>(null);
  const [periodPlans, setPeriodPlans] = React.useState<PlanSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = React.useState<number | null>(null);
  const [planExists, setPlanExists] = React.useState<boolean>(false);
  const [rows, setRows] = React.useState<EditRow[]>([]);
  const [removedIds, setRemovedIds] = React.useState<number[]>([]);
  const [savedProductionBaseline, setSavedProductionBaseline] =
    React.useState<ProductionPlanSavedBaseline | null>(null);
  const [fgItems, setFgItems] = React.useState<FgItem[]>([]);
  const [addItemId, setAddItemId] = React.useState<string>("");
  const [rmPlanning, setRmPlanning] = React.useState<RmPlanningResponse | null>(null);
  const [loadingRm, setLoadingRm] = React.useState(false);
  const [purchasePlanning, setPurchasePlanning] = React.useState<PurchasePlanningResponse | null>(null);
  const [loadingPurchase, setLoadingPurchase] = React.useState(false);
  const [confirmLockOpen, setConfirmLockOpen] = React.useState(false);
  const [applySuggestedOverrideConfirm, setApplySuggestedOverrideConfirm] = React.useState<{
    rowKey: string;
    itemName: string;
    plannedQty: number;
    suggestedQty: number;
  } | null>(null);
  const [locking, setLocking] = React.useState(false);
  const [confirmReleaseOpen, setConfirmReleaseOpen] = React.useState(false);
  const [releasing, setReleasing] = React.useState(false);
  const [releaseSummary, setReleaseSummary] = React.useState<ReleaseSummary | null>(null);
  const [rsSuggestions, setRsSuggestions] = React.useState<RsSuggestionsResponse | null>(null);
  const [loadingRsSuggestions, setLoadingRsSuggestions] = React.useState(false);
  const [rsSuggestionsVisible, setRsSuggestionsVisible] = React.useState(false);
  const [greenLevels, setGreenLevels] = React.useState<GreenLevelsResponse | null>(null);
  const [loadingGreenLevels, setLoadingGreenLevels] = React.useState(false);
  const [greenLevelsVisible, setGreenLevelsVisible] = React.useState(false);
  const [requirementComposition, setRequirementComposition] = React.useState<RequirementCompositionResponse | null>(
    null,
  );
  const [loadingRequirementComposition, setLoadingRequirementComposition] = React.useState(false);
  const [requirementCompositionVisible, setRequirementCompositionVisible] = React.useState(false);
  const [rmRequirementComposition, setRmRequirementComposition] =
    React.useState<RmRequirementCompositionResponse | null>(null);
  const [loadingRmRequirementComposition, setLoadingRmRequirementComposition] = React.useState(false);
  const [rmRequirementCompositionVisible, setRmRequirementCompositionVisible] = React.useState(false);
  const [lockSummary, setLockSummary] = React.useState<LockSummary | null>(null);
  const [planRevisions, setPlanRevisions] = React.useState<PlanRevisionsResponse | null>(null);
  const [loadingRevisions, setLoadingRevisions] = React.useState(false);
  const [expandedRevision, setExpandedRevision] = React.useState<number | null>(null);
  const [revisionHistoryExpanded, setRevisionHistoryExpanded] = React.useState(false);
  const [planningAuditExpanded, setPlanningAuditExpanded] = React.useState(false);
  const [greenLevelAuditExpanded, setGreenLevelAuditExpanded] = React.useState(false);
  const [rmAuditExpanded, setRmAuditExpanded] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  const [cancellingReopen, setCancellingReopen] = React.useState(false);
  const [startingPlanning, setStartingPlanning] = React.useState(false);
  const [addingSuggested, setAddingSuggested] = React.useState(false);
  const [submittingForReview, setSubmittingForReview] = React.useState(false);
  const [approvingPlan, setApprovingPlan] = React.useState(false);
  const [rejectModalOpen, setRejectModalOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const [rejectingPlan, setRejectingPlan] = React.useState(false);
  const [additionalPreview, setAdditionalPreview] = React.useState<AdditionalPlanPreview | null>(null);
  const [loadingAdditionalPreview, setLoadingAdditionalPreview] = React.useState(false);
  const [additionalPanelOpen, setAdditionalPanelOpen] = React.useState(false);
  const [creatingAdditionalPlan, setCreatingAdditionalPlan] = React.useState(false);
  const [pastPeriodConfirmOpen, setPastPeriodConfirmOpen] = React.useState(false);
  const [confirmingPastPeriod, setConfirmingPastPeriod] = React.useState(false);
  const [pastPeriodConfirmedKey, setPastPeriodConfirmedKey] = React.useState<string | null>(null);
  const pastPeriodActionRef = React.useRef<(() => Promise<void>) | null>(null);

  const pastPeriodConfirmedSession = periodIsPast && pastPeriodConfirmedKey === period;

  const isLegacyPlan = Boolean(plan && isLegacyPlanDocument(plan));
  const editable = Boolean(plan && isPlanEditable(plan, canMutatePeriod));
  const workflowActions = resolveWorkflowActionVisibility({
    plan,
    planExists,
    canMutatePeriod,
    canPurchaseReview,
    hasSaveableLines: rows.some((r) => num(r.plannedFgQty) > 0),
  });
  const rmPurchaseTabsEnabled = canLoadRmPurchaseTabs(plan?.status);
  const isDraftForNextRevision = Boolean(
    isLegacyPlan && plan && plan.status === "DRAFT" && plan.currentRevision >= 1,
  );
  const showAdditionalPlanEntry = canShowAdditionalPlanEntry({ canMutatePeriod, periodPlans });
  const historicalPlanBanner =
    plan && periodPlans.length > 0 ? historicalApprovedPlanBannerMessage(plan, periodPlans) : null;
  const showLegacyWorkflowActions = Boolean(
    workflowActions.lock || workflowActions.reopen || workflowActions.cancelReopen,
  );
  const suggestedProductionMap = React.useMemo(
    () => buildSuggestedProductionMap(requirementComposition),
    [requirementComposition],
  );
  const greenContextMap = React.useMemo(() => buildGreenContextMap(greenLevels), [greenLevels]);

  const ensurePlanningContext = React.useCallback(async () => {
    const needComposition = !requirementComposition || requirementComposition.periodKey !== period;
    const needGreen = !greenLevels || greenLevels.anchorPeriodKey !== period;
    const [compositionRes, greenRes] = await Promise.all([
      needComposition
        ? apiFetch<RequirementCompositionResponse>(
            `/api/monthly-planning/requirement-composition?periodKey=${encodeURIComponent(period)}`,
          )
        : Promise.resolve(requirementComposition),
      needGreen
        ? apiFetch<GreenLevelsResponse>(
            `/api/monthly-planning/green-levels?periodKey=${encodeURIComponent(period)}`,
          )
        : Promise.resolve(greenLevels),
    ]);
    if (needComposition && compositionRes) setRequirementComposition(compositionRes);
    if (needGreen && greenRes) setGreenLevels(greenRes);
    return {
      composition: compositionRes,
      green: greenRes,
    };
  }, [period, requirementComposition, greenLevels]);

  const loadRevisions = React.useCallback(async (planId: number) => {
    setLoadingRevisions(true);
    try {
      const res = await apiFetch<PlanRevisionsResponse>(`/api/monthly-planning/${planId}/revisions`);
      setPlanRevisions(res);
    } catch {
      setPlanRevisions(null);
    } finally {
      setLoadingRevisions(false);
    }
  }, []);

  const loadPlanDetails = React.useCallback(
    async (planRef: PlanSummary) => {
      setPlan(planRef);
      setSelectedPlanId(planRef.id);
      setRemovedIds([]);

      if (isLegacyPlanDocument(planRef)) {
        void loadRevisions(planRef.id);
      } else {
        setPlanRevisions(null);
      }

      try {
        const lineRes = await apiFetch<ProductionLinesResponse>(
          `/api/monthly-planning/${planRef.id}/production-lines`,
        );
        const mappedRows = lineRes.lines.map((l) => ({
          key: `srv-${l.id}`,
          id: l.id,
          fgItemId: l.fgItemId,
          fgItemName: l.fgItemName,
          unit: l.unit,
          suggestedFgQty: num(l.suggestedFgQty),
          plannedFgQty: String(num(l.plannedFgQty)),
          plannedQtyOverridden: Boolean(l.plannedQtyOverridden),
          source: l.source,
          remarks: l.remarks ?? "",
        }));
        setRows(mappedRows);
        setSavedProductionBaseline(captureProductionPlanBaseline(mappedRows));
        setLockSummary(lineRes.lockSummary ?? null);
      } catch (lineErr) {
        const lineMsg =
          lineErr instanceof ApiRequestError
            ? lineErr.message
            : "Failed to load production plan lines.";
        showError(`${lineMsg} Plan header is loaded — try Refresh.`);
        setRows([]);
        setSavedProductionBaseline(null);
        setLockSummary(null);
      }

      if (planRef.status === "DRAFT") {
        void ensurePlanningContext().catch(() => {
          /* variance columns fall back to stored suggested until context loads */
        });
      }

      if (canLoadRmPurchaseTabs(planRef.status)) {
        try {
          const [rm, pp] = await Promise.all([
            apiFetch<RmPlanningResponse>(`/api/monthly-planning/${planRef.id}/rm-planning`),
            apiFetch<PurchasePlanningResponse>(
              `/api/monthly-planning/${planRef.id}/purchase-planning`,
            ),
          ]);
          setRmPlanning(rm);
          setPurchasePlanning(pp);
        } catch {
          setRmPlanning(null);
          setPurchasePlanning(null);
        }
      } else {
        setRmPlanning(null);
        setPurchasePlanning(null);
      }
    },
    [loadRevisions, showError, ensurePlanningContext],
  );

  const loadPlan = React.useCallback(
    async (p: string, preferredPlanId?: number | null) => {
      const periodKey = normalizePeriodKey(p);
      if (!periodKey) {
        showError("Plan period must be in YYYY-MM format.");
        return;
      }

      setLoading(true);
      let headerLoaded = false;
      try {
        const res = await apiFetch<PlanResponse>(
          `/api/monthly-planning?period=${encodeURIComponent(periodKey)}`,
        );
        const plans = res.plans ?? (res.plan ? [res.plan] : []);
        setPeriodPlans(plans);
        headerLoaded = Boolean(res.exists && plans.length > 0);
        setPlanExists(res.exists && plans.length > 0);

        if (!headerLoaded) {
          setPlan(null);
          setSelectedPlanId(null);
          setRows([]);
          setSavedProductionBaseline(null);
          setRmPlanning(null);
          setPurchasePlanning(null);
          setLockSummary(null);
          setPlanRevisions(null);
          setAdditionalPreview(null);
          return;
        }

        const planRef =
          (preferredPlanId != null ? plans.find((pl) => pl.id === preferredPlanId) : null) ??
          res.plan ??
          plans[plans.length - 1];
        await loadPlanDetails(planRef);
      } catch (e) {
        const msg = e instanceof ApiRequestError ? e.message : "Failed to load monthly plan.";
        showError(msg);
        if (!headerLoaded) {
          setPlanExists(false);
          setPlan(null);
          setPeriodPlans([]);
          setSelectedPlanId(null);
          setRows([]);
          setSavedProductionBaseline(null);
          setRmPlanning(null);
          setPurchasePlanning(null);
          setLockSummary(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [showError, loadPlanDetails],
  );

  const onSelectPlan = React.useCallback(
    (planId: number) => {
      const target = periodPlans.find((p) => p.id === planId);
      if (!target) return;
      setLoading(true);
      void loadPlanDetails(target).finally(() => setLoading(false));
    },
    [periodPlans, loadPlanDetails],
  );

  // Load FG items once (for the Add row picker).
  React.useEffect(() => {
    if (!flags.monthlyPlanning) return;
    let active = true;
    void apiFetch<FgItem[]>("/api/items?type=FG")
      .then((items) => {
        if (active) setFgItems(items ?? []);
      })
      .catch(() => {
        /* picker just stays empty */
      });
    return () => {
      active = false;
    };
  }, [flags.monthlyPlanning]);

  React.useEffect(() => {
    if (!flags.monthlyPlanning) return;
    void loadPlan(period);
  }, [flags.monthlyPlanning, period, loadPlan]);

  function suggestedProductionForFg(
    fgItemId: number,
    composition: RequirementCompositionResponse | null,
  ): number {
    const map = buildSuggestedProductionMap(composition);
    return map.get(fgItemId) ?? 0;
  }

  function applyPeriod(next: string) {
    const normalized = normalizePeriodKey(next);
    if (!normalized) return;
    setPeriod(normalized);
    const sp = new URLSearchParams(searchParams);
    sp.set("period", normalized);
    setSearchParams(sp, { replace: true });
  }

  function runWithPastPeriodGuard(action: () => Promise<void>) {
    if (!canMutatePeriod) {
      showError(
        periodIsPast
          ? "Monthly planning for past periods is read-only. Contact Admin if correction is required."
          : "You do not have permission to change monthly plans.",
      );
      return;
    }
    if (periodIsPast && isAdmin) {
      if (pastPeriodConfirmedSession) {
        void action();
        return;
      }
      pastPeriodActionRef.current = async () => {
        setPastPeriodConfirmedKey(period);
        await action();
      };
      setPastPeriodConfirmOpen(true);
      return;
    }
    void action();
  }

  async function ensurePlanDraft(options?: { confirmPastPeriod?: boolean }): Promise<PlanSummary> {
    if (plan?.id) return plan;
    const periodKey = normalizePeriodKey(period);
    if (!periodKey) {
      throw new Error("Plan period must be in YYYY-MM format.");
    }
    const body: { period: string; confirmPastPeriod?: true } = { period: periodKey };
    if (options?.confirmPastPeriod) body.confirmPastPeriod = true;
    const res = await apiFetch<PlanResponse>("/api/monthly-planning", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.plan) {
      throw new Error("Failed to create monthly plan draft.");
    }
    setPlanExists(true);
    setPlan(res.plan);
    return res.plan;
  }

  async function onStartPlanning(options?: { confirmPastPeriod?: boolean }) {
    const periodKey = normalizePeriodKey(period);
    if (!periodKey) {
      showError("Plan period must be in YYYY-MM format.");
      return;
    }
    setStartingPlanning(true);
    try {
      await ensurePlanDraft(options);
      setRows([]);
      setRemovedIds([]);
      setSavedProductionBaseline(null);
      showSuccess(`Draft started for ${periodKey}. Add FG lines or apply suggestions, then save.`);
      await loadPlan(periodKey);
    } catch (e) {
      if (
        e instanceof ApiRequestError &&
        (e.code === "DUPLICATE_PERIOD" || e.code === "ACTIVE_PLAN_EXISTS")
      ) {
        await loadPlan(periodKey);
        return;
      }
      showError(e instanceof ApiRequestError ? e.message : "Failed to start planning.");
    } finally {
      setStartingPlanning(false);
    }
  }

  async function onAddSuggestedItemsToPlan(options?: { confirmPastPeriod?: boolean }) {
    const periodKey = normalizePeriodKey(period);
    if (!periodKey) {
      showError("Plan period must be in YYYY-MM format.");
      return;
    }
    setAddingSuggested(true);
    try {
      const ctx = await ensurePlanningContext();
      const composition = ctx.composition;
      const suggestedItems = (composition?.items ?? []).filter((item) => item.suggestedProduction > 0);
      if (suggestedItems.length === 0) {
        showError("No suggested production items for this period. Load Requirement Composition first.");
        return;
      }
      const createdPlan = await ensurePlanDraft(options);
      const upserts = suggestedItems.map((item) => ({
        fgItemId: item.itemId,
        plannedFgQty: round3(item.suggestedProduction),
        plannedQtyOverridden: false,
        source: "REQUIREMENT_SHEET" as const,
        remarks: "From suggested production (RS + carry forward + green shortage)",
      }));
      const lineBody: { upserts: typeof upserts; deletes: []; confirmPastPeriod?: true } = {
        upserts,
        deletes: [],
      };
      if (options?.confirmPastPeriod) lineBody.confirmPastPeriod = true;
      await apiFetch<ProductionLinesResponse>(`/api/monthly-planning/${createdPlan.id}/production-lines`, {
        method: "PUT",
        body: JSON.stringify(lineBody),
      });
      showSuccess(`Added ${suggestedItems.length} suggested FG item(s) to the draft plan.`);
      await loadPlan(periodKey);
    } catch (e) {
      if (
        e instanceof ApiRequestError &&
        (e.code === "DUPLICATE_PERIOD" || e.code === "ACTIVE_PLAN_EXISTS")
      ) {
        await loadPlan(periodKey);
        return;
      }
      showError(e instanceof ApiRequestError ? e.message : "Failed to add suggested items.");
    } finally {
      setAddingSuggested(false);
    }
  }

  function updateRow(key: string, patch: Partial<EditRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        if (patch.plannedFgQty != null && patch.plannedQtyOverridden == null) {
          next.plannedQtyOverridden = true;
        }
        return next;
      }),
    );
  }

  function removeRow(row: EditRow) {
    setRows((prev) => prev.filter((r) => r.key !== row.key));
    if (row.id) setRemovedIds((prev) => [...prev, row.id as number]);
  }

  const loadGreenLevels = React.useCallback(async () => {
    setLoadingGreenLevels(true);
    try {
      const res = await apiFetch<GreenLevelsResponse>(
        `/api/monthly-planning/green-levels?periodKey=${encodeURIComponent(period)}`,
      );
      setGreenLevels(res);
      setGreenLevelsVisible(true);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to load Green Level data.");
      setGreenLevels(null);
    } finally {
      setLoadingGreenLevels(false);
    }
  }, [period, showError]);

  const greenLevelsPeriodRef = React.useRef(period);
  React.useEffect(() => {
    if (greenLevelsPeriodRef.current === period) return;
    greenLevelsPeriodRef.current = period;
    setGreenLevels(null);
    if (greenLevelsVisible) {
      void loadGreenLevels();
    }
  }, [period, greenLevelsVisible, loadGreenLevels]);

  const loadRequirementComposition = React.useCallback(async () => {
    setLoadingRequirementComposition(true);
    try {
      const res = await apiFetch<RequirementCompositionResponse>(
        `/api/monthly-planning/requirement-composition?periodKey=${encodeURIComponent(period)}`,
      );
      setRequirementComposition(res);
      setRequirementCompositionVisible(true);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to load Requirement Composition.");
      setRequirementComposition(null);
    } finally {
      setLoadingRequirementComposition(false);
    }
  }, [period, showError]);

  const requirementCompositionPeriodRef = React.useRef(period);
  React.useEffect(() => {
    if (requirementCompositionPeriodRef.current === period) return;
    requirementCompositionPeriodRef.current = period;
    setRequirementComposition(null);
    if (requirementCompositionVisible) {
      void loadRequirementComposition();
    }
  }, [period, requirementCompositionVisible, loadRequirementComposition]);

  const loadRmRequirementComposition = React.useCallback(async () => {
    setLoadingRmRequirementComposition(true);
    try {
      const res = await apiFetch<RmRequirementCompositionResponse>(
        `/api/monthly-planning/rm-requirement-composition?periodKey=${encodeURIComponent(period)}`,
      );
      setRmRequirementComposition(res);
      setRmRequirementCompositionVisible(true);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to load RM Requirement Composition.");
      setRmRequirementComposition(null);
    } finally {
      setLoadingRmRequirementComposition(false);
    }
  }, [period, showError]);

  const rmRequirementCompositionPeriodRef = React.useRef(period);
  React.useEffect(() => {
    if (rmRequirementCompositionPeriodRef.current === period) return;
    rmRequirementCompositionPeriodRef.current = period;
    setRmRequirementComposition(null);
    if (rmRequirementCompositionVisible) {
      void loadRmRequirementComposition();
    }
  }, [period, rmRequirementCompositionVisible, loadRmRequirementComposition]);

  async function loadRsSuggestions() {
    setLoadingRsSuggestions(true);
    try {
      const res = await apiFetch<RsSuggestionsResponse>(
        `/api/monthly-planning/rs-suggestions?periodKey=${encodeURIComponent(period)}`,
      );
      setRsSuggestions(res);
      setRsSuggestionsVisible(true);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to load RS suggestions.");
      setRsSuggestions(null);
    } finally {
      setLoadingRsSuggestions(false);
    }
  }

  async function applyRsSuggestion(item: RsSuggestionItem) {
    if (!editable || !canMutatePeriod) {
      showError(
        !editable
          ? "Plan is read-only — RS suggestions cannot be applied."
          : "Past periods are view-only for Store users.",
      );
      return;
    }
    try {
      await ensurePlanDraft();
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to create plan draft.");
      return;
    }
    let composition: RequirementCompositionResponse | null = requirementComposition;
    try {
      const ctx = await ensurePlanningContext();
      composition = ctx.composition;
    } catch {
      showError("Failed to load suggested production for this period.");
      return;
    }
    const suggested = suggestedProductionForFg(item.itemId, composition);
    const existing = rows.find((r) => r.fgItemId === item.itemId);
    const itemLabel = item.itemName ?? `Item ${item.itemId}`;
    if (existing) {
      if (shouldConfirmOverrideReplace(existing.plannedQtyOverridden)) {
        setApplySuggestedOverrideConfirm({
          rowKey: existing.key,
          itemName: itemLabel,
          plannedQty: num(existing.plannedFgQty),
          suggestedQty: suggested,
        });
        return;
      }
      updateRow(existing.key, buildApplySuggestedExistingRowPatch(suggested));
      showSuccess(APPLY_SUGGESTED_PLANNED_SUCCESS_TOAST);
      return;
    }
    const fg = fgItems.find((i) => i.id === item.itemId);
    setRows((prev) => [
      ...prev,
      {
        key: `rs-${item.itemId}-${Date.now()}`,
        fgItemId: item.itemId,
        fgItemName: itemLabel,
        unit: item.unit ?? fg?.unit ?? fg?.unitName ?? null,
        suggestedFgQty: suggested,
        plannedFgQty: String(suggested),
        plannedQtyOverridden: false,
        source: "REQUIREMENT_SHEET",
        remarks: "From suggested production (RS + carry forward + green shortage)",
      },
    ]);
    showSuccess(APPLY_SUGGESTED_ADDED_SUCCESS_TOAST);
  }

  function confirmApplySuggestedOverrideReplace() {
    if (!applySuggestedOverrideConfirm) return;
    updateRow(
      applySuggestedOverrideConfirm.rowKey,
      buildApplySuggestedExistingRowPatch(applySuggestedOverrideConfirm.suggestedQty),
    );
    setApplySuggestedOverrideConfirm(null);
    showSuccess(APPLY_SUGGESTED_PLANNED_SUCCESS_TOAST);
  }

  function cancelApplySuggestedOverrideReplace() {
    setApplySuggestedOverrideConfirm(null);
    showInfo(APPLY_SUGGESTED_CANCEL_INFO_TOAST);
  }

  async function addRow() {
    const id = Number(addItemId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!editable || !canMutatePeriod) {
      showError(!editable ? "Plan is read-only." : "Past periods are view-only for Store users.");
      return;
    }
    try {
      await ensurePlanDraft();
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to create plan draft.");
      return;
    }
    if (rows.some((r) => r.fgItemId === id)) {
      showError("That FG item is already in the plan.");
      return;
    }
    let composition: RequirementCompositionResponse | null = requirementComposition;
    try {
      const ctx = await ensurePlanningContext();
      composition = ctx.composition;
    } catch {
      showError("Failed to load suggested production for this period.");
      return;
    }
    const suggested = suggestedProductionForFg(id, composition);
    const item = fgItems.find((i) => i.id === id);
    setRows((prev) => [
      ...prev,
      {
        key: `new-${id}-${Date.now()}`,
        fgItemId: id,
        fgItemName: item?.itemName ?? `Item ${id}`,
        unit: item?.unit ?? item?.unitName ?? null,
        suggestedFgQty: suggested,
        plannedFgQty: String(suggested),
        plannedQtyOverridden: false,
        source: "MANUAL",
        remarks: "",
      },
    ]);
    setAddItemId("");
  }

  async function onSave(options?: { confirmPastPeriod?: boolean }) {
    if (!editable || !canMutatePeriod) return;
    setSaving(true);
    try {
      const activePlan = await ensurePlanDraft(options);
      const upserts = rows.map((r) => ({
        fgItemId: r.fgItemId,
        plannedFgQty: num(r.plannedFgQty),
        plannedQtyOverridden: r.plannedQtyOverridden,
        source: r.source === "CUSTOMER_SCHEDULE" ? "MANUAL" : r.source,
        remarks: r.remarks?.trim() ? r.remarks.trim() : null,
      }));
      const body: {
        upserts: typeof upserts;
        deletes: number[];
        confirmPastPeriod?: true;
      } = { upserts, deletes: removedIds };
      if (options?.confirmPastPeriod) body.confirmPastPeriod = true;
      await apiFetch<ProductionLinesResponse>(`/api/monthly-planning/${activePlan.id}/production-lines`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      showSuccess("Production plan saved.");
      await loadPlan(period);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to save production plan.");
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmLock(options?: { confirmPastPeriod?: boolean }) {
    if (hasUnsavedProductionChanges) {
      showError(UNSAVED_PRODUCTION_PLAN_LOCK_MESSAGE);
      return;
    }
    setLocking(true);
    try {
      const activePlan = await ensurePlanDraft(options);
      const lockBody = options?.confirmPastPeriod ? { confirmPastPeriod: true as const } : {};
      const rm = await apiFetch<RmPlanningResponse>(`/api/monthly-planning/${activePlan.id}/lock`, {
        method: "POST",
        body: JSON.stringify(lockBody),
      });
      setRmPlanning(rm);
      showSuccess(
        formatLockSnapshotSuccessMessage({
          revision: rm.revision ?? rm.rmPlan?.revision,
          totalFgPlannedQty: rm.rmPlan?.totalFgPlannedQty,
          rmLines: rm.lines,
        }),
      );
      setConfirmLockOpen(false);
      await loadPlan(period);
      setActiveTab("rm");
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to lock plan.");
    } finally {
      setLocking(false);
    }
  }

  async function onCancelReopen(options?: { confirmPastPeriod?: boolean }) {
    if (!plan) return;
    setCancellingReopen(true);
    try {
      const body = options?.confirmPastPeriod ? { confirmPastPeriod: true as const } : {};
      await apiFetch<{ status: string; currentRevision: number }>(
        `/api/monthly-planning/${plan.id}/cancel-reopen`,
        { method: "POST", body: JSON.stringify(body) },
      );
      showSuccess(`Legacy plan restored to locked snapshot ${plan.currentRevision}.`);
      await loadPlan(period);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to cancel reopen.");
    } finally {
      setCancellingReopen(false);
    }
  }

  async function onReopen(options?: { confirmPastPeriod?: boolean }) {
    if (!plan) return;
    setReopening(true);
    try {
      const body = options?.confirmPastPeriod ? { confirmPastPeriod: true as const } : {};
      const res = await apiFetch<{ draftForRevision: number; currentRevision: number }>(
        `/api/monthly-planning/${plan.id}/reopen`,
        { method: "POST", body: JSON.stringify(body) },
      );
      showSuccess(
        `Legacy plan reopened — editing draft for lock snapshot ${res.draftForRevision}. Snapshot ${res.currentRevision} remains in history.`,
      );
      await loadPlan(period);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to reopen plan.");
    } finally {
      setReopening(false);
    }
  }

  async function refreshRm() {
    if (!plan) return;
    setLoadingRm(true);
    try {
      const rm = await apiFetch<RmPlanningResponse>(`/api/monthly-planning/${plan.id}/rm-planning`);
      setRmPlanning(rm);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to load RM Planning.");
    } finally {
      setLoadingRm(false);
    }
  }

  async function onConfirmRelease() {
    if (!plan) return;
    setReleasing(true);
    try {
      const releaseBody: { confirm: true; revision?: number } = { confirm: true };
      if (plan.currentRevision > 0) {
        releaseBody.revision = plan.currentRevision;
      }
      const summary = await apiFetch<ReleaseSummary>(`/api/monthly-planning/${plan.id}/release`, {
        method: "POST",
        body: JSON.stringify(releaseBody),
      });
      setReleaseSummary(summary);
      setConfirmReleaseOpen(false);
      showSuccess(
        formatReleaseSuccessSummary({
          plan: plan
            ? {
                id: plan.id,
                status: plan.status,
                currentRevision: plan.currentRevision,
                planSequenceNo: plan.planSequenceNo,
                planKind: plan.planKind,
                displayLabel: plan.displayLabel,
              }
            : null,
          releaseRevision: summary.revision,
          materialRequirementDocNo: summary.materialRequirementDocNo,
          releasedLineCount: summary.releasedLineCount,
          totalDeltaQty: summary.totalDeltaQty,
          skippedLineCount: summary.skippedLineCount,
          surplusLineCount: summary.surplusLineCount,
        }),
      );
      await refreshPurchase();
      await loadPlan(period);
    } catch (e) {
      const detail = e instanceof ApiRequestError ? e.message : null;
      showError(
        detail
          ? `Release failed. ${detail} Procurement demand was not created. Please try again.`
          : "Release failed. Procurement demand was not created. Please try again.",
      );
    } finally {
      setReleasing(false);
    }
  }

  async function refreshPurchase() {
    if (!plan) return;
    setLoadingPurchase(true);
    try {
      const pp = await apiFetch<PurchasePlanningResponse>(
        `/api/monthly-planning/${plan.id}/purchase-planning`,
      );
      setPurchasePlanning(pp);
      setReleaseSummary((prev) =>
        prev && pp.revision != null && prev.revision !== pp.revision ? null : prev,
      );
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to load Purchase Planning.");
    } finally {
      setLoadingPurchase(false);
    }
  }

  async function onSubmitForReview(options?: { confirmPastPeriod?: boolean }) {
    if (!plan) return;
    setSubmittingForReview(true);
    try {
      const body = options?.confirmPastPeriod ? { confirmPastPeriod: true as const } : {};
      await apiFetch(`/api/monthly-planning/${plan.id}/submit-for-review`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      showSuccess("Plan submitted for Purchase review.");
      await loadPlan(period, plan.id);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to submit plan for review.");
    } finally {
      setSubmittingForReview(false);
    }
  }

  async function onPurchaseApprove(options?: { confirmPastPeriod?: boolean }) {
    if (!plan) return;
    setApprovingPlan(true);
    try {
      const body = options?.confirmPastPeriod ? { confirmPastPeriod: true as const } : {};
      await apiFetch(`/api/monthly-planning/${plan.id}/purchase/approve`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      showSuccess("Plan approved.");
      await loadPlan(period, plan.id);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to approve plan.");
    } finally {
      setApprovingPlan(false);
    }
  }

  async function onPurchaseReject(options?: { confirmPastPeriod?: boolean }) {
    if (!plan) return;
    const reason = rejectReason.trim();
    if (!reason) {
      showError("Reject reason is required.");
      return;
    }
    setRejectingPlan(true);
    try {
      const body: { reason: string; confirmPastPeriod?: true } = { reason };
      if (options?.confirmPastPeriod) body.confirmPastPeriod = true;
      await apiFetch(`/api/monthly-planning/${plan.id}/purchase/reject`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      showSuccess("Plan rejected and returned to draft.");
      setRejectModalOpen(false);
      setRejectReason("");
      await loadPlan(period, plan.id);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to reject plan.");
    } finally {
      setRejectingPlan(false);
    }
  }

  async function loadAdditionalPlanPreview() {
    const periodKey = normalizePeriodKey(period);
    if (!periodKey) return;
    setLoadingAdditionalPreview(true);
    try {
      const preview = await apiFetch<AdditionalPlanPreview>(
        `/api/monthly-planning/periods/${encodeURIComponent(periodKey)}/additional-plan/preview`,
      );
      setAdditionalPreview(preview);
      setAdditionalPanelOpen(true);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to load additional plan preview.");
    } finally {
      setLoadingAdditionalPreview(false);
    }
  }

  async function onCreateAdditionalPlan(options?: { confirmPastPeriod?: boolean }) {
    const periodKey = normalizePeriodKey(period);
    if (!periodKey) return;
    setCreatingAdditionalPlan(true);
    try {
      const body = options?.confirmPastPeriod ? { confirmPastPeriod: true as const } : {};
      const created = await apiFetch<{ plan: PlanSummary }>(
        `/api/monthly-planning/periods/${encodeURIComponent(periodKey)}/additional-plan`,
        { method: "POST", body: JSON.stringify(body) },
      );
      showSuccess(`Created ${created.plan.displayLabel ?? "additional plan"}.`);
      setAdditionalPanelOpen(false);
      setAdditionalPreview(null);
      await loadPlan(periodKey, created.plan.id);
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to create additional plan.");
    } finally {
      setCreatingAdditionalPlan(false);
    }
  }

  // KPIs
  const activeLockSummary =
    rows.length > 0
      ? computeLockSummaryFromRows(rows, suggestedProductionMap)
      : lockSummary;
  const totalFgPlanned = activeLockSummary?.totalPlannedQty ?? rows.reduce((acc, r) => acc + num(r.plannedFgQty), 0);
  const totalFgSuggested = activeLockSummary?.totalSuggestedQty ?? 0;
  const totalFgItems = rows.length;
  const fgItemsWithVariance = activeLockSummary?.fgItemsWithVariance ?? 0;
  const canLock = workflowActions.lock;
  const hasUnsavedProductionChanges = React.useMemo(
    () => detectUnsavedProductionChanges(rows, removedIds, savedProductionBaseline),
    [rows, removedIds, savedProductionBaseline],
  );
  const plannedSuggestedMismatch = hasPlannedSuggestedMismatch(totalFgPlanned, totalFgSuggested);

  const availableFgForAdd = fgItems.filter((i) => !rows.some((r) => r.fgItemId === i.id));

  const fgRequirementBreakdown = React.useMemo(
    () =>
      computeProductionRequirementBreakdown(period, requirementComposition, rsSuggestions, totalFgPlanned),
    [period, requirementComposition, rsSuggestions, totalFgPlanned],
  );

  React.useEffect(() => {
    if (!planExists) return;
    let cancelled = false;
    void apiFetch<RequirementCompositionResponse>(
      `/api/monthly-planning/requirement-composition?periodKey=${encodeURIComponent(period)}`,
    )
      .then((res) => {
        if (!cancelled) setRequirementComposition(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [planExists, period]);

  React.useEffect(() => {
    if (activeTab !== "production" || !planExists) return;
    if (rsSuggestions?.periodKey === period) return;
    let cancelled = false;
    void apiFetch<RsSuggestionsResponse>(
      `/api/monthly-planning/rs-suggestions?periodKey=${encodeURIComponent(period)}`,
    )
      .then((res) => {
        if (!cancelled) setRsSuggestions(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeTab, planExists, period, rsSuggestions?.periodKey]);

  if (flagsLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  if (!flags.monthlyPlanning) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <CalendarRange className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-3 text-lg font-semibold text-slate-900">Monthly Planning is not available</h2>
          <p className="mt-1 text-sm text-slate-600">
            This workspace is disabled in this environment. Enable the <code>FEATURE_MONTHLY_PLANNING</code>{" "}
            flag on the backend to use it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2 sm:p-3">
      {/* Header */}
      <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Plan period
            </label>
            <Input
              type="month"
              value={period}
              onChange={(e) => applyPeriod(e.target.value)}
              className="h-8 w-[160px]"
            />
          </div>

          {shouldShowPlanSelector(periodPlans) ? (
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Plan document
              </label>
              <NativeSelect
                value={String(selectedPlanId ?? plan?.id ?? "")}
                onChange={(e) => onSelectPlan(Number(e.target.value))}
                className="h-8 min-w-[200px]"
                disabled={loading || periodPlans.length <= 1}
              >
                {periodPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {resolvePlanDisplayLabel(p)} · {formatPlanKindLabel(p.planKind)} ·{" "}
                    {formatPlanStatusLabel(p.status)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}

          {planExists && plan ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <Badge variant={planStatusBadgeVariant(plan.status)} className="text-[11px]">
                {formatPlanStatusLabel(plan.status)}
              </Badge>
              {!shouldShowPlanSelector(periodPlans) ? (
                <span className="text-[12px] font-semibold text-slate-800">
                  {resolvePlanDisplayLabel(plan)}
                </span>
              ) : null}
              {isLegacyPlan ? (
                <span className="inline-flex items-center gap-0.5" title={LEGACY_PLAN_INFO_TOOLTIP}>
                  <Badge variant="warning" className="text-[11px]">
                    {LEGACY_PLAN_BADGE_LABEL}
                  </Badge>
                  <CircleHelp className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
                  <span className="sr-only">{LEGACY_PLAN_INFO_TOOLTIP}</span>
                </span>
              ) : null}
              {plan.planKind ? (
                <Badge variant="default" className="text-[11px]">
                  {formatPlanKindLabel(plan.planKind)}
                </Badge>
              ) : null}
              {isHistoricalPlanDocument(plan, periodPlans) ? (
                <Badge variant="default" className="text-[11px]">
                  Historical
                </Badge>
              ) : null}
              {isDraftForNextRevision ? (
                <span className="text-[11px] text-blue-800">
                  Draft for snapshot {plan.currentRevision + 1}
                </span>
              ) : null}
              <span className="text-[11px] text-slate-500">
                {[
                  plan.docNo,
                  isLegacyPlan ? `Snapshot ${plan.currentRevision}` : null,
                  plan.lockedAt
                    ? `Submitted ${new Date(plan.lockedAt).toLocaleDateString()}`
                    : null,
                  plan.createdAt ? `Created ${new Date(plan.createdAt).toLocaleDateString()}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          ) : (
            <span className="text-[12px] text-slate-500">No production plan created yet.</span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadPlan(period)}
              disabled={loading}
              className="h-8 px-2.5"
            >
              <RefreshCw className={cn("mr-1 h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
            {workflowActions.save ? (
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  runWithPastPeriodGuard(() =>
                    onSave(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined),
                  )
                }
                disabled={saving}
                className="h-8 px-2.5"
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save changes"}
              </Button>
            ) : null}
            {workflowActions.submitForReview ? (
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={() =>
                  runWithPastPeriodGuard(() =>
                    onSubmitForReview(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined),
                  )
                }
                disabled={submittingForReview || saving}
                className="h-8 bg-indigo-700 px-2.5 hover:bg-indigo-800"
              >
                <Send className="mr-1 h-3.5 w-3.5" />
                {submittingForReview ? "Submitting…" : "Submit For Purchase Review"}
              </Button>
            ) : null}
            {workflowActions.approve ? (
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  runWithPastPeriodGuard(() =>
                    onPurchaseApprove(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined),
                  )
                }
                disabled={approvingPlan || loading}
                className="h-8 bg-emerald-700 px-2.5 hover:bg-emerald-800"
              >
                <CheckCircle className="mr-1 h-3.5 w-3.5" />
                {approvingPlan ? "Approving…" : "Approve"}
              </Button>
            ) : null}
            {workflowActions.reject ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRejectModalOpen(true)}
                disabled={rejectingPlan || loading}
                className="h-8 border-red-300 px-2.5 text-red-800 hover:bg-red-50"
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                Reject
              </Button>
            ) : null}
            {workflowActions.release ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setConfirmReleaseOpen(true)}
                disabled={releasing || loading}
                className="h-8 bg-sky-700 px-2.5 hover:bg-sky-800"
              >
                <PackagePlus className="mr-1 h-3.5 w-3.5" />
                Release To Procurement
              </Button>
            ) : null}
            {showLegacyWorkflowActions ? (
              <div
                className="flex flex-wrap items-center gap-1 rounded border border-amber-200 bg-amber-50/50 px-1.5 py-0.5"
                title={LEGACY_PLAN_INFO_TOOLTIP}
              >
                <span className="text-[9px] font-bold uppercase tracking-wide text-amber-900">Legacy</span>
                {workflowActions.lock ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={() => runWithPastPeriodGuard(() => Promise.resolve(setConfirmLockOpen(true)))}
                    disabled={!canLock || saving || hasUnsavedProductionChanges}
                    title={
                      hasUnsavedProductionChanges
                        ? UNSAVED_PRODUCTION_PLAN_LOCK_MESSAGE
                        : canLock
                          ? "Lock legacy plan and generate RM Planning snapshot"
                          : "Add a planned qty > 0 to lock"
                    }
                    className="h-8 bg-amber-700 px-2 hover:bg-amber-800"
                  >
                    <Lock className="mr-1 h-3.5 w-3.5" />
                    Lock Plan
                  </Button>
                ) : null}
                {workflowActions.reopen ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      runWithPastPeriodGuard(() =>
                        onReopen(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined),
                      )
                    }
                    disabled={reopening || loading}
                    className="h-8 border-amber-400 px-2 text-amber-950 hover:bg-amber-100"
                  >
                    <Unlock className="mr-1 h-3.5 w-3.5" />
                    {reopening ? "Reopening…" : "Reopen Plan"}
                  </Button>
                ) : null}
                {workflowActions.cancelReopen ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      runWithPastPeriodGuard(() =>
                        onCancelReopen(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined),
                      )
                    }
                    disabled={cancellingReopen || loading || saving}
                    className="h-8 border-slate-300 px-2 text-slate-800 hover:bg-slate-50"
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    {cancellingReopen ? "Cancelling…" : "Cancel Reopen"}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {showAdditionalPlanEntry ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void loadAdditionalPlanPreview()}
                disabled={loadingAdditionalPreview}
                className="h-8 px-2.5"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {loadingAdditionalPreview ? "Loading…" : "Additional Plan"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {periodIsPast && !isAdmin ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900">
          <strong>Past period.</strong> Planning actions are disabled.
        </div>
      ) : null}
      {periodIsPast && isAdmin ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900">
          <strong>Past period ({period}).</strong> Admin confirmation required for changes.
        </div>
      ) : null}

      {isDraftForNextRevision ? (
        <div
          className="rounded-md border-2 border-blue-400 bg-blue-50 px-3 py-2 text-[12px] font-medium leading-snug text-blue-950 shadow-sm"
          role="status"
        >
          {LEGACY_REOPEN_DRAFT_PRODUCTION_GUIDANCE}
        </div>
      ) : null}

      {plan?.status === "DRAFT" && !plan.purchaseRejectReason && !isLegacyPlan ? (
        <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] leading-snug text-blue-900">
          <strong>Draft plan document.</strong> Store owns FG edits until Purchase review.
        </div>
      ) : null}

      {plan?.status === "AWAITING_PURCHASE_REVIEW" ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900">
          <strong>Awaiting Purchase review.</strong> FG lines are read-only until approved or rejected.
        </div>
      ) : null}

      {historicalPlanBanner ? (
        <div className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] leading-snug text-slate-800">
          {historicalPlanBanner}
        </div>
      ) : null}

      {plan?.status === "APPROVED" && !isLegacyPlan ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] leading-snug text-emerald-900">
          <strong>Approved plan document.</strong>{" "}
          {approvedPlanGuidanceMessage({ canCreateAdditionalPlan: showAdditionalPlanEntry })}
          {plan.releasedAt ? (
            <span className="text-emerald-800">
              {" "}
              · Demand released — review under Purchase Planning.
            </span>
          ) : (
            <span className="text-emerald-800">
              {" "}
              · Release procurement demand from Purchase Planning when ready.
            </span>
          )}
        </div>
      ) : null}

      {plan?.status === "DRAFT" && plan.purchaseRejectReason ? (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] leading-snug text-red-900">
          <strong>Purchase rejected:</strong> {plan.purchaseRejectReason}
          <span className="text-red-800"> · Store can edit and resubmit.</span>
        </div>
      ) : null}

      {/* Production requirement summary */}
      {planExists ? (
        <ProductionRequirementBreakdownCard breakdown={fgRequirementBreakdown} period={period} />
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard label="Total FG planned" value={totalFgPlanned.toLocaleString()} />
        <KpiCard label="Total FG suggested" value={totalFgSuggested.toLocaleString()} />
        <KpiCard label="FG items with variance" value={String(fgItemsWithVariance)} />
        <KpiCard label="Status" value={formatPlanStatusLabel(plan?.status)} />
      </div>

      {/* Tabs */}
      <div className="-mt-0.5 flex items-center gap-0.5 border-b border-slate-200">
        <TabButton active={activeTab === "production"} onClick={() => setActiveTab("production")}>
          Production Plan
        </TabButton>
        <TabButton
          active={activeTab === "rm"}
          disabled={!rmPurchaseTabsEnabled}
          title={
            rmPurchaseTabsEnabled
              ? undefined
              : rmPurchaseEmptyMessage(plan?.status, "rm")
          }
          onClick={() => setActiveTab("rm")}
        >
          {RM_REQUIREMENT_SNAPSHOT_TAB_LABEL}
        </TabButton>
        <TabButton
          active={activeTab === "purchase"}
          disabled={!rmPurchaseTabsEnabled}
          title={
            rmPurchaseTabsEnabled
              ? undefined
              : rmPurchaseEmptyMessage(plan?.status, "purchase")
          }
          onClick={() => setActiveTab("purchase")}
        >
          Purchase Planning
        </TabButton>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1">
        {activeTab === "purchase" ? (
          <PurchasePlanningTab
            data={purchasePlanning}
            plan={plan}
            loading={loadingPurchase}
            onRefresh={() => void refreshPurchase()}
            onRelease={() => setConfirmReleaseOpen(true)}
            releaseSummary={releaseSummary}
            showReleaseButton={workflowActions.release}
            planStatus={plan?.status}
          />
        ) : activeTab === "rm" ? (
          <RmPlanningTab
            data={rmPlanning}
            loading={loadingRm}
            onRefresh={() => void refreshRm()}
            plan={plan}
            planStatus={plan?.status}
          />
        ) : !planExists ? (
          <NoPlanPreviewPanel
            period={period}
            loading={loading}
            canStartPlanning={canMutatePeriod}
            periodIsPast={periodIsPast}
            startingPlanning={startingPlanning}
            addingSuggested={addingSuggested}
            onStartPlanning={() =>
              runWithPastPeriodGuard(() =>
                onStartPlanning(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined),
              )
            }
            onAddSuggestedItems={() =>
              runWithPastPeriodGuard(() =>
                onAddSuggestedItemsToPlan(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined),
              )
            }
          />
        ) : (
          <ProductionPlanTab
            rows={rows}
            editable={editable}
            readOnlyMessage={productionPlanReadOnlyMessage(plan, {
              periodPlans,
              canCreateAdditionalPlan: showAdditionalPlanEntry,
            })}
            period={period}
            rsSuggestions={rsSuggestions}
            rsSuggestionsVisible={rsSuggestionsVisible}
            loadingRsSuggestions={loadingRsSuggestions}
            onLoadRsSuggestions={() => void loadRsSuggestions()}
            onHideRsSuggestions={() => setRsSuggestionsVisible(false)}
            onApplyRsSuggestion={(item) => void applyRsSuggestion(item)}
            onUpdateRow={updateRow}
            onRemoveRow={removeRow}
            availableFgForAdd={availableFgForAdd}
            addItemId={addItemId}
            setAddItemId={setAddItemId}
            onAddRow={() => void addRow()}
            suggestedProductionMap={suggestedProductionMap}
            greenContextMap={greenContextMap}
          />
        )}
      </div>

      <GreenLevelSection
        period={period}
        data={greenLevels}
        panelExpanded={greenLevelAuditExpanded}
        visible={greenLevelsVisible}
        loading={loadingGreenLevels}
        onTogglePanel={() => {
          setGreenLevelAuditExpanded((open) => {
            const next = !open;
            if (next && !greenLevels && !loadingGreenLevels) void loadGreenLevels();
            return next;
          });
        }}
        onLoad={() => void loadGreenLevels()}
      />

      <RequirementCompositionSection
        period={period}
        data={requirementComposition}
        panelExpanded={planningAuditExpanded}
        visible={requirementCompositionVisible}
        loading={loadingRequirementComposition}
        onTogglePanel={() => {
          setPlanningAuditExpanded((open) => {
            const next = !open;
            if (next && !requirementCompositionVisible && !loadingRequirementComposition) {
              void loadRequirementComposition();
            }
            return next;
          });
        }}
        onLoad={() => void loadRequirementComposition()}
      />

      <RmRequirementCompositionSection
        period={period}
        data={rmRequirementComposition}
        panelExpanded={rmAuditExpanded}
        visible={rmRequirementCompositionVisible}
        loading={loadingRmRequirementComposition}
        onTogglePanel={() => {
          setRmAuditExpanded((open) => {
            const next = !open;
            if (next && !rmRequirementCompositionVisible && !loadingRmRequirementComposition) {
              void loadRmRequirementComposition();
            }
            return next;
          });
        }}
        onLoad={() => void loadRmRequirementComposition()}
      />

      {planExists && plan && isLegacyPlan ? (
        <RevisionHistorySection
          data={planRevisions}
          loading={loadingRevisions}
          panelExpanded={revisionHistoryExpanded}
          onTogglePanel={() => setRevisionHistoryExpanded((open) => !open)}
          expandedRevision={expandedRevision}
          onToggleRevision={(rev) => setExpandedRevision((cur) => (cur === rev ? null : rev))}
        />
      ) : null}

      {confirmLockOpen ? (
        <LockConfirmModal
          lockSummary={activeLockSummary}
          totalFgItems={totalFgItems}
          period={period}
          locking={locking}
          hasUnsavedProductionChanges={hasUnsavedProductionChanges}
          plannedSuggestedMismatch={plannedSuggestedMismatch}
          onCancel={() => setConfirmLockOpen(false)}
          onConfirm={() => void onConfirmLock(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined)}
        />
      ) : null}

      {applySuggestedOverrideConfirm ? (
        <ApplySuggestedOverrideConfirmModal
          itemName={applySuggestedOverrideConfirm.itemName}
          message={formatApplySuggestedOverrideConfirmMessage(
            applySuggestedOverrideConfirm.plannedQty,
            applySuggestedOverrideConfirm.suggestedQty,
          )}
          onCancel={cancelApplySuggestedOverrideReplace}
          onConfirm={confirmApplySuggestedOverrideReplace}
        />
      ) : null}

      {pastPeriodConfirmOpen ? (
        <PastPeriodConfirmModal
          period={period}
          confirming={confirmingPastPeriod}
          onCancel={() => {
            setPastPeriodConfirmOpen(false);
            pastPeriodActionRef.current = null;
          }}
          onConfirm={() => {
            const action = pastPeriodActionRef.current;
            if (!action) {
              setPastPeriodConfirmOpen(false);
              return;
            }
            setConfirmingPastPeriod(true);
            void action()
              .catch((e) => {
                showError(e instanceof ApiRequestError ? e.message : "Action failed.");
              })
              .finally(() => {
                setConfirmingPastPeriod(false);
                setPastPeriodConfirmOpen(false);
                pastPeriodActionRef.current = null;
              });
          }}
        />
      ) : null}

      {confirmReleaseOpen ? (
        <ReleaseConfirmModal
          plan={plan}
          snapshotRevision={purchasePlanning?.revision ?? null}
          data={purchasePlanning}
          releasing={releasing}
          onCancel={() => setConfirmReleaseOpen(false)}
          onConfirm={() => void onConfirmRelease()}
        />
      ) : null}

      {rejectModalOpen ? (
        <PurchaseRejectModal
          reason={rejectReason}
          rejecting={rejectingPlan}
          onReasonChange={setRejectReason}
          onCancel={() => {
            setRejectModalOpen(false);
            setRejectReason("");
          }}
          onConfirm={() =>
            runWithPastPeriodGuard(() =>
              onPurchaseReject(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined),
            )
          }
        />
      ) : null}

      {additionalPanelOpen && additionalPreview ? (
        <AdditionalPlanPreviewModal
          preview={additionalPreview}
          creating={creatingAdditionalPlan}
          onClose={() => {
            setAdditionalPanelOpen(false);
            setAdditionalPreview(null);
          }}
          onCreate={() =>
            runWithPastPeriodGuard(() =>
              onCreateAdditionalPlan(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined),
            )
          }
        />
      ) : null}
    </div>
  );
}

function PurchaseRejectModal({
  reason,
  rejecting,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  reason: string;
  rejecting: boolean;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">Reject Plan</h3>
        <p className="mt-2 text-[13px] text-slate-600">
          Return this plan to draft for Store correction. A reason is required.
        </p>
        <textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          rows={4}
          className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Explain what Store should correct…"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={rejecting}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            disabled={rejecting || !reason.trim()}
            className="bg-red-700 hover:bg-red-800"
          >
            {rejecting ? "Rejecting…" : "Reject Plan"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AdditionalPlanPreviewModal({
  preview,
  creating,
  onClose,
  onCreate,
}: {
  preview: AdditionalPlanPreview;
  creating: boolean;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Additional Plan Preview</h3>
            <p className="mt-1 text-[13px] text-slate-600">
              Next document: <strong>{preview.nextPlanLabel}</strong> ({preview.nextPlanKind})
            </p>
            <p className="mt-1 text-[12px] text-slate-500">
              Covers the remaining requirement gap after {preview.approvedPlanCount} approved plan
              {preview.approvedPlanCount === 1 ? "" : "s"} in this period. Only delta FG quantities are stored in the
              new plan document.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-slate-500">Additional qty</div>
            <div className="text-lg font-bold tabular-nums">
              {preview.totals.totalAdditionalRequirementQty.toLocaleString()}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-slate-500">FG items</div>
            <div className="text-lg font-bold tabular-nums">{preview.totals.additionalItemCount}</div>
          </div>
        </div>
        {!preview.canCreate && preview.blockingReason ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            <strong>{preview.blockingCode ?? "BLOCKED"}:</strong> {preview.blockingReason}
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={creating}>
            Close
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onCreate}
            disabled={creating || !preview.canCreate}
            className="bg-indigo-700 hover:bg-indigo-800"
          >
            {creating ? "Creating…" : `Create ${preview.nextPlanLabel}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReleaseConfirmModal({
  plan,
  snapshotRevision,
  data,
  releasing,
  onCancel,
  onConfirm,
}: {
  plan: PlanSummary | null;
  snapshotRevision: number | null;
  data: PurchasePlanningResponse | null;
  releasing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const lines = data?.lines ?? [];
  const totalRmItems = lines.length;
  const totalAdditional = resolveAdditionalRequirementTotal(data?.totals, lines);
  const canConfirmRelease = isReleaseDeltaButtonEnabled(totalAdditional);
  const planHeader = plan
    ? {
        id: plan.id,
        status: plan.status,
        currentRevision: plan.currentRevision,
        planSequenceNo: plan.planSequenceNo,
        planKind: plan.planKind,
        displayLabel: plan.displayLabel,
      }
    : null;
  const releaseContextLabel =
    planHeader && usesPlanDocumentProcurementUx(planHeader)
      ? resolvePlanDisplayLabel(planHeader)
      : snapshotRevision != null && snapshotRevision > 0
        ? `Legacy snapshot ${snapshotRevision}`
        : "—";
  const releaseContextCaption =
    planHeader && usesPlanDocumentProcurementUx(planHeader) ? "Plan document" : "Legacy snapshot";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <h3 className="text-base font-semibold text-slate-900">Release Delta to Procurement</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {releaseContextCaption}
            </div>
            <div className="text-lg font-bold tabular-nums text-slate-900">{releaseContextLabel}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">RM items</div>
            <div className="text-lg font-bold tabular-nums text-slate-900">{totalRmItems}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Additional qty</div>
            <div className="text-lg font-bold tabular-nums text-slate-900">{totalAdditional.toLocaleString()}</div>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
          Only the procurement <strong>delta</strong> will be released as new{" "}
          {MP_PROCUREMENT.DEMAND_RELEASED.toLowerCase()} into the Material Requirement flow (existing{" "}
          {MP_PROCUREMENT.DEMAND_RELEASED.toLowerCase()} is not duplicated). Releasing again with no new demand
          emits nothing.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={releasing}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={releasing || !canConfirmRelease}
            className="bg-sky-700 hover:bg-sky-800"
          >
            {releasing ? "Releasing…" : "Release Delta to Procurement"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LockConfirmModal({
  lockSummary,
  totalFgItems,
  period,
  locking,
  hasUnsavedProductionChanges,
  plannedSuggestedMismatch,
  onCancel,
  onConfirm,
}: {
  lockSummary: LockSummary | null;
  totalFgItems: number;
  period: string;
  locking: boolean;
  hasUnsavedProductionChanges: boolean;
  plannedSuggestedMismatch: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [plannedMismatchAcknowledged, setPlannedMismatchAcknowledged] = React.useState(false);
  React.useEffect(() => {
    setPlannedMismatchAcknowledged(false);
  }, [period, plannedSuggestedMismatch, hasUnsavedProductionChanges]);

  const totalPlannedQty = lockSummary?.totalPlannedQty ?? 0;
  const totalSuggestedQty = lockSummary?.totalSuggestedQty ?? 0;
  const varianceCount = lockSummary?.fgItemsWithVariance ?? 0;
  const confirmDisabled =
    locking ||
    hasUnsavedProductionChanges ||
    (plannedSuggestedMismatch && !plannedMismatchAcknowledged);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Lock className="h-4 w-4" />
            </span>
            <h3 className="text-base font-semibold text-slate-900">Lock legacy monthly plan</h3>
          </div>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total suggested</div>
            <div className="text-lg font-bold tabular-nums text-slate-900">
              {(lockSummary?.totalSuggestedQty ?? 0).toLocaleString()}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total planned</div>
            <div className="text-lg font-bold tabular-nums text-slate-900">
              {(lockSummary?.totalPlannedQty ?? 0).toLocaleString()}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total variance</div>
            <div className="text-lg font-bold tabular-nums text-slate-900">
              {(lockSummary?.totalVarianceQty ?? 0).toLocaleString()}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">FG items</div>
            <div className="text-lg font-bold tabular-nums text-slate-900">{totalFgItems}</div>
          </div>
        </div>

        {hasUnsavedProductionChanges ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-900">
            {UNSAVED_PRODUCTION_PLAN_LOCK_MESSAGE}
          </p>
        ) : null}

        {!hasUnsavedProductionChanges && plannedSuggestedMismatch ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            <p>{formatPlannedSuggestedLockWarning(totalPlannedQty, totalSuggestedQty)} Continue?</p>
            <label className="mt-2 flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={plannedMismatchAcknowledged}
                onChange={(e) => setPlannedMismatchAcknowledged(e.target.checked)}
              />
              <span>I understand — lock using planned production totals.</span>
            </label>
          </div>
        ) : null}

        {!hasUnsavedProductionChanges && !plannedSuggestedMismatch && varianceCount > 0 ? (
          <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
            Planned quantities differ from recommendations for <strong>{varianceCount}</strong> FG item
            {varianceCount === 1 ? "" : "s"} at line level, but total planned matches total suggested.
          </p>
        ) : null}

        <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
          <strong>{LEGACY_REVISION_WORKFLOW_LABEL}.</strong> Locking <strong>{period}</strong> will freeze the
          production plan and generate an immutable RM Planning snapshot (BOM explosion + stock position at lock).
          The production plan becomes read-only under this legacy workflow. This does not create purchase or
          procurement records. For new planning periods, use plan documents (Plan 1, Plan 2, …) instead of lock
          snapshots.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={locking}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="bg-amber-700 hover:bg-amber-800"
          >
            <Lock className="mr-1.5 h-4 w-4" />
            {locking ? "Locking…" : "Lock & generate"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RmPlanningTab({
  data,
  loading,
  onRefresh,
  plan,
  planStatus,
}: {
  data: RmPlanningResponse | null;
  loading: boolean;
  onRefresh: () => void;
  plan: PlanSummary | null;
  planStatus?: PlanStatus;
}) {
  if (loading && !data) {
    return <div className="p-6 text-sm text-slate-500">Loading {RM_REQUIREMENT_SNAPSHOT_TAB_LABEL}…</div>;
  }
  if (!data || !data.locked || !data.exists) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
        <p className="text-sm text-slate-500">{rmPurchaseEmptyMessage(planStatus, "rm")}</p>
      </div>
    );
  }

  const lines = data.lines;
  const totalRmItems = lines.length;
  const totalGross = lines.reduce((a, l) => a + num(l.grossDemandQty), 0);
  const totalNet = lines.reduce((a, l) => a + num(l.netRequirementQty), 0);
  const criticalShortage = lines.filter((l) => num(l.netRequirementQty) > 0).length;
  const coveredItems = lines.filter((l) => num(l.netRequirementQty) <= 0).length;
  const coveragePct = totalRmItems > 0 ? Math.round((coveredItems / totalRmItems) * 100) : 0;

  const planHeader = plan
    ? {
        id: plan.id,
        status: plan.status,
        currentRevision: plan.currentRevision,
        planSequenceNo: plan.planSequenceNo,
        planKind: plan.planKind,
        displayLabel: plan.displayLabel,
      }
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-[12px] text-slate-800">
        <strong>{RM_SNAPSHOT_BANNER.title}.</strong> {RM_SNAPSHOT_BANNER.body}
      </div>

      <MonthlyPlanningMetricSection
        title={RM_SNAPSHOT_BANNER.title}
        subtitle="Stock position and net requirement captured at plan approval — not live inventory."
        traceLabel="Frozen snapshot"
        variant="snapshot"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <KpiCard label="Total RM items" value={String(totalRmItems)} />
          <KpiCard label="Snapshot gross demand" value={totalGross.toLocaleString()} />
          <KpiCard label={MP_PROCUREMENT.REQUIREMENT_SNAPSHOT} value={totalNet.toLocaleString()} tier="primary" />
          <KpiCard label="Snapshot shortages" value={String(criticalShortage)} />
          <KpiCard label="Snapshot coverage %" value={`${coveragePct}%`} />
        </div>
      </MonthlyPlanningMetricSection>

      <div className="flex items-center justify-between">
        <span className="text-[12px] text-slate-500">
          {formatRmSnapshotContextLabel({
            plan: planHeader,
            snapshotRevision: data.revision,
            lineCount: lines.length,
          })}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="h-8">
          <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">RM item</th>
              <th className="px-3 py-2 w-20">Unit</th>
              <th className="px-3 py-2 w-28 text-right">Snapshot gross demand</th>
              <th className="px-3 py-2 w-24 text-right">Snapshot free stock</th>
              <th className="px-3 py-2 w-24 text-right">Snapshot reserved</th>
              <th className="px-3 py-2 w-28 text-right">Snapshot incoming PO</th>
              <th className="px-3 py-2 w-28 text-right">Snapshot net requirement</th>
              <th className="px-3 py-2">Warnings</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">
                  {rmPlanningEmptyTableMessage(planHeader)}
                </td>
              </tr>
            ) : (
              lines.map((l) => {
                const net = num(l.netRequirementQty);
                return (
                  <tr key={l.id} className="border-t border-slate-100 align-middle">
                    <td className="px-3 py-1.5 font-medium text-slate-800">{l.rmItemName ?? `Item ${l.rmItemId}`}</td>
                    <td className="px-3 py-1.5 text-slate-500">{l.unit ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {num(l.grossDemandQty).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                      {num(l.freeStockSnapshot).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                      {num(l.reservedSnapshot).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                      {num(l.incomingPoSnapshot).toLocaleString()}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right font-semibold tabular-nums",
                        net > 0 ? "text-red-700" : "text-emerald-700",
                      )}
                    >
                      {net.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {l.belowMinStockFlag ? <Badge variant="warning">Below min stock</Badge> : null}
                        {l.leadTimeRiskFlag ? <Badge variant="warning">Lead-time risk</Badge> : null}
                        {(l.warnings ?? []).map((w, i) => (
                          <span
                            key={i}
                            title={formatOperationalWarningMessage(w)}
                            className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {formatOperationalWarningMessage(w)}
                          </span>
                        ))}
                        {!l.belowMinStockFlag && !l.leadTimeRiskFlag && (l.warnings ?? []).length === 0 ? (
                          <span className="text-[12px] text-slate-400">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RevisionHistorySection({
  data,
  loading,
  panelExpanded,
  onTogglePanel,
  expandedRevision,
  onToggleRevision,
}: {
  data: PlanRevisionsResponse | null;
  loading: boolean;
  panelExpanded: boolean;
  onTogglePanel: () => void;
  expandedRevision: number | null;
  onToggleRevision: (revision: number) => void;
}) {
  const revisions = data?.revisions ?? [];

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/40 p-2 shadow-sm">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-950">
        {LEGACY_REVISION_WORKFLOW_LABEL}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <History className="h-3.5 w-3.5 text-slate-500" />
          <h3 className="text-[12px] font-semibold text-slate-800">
            Legacy lock history{revisions.length > 0 ? ` (${revisions.length})` : ""}
          </h3>
          {loading ? <span className="text-[11px] text-slate-400">Loading…</span> : null}
        </div>
        {revisions.length > 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={onTogglePanel} className="h-8">
            {panelExpanded ? "Hide Details" : "Expand"}
          </Button>
        ) : !loading ? (
          <span className="text-[11px] text-slate-500">
            Legacy lock history appears after the first plan lock.
          </span>
        ) : null}
      </div>

      {panelExpanded && revisions.length > 0 ? (
        <>
      {data?.draftForRevision != null ? (
        <p className="mb-1 mt-1 text-[10px] leading-tight text-slate-600">
          <strong>Snapshot {data.currentRevision}</strong> is the current legacy lock. Draft edits are preparing{" "}
          <strong>snapshot {data.draftForRevision}</strong>.
        </p>
      ) : null}

        <div className="mt-1 overflow-auto rounded border border-slate-100 bg-white">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2 w-24">Snapshot</th>
                <th className="px-3 py-2">Locked at</th>
                <th className="px-3 py-2">Locked by</th>
                <th className="px-3 py-2 w-32 text-right">Total FG planned</th>
                <th className="px-3 py-2 w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((rev) => {
                const expanded = expandedRevision === rev.revision;
                return (
                  <React.Fragment key={rev.revision}>
                    <tr
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/80"
                      onClick={() => onToggleRevision(rev.revision)}
                    >
                      <td className="px-2 py-2 text-slate-400">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">Snapshot {rev.revision}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {rev.lockedAt ? new Date(rev.lockedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{rev.lockedByName ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                        {num(rev.totalFgPlannedQty).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {rev.isCurrent ? (
                            <Badge variant="warning">Current legacy snapshot</Badge>
                          ) : (
                            <Badge variant="default">Historical</Badge>
                          )}
                          {rev.released ? <Badge variant="info">Released</Badge> : null}
                          {rev.hasRmSnapshot ? (
                            <span className="text-[10px] text-slate-400">RM planning snapshot</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-t border-slate-50 bg-slate-50/50">
                        <td colSpan={6} className="px-3 py-2">
                          <p className="mb-2 text-[11px] font-medium text-slate-600">
                            Production plan at legacy lock (snapshot {rev.revision})
                          </p>
                          <table className="w-full border-collapse text-[12px]">
                            <thead className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-2 py-1">FG item</th>
                                <th className="px-2 py-1 w-16">Unit</th>
                                <th className="px-2 py-1 w-24 text-right">Suggested</th>
                                <th className="px-2 py-1 w-24 text-right">Planned</th>
                                <th className="px-2 py-1 w-20">Override</th>
                                <th className="px-2 py-1">Remarks</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rev.fgLines.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="px-2 py-3 text-center text-slate-400">
                                    FG snapshot not available for this legacy lock snapshot.
                                  </td>
                                </tr>
                              ) : (
                                rev.fgLines.map((line) => (
                                  <tr key={`${rev.revision}-${line.fgItemId}`} className="border-t border-slate-100">
                                    <td className="px-2 py-1 font-medium text-slate-800">
                                      {line.itemName ?? `#${line.fgItemId}`}
                                    </td>
                                    <td className="px-2 py-1 text-slate-500">{line.unit ?? "—"}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">
                                      {num(line.suggestedFgQty).toLocaleString()}
                                    </td>
                                    <td className="px-2 py-1 text-right tabular-nums font-medium">
                                      {num(line.plannedFgQty).toLocaleString()}
                                    </td>
                                    <td className="px-2 py-1">{line.plannedQtyOverridden ? "Yes" : "—"}</td>
                                    <td className="px-2 py-1 text-slate-600">{line.remarks ?? "—"}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tier = "secondary",
}: {
  label: string;
  value: string;
  tier?: "primary" | "secondary";
}) {
  if (tier === "primary") {
    return (
      <div className="rounded-md border-2 border-slate-300 bg-white px-2.5 py-1.5 shadow-sm">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-700">{label}</div>
        <div className="mt-0.5 text-lg font-extrabold tabular-nums text-slate-950">{value}</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-slate-200 bg-white/90 px-2.5 py-1 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

function MonthlyPlanningMetricSection({
  title,
  subtitle,
  traceLabel,
  variant,
  children,
  compact,
}: {
  title: string;
  subtitle: string;
  traceLabel: "Frozen snapshot" | "Live procurement";
  variant: "snapshot" | "live";
  children: React.ReactNode;
  compact?: boolean;
}) {
  const shell =
    variant === "snapshot"
      ? "border-slate-300 bg-slate-50/70"
      : "border-sky-300 bg-sky-50/50";
  const badgeCls =
    variant === "snapshot" ? "bg-slate-200 text-slate-800" : "bg-sky-200 text-sky-900";
  return (
    <section className={cn("rounded-md border", compact ? "p-2" : "p-3", shell)}>
      <div className={compact ? "mb-1" : "mb-2"}>
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className={cn("font-bold text-slate-900", compact ? "text-[12px]" : "text-[13px]")}>{title}</h3>
          <span className={cn("rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide", badgeCls)}>
            {traceLabel}
          </span>
        </div>
        <p className={cn("text-slate-600", compact ? "mt-0.5 text-[10px] leading-tight" : "mt-1 text-[11px] leading-snug")}>
          {subtitle}
        </p>
      </div>
      {children}
    </section>
  );
}

function TabButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "-mb-px border-b-2 px-2.5 py-1.5 text-[12px] font-semibold transition-colors",
        active
          ? "border-blue-700 text-blue-800"
          : disabled
            ? "cursor-not-allowed border-transparent text-slate-300"
            : "border-transparent text-slate-600 hover:text-slate-900",
      )}
    >
      {children}
    </button>
  );
}

const PURCHASE_STATUS_META = MP_RELEASE_STATUS_META;

function PurchasePlanningTab({
  data,
  plan,
  loading,
  onRefresh,
  onRelease,
  releaseSummary,
  showReleaseButton,
  planStatus,
}: {
  data: PurchasePlanningResponse | null;
  plan: PlanSummary | null;
  loading: boolean;
  onRefresh: () => void;
  onRelease: () => void;
  releaseSummary: ReleaseSummary | null;
  showReleaseButton: boolean;
  planStatus?: PlanStatus;
}) {
  if (loading && !data) {
    return <div className="p-6 text-sm text-slate-500">Loading Purchase Planning…</div>;
  }
  if (!data || !data.locked || !data.exists) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
        <p className="text-sm text-slate-500">{rmPurchaseEmptyMessage(planStatus, "purchase")}</p>
      </div>
    );
  }

  const lines = data.lines;
  const totalRmItems = data.totals?.rmItemCount ?? lines.length;
  const totalCurrent =
    data.totals?.currentRequirementTotal ??
    lines.reduce((a, l) => a + num(l.currentRequirementQty ?? l.netRequirementQty), 0);
  const totalReleased =
    data.totals?.previouslyReleasedTotal ??
    lines.reduce((a, l) => a + num(l.previouslyReleasedQty ?? l.alreadyRequisitionedQty), 0);
  const totalAdditional = resolveAdditionalRequirementTotal(data.totals, lines);
  const totalReleasedFromTotals = resolvePreviouslyReleasedTotal(data.totals, lines);
  const totalReduction =
    data.totals?.reductionTotal ?? lines.reduce((a, l) => a + num(l.reductionQty ?? 0), 0);
  const coveragePct =
    data.totals?.coveragePct ??
    (totalCurrent > 0 ? round3((totalReleased / totalCurrent) * 100) : null);
  const receiptTotals = data.receiptCoverage?.totals;
  const physicalCoveragePct = receiptTotals?.physicalCoveragePct ?? null;
  const physicalCoverageDetail = physicalReceiptCoverageDetailMessage(physicalCoveragePct);
  const hasReduction = lines.some((l) => num(l.reductionQty) > 0);
  const canReleaseDelta = isReleaseDeltaButtonEnabled(totalAdditional);
  const planHeader = plan
    ? {
        id: plan.id,
        status: plan.status,
        currentRevision: plan.currentRevision,
        planSequenceNo: plan.planSequenceNo,
        planKind: plan.planKind,
        displayLabel: plan.displayLabel,
      }
    : null;
  const usesPlanDocumentUx = usesPlanDocumentProcurementUx(planHeader);
  const releaseDisabledMessage = getReleaseDeltaDisabledStatusMessage({
    additionalRequirementTotal: totalAdditional,
    previouslyReleasedTotal: totalReleasedFromTotals,
    usesPlanDocumentUx,
  });
  const procurementBadge = getReleaseDeltaProcurementBadge({
    planStatus: plan?.status,
    currentRevision: data.currentRevision,
    snapshotRevision: data.revision,
    releasedRevision: plan?.releasedRevision,
    materialRequirementDocNo: releaseSummary?.materialRequirementDocNo,
    planDisplayLabel: planHeader ? resolvePlanDisplayLabel(planHeader) : null,
  });
  const pendingReceiptDisplay = receiptTotals
    ? formatPendingReceiptQtyDisplay(receiptTotals.pendingReceiptQty)
    : null;
  const receiptBannerSuffix = receiptTotals
    ? `${physicalReceiptCoverageBannerLine(physicalCoveragePct)}${physicalCoverageDetail ? ` · ${physicalCoverageDetail}` : ""}`
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <p className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] leading-tight text-slate-600">
        <span className="font-semibold text-slate-700">Progress:</span> {procurementProgressModelLine()}
      </p>

      {releaseSummary ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] leading-snug text-emerald-800">
          {formatReleaseSuccessSummary({
            plan: planHeader,
            releaseRevision: releaseSummary.revision,
            materialRequirementDocNo: releaseSummary.materialRequirementDocNo,
            releasedLineCount: releaseSummary.releasedLineCount,
            totalDeltaQty: releaseSummary.totalDeltaQty,
            skippedLineCount: releaseSummary.skippedLineCount,
            surplusLineCount: releaseSummary.surplusLineCount,
          })}
          {receiptBannerSuffix ? (
            <span className="text-emerald-900"> · {receiptBannerSuffix}</span>
          ) : null}
        </div>
      ) : (
        <div className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] leading-snug text-sky-800">
          {purchasePlanningOperationalStatus(totalAdditional, totalReleasedFromTotals)}
          {receiptBannerSuffix ? <span className="text-sky-900"> · {receiptBannerSuffix}</span> : null}
        </div>
      )}

      {hasReduction ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900">
          {purchasePlanningReductionMessage(planHeader)}
        </div>
      ) : null}

      <MonthlyPlanningMetricSection
        title={PURCHASE_FROZEN_SNAPSHOT_SECTION.title}
        subtitle={PURCHASE_FROZEN_SNAPSHOT_SECTION.subtitle}
        traceLabel="Frozen snapshot"
        variant="snapshot"
        compact
      >
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <KpiCard
            label={MP_PROCUREMENT.REQUIREMENT_SNAPSHOT}
            value={totalCurrent.toLocaleString()}
            tier="primary"
          />
          <KpiCard
            label={MP_PROCUREMENT.DEMAND_RELEASED}
            value={totalReleased.toLocaleString()}
            tier="primary"
          />
          <KpiCard label={MP_PROCUREMENT.ADDITIONAL_REQUIREMENT} value={totalAdditional.toLocaleString()} />
          <KpiCard label={MP_PROCUREMENT.REDUCTION_TOTAL} value={totalReduction.toLocaleString()} />
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <KpiCard label="RM items" value={String(totalRmItems)} />
          <KpiCard
            label={MP_PROCUREMENT.RELEASE_COVERAGE_PCT}
            value={coveragePct != null ? `${coveragePct.toLocaleString()}%` : "—"}
          />
        </div>
      </MonthlyPlanningMetricSection>

      {receiptTotals ? (
        <MonthlyPlanningMetricSection
          title={PURCHASE_LIVE_PROCUREMENT_SECTION.title}
          subtitle={PURCHASE_LIVE_PROCUREMENT_SECTION.subtitle}
          traceLabel="Live procurement"
          variant="live"
          compact
        >
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <KpiCard
              label={MP_PROCUREMENT.ORDERED_QTY}
              value={receiptTotals.poQty.toLocaleString()}
              tier="primary"
            />
            <KpiCard
              label={MP_PROCUREMENT.RECEIVED_QTY}
              value={receiptTotals.receivedQty.toLocaleString()}
              tier="primary"
            />
            <KpiCard
              label={`${MP_PROCUREMENT.REQUIREMENT_SNAPSHOT} (ref.)`}
              value={receiptTotals.requirementQty.toLocaleString()}
            />
            <KpiCard
              label={`${MP_PROCUREMENT.DEMAND_RELEASED} (ref.)`}
              value={receiptTotals.releasedQty.toLocaleString()}
            />
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <KpiCard
              label={MP_PROCUREMENT.PHYSICAL_RECEIPT_COVERAGE_PCT}
              value={formatPhysicalCoveragePct(receiptTotals.physicalCoveragePct)}
            />
            {pendingReceiptDisplay ? (
              <KpiCard label={pendingReceiptDisplay.label} value={pendingReceiptDisplay.value} />
            ) : null}
            {pendingReceiptDisplay?.hint ? (
              <div className="rounded border border-sky-200 bg-white/80 px-2 py-1 text-[10px] leading-tight text-sky-950">
                {pendingReceiptDisplay.hint}
              </div>
            ) : null}
          </div>
        </MonthlyPlanningMetricSection>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-1.5 py-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[12px] text-slate-500">
            {formatPurchasePlanningContextLabel({
              plan: planHeader,
              snapshotRevision: data.revision,
              lineCount: lines.length,
            })}
          </span>
          {procurementBadge ? (
            <Badge variant="info" className="text-[11px]">
              Procurement Source: {procurementBadge.label}
              {procurementBadge.materialRequirementDocNo ? (
                <>
                  {" · "}
                  <Link
                    to="/procurement-planning?demandPool=MPRS"
                    className="font-semibold text-violet-900 underline"
                  >
                    {procurementBadge.materialRequirementDocNo}
                  </Link>
                </>
              ) : (
                <>
                  {" · "}
                  <Link
                    to="/procurement-planning?demandPool=MPRS"
                    className="font-semibold text-violet-900 underline"
                  >
                    Open Monthly Planning workspace
                  </Link>
                </>
              )}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plan?.periodKey ? (
            <Link
              to={buildReportHref(plan.periodKey, "MONTHLY_PLAN")}
              className="text-[12px] font-semibold text-primary underline"
            >
              RM Planning vs Received
            </Link>
          ) : null}
          {!canReleaseDelta ? (
            <span className="text-[12px] font-medium text-emerald-700">✓ {releaseDisabledMessage}</span>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="h-8">
            <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
          {showReleaseButton ? (
            <Button
              type="button"
              size="sm"
              onClick={onRelease}
              disabled={loading || !canReleaseDelta}
              className="h-8 bg-sky-700 hover:bg-sky-800 disabled:opacity-50"
            >
              Release Delta to Procurement
            </Button>
          ) : null}
        </div>
      </div>

      <p className="text-[10px] leading-tight text-slate-500">
        <span className="font-semibold text-slate-600">Line table:</span> {PURCHASE_LINE_TABLE_NOTE}
      </p>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            <tr className="border-b border-slate-200 text-[9px]">
              <th className="px-2 py-0.5" colSpan={2} />
              <th className="px-2 py-0.5 text-center text-slate-700" colSpan={5}>
                Frozen snapshot
              </th>
              <th className="px-2 py-0.5 text-center text-sky-800" colSpan={5}>
                Live procurement
              </th>
              <th className="px-2 py-0.5" colSpan={2} />
            </tr>
            <tr>
              <th className="px-2 py-1.5">RM item</th>
              <th className="px-2 py-1.5 w-16">Unit</th>
              <th className="px-2 py-1.5 w-28 text-right">{MP_PROCUREMENT.REQUIREMENT_SNAPSHOT}</th>
              <th className="px-2 py-1.5 w-28 text-right">{MP_PROCUREMENT.DEMAND_RELEASED}</th>
              <th className="px-2 py-1.5 w-28 text-right">{MP_PROCUREMENT.ADDITIONAL_REQUIREMENT}</th>
              <th className="px-2 py-1.5 w-24 text-right">Reduction</th>
              <th className="px-2 py-1.5 w-28 text-right text-slate-500">{MP_PROCUREMENT.SUGGESTED_BUY_QTY}</th>
              <th className="px-2 py-1.5 w-24 text-right">{MP_PROCUREMENT.ORDERED_QTY}</th>
              <th className="px-2 py-1.5 w-24 text-right">{MP_PROCUREMENT.RECEIVED_QTY}</th>
              <th className="px-2 py-1.5 w-28 text-right">{MP_PROCUREMENT.PENDING_OR_OVER_RECEIPT_QTY}</th>
              <th className="px-2 py-1.5 w-28 text-right">{MP_PROCUREMENT.LINE_RECEIPT_COVERAGE_PCT}</th>
              <th className="px-2 py-1.5 w-32">Receipt Status</th>
              <th className="px-2 py-1.5 w-32">Release Status</th>
              <th className="px-2 py-1.5">Warnings</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-3 py-8 text-center text-sm text-slate-400">
                  {rmPlanningEmptyTableMessage(planHeader)}
                </td>
              </tr>
            ) : (
              lines.map((l) => {
                const meta = PURCHASE_STATUS_META[l.procurementStatus];
                const currentReq = num(l.currentRequirementQty ?? l.netRequirementQty);
                const prevReleased = num(l.previouslyReleasedQty ?? l.alreadyRequisitionedQty);
                const additional = num(l.additionalRequirementQty ?? l.suggestedPurchaseQty);
                const reduction = num(l.reductionQty ?? Math.max(0, -num(l.deltaQty ?? l.varianceQty)));
                const suggestedBuy = num(l.suggestedPurchaseQty ?? additional);
                const receipt = lookupReceiptCoverageForLine(l);
                const receiptMeta =
                  RECEIPT_COVERAGE_STATUS_META[receipt.receiptCoverageStatus as keyof typeof RECEIPT_COVERAGE_STATUS_META] ??
                  RECEIPT_COVERAGE_STATUS_META.NOT_RECEIVED;
                const pendingDisplay = formatPendingReceiptQtyDisplay(receipt.pendingReceiptQty);
                return (
                  <tr key={l.rmItemId} className="border-t border-slate-100 align-middle">
                    <td className="px-3 py-1.5 font-medium text-slate-800">{l.rmItemName ?? `Item ${l.rmItemId}`}</td>
                    <td className="px-3 py-1.5 text-slate-500">{l.unit ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-800">
                      {currentReq.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                      {prevReleased.toLocaleString()}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right font-semibold tabular-nums",
                        additional > 0 ? "text-sky-700" : "text-slate-400",
                      )}
                    >
                      {additional.toLocaleString()}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right tabular-nums",
                        reduction > 0 ? "text-amber-700 font-semibold" : "text-slate-400",
                      )}
                    >
                      {reduction.toLocaleString()}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right tabular-nums text-slate-500",
                        suggestedBuy > 0 ? "font-medium text-slate-600" : "text-slate-400",
                      )}
                    >
                      {suggestedBuy.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                      {receipt.poQty.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                      {receipt.receivedQty.toLocaleString()}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1 text-right tabular-nums",
                        pendingDisplay.overReceived ? "font-medium text-sky-800" : "text-slate-700",
                      )}
                    >
                      <span title={pendingDisplay.hint ?? undefined}>{pendingDisplay.value}</span>
                      {pendingDisplay.overReceived ? (
                        <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-sky-700">
                          {MP_PROCUREMENT.OVER_RECEIVED_QTY}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">
                      {formatPhysicalCoveragePct(receipt.physicalCoveragePct)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold", receiptMeta.cls)}>
                        {formatReceiptStatusLabel(receipt.receiptCoverageStatus)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold", meta.cls)}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {l.belowMinStockFlag ? <Badge variant="warning">Below min stock</Badge> : null}
                        {l.leadTimeRiskFlag ? <Badge variant="warning">Lead-time risk</Badge> : null}
                        {(l.warnings ?? []).map((w, i) => (
                          <span
                            key={i}
                            title={formatOperationalWarningMessage(w)}
                            className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {formatOperationalWarningMessage(w)}
                          </span>
                        ))}
                        {!l.belowMinStockFlag && !l.leadTimeRiskFlag && (l.warnings ?? []).length === 0 ? (
                          <span className="text-[12px] text-slate-400">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function computeProductionRequirementBreakdown(
  period: string,
  composition: RequirementCompositionResponse | null,
  rsSuggestions: RsSuggestionsResponse | null,
  totalFgPlanned: number,
): {
  customerRsDemand: number | null;
  greenLevelRequirement: number | null;
  totalFgPlanned: number;
} {
  let customerRsDemand: number | null = null;
  let greenLevelRequirement: number | null = null;

  if (composition?.periodKey === period) {
    customerRsDemand = composition.items.reduce((sum, item) => sum + item.rsRequirement, 0);
    greenLevelRequirement = composition.items.reduce((sum, item) => sum + item.greenShortage, 0);
  } else if (rsSuggestions?.periodKey === period) {
    customerRsDemand = rsSuggestions.items.reduce((sum, item) => sum + item.scheduleQty, 0);
  }

  return { customerRsDemand, greenLevelRequirement, totalFgPlanned };
}

function ProductionRequirementBreakdownCard({
  breakdown,
  period,
}: {
  breakdown: ReturnType<typeof computeProductionRequirementBreakdown>;
  period: string;
}) {
  const fmt = (value: number | null) =>
    value != null ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—";

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 shadow-sm">
      <h3 className="text-[13px] font-semibold text-slate-900">Production Requirement Breakdown</h3>
      <p className="mt-0.5 text-[11px] text-slate-600">Read-only summary for {period}</p>
      <div className="mt-3 overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Component</th>
              <th className="px-3 py-2 w-36 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-800">Customer RS Demand</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmt(breakdown.customerRsDemand)}</td>
            </tr>
            <tr className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-800">Green Level Requirement</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                {fmt(breakdown.greenLevelRequirement)}
              </td>
            </tr>
            <tr className="border-t border-slate-100 bg-slate-50/60">
              <td className="px-3 py-2 font-semibold text-slate-900">Total FG Planned</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                {breakdown.totalFgPlanned.toLocaleString(undefined, { maximumFractionDigits: 3 })}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function greenLevelStatusBadge(status: GreenLevelStatus | null): { label: string; cls: string } {
  switch (status) {
    case "GREEN":
      return { label: "Green", cls: "bg-emerald-100 text-emerald-800" };
    case "YELLOW":
      return { label: "Yellow", cls: "bg-amber-100 text-amber-900" };
    case "RED":
      return { label: "Red", cls: "bg-orange-100 text-orange-900" };
    case "CRITICAL":
      return { label: "Critical", cls: "bg-red-100 text-red-800" };
    default:
      return { label: "—", cls: "bg-slate-100 text-slate-500" };
  }
}

function GreenLevelSection({
  period,
  data,
  panelExpanded,
  visible,
  loading,
  onTogglePanel,
  onLoad,
}: {
  period: string;
  data: GreenLevelsResponse | null;
  panelExpanded: boolean;
  visible: boolean;
  loading: boolean;
  onTogglePanel: () => void;
  onLoad: () => void;
}) {
  const [showAllFg, setShowAllFg] = React.useState(false);
  const [expandedItemIds, setExpandedItemIds] = React.useState<Set<number>>(new Set());
  const dataForPeriod = data?.anchorPeriodKey === period ? data : null;
  const rows =
    dataForPeriod?.items.filter((i) => (showAllFg ? true : i.baseQty > 0)) ?? [];

  function toggleDetails(itemId: number) {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-slate-800">Green Level Audit</h3>
        <Button type="button" variant="outline" size="sm" onClick={onTogglePanel} className="h-8">
          {panelExpanded ? "Hide Details" : "View Details"}
        </Button>
      </div>

      {panelExpanded ? (
        <>
          {loading && !dataForPeriod ? (
            <p className="mt-3 text-sm text-slate-500">Loading green levels for {period}…</p>
          ) : null}
          {!visible && !loading ? (
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={onLoad} disabled={loading} className="h-8">
                <Layers className={cn("mr-1.5 h-4 w-4", loading && "animate-pulse")} />
                {loading ? "Loading…" : "Load green level audit"}
              </Button>
            </div>
          ) : null}
          {visible && dataForPeriod ? (
        <div className="mt-3 overflow-auto rounded-md border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-[11px] text-slate-500">
            <span>
              History window: {dataForPeriod.historyPeriodKeys[0]} →{" "}
              {dataForPeriod.historyPeriodKeys[dataForPeriod.historyPeriodKeys.length - 1]}
              {" · "}
              {dataForPeriod.itemsWithHistory} FG item(s) with history · read-only
            </span>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={showAllFg}
                onChange={(e) => setShowAllFg(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              Show all FG items
            </label>
          </div>
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2">FG item</th>
                <th className="px-3 py-2 w-28 text-right">Free FG</th>
                <th className="px-3 py-2 w-28 text-right">Green target</th>
                <th className="px-3 py-2 w-28 text-right">Shortage (GL)</th>
                <th className="px-3 py-2 w-24">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">
                    Insufficient locked RS history available to calculate Green Level.
                  </td>
                </tr>
              ) : (
                rows.map((item) => {
                  const expanded = expandedItemIds.has(item.itemId);
                  const badge = greenLevelStatusBadge(item.status);
                  return (
                    <React.Fragment key={item.itemId}>
                      <tr className="border-t border-slate-100 align-middle">
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => toggleDetails(item.itemId)}
                            className="text-slate-400 hover:text-slate-700"
                            title="Show base and zone qty details"
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 font-medium text-slate-800">
                          {item.itemName ?? `Item ${item.itemId}`}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                          {item.freeFgStock.toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-800">
                          {item.greenQty.toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                          {item.shortageForGreenTarget.toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5">
                          <span
                            className={cn(
                              "inline-flex rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                              badge.cls,
                            )}
                          >
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="border-t border-slate-50 bg-slate-50/60 text-[12px] text-slate-600">
                          <td />
                          <td className="px-3 py-1.5 pl-8" colSpan={5}>
                            Base {item.baseQty.toLocaleString()} · Green {item.greenPercent}% · Yellow qty{" "}
                            {item.yellowQty.toLocaleString()} · Red qty {item.redQty.toLocaleString()}
                            {Object.keys(item.monthlyScheduleTotals).length > 0
                              ? ` · History: ${Object.entries(item.monthlyScheduleTotals)
                                  .map(([m, q]) => `${m} ${q.toLocaleString()}`)
                                  .join(", ")}`
                              : ""}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RequirementCompositionSection({
  period,
  data,
  panelExpanded,
  visible,
  loading,
  onTogglePanel,
  onLoad,
}: {
  period: string;
  data: RequirementCompositionResponse | null;
  panelExpanded: boolean;
  visible: boolean;
  loading: boolean;
  onTogglePanel: () => void;
  onLoad: () => void;
}) {
  const [expandedItemIds, setExpandedItemIds] = React.useState<Set<number>>(new Set());
  const dataForPeriod = data?.periodKey === period ? data : null;

  function toggleDetails(itemId: number) {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-slate-800">Planning Audit</h3>
        <Button type="button" variant="outline" size="sm" onClick={onTogglePanel} className="h-8">
          {panelExpanded ? "Hide Details" : "View Details"}
        </Button>
      </div>

      {panelExpanded ? (
        <>
          {loading && !dataForPeriod ? (
            <p className="mt-3 text-sm text-slate-500">Loading planning audit for {period}…</p>
          ) : null}
          {!dataForPeriod && !loading ? (
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={onLoad} disabled={loading} className="h-8">
                <Calculator className={cn("mr-1.5 h-4 w-4", loading && "animate-pulse")} />
                {loading ? "Loading…" : "Load planning audit"}
              </Button>
            </div>
          ) : null}
          {dataForPeriod ? (
          <div className="mt-3 overflow-auto rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-[11px] text-slate-500">
              {dataForPeriod.sheetCount ?? 0} locked RS sheet(s) · {dataForPeriod.itemCount} FG item(s) with a non-zero
              component · read-only
            </div>
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2">FG item</th>
                  <th className="px-3 py-2 w-28 text-right">RS Requirement</th>
                  <th className="px-3 py-2 w-28 text-right">Carry Forward</th>
                  <th className="px-3 py-2 w-28 text-right">Green Shortage</th>
                  <th className="px-3 py-2 w-32 text-right">Suggested Production</th>
                </tr>
              </thead>
              <tbody>
                {dataForPeriod.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                      <p>No suggested production components for this period yet.</p>
                      <p className="mt-1 text-[12px] text-slate-400">
                        {(dataForPeriod.sheetCount ?? 0) === 0
                          ? `No LOCKED NO_QTY Requirement Sheets use period ${period}. Switch the planning month if RS cycles were locked under a different month.`
                          : `${dataForPeriod.sheetCount} locked RS sheet(s) found for ${period}, but no FG lines with non-zero requirement, carry forward, or green shortage.`}
                      </p>
                    </td>
                  </tr>
                ) : (
                  dataForPeriod.items.map((item) => {
                    const expanded = expandedItemIds.has(item.itemId);
                    const badge = greenLevelStatusBadge(item.status ?? null);
                    return (
                      <React.Fragment key={item.itemId}>
                        <tr className="border-t border-slate-100 align-middle">
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => toggleDetails(item.itemId)}
                              className="text-slate-400 hover:text-slate-700"
                              title="Show audit reference details"
                            >
                              {expanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-1.5 font-medium text-slate-800">
                            {item.itemName ?? `Item ${item.itemId}`}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                            {item.rsRequirement.toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                            {item.carryForward.toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                            {item.greenShortage.toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-violet-900">
                            {item.suggestedProduction.toLocaleString()}
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="border-t border-slate-50 bg-slate-50/60 text-[12px] text-slate-600">
                            <td />
                            <td className="px-3 py-1.5 pl-8" colSpan={5}>
                              Production req. (Phase 2):{" "}
                              {(item.productionRequirementQty ?? 0).toLocaleString()}
                              {" · "}
                              Green target: {(item.greenTarget ?? 0).toLocaleString()}
                              {" · "}
                              Free FG: {(item.freeFgStock ?? 0).toLocaleString()}
                              {" · "}
                              Status:{" "}
                              <span
                                className={cn(
                                  "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                  badge.cls,
                                )}
                              >
                                {badge.label}
                              </span>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RmRequirementCompositionSection({
  period,
  data,
  panelExpanded,
  visible,
  loading,
  onTogglePanel,
  onLoad,
}: {
  period: string;
  data: RmRequirementCompositionResponse | null;
  panelExpanded: boolean;
  visible: boolean;
  loading: boolean;
  onTogglePanel: () => void;
  onLoad: () => void;
}) {
  const [expandedItemIds, setExpandedItemIds] = React.useState<Set<number>>(new Set());
  const dataForPeriod = data?.periodKey === period ? data : null;

  function toggleDetails(rmItemId: number) {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(rmItemId)) next.delete(rmItemId);
      else next.add(rmItemId);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-slate-800">RM Audit</h3>
        <Button type="button" variant="outline" size="sm" onClick={onTogglePanel} className="h-8">
          {panelExpanded ? "Hide Details" : "View Details"}
        </Button>
      </div>

      {panelExpanded ? (
        <>
          {loading && !dataForPeriod ? (
            <p className="mt-3 text-sm text-slate-500">Loading RM audit for {period}…</p>
          ) : null}
          {!visible && !loading ? (
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={onLoad} disabled={loading} className="h-8">
                <Boxes className={cn("mr-1.5 h-4 w-4", loading && "animate-pulse")} />
                {loading ? "Loading…" : "Load RM audit"}
              </Button>
            </div>
          ) : null}
          {visible && dataForPeriod ? (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiCard label="FG items planned" value={String(dataForPeriod.summary.fgItemsPlanned)} />
              <KpiCard label="RM items required" value={String(dataForPeriod.summary.rmItemsRequired)} />
              <KpiCard label="RM shortages" value={String(dataForPeriod.summary.rmLinesWithGap)} />
              <KpiCard label="FG items without BOM" value={String(dataForPeriod.summary.missingBomCount)} />
            </div>
            <div className="overflow-auto rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-3 py-2 text-[11px] text-slate-500">
                {dataForPeriod.items.length} RM line(s) · read-only · expand row for FG traceability
              </div>
              <table className="w-full border-collapse text-[13px]">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 w-8" />
                    <th className="px-3 py-2">RM item</th>
                    <th className="px-3 py-2 w-16">UOM</th>
                    <th className="px-3 py-2 w-28 text-right">Total demand</th>
                    <th className="px-3 py-2 w-24 text-right">Free</th>
                    <th className="px-3 py-2 w-24 text-right">Reserved</th>
                    <th className="px-3 py-2 w-24 text-right">Incoming PO</th>
                    <th className="px-3 py-2 w-28 text-right">Net available</th>
                    <th className="px-3 py-2 w-24 text-right">Net gap</th>
                    <th className="px-3 py-2 w-28 text-right">Min stock</th>
                  </tr>
                </thead>
                <tbody>
                  {dataForPeriod.items.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-6 text-center text-sm text-slate-400">
                        No RM demand from suggested production for this period. Review Requirement Composition or check for missing BOMs.
                      </td>
                    </tr>
                  ) : (
                    dataForPeriod.items.map((item) => {
                      const expanded = expandedItemIds.has(item.rmItemId);
                      return (
                        <React.Fragment key={item.rmItemId}>
                          <tr className="border-t border-slate-100 align-middle">
                            <td className="px-2 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => toggleDetails(item.rmItemId)}
                                className="text-slate-400 hover:text-slate-700"
                                title="Show FG source traceability"
                                disabled={item.fgSources.length === 0}
                              >
                                {item.fgSources.length > 0 ? (
                                  expanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )
                                ) : null}
                              </button>
                            </td>
                            <td className="px-3 py-1.5 font-medium text-slate-800">
                              {item.itemName ?? `Item ${item.rmItemId}`}
                              {item.belowMinimumFlag ? (
                                <span className="ml-2 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                                  Below min
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-1.5 text-slate-600">{item.unit ?? "—"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">
                              {item.totalRmDemand.toLocaleString()}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                              {item.freeStock.toLocaleString()}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                              {item.reserved.toLocaleString()}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                              {item.incomingPo.toLocaleString()}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                              {item.netAvailable.toLocaleString()}
                            </td>
                            <td
                              className={cn(
                                "px-3 py-1.5 text-right tabular-nums font-semibold",
                                item.netGap > 0 ? "text-red-700" : "text-slate-800",
                              )}
                            >
                              {item.netGap.toLocaleString()}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                              {item.minimumStock.toLocaleString()}
                            </td>
                          </tr>
                          {expanded && item.fgSources.length > 0 ? (
                            <tr className="border-t border-slate-50 bg-slate-50/60">
                              <td />
                              <td className="px-3 py-2 pl-8" colSpan={9}>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  FG sources
                                </div>
                                <table className="mt-1 w-full max-w-xl text-[12px]">
                                  <thead>
                                    <tr className="text-left text-slate-500">
                                      <th className="py-1 pr-3 font-medium">FG item</th>
                                      <th className="py-1 pr-3 text-right font-medium">Suggested prod.</th>
                                      <th className="py-1 text-right font-medium">RM demand</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.fgSources.map((src) => (
                                      <tr key={src.fgItemId} className="border-t border-slate-100">
                                        <td className="py-1 pr-3 text-slate-700">
                                          {src.fgItemName ?? `FG ${src.fgItemId}`}
                                          {src.bomMissing ? (
                                            <span className="ml-1 text-amber-700">(BOM not available)</span>
                                          ) : null}
                                        </td>
                                        <td className="py-1 pr-3 text-right tabular-nums">
                                          {src.suggestedProduction.toLocaleString()}
                                        </td>
                                        <td className="py-1 text-right tabular-nums font-medium">
                                          {src.rmDemandQty.toLocaleString()}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ApplySuggestedOverrideConfirmModal({
  itemName,
  message,
  onCancel,
  onConfirm,
}: {
  itemName: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Replace planned quantity?</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">{itemName}</p>
          </div>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-4 whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} className="bg-amber-700 hover:bg-amber-800">
            Replace planned quantity
          </Button>
        </div>
      </div>
    </div>
  );
}

function PastPeriodConfirmModal({
  period,
  confirming,
  onCancel,
  onConfirm,
}: {
  period: string;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Lock className="h-4 w-4" />
            </span>
            <h3 className="text-base font-semibold text-slate-900">Past period confirmation</h3>
          </div>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-slate-600">
          You are modifying a past planning period (<strong>{period}</strong>).
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
          This should be used only for audit, correction, or testing.
        </p>
        <p className="mt-2 text-[13px] font-medium text-slate-800">Continue?</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={confirming}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={confirming} className="bg-amber-700 hover:bg-amber-800">
            {confirming ? "Continuing…" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function NoPlanPreviewPanel({
  period,
  loading,
  canStartPlanning,
  periodIsPast,
  startingPlanning,
  addingSuggested,
  onStartPlanning,
  onAddSuggestedItems,
}: {
  period: string;
  loading: boolean;
  canStartPlanning: boolean;
  periodIsPast: boolean;
  startingPlanning: boolean;
  addingSuggested: boolean;
  onStartPlanning: () => void;
  onAddSuggestedItems: () => void;
}) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center shadow-sm">
      <Eye className="h-8 w-8 text-slate-400" />
      <p className="mt-3 max-w-lg text-sm font-medium text-slate-800">
        No production plan created yet for <strong>{period}</strong>.
      </p>
      <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-slate-600">
        Start planning when you are ready to create a draft for this period. Use audit panels below for detailed
        traceability.
      </p>
      {canStartPlanning ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            onClick={onStartPlanning}
            disabled={startingPlanning || addingSuggested || loading}
            className="h-9"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {startingPlanning ? "Starting…" : "Start planning"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onAddSuggestedItems}
            disabled={startingPlanning || addingSuggested || loading}
            className="h-9"
          >
            <Layers className="mr-1.5 h-4 w-4" />
            {addingSuggested ? "Adding…" : "Add suggested items to plan"}
          </Button>
        </div>
      ) : periodIsPast ? (
        <p className="mt-4 text-[12px] text-slate-500">
          Past period. Planning actions are disabled.
        </p>
      ) : (
        <p className="mt-4 text-[12px] text-slate-500">Store or Admin can start planning for this period.</p>
      )}
    </div>
  );
}

function formatRsSuggestionCycleLabel(cycleNo?: number | null, cycleId?: number | null): string {
  if (cycleNo != null && Number.isFinite(Number(cycleNo)) && Number(cycleNo) > 0) {
    return `Cycle ${Number(cycleNo)}`;
  }
  if (cycleId != null && Number.isFinite(Number(cycleId))) return `Cycle #${cycleId}`;
  return "Cycle —";
}

/** Consolidated locked RS demand for MPRS — sum of cycle-wise schedule qty (additive across cycles). */
function totalRsRequirementQty(item: RsSuggestionItem): number {
  return item.scheduleQty;
}

function sortRsSuggestionSources(sources: RsSuggestionSource[]): RsSuggestionSource[] {
  return [...sources].sort((a, b) => {
    const na = a.cycleNo ?? a.cycleId ?? 0;
    const nb = b.cycleNo ?? b.cycleId ?? 0;
    return Number(na) - Number(nb) || String(a.requirementSheetDocNo ?? "").localeCompare(String(b.requirementSheetDocNo ?? ""));
  });
}

function ProductionPlanTab({
  rows,
  editable,
  readOnlyMessage,
  period,
  rsSuggestions,
  rsSuggestionsVisible,
  loadingRsSuggestions,
  onLoadRsSuggestions,
  onHideRsSuggestions,
  onApplyRsSuggestion,
  onUpdateRow,
  onRemoveRow,
  availableFgForAdd,
  addItemId,
  setAddItemId,
  onAddRow,
  suggestedProductionMap,
  greenContextMap,
}: {
  rows: EditRow[];
  editable: boolean;
  readOnlyMessage: string | null;
  period: string;
  rsSuggestions: RsSuggestionsResponse | null;
  rsSuggestionsVisible: boolean;
  loadingRsSuggestions: boolean;
  onLoadRsSuggestions: () => void;
  onHideRsSuggestions: () => void;
  onApplyRsSuggestion: (item: RsSuggestionItem) => void;
  onUpdateRow: (key: string, patch: Partial<EditRow>) => void;
  onRemoveRow: (row: EditRow) => void;
  availableFgForAdd: FgItem[];
  addItemId: string;
  setAddItemId: (v: string) => void;
  onAddRow: () => void;
  suggestedProductionMap: Map<number, number>;
  greenContextMap: Map<number, { greenTarget: number; freeFgStock: number }>;
}) {
  const [expandedItemIds, setExpandedItemIds] = React.useState<Set<number>>(new Set());

  function toggleSourceExpand(itemId: number) {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-semibold text-slate-800">Customer Requirement Summary</h3>
            <p className="mt-0.5 text-[12px] text-slate-600">
              Customer demand received through Requirement Sheets for <strong>{period}</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onLoadRsSuggestions}
              disabled={loadingRsSuggestions}
              className="h-8"
            >
              <Eye className={cn("mr-1.5 h-4 w-4", loadingRsSuggestions && "animate-pulse")} />
              {loadingRsSuggestions ? "Loading…" : "Refresh summary"}
            </Button>
          </div>
        </div>

        {rsSuggestions ? (
          <div className="mt-3 overflow-auto rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-[11px] text-slate-500">
              {rsSuggestions.sheetCount} locked sheet(s) · {rsSuggestions.items.length} FG item(s)
            </div>
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2">FG item</th>
                  <th className="px-3 py-2 w-36 text-right">Total RS requirement</th>
                  <th className="px-3 py-2 w-24 text-center">RS count</th>
                  {editable ? <th className="px-3 py-2 w-36">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {rsSuggestions.items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={editable ? 5 : 4}
                      className="px-3 py-6 text-center text-sm text-slate-500"
                    >
                      {rsSuggestions.sheetCount === 0 ? (
                        <>
                          <p>No LOCKED NO_QTY Requirement Sheets for period {period}.</p>
                          <p className="mt-1 text-[12px] text-slate-400">
                            Each RS cycle stores its own period key — switch the planning month if cycles were locked
                            under a different month, or confirm sheets are LOCKED (not draft).
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
                            {rsSuggestions.sheetCount} locked sheet(s) found for {period}, but no FG lines with qty.
                          </p>
                          <p className="mt-1 text-[12px] text-slate-400">
                            Check that locked RS lines include FG items with requirement quantities.
                          </p>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  rsSuggestions.items.map((item) => {
                    const expanded = expandedItemIds.has(item.itemId);
                    return (
                      <React.Fragment key={item.itemId}>
                        <tr className="border-t border-slate-100 align-middle">
                          <td className="px-2 py-1.5 text-center">
                            {item.sources.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => toggleSourceExpand(item.itemId)}
                                className="text-slate-400 hover:text-slate-700"
                                title="Show source RS traceability"
                              >
                                {expanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            ) : null}
                          </td>
                          <td className="px-3 py-1.5 font-medium text-slate-800">
                            {item.itemName ?? `Item ${item.itemId}`}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-900">
                            {totalRsRequirementQty(item).toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5 text-center tabular-nums text-slate-600">
                            {item.sources.length}
                          </td>
                          {editable ? (
                            <td className="px-3 py-1.5">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-[12px]"
                                onClick={() => onApplyRsSuggestion(item)}
                              >
                                Add suggested production
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                        {expanded ? (
                          <tr className="border-t border-slate-50 bg-slate-50/60">
                            <td colSpan={editable ? 5 : 4} className="px-3 py-2 pl-8">
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                Requirement Sheet Details
                              </div>
                              <table className="w-full max-w-xl border-collapse text-[12px]">
                                <thead>
                                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                    <th className="py-1 pr-3">Cycle</th>
                                    <th className="py-1 pr-3">RS</th>
                                    <th className="py-1 pr-3 text-right">Qty</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortRsSuggestionSources(item.sources).map((src) => (
                                    <tr key={`${item.itemId}-${src.requirementSheetId}-${src.cycleId}`} className="text-slate-700">
                                      <td className="py-1 pr-3 font-medium tabular-nums">
                                        {formatRsSuggestionCycleLabel(src.cycleNo, src.cycleId)}
                                      </td>
                                      <td className="py-1 pr-3">
                                        <Link
                                          to={buildNoQtyGuidedHref({
                                            to: `/sales-orders/${src.salesOrderId}/requirement-sheets`,
                                            salesOrderId: src.salesOrderId,
                                            cycleId: src.cycleId,
                                            fromStep: "monthly_planning",
                                          })}
                                          className="font-medium text-sky-800 underline underline-offset-2"
                                        >
                                          {src.requirementSheetDocNo ?? `RS #${src.requirementSheetId}`}
                                        </Link>
                                      </td>
                                      <td className="py-1 pr-3 text-right font-semibold tabular-nums">
                                        {src.requirementQty.toLocaleString()}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr className="border-t border-slate-200 font-semibold text-slate-900">
                                    <td className="pt-1.5 pr-3" colSpan={2}>
                                      Total RS requirement
                                    </td>
                                    <td className="pt-1.5 pr-3 text-right tabular-nums">
                                      {totalRsRequirementQty(item).toLocaleString()}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : loadingRsSuggestions ? (
          <p className="mt-3 text-sm text-slate-500">Loading customer requirement summary…</p>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Customer requirement summary will load when this tab opens.</p>
        )}
      </div>

      {readOnlyMessage ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-900">
          {readOnlyMessage}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            value={addItemId}
            onChange={(e) => setAddItemId(e.target.value)}
            className="h-9 w-[260px]"
            aria-label="Select FG item to add"
          >
            <option value="">Add FG item…</option>
            {availableFgForAdd.map((i) => (
              <option key={i.id} value={i.id}>
                {i.itemName}
              </option>
            ))}
          </NativeSelect>
          <Button type="button" size="sm" variant="outline" onClick={onAddRow} disabled={!addItemId} className="h-9">
            <Plus className="mr-1.5 h-4 w-4" />
            Add row
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">FG item</th>
              <th className="px-3 py-2 w-16">Unit</th>
              <th className="px-3 py-2 w-28 text-right">Suggested</th>
              <th className="px-3 py-2 w-28 text-right">Planned</th>
              <th className="px-3 py-2 w-24 text-right">Variance</th>
              <th className="px-3 py-2 w-20 text-right">Var %</th>
              <th className="px-3 py-2 w-32 text-right">Green gap</th>
              <th className="px-3 py-2 w-28">Source</th>
              <th className="px-3 py-2">Remarks</th>
              {editable ? <th className="px-3 py-2 w-12" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={editable ? 10 : 9} className="px-3 py-8 text-center text-sm text-slate-400">
                  No production plan lines yet. {editable ? "Add an FG item to begin planning." : ""}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const metrics = computeLinePlanningMetrics(
                  r.fgItemId,
                  num(r.plannedFgQty),
                  r.suggestedFgQty,
                  suggestedProductionMap,
                  greenContextMap,
                );
                return (
                <tr key={r.key} className="border-t border-slate-100 align-middle">
                  <td className="px-3 py-1.5 font-medium text-slate-800">{r.fgItemName}</td>
                  <td className="px-3 py-1.5 text-slate-500">{r.unit ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {metrics.suggested.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {editable ? (
                      <Input
                        type="number"
                        min={0}
                        step="0.001"
                        value={r.plannedFgQty}
                        onChange={(e) => onUpdateRow(r.key, { plannedFgQty: e.target.value })}
                        className="h-8 w-28 text-right tabular-nums"
                      />
                    ) : (
                      <span className="tabular-nums text-slate-800">{metrics.planned.toLocaleString()}</span>
                    )}
                  </td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums", varianceRowClass(metrics.varianceQty))}>
                    {metrics.varianceQty.toLocaleString()}
                  </td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums", varianceRowClass(metrics.varianceQty))}>
                    {metrics.suggested > 0 ? `${metrics.variancePct.toLocaleString()}%` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {metrics.remainingGreenGap > 0 ? metrics.remainingGreenGap.toLocaleString() : "0"}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant={sourceBadgeVariant(r.source)}>{sourceLabel(r.source)}</Badge>
                  </td>
                  <td className="px-3 py-1.5">
                    {editable ? (
                      <Input
                        type="text"
                        value={r.remarks}
                        placeholder="—"
                        onChange={(e) => onUpdateRow(r.key, { remarks: e.target.value })}
                        className="h-8 w-full"
                      />
                    ) : (
                      <span className="text-slate-600">{r.remarks || "—"}</span>
                    )}
                  </td>
                  {editable ? (
                    <td className="px-3 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => onRemoveRow(r)}
                        title="Delete row"
                        className="text-slate-400 transition-colors hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  ) : null}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
