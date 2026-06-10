import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch, ApiRequestError } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { useAuth } from "../hooks/useAuth";
import { MONTHLY_PLANNING_WRITE_ROLES } from "../config/erpRoles";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import {
  CalendarRange,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Lock,
  Unlock,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  Layers,
  Calculator,
  Boxes,
  History,
} from "lucide-react";

type PlanStatus = "DRAFT" | "LOCKED";
type LineSource = "SALES_ORDER" | "REQUIREMENT_SHEET" | "MANUAL" | "CUSTOMER_SCHEDULE";

type PlanSummary = {
  id: number;
  docNo: string | null;
  periodKey: string;
  status: PlanStatus;
  currentRevision: number;
  remarks: string | null;
  lockedAt: string | null;
  reopenedAt: string | null;
  releasedAt: string | null;
  releasedRevision: number | null;
  createdByUserId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type PlanResponse = {
  exists: boolean;
  plan: PlanSummary | null;
  lines: unknown[];
  revisions: { revision: number; recalculatedAt: string }[];
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
};

type PurchasePlanningTotals = {
  rmItemCount: number;
  currentRequirementTotal: number;
  previouslyReleasedTotal: number;
  additionalRequirementTotal: number;
  reductionTotal: number;
  coveragePct: number | null;
};

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
};

type FgItem = { id: number; itemName: string; unit?: string | null; unitName?: string | null };

type RsSuggestionSource = {
  requirementSheetId: number;
  requirementSheetDocNo: string | null;
  salesOrderId: number;
  salesOrderDocNo: string | null;
  cycleId: number | null;
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
  const { showSuccess, showError } = useToast();
  const auth = useAuth();
  const userRole = auth.user?.role ?? "";
  const canWriteMonthlyPlan = MONTHLY_PLANNING_WRITE_ROLES.includes(
    userRole as (typeof MONTHLY_PLANNING_WRITE_ROLES)[number],
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
  const [planExists, setPlanExists] = React.useState<boolean>(false);
  const [rows, setRows] = React.useState<EditRow[]>([]);
  const [removedIds, setRemovedIds] = React.useState<number[]>([]);
  const [fgItems, setFgItems] = React.useState<FgItem[]>([]);
  const [addItemId, setAddItemId] = React.useState<string>("");
  const [rmPlanning, setRmPlanning] = React.useState<RmPlanningResponse | null>(null);
  const [loadingRm, setLoadingRm] = React.useState(false);
  const [purchasePlanning, setPurchasePlanning] = React.useState<PurchasePlanningResponse | null>(null);
  const [loadingPurchase, setLoadingPurchase] = React.useState(false);
  const [confirmLockOpen, setConfirmLockOpen] = React.useState(false);
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
  const [reopening, setReopening] = React.useState(false);
  const [cancellingReopen, setCancellingReopen] = React.useState(false);
  const [startingPlanning, setStartingPlanning] = React.useState(false);
  const [addingSuggested, setAddingSuggested] = React.useState(false);
  const [pastPeriodConfirmOpen, setPastPeriodConfirmOpen] = React.useState(false);
  const [confirmingPastPeriod, setConfirmingPastPeriod] = React.useState(false);
  const [pastPeriodConfirmedKey, setPastPeriodConfirmedKey] = React.useState<string | null>(null);
  const pastPeriodActionRef = React.useRef<(() => Promise<void>) | null>(null);

  const pastPeriodConfirmedSession = periodIsPast && pastPeriodConfirmedKey === period;

  const isLocked = plan?.status === "LOCKED";
  const editable = planExists && !isLocked && canMutatePeriod;
  const isDraftForNextRevision = Boolean(plan && plan.status === "DRAFT" && plan.currentRevision >= 1);
  const canCancelReopen = Boolean(
    planExists && plan && plan.status === "DRAFT" && plan.currentRevision >= 1 && plan.reopenedAt,
  );
  const suggestedProductionMap = React.useMemo(
    () => buildSuggestedProductionMap(requirementComposition),
    [requirementComposition],
  );
  const greenContextMap = React.useMemo(() => buildGreenContextMap(greenLevels), [greenLevels]);

  const loadRevisions = React.useCallback(async (planId: number) => {
    setLoadingRevisions(true);
    try {
      const res = await apiFetch<PlanRevisionsResponse>(`/api/monthly-planning/${planId}/revisions`);
      setPlanRevisions(res);
      if (res.revisions.length > 0) {
        setExpandedRevision((cur) => cur ?? res.revisions[0].revision);
      }
    } catch {
      setPlanRevisions(null);
    } finally {
      setLoadingRevisions(false);
    }
  }, []);

  const loadPlan = React.useCallback(
    async (p: string) => {
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
        headerLoaded = Boolean(res.exists && res.plan);
        setPlanExists(res.exists);
        setPlan(res.plan);
        setRemovedIds([]);

        if (!headerLoaded) {
          setRows([]);
          setRmPlanning(null);
          setPurchasePlanning(null);
          setLockSummary(null);
          setPlanRevisions(null);
          return;
        }

        const planRef = res.plan!;
        void loadRevisions(planRef.id);

        try {
          const lineRes = await apiFetch<ProductionLinesResponse>(
            `/api/monthly-planning/${planRef.id}/production-lines`,
          );
          setRows(
            lineRes.lines.map((l) => ({
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
            })),
          );
          setLockSummary(lineRes.lockSummary ?? null);
        } catch (lineErr) {
          const lineMsg =
            lineErr instanceof ApiRequestError
              ? lineErr.message
              : "Failed to load production plan lines.";
          showError(`${lineMsg} Plan header is loaded — try Refresh.`);
          setRows([]);
          setLockSummary(null);
        }

        if (planRef.status === "DRAFT") {
          void ensurePlanningContext().catch(() => {
            /* variance columns fall back to stored suggested until context loads */
          });
        }

        if (planRef.status === "LOCKED") {
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
      } catch (e) {
        const msg = e instanceof ApiRequestError ? e.message : "Failed to load monthly plan.";
        showError(msg);
        if (!headerLoaded) {
          setPlanExists(false);
          setPlan(null);
          setRows([]);
          setRmPlanning(null);
          setPurchasePlanning(null);
          setLockSummary(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [showError, loadRevisions],
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
      showSuccess(`Draft started for ${periodKey}. Add FG lines or apply suggestions, then save.`);
      await loadPlan(periodKey);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "DUPLICATE_PERIOD") {
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
      if (e instanceof ApiRequestError && e.code === "DUPLICATE_PERIOD") {
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
    if (isLocked || !canMutatePeriod) {
      showError(
        isLocked
          ? "Plan is locked — RS suggestions are read-only."
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
    if (existing) {
      const patch: Partial<EditRow> = {
        suggestedFgQty: suggested,
        source: "REQUIREMENT_SHEET",
      };
      if (!existing.plannedQtyOverridden) {
        patch.plannedFgQty = String(suggested);
      }
      updateRow(existing.key, patch);
      showSuccess(
        `Applied suggested production (${suggested.toLocaleString()}) to ${item.itemName ?? `Item ${item.itemId}`}.`,
      );
      return;
    }
    const fg = fgItems.find((i) => i.id === item.itemId);
    setRows((prev) => [
      ...prev,
      {
        key: `rs-${item.itemId}-${Date.now()}`,
        fgItemId: item.itemId,
        fgItemName: item.itemName ?? fg?.itemName ?? `Item ${item.itemId}`,
        unit: item.unit ?? fg?.unit ?? fg?.unitName ?? null,
        suggestedFgQty: suggested,
        plannedFgQty: String(suggested),
        plannedQtyOverridden: false,
        source: "REQUIREMENT_SHEET",
        remarks: "From suggested production (RS + carry forward + green shortage)",
      },
    ]);
    showSuccess(`Added ${item.itemName ?? `Item ${item.itemId}`} with suggested production. Save to persist.`);
  }

  async function addRow() {
    const id = Number(addItemId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (isLocked || !canMutatePeriod) {
      showError(isLocked ? "Plan is locked." : "Past periods are view-only for Store users.");
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
    if (isLocked || !canMutatePeriod) return;
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
    setLocking(true);
    try {
      const activePlan = await ensurePlanDraft(options);
      const lockBody = options?.confirmPastPeriod ? { confirmPastPeriod: true as const } : {};
      const rm = await apiFetch<RmPlanningResponse>(`/api/monthly-planning/${activePlan.id}/lock`, {
        method: "POST",
        body: JSON.stringify(lockBody),
      });
      setRmPlanning(rm);
      showSuccess("Plan locked. RM Planning snapshot generated.");
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
      showSuccess(`Draft discarded. Plan restored to LOCKED revision ${plan.currentRevision}.`);
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
        `Plan reopened — editing draft for revision ${res.draftForRevision}. Revision ${res.currentRevision} remains in history.`,
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
      const summary = await apiFetch<ReleaseSummary>(`/api/monthly-planning/${plan.id}/release`, {
        method: "POST",
        body: JSON.stringify({ revision: plan.currentRevision, confirm: true }),
      });
      setReleaseSummary(summary);
      setConfirmReleaseOpen(false);
      showSuccess(
        `Released ${summary.releasedLineCount} line(s) · delta ${summary.totalDeltaQty.toLocaleString()}.`,
      );
      await refreshPurchase();
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to release to procurement.");
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
    } catch (e) {
      showError(e instanceof ApiRequestError ? e.message : "Failed to load Purchase Planning.");
    } finally {
      setLoadingPurchase(false);
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
  const canLock = editable && rows.some((r) => num(r.plannedFgQty) > 0);

  const availableFgForAdd = fgItems.filter((i) => !rows.some((r) => r.fgItemId === i.id));

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
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      {/* Header */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Plan period
            </label>
            <Input
              type="month"
              value={period}
              onChange={(e) => applyPeriod(e.target.value)}
              className="mt-1 h-9 w-[170px]"
            />
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2">
            {planExists && plan ? (
              <>
                <Badge variant={isLocked ? "warning" : "info"}>{plan.status}</Badge>
                {plan.docNo ? (
                  <span className="text-[13px] font-semibold text-slate-800">{plan.docNo}</span>
                ) : null}
                <span className="text-[12px] text-slate-500">Revision {plan.currentRevision}</span>
                {plan.lockedAt ? (
                  <span className="text-[12px] text-slate-500">
                    · Locked {new Date(plan.lockedAt).toLocaleDateString()}
                  </span>
                ) : null}
                {plan.createdAt ? (
                  <span className="text-[12px] text-slate-400">
                    · Created {new Date(plan.createdAt).toLocaleDateString()}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-[13px] text-slate-500">No production plan created yet.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadPlan(period)}
              disabled={loading}
              className="h-9"
            >
              <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
            {planExists && editable ? (
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  runWithPastPeriodGuard(() =>
                    onSave(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined),
                  )
                }
                disabled={saving}
                className="h-9"
              >
                <Save className="mr-1.5 h-4 w-4" />
                {saving ? "Saving…" : "Save changes"}
              </Button>
            ) : null}
            {planExists && editable ? (
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={() => runWithPastPeriodGuard(() => Promise.resolve(setConfirmLockOpen(true)))}
                disabled={!canLock || saving}
                title={canLock ? "Lock plan and generate RM Planning" : "Add a planned qty > 0 to lock"}
                className="h-9 bg-amber-700 hover:bg-amber-800"
              >
                <Lock className="mr-1.5 h-4 w-4" />
                Lock plan
              </Button>
            ) : null}
            {planExists && isLocked && canMutatePeriod ? (
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
                className="h-9 border-amber-300 text-amber-900 hover:bg-amber-50"
              >
                <Unlock className="mr-1.5 h-4 w-4" />
                {reopening ? "Reopening…" : "Reopen plan"}
              </Button>
            ) : null}
            {canCancelReopen && canMutatePeriod ? (
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
                className="h-9 border-slate-300 text-slate-800 hover:bg-slate-50"
              >
                <X className="mr-1.5 h-4 w-4" />
                {cancellingReopen ? "Cancelling…" : "Cancel reopen"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {periodIsPast && !isAdmin ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <strong>Past period.</strong> Planning actions are disabled.
        </div>
      ) : null}
      {periodIsPast && isAdmin ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <strong>Past period ({period}).</strong> Changes require admin confirmation and should be used only for
          audit, correction, or testing.
        </div>
      ) : null}

      {isDraftForNextRevision && plan ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-900">
          <strong>Editing draft for Revision {plan.currentRevision + 1}.</strong> Last locked revision:{" "}
          <strong>{plan.currentRevision}</strong> remains in history (view-only).
        </div>
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard label="Total FG planned" value={totalFgPlanned.toLocaleString()} />
        <KpiCard label="Total FG suggested" value={totalFgSuggested.toLocaleString()} />
        <KpiCard label="FG items with variance" value={String(fgItemsWithVariance)} />
        <KpiCard label="Status" value={plan?.status ?? "—"} />
      </div>

      <GreenLevelSection
        period={period}
        data={greenLevels}
        visible={greenLevelsVisible}
        loading={loadingGreenLevels}
        onLoad={() => void loadGreenLevels()}
        onHide={() => setGreenLevelsVisible(false)}
      />

      <RequirementCompositionSection
        period={period}
        data={requirementComposition}
        visible={requirementCompositionVisible}
        loading={loadingRequirementComposition}
        onLoad={() => void loadRequirementComposition()}
        onHide={() => setRequirementCompositionVisible(false)}
      />

      <RmRequirementCompositionSection
        period={period}
        data={rmRequirementComposition}
        visible={rmRequirementCompositionVisible}
        loading={loadingRmRequirementComposition}
        onLoad={() => void loadRmRequirementComposition()}
        onHide={() => setRmRequirementCompositionVisible(false)}
      />

      {planExists && plan ? (
        <RevisionHistorySection
          data={planRevisions}
          loading={loadingRevisions}
          expandedRevision={expandedRevision}
          onToggleRevision={(rev) =>
            setExpandedRevision((cur) => (cur === rev ? null : rev))
          }
        />
      ) : null}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <TabButton active={activeTab === "production"} onClick={() => setActiveTab("production")}>
          Production Plan
        </TabButton>
        <TabButton
          active={activeTab === "rm"}
          disabled={!isLocked}
          title={isLocked ? undefined : "Lock the plan to generate RM Planning"}
          onClick={() => setActiveTab("rm")}
        >
          RM Planning
        </TabButton>
        <TabButton
          active={activeTab === "purchase"}
          disabled={!isLocked}
          title={isLocked ? undefined : "Lock the plan to review purchase planning"}
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
            loading={loadingPurchase}
            onRefresh={() => void refreshPurchase()}
            onRelease={() => setConfirmReleaseOpen(true)}
            releaseSummary={releaseSummary}
          />
        ) : activeTab === "rm" ? (
          <RmPlanningTab data={rmPlanning} loading={loadingRm} onRefresh={() => void refreshRm()} />
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
            isLocked={isLocked}
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

      {confirmLockOpen ? (
        <LockConfirmModal
          lockSummary={activeLockSummary}
          totalFgItems={totalFgItems}
          period={period}
          locking={locking}
          onCancel={() => setConfirmLockOpen(false)}
          onConfirm={() => void onConfirmLock(periodIsPast && isAdmin ? { confirmPastPeriod: true } : undefined)}
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
          revision={plan?.currentRevision ?? 0}
          data={purchasePlanning}
          releasing={releasing}
          onCancel={() => setConfirmReleaseOpen(false)}
          onConfirm={() => void onConfirmRelease()}
        />
      ) : null}
    </div>
  );
}

function ReleaseConfirmModal({
  revision,
  data,
  releasing,
  onCancel,
  onConfirm,
}: {
  revision: number;
  data: PurchasePlanningResponse | null;
  releasing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const lines = data?.lines ?? [];
  const totalRmItems = lines.length;
  const totalAdditional = lines.reduce(
    (a, l) => a + num(l.additionalRequirementQty ?? l.suggestedPurchaseQty),
    0,
  );
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
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Revision</div>
            <div className="text-lg font-bold tabular-nums text-slate-900">{revision}</div>
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
          Only the procurement <strong>delta</strong> will be released into the Material Requirement flow
          (previously released quantities are not duplicated). Releasing again with no new demand emits nothing.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={releasing}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={releasing} className="bg-sky-700 hover:bg-sky-800">
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
  onCancel,
  onConfirm,
}: {
  lockSummary: LockSummary | null;
  totalFgItems: number;
  period: string;
  locking: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const varianceCount = lockSummary?.fgItemsWithVariance ?? 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Lock className="h-4 w-4" />
            </span>
            <h3 className="text-base font-semibold text-slate-900">Lock monthly plan</h3>
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

        {varianceCount > 0 ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            Planned quantities differ from recommendations for <strong>{varianceCount}</strong> FG item
            {varianceCount === 1 ? "" : "s"}. Informational only — lock is not blocked.
          </p>
        ) : null}

        <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
          Locking <strong>{period}</strong> will freeze the production plan and generate an immutable{" "}
          <strong>RM Planning snapshot</strong> (BOM explosion + current stock position) for a new revision. The
          Production Plan becomes read-only. This does not create any purchase or procurement records.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={locking}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={locking} className="bg-amber-700 hover:bg-amber-800">
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
}: {
  data: RmPlanningResponse | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading && !data) {
    return <div className="p-6 text-sm text-slate-500">Loading RM Planning…</div>;
  }
  if (!data || !data.locked || !data.exists) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
        <p className="text-sm text-slate-500">
          Lock the plan to generate the RM Planning snapshot.
        </p>
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KpiCard label="Total RM items" value={String(totalRmItems)} />
        <KpiCard label="Total gross demand" value={totalGross.toLocaleString()} />
        <KpiCard label="Net procurement req." value={totalNet.toLocaleString()} />
        <KpiCard label="Critical shortages" value={String(criticalShortage)} />
        <KpiCard label="Coverage %" value={`${coveragePct}%`} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[12px] text-slate-500">
          Snapshot revision {data.revision} · {lines.length} RM lines (read-only)
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
              <th className="px-3 py-2 w-28 text-right">Gross demand</th>
              <th className="px-3 py-2 w-24 text-right">Free stock</th>
              <th className="px-3 py-2 w-24 text-right">Reserved</th>
              <th className="px-3 py-2 w-28 text-right">Incoming PO</th>
              <th className="px-3 py-2 w-28 text-right">Net requirement</th>
              <th className="px-3 py-2">Warnings</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">
                  No RM demand from this plan.
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
                            title={w.message ?? w.code}
                            className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {w.code ?? "Warning"}
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
  expandedRevision,
  onToggleRevision,
}: {
  data: PlanRevisionsResponse | null;
  loading: boolean;
  expandedRevision: number | null;
  onToggleRevision: (revision: number) => void;
}) {
  const revisions = data?.revisions ?? [];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <History className="h-4 w-4 text-slate-500" />
        <h3 className="text-[13px] font-semibold text-slate-800">Revision History</h3>
        {loading ? <span className="text-[11px] text-slate-400">Loading…</span> : null}
        {!loading && revisions.length === 0 ? (
          <span className="text-[11px] text-slate-400">No locked revisions yet.</span>
        ) : null}
      </div>

      {revisions.length > 0 ? (
        <div className="overflow-auto rounded-md border border-slate-100">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2 w-20">Revision</th>
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
                      <td className="px-3 py-2 font-medium text-slate-800">Rev {rev.revision}</td>
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
                            <Badge variant="warning">Current</Badge>
                          ) : (
                            <Badge variant="default">Locked</Badge>
                          )}
                          {rev.released ? <Badge variant="info">Released</Badge> : null}
                          {rev.hasRmSnapshot ? (
                            <span className="text-[10px] text-slate-400">RM snapshot</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-t border-slate-50 bg-slate-50/50">
                        <td colSpan={6} className="px-3 py-2">
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
                                    No FG snapshot lines for this revision.
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
      ) : null}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{value}</div>
    </div>
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
        "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
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

const PURCHASE_STATUS_META: Record<PurchaseStatus, { label: string; cls: string }> = {
  NOT_RELEASED: { label: "Not released", cls: "bg-slate-100 text-slate-600" },
  PARTIALLY_RELEASED: { label: "Partial", cls: "bg-amber-100 text-amber-800" },
  FULLY_RELEASED: { label: "Released", cls: "bg-emerald-100 text-emerald-800" },
  OVER_RELEASED: { label: "Over released", cls: "bg-red-100 text-red-800" },
};

function PurchasePlanningTab({
  data,
  loading,
  onRefresh,
  onRelease,
  releaseSummary,
}: {
  data: PurchasePlanningResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onRelease: () => void;
  releaseSummary: ReleaseSummary | null;
}) {
  if (loading && !data) {
    return <div className="p-6 text-sm text-slate-500">Loading Purchase Planning…</div>;
  }
  if (!data || !data.locked || !data.exists) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
        <p className="text-sm text-slate-500">Lock the plan to review purchase planning.</p>
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
  const totalAdditional =
    data.totals?.additionalRequirementTotal ??
    lines.reduce((a, l) => a + num(l.additionalRequirementQty ?? l.suggestedPurchaseQty), 0);
  const totalReduction =
    data.totals?.reductionTotal ?? lines.reduce((a, l) => a + num(l.reductionQty ?? 0), 0);
  const coveragePct =
    data.totals?.coveragePct ??
    (totalCurrent > 0 ? round3((totalReleased / totalCurrent) * 100) : null);
  const hasReduction = lines.some((l) => num(l.reductionQty) > 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {releaseSummary ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          Released revision {releaseSummary.revision}
          {releaseSummary.materialRequirementDocNo ? ` → MR ${releaseSummary.materialRequirementDocNo}` : ""}: {" "}
          <strong>{releaseSummary.releasedLineCount}</strong> line(s) released (delta{" "}
          {releaseSummary.totalDeltaQty.toLocaleString()}), <strong>{releaseSummary.skippedLineCount}</strong> skipped,{" "}
          <strong>{releaseSummary.surplusLineCount}</strong> surplus.
        </div>
      ) : (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] text-sky-800">
          Purchase Planning uses the <strong>current locked revision</strong> only. Additional requirement is the delta
          over previously released quantity — not full re-procurement.
        </div>
      )}

      {hasReduction ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <strong>Reduction</strong> means the latest revision requires less than previously released. The system will
          reduce open MR quantity where possible. PO-backed quantity will remain as surplus and needs attention.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="RM items" value={String(totalRmItems)} />
        <KpiCard label="Current requirement total" value={totalCurrent.toLocaleString()} />
        <KpiCard label="Previously released total" value={totalReleased.toLocaleString()} />
        <KpiCard label="Additional requirement total" value={totalAdditional.toLocaleString()} />
        <KpiCard label="Reduction total" value={totalReduction.toLocaleString()} />
        <KpiCard
          label="Coverage %"
          value={coveragePct != null ? `${coveragePct.toLocaleString()}%` : "—"}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[12px] text-slate-500">
          Current revision {data.revision} · {lines.length} RM lines (read-only)
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="h-8">
            <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onRelease}
            disabled={loading || lines.every((l) => l.netRequirementQty <= 0)}
            className="h-8 bg-sky-700 hover:bg-sky-800"
          >
            Release Delta to Procurement
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">RM item</th>
              <th className="px-3 py-2 w-16">Unit</th>
              <th className="px-3 py-2 w-28 text-right">Current requirement</th>
              <th className="px-3 py-2 w-28 text-right">Previously released</th>
              <th className="px-3 py-2 w-28 text-right">Additional requirement</th>
              <th className="px-3 py-2 w-24 text-right">Reduction</th>
              <th className="px-3 py-2 w-28 text-right">Suggested buy</th>
              <th className="px-3 py-2 w-32">Status</th>
              <th className="px-3 py-2">Warnings</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">
                  No RM demand from this plan.
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
                        "px-3 py-1.5 text-right font-semibold tabular-nums",
                        suggestedBuy > 0 ? "text-sky-700" : "text-slate-400",
                      )}
                    >
                      {suggestedBuy.toLocaleString()}
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
                            title={w.message ?? w.code}
                            className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {w.code ?? "Warning"}
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
  visible,
  loading,
  onLoad,
  onHide,
}: {
  period: string;
  data: GreenLevelsResponse | null;
  visible: boolean;
  loading: boolean;
  onLoad: () => void;
  onHide: () => void;
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
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-slate-800">Read-only Green Level (FG)</h3>
          <p className="mt-0.5 text-[12px] text-slate-600">
            Status uses <strong>free FG stock</strong> vs green target from locked RS history before{" "}
            <strong>{period}</strong>. Validation only — no planning actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {visible ? (
            <Button type="button" variant="outline" size="sm" onClick={onHide} className="h-8">
              Hide
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onLoad} disabled={loading} className="h-8">
            <Layers className={cn("mr-1.5 h-4 w-4", loading && "animate-pulse")} />
            {loading ? "Loading…" : "View Green Levels"}
          </Button>
        </div>
      </div>

      {visible && (loading || dataForPeriod) ? (
        loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading green levels for {period}…</p>
        ) : dataForPeriod ? (
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
                    No locked NO_QTY RS schedule history in the 6-month window.
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
        ) : null
      ) : null}
    </div>
  );
}

function RequirementCompositionSection({
  period,
  data,
  visible,
  loading,
  onLoad,
  onHide,
}: {
  period: string;
  data: RequirementCompositionResponse | null;
  visible: boolean;
  loading: boolean;
  onLoad: () => void;
  onHide: () => void;
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
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-slate-800">Requirement Composition</h3>
          <p className="mt-0.5 text-[12px] text-slate-600">
            Read-only FG production recommendation for <strong>{period}</strong>: RS Requirement + Carry Forward +
            Green Shortage. Transparency only — no planning actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {visible ? (
            <Button type="button" variant="outline" size="sm" onClick={onHide} className="h-8">
              Hide
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onLoad} disabled={loading} className="h-8">
            <Calculator className={cn("mr-1.5 h-4 w-4", loading && "animate-pulse")} />
            {loading ? "Loading…" : "View Composition"}
          </Button>
        </div>
      </div>

      {visible && (loading || dataForPeriod) ? (
        loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading requirement composition for {period}…</p>
        ) : dataForPeriod ? (
          <div className="mt-3 overflow-auto rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-[11px] text-slate-500">
              {dataForPeriod.itemCount} FG item(s) with a non-zero component · read-only
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
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">
                      No non-zero RS, carry-forward, or green-shortage components for this period.
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
        ) : null
      ) : null}
    </div>
  );
}

function RmRequirementCompositionSection({
  period,
  data,
  visible,
  loading,
  onLoad,
  onHide,
}: {
  period: string;
  data: RmRequirementCompositionResponse | null;
  visible: boolean;
  loading: boolean;
  onLoad: () => void;
  onHide: () => void;
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
    <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-slate-800">RM Requirement Composition</h3>
          <p className="mt-0.5 text-[12px] text-slate-600">
            Read-only BOM-derived RM demand from FG <strong>suggested production</strong> for{" "}
            <strong>{period}</strong>. Stock visibility only — no procurement actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {visible ? (
            <Button type="button" variant="outline" size="sm" onClick={onHide} className="h-8">
              Hide
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onLoad} disabled={loading} className="h-8">
            <Boxes className={cn("mr-1.5 h-4 w-4", loading && "animate-pulse")} />
            {loading ? "Loading…" : "View RM Composition"}
          </Button>
        </div>
      </div>

      {visible && (loading || dataForPeriod) ? (
        loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading RM requirement composition for {period}…</p>
        ) : dataForPeriod ? (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiCard label="FG items planned" value={String(dataForPeriod.summary.fgItemsPlanned)} />
              <KpiCard label="RM items required" value={String(dataForPeriod.summary.rmItemsRequired)} />
              <KpiCard label="RM lines with gap" value={String(dataForPeriod.summary.rmLinesWithGap)} />
              <KpiCard label="Missing BOM count" value={String(dataForPeriod.summary.missingBomCount)} />
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
                        No RM demand for FG suggested production in this period (check FG composition or missing BOM).
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
                                            <span className="ml-1 text-amber-700">(missing BOM)</span>
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
        ) : null
      ) : null}
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
        Review Requirement Composition, Green Level, and RM Composition above. Start planning only when you are ready
        to create a draft — opening this month does not create a database record.
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

function ProductionPlanTab({
  rows,
  editable,
  isLocked,
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
  isLocked: boolean;
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
            <h3 className="text-[13px] font-semibold text-slate-800">Read-only RS suggestions</h3>
            <p className="mt-0.5 text-[12px] text-slate-600">
              Locked NO_QTY Requirement Sheets for <strong>{period}</strong>. MPRS reads schedule + carry forward;
              Requirement Sheets are never modified here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {rsSuggestionsVisible ? (
              <Button type="button" variant="outline" size="sm" onClick={onHideRsSuggestions} className="h-8">
                Hide
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onLoadRsSuggestions}
              disabled={loadingRsSuggestions}
              className="h-8"
            >
              <Eye className={cn("mr-1.5 h-4 w-4", loadingRsSuggestions && "animate-pulse")} />
              {loadingRsSuggestions ? "Loading…" : "View RS suggestions"}
            </Button>
          </div>
        </div>

        {rsSuggestionsVisible && rsSuggestions ? (
          <div className="mt-3 overflow-auto rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-[11px] text-slate-500">
              {rsSuggestions.sheetCount} locked sheet(s) · {rsSuggestions.items.length} FG item(s) · read-only
            </div>
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2">FG item</th>
                  <th className="px-3 py-2 w-28 text-right">Schedule qty</th>
                  <th className="px-3 py-2 w-28 text-right">Carry forward</th>
                  <th className="px-3 py-2 w-32 text-right">Production req.</th>
                  <th className="px-3 py-2 w-24 text-center">Source RS</th>
                  {editable ? <th className="px-3 py-2 w-36">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {rsSuggestions.items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={editable ? 7 : 6}
                      className="px-3 py-6 text-center text-sm text-slate-400"
                    >
                      No locked NO_QTY Requirement Sheets for this period.
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
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                            {item.scheduleQty.toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                            {item.carryForwardQty.toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-900">
                            {item.productionRequirementQty.toLocaleString()}
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
                        {expanded
                          ? item.sources.map((src) => (
                              <tr
                                key={`${item.itemId}-${src.requirementSheetId}-${src.salesOrderId}-${src.cycleId}`}
                                className="border-t border-slate-50 bg-slate-50/60 text-[12px] text-slate-600"
                              >
                                <td />
                                <td className="px-3 py-1.5 pl-8" colSpan={editable ? 6 : 5}>
                                  <span className="font-medium text-slate-700">
                                    {src.requirementSheetDocNo ?? `RS #${src.requirementSheetId}`}
                                  </span>
                                  {" · "}
                                  SO {src.salesOrderDocNo ?? src.salesOrderId}
                                  {src.cycleId != null ? ` · Cycle ${src.cycleId}` : ""}
                                  {" · "}
                                  Schedule {src.requirementQty.toLocaleString()}
                                  {" · "}
                                  CF {src.shortfallQtySnapshot.toLocaleString()}
                                  {" · "}
                                  Prod req. {src.suggestedWoQtySnapshot.toLocaleString()}
                                </td>
                              </tr>
                            ))
                          : null}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {isLocked ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-900">
          This plan is locked. Use <strong>Reopen plan</strong> in the header to edit the next revision draft.
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
                  No FG lines yet. {editable ? "Add an FG item to begin." : ""}
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
